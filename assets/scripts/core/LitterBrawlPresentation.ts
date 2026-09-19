import { Material, Mesh, MeshRenderer, Node, utils } from 'cc';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import type { LitterClusterState } from './LitterBrawlController';
import { buildRigidLitterGeometry, buildSoftLitterGeometry } from './LitterDebrisGeometry';
import { sampleWaterFloatOffset, WATER_FLOAT_PROFILES } from './WaterFloatMotion';
import {
    applyWaterExplosionPhase,
    buildWaterExplosionGeometry,
    makeMineVertexMaterial,
} from './MineRelayBrawlPresentation';

const PRESENTATION_INTERVAL = 1 / 20;
const SPLASH_SECONDS = 0.42;
const SPLASH_POOL_SIZE = 2;
const RIGID_IMPACT_PULSE_SECONDS = 0.65;
const SOFT_PUSH_PULSE_SECONDS = 0.52;

type SplashVisual = { node: Node; remaining: number };

/** 共享网格、共享材质、固定对象池；比赛中仅以 20Hz 修改显隐和变换。 */
export class LitterBrawlPresentation {
    private readonly clusterNodes: Node[] = [];
    private readonly clusterRenderers: MeshRenderer[] = [];
    private readonly generations: number[] = [];
    private readonly phases: Array<LitterClusterState['phase'] | null> = [];
    private readonly impactRevisions: number[] = [];
    private readonly impactPulses: number[] = [];
    private readonly splashes: SplashVisual[] = [];
    private rigidMesh: Mesh | null = null;
    private softMesh: Mesh | null = null;
    private splashMesh: Mesh | null = null;
    private clusterMaterial: Material | null = null;
    private splashMaterial: Material | null = null;
    private elapsed = PRESENTATION_INTERVAL;
    private clock = 0;
    private visible = true;
    private disposed = false;

    constructor(private readonly worldRoot: Node, private readonly course: RaceCourseLayout, clusterCount: number) {
        if (!worldRoot?.isValid) return;
        const rigidMesh = utils.createMesh(buildRigidLitterGeometry());
        const softMesh = utils.createMesh(buildSoftLitterGeometry());
        const splashMesh = utils.createMesh(buildWaterExplosionGeometry());
        this.rigidMesh = rigidMesh;
        this.softMesh = softMesh;
        this.splashMesh = splashMesh;
        this.clusterMaterial = makeMineVertexMaterial('LitterClusterMaterial', true);
        this.splashMaterial = makeMineVertexMaterial('LitterLandingSplashMaterial', false);
        for (let id = 0; id < clusterCount; id++) {
            const node = this.makeMeshNode(`LitterCluster${id}`, id % 2 === 0 ? rigidMesh : softMesh, this.clusterMaterial);
            node.active = false;
            this.clusterNodes.push(node);
            this.clusterRenderers.push(node.getComponent(MeshRenderer)!);
            this.generations.push(-1);
            this.phases.push(null);
            this.impactRevisions.push(0);
            this.impactPulses.push(0);
        }
        for (let index = 0; index < SPLASH_POOL_SIZE; index++) {
            const node = this.makeMeshNode(`LitterLandingSplash${index}`, splashMesh, this.splashMaterial);
            node.active = false;
            this.splashes.push({ node, remaining: 0 });
        }
    }

    reset(): void {
        this.elapsed = PRESENTATION_INTERVAL;
        this.clock = 0;
        this.visible = true;
        for (let id = 0; id < this.clusterNodes.length; id++) {
            this.setActive(this.clusterNodes[id], false);
            this.generations[id] = -1;
            this.phases[id] = null;
            this.impactRevisions[id] = 0;
            this.impactPulses[id] = 0;
        }
        for (const splash of this.splashes) {
            splash.remaining = 0;
            this.setActive(splash.node, false);
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
            const active = !!cluster?.active;
            this.setActive(node, active);
            if (!active) {
                this.phases[id] = null;
                continue;
            }
            const generationChanged = this.generations[id] !== cluster.generation;
            if (generationChanged) {
                this.generations[id] = cluster.generation;
                this.phases[id] = cluster.phase;
                const nextMesh = cluster.kind === 'rigid' ? this.rigidMesh : this.softMesh;
                if (nextMesh && this.clusterRenderers[id].mesh !== nextMesh) this.clusterRenderers[id].mesh = nextMesh;
                node.name = cluster.kind === 'rigid' ? `RigidLitter${id}` : `SoftLitter${id}`;
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
                const startZ = cluster.throwSide * (this.course.poolWidth * 0.5 + 4.6);
                node.setWorldPosition(
                    targetX + Math.sin(t * Math.PI) * cluster.throwSide * 0.65,
                    targetY + (1 - t) * 5.4 + Math.sin(t * Math.PI) * 1.8,
                    lerp(startZ, cluster.lateral, smoothstep(t)),
                );
                if (cluster.kind === 'rigid') {
                    node.setRotationFromEuler(35 + t * 230, cluster.id * 53 + t * 330, 20 + t * 165);
                    node.setScale(0.76, 0.76, 0.76);
                } else {
                    node.setRotationFromEuler(18 + Math.sin(t * Math.PI * 3) * 28, cluster.id * 41 + t * 95, 8 + t * 70);
                    node.setScale(0.94 + Math.sin(t * Math.PI * 4) * 0.06, 0.88, 1);
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
                    node.setScale(0.72 * retireScale, 0.72 * retireScale, 0.72 * retireScale);
                } else {
                    const billow = 1 + Math.sin(phase * 0.79) * 0.045;
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
                        58 + Math.sin(phase * 0.61) * 12 + pushSway * 0.45,
                        cluster.visualVariant * 51 + Math.sin(phase * 0.29) * 24 + pushSway,
                        Math.cos(phase * 0.47) * 14 - pushSway * 0.7,
                    );
                    node.setScale(
                        0.93 * billow * retireScale,
                        (0.90 + (billow - 1) * 0.5) * retireScale,
                        0.96 * retireScale,
                    );
                }
            }
        }
        for (const splash of this.splashes) {
            if (splash.remaining <= 0) continue;
            splash.remaining = Math.max(0, splash.remaining - presentationStep);
            applyWaterExplosionPhase(splash.node, 1 - splash.remaining / SPLASH_SECONDS, 0.36);
            if (splash.remaining <= 0) this.setActive(splash.node, false);
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const node of this.clusterNodes) if (node.isValid) node.destroy();
        for (const splash of this.splashes) if (splash.node.isValid) splash.node.destroy();
        this.clusterNodes.length = 0;
        this.clusterRenderers.length = 0;
        this.splashes.length = 0;
        this.rigidMesh?.destroy();
        this.softMesh?.destroy();
        this.splashMesh?.destroy();
        this.clusterMaterial?.destroy();
        this.splashMaterial?.destroy();
    }

    private showLandingSplash(cluster: LitterClusterState): void {
        if (this.splashes.length === 0) return;
        let visual = this.splashes[0];
        for (const candidate of this.splashes) {
            if (candidate.remaining <= 0) { visual = candidate; break; }
            if (candidate.remaining < visual.remaining) visual = candidate;
        }
        visual.node.setWorldPosition(
            this.course.distanceToWorldX(cluster.courseX),
            this.course.waterY + 0.035,
            cluster.lateral,
        );
        visual.node.setRotationFromEuler(0, cluster.id * 71, 0);
        visual.remaining = SPLASH_SECONDS;
        applyWaterExplosionPhase(visual.node, 0, 0.36);
        this.setActive(visual.node, true);
    }

    private hideAll(): void {
        for (const node of this.clusterNodes) this.setActive(node, false);
        for (const splash of this.splashes) {
            splash.remaining = 0;
            this.setActive(splash.node, false);
        }
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
