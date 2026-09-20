import { Color, gfx, Material, Mesh, MeshRenderer, Node, primitives, utils, Vec3 } from 'cc';
import type { SharkController } from '../entity/SharkController';
import { SharkState } from '../entity/SharkTuning';

const UPDATE_INTERVAL = 1 / 30;
const WATER_SURFACE_OFFSET = 0.065;
const TRAIL_COUNT = 3;
const RADIANS_TO_DEGREES = 180 / Math.PI;
const WARNING_ARROW_COLOR = new Color(255, 150, 38, 210);
const HUNT_ARROW_COLOR = new Color(168, 8, 30, 220);

/**
 * 鲨鱼锁定的世界空间表现：少量池化箭头从鲨鱼朝目标推进，不再在人物身上放置跟随圆圈。
 * 固定网格只在 bind 时构建；比赛中只以 30Hz 修改节点变换和状态边沿材质颜色。
 */
export class SharkLockOnOverlay {
    private _root: Node | null = null;
    private readonly _trails: Node[] = [];
    private _trailMesh: Mesh | null = null;
    private _trailMaterial: Material | null = null;
    private _waterY = 0;
    private _elapsed = UPDATE_INTERVAL;
    private _clock = 0;
    private _lastState = SharkState.INACTIVE;
    private _disposed = false;
    private readonly _targetWorld = new Vec3();
    private readonly _sharkWorld = new Vec3();

    bind(worldRoot: Node | null, waterY: number, layer: number): void {
        if (this._root?.isValid || !worldRoot?.isValid || this._disposed) return;
        this._waterY = waterY;
        this._trailMesh = utils.createMesh(buildHuntRippleGeometry());
        this._trailMaterial = makeTransparentMaterial('SharkHuntRippleMaterial', WARNING_ARROW_COLOR);

        const root = new Node('SharkLockOnWorldOverlay');
        root.setParent(worldRoot);
        root.layer = layer;
        this._root = root;
        for (let i = 0; i < TRAIL_COUNT; i++) {
            const trail = this.makeMeshNode(`HuntRipple_${i + 1}`, this._trailMesh, this._trailMaterial, root, layer);
            trail.active = false;
            this._trails.push(trail);
        }
        root.active = false;
    }

    update(shark: SharkController | null, dt: number): void {
        const root = this._root;
        const target = shark?.target ?? null;
        const state = shark?.state ?? SharkState.INACTIVE;
        const active = !!target && (state === SharkState.WARNING || state === SharkState.HUNT);
        if (!root?.isValid || !active || !target?.node.activeInHierarchy || !shark?.node.activeInHierarchy) {
            this.hide();
            return;
        }

        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        this._elapsed += step;
        this._clock += step;
        if (this._elapsed < UPDATE_INTERVAL) return;
        this._elapsed = 0;

        if (!root.active) root.active = true;
        if (state !== this._lastState) this.applyState(state);
        target.node.getWorldPosition(this._targetWorld);
        shark.node.getWorldPosition(this._sharkWorld);
        this.updateTrail(state);
    }

    hide(): void {
        if (this._root?.active) this._root.active = false;
        this._lastState = SharkState.INACTIVE;
        this._elapsed = UPDATE_INTERVAL;
    }

    dispose(): void {
        if (this._disposed) return;
        this._disposed = true;
        if (this._root?.isValid) this._root.destroy();
        this._root = null;
        this._trails.length = 0;
        this._trailMesh?.destroy();
        this._trailMaterial?.destroy();
        this._trailMesh = null;
        this._trailMaterial = null;
    }

    private applyState(state: SharkState): void {
        this._lastState = state;
        this._trailMaterial?.setProperty(
            'mainColor',
            state === SharkState.HUNT ? HUNT_ARROW_COLOR : WARNING_ARROW_COLOR,
        );
        for (let i = 0; i < this._trails.length; i++) {
            const trail = this._trails[i];
            if (!trail.active) trail.active = true;
        }
    }

    private updateTrail(state: SharkState): void {
        const hunting = state === SharkState.HUNT;
        const dx = this._targetWorld.x - this._sharkWorld.x;
        const dz = this._targetWorld.z - this._sharkWorld.z;
        const lengthSq = dx * dx + dz * dz;
        if (lengthSq <= 3.24) {
            for (let i = 0; i < this._trails.length; i++) {
                const trail = this._trails[i];
                if (trail.active) trail.active = false;
            }
            return;
        }
        const length = Math.sqrt(lengthSq);
        const directionX = dx / length;
        const directionZ = dz / length;
        const pathLength = Math.max(0.1, length - 1.6);
        const yaw = Math.atan2(-directionZ, directionX) * RADIANS_TO_DEGREES;
        const speed = hunting ? 0.82 : 0.38;
        const spacing = hunting ? 0.22 : 1 / this._trails.length;
        for (let i = 0; i < this._trails.length; i++) {
            const trail = this._trails[i];
            if (!trail.active) trail.active = true;
            const phase = (this._clock * speed + i * spacing) % 1;
            const travel = 0.8 + pathLength * phase;
            trail.setWorldPosition(
                this._sharkWorld.x + directionX * travel,
                this._waterY + WATER_SURFACE_OFFSET * 0.78,
                this._sharkWorld.z + directionZ * travel,
            );
            trail.setRotationFromEuler(0, yaw, 0);
            const scale = (hunting ? 0.62 : 0.52) + phase * (hunting ? 0.38 : 0.22);
            trail.setScale(scale, 1, scale);
        }
    }

    private makeMeshNode(name: string, mesh: Mesh, material: Material, parent: Node, layer: number): Node {
        const node = new Node(name);
        node.setParent(parent);
        node.layer = layer;
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = mesh;
        renderer.setMaterial(material, 0);
        return node;
    }
}

function makeTransparentMaterial(name: string, color: Color): Material {
    const material = new Material();
    material.initialize({
        effectName: 'builtin-unlit',
        technique: 1,
        defines: { USE_COLOR: true },
        states: {
            rasterizerState: { cullMode: gfx.CullMode.NONE },
            depthStencilState: { depthTest: true, depthWrite: false },
        },
    });
    material.name = name;
    material.setProperty('mainColor', color);
    return material;
}

/** 朝 +X 的双翼水纹，三份实例沿鲨鱼到目标的路径循环推进。 */
function buildHuntRippleGeometry(): primitives.IGeometry {
    const positions = [
        -0.58, 0, -0.48, 0.46, 0, -0.09, 0.30, 0, -0.02, -0.62, 0, -0.32,
        -0.58, 0, 0.48, -0.62, 0, 0.32, 0.30, 0, 0.02, 0.46, 0, 0.09,
    ];
    const indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    return {
        positions,
        indices,
        minPos: new Vec3(-0.64, -0.01, -0.5),
        maxPos: new Vec3(0.48, 0.01, 0.5),
    };
}
