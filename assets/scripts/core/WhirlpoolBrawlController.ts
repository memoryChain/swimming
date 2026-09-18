import { Color, gfx, Material, Mesh, MeshRenderer, Node, primitives, utils, Vec3 } from 'cc';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import {
    WHIRLPOOL_BRAWL_TUNING,
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
const MIN_ROTATION_DEGREES_PER_SECOND = 8;
const MAX_ROTATION_DEGREES_PER_SECOND = 52;
const MIN_VISIBLE_SCALE = 0.08;
const AFTERGLOW_MAX_ALPHA = 138;
const AFTERGLOW_COLOR = new Color(156, 235, 255, 0);

/** 漩涡玩法的低开销表现与 AI 路线提示；物理作用由泳者模拟步中的纯规则计算。 */
export class WhirlpoolBrawlController {
    private readonly visuals: Visual[] = [];
    private readonly meshes: Mesh[] = [];
    private readonly materials: Material[] = [];
    private elapsed = PRESENTATION_INTERVAL;
    private clock = 0;
    private announcedMask = 0;
    private disposed = false;
    private readonly spawns: readonly WhirlpoolSpawn[];

    constructor(
        private readonly parent: Node,
        private readonly course: RaceCourseLayout,
        seed: number,
        private readonly onApproach: (spawn: WhirlpoolSpawn, index: number, worldSpin: -1 | 1) => void,
        spawns?: readonly WhirlpoolSpawn[],
    ) {
        this.spawns = spawns ?? whirlpoolSpawnsForSeed(seed);
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
            this.setAfterglowAlpha(visual, 0);
        }
    }

    updatePresentation(referenceDistance: number, dt: number, allowAnnouncements: boolean): void {
        if (this.disposed) return;
        const distance = Number.isFinite(referenceDistance) ? referenceDistance : 0;
        if (allowAnnouncements) {
            for (let i = 0; i < this.spawns.length; i++) {
                const ahead = this.spawns[i].distance - distance;
                const bit = 1 << i;
                if ((this.announcedMask & bit) === 0 && ahead <= ANNOUNCEMENT_DISTANCE && ahead >= -1) {
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
        for (const visual of this.visuals) {
            const ahead = visual.distance - distance;
            const strength = presentationStrength(ahead);
            const visible = strength > 0.001;
            if (visual.root.active !== visible) visual.root.active = visible;
            if (!visible) {
                this.setAfterglowAlpha(visual, 0);
                continue;
            }

            // 核心先扰动、方向水带后展开；退场时顺序反转，让漩涡不再整体同时弹出或消失。
            const coreStrength = smooth01(strength / 0.58);
            const flowStrength = smooth01((strength - 0.12) / 0.88);
            const pulse = Math.sin(this.clock * 2.1 + visual.phase);
            const flowScale = (MIN_VISIBLE_SCALE + (1 - MIN_VISIBLE_SCALE) * flowStrength)
                * (1 + pulse * 0.025 * strength);
            const coreScale = (0.12 + 0.88 * coreStrength)
                * (1 - pulse * 0.018 * strength);
            const rotationSpeed = MIN_ROTATION_DEGREES_PER_SECOND
                + (MAX_ROTATION_DEGREES_PER_SECOND - MIN_ROTATION_DEGREES_PER_SECOND) * strength;
            // Cocos 的正 Y 欧拉角在 X/Z 平面上沿规则旋向的反方向转动，因此视觉角速度取反。
            visual.flowRotationDegrees = (visual.flowRotationDegrees
                - visual.spin * rotationSpeed * step) % 360;
            visual.coreRotationDegrees = (visual.coreRotationDegrees
                - visual.spin * (rotationSpeed * 0.62 + 5) * step) % 360;
            setMirroredScale(visual.flow, flowScale, visual.spin);
            setMirroredScale(visual.core, coreScale, visual.spin);
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
        for (const mesh of this.meshes) mesh.destroy();
        for (const material of this.materials) material.destroy();
        this.meshes.length = 0;
        this.materials.length = 0;
    }

    private buildVisuals(): void {
        if (!this.parent?.isValid) return;

        // 三层都由全部漩涡共享网格；只有余波需要逐漩涡透明度，因此为其复制四份轻量材质。
        const flowMesh = utils.createMesh(buildWhirlpoolFlowGeometry());
        const coreMesh = utils.createMesh(buildWhirlpoolCoreGeometry());
        const afterglowMesh = utils.createMesh(buildWhirlpoolAfterglowGeometry());
        const flowMaterial = createWhirlpoolMaterial('WhirlpoolFlowSharedMaterial');
        const coreMaterial = createWhirlpoolMaterial('WhirlpoolCoreSharedMaterial');
        const afterglowBaseMaterial = createWhirlpoolMaterial('WhirlpoolAfterglowBaseMaterial');
        this.meshes.push(flowMesh, coreMesh, afterglowMesh);
        this.materials.push(flowMaterial, coreMaterial, afterglowBaseMaterial);

        for (const spawn of this.spawns) {
            const worldSpin = whirlpoolWorldSpin(spawn, this.course.directionAtDistance(spawn.distance));
            const root = new Node(`Whirlpool_${spawn.id}`);
            root.setParent(this.parent);
            root.layer = this.parent.layer;
            const p = this.course.swimPosition(spawn.distance, whirlpoolCenterZ(spawn, this.course.poolWidth));
            root.setWorldPosition(p.x, this.course.waterY + 0.035, p.z);

            const flow = createVisualLayer(root, 'DirectionalFlow', flowMesh, flowMaterial, 0);
            const core = createVisualLayer(root, 'DangerCore', coreMesh, coreMaterial, 0.002);
            const afterglowMaterial = new Material();
            afterglowMaterial.copy(afterglowBaseMaterial);
            afterglowMaterial.name = `WhirlpoolAfterglow_${spawn.id}`;
            const afterglowColor = AFTERGLOW_COLOR.clone();
            afterglowMaterial.setProperty('mainColor', afterglowColor);
            this.materials.push(afterglowMaterial);
            const afterglow = createVisualLayer(root, 'ExitAfterglow', afterglowMesh, afterglowMaterial, 0.004);
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

function presentationStrength(ahead: number): number {
    if (ahead >= EMERGE_AHEAD_DISTANCE || ahead <= -FADE_BEHIND_END_DISTANCE) return 0;
    if (ahead > FULL_AHEAD_DISTANCE) {
        return smooth01((EMERGE_AHEAD_DISTANCE - ahead) / (EMERGE_AHEAD_DISTANCE - FULL_AHEAD_DISTANCE));
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

function buildWhirlpoolFlowGeometry(): primitives.IGeometry {
    const buffers: GeometryBuffers = { positions: [], colors: [], indices: [] };
    const arms = 3;
    const segments = 16;
    const maxRadius = Math.max(1, WHIRLPOOL_BRAWL_TUNING.lateralRadius);
    const coreRadius = maxRadius * WHIRLPOOL_BRAWL_TUNING.coreRadiusRatio;

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
            pushColor(buffers.colors, 0.16, 0.67, 0.86, alpha * 0.70);
            pushColor(buffers.colors, 0.78, 0.98, 1, alpha);
        }
        for (let segment = 0; segment < segments; segment++) {
            const lower = base + segment * 2;
            buffers.indices.push(lower, lower + 2, lower + 1, lower + 1, lower + 2, lower + 3);
        }
    }

    // 六枚断续箭头沿外圈顺时针排布；整体镜像后自然变为反向，直接提示顺流加速路线。
    const routeRadius = maxRadius * 0.76;
    for (let marker = 0; marker < 6; marker++) {
        const centerAngle = marker / 6 * Math.PI * 2;
        appendDirectionalMarker(buffers, routeRadius, centerAngle, 0.34, 0.15);
    }

    return finishGeometry(buffers, maxRadius * 1.02);
}

function buildWhirlpoolCoreGeometry(): primitives.IGeometry {
    const buffers: GeometryBuffers = { positions: [], colors: [], indices: [] };
    const maxRadius = Math.max(1, WHIRLPOOL_BRAWL_TUNING.lateralRadius);
    const coreRadius = maxRadius * WHIRLPOOL_BRAWL_TUNING.coreRadiusRatio;
    const segments = 24;
    const center = buffers.positions.length / 3;
    buffers.positions.push(0, 0, 0);
    pushColor(buffers.colors, 0.015, 0.12, 0.24, 0.88);
    for (let segment = 0; segment <= segments; segment++) {
        const angle = segment / segments * Math.PI * 2;
        buffers.positions.push(Math.cos(angle) * coreRadius, 0, Math.sin(angle) * coreRadius);
        pushColor(buffers.colors, 0.06, 0.38, 0.56, 0.18);
    }
    for (let segment = 0; segment < segments; segment++) {
        buffers.indices.push(center, center + segment + 1, center + segment + 2);
    }

    // 破碎泡沫环让危险核心边界在比赛镜头下仍然可读，又避免一整圈白色贴纸感。
    for (let dash = 0; dash < 10; dash++) {
        const start = dash / 10 * Math.PI * 2;
        appendArcRibbon(buffers, coreRadius * 1.12, 0.13, start, start + 0.34, 2,
            0.72, 0.96, 1, 0.58);
    }
    return finishGeometry(buffers, coreRadius * 1.35);
}

function buildWhirlpoolAfterglowGeometry(): primitives.IGeometry {
    const buffers: GeometryBuffers = { positions: [], colors: [], indices: [] };
    const maxRadius = Math.max(1, WHIRLPOOL_BRAWL_TUNING.lateralRadius);
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

function finishGeometry(buffers: GeometryBuffers, radius: number): primitives.IGeometry {
    return {
        positions: buffers.positions,
        colors: buffers.colors,
        indices: buffers.indices,
        minPos: new Vec3(-radius, -0.01, -radius),
        maxPos: new Vec3(radius, 0.01, radius),
    };
}
