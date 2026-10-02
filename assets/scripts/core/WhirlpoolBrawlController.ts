import { Color, EffectAsset, gfx, Material, Mesh, MeshRenderer, Node, primitives, utils, Vec3, Vec4 } from 'cc';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { buildWhirlpoolFunnelGeometry, WHIRLPOOL_SURFACE_OFFSET } from './WhirlpoolFunnelGeometry';
import { loadRaceAsset } from './RaceBundleLoader';
import { RESOURCE_PATHS } from './ResourcePaths';
import {
    WHIRLPOOL_BRAWL_TUNING,
    WHIRLPOOL_SUPER_TUNING,
    type WhirlpoolSpawn,
    whirlpoolCenterZ,
    whirlpoolSpawnsForSeed,
    whirlpoolTargetZForAi,
    whirlpoolWorldSpin,
} from './WhirlpoolBrawlRules';

type Visual = {
    root: Node;
    flow: Node;
    core: Node;
    afterglow: Node;
    afterglowMaterial: Material;
    afterglowColor: Color;
    afterglowAlpha: number;
    distance: number;
    spin: -1 | 1;
    phase: number;
    flowRotationDegrees: number;
    coreRotationDegrees: number;
    superVariant: boolean;
    activationEntranceElapsed: number;
    coreRenderer: MeshRenderer;
    funnelBound: boolean;
};

type WhirlpoolVisualResourceSet = {
    flowMesh: Mesh;
    coreMesh: Mesh;
    afterglowMesh: Mesh;
    flowMaterial: Material;
    coreMaterial: Material;
    afterglowBaseMaterial: Material;
    funnelMaterial: Material | null;
    flowMotion: Vec4;
};

export type WhirlpoolVisualResources = {
    normal: WhirlpoolVisualResourceSet;
    super: WhirlpoolVisualResourceSet;
    disposed: boolean;
};

type GeometryBuffers = {
    positions: number[];
    colors: number[];
    indices: number[];
};

const PRESENTATION_INTERVAL = 1 / 20;
const EMERGE_AHEAD_DISTANCE = 42;
const FULL_AHEAD_DISTANCE = 10;
const FADE_BEHIND_START_DISTANCE = 5.5;
const FADE_BEHIND_END_DISTANCE = 14;
const ANNOUNCEMENT_DISTANCE = 16;
const SUPER_ANNOUNCEMENT_DISTANCE = 30;
const ACTIVATION_ENTRANCE_SECONDS = 1.25;
const MIN_ROTATION_DEGREES_PER_SECOND = 8;
const MAX_ROTATION_DEGREES_PER_SECOND = 52;
const CORE_ROTATION_SPEED_SCALE = 1.12;
const CORE_ROTATION_BASE_DEGREES_PER_SECOND = 12;
const SUPER_CORE_ROTATION_BONUS_DEGREES_PER_SECOND = 8;
const MIN_VISIBLE_SCALE = 0.08;
const AFTERGLOW_MAX_ALPHA = 138;
const AFTERGLOW_COLOR = new Color(156, 235, 255, 0);
const SUPER_AFTERGLOW_COLOR = new Color(145, 196, 255, 0);

/** 漩涡玩法的低开销表现与 AI 路线提示；物理作用由泳者模拟步中的纯规则计算。 */
export class WhirlpoolBrawlController {
    private readonly visuals: Visual[] = [];
    private readonly materials: Material[] = [];
    private elapsed = PRESENTATION_INTERVAL;
    private clock = 0;
    private announcedMask = 0;
    private disposed = false;
    private readonly spawns: readonly WhirlpoolSpawn[];
    private readonly resources: WhirlpoolVisualResources;
    private readonly ownsResources: boolean;

    constructor(
        private readonly parent: Node,
        private readonly course: RaceCourseLayout,
        seed: number,
        private readonly onApproach: (spawn: WhirlpoolSpawn, index: number, worldSpin: -1 | 1) => void,
        spawns?: readonly WhirlpoolSpawn[],
        resources?: WhirlpoolVisualResources,
    ) {
        this.spawns = spawns ?? whirlpoolSpawnsForSeed(seed);
        this.resources = resources ?? createWhirlpoolVisualResources();
        this.ownsResources = !resources;
        this.buildVisuals();
    }

    reset(): void {
        this.elapsed = PRESENTATION_INTERVAL;
        this.clock = 0;
        this.announcedMask = 0;
        for (const visual of this.visuals) {
            if (visual.root?.isValid && visual.root.active) visual.root.active = false;
            if (visual.afterglow?.isValid && visual.afterglow.active) visual.afterglow.active = false;
            visual.flowRotationDegrees = visual.phase * 57.295779513;
            visual.coreRotationDegrees = -visual.phase * 31.4;
            visual.activationEntranceElapsed = -1;
            this.setAfterglowAlpha(visual, 0);
        }
    }

    /** 统一娱乐事件激活时立即播放一次生成过程，不改变漩涡的物理位置或作用范围。 */
    beginActivationEntrance(index: number): boolean {
        if (this.disposed) return false;
        const visual = this.visuals[index];
        if (!visual?.root?.isValid) return false;
        visual.activationEntranceElapsed = 0;
        visual.flowRotationDegrees = visual.phase * 57.295779513;
        visual.coreRotationDegrees = -visual.phase * 31.4;
        if (visual.root.active) visual.root.active = false;
        if (visual.afterglow.active) visual.afterglow.active = false;
        this.setAfterglowAlpha(visual, 0);
        this.elapsed = PRESENTATION_INTERVAL;
        return true;
    }

    updatePresentation(referenceDistance: number, dt: number, allowAnnouncements: boolean): void {
        if (this.disposed) return;
        const distance = Number.isFinite(referenceDistance) ? referenceDistance : 0;
        if (allowAnnouncements) {
            for (let i = 0; i < this.spawns.length; i++) {
                const ahead = this.spawns[i].distance - distance;
                const bit = 1 << i;
                const announcementDistance = this.spawns[i].variant === 'super'
                    ? SUPER_ANNOUNCEMENT_DISTANCE
                    : ANNOUNCEMENT_DISTANCE;
                if ((this.announcedMask & bit) === 0 && ahead <= announcementDistance && ahead >= -1) {
                    this.announcedMask |= bit;
                    this.onApproach(this.spawns[i], i, this.visuals[i].spin);
                }
            }
        }

        this.elapsed += Math.max(0, Number.isFinite(dt) ? dt : 0);
        if (this.elapsed < PRESENTATION_INTERVAL) return;
        const step = this.elapsed;
        this.elapsed = 0;
        this.clock += step;
        let normalVisible = false;
        let superVisible = false;
        for (const visual of this.visuals) {
            const ahead = visual.distance - distance;
            const distanceStrength = presentationStrength(ahead, visual.superVariant);
            let strength = distanceStrength;
            if (visual.activationEntranceElapsed >= 0) {
                visual.activationEntranceElapsed = Math.min(
                    ACTIVATION_ENTRANCE_SECONDS,
                    visual.activationEntranceElapsed + step,
                );
                if (visual.activationEntranceElapsed < ACTIVATION_ENTRANCE_SECONDS) {
                    strength = smooth01(visual.activationEntranceElapsed / ACTIVATION_ENTRANCE_SECONDS);
                } else if (ahead >= -FADE_BEHIND_START_DISTANCE) {
                    // 已在激活镜头里生成的漩涡保持成形，不再因本地玩家仍离得较远而重新隐藏。
                    strength = 1;
                }
            }
            const visible = strength > 0.001;
            if (visual.root.active !== visible) visual.root.active = visible;
            if (!visible) {
                this.setAfterglowAlpha(visual, 0);
                continue;
            }

            const resources = visual.superVariant ? this.resources.super : this.resources.normal;
            if (visual.superVariant) superVisible = true;
            else normalVisible = true;
            if (!visual.funnelBound && resources.funnelMaterial) {
                visual.coreRenderer.setMaterial(resources.funnelMaterial, 0);
                visual.funnelBound = true;
            }

            // 核心先扰动、方向水带后展开；退场时顺序反转，让漩涡不再整体同时弹出或消失。
            const coreStrength = smooth01(strength / 0.58);
            const flowStrength = smooth01((strength - 0.12) / 0.88);
            const pulse = Math.sin(this.clock * 2.1 + visual.phase);
            const flowScale = (MIN_VISIBLE_SCALE + (1 - MIN_VISIBLE_SCALE) * flowStrength)
                * (1 + pulse * 0.025 * strength);
            const coreScale = (0.12 + 0.88 * coreStrength)
                * (1 - pulse * 0.035 * strength);
            const coreDepthScale = 0.08 + 0.92 * coreStrength;
            const rotationSpeed = MIN_ROTATION_DEGREES_PER_SECOND
                + (MAX_ROTATION_DEGREES_PER_SECOND - MIN_ROTATION_DEGREES_PER_SECOND) * strength
                + (visual.superVariant ? 8 * strength : 0);
            const coreRotationSpeed = rotationSpeed * CORE_ROTATION_SPEED_SCALE
                + CORE_ROTATION_BASE_DEGREES_PER_SECOND
                + (visual.superVariant ? SUPER_CORE_ROTATION_BONUS_DEGREES_PER_SECOND * strength : 0);
            // Cocos 的正 Y 欧拉角在 X/Z 平面上沿规则旋向的反方向转动，因此视觉角速度取反。
            visual.flowRotationDegrees = (visual.flowRotationDegrees
                - visual.spin * rotationSpeed * step) % 360;
            visual.coreRotationDegrees = (visual.coreRotationDegrees
                - visual.spin * coreRotationSpeed * step) % 360;
            setMirroredScale(visual.flow, flowScale, visual.spin);
            // 水面细流保持贴水，薄漏斗与水下螺旋同步展开，不拉出实体水壁。
            visual.core.setScale(coreScale, coreDepthScale, visual.spin * coreScale);
            visual.core.setPosition(0, 0.002 - WHIRLPOOL_SURFACE_OFFSET * (1 - coreDepthScale), 0);
            visual.flow.setRotationFromEuler(0, visual.flowRotationDegrees, 0);
            visual.core.setRotationFromEuler(0, visual.coreRotationDegrees, 0);

            // 离开漩涡后留下一圈扩散余波；透明度先升后降，末端已经归零再隐藏节点。
            const fadeProgress = presentationFadeProgress(ahead);
            const afterglowStrength = fadeProgress > 0 ? Math.sin(Math.PI * fadeProgress) : 0;
            const afterglowVisible = afterglowStrength > 0.004;
            if (visual.afterglow.active !== afterglowVisible) visual.afterglow.active = afterglowVisible;
            if (afterglowVisible) {
                const afterglowScale = 0.86 + fadeProgress * 0.56;
                setMirroredScale(visual.afterglow, afterglowScale, visual.spin);
                visual.afterglow.setRotationFromEuler(0, -visual.flowRotationDegrees * 0.16, 0);
                this.setAfterglowAlpha(visual, Math.round(AFTERGLOW_MAX_ALPHA * afterglowStrength));
            } else {
                this.setAfterglowAlpha(visual, 0);
            }
        }
        // 仅更新可见规格的共享时钟，隐藏期间不写材质；不逐涡创建材质或重建几何。
        if (normalVisible) this.updateFunnelMaterial(this.resources.normal);
        if (superVisible) this.updateFunnelMaterial(this.resources.super);
    }

    private updateFunnelMaterial(resources: WhirlpoolVisualResourceSet): void {
        if (!resources.funnelMaterial) return;
        resources.flowMotion.x = this.clock;
        resources.funnelMaterial.setProperty('flowMotion', resources.flowMotion);
    }

    targetZForAi(distance: number, currentZ: number): number | null {
        return whirlpoolTargetZForAi(distance, currentZ, this.course.poolWidth, this.spawns);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const visual of this.visuals) {
            if (visual.root?.isValid) visual.root.destroy();
        }
        this.visuals.length = 0;
        for (const material of this.materials) material.destroy();
        this.materials.length = 0;
        if (this.ownsResources) disposeWhirlpoolVisualResources(this.resources);
    }

    private buildVisuals(): void {
        if (!this.parent?.isValid) return;

        for (const spawn of this.spawns) {
            const superVariant = spawn.variant === 'super';
            const resources = superVariant ? this.resources.super : this.resources.normal;
            const worldSpin = whirlpoolWorldSpin(spawn, this.course.directionAtDistance(spawn.distance));
            const root = new Node(`${superVariant ? 'SuperWhirlpool' : 'Whirlpool'}_${spawn.id}`);
            root.setParent(this.parent);
            root.layer = this.parent.layer;
            const p = this.course.swimPosition(spawn.distance, whirlpoolCenterZ(spawn, this.course.poolWidth));
            root.setWorldPosition(p.x, this.course.waterY + 0.035, p.z);
            if (spawn.radiusScale !== undefined && spawn.radiusScale !== 1) {
                root.setScale(spawn.radiusScale, 1, spawn.radiusScale);
            }

            const flow = createVisualLayer(root, 'DirectionalFlow', resources.flowMesh, resources.flowMaterial, 0);
            const core = createVisualLayer(root, 'DangerCore', resources.coreMesh, resources.coreMaterial, 0.002);
            const afterglowMaterial = new Material();
            afterglowMaterial.copy(resources.afterglowBaseMaterial);
            afterglowMaterial.name = `WhirlpoolAfterglow_${spawn.id}`;
            const afterglowColor = (superVariant ? SUPER_AFTERGLOW_COLOR : AFTERGLOW_COLOR).clone();
            afterglowMaterial.setProperty('mainColor', afterglowColor);
            this.materials.push(afterglowMaterial);
            const afterglow = createVisualLayer(root, 'ExitAfterglow', resources.afterglowMesh, afterglowMaterial, 0.004);
            afterglow.active = false;
            root.active = false;

            const phase = spawn.id * 1.37;
            this.visuals.push({
                root,
                flow,
                core,
                afterglow,
                afterglowMaterial,
                afterglowColor,
                afterglowAlpha: 0,
                distance: spawn.distance,
                spin: worldSpin,
                phase,
                flowRotationDegrees: phase * 57.295779513,
                coreRotationDegrees: -phase * 31.4,
                superVariant,
                activationEntranceElapsed: -1,
                coreRenderer: core.getComponent(MeshRenderer)!,
                funnelBound: false,
            });
        }
    }

    private setAfterglowAlpha(visual: Visual, alpha: number): void {
        if (visual.afterglowAlpha === alpha) return;
        visual.afterglowAlpha = alpha;
        visual.afterglowColor.a = alpha;
        visual.afterglowMaterial.setProperty('mainColor', visual.afterglowColor);
    }
}

function presentationStrength(ahead: number, superVariant: boolean): number {
    const emergeDistance = superVariant ? EMERGE_AHEAD_DISTANCE + 12 : EMERGE_AHEAD_DISTANCE;
    if (ahead >= emergeDistance || ahead <= -FADE_BEHIND_END_DISTANCE) return 0;
    if (ahead > FULL_AHEAD_DISTANCE) {
        return smooth01((emergeDistance - ahead) / (emergeDistance - FULL_AHEAD_DISTANCE));
    }
    if (ahead >= -FADE_BEHIND_START_DISTANCE) return 1;
    return smooth01((ahead + FADE_BEHIND_END_DISTANCE)
        / (FADE_BEHIND_END_DISTANCE - FADE_BEHIND_START_DISTANCE));
}

function presentationFadeProgress(ahead: number): number {
    if (ahead >= -FADE_BEHIND_START_DISTANCE) return 0;
    return 1 - smooth01((ahead + FADE_BEHIND_END_DISTANCE)
        / (FADE_BEHIND_END_DISTANCE - FADE_BEHIND_START_DISTANCE));
}

function smooth01(value: number): number {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
}

function setMirroredScale(node: Node, scale: number, spin: -1 | 1): void {
    node.setScale(scale, 1, spin * scale);
}

function createWhirlpoolMaterial(name: string): Material {
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
    material.name = name;
    material.setProperty('mainColor', Color.WHITE);
    return material;
}

/** 赛前一次性创建普通／超级两套固定资源，激活事件时只挂轻量节点和材质实例。 */
export function createWhirlpoolVisualResources(): WhirlpoolVisualResources {
    const resources: WhirlpoolVisualResources = {
        normal: createWhirlpoolVisualResourceSet(false),
        super: createWhirlpoolVisualResourceSet(true),
        disposed: false,
    };
    loadRaceAsset(RESOURCE_PATHS.whirlpoolFunnelEffect, EffectAsset, (error, effect) => {
        if (resources.disposed) return;
        if (error || !effect) {
            console.warn('[Whirlpool] 水流材质加载失败，保留基础螺旋表现', error);
            return;
        }
        for (const set of [resources.normal, resources.super]) {
            const material = new Material();
            material.initialize({ effectAsset: effect });
            material.setProperty('flowMotion', set.flowMotion);
            set.funnelMaterial = material;
        }
    });
    return resources;
}

export function disposeWhirlpoolVisualResources(resources: WhirlpoolVisualResources | null): void {
    if (!resources || resources.disposed) return;
    resources.disposed = true;
    for (const set of [resources.normal, resources.super]) {
        set.flowMesh.destroy();
        set.coreMesh.destroy();
        set.afterglowMesh.destroy();
        set.flowMaterial.destroy();
        set.coreMaterial.destroy();
        set.afterglowBaseMaterial.destroy();
        set.funnelMaterial?.destroy();
    }
}

function createWhirlpoolVisualResourceSet(superVariant: boolean): WhirlpoolVisualResourceSet {
    const prefix = superVariant ? 'SuperWhirlpool' : 'Whirlpool';
    return {
        flowMesh: utils.createMesh(superVariant ? buildWhirlpoolFlowGeometry(true) : buildWhirlpoolFlowGeometry()),
        coreMesh: utils.createMesh(superVariant ? buildWhirlpoolCoreGeometry(true) : buildWhirlpoolCoreGeometry()),
        afterglowMesh: utils.createMesh(superVariant ? buildWhirlpoolAfterglowGeometry(true) : buildWhirlpoolAfterglowGeometry()),
        flowMaterial: createWhirlpoolMaterial(`${prefix}FlowSharedMaterial`),
        coreMaterial: createWhirlpoolMaterial(`${prefix}CoreSharedMaterial`),
        afterglowBaseMaterial: createWhirlpoolMaterial(`${prefix}AfterglowBaseMaterial`),
        funnelMaterial: null,
        flowMotion: new Vec4(0, superVariant ? 0.60 : 0.48, superVariant ? 4 : 3, 0),
    };
}

function createVisualLayer(parent: Node, name: string, mesh: Mesh, material: Material, height: number): Node {
    const node = new Node(name);
    node.setParent(parent);
    node.layer = parent.layer;
    node.setPosition(0, height, 0);
    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = mesh;
    renderer.setMaterial(material, 0);
    return node;
}

function buildWhirlpoolFlowGeometry(superVariant = false): primitives.IGeometry {
    const buffers: GeometryBuffers = { positions: [], colors: [], indices: [] };
    const arms = superVariant ? 5 : 3;
    const segments = 16;
    const maxRadius = Math.max(1, WHIRLPOOL_BRAWL_TUNING.lateralRadius
        * (superVariant ? WHIRLPOOL_SUPER_TUNING.lateralRadiusScale : 1));
    const coreRadius = Math.max(0.2, WHIRLPOOL_BRAWL_TUNING.lateralRadius
        * WHIRLPOOL_BRAWL_TUNING.coreRadiusRatio
        * (superVariant ? WHIRLPOOL_SUPER_TUNING.coreRadiusScale : 1));

    // 向内收束的细水带负责表达吸力；外端更亮，靠近核心时收窄并压暗。
    for (let arm = 0; arm < arms; arm++) {
        const baseAngle = arm / arms * Math.PI * 2;
        const base = buffers.positions.length / 3;
        for (let segment = 0; segment <= segments; segment++) {
            const t = segment / segments;
            const radius = coreRadius * 0.72 + t * (maxRadius - coreRadius * 0.72);
            const angle = baseAngle + t * Math.PI * 1.48;
            const width = 0.12 + t * 0.22;
            const tangentX = -Math.sin(angle);
            const tangentZ = Math.cos(angle);
            const centerX = Math.cos(angle) * radius;
            const centerZ = Math.sin(angle) * radius;
            buffers.positions.push(
                centerX - tangentX * width, 0, centerZ - tangentZ * width,
                centerX + tangentX * width, 0, centerZ + tangentZ * width,
            );
            const alpha = Math.sin(Math.PI * Math.min(1, t * 1.06)) * (0.48 + t * 0.28);
            pushColor(buffers.colors, superVariant ? 0.20 : 0.16, superVariant ? 0.42 : 0.67, superVariant ? 0.92 : 0.86, alpha * 0.70);
            pushColor(buffers.colors, superVariant ? 0.70 : 0.78, superVariant ? 0.86 : 0.98, 1, alpha);
        }
        for (let segment = 0; segment < segments; segment++) {
            const lower = base + segment * 2;
            buffers.indices.push(lower, lower + 2, lower + 1, lower + 1, lower + 2, lower + 3);
        }
    }

    // 六枚断续箭头沿外圈顺时针排布；整体镜像后自然变为反向，直接提示顺流加速路线。
    const routeRadius = maxRadius * 0.76;
    const markerCount = superVariant ? 10 : 6;
    for (let marker = 0; marker < markerCount; marker++) {
        const centerAngle = marker / markerCount * Math.PI * 2;
        appendDirectionalMarker(buffers, routeRadius, centerAngle, 0.34, 0.15);
    }

    return finishGeometry(buffers, maxRadius * 1.02);
}

function buildWhirlpoolCoreGeometry(superVariant = false): primitives.IGeometry {
    const coreRadius = Math.max(1, WHIRLPOOL_BRAWL_TUNING.lateralRadius)
        * WHIRLPOOL_BRAWL_TUNING.coreRadiusRatio
        * (superVariant ? WHIRLPOOL_SUPER_TUNING.coreRadiusScale : 1);
    const geometry = buildWhirlpoolFunnelGeometry(coreRadius, superVariant);
    return {
        positions: geometry.positions, normals: geometry.normals,
        uvs: geometry.uvs, colors: geometry.colors, indices: geometry.indices,
        minPos: new Vec3(-geometry.radius, geometry.minY, -geometry.radius),
        maxPos: new Vec3(geometry.radius, geometry.maxY, geometry.radius),
    };
}

function buildWhirlpoolAfterglowGeometry(superVariant = false): primitives.IGeometry {
    const buffers: GeometryBuffers = { positions: [], colors: [], indices: [] };
    const maxRadius = Math.max(1, WHIRLPOOL_BRAWL_TUNING.lateralRadius
        * (superVariant ? WHIRLPOOL_SUPER_TUNING.lateralRadiusScale : 1));
    appendArcRibbon(buffers, maxRadius * 0.77, 0.09, 0, Math.PI * 2, 36,
        0.52, 0.90, 1, 0.36);
    appendArcRibbon(buffers, maxRadius * 0.91, 0.055, 0.24, Math.PI * 2 - 0.32, 28,
        0.70, 0.96, 1, 0.20);
    return finishGeometry(buffers, maxRadius);
}

function appendDirectionalMarker(
    buffers: GeometryBuffers,
    radius: number,
    centerAngle: number,
    arcLength: number,
    halfWidth: number,
): void {
    const start = centerAngle - arcLength * 0.68;
    const end = centerAngle + arcLength * 0.32;
    appendArcRibbon(buffers, radius, halfWidth, start, end, 3, 0.42, 0.91, 1, 0.70);

    const base = buffers.positions.length / 3;
    const tipAngle = centerAngle + arcLength * 0.70;
    const shoulderAngle = centerAngle + arcLength * 0.14;
    const tipX = Math.cos(tipAngle) * radius;
    const tipZ = Math.sin(tipAngle) * radius;
    buffers.positions.push(
        Math.cos(shoulderAngle) * (radius - halfWidth * 2.1), 0, Math.sin(shoulderAngle) * (radius - halfWidth * 2.1),
        Math.cos(shoulderAngle) * (radius + halfWidth * 2.1), 0, Math.sin(shoulderAngle) * (radius + halfWidth * 2.1),
        tipX, 0, tipZ,
    );
    pushColor(buffers.colors, 0.42, 0.91, 1, 0.58);
    pushColor(buffers.colors, 0.90, 1, 1, 0.82);
    pushColor(buffers.colors, 0.96, 1, 1, 0.92);
    buffers.indices.push(base, base + 1, base + 2);
}

function appendArcRibbon(
    buffers: GeometryBuffers,
    radius: number,
    halfWidth: number,
    startAngle: number,
    endAngle: number,
    segments: number,
    red: number,
    green: number,
    blue: number,
    alpha: number,
): void {
    const base = buffers.positions.length / 3;
    for (let segment = 0; segment <= segments; segment++) {
        const t = segment / segments;
        const angle = startAngle + (endAngle - startAngle) * t;
        const inner = radius - halfWidth;
        const outer = radius + halfWidth;
        buffers.positions.push(
            Math.cos(angle) * inner, 0, Math.sin(angle) * inner,
            Math.cos(angle) * outer, 0, Math.sin(angle) * outer,
        );
        const endFade = Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
        const ribbonAlpha = alpha * (0.25 + endFade * 0.75);
        pushColor(buffers.colors, red, green, blue, ribbonAlpha * 0.72);
        pushColor(buffers.colors, red, green, blue, ribbonAlpha);
    }
    for (let segment = 0; segment < segments; segment++) {
        const lower = base + segment * 2;
        buffers.indices.push(lower, lower + 2, lower + 1, lower + 1, lower + 2, lower + 3);
    }
}

function pushColor(colors: number[], red: number, green: number, blue: number, alpha: number): void {
    colors.push(red, green, blue, alpha);
}

function finishGeometry(
    buffers: GeometryBuffers,
    radius: number,
    minY = -0.01,
    maxY = 0.01,
): primitives.IGeometry {
    return {
        positions: buffers.positions,
        colors: buffers.colors,
        indices: buffers.indices,
        minPos: new Vec3(-radius, minY, -radius),
        maxPos: new Vec3(radius, maxY, radius),
    };
}
