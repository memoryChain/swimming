import { Color, Material, Mesh, MeshRenderer, Node, utils, Vec3 } from 'cc';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import type { LitterClusterState } from './LitterBrawlController';
import { buildBottleLitterGeometry, buildMealTrayLitterGeometry } from './LitterDebrisGeometry';
import { sampleWaterFloatOffset, WATER_FLOAT_PROFILES } from './WaterFloatMotion';
import {
    ENTERTAINMENT_SPLASH_OWNER,
    ENTERTAINMENT_SPLASH_PROFILE,
    EntertainmentWaterSplashPool,
} from './EntertainmentWaterSplash';

const PRESENTATION_INTERVAL = 1 / 20;
const SOFT_SPLASH_SECONDS = 0.38;
const RIGID_SPLASH_SECONDS = 0.48;
const BOTTLE_SPLASH_INTENSITY = 0.4;
const BOTTLE_SPLASH_RADIAL_SCALE = 0.5;
const BOTTLE_SPLASH_VERTICAL_SCALE = 0.62;
const TRAY_SPLASH_INTENSITY = 0.36;
const TRAY_SPLASH_RADIAL_SCALE = 0.82;
const TRAY_SPLASH_VERTICAL_SCALE = 0.44;
const RIGID_IMPACT_PULSE_SECONDS = 0.65;
const SOFT_PUSH_PULSE_SECONDS = 0.52;

/** 共享网格、共享材质、固定对象池；比赛中仅以 20Hz 修改显隐和变换。 */
export class LitterBrawlPresentation {
    private readonly clusterNodes: Node[] = [];
    private readonly clusterRenderers: MeshRenderer[] = [];
    private readonly generations: number[] = [];
    private readonly phases: Array<LitterClusterState['phase'] | null> = [];
    private readonly impactRevisions: number[] = [];
    private readonly impactPulses: number[] = [];
    private readonly bottleMeshes: Mesh[] = [];
    private trayMesh: Mesh | null = null;
    private clusterMaterial: Material | null = null;
    private elapsed = PRESENTATION_INTERVAL;
    private clock = 0;
    private visible = true;
    private disposed = false;
    private readonly splashWorldPosition = new Vec3();

    constructor(
        private readonly worldRoot: Node,
        private readonly course: RaceCourseLayout,
        clusterCount: number,
        private readonly waterSplashes: EntertainmentWaterSplashPool | null,
    ) {
        if (!worldRoot?.isValid) return;
        for (let variant = 0; variant < 3; variant++) {
            this.bottleMeshes.push(utils.createMesh(buildBottleLitterGeometry(variant)));
        }
        const trayMesh = utils.createMesh(buildMealTrayLitterGeometry());
        this.trayMesh = trayMesh;
        this.clusterMaterial = new Material();
        this.clusterMaterial.initialize({
            effectName: 'builtin-unlit',
            technique: 0,
            // 四种网格分别合批；不支持实例化的设备由引擎回退到普通绘制。
            // 必须在共享材质初始化时启用，不能创建逐节点材质实例。
            defines: { USE_VERTEX_COLOR: true, USE_INSTANCING: true },
        });
        this.clusterMaterial.name = 'LitterClusterMaterial';
        this.clusterMaterial.setProperty('mainColor', Color.WHITE);
        for (let id = 0; id < clusterCount; id++) {
            const node = this.makeMeshNode(`LitterCluster${id}`, this.bottleMeshes[id % 3], this.clusterMaterial);
            node.active = false;
            this.clusterNodes.push(node);
            this.clusterRenderers.push(node.getComponent(MeshRenderer)!);
            this.generations.push(-1);
            this.phases.push(null);
            this.impactRevisions.push(0);
            this.impactPulses.push(0);
        }
    }

    reset(): void {
        this.elapsed = PRESENTATION_INTERVAL;
        this.clock = 0;
        this.visible = true;
        this.waterSplashes?.cancelOwner(ENTERTAINMENT_SPLASH_OWNER.LITTER);
        for (let id = 0; id < this.clusterNodes.length; id++) {
            this.setActive(this.clusterNodes[id], false);
            this.generations[id] = -1;
            this.phases[id] = null;
            this.impactRevisions[id] = 0;
            this.impactPulses[id] = 0;
        }
    }

    update(dt: number, clusters: readonly LitterClusterState[], visible: boolean): void {
        if (this.disposed) return;
        if (visible !== this.visible) {
            this.visible = visible;
            if (!visible) this.hideAll();
            else this.elapsed = PRESENTATION_INTERVAL;
        }
        if (!visible) return;
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        this.elapsed += step;
        if (this.elapsed < PRESENTATION_INTERVAL) return;
        const presentationStep = this.elapsed;
        this.elapsed = 0;
        this.clock += presentationStep;
        for (let id = 0; id < this.clusterNodes.length; id++) {
            const node = this.clusterNodes[id];
            const cluster = clusters[id];
            const active = !!cluster?.active && !(cluster.phase === 'falling' && cluster.phaseProgress < 0);
            this.setActive(node, active);
            if (!active) {
                this.phases[id] = null;
                continue;
            }
            const generationChanged = this.generations[id] !== cluster.generation;
            if (generationChanged) {
                this.generations[id] = cluster.generation;
                this.phases[id] = cluster.phase;
                const nextMesh = cluster.kind === 'rigid'
                    ? this.bottleMeshes[cluster.visualVariant % this.bottleMeshes.length]
                    : this.trayMesh;
                if (nextMesh && this.clusterRenderers[id].mesh !== nextMesh) this.clusterRenderers[id].mesh = nextMesh;
                node.name = cluster.kind === 'rigid' ? `BottleLitter${id}` : `MealTrayLitter${id}`;
            } else if (this.phases[id] !== cluster.phase) {
                if (this.phases[id] === 'falling' && cluster.phase === 'floating') {
                    this.showLandingSplash(cluster);
                }
                this.phases[id] = cluster.phase;
            }
            if (this.impactRevisions[id] !== cluster.impactRevision) {
                this.impactRevisions[id] = cluster.impactRevision;
                this.impactPulses[id] = cluster.kind === 'rigid'
                    ? RIGID_IMPACT_PULSE_SECONDS
                    : SOFT_PUSH_PULSE_SECONDS;
            }
            this.impactPulses[id] = Math.max(0, this.impactPulses[id] - presentationStep);
            const targetX = this.course.distanceToWorldX(cluster.courseX);
            const targetY = this.course.waterY + 0.08;
            if (cluster.phase === 'falling') {
                const t = clamp01(cluster.phaseProgress);
                // 从看台方向高处抛入，仍消费原权威预警进度与落点。
                const startZ = cluster.throwSide * (this.course.poolWidth * 0.5 + 4.6);
                const phase = this.clock * 2.1 + cluster.id * 0.83;
                const floatInstancePhase = cluster.id * 0.83 + cluster.visualVariant * 0.19;
                const rigid = cluster.kind === 'rigid';
                const airborne = 1 - smoothstep(t);
                node.setWorldPosition(
                    targetX + Math.sin(t * Math.PI) * cluster.throwSide * 0.65,
                    targetY + (rigid ? 0.035 : 0.015)
                        + sampleWaterFloatOffset(this.clock, floatInstancePhase,
                            rigid ? WATER_FLOAT_PROFILES.rigidDebris : WATER_FLOAT_PROFILES.softDebris)
                        + (1 - t) * 5.4 + Math.sin(t * Math.PI) * 1.8,
                    lerp(startZ, cluster.lateral, smoothstep(t)),
                );
                if (rigid) {
                    node.setRotationFromEuler(
                        this.clock * 24 * (cluster.id % 2 === 0 ? 1 : -1) + Math.sin(phase * 0.55) * 8
                            - airborne * 300 * cluster.throwSide,
                        cluster.visualVariant * 63 + Math.sin(phase * 0.31) * 14 - airborne * 230,
                        Math.cos(phase * 0.43) * 7 + airborne * 145,
                    );
                    this.setUniformScale(node, 0.68);
                } else {
                    node.setRotationFromEuler(
                        67 + Math.sin(phase * 0.61) * 6 - airborne * 125,
                        cluster.id * 29 + Math.sin(phase * 0.29) * 16 - airborne * 150,
                        Math.sin(phase * 0.79) * 2.8 + airborne * 65,
                    );
                    this.setUniformScale(node, 0.88);
                }
            } else {
                const phase = this.clock * 2.1 + cluster.id * 0.83;
                const floatInstancePhase = cluster.id * 0.83 + cluster.visualVariant * 0.19;
                const retireProgress = cluster.phase === 'retiring' ? clamp01(cluster.phaseProgress) : 0;
                const sink = smoothstep(retireProgress) * 0.72;
                const retireShrink = smoothstep(clamp01((retireProgress - 0.55) / 0.45));
                const retireScale = 1 - retireShrink * 0.34;
                if (cluster.kind === 'rigid') {
                    const impactProgress = this.impactPulses[id] > 0
                        ? 1 - this.impactPulses[id] / RIGID_IMPACT_PULSE_SECONDS
                        : 1;
                    const bounce = impactProgress < 1
                        ? Math.sin(impactProgress * Math.PI * 2.4) * (1 - impactProgress) * 125
                        : 0;
                    const rollDirection = cluster.id % 2 === 0 ? 1 : -1;
                    node.setWorldPosition(
                        targetX,
                        targetY + 0.035
                            + sampleWaterFloatOffset(
                                this.clock,
                                floatInstancePhase,
                                WATER_FLOAT_PROFILES.rigidDebris,
                            )
                            - sink,
                        cluster.lateral,
                    );
                    node.setRotationFromEuler(
                        this.clock * 24 * rollDirection + Math.sin(phase * 0.55) * 8 + bounce,
                        cluster.visualVariant * 63 + Math.sin(phase * 0.31) * 14 + bounce * 1.45,
                        Math.cos(phase * 0.43) * 7,
                    );
                    this.setUniformScale(node, 0.68 * retireScale);
                } else {
                    const trayRock = Math.sin(phase * 0.79) * 2.8;
                    const pushProgress = this.impactPulses[id] > 0
                        ? 1 - this.impactPulses[id] / SOFT_PUSH_PULSE_SECONDS
                        : 1;
                    const pushSway = pushProgress < 1
                        ? Math.sin(pushProgress * Math.PI) * (1 - pushProgress) * 18
                        : 0;
                    node.setWorldPosition(
                        targetX,
                        targetY + 0.015
                            + sampleWaterFloatOffset(
                                this.clock,
                                floatInstancePhase,
                                WATER_FLOAT_PROFILES.softDebris,
                            )
                            - sink,
                        cluster.lateral,
                    );
                    node.setRotationFromEuler(
                        67 + Math.sin(phase * 0.61) * 6 + pushSway * 0.28,
                        cluster.id * 29 + Math.sin(phase * 0.29) * 16 + pushSway,
                        trayRock - pushSway * 0.55,
                    );
                    this.setUniformScale(node, 0.88 * retireScale);
                }
            }
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.waterSplashes?.cancelOwner(ENTERTAINMENT_SPLASH_OWNER.LITTER);
        for (const node of this.clusterNodes) if (node.isValid) node.destroy();
        this.clusterNodes.length = 0;
        this.clusterRenderers.length = 0;
        for (const mesh of this.bottleMeshes) mesh.destroy();
        this.bottleMeshes.length = 0;
        this.trayMesh?.destroy();
        this.clusterMaterial?.destroy();
    }

    private showLandingSplash(cluster: LitterClusterState): void {
        this.splashWorldPosition.set(
            this.course.distanceToWorldX(cluster.anchorCourseX),
            this.course.waterY + 0.035,
            cluster.anchorLateral,
        );
        this.waterSplashes?.play({
            owner: ENTERTAINMENT_SPLASH_OWNER.LITTER,
            profile: cluster.kind === 'rigid'
                ? ENTERTAINMENT_SPLASH_PROFILE.HEAVY_ENTRY
                : ENTERTAINMENT_SPLASH_PROFILE.LIGHT_ENTRY,
            position: this.splashWorldPosition,
            yawDegrees: cluster.throwSide > 0 ? 180 : 0,
            intensity: cluster.kind === 'rigid' ? BOTTLE_SPLASH_INTENSITY : TRAY_SPLASH_INTENSITY,
            duration: cluster.kind === 'rigid' ? RIGID_SPLASH_SECONDS : SOFT_SPLASH_SECONDS,
            radialScale: cluster.kind === 'rigid' ? BOTTLE_SPLASH_RADIAL_SCALE : TRAY_SPLASH_RADIAL_SCALE,
            verticalScale: cluster.kind === 'rigid' ? BOTTLE_SPLASH_VERTICAL_SCALE : TRAY_SPLASH_VERTICAL_SCALE,
            layer: this.worldRoot.layer,
        });
    }

    private hideAll(): void {
        for (const node of this.clusterNodes) this.setActive(node, false);
        this.waterSplashes?.cancelOwner(ENTERTAINMENT_SPLASH_OWNER.LITTER);
    }

    private makeMeshNode(name: string, mesh: Mesh, material: Material): Node {
        const node = new Node(name);
        node.setParent(this.worldRoot);
        node.layer = this.worldRoot.layer;
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = mesh;
        renderer.setMaterial(material, 0);
        return node;
    }

    private setActive(node: Node, active: boolean): void {
        if (node.isValid && node.active !== active) node.active = active;
    }

    private setUniformScale(node: Node, scale: number): void {
        if (node.scale.x !== scale || node.scale.y !== scale || node.scale.z !== scale) {
            node.setScale(scale, scale, scale);
        }
    }
}

function smoothstep(value: number): number {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}
