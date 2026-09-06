import { Color, Material, Mesh, MeshRenderer, Node, Quat, utils, Vec3 } from 'cc';

type DynamicGeometry = {
    positions: Float32Array;
    colors?: Float32Array;
    indices16?: Uint16Array;
    minPos?: { x: number; y: number; z: number };
    maxPos?: { x: number; y: number; z: number };
};

const dynamicMeshUtils = (utils as unknown as {
    MeshUtils: {
        createDynamicMesh: (
            primitiveIndex: number,
            geometry: DynamicGeometry,
            out: Mesh | undefined,
            options: { maxSubMeshes: number; maxSubMeshVertices: number; maxSubMeshIndices: number },
        ) => Mesh;
    };
}).MeshUtils;

const CONFETTI_COLORS = [
    new Color(255, 54, 84, 255),
    new Color(255, 205, 32, 255),
    new Color(24, 194, 255, 255),
    new Color(48, 216, 94, 255),
    new Color(180, 72, 255, 255),
] as const;

const CONFETTI_COUNT = 96;
const GRID_COLUMNS = 12;
const GRID_DEPTH = 8;
const UPDATE_INTERVAL = 1 / 30;
const FIELD_WIDTH_Z = 6;
const FIELD_DEPTH_X = 4.8;
const FIELD_BOTTOM_Y = 0.5;
const FIELD_TOP_Y = 5.2;
const PIECE_THICKNESS = 0.01;
const PIECE_HEIGHT = 0.045;
const PIECE_WIDTH = 0.075;
const VERTICES_PER_PIECE = 8;
const INDICES_PER_PIECE = 36;
const BOX_CORNERS = new Float32Array([
    -PIECE_THICKNESS * 0.5, -PIECE_HEIGHT * 0.5, -PIECE_WIDTH * 0.5,
    PIECE_THICKNESS * 0.5, -PIECE_HEIGHT * 0.5, -PIECE_WIDTH * 0.5,
    PIECE_THICKNESS * 0.5, PIECE_HEIGHT * 0.5, -PIECE_WIDTH * 0.5,
    -PIECE_THICKNESS * 0.5, PIECE_HEIGHT * 0.5, -PIECE_WIDTH * 0.5,
    -PIECE_THICKNESS * 0.5, -PIECE_HEIGHT * 0.5, PIECE_WIDTH * 0.5,
    PIECE_THICKNESS * 0.5, -PIECE_HEIGHT * 0.5, PIECE_WIDTH * 0.5,
    PIECE_THICKNESS * 0.5, PIECE_HEIGHT * 0.5, PIECE_WIDTH * 0.5,
    -PIECE_THICKNESS * 0.5, PIECE_HEIGHT * 0.5, PIECE_WIDTH * 0.5,
]);
const BOX_INDICES = new Uint16Array([
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    3, 7, 6, 3, 6, 2,
    0, 4, 7, 0, 7, 3,
    1, 2, 6, 1, 6, 5,
]);

type ConfettiPiece = {
    column: number;
    depthIndex: number;
    baseX: number;
    baseZ: number;
    x: number;
    z: number;
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

/**
 * Small opaque confetti pieces with an explicit grid distribution. A custom
 * field is used instead of ParticleSystem so spawn coverage and solid color do
 * not depend on particle-shader blending or shape-module scaling.
 */
export class AwardsConfettiEmitter {
    private _node: Node | null = null;
    private _mesh: Mesh | null = null;
    private readonly _pieces: ConfettiPiece[] = [];
    private _material: Material | null = null;
    private readonly _positions = new Float32Array(CONFETTI_COUNT * VERTICES_PER_PIECE * 3);
    private readonly _colors = new Float32Array(CONFETTI_COUNT * VERTICES_PER_PIECE * 4);
    private readonly _indices = new Uint16Array(CONFETTI_COUNT * INDICES_PER_PIECE);
    private readonly _rotation = new Quat();
    private readonly _corner = new Vec3();
    private readonly _rotatedCorner = new Vec3();
    private _active = false;
    private _elapsed = 0;
    private _pendingSeconds = 0;
    private readonly _meshUpdate = { positions: this._positions, indices16: this._indices };

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
        this._pendingSeconds = 0;
        this.resetField();
    }

    update(dt: number) {
        if (!this._active || !this._node?.isValid || !this._node.active || dt <= 0) {
            return;
        }
        this._pendingSeconds += dt;
        if (this._pendingSeconds + 0.000001 < UPDATE_INTERVAL) return;
        const safeDt = Math.min(this._pendingSeconds, 0.1);
        this._pendingSeconds = 0;
        this._elapsed += safeDt;
        for (const piece of this._pieces) {
            piece.y -= piece.fallSpeed * safeDt;
            if (piece.y < FIELD_BOTTOM_Y) {
                this.resetPiece(piece, FIELD_TOP_Y + Math.random() * 0.8);
            }

            const driftX = Math.sin(this._elapsed * 0.75 + piece.phase) * 0.11;
            const driftZ = Math.sin(this._elapsed * 0.58 + piece.phase * 1.7) * 0.09;
            piece.x = piece.baseX + driftX;
            piece.z = piece.baseZ + driftZ;

            piece.eulerX += piece.spinX * safeDt;
            piece.eulerY += piece.spinY * safeDt;
            piece.eulerZ += piece.spinZ * safeDt;
        }
        this.updateMeshGeometry();
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
        if (this._mesh?.isValid) {
            this._mesh.destroy();
        }
        if (this._material?.isValid) {
            this._material.destroy();
        }
        this._node = null;
        this._mesh = null;
        this._material = null;
        this._pieces.length = 0;
    }

    private ensureBuilt(parent: Node) {
        if (this._node?.isValid) {
            return;
        }
        this._pieces.length = 0;
        this._node = new Node('AwardsConfetti');
        this._node.setParent(parent);
        this._node.layer = parent.layer;
        this._node.active = false;

        for (let index = 0; index < CONFETTI_COUNT; index++) {
            this._pieces.push({
                column: index % GRID_COLUMNS,
                depthIndex: Math.floor(index / GRID_COLUMNS) % GRID_DEPTH,
                baseX: 0,
                baseZ: 0,
                x: 0,
                z: 0,
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
        this.initializeStaticGeometry();
        this.resetField();
        this.updatePositionBuffer();
        this._mesh = dynamicMeshUtils.createDynamicMesh(0, {
            positions: this._positions,
            colors: this._colors,
            indices16: this._indices,
            minPos: {
                x: -FIELD_DEPTH_X * 0.5 - 0.25,
                y: FIELD_BOTTOM_Y - 0.25,
                z: -FIELD_WIDTH_Z * 0.5 - 0.25,
            },
            maxPos: {
                x: FIELD_DEPTH_X * 0.5 + 0.25,
                y: FIELD_TOP_Y + 1.05,
                z: FIELD_WIDTH_Z * 0.5 + 0.25,
            },
        }, undefined, {
            maxSubMeshes: 1,
            maxSubMeshVertices: CONFETTI_COUNT * VERTICES_PER_PIECE,
            maxSubMeshIndices: CONFETTI_COUNT * INDICES_PER_PIECE,
        });
        this._material = makeOpaqueMaterial();
        const renderer = this._node.addComponent(MeshRenderer);
        renderer.mesh = this._mesh;
        renderer.setMaterial(this._material, 0);
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
        piece.x = piece.baseX;
        piece.z = piece.baseZ;
        piece.y = y;
        piece.fallSpeed = randomRange(0.55, 0.82);
        piece.phase = Math.random() * Math.PI * 2;
    }

    private initializeStaticGeometry() {
        for (let pieceIndex = 0; pieceIndex < CONFETTI_COUNT; pieceIndex++) {
            const vertexBase = pieceIndex * VERTICES_PER_PIECE;
            const indexBase = pieceIndex * INDICES_PER_PIECE;
            for (let index = 0; index < BOX_INDICES.length; index++) {
                this._indices[indexBase + index] = vertexBase + BOX_INDICES[index];
            }
            const color = CONFETTI_COLORS[pieceIndex % CONFETTI_COLORS.length];
            for (let vertex = 0; vertex < VERTICES_PER_PIECE; vertex++) {
                const colorOffset = (vertexBase + vertex) * 4;
                this._colors[colorOffset] = color.r / 255;
                this._colors[colorOffset + 1] = color.g / 255;
                this._colors[colorOffset + 2] = color.b / 255;
                this._colors[colorOffset + 3] = 1;
            }
        }
    }

    private updateMeshGeometry() {
        if (!this._mesh?.isValid) {
            return;
        }
        this.updatePositionBuffer();
        this._mesh.updateSubMesh(0, this._meshUpdate);
    }

    private updatePositionBuffer() {
        for (let pieceIndex = 0; pieceIndex < this._pieces.length; pieceIndex++) {
            const piece = this._pieces[pieceIndex];
            Quat.fromEuler(this._rotation, piece.eulerX, piece.eulerY, piece.eulerZ);
            const positionBase = pieceIndex * VERTICES_PER_PIECE * 3;
            for (let vertex = 0; vertex < VERTICES_PER_PIECE; vertex++) {
                const cornerOffset = vertex * 3;
                this._corner.set(
                    BOX_CORNERS[cornerOffset],
                    BOX_CORNERS[cornerOffset + 1],
                    BOX_CORNERS[cornerOffset + 2],
                );
                Vec3.transformQuat(this._rotatedCorner, this._corner, this._rotation);
                const positionOffset = positionBase + cornerOffset;
                this._positions[positionOffset] = piece.x + this._rotatedCorner.x;
                this._positions[positionOffset + 1] = piece.y + this._rotatedCorner.y;
                this._positions[positionOffset + 2] = piece.z + this._rotatedCorner.z;
            }
        }
    }
}

function makeOpaqueMaterial(): Material {
    const material = new Material();
    material.initialize({ effectName: 'builtin-unlit', defines: { USE_VERTEX_COLOR: true } });
    material.name = 'AwardsConfettiMerged';
    material.setProperty('mainColor', Color.WHITE);
    return material;
}

function randomRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

function randomSigned(minMagnitude: number, maxMagnitude: number): number {
    const magnitude = randomRange(minMagnitude, maxMagnitude);
    return Math.random() < 0.5 ? -magnitude : magnitude;
}
