import { Node, Vec3 } from 'cc';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import type { MinefieldImpact, MinefieldMineState } from './MinefieldBrawlController';
import { sampleWaterFloatOffset, WATER_FLOAT_PROFILES } from './WaterFloatMotion';
import { RESOURCE_PATHS } from './ResourcePaths';
import { WaterPlayObstacleModels, SPRAY_BUOY_NOZZLE_HEIGHT, SPRAY_BUOY_TETHER_ANCHOR } from './WaterPlayObstacleModel';
import {
    ENTERTAINMENT_SPLASH_OWNER,
    ENTERTAINMENT_SPLASH_PROFILE,
    type EntertainmentSplashProfile,
    EntertainmentWaterSplashPool,
} from './EntertainmentWaterSplash';

const PRESENTATION_INTERVAL = 1 / 20;
const EXPLOSION_SECONDS = 0.95;
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
const EXIT_SECONDS = 0.3;

/** 气球喷水浮标池；爆开、下压和下潜仅消费权威命中的短期视觉状态。 */
export class MinefieldBrawlPresentation {
    private readonly mineNodes: Node[] = [];
    private readonly balloonNodes: Array<Node | null> = [];
    private readonly entryElapsed: number[] = [];
    private readonly entryWasArmed: boolean[] = [];
    private readonly entryGeneration: number[] = [];
    private readonly entryDisturbanceShown: boolean[] = [];
    private readonly entryBreachShown: boolean[] = [];
    private models: WaterPlayObstacleModels | null = null;
    private readonly exitElapsed: number[] = [];
    private readonly exitStartY: number[] = [];
    private readonly lastImpactRevision: number[] = [];
    private elapsed = PRESENTATION_INTERVAL;
    private clock = 0;
    private visible = true;
    private disposed = false;
    private readonly splashWorldPosition = new Vec3();
    private readonly explosionCoreWorldPosition = new Vec3();
    private readonly sprayLocal = new Vec3(0, SPRAY_BUOY_NOZZLE_HEIGHT, 0);

    constructor(
        private readonly worldRoot: Node,
        private readonly course: RaceCourseLayout,
        mineCount: number,
        private readonly waterSplashes: EntertainmentWaterSplashPool | null,
        private readonly playPop: (() => void) | null = null,
    ) {
        if (!worldRoot?.isValid) return;
        for (let id = 0; id < mineCount; id++) {
            const node = new Node(`SprayBuoy${id}`);
            node.setParent(this.worldRoot);
            node.layer = this.worldRoot.layer;
            node.active = false;
            this.mineNodes.push(node);
            this.entryElapsed.push(0);
            this.entryWasArmed.push(false);
            this.entryGeneration.push(-1);
            this.entryDisturbanceShown.push(false);
            this.entryBreachShown.push(false);
            this.exitElapsed.push(EXIT_SECONDS);
            this.exitStartY.push(0);
            this.lastImpactRevision.push(-1);
        }
        this.models = new WaterPlayObstacleModels('SprayBuoy', this.mineNodes, RESOURCE_PATHS.sprayBuoyPrefabCandidates);
        for (let id = 0; id < mineCount; id++) {
            const balloon = this.models.part(id, 'BuoyBalloon');
            if (balloon) {
                balloon.setPosition(SPRAY_BUOY_TETHER_ANCHOR.x, SPRAY_BUOY_TETHER_ANCHOR.y, SPRAY_BUOY_TETHER_ANCHOR.z);
            }
            this.balloonNodes.push(balloon);
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
            this.entryGeneration[id] = -1;
            this.entryDisturbanceShown[id] = false;
            this.entryBreachShown[id] = false;
            this.exitElapsed[id] = EXIT_SECONDS;
            this.lastImpactRevision[id] = -1;
            this.mineNodes[id].setScale(1, 1, 1);
            this.resetBalloon(id);
        }
    }

    /** 网络快照只恢复当前外观，不补播气球爆开或声音。 */
    restoreSnapshot(mines: readonly MinefieldMineState[]): void {
        if (this.disposed) return;
        for (let id = 0; id < this.mineNodes.length; id++) {
            const mine = mines[id];
            if (!mine?.active || !mine.armed) continue;
            if (mine.generation !== this.entryGeneration[id]) {
                this.entryGeneration[id] = mine.generation;
                this.exitElapsed[id] = EXIT_SECONDS;
                this.mineNodes[id].setScale(1, 1, 1);
                this.resetBalloon(id);
            }
            this.entryWasArmed[id] = true;
            this.entryElapsed[id] = ENTRY_TOTAL_SECONDS;
            this.entryDisturbanceShown[id] = true;
            this.entryBreachShown[id] = true;
        }
        this.elapsed = PRESENTATION_INTERVAL;
    }

    update(dt: number, mines: readonly MinefieldMineState[], visible: boolean): void {
        if (this.disposed) return;
        if (visible !== this.visible) {
            this.visible = visible;
            if (!visible) {
                for (let id = 0; id < this.mineNodes.length; id++) {
                    this.setActive(this.mineNodes[id], false);
                    this.exitElapsed[id] = EXIT_SECONDS;
                    this.resetBalloon(id);
                }
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
            const generation = mine?.generation ?? -1;
            if (generation !== this.entryGeneration[id]) {
                this.entryGeneration[id] = generation;
                this.entryWasArmed[id] = false;
                this.entryElapsed[id] = 0;
                this.entryDisturbanceShown[id] = false;
                this.entryBreachShown[id] = false;
                this.exitElapsed[id] = EXIT_SECONDS;
                node.setScale(1, 1, 1);
                this.resetBalloon(id);
            }
            const armed = !!mine?.active && !!mine?.armed;
            if (!mine?.active) {
                if (this.exitElapsed[id] < EXIT_SECONDS) {
                    const t = Math.min(1, (this.exitElapsed[id] + presentationStep) / EXIT_SECONDS);
                    this.exitElapsed[id] = t * EXIT_SECONDS;
                    node.setWorldPosition(node.worldPosition.x, this.exitStartY[id] - 0.85 * t * t, node.worldPosition.z);
                    node.setScale(1 + Math.sin(t * Math.PI) * 0.035, 1 - Math.sin(t * Math.PI) * 0.16, 1 + Math.sin(t * Math.PI) * 0.035);
                    this.updateBalloonPop(id, this.exitElapsed[id]);
                    if (t >= 1) this.setActive(node, false);
                    continue;
                }
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
            const entryElapsed = Math.min(ENTRY_TOTAL_SECONDS,
                Math.max(armed ? 0 : -ENTRY_TOTAL_SECONDS, previousEntryElapsed + presentationStep));
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
            // 已可接触时至少露出软边与气球，不能等待完整入场才显示障碍。
            if (armed) height = Math.max(height, this.course.waterY - 0.04);
            node.setWorldPosition(this.course.distanceToWorldX(mine.courseX), height, mine.lateral);
            const rotationPhase = this.clock + id * 0.73;
            node.setRotationFromEuler(
                Math.sin(rotationPhase * 0.55) * MINE_TILT_X_DEGREES + entryTilt,
                rotationPhase * (MINE_ROTATION_Y_DEGREES + id * 0.65) + id * 31,
                Math.cos(rotationPhase * 0.43 + 0.8) * MINE_TILT_Z_DEGREES - entryTilt * 0.55,
            );
            const balloon = this.balloonNodes[id];
            if (balloon?.isValid) {
                this.setActive(balloon, true);
                const unfold = smoothStep(clamp01((entryElapsed - ENTRY_DISTURB_SECONDS) / ENTRY_RISE_SECONDS));
                const scale = 0.35 + 0.65 * unfold;
                const scaleY = 0.22 + 0.78 * unfold;
                if (balloon.scale.x !== scale || balloon.scale.y !== scaleY || balloon.scale.z !== scale) {
                    balloon.setScale(scale, scaleY, scale);
                }
                balloon.setRotationFromEuler(Math.sin(rotationPhase * 0.8 - 0.5) * 4 * unfold, 0,
                    Math.cos(rotationPhase * 0.66 - 0.8) * 5 * unfold + (1 - unfold) * 12);
            }
        }
    }

    showImpact(impact: MinefieldImpact, currentMine?: Readonly<MinefieldMineState>, currentRevision = impact.revision): void {
        if (this.disposed || !this.visible) return;
        const id = impact.mineId;
        // 迟到结果仍由控制器结算；不允许旧事件隐藏新一代或重播已结束的喷水。
        if (!this.mineNodes[id] || impact.revision < currentRevision
            || impact.revision <= this.lastImpactRevision[id] || currentMine?.active) return;
        this.lastImpactRevision[id] = impact.revision;
        const mineNode = this.mineNodes[impact.mineId];
        const sameGeneration = !currentMine || currentMine.generation === this.entryGeneration[id];
        this.explosionCoreWorldPosition.set(
            this.course.distanceToWorldX(impact.courseX),
            this.course.waterY + 0.09 + SPRAY_BUOY_NOZZLE_HEIGHT,
            impact.lateral,
        );
        if (sameGeneration && mineNode?.isValid && mineNode.active) {
            Vec3.transformMat4(this.explosionCoreWorldPosition, this.sprayLocal, mineNode.worldMatrix);
            this.exitStartY[id] = mineNode.worldPosition.y;
            this.exitElapsed[id] = 0;
            // 同一触发帧即可读到轻压；不等待动画或 Tween 回调结算命中。
            mineNode.setScale(1.02, 0.92, 1.02);
            this.updateBalloonPop(id, 0);
        }
        this.playPop?.();
        this.showWaterVisual(
            impact.courseX,
            impact.lateral,
            impact.mineId * 47,
            ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION,
            MINEFIELD_EXPLOSION_INTENSITY,
            EXPLOSION_SECONDS,
            false,
            this.explosionCoreWorldPosition,
        );
    }

    private resetBalloon(id: number): void {
        const balloon = this.balloonNodes[id];
        if (!balloon?.isValid) return;
        this.setActive(balloon, true);
        balloon.setScale(1, 1, 1);
        balloon.setRotationFromEuler(0, 0, 0);
    }

    private updateBalloonPop(id: number, elapsed: number): void {
        const balloon = this.balloonNodes[id];
        if (!balloon?.isValid) return;
        if (elapsed >= 0.10) {
            this.setActive(balloon, false);
            return;
        }
        const t = Math.max(0, elapsed / 0.10);
        balloon.setScale(1.16 + 0.10 * t, 0.90 - 0.65 * t, 1.16 + 0.10 * t);
    }

    private showWaterVisual(
        courseX: number,
        lateral: number,
        rotationY: number,
        profile: EntertainmentSplashProfile,
        intensity: number,
        duration: number,
        rippleOnly = false,
        explosionCorePosition?: Readonly<Vec3>,
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
            explosionCorePosition,
            layer: this.worldRoot.layer,
        });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.waterSplashes?.cancelOwner(ENTERTAINMENT_SPLASH_OWNER.MINEFIELD);
        for (const node of this.mineNodes) if (node.isValid) node.destroy();
        this.mineNodes.length = 0;
        this.models?.dispose();
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
