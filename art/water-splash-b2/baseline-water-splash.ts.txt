import { Color, gfx, Material, Mesh, MeshRenderer, Node, primitives, utils, Vec3 } from 'cc';

export const ENTERTAINMENT_SPLASH_PROFILE = {
    LIGHT_ENTRY: 'light-entry',
    HEAVY_ENTRY: 'heavy-entry',
    EXPLOSION: 'explosion',
} as const;

export type EntertainmentSplashProfile = typeof ENTERTAINMENT_SPLASH_PROFILE[keyof typeof ENTERTAINMENT_SPLASH_PROFILE];

export const ENTERTAINMENT_SPLASH_OWNER = {
    STIMULANT: 'stimulant',
    LITTER: 'litter',
    MINEFIELD: 'minefield',
    SHARK_ENTRY: 'shark-entry',
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
    /** 爆炸本体的真实世界位置；水花仍使用 position 固定在水面。 */
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
};

type ColorTuple = readonly [number, number, number, number];

const PRESENTATION_INTERVAL = 1 / 20;
const LIGHT_POOL_SIZE = 4;
const HEAVY_POOL_SIZE = 3;
const EXPLOSION_POOL_SIZE = 3;
const LIGHT_DEFAULT_SECONDS = 0.42;
const HEAVY_DEFAULT_SECONDS = 0.56;
const EXPLOSION_DEFAULT_SECONDS = 0.95;
const EXPLOSION_BODY_END_PHASE = 0.62;
const EXPLOSION_CORE_END_PHASE = 0.46;

/**
 * 全部娱乐玩法共用的低模水花池。几何和材质只创建一次；比赛中只消费既有视觉事件，
 * 以 20Hz 修改固定节点的显隐和变换，不参与命中、拾取或网络判定。
 */
export class EntertainmentWaterSplashPool {
    private readonly slots: SplashSlot[] = [];
    private readonly lightMesh: Mesh;
    private readonly heavyBodyMesh: Mesh;
    private readonly explosionBodyMesh: Mesh;
    private readonly heavyRingMesh: Mesh;
    private readonly explosionRingMesh: Mesh;
    private readonly explosionCoreMesh: Mesh;
    private readonly material: Material;
    private elapsed = PRESENTATION_INTERVAL;
    private activeCount = 0;
    private disposed = false;

    constructor(private readonly worldRoot: Node) {
        this.lightMesh = utils.createMesh(buildLightEntryGeometry());
        this.heavyBodyMesh = utils.createMesh(buildHeavyEntryBodyGeometry());
        this.explosionBodyMesh = utils.createMesh(buildExplosionBodyGeometry());
        this.heavyRingMesh = utils.createMesh(buildHeavyImpactRingGeometry());
        this.explosionRingMesh = utils.createMesh(buildExplosionImpactRingGeometry());
        this.explosionCoreMesh = utils.createMesh(buildExplosionPressureCoreGeometry());
        this.material = makeWaterSplashMaterial();
        this.buildSlots(ENTERTAINMENT_SPLASH_PROFILE.LIGHT_ENTRY, LIGHT_POOL_SIZE, this.lightMesh, null);
        this.buildSlots(ENTERTAINMENT_SPLASH_PROFILE.HEAVY_ENTRY, HEAVY_POOL_SIZE, this.heavyBodyMesh, this.heavyRingMesh);
        this.buildSlots(ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION, EXPLOSION_POOL_SIZE, this.explosionBodyMesh, this.explosionRingMesh);
    }

    play(request: EntertainmentSplashRequest): void {
        if (this.disposed || !this.worldRoot?.isValid || !request.position) return;
        const slot = this.acquire(request.profile);
        if (!slot) return;
        slot.owner = request.owner;
        slot.duration = Math.max(0.05, request.duration ?? defaultDuration(request.profile));
        slot.remaining = slot.duration;
        slot.intensity = Math.max(0, request.intensity ?? 1);
        slot.radialScale = Math.max(0, request.radialScale ?? 1);
        slot.verticalScale = Math.max(0, request.verticalScale ?? 1);
        slot.rippleOnly = !!request.rippleOnly;
        slot.explosionCoreActive = slot.profile === ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION
            && !!request.explosionCorePosition;
        slot.root.setWorldPosition(request.position.x, request.position.y, request.position.z);
        slot.root.setRotationFromEuler(0, request.yawDegrees ?? 0, 0);
        if (request.layer !== undefined) this.setLayer(slot, request.layer);
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
            slot.remaining = Math.max(0, slot.remaining - presentationStep);
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
        for (let index = 0; index < this.slots.length; index++) {
            const slot = this.slots[index];
            if (slot.root.isValid) slot.root.destroy();
        }
        this.slots.length = 0;
        this.activeCount = 0;
        this.lightMesh.destroy();
        this.heavyBodyMesh.destroy();
        this.explosionBodyMesh.destroy();
        this.heavyRingMesh.destroy();
        this.explosionRingMesh.destroy();
        this.explosionCoreMesh.destroy();
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
            root.setParent(this.worldRoot);
            root.layer = this.worldRoot.layer;
            const body = this.makeRendererNode('Body', root, bodyMesh);
            const ring = ringMesh ? this.makeRendererNode('Ring', root, ringMesh) : null;
            const explosionCore = profile === ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION
                ? this.makeRendererNode('ExplosionPressureCore', root, this.explosionCoreMesh)
                : null;
            if (explosionCore) explosionCore.active = false;
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
        if (slot.profile === ENTERTAINMENT_SPLASH_PROFILE.LIGHT_ENTRY) {
            if (!slot.rippleOnly) {
                const radial = (0.22 + expand * 0.88) * slot.intensity * slot.radialScale;
                const vertical = (0.18 + crest * 0.72) * slot.intensity * slot.verticalScale;
                slot.body.setScale(radial, vertical, radial);
            }
            return;
        }
        const bodyPhase = slot.profile === ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION
            ? clamp01(phase / EXPLOSION_BODY_END_PHASE)
            : phase;
        const bodyExpand = 1 - Math.pow(1 - bodyPhase, 3);
        const bodyCrest = Math.sin(bodyPhase * Math.PI);
        const bodyRadial = slot.profile === ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION
            ? 0.2 + bodyExpand * 1.42
            : 0.24 + expand * 1.04;
        const bodyVertical = slot.profile === ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION
            ? 0.16 + bodyCrest * 1.5
            : 0.18 + crest * 1.05;
        const bodyFinished = slot.profile === ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION
            && phase >= EXPLOSION_BODY_END_PHASE;
        if (bodyFinished) {
            if (slot.body.active) slot.body.active = false;
        } else if (!slot.rippleOnly) {
            if (!slot.body.active) slot.body.active = true;
            slot.body.setScale(
                bodyRadial * slot.intensity * slot.radialScale,
                bodyVertical * slot.intensity * slot.verticalScale,
                bodyRadial * slot.intensity * slot.radialScale,
            );
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
        if (slot.explosionCore && slot.explosionCoreActive) {
            const corePhase = clamp01(phase / EXPLOSION_CORE_END_PHASE);
            if (corePhase >= 1) {
                if (slot.explosionCore.active) slot.explosionCore.active = false;
            } else {
                if (!slot.explosionCore.active) slot.explosionCore.active = true;
                const coreExpand = 1 - Math.pow(1 - corePhase, 3);
                const coreScale = (0.16 + coreExpand * 1.28) * slot.intensity;
                const coreVertical = coreScale * (1 - corePhase * 0.18);
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
    if (profile === ENTERTAINMENT_SPLASH_PROFILE.LIGHT_ENTRY) return LIGHT_DEFAULT_SECONDS;
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

function buildLightEntryGeometry(): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    appendBrokenRing(positions, colors, indices, 0.34, 0.84, 14, 5, 0.012,
        [0.42, 0.88, 1, 0.5], [0.2, 0.68, 0.94, 0.02]);
    for (let i = 0; i < 3; i++) appendDirectionalJet(positions, colors, indices, i, 3, 0.72);
    for (let i = 0; i < 3; i++) appendWaterDroplet(positions, colors, indices, i, 3, 0.62);
    return geometry(positions, colors, indices, new Vec3(-1, 0, -0.9), new Vec3(1, 1.25, 1.35));
}

function buildHeavyEntryBodyGeometry(): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    appendWaterCrown(positions, colors, indices, 12, 0.82);
    for (let i = 0; i < 6; i++) appendCurvedWaterJet(positions, colors, indices, i, 6, 0.86);
    for (let i = 0; i < 6; i++) appendWaterDroplet(positions, colors, indices, i, 6, 0.86);
    return geometry(positions, colors, indices, new Vec3(-1.7, 0, -1.7), new Vec3(1.7, 2.25, 1.7));
}

function buildExplosionBodyGeometry(): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    appendRing(positions, colors, indices, 0.16, 0.72,
        [1, 0.44, 0.06, 0.62], [1, 0.7, 0.16, 0], 0.018, 14);
    appendWaterCrown(positions, colors, indices, 14, 1);
    for (let i = 0; i < 9; i++) appendCurvedWaterJet(positions, colors, indices, i, 9, 1);
    for (let i = 0; i < 11; i++) appendWaterDroplet(positions, colors, indices, i, 11, 1);
    return geometry(positions, colors, indices, new Vec3(-2.15, 0, -2.15), new Vec3(2.15, 2.65, 2.15));
}

/**
 * 低面数的三维爆压核心。它与水面水花共用材质和对象池，只负责补足水下爆点的空间读感。
 * 外壳采用不规则分段球面，中心和碎泡仍并入同一个网格，不再为内部层次拆分额外材质或节点。
 */
function buildExplosionPressureCoreGeometry(): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    appendPressureShell(positions, colors, indices, 12, 4);
    appendOctahedronAt(positions, colors, indices, 0, 0.02, 0, 0.26, [1, 0.72, 0.22, 0.86]);
    appendOctahedronAt(positions, colors, indices, -0.5, 0.38, 0.17, 0.09, [0.82, 0.97, 1, 0.58]);
    appendOctahedronAt(positions, colors, indices, 0.37, 0.5, -0.28, 0.075, [0.72, 0.94, 1, 0.5]);
    appendOctahedronAt(positions, colors, indices, 0.46, -0.2, 0.3, 0.065, [0.68, 0.92, 1, 0.44]);
    return geometry(positions, colors, indices, new Vec3(-0.82, -0.72, -0.82), new Vec3(0.82, 0.88, 0.82));
}

function appendPressureShell(
    positions: number[], colors: number[], indices: number[], segments: number, bands: number,
): void {
    const base = positions.length / 3;
    const shellColors: readonly ColorTuple[] = [
        [0.34, 0.8, 1, 0.16],
        [0.76, 0.96, 1, 0.3],
        [0.94, 1, 1, 0.38],
        [0.52, 0.88, 1, 0.22],
        [0.28, 0.72, 0.98, 0.08],
    ];
    for (let band = 0; band <= bands; band++) {
        const latitude = -Math.PI * 0.5 + band / bands * Math.PI;
        const bandRadius = Math.cos(latitude);
        const y = Math.sin(latitude) * 0.7;
        for (let segment = 0; segment < segments; segment++) {
            const angle = segment / segments * Math.PI * 2;
            const irregularity = 0.72 + ((segment + band * 2) % 5) * 0.018;
            positions.push(
                Math.cos(angle) * bandRadius * irregularity,
                y * (0.96 + (segment % 3) * 0.025),
                Math.sin(angle) * bandRadius * irregularity,
            );
            pushColor(colors, shellColors[band], 1);
        }
    }
    for (let band = 0; band < bands; band++) {
        for (let segment = 0; segment < segments; segment++) {
            const next = (segment + 1) % segments;
            const lower = base + band * segments + segment;
            const lowerNext = base + band * segments + next;
            const upper = lower + segments;
            const upperNext = lowerNext + segments;
            indices.push(lower, upper, lowerNext, lowerNext, upper, upperNext);
        }
    }
}

function buildHeavyImpactRingGeometry(): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    appendBrokenWaveCrest(
        positions, colors, indices,
        0.32, 0.56, 0.92, 16, 7,
        0.016, 0.11, 0.022,
        [0.3, 0.78, 0.97, 0.16], [0.9, 0.99, 1, 0.76], [0.2, 0.68, 0.93, 0.02],
    );
    return geometry(positions, colors, indices, new Vec3(-0.95, 0, -0.95), new Vec3(0.95, 0.13, 0.95));
}

function buildExplosionImpactRingGeometry(): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    appendBrokenWaveCrest(
        positions, colors, indices,
        0.32, 0.55, 0.86, 18, 8,
        0.018, 0.16, 0.024,
        [0.34, 0.82, 0.98, 0.22], [0.96, 1, 1, 0.94], [0.24, 0.72, 0.94, 0.025],
    );
    appendBrokenWaveCrest(
        positions, colors, indices,
        1.08, 1.42, 2.08, 20, 7,
        0.012, 0.105, 0.018,
        [0.26, 0.76, 0.96, 0.12], [0.8, 0.97, 1, 0.62], [0.16, 0.62, 0.9, 0],
    );
    return geometry(positions, colors, indices, new Vec3(-2.1, 0, -2.1), new Vec3(2.1, 0.18, 2.1));
}

function appendBrokenWaveCrest(
    positions: number[], colors: number[], indices: number[],
    innerRadius: number, crestRadius: number, outerRadius: number,
    segments: number, gapEvery: number,
    innerY: number, crestY: number, outerY: number,
    innerColor: ColorTuple, crestColor: ColorTuple, outerColor: ColorTuple,
): void {
    for (let segment = 0; segment < segments; segment++) {
        if (segment % gapEvery === gapEvery - 1) continue;
        const a0 = segment / segments * Math.PI * 2;
        const a1 = (segment + 1) / segments * Math.PI * 2;
        const radiusScale0 = 0.96 + (segment % 3) * 0.025;
        const radiusScale1 = 0.96 + ((segment + 1) % 3) * 0.025;
        const base = positions.length / 3;
        positions.push(
            Math.cos(a0) * innerRadius * radiusScale0, innerY, Math.sin(a0) * innerRadius * radiusScale0,
            Math.cos(a0) * crestRadius * radiusScale0, crestY, Math.sin(a0) * crestRadius * radiusScale0,
            Math.cos(a0) * outerRadius * radiusScale0, outerY, Math.sin(a0) * outerRadius * radiusScale0,
            Math.cos(a1) * innerRadius * radiusScale1, innerY, Math.sin(a1) * innerRadius * radiusScale1,
            Math.cos(a1) * crestRadius * radiusScale1, crestY, Math.sin(a1) * crestRadius * radiusScale1,
            Math.cos(a1) * outerRadius * radiusScale1, outerY, Math.sin(a1) * outerRadius * radiusScale1,
        );
        pushColor(colors, innerColor, 1);
        pushColor(colors, crestColor, 1);
        pushColor(colors, outerColor, 1);
        pushColor(colors, innerColor, 1);
        pushColor(colors, crestColor, 1);
        pushColor(colors, outerColor, 1);
        indices.push(
            base, base + 3, base + 1,
            base + 1, base + 3, base + 4,
            base + 1, base + 4, base + 2,
            base + 2, base + 4, base + 5,
        );
    }
}

function appendWaterCrown(
    positions: number[], colors: number[], indices: number[], segments: number, scale: number,
): void {
    const base = positions.length / 3;
    const heightPattern = [0.76, 1, 0.84, 1.12, 0.8, 0.94, 1.08];
    const radiusPattern = [0.92, 1.08, 0.86, 1.16, 0.96, 1.04, 0.89];
    const baseColor: ColorTuple = [0.12, 0.68, 0.91, 0.82];
    const shoulderColor: ColorTuple = [0.54, 0.91, 1, 0.72];
    const tipColor: ColorTuple = [0.96, 1, 1, 0.08];
    for (let i = 0; i <= segments; i++) {
        const wrapped = i % segments;
        const angle = wrapped / segments * Math.PI * 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const height = heightPattern[wrapped % heightPattern.length];
        const rimRadius = 0.54 * radiusPattern[wrapped % radiusPattern.length] * scale;
        positions.push(
            cos * 0.48 * scale, 0.04, sin * 0.48 * scale,
            cos * 0.34 * scale, 0.72 * height * scale, sin * 0.34 * scale,
            cos * rimRadius, 1.82 * height * scale, sin * rimRadius,
        );
        pushColor(colors, baseColor, 1);
        pushColor(colors, shoulderColor, 1);
        pushColor(colors, tipColor, 1);
    }
    for (let i = 0; i < segments; i++) {
        const current = base + i * 3;
        const next = current + 3;
        indices.push(
            current, next, current + 1,
            current + 1, next, next + 1,
            current + 1, next + 1, current + 2,
            current + 2, next + 1, next + 2,
        );
    }
}

function appendCurvedWaterJet(
    positions: number[], colors: number[], indices: number[], index: number, count: number, scale: number,
): void {
    const angle = (index / count) * Math.PI * 2 + (index % 2) * 0.12;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const tx = -dz;
    const tz = dx;
    const lift = (1.05 + (index % 3) * 0.2) * scale;
    const reach = (1.24 + (index % 4) * 0.13) * scale;
    const centers: ReadonlyArray<readonly [number, number]> = [
        [0.42 * scale, 0.18 * scale],
        [(0.72 + (index % 2) * 0.08) * scale, lift],
        [reach, (0.52 + (index % 3) * 0.11) * scale],
    ];
    appendJetStations(positions, colors, indices, dx, dz, tx, tz, centers, scale);
}

function appendDirectionalJet(
    positions: number[], colors: number[], indices: number[], index: number, count: number, scale: number,
): void {
    const side = count <= 1 ? 0 : index / (count - 1) - 0.5;
    const angle = side * 0.75;
    const dx = Math.sin(angle);
    const dz = Math.cos(angle);
    const tx = -dz;
    const tz = dx;
    const centers: ReadonlyArray<readonly [number, number]> = [
        [0.2 * scale, 0.08 * scale],
        [0.56 * scale, (0.48 + index * 0.09) * scale],
        [0.92 * scale, (0.28 + index * 0.05) * scale],
    ];
    appendJetStations(positions, colors, indices, dx, dz, tx, tz, centers, scale * 0.78);
}

function appendJetStations(
    positions: number[], colors: number[], indices: number[],
    dx: number, dz: number, tx: number, tz: number,
    centers: ReadonlyArray<readonly [number, number]>, scale: number,
): void {
    const widths = [0.13 * scale, 0.105 * scale, 0.024 * scale];
    const depths = [0.09 * scale, 0.075 * scale, 0.018 * scale];
    const stationColors: readonly ColorTuple[] = [
        [0.08, 0.63, 0.9, 0.84],
        [0.68, 0.95, 1, 0.7],
        [0.94, 1, 1, 0.04],
    ];
    const base = positions.length / 3;
    for (let station = 0; station < centers.length; station++) {
        const [radius, y] = centers[station];
        const width = widths[station];
        const depth = depths[station];
        const cx = dx * radius;
        const cz = dz * radius;
        positions.push(
            cx + tx * width + dx * depth, y, cz + tz * width + dz * depth,
            cx - tx * width + dx * depth, y, cz - tz * width + dz * depth,
            cx - tx * width - dx * depth, y, cz - tz * width - dz * depth,
            cx + tx * width - dx * depth, y, cz + tz * width - dz * depth,
        );
        pushColor(colors, stationColors[station], 4);
    }
    for (let station = 0; station < centers.length - 1; station++) {
        const current = base + station * 4;
        const next = current + 4;
        for (let side = 0; side < 4; side++) {
            const sideNext = (side + 1) % 4;
            indices.push(current + side, next + side, current + sideNext,
                current + sideNext, next + side, next + sideNext);
        }
    }
}

function appendWaterDroplet(
    positions: number[], colors: number[], indices: number[], index: number, count: number, scale: number,
): void {
    const angle = index / count * Math.PI * 2 + 0.2;
    const radius = (0.78 + (index % 4) * 0.22) * scale;
    const centerX = Math.cos(angle) * radius;
    const centerY = (0.62 + (index % 5) * 0.2) * scale;
    const centerZ = Math.sin(angle) * radius;
    const size = (0.055 + (index % 3) * 0.018) * scale;
    appendOctahedronAt(positions, colors, indices, centerX, centerY, centerZ, size, [0.66, 0.94, 1, 0.68]);
}

function appendOctahedronAt(
    positions: number[], colors: number[], indices: number[],
    x: number, y: number, z: number, radius: number, color: ColorTuple,
): void {
    const base = positions.length / 3;
    positions.push(
        x + radius, y, z, x - radius, y, z, x, y + radius * 1.35, z,
        x, y - radius * 1.35, z, x, y, z + radius, x, y, z - radius,
    );
    pushColor(colors, color, 6);
    const faces = [0, 2, 4, 4, 2, 1, 1, 2, 5, 5, 2, 0, 4, 3, 0, 1, 3, 4, 5, 3, 1, 0, 3, 5];
    for (const face of faces) indices.push(base + face);
}

function appendBrokenRing(
    positions: number[], colors: number[], indices: number[],
    innerRadius: number, outerRadius: number, segments: number, gapEvery: number, y: number,
    innerColor: ColorTuple, outerColor: ColorTuple,
): void {
    for (let segment = 0; segment < segments; segment++) {
        if (segment % gapEvery === gapEvery - 1) continue;
        const a0 = segment / segments * Math.PI * 2;
        const a1 = (segment + 1) / segments * Math.PI * 2;
        const radiusScale0 = 0.94 + (segment % 3) * 0.035;
        const radiusScale1 = 0.94 + ((segment + 1) % 3) * 0.035;
        const base = positions.length / 3;
        positions.push(
            Math.cos(a0) * innerRadius * radiusScale0, y, Math.sin(a0) * innerRadius * radiusScale0,
            Math.cos(a0) * outerRadius * radiusScale0, y, Math.sin(a0) * outerRadius * radiusScale0,
            Math.cos(a1) * innerRadius * radiusScale1, y, Math.sin(a1) * innerRadius * radiusScale1,
            Math.cos(a1) * outerRadius * radiusScale1, y, Math.sin(a1) * outerRadius * radiusScale1,
        );
        pushColor(colors, innerColor, 1);
        pushColor(colors, outerColor, 1);
        pushColor(colors, innerColor, 1);
        pushColor(colors, outerColor, 1);
        indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
}

function appendRing(
    positions: number[], colors: number[], indices: number[],
    innerRadius: number, outerRadius: number,
    innerColor: ColorTuple, outerColor: ColorTuple, y: number, segments: number,
): void {
    const base = positions.length / 3;
    for (let i = 0; i < segments; i++) {
        const angle = i / segments * Math.PI * 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        positions.push(cos * innerRadius, y, sin * innerRadius, cos * outerRadius, y, sin * outerRadius);
        pushColor(colors, innerColor, 1);
        pushColor(colors, outerColor, 1);
    }
    for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        indices.push(base + i * 2, base + i * 2 + 1, base + next * 2,
            base + next * 2, base + i * 2 + 1, base + next * 2 + 1);
    }
}

function geometry(
    positions: number[], colors: number[], indices: number[], minPos: Vec3, maxPos: Vec3,
): primitives.IGeometry {
    return { positions, colors, indices, primitiveMode: gfx.PrimitiveMode.TRIANGLE_LIST, minPos, maxPos };
}

function pushColor(colors: number[], color: ColorTuple, count: number): void {
    for (let i = 0; i < count; i++) colors.push(color[0], color[1], color[2], color[3]);
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
