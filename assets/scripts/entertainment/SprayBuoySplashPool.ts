import type { FloatingItemLayers } from './FloatingItemRenderer';
import { Color, gfx, Material, Mesh, MeshRenderer, Node, Vec3 } from 'cc';

export const ENTERTAINMENT_SPLASH_PROFILE = {
    HEAVY_ENTRY: 'heavy-entry',
    EXPLOSION: 'explosion',
} as const;

export type EntertainmentSplashProfile = typeof ENTERTAINMENT_SPLASH_PROFILE[keyof typeof ENTERTAINMENT_SPLASH_PROFILE];

export const ENTERTAINMENT_SPLASH_OWNER = {
    MINEFIELD: 'minefield',
    CANNON: 'cannon',
    TIMED_BOMB: 'timed-bomb',
} as const;

export type EntertainmentSplashOwner = typeof ENTERTAINMENT_SPLASH_OWNER[keyof typeof ENTERTAINMENT_SPLASH_OWNER];

export type EntertainmentSplashRequest = {
    owner: EntertainmentSplashOwner;
    profile: EntertainmentSplashProfile;
    position: Readonly<Vec3>;
    yawDegrees?: number;
    intensity?: number;
    duration?: number;
    radialScale?: number;
    verticalScale?: number;
    layer?: number;
    rippleOnly?: boolean;
    /** 道具实际世界位置的局部碎水喷散；水面水冠仍固定在 position。兼容旧字段名。 */
    explosionCorePosition?: Readonly<Vec3>;
};

type SplashSlot = {
    root: Node;
    body: Node;
    ring: Node | null;
    explosionCore: Node | null;
    profile: EntertainmentSplashProfile;
    owner: EntertainmentSplashOwner | null;
    remaining: number;
    duration: number;
    intensity: number;
    radialScale: number;
    verticalScale: number;
    rippleOnly: boolean;
    explosionCoreActive: boolean;
    /** 本次触发前已累计的采样时间，避免新效果被提前扣时。 */
    pendingTime: number;
    bodyRadialBias: number;
    bodyVerticalBias: number;
    coreRadialBias: number;
    coreVerticalBias: number;
};

const PRESENTATION_INTERVAL = 1 / 20;
const HEAVY_POOL_SIZE = 3;
const EXPLOSION_POOL_SIZE = 3;
const HEAVY_DEFAULT_SECONDS = 0.56;
const EXPLOSION_DEFAULT_SECONDS = 0.95;
const EXPLOSION_BODY_END_PHASE = 0.62;
const EXPLOSION_CORE_END_PHASE = 0.32;

/**
 * 喷雾浮标的低模水花池。节点和材质只创建一次；比赛中只消费既有视觉事件，
 * 以 20Hz 修改固定节点的显隐和变换，不参与命中、拾取或网络判定。
 */
export class SprayBuoySplashPool {
    private readonly slots: SplashSlot[] = [];
    private readonly roots: Node[] = [];
    private readonly releases: (() => void)[] = [];
    private readonly heavyBodyMesh: Mesh;
    private readonly explosionBodyMesh: Mesh;
    private readonly heavyRingMesh: Mesh;
    private readonly explosionRingMesh: Mesh;
    private readonly explosionCoreMesh: Mesh;
    private readonly material: Material;
    private elapsed = PRESENTATION_INTERVAL;
    private activeCount = 0;
    private disposed = false;

    constructor(private readonly worldRoot: Node, meshes: readonly Mesh[], private readonly layers: FloatingItemLayers | null,
        heavyCount = HEAVY_POOL_SIZE, explosionCount = EXPLOSION_POOL_SIZE) {
        this.heavyBodyMesh = meshes[0]; this.heavyRingMesh = meshes[1];
        this.explosionBodyMesh = meshes[2]; this.explosionRingMesh = meshes[3]; this.explosionCoreMesh = meshes[4];
        this.material = makeWaterSplashMaterial();
        try {
        this.buildSlots(ENTERTAINMENT_SPLASH_PROFILE.HEAVY_ENTRY, heavyCount, this.heavyBodyMesh, this.heavyRingMesh);
        this.buildSlots(ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION, explosionCount, this.explosionBodyMesh, this.explosionRingMesh);
        } catch (error) { this.dispose(); throw error; }
    }

    play(request: EntertainmentSplashRequest): void {
        if (this.disposed || !this.worldRoot?.isValid || !request.position) return;
        const slot = this.acquire(request.profile);
        if (!slot) return;
        slot.owner = request.owner;
        slot.duration = Math.max(0.05, request.duration ?? defaultDuration(request.profile));
        slot.remaining = slot.duration;
        slot.pendingTime = this.activeCount > 0 ? this.elapsed : 0;
        slot.intensity = Math.max(0, request.intensity ?? 1);
        slot.radialScale = Math.max(0, request.radialScale ?? 1);
        slot.verticalScale = Math.max(0, request.verticalScale ?? 1);
        slot.rippleOnly = !!request.rippleOnly;
        slot.explosionCoreActive = slot.profile === ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION
            && !slot.rippleOnly && !!request.explosionCorePosition;
        // 共用基线只做小幅轮廓差异；调用方强度、缩放和时长仍完整相乘。
        slot.bodyRadialBias = request.owner === ENTERTAINMENT_SPLASH_OWNER.CANNON ? 1.08 : 1;
        slot.bodyVerticalBias = request.owner === ENTERTAINMENT_SPLASH_OWNER.MINEFIELD ? 1.14 : 1;
        slot.coreRadialBias = 1;
        slot.coreVerticalBias = request.owner === ENTERTAINMENT_SPLASH_OWNER.MINEFIELD ? 1.12 : 1;
        slot.root.setWorldPosition(request.position.x, request.position.y, request.position.z);
        slot.root.setRotationFromEuler(0, request.yawDegrees ?? 0, 0);
        this.setLayer(slot, request.layer ?? this.worldRoot.layer);
        // 槽位复用时还原上一轮末段的沉降，不能把下一次水花留在水下。
        if (slot.body.position.y !== 0) slot.body.setPosition(0, 0, 0);
        if (slot.ring && slot.ring.position.y !== 0) slot.ring.setPosition(0, 0, 0);
        if (slot.explosionCore) {
            if (slot.explosionCoreActive) {
                slot.explosionCore.setWorldPosition(request.explosionCorePosition!);
            }
            if (slot.explosionCore.active !== slot.explosionCoreActive) {
                slot.explosionCore.active = slot.explosionCoreActive;
            }
        }
        if (slot.body.active === slot.rippleOnly) slot.body.active = !slot.rippleOnly;
        if (slot.ring && !slot.ring.active) slot.ring.active = true;
        if (!slot.root.active) {
            if (this.activeCount <= 0) this.elapsed = 0;
            slot.root.active = true;
            this.activeCount++;
        }
        this.applyPhase(slot, 0);
    }

    update(dt: number): void {
        if (this.disposed || this.activeCount <= 0) return;
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        this.elapsed += step;
        if (this.elapsed < PRESENTATION_INTERVAL) return;
        const presentationStep = this.elapsed;
        this.elapsed = 0;
        for (let index = 0; index < this.slots.length; index++) {
            const slot = this.slots[index];
            if (slot.remaining <= 0) continue;
            slot.remaining = Math.max(0, slot.remaining - Math.max(0, presentationStep - slot.pendingTime));
            slot.pendingTime = 0;
            this.applyPhase(slot, 1 - slot.remaining / slot.duration);
            if (slot.remaining <= 0) this.deactivate(slot);
        }
    }

    cancelOwner(owner: EntertainmentSplashOwner): void {
        if (this.disposed) return;
        for (let index = 0; index < this.slots.length; index++) {
            const slot = this.slots[index];
            if (slot.owner === owner) this.deactivate(slot);
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
        for (const release of this.releases) release();
        for (const root of this.roots) if (root.isValid) root.destroy();
        this.slots.length = this.roots.length = this.releases.length = 0;
        this.activeCount = 0;
        // 共享 GLB 网格由 race Bundle 持有，不销毁。
        this.material.destroy();
    }

    private buildSlots(
        profile: EntertainmentSplashProfile,
        count: number,
        bodyMesh: Mesh,
        ringMesh: Mesh | null,
    ): void {
        for (let index = 0; index < count; index++) {
            const root = new Node(`EntertainmentSplash_${profile}_${index}`);
            this.roots.push(root);
            root.setParent(this.worldRoot);
            root.layer = this.worldRoot.layer;
            const body = this.makeRendererNode('Body', root, bodyMesh);
            const ring = ringMesh ? this.makeRendererNode('Ring', root, ringMesh) : null;
            const explosionCore = profile === ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION
                ? this.makeRendererNode('LocalWaterBurst', root, this.explosionCoreMesh)
                : null;
            if (explosionCore) explosionCore.active = false;
            const release = this.layers?.registerFloatingObject(root);
            if (release) this.releases.push(release);
            root.active = false;
            this.slots.push({
                root,
                body,
                ring,
                explosionCore,
                profile,
                owner: null,
                remaining: 0,
                duration: defaultDuration(profile),
                intensity: 1,
                radialScale: 1,
                verticalScale: 1,
                rippleOnly: false,
                explosionCoreActive: false,
                pendingTime: 0,
                bodyRadialBias: 1,
                bodyVerticalBias: 1,
                coreRadialBias: 1,
                coreVerticalBias: 1,
            });
        }
    }

    private makeRendererNode(name: string, parent: Node, mesh: Mesh): Node {
        const node = new Node(name);
        node.setParent(parent);
        node.layer = parent.layer;
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = mesh;
        renderer.setMaterial(this.material, 0);
        return node;
    }

    private acquire(profile: EntertainmentSplashProfile): SplashSlot | null {
        let candidate: SplashSlot | null = null;
        for (let index = 0; index < this.slots.length; index++) {
            const slot = this.slots[index];
            if (slot.profile !== profile) continue;
            if (slot.remaining <= 0) return slot;
            if (!candidate || slot.remaining < candidate.remaining) candidate = slot;
        }
        if (candidate) this.deactivate(candidate);
        return candidate;
    }

    private applyPhase(slot: SplashSlot, progress: number): void {
        const phase = clamp01(progress);
        const expand = 1 - Math.pow(1 - phase, 3);
        const crest = Math.sin(phase * Math.PI);
        const bodyPhase = slot.profile === ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION
            ? clamp01(phase / EXPLOSION_BODY_END_PHASE)
            : phase;
        const bodyExpand = 1 - Math.pow(1 - bodyPhase, 3);
        const bodyCrest = Math.sin(bodyPhase * Math.PI);
        const bodyRadial = slot.profile === ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION
            ? 0.2 + bodyExpand * 1.42
            : 0.24 + expand * 1.04;
        const bodyVertical = slot.profile === ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION
            ? 0.08 + bodyCrest * 1.16
            : 0.18 + crest * 1.05;
        const bodyFinished = slot.profile === ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION
            && phase >= EXPLOSION_BODY_END_PHASE;
        if (bodyFinished) {
            if (slot.body.active) slot.body.active = false;
        } else if (!slot.rippleOnly) {
            if (!slot.body.active) slot.body.active = true;
            slot.body.setScale(
                bodyRadial * slot.intensity * slot.radialScale * (slot.profile === ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION ? slot.bodyRadialBias : 1),
                bodyVertical * slot.intensity * slot.verticalScale * (slot.profile === ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION ? slot.bodyVerticalBias : 1),
                bodyRadial * slot.intensity * slot.radialScale * (slot.profile === ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION ? slot.bodyRadialBias : 1),
            );
            if (slot.profile === ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION) {
                const sink = -0.16 * clamp01((bodyPhase - 0.65) / 0.35);
                if (slot.body.position.y !== sink) slot.body.setPosition(0, sink, 0);
            }
        }
        if (!slot.ring) return;
        const ringPhase = clamp01((phase - 0.06) / 0.86);
        const ringExpand = 1 - Math.pow(1 - ringPhase, 2);
        const ringScale = (
            slot.profile === ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION
                ? 0.18 + ringExpand * 1.54
                : 0.2 + ringExpand * 1.18
        ) * slot.intensity * slot.radialScale;
        const ringHeightScale = phase < 0.14
            ? 0.38 + phase / 0.14 * 0.62
            : phase < 0.72
                ? 1
                : 1 - (phase - 0.72) / 0.28 * 0.82;
        slot.ring.setScale(ringScale, Math.max(0.18, ringHeightScale), ringScale);
        if (slot.profile === ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION) {
            const sink = -0.065 * clamp01((phase - 0.68) / 0.32);
            if (slot.ring.position.y !== sink) slot.ring.setPosition(0, sink, 0);
        }
        if (slot.explosionCore && slot.explosionCoreActive) {
            const corePhase = clamp01(phase / EXPLOSION_CORE_END_PHASE);
            if (corePhase >= 1) {
                if (slot.explosionCore.active) slot.explosionCore.active = false;
            } else {
                if (!slot.explosionCore.active) slot.explosionCore.active = true;
                const coreExpand = 1 - Math.pow(1 - corePhase, 3);
                const coreScale = (0.16 + coreExpand * 1.1) * slot.intensity * slot.radialScale * slot.coreRadialBias;
                const coreVertical = (0.12 + Math.sin(corePhase * Math.PI) * 0.92)
                    * slot.intensity * slot.verticalScale * slot.coreVerticalBias;
                slot.explosionCore.setScale(coreScale, coreVertical, coreScale);
            }
        }
    }

    private setLayer(slot: SplashSlot, layer: number): void {
        if (slot.root.layer !== layer) slot.root.layer = layer;
        if (slot.body.layer !== layer) slot.body.layer = layer;
        if (slot.ring && slot.ring.layer !== layer) slot.ring.layer = layer;
        if (slot.explosionCore && slot.explosionCore.layer !== layer) slot.explosionCore.layer = layer;
    }

    private deactivate(slot: SplashSlot): void {
        slot.owner = null;
        slot.remaining = 0;
        slot.rippleOnly = false;
        slot.explosionCoreActive = false;
        slot.pendingTime = 0;
        if (!slot.body.active) slot.body.active = true;
        if (slot.ring && !slot.ring.active) slot.ring.active = true;
        if (slot.explosionCore?.active) slot.explosionCore.active = false;
        if (slot.root.active) {
            slot.root.active = false;
            this.activeCount = Math.max(0, this.activeCount - 1);
        }
    }
}

function defaultDuration(profile: EntertainmentSplashProfile): number {
    if (profile === ENTERTAINMENT_SPLASH_PROFILE.HEAVY_ENTRY) return HEAVY_DEFAULT_SECONDS;
    return EXPLOSION_DEFAULT_SECONDS;
}

function makeWaterSplashMaterial(): Material {
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
    material.name = 'EntertainmentWaterSplashMaterial';
    material.setProperty('mainColor', Color.WHITE);
    return material;
}


function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
