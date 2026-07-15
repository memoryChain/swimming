import { Color, Material, Mesh, MeshRenderer, Node, primitives, utils, Vec3 } from 'cc';

const CONFETTI_COLORS = [
    new Color(255, 54, 84, 255),
    new Color(255, 205, 32, 255),
    new Color(24, 194, 255, 255),
    new Color(48, 216, 94, 255),
    new Color(180, 72, 255, 255),
] as const;

const CONFETTI_COUNT = 48;
const GRID_COLUMNS = 12;
const GRID_DEPTH = 4;
const FIELD_WIDTH_Z = 6;
const FIELD_DEPTH_X = 4.8;
const FIELD_BOTTOM_Y = 0.5;
const FIELD_TOP_Y = 5.2;
const PIECE_THICKNESS = 0.01;
const PIECE_HEIGHT = 0.045;
const PIECE_WIDTH = 0.075;

type ConfettiPiece = {
    node: Node;
    column: number;
    depthIndex: number;
    baseX: number;
    baseZ: number;
    y: number;
    phase: number;
    fallSpeed: number;
    eulerX: number;
    eulerY: number;
    eulerZ: number;
    spinX: number;
    spinY: number;
    spinZ: number;
};

let sharedConfettiMesh: Mesh | null = null;

/**
 * Small opaque confetti pieces with an explicit grid distribution. A custom
 * field is used instead of ParticleSystem so spawn coverage and solid color do
 * not depend on particle-shader blending or shape-module scaling.
 */
export class AwardsConfettiEmitter {
    private _node: Node | null = null;
    private readonly _pieces: ConfettiPiece[] = [];
    private readonly _materials: Material[] = [];
    private _active = false;
    private _elapsed = 0;

    show(parent: Node, podiumCenter: Vec3) {
        this.ensureBuilt(parent);
        if (!this._node?.isValid) {
            return;
        }
        if (this._node.parent !== parent) {
            this._node.setParent(parent);
        }
        this._node.setWorldPosition(podiumCenter);
        this._node.setWorldScale(Vec3.ONE);
        this._node.active = true;
        this._active = true;
        this._elapsed = 0;
        this.resetField();
    }

    update(dt: number) {
        if (!this._active || !this._node?.isValid || dt <= 0) {
            return;
        }
        const safeDt = Math.min(dt, 0.05);
        this._elapsed += safeDt;
        for (const piece of this._pieces) {
            piece.y -= piece.fallSpeed * safeDt;
            if (piece.y < FIELD_BOTTOM_Y) {
                this.resetPiece(piece, FIELD_TOP_Y + Math.random() * 0.8);
            }

            const driftX = Math.sin(this._elapsed * 0.75 + piece.phase) * 0.11;
            const driftZ = Math.sin(this._elapsed * 0.58 + piece.phase * 1.7) * 0.09;
            piece.node.setPosition(piece.baseX + driftX, piece.y, piece.baseZ + driftZ);

            piece.eulerX += piece.spinX * safeDt;
            piece.eulerY += piece.spinY * safeDt;
            piece.eulerZ += piece.spinZ * safeDt;
            piece.node.setRotationFromEuler(piece.eulerX, piece.eulerY, piece.eulerZ);
        }
    }

    hide() {
        this._active = false;
        if (this._node?.isValid) {
            this._node.active = false;
        }
    }

    dispose() {
        this.hide();
        if (this._node?.isValid) {
            this._node.destroy();
        }
        for (const material of this._materials) {
            if (material.isValid) {
                material.destroy();
            }
        }
        this._node = null;
        this._pieces.length = 0;
        this._materials.length = 0;
    }

    private ensureBuilt(parent: Node) {
        if (this._node?.isValid) {
            return;
        }
        this._pieces.length = 0;
        this._materials.length = 0;
        this._node = new Node('AwardsConfetti');
        this._node.setParent(parent);
        this._node.layer = parent.layer;
        this._node.active = false;

        for (const color of CONFETTI_COLORS) {
            this._materials.push(makeOpaqueMaterial(color));
        }

        const mesh = getConfettiMesh();
        for (let index = 0; index < CONFETTI_COUNT; index++) {
            const node = new Node(`ConfettiPiece${index + 1}`);
            node.setParent(this._node);
            node.layer = this._node.layer;
            node.setScale(PIECE_THICKNESS, PIECE_HEIGHT, PIECE_WIDTH);
            const renderer = node.addComponent(MeshRenderer);
            renderer.mesh = mesh;
            renderer.setMaterial(this._materials[index % this._materials.length], 0);
            this._pieces.push({
                node,
                column: index % GRID_COLUMNS,
                depthIndex: Math.floor(index / GRID_COLUMNS) % GRID_DEPTH,
                baseX: 0,
                baseZ: 0,
                y: 0,
                phase: Math.random() * Math.PI * 2,
                fallSpeed: randomRange(0.55, 0.82),
                eulerX: Math.random() * 360,
                eulerY: Math.random() * 360,
                eulerZ: Math.random() * 360,
                spinX: randomSigned(35, 85),
                spinY: randomSigned(30, 75),
                spinZ: randomSigned(40, 95),
            });
        }
    }

    private resetField() {
        const verticalSpan = FIELD_TOP_Y - FIELD_BOTTOM_Y;
        const denominator = Math.max(1, this._pieces.length - 1);
        for (let index = 0; index < this._pieces.length; index++) {
            // A coprime stride prevents adjacent grid cells from sharing the
            // same height while still filling the whole fall column evenly.
            const heightSlot = (index * 17) % this._pieces.length;
            const y = FIELD_BOTTOM_Y + verticalSpan * heightSlot / denominator;
            this.resetPiece(this._pieces[index], y);
        }
    }

    private resetPiece(piece: ConfettiPiece, y: number) {
        const cellWidth = FIELD_WIDTH_Z / GRID_COLUMNS;
        const cellDepth = FIELD_DEPTH_X / GRID_DEPTH;
        piece.baseZ = -FIELD_WIDTH_Z * 0.5
            + (piece.column + randomRange(0.18, 0.82)) * cellWidth;
        piece.baseX = -FIELD_DEPTH_X * 0.5
            + (piece.depthIndex + randomRange(0.18, 0.82)) * cellDepth;
        piece.y = y;
        piece.fallSpeed = randomRange(0.55, 0.82);
        piece.phase = Math.random() * Math.PI * 2;
    }
}

function getConfettiMesh(): Mesh {
    if (!sharedConfettiMesh) {
        sharedConfettiMesh = utils.createMesh(primitives.box());
    }
    return sharedConfettiMesh;
}

function makeOpaqueMaterial(color: Color): Material {
    const material = new Material();
    material.initialize({ effectName: 'builtin-unlit' });
    material.name = `AwardsConfetti_${color.r}_${color.g}_${color.b}`;
    material.setProperty('mainColor', color);
    return material;
}

function randomRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

function randomSigned(minMagnitude: number, maxMagnitude: number): number {
    const magnitude = randomRange(minMagnitude, maxMagnitude);
    return Math.random() < 0.5 ? -magnitude : magnitude;
}
