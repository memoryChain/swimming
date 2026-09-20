import { Color, gfx, Material, Mesh, MeshRenderer, Node, primitives, utils, Vec3 } from 'cc';
import {
    COLLISION_SPLASH_MODE,
    COLLISION_SPLASH_TIER,
    CollisionSplashMode,
    collisionSplashTierForImpact,
    collisionSplashVisualScale,
    collisionSplashYawRadians,
} from './CollisionSplashRules';

type CollisionSplashSlot = {
    root: Node;
    impactNode: Node;
    residualNode: Node;
    impactRenderer: MeshRenderer;
    remaining: number;
    duration: number;
    elapsed: number;
    impactEnd: number;
    residualStart: number;
    secondaryMesh: Mesh;
    secondaryStarted: boolean;
    residualStarted: boolean;
    tangentScale: number;
    normalScale: number;
    verticalScale: number;
    residualScale: number;
};

type ColorTuple = readonly [number, number, number, number];

const POOL_SIZE = 4;
const PRESENTATION_INTERVAL = 1 / 20;
const MEDIUM_SECONDS = 0.34;
const STRONG_SECONDS = 0.46;
const ENTERTAINMENT_HOLD_SECONDS = 0.04;
const COMPRESSION_SECONDS = 0.08;
const MEDIUM_IMPACT_END = 0.2;
const STRONG_IMPACT_END = 0.28;
const MEDIUM_RESIDUAL_START = 0.15;
const STRONG_RESIDUAL_START = 0.22;
const WATER_SURFACE_OFFSET = 0.035;
const RAD2DEG = 180 / Math.PI;

/**
 * 玩家身体碰撞专用的低模水花池。每槽预建主体与余波两个渲染节点，
 * 共享四份阶段网格和一份材质；它只消费碰撞结果，不参与玩法判定。
 */
export class SwimmerCollisionSplashPool {
    private readonly slots: CollisionSplashSlot[] = [];
    private readonly compressionMesh: Mesh;
    private readonly shearMesh: Mesh;
    private readonly strongMesh: Mesh;
    private readonly residualMesh: Mesh;
    private readonly material: Material;
    private elapsed = PRESENTATION_INTERVAL;
    private activeCount = 0;
    private disposed = false;

    constructor(
        private readonly worldRoot: Node,
        private readonly waterY: number,
        private readonly layer: number,
        private readonly mode: CollisionSplashMode,
    ) {
        const entertainmentAccent = this.mode === COLLISION_SPLASH_MODE.ENTERTAINMENT;
        const alphaScale = entertainmentAccent ? 1.08 : 1;
        this.compressionMesh = utils.createMesh(buildCompressionGeometry(alphaScale));
        this.shearMesh = utils.createMesh(buildSurfaceShearGeometry(alphaScale));
        this.strongMesh = utils.createMesh(buildStrongImpactGeometry(entertainmentAccent, alphaScale));
        this.residualMesh = utils.createMesh(buildResidualGeometry(alphaScale));
        this.material = makeCollisionSplashMaterial();
        for (let index = 0; index < POOL_SIZE; index++) {
            const root = new Node(`SwimmerCollisionSplash_${index}`);
            root.setParent(this.worldRoot);
            root.layer = this.layer;
            const impactNode = new Node(`SwimmerCollisionSplash_${index}_Impact`);
            impactNode.setParent(root);
            impactNode.layer = this.layer;
            const impactRenderer = impactNode.addComponent(MeshRenderer);
            impactRenderer.mesh = this.compressionMesh;
            impactRenderer.setMaterial(this.material, 0);
            const residualNode = new Node(`SwimmerCollisionSplash_${index}_Residual`);
            residualNode.setParent(root);
            residualNode.layer = this.layer;
            const residualRenderer = residualNode.addComponent(MeshRenderer);
            residualRenderer.mesh = this.residualMesh;
            residualRenderer.setMaterial(this.material, 0);
            residualNode.active = false;
            root.active = false;
            this.slots.push({
                root,
                impactNode,
                residualNode,
                impactRenderer,
                remaining: 0,
                duration: MEDIUM_SECONDS,
                elapsed: 0,
                impactEnd: MEDIUM_IMPACT_END,
                residualStart: MEDIUM_RESIDUAL_START,
                secondaryMesh: this.shearMesh,
                secondaryStarted: false,
                residualStarted: false,
                tangentScale: 1,
                normalScale: 1,
                verticalScale: 1,
                residualScale: 1,
            });
        }
    }

    play(
        worldX: number,
        worldZ: number,
        normalX: number,
        normalZ: number,
        flowX: number,
        flowZ: number,
        tangentialSpeed: number,
        magnitude: number,
    ): boolean {
        if (this.disposed || !this.worldRoot?.isValid) return false;
        const tier = collisionSplashTierForImpact(magnitude, this.mode);
        if (tier === COLLISION_SPLASH_TIER.NONE) return false;
        const slot = this.acquire();
        if (!slot) return false;
        const visualScale = collisionSplashVisualScale(magnitude, this.mode, tier);
        slot.duration = (tier === COLLISION_SPLASH_TIER.STRONG ? STRONG_SECONDS : MEDIUM_SECONDS)
            + (this.mode === COLLISION_SPLASH_MODE.ENTERTAINMENT ? ENTERTAINMENT_HOLD_SECONDS : 0);
        slot.remaining = slot.duration;
        slot.elapsed = 0;
        const slideBlend = clamp01(tangentialSpeed / 4);
        slot.impactEnd = tier === COLLISION_SPLASH_TIER.STRONG
            ? STRONG_IMPACT_END : MEDIUM_IMPACT_END;
        slot.residualStart = tier === COLLISION_SPLASH_TIER.STRONG
            ? STRONG_RESIDUAL_START : MEDIUM_RESIDUAL_START;
        // 强侧擦仍使用贴着水面的切痕；只有正撞、追尾和斜撞才抬起完整水片。
        slot.secondaryMesh = tier === COLLISION_SPLASH_TIER.STRONG && slideBlend < 0.68
            ? this.strongMesh : this.shearMesh;
        slot.secondaryStarted = false;
        slot.residualStarted = false;
        slot.tangentScale = visualScale * (1 + slideBlend * 0.04);
        slot.normalScale = visualScale * (1 - slideBlend * 0.16);
        slot.verticalScale = visualScale
            * (tier === COLLISION_SPLASH_TIER.STRONG ? 1 : 0.82)
            * (1 - slideBlend * 0.42);
        slot.residualScale = visualScale
            * (tier === COLLISION_SPLASH_TIER.STRONG ? 1 : 0.82)
            * (1 + slideBlend * 0.06);
        slot.root.setWorldPosition(worldX, this.waterY + WATER_SURFACE_OFFSET, worldZ);
        // local +Z 沿两人中心连线，local +X 是被挤出的切线方向。若双方有共同
        // 前进速度，让略强的一侧尽量落在后方；无明确流向时使用世界轴规范化，
        // 避免交换泳者遍历顺序后整片水花翻转。
        slot.root.setRotationFromEuler(
            0,
            collisionSplashYawRadians(normalX, normalZ, flowX, flowZ) * RAD2DEG,
            0,
        );
        if (slot.root.layer !== this.layer) slot.root.layer = this.layer;
        if (slot.impactNode.layer !== this.layer) slot.impactNode.layer = this.layer;
        if (slot.residualNode.layer !== this.layer) slot.residualNode.layer = this.layer;
        if (slot.impactRenderer.mesh !== this.compressionMesh) {
            slot.impactRenderer.mesh = this.compressionMesh;
        }
        if (!slot.impactNode.active) slot.impactNode.active = true;
        if (slot.residualNode.active) slot.residualNode.active = false;
        if (!slot.root.active) {
            if (this.activeCount <= 0) this.elapsed = 0;
            slot.root.active = true;
            this.activeCount++;
        }
        this.applyPhase(slot);
        return true;
    }

    update(dt: number): void {
        if (this.disposed || this.activeCount <= 0) return;
        this.elapsed += Number.isFinite(dt) ? Math.max(0, dt) : 0;
        if (this.elapsed < PRESENTATION_INTERVAL) return;
        const presentationStep = this.elapsed;
        this.elapsed = 0;
        for (let index = 0; index < this.slots.length; index++) {
            const slot = this.slots[index];
            if (slot.remaining <= 0) continue;
            slot.remaining = Math.max(0, slot.remaining - presentationStep);
            slot.elapsed = slot.duration - slot.remaining;
            this.applyPhase(slot);
            if (slot.remaining <= 0) this.deactivate(slot);
        }
    }

    reset(): void {
        if (this.disposed) return;
        this.elapsed = PRESENTATION_INTERVAL;
        for (let index = 0; index < this.slots.length; index++) this.deactivate(this.slots[index]);
        this.activeCount = 0;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (let index = 0; index < this.slots.length; index++) {
            const slot = this.slots[index];
            if (slot.root.isValid) slot.root.destroy();
        }
        this.slots.length = 0;
        this.activeCount = 0;
        this.compressionMesh.destroy();
        this.shearMesh.destroy();
        this.strongMesh.destroy();
        this.residualMesh.destroy();
        this.material.destroy();
    }

    private acquire(): CollisionSplashSlot | null {
        let candidate: CollisionSplashSlot | null = null;
        for (let index = 0; index < this.slots.length; index++) {
            const slot = this.slots[index];
            if (slot.remaining <= 0) return slot;
            if (!candidate || slot.remaining < candidate.remaining) candidate = slot;
        }
        if (candidate) this.deactivate(candidate);
        return candidate;
    }

    private applyPhase(slot: CollisionSplashSlot): void {
        const elapsed = slot.elapsed;
        if (elapsed < COMPRESSION_SECONDS) {
            const phase = clamp01(elapsed / COMPRESSION_SECONDS);
            const expand = 1 - Math.pow(1 - phase, 2);
            slot.impactNode.setScale(
                (0.48 + expand * 0.52) * slot.tangentScale,
                (0.22 + Math.sin(phase * Math.PI) * 0.78) * slot.verticalScale,
                (0.58 + expand * 0.32) * slot.normalScale,
            );
        } else if (elapsed < slot.impactEnd) {
            if (!slot.secondaryStarted) {
                slot.secondaryStarted = true;
                slot.impactRenderer.mesh = slot.secondaryMesh;
            }
            const phase = clamp01(
                (elapsed - COMPRESSION_SECONDS) / (slot.impactEnd - COMPRESSION_SECONDS),
            );
            const expand = 1 - Math.pow(1 - phase, 3);
            slot.impactNode.setScale(
                (0.5 + expand * 0.52) * slot.tangentScale,
                Math.max(0.08, (0.16 + Math.sin(phase * Math.PI) * 0.84) * slot.verticalScale),
                (0.66 + expand * 0.34) * slot.normalScale,
            );
        } else if (slot.impactNode.active) {
            slot.impactNode.active = false;
        }

        if (elapsed >= slot.residualStart) {
            if (!slot.residualStarted) {
                slot.residualStarted = true;
                slot.residualNode.active = true;
            }
            const duration = Math.max(0.001, slot.duration - slot.residualStart);
            const phase = clamp01((elapsed - slot.residualStart) / duration);
            const expand = 1 - Math.pow(1 - phase, 3);
            slot.residualNode.setScale(
                (0.58 + expand * 0.58) * slot.residualScale,
                Math.max(0.14, 0.72 - phase * 0.56),
                (0.72 + expand * 0.34) * slot.residualScale,
            );
        }
    }

    private deactivate(slot: CollisionSplashSlot): void {
        slot.remaining = 0;
        slot.elapsed = 0;
        slot.secondaryStarted = false;
        slot.residualStarted = false;
        if (!slot.impactNode.active) slot.impactNode.active = true;
        if (slot.residualNode.active) slot.residualNode.active = false;
        if (slot.root.active) {
            slot.root.active = false;
            this.activeCount = Math.max(0, this.activeCount - 1);
        }
    }
}

function makeCollisionSplashMaterial(): Material {
    const material = new Material();
    material.initialize({
        effectName: 'builtin-unlit',
        technique: 1,
        defines: { USE_VERTEX_COLOR: true },
        states: {
            rasterizerState: { cullMode: gfx.CullMode.NONE },
            depthStencilState: { depthTest: true, depthWrite: false },
        },
    });
    material.name = 'SwimmerCollisionSplashMaterial';
    material.setProperty('mainColor', Color.WHITE);
    return material;
}

function buildCompressionGeometry(alphaScale: number): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    appendCentralSqueezeSeam(positions, colors, indices, alphaScale);
    return geometry(positions, colors, indices, new Vec3(-0.25, 0, -0.06), new Vec3(0.25, 0.21, 0.06));
}

function buildSurfaceShearGeometry(alphaScale: number): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    appendSurfaceShear(positions, colors, indices, 1, 1, alphaScale);
    appendSurfaceShear(positions, colors, indices, -1, 0.82, alphaScale);
    return geometry(positions, colors, indices, new Vec3(-0.48, 0, -0.13), new Vec3(0.58, 0.08, 0.13));
}

function buildStrongImpactGeometry(
    entertainmentAccent: boolean,
    alphaScale: number,
): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    appendCentralSqueezeSeam(positions, colors, indices, alphaScale);
    appendLateralSheet(positions, colors, indices, 1, 1, alphaScale);
    appendLateralSheet(positions, colors, indices, -1, 0.86, alphaScale);
    appendDroplet(positions, colors, indices, 0.42, 0.36, -0.035, 0.044, alphaScale);
    appendDroplet(positions, colors, indices, -0.35, 0.29, 0.045, 0.038, alphaScale);
    if (entertainmentAccent) {
        appendDroplet(positions, colors, indices, 0.24, 0.3, 0.13, 0.032, alphaScale);
    }
    return geometry(positions, colors, indices, new Vec3(-0.6, 0, -0.34), new Vec3(0.64, 0.45, 0.34));
}

function buildResidualGeometry(alphaScale: number): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    appendCrescentWave(positions, colors, indices, 1, alphaScale);
    appendCrescentWave(positions, colors, indices, -1, alphaScale);
    return geometry(positions, colors, indices, new Vec3(-0.6, 0, -0.31), new Vec3(0.6, 0.07, 0.31));
}

function appendCrescentWave(
    positions: number[], colors: number[], indices: number[], direction: number, alphaScale: number,
): void {
    const segments = 3;
    const centre = direction > 0 ? 0 : Math.PI;
    const halfArc = 0.48;
    const innerColor: ColorTuple = [0.24, 0.72, 0.95, 0.12];
    const crestColor: ColorTuple = [0.9, 0.99, 1, 0.66];
    const outerColor: ColorTuple = [0.18, 0.64, 0.91, 0.015];
    for (let segment = 0; segment < segments; segment++) {
        const a0 = centre - halfArc + segment / segments * halfArc * 2;
        const a1 = centre - halfArc + (segment + 1) / segments * halfArc * 2;
        const base = positions.length / 3;
        pushCrescentWaveStation(positions, colors, a0, innerColor, crestColor, outerColor, alphaScale);
        pushCrescentWaveStation(positions, colors, a1, innerColor, crestColor, outerColor, alphaScale);
        indices.push(
            base, base + 3, base + 1,
            base + 1, base + 3, base + 4,
            base + 1, base + 4, base + 2,
            base + 2, base + 4, base + 5,
        );
    }
}

function pushCrescentWaveStation(
    positions: number[], colors: number[], angle: number,
    innerColor: ColorTuple, crestColor: ColorTuple, outerColor: ColorTuple,
    alphaScale: number,
): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    positions.push(
        cos * 0.32, 0.01, sin * 0.16,
        cos * 0.48, 0.065, sin * 0.24,
        cos * 0.6, 0.012, sin * 0.31,
    );
    pushColor(colors, innerColor, 1, alphaScale);
    pushColor(colors, crestColor, 1, alphaScale);
    pushColor(colors, outerColor, 1, alphaScale);
}

function appendCentralSqueezeSeam(
    positions: number[], colors: number[], indices: number[], alphaScale: number,
): void {
    const base = positions.length / 3;
    positions.push(
        -0.24, 0.02, -0.045,
        0.24, 0.02, -0.045,
        -0.17, 0.2, 0,
        0.17, 0.2, 0,
        -0.21, 0.02, 0.055,
        0.21, 0.02, 0.055,
    );
    pushColor(colors, [0.1, 0.64, 0.9, 0.7], 2, alphaScale);
    pushColor(colors, [0.86, 0.98, 1, 0.7], 2, alphaScale);
    pushColor(colors, [0.12, 0.62, 0.88, 0.42], 2, alphaScale);
    indices.push(
        base, base + 1, base + 2,
        base + 2, base + 1, base + 3,
        base + 2, base + 3, base + 4,
        base + 4, base + 3, base + 5,
    );
}

function appendSurfaceShear(
    positions: number[], colors: number[], indices: number[],
    direction: number, strength: number, alphaScale: number,
): void {
    const base = positions.length / 3;
    const midX = direction * 0.25 * strength;
    const tipX = direction * 0.58 * strength;
    positions.push(
        direction * 0.02, 0.012, -0.075,
        direction * 0.02, 0.012, 0.075,
        midX, 0.072 * strength, -0.12,
        midX, 0.072 * strength, 0.12,
        tipX, 0.02, -0.065,
        tipX, 0.02, 0.065,
    );
    pushColor(colors, [0.12, 0.66, 0.9, 0.58], 2, alphaScale);
    pushColor(colors, [0.86, 0.98, 1, 0.7], 2, alphaScale);
    pushColor(colors, [0.34, 0.78, 0.94, 0.025], 2, alphaScale);
    indices.push(
        base, base + 1, base + 2,
        base + 2, base + 1, base + 3,
        base + 2, base + 3, base + 4,
        base + 4, base + 3, base + 5,
    );
}

function appendLateralSheet(
    positions: number[], colors: number[], indices: number[],
    direction: number, strength: number, alphaScale: number,
): void {
    const base = positions.length / 3;
    const baseColor: ColorTuple = [0.08, 0.62, 0.9, 0.76];
    const crestColor: ColorTuple = [0.65, 0.94, 1, 0.64];
    const tipColor: ColorTuple = [0.96, 1, 1, 0.035];
    const midX = direction * 0.29 * strength;
    const tipX = direction * 0.6 * strength;
    positions.push(
        direction * 0.04, 0.025, -0.16,
        direction * 0.04, 0.025, 0.16,
        midX, 0.31 * strength, -0.125,
        midX, 0.31 * strength, 0.125,
        tipX, 0.16 * strength, -0.055,
        tipX, 0.16 * strength, 0.055,
    );
    pushColor(colors, baseColor, 2, alphaScale);
    pushColor(colors, crestColor, 2, alphaScale);
    pushColor(colors, tipColor, 2, alphaScale);
    indices.push(
        base, base + 1, base + 2,
        base + 2, base + 1, base + 3,
        base + 2, base + 3, base + 4,
        base + 4, base + 3, base + 5,
    );
}

function appendDroplet(
    positions: number[], colors: number[], indices: number[],
    x: number, y: number, z: number, radius: number, alphaScale: number,
): void {
    const base = positions.length / 3;
    positions.push(
        x + radius, y, z,
        x - radius, y, z,
        x, y + radius * 1.35, z,
        x, y - radius * 1.35, z,
        x, y, z + radius,
        x, y, z - radius,
    );
    pushColor(colors, [0.68, 0.95, 1, 0.62], 6, alphaScale);
    const faces = [0, 2, 4, 4, 2, 1, 1, 2, 5, 5, 2, 0, 4, 3, 0, 1, 3, 4, 5, 3, 1, 0, 3, 5];
    for (let index = 0; index < faces.length; index++) indices.push(base + faces[index]);
}

function geometry(
    positions: number[], colors: number[], indices: number[], minPos: Vec3, maxPos: Vec3,
): primitives.IGeometry {
    return { positions, colors, indices, primitiveMode: gfx.PrimitiveMode.TRIANGLE_LIST, minPos, maxPos };
}

function pushColor(colors: number[], color: ColorTuple, count: number, alphaScale = 1): void {
    const alpha = Math.min(1, color[3] * alphaScale);
    for (let index = 0; index < count; index++) colors.push(color[0], color[1], color[2], alpha);
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
