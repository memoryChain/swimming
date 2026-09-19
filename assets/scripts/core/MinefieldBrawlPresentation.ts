import { Material, Mesh, MeshRenderer, Node, utils, Vec3 } from 'cc';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import type { MinefieldImpact, MinefieldMineState } from './MinefieldBrawlController';
import { sampleWaterFloatOffset, WATER_FLOAT_PROFILES } from './WaterFloatMotion';
import {
    buildMineGeometry,
    makeMineVertexMaterial,
} from './MineRelayBrawlPresentation';
import {
    ENTERTAINMENT_SPLASH_OWNER,
    ENTERTAINMENT_SPLASH_PROFILE,
    type EntertainmentSplashProfile,
    EntertainmentWaterSplashPool,
} from './EntertainmentWaterSplash';

const PRESENTATION_INTERVAL = 1 / 20;
const EXPLOSION_SECONDS = 0.58;
const MINEFIELD_EXPLOSION_INTENSITY = 1;
const ENTRY_STAGGER_SECONDS = 0.04;
const ENTRY_DISTURB_SECONDS = 0.28;
const ENTRY_RISE_SECONDS = 0.72;
const ENTRY_SETTLE_SECONDS = 0.3;
const ENTRY_TOTAL_SECONDS = ENTRY_DISTURB_SECONDS + ENTRY_RISE_SECONDS + ENTRY_SETTLE_SECONDS;
const ENTRY_START_DEPTH = 0.82;
const ENTRY_RISE_OVERSHOOT = 0.18;
const ENTRY_DISTURB_INTENSITY = 0.18;
const ENTRY_BREACH_INTENSITY = 0.34;
const ENTRY_DISTURB_VISUAL_SECONDS = 0.34;
const ENTRY_BREACH_VISUAL_SECONDS = 0.42;
const ENTRY_BREACH_SECONDS = ENTRY_DISTURB_SECONDS + ENTRY_RISE_SECONDS * 0.74;
const MINE_ROTATION_Y_DEGREES = 14;
const MINE_TILT_X_DEGREES = 9;
const MINE_TILT_Z_DEGREES = 7;

/** 共享网格和材质的低面数水雷池；运行时只更新节点显隐和变换。 */
export class MinefieldBrawlPresentation {
    private readonly mineNodes: Node[] = [];
    private readonly entryElapsed: number[] = [];
    private readonly entryWasArmed: boolean[] = [];
    private readonly entryDisturbanceShown: boolean[] = [];
    private readonly entryBreachShown: boolean[] = [];
    private mineMesh: Mesh | null = null;
    private mineMaterial: Material | null = null;
    private elapsed = PRESENTATION_INTERVAL;
    private clock = 0;
    private visible = true;
    private disposed = false;
    private readonly splashWorldPosition = new Vec3();

    constructor(
        private readonly worldRoot: Node,
        private readonly course: RaceCourseLayout,
        mineCount: number,
        private readonly waterSplashes: EntertainmentWaterSplashPool | null,
    ) {
        if (!worldRoot?.isValid) return;
        this.mineMesh = utils.createMesh(buildMineGeometry());
        this.mineMaterial = makeMineVertexMaterial('MinefieldBodyMaterial', true);
        for (let id = 0; id < mineCount; id++) {
            const node = this.makeMeshNode(`MinefieldMine${id}`, this.mineMesh, this.mineMaterial);
            node.setScale(1.08, 1.08, 1.08);
            node.active = false;
            this.mineNodes.push(node);
            this.entryElapsed.push(0);
            this.entryWasArmed.push(false);
            this.entryDisturbanceShown.push(false);
            this.entryBreachShown.push(false);
        }
    }

    reset(): void {
        this.elapsed = PRESENTATION_INTERVAL;
        this.clock = 0;
        this.visible = true;
        this.waterSplashes?.cancelOwner(ENTERTAINMENT_SPLASH_OWNER.MINEFIELD);
        // 下一次 20Hz 表现采样会从水下重新播放入场，避免重置帧在原点闪现。
        for (let id = 0; id < this.mineNodes.length; id++) {
            this.setActive(this.mineNodes[id], false);
            this.entryElapsed[id] = 0;
            this.entryWasArmed[id] = false;
            this.entryDisturbanceShown[id] = false;
            this.entryBreachShown[id] = false;
        }
    }

    update(dt: number, mines: readonly MinefieldMineState[], visible: boolean): void {
        if (this.disposed) return;
        if (visible !== this.visible) {
            this.visible = visible;
            if (!visible) {
                for (const node of this.mineNodes) this.setActive(node, false);
                this.waterSplashes?.cancelOwner(ENTERTAINMENT_SPLASH_OWNER.MINEFIELD);
            } else {
                this.elapsed = PRESENTATION_INTERVAL;
            }
        }
        if (!visible) {
            return;
        }
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        this.elapsed += step;
        if (this.elapsed < PRESENTATION_INTERVAL) return;
        const presentationStep = this.elapsed;
        this.elapsed = 0;
        this.clock += presentationStep;
        for (let id = 0; id < this.mineNodes.length; id++) {
            const node = this.mineNodes[id];
            const mine = mines[id];
            const armed = !!mine?.active && !!mine?.armed;
            if (!armed) {
                this.setActive(node, false);
                this.entryWasArmed[id] = false;
                this.entryElapsed[id] = 0;
                this.entryDisturbanceShown[id] = false;
                this.entryBreachShown[id] = false;
                continue;
            }
            if (!this.entryWasArmed[id]) {
                this.entryWasArmed[id] = true;
                this.entryElapsed[id] = -id * ENTRY_STAGGER_SECONDS;
                this.entryDisturbanceShown[id] = false;
                this.entryBreachShown[id] = false;
            }
            const previousEntryElapsed = this.entryElapsed[id];
            const entryElapsed = Math.min(ENTRY_TOTAL_SECONDS, previousEntryElapsed + presentationStep);
            this.entryElapsed[id] = entryElapsed;
            if (entryElapsed < 0) {
                this.setActive(node, false);
                continue;
            }
            if (!this.entryDisturbanceShown[id]) {
                this.entryDisturbanceShown[id] = true;
                this.showWaterVisual(
                    mine.courseX,
                    mine.lateral,
                    id * 43,
                    ENTERTAINMENT_SPLASH_PROFILE.HEAVY_ENTRY,
                    ENTRY_DISTURB_INTENSITY,
                    ENTRY_DISTURB_VISUAL_SECONDS,
                    true,
                );
            }
            if (!this.entryBreachShown[id]
                && previousEntryElapsed < ENTRY_BREACH_SECONDS
                && entryElapsed >= ENTRY_BREACH_SECONDS) {
                this.entryBreachShown[id] = true;
                this.showWaterVisual(
                    mine.courseX,
                    mine.lateral,
                    id * 47 + 19,
                    ENTERTAINMENT_SPLASH_PROFILE.HEAVY_ENTRY,
                    ENTRY_BREACH_INTENSITY,
                    ENTRY_BREACH_VISUAL_SECONDS,
                );
            }
            this.setActive(node, true);
            const floatOffset = sampleWaterFloatOffset(
                this.clock,
                id * 0.8,
                WATER_FLOAT_PROFILES.heavyHazard,
            );
            let height = this.course.waterY - ENTRY_START_DEPTH;
            let entryTilt = 24;
            if (entryElapsed >= ENTRY_DISTURB_SECONDS) {
                const riseProgress = clamp01((entryElapsed - ENTRY_DISTURB_SECONDS) / ENTRY_RISE_SECONDS);
                const easedRise = smoothStep(riseProgress);
                height += (ENTRY_START_DEPTH + ENTRY_RISE_OVERSHOOT) * easedRise;
                entryTilt *= 1 - easedRise;
                if (entryElapsed >= ENTRY_DISTURB_SECONDS + ENTRY_RISE_SECONDS) {
                    const settleProgress = clamp01(
                        (entryElapsed - ENTRY_DISTURB_SECONDS - ENTRY_RISE_SECONDS) / ENTRY_SETTLE_SECONDS,
                    );
                    const easedSettle = smoothStep(settleProgress);
                    height = this.course.waterY + 0.09
                        + ENTRY_RISE_OVERSHOOT * (1 - easedSettle)
                        + floatOffset * easedSettle;
                }
            } else {
                height += Math.sin(this.clock * 5.2 + id) * 0.025;
            }
            node.setWorldPosition(this.course.distanceToWorldX(mine.courseX), height, mine.lateral);
            const rotationPhase = this.clock + id * 0.73;
            node.setRotationFromEuler(
                Math.sin(rotationPhase * 0.55) * MINE_TILT_X_DEGREES + entryTilt,
                rotationPhase * (MINE_ROTATION_Y_DEGREES + id * 0.65) + id * 31,
                Math.cos(rotationPhase * 0.43 + 0.8) * MINE_TILT_Z_DEGREES - entryTilt * 0.55,
            );
        }
    }

    showImpact(impact: MinefieldImpact): void {
        if (this.disposed || !this.visible) return;
        this.showWaterVisual(
            impact.courseX,
            impact.lateral,
            impact.mineId * 47,
            ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION,
            MINEFIELD_EXPLOSION_INTENSITY,
            EXPLOSION_SECONDS,
        );
    }

    private showWaterVisual(
        courseX: number,
        lateral: number,
        rotationY: number,
        profile: EntertainmentSplashProfile,
        intensity: number,
        duration: number,
        rippleOnly = false,
    ): void {
        if (this.disposed || !this.visible) return;
        this.splashWorldPosition.set(
            this.course.distanceToWorldX(courseX),
            this.course.waterY + 0.05,
            lateral,
        );
        this.waterSplashes?.play({
            owner: ENTERTAINMENT_SPLASH_OWNER.MINEFIELD,
            profile,
            position: this.splashWorldPosition,
            yawDegrees: rotationY,
            intensity,
            duration,
            rippleOnly,
            layer: this.worldRoot.layer,
        });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.waterSplashes?.cancelOwner(ENTERTAINMENT_SPLASH_OWNER.MINEFIELD);
        for (const node of this.mineNodes) if (node.isValid) node.destroy();
        this.mineNodes.length = 0;
        this.mineMesh?.destroy();
        this.mineMaterial?.destroy();
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

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function smoothStep(value: number): number {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
}
