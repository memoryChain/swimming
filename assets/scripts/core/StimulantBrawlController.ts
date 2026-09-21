import { Color, gfx, instantiate, Material, Mesh, MeshRenderer, Node, Prefab, primitives, utils, Vec3 } from 'cc';
import { PlayerConditionModel } from '../condition/PlayerConditionModel';
import { AiConditionModel } from '../condition/AiConditionModel';
import { Swimmer } from '../entity/Swimmer';
import { LaneLayout } from '../venue/LaneLayout';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { loadRaceAsset } from './RaceBundleLoader';
import { RESOURCE_PATHS } from './ResourcePaths';
import { sampleWaterFloatOffset, WATER_FLOAT_PROFILES, waterFloatPhase } from './WaterFloatMotion';
import {
    ENTERTAINMENT_SPLASH_OWNER,
    ENTERTAINMENT_SPLASH_PROFILE,
    EntertainmentWaterSplashPool,
} from './EntertainmentWaterSplash';
import {
    buildStimulantSchedule,
    stimulantIsOnCurrentCourseLeg,
    stimulantPickupDistanceSquared,
    STIMULANT_BRAWL_TUNING,
    StimulantItemKind,
    StimulantSpawn,
} from './StimulantBrawlRules';

type Condition = PlayerConditionModel | AiConditionModel;
type Racer = { swimmer: Swimmer; condition: Condition };
type ItemState = StimulantSpawn & {
    collected: boolean;
    node: Node | null;
    beaconNode: Node | null;
    x: number;
    z: number;
    baseY: number;
    phase: number;
    pickupEffectRemaining: number;
    visualSpawnStarted: boolean;
    visualLanded: boolean;
    throwElapsed: number;
};

export type StimulantPickup = { itemId: number; collectorLane: number; revision: number };
export type StimulantPickupFeedback = StimulantPickup & {
    kind: StimulantItemKind;
    wave: number;
    local: boolean;
    energyRatioBefore: number;
    energyRatioAfter: number;
    infiniteStamina: boolean;
    energyRestored: number;
    heartRateBefore: number;
    heartRate: number;
};

const ITEM_VISIBLE_DISTANCE = 38;
const BEACON_VISIBLE_AHEAD_DISTANCE = 82;
const BEACON_VISIBLE_BEHIND_DISTANCE = 8;
const WAVE_ANNOUNCEMENT_LEAD_DISTANCE = 18;
const PRESENTATION_INTERVAL = 1 / 20;
const ITEM_SCALE = 0.9;
const ITEM_MODEL_SCALE = 0.84;
const ITEM_BASE_Y_OFFSET = 0.4;
const ITEM_MODEL_HALF_HEIGHT = 0.68;
const ITEM_YAW_SPEED_DEGREES = 34;
const ITEM_BASE_LEAN_DEGREES = 8;
const ITEM_PITCH_SWAY_DEGREES = 2.25;
const ITEM_ROLL_SWAY_DEGREES = 3;
// 冰沙杯比斜切药瓶更矮、更接近轴对称；只放大同一波形的摇摆幅度，漂浮节奏仍完全共享。
const CALM_SLUSH_SWAY_READABILITY_SCALE = 1.55;
const CALM_SLUSH_YAW_READABILITY_SCALE = 1.18;
const BEACON_HEIGHT = 10.5;
const BEACON_HALF_WIDTH = 0.3;
const BEACON_HALO_INNER_RADIUS = 0.52;
const BEACON_HALO_PEAK_RADIUS = 0.72;
const BEACON_BASE_RADIUS = 0.94;
const BEACON_BASE_Y_OFFSET = 0.04;
const BEACON_COLUMN_GAP = 0.24;
const BEACON_COLUMN_BOTTOM = ITEM_BASE_Y_OFFSET
    + ITEM_MODEL_HALF_HEIGHT * ITEM_MODEL_SCALE
    + BEACON_COLUMN_GAP
    - BEACON_BASE_Y_OFFSET;
const BEACON_PICKUP_COLLAPSE_SECONDS = 0.28;
const THROW_TRIGGER_AHEAD_DISTANCE = 18;
const THROW_FORCE_LANDED_AHEAD_DISTANCE = 6;
const THROW_SECONDS = 1.25;
const THROW_STAGGER_SECONDS = 0.08;
const THROW_STAND_OFFSET = 4.6;
const THROW_START_HEIGHT = 5.4;
const THROW_ARC_HEIGHT = 1.8;
const THROW_ALONG_ARC_DISTANCE = 0.65;
const BEACON_REVEAL_START = 0.72;
const LANDING_SPLASH_SECONDS = 0.42;
const LANDING_SPLASH_INTENSITY = 0.30;
const MAX_PICKUP_SWEEP_DISTANCE = 3;
const VISUAL_ITEMS_PER_FRAME = 2;
const MODEL_INSTANCES_PER_FRAME = 1;
const STIMULANT_CUBE_COLOR = new Color(92, 255, 48, 255);
const CALM_SLUSH_CUBE_COLOR = new Color(82, 218, 255, 255);

/** 赛前只加载资源；实例化由控制器按帧预算执行，不触发玩法状态。 */
export function preloadStimulantBrawlModels(): void {
    preloadCandidate(RESOURCE_PATHS.stimulantBottlePrefabCandidates, 0);
    preloadCandidate(RESOURCE_PATHS.calmSlushPrefabCandidates, 0);
}

function preloadCandidate(candidates: readonly string[], index: number): void {
    if (index >= candidates.length) return;
    loadRaceAsset(candidates[index], Prefab, (error, prefab) => {
        if (error || !prefab) preloadCandidate(candidates, index + 1);
    });
}

type ModelBuildJob = {
    kind: StimulantItemKind;
    candidates: readonly string[];
    candidateIndex: number;
    failures: string[];
    prefab: Prefab;
    itemIndex: number;
    validated: boolean;
};

/** 心跳苏打玩法的独立规则控制器；GameManager 只负责传入泳者和网络事件。 */
export class StimulantBrawlController {
    private readonly items: ItemState[];
    private revision = 0;
    // 世界回收位图与本端效果结算独立，快照抢先不能吞掉领取收益。
    private readonly collectorLanes: number[] = [];
    private readonly pickupRevisions: number[] = [];
    private settledPickupRevision = 0;
    private disposed = false;
    private announcedWaveMask = 0;
    private presentationElapsed = PRESENTATION_INTERVAL;
    private presentationTime = 0;
    private visualMesh: Mesh | null = null;
    private readonly visualMaterials: Material[] = [];
    private readonly beaconMeshes: Mesh[] = [];
    private beaconMaterial: Material | null = null;
    private visualBuildIndex = 0;
    private readonly modelBuildJobs: ModelBuildJob[] = [];
    private readonly pickupRacers: Array<Racer | null>;
    private readonly pickupCurrentX: Float64Array;
    private readonly pickupCurrentZ: Float64Array;
    private readonly pickupPreviousX: Float64Array;
    private readonly pickupPreviousZ: Float64Array;
    private readonly splashWorldPosition = new Vec3();

    constructor(
        private readonly root: Node,
        seed: number,
        private readonly laneLayout: LaneLayout,
        private readonly course: RaceCourseLayout,
        racerForLane: (lane: number) => Racer | null,
        private readonly resolveAuthoritatively: (pickup: StimulantPickup) => void,
        private readonly onPickup: (feedback: StimulantPickupFeedback) => void,
        private readonly onWaveApproach: (wave: number, kind: StimulantItemKind) => void,
        private readonly localPlayerLane: () => number,
        private readonly waterSplashes: EntertainmentWaterSplashPool | null,
        schedule?: readonly StimulantSpawn[],
    ) {
        this.pickupRacers = new Array<Racer | null>(laneLayout.laneCount).fill(null);
        this.pickupCurrentX = new Float64Array(laneLayout.laneCount);
        this.pickupCurrentZ = new Float64Array(laneLayout.laneCount);
        this.pickupPreviousX = new Float64Array(laneLayout.laneCount);
        this.pickupPreviousZ = new Float64Array(laneLayout.laneCount);
        this.pickupCurrentX.fill(Number.NaN);
        this.pickupCurrentZ.fill(Number.NaN);
        this.pickupPreviousX.fill(Number.NaN);
        this.pickupPreviousZ.fill(Number.NaN);
        for (let lane = 0; lane < laneLayout.laneCount; lane++) {
            this.pickupRacers[lane] = racerForLane(lane);
        }
        this.items = (schedule ?? buildStimulantSchedule(seed, laneLayout.laneCount)).map(spawn => {
            const laneZ = laneLayout.centerZ(spawn.laneIndex) + spawn.lateralOffset;
            const p = course.swimPosition(spawn.distance, laneZ);
            return {
                ...spawn,
                collected: false,
                node: null,
                beaconNode: null,
                x: p.x,
                z: p.z,
                baseY: course.waterY + ITEM_BASE_Y_OFFSET,
                phase: spawn.id * 0.83,
                pickupEffectRemaining: 0,
                visualSpawnStarted: false,
                visualLanded: false,
                throwElapsed: 0,
            };
        });
        this.collectorLanes.length = this.items.length;
        this.collectorLanes.fill(-1);
        this.pickupRevisions.length = this.items.length;
        this.pickupRevisions.fill(0);
        // 共享网格只创建一次；节点与正式模型按帧预算准备，玩法状态独立推进。
        this.createProgramVisuals();
        this.createBeaconVisuals();
        this.loadModelVisuals();
    }

    update(): void {
        if (this.disposed) return;
        const radiusSq = STIMULANT_BRAWL_TUNING.pickupRadius * STIMULANT_BRAWL_TUNING.pickupRadius;
        for (let lane = 0; lane < this.laneLayout.laneCount; lane++) {
            const racer = this.pickupRacers[lane];
            if (!racer?.swimmer?.node?.active) {
                this.pickupCurrentX[lane] = Number.NaN;
                this.pickupCurrentZ[lane] = Number.NaN;
                continue;
            }
            const position = racer.swimmer.node.worldPosition;
            this.pickupCurrentX[lane] = position.x;
            this.pickupCurrentZ[lane] = position.z;
        }

        for (const item of this.items) {
            // 权威拾取只能发生在瓶子已经完成落水之后，避免投掷尚未显形时被提前吃掉。
            if (item.collected || !item.visualLanded) continue;
            let bestLane = -1;
            let bestSq = radiusSq;
            for (let lane = 0; lane < this.laneLayout.laneCount; lane++) {
                const racer = this.pickupRacers[lane];
                const currentX = this.pickupCurrentX[lane];
                const currentZ = this.pickupCurrentZ[lane];
                if (!racer || !Number.isFinite(currentX) || !Number.isFinite(currentZ)) continue;
                const heading = racer.swimmer.movementHeading;
                const distanceSq = stimulantPickupDistanceSquared(
                    item.x,
                    item.z,
                    currentX,
                    currentZ,
                    this.pickupPreviousX[lane],
                    this.pickupPreviousZ[lane],
                    racer.swimmer.raceDirection * Math.cos(heading),
                    Math.sin(heading),
                    STIMULANT_BRAWL_TUNING.pickupBodyHalfLength,
                    MAX_PICKUP_SWEEP_DISTANCE,
                );
                if (distanceSq <= bestSq) {
                    bestSq = distanceSq;
                    bestLane = lane;
                }
            }
            if (bestLane >= 0) {
                const pickup = { itemId: item.id, collectorLane: bestLane, revision: ++this.revision };
                this.applyPickup(pickup);
                this.resolveAuthoritatively(pickup);
            }
        }

        for (let lane = 0; lane < this.laneLayout.laneCount; lane++) {
            this.pickupPreviousX[lane] = this.pickupCurrentX[lane];
            this.pickupPreviousZ[lane] = this.pickupCurrentZ[lane];
        }
    }

    updatePresentation(referenceDistance: number, dt: number, allowAnnouncements: boolean): void {
        if (this.disposed) return;
        this.buildPendingVisuals();
        const distance = Number.isFinite(referenceDistance) ? referenceDistance : 0;
        if (allowAnnouncements) {
            for (const item of this.items) {
                if (item.collected) continue;
                const waveBit = 1 << item.wave;
                if ((this.announcedWaveMask & waveBit) !== 0) continue;
                const ahead = item.distance - distance;
                if (ahead > WAVE_ANNOUNCEMENT_LEAD_DISTANCE || ahead < -2) continue;
                this.announcedWaveMask |= waveBit;
                this.onWaveApproach(item.wave, item.kind);
            }
        }

        this.presentationElapsed += Math.max(0, Number.isFinite(dt) ? dt : 0);
        if (this.presentationElapsed < PRESENTATION_INTERVAL) return;
        const presentationStep = this.presentationElapsed;
        this.presentationTime += presentationStep;
        this.presentationElapsed = 0;
        const referenceWorldX = this.course.distanceToWorldX(distance);
        const referenceDirection = this.course.directionAtDistance(distance);
        for (const item of this.items) {
            const worldAhead = (item.x - referenceWorldX) * referenceDirection;
            this.updateThrowState(
                item,
                this.getLaunchReferenceDistance(item, distance),
                presentationStep,
            );
            const itemVisible = !item.collected
                && item.visualSpawnStarted
                && Math.abs(worldAhead) <= ITEM_VISIBLE_DISTANCE;
            if (item.node?.isValid) {
                if (item.node.active !== itemVisible) item.node.active = itemVisible;
                if (itemVisible) {
                    if (item.visualLanded) this.applyFloatingPresentation(item);
                    else this.applyThrowPresentation(item);
                }
            }
            this.updateBeaconPresentation(item, worldAhead, presentationStep);
        }
    }

    targetZForAi(
        distance: number,
        currentZ: number,
        heartRate: number,
        energyRatio: number,
        infiniteStamina: boolean,
    ): number | null {
        let best: ItemState | null = null;
        let bestUtility = -Infinity;
        const currentX = this.course.distanceToWorldX(distance);
        const direction = this.course.directionAtDistance(distance);
        for (const item of this.items) {
            if (item.collected || !item.visualSpawnStarted) continue;
            const ahead = (item.x - currentX) * direction;
            if (ahead < 0.5 || ahead > 14) continue;
            const lateral = Math.abs(item.z - currentZ);
            let utility = -Infinity;
            if (item.kind === 'calm-slush') {
                const coolingValue = Math.max(0, heartRate - 125) * 0.13;
                const stableValue = heartRate >= STIMULANT_BRAWL_TUNING.calmSlushAiStronglyPreferHeartRate
                    ? 5
                    : heartRate >= STIMULANT_BRAWL_TUNING.calmSlushAiPreferHeartRate ? 2.2 : 0;
                utility = coolingValue + stableValue - ahead * 0.2 - lateral * 0.48;
            } else if (heartRate < STIMULANT_BRAWL_TUNING.aiSkipHeartRate) {
                const recoveryValue = Math.max(0, 1 - energyRatio) * 12;
                const denialValue = (infiniteStamina || energyRatio >= 0.98) && ahead < 3 && lateral < 2 ? 1.2 : 0;
                utility = recoveryValue + denialValue - ahead * 0.22 - lateral * 0.55;
            }
            if (utility > bestUtility) {
                bestUtility = utility;
                best = item;
            }
        }
        return bestUtility > 0 ? best!.z : null;
    }

    applyPickup(pickup: StimulantPickup): boolean {
        if (
            !Number.isSafeInteger(pickup.revision) || pickup.revision <= 0 || pickup.revision > this.items.length
            || !Number.isSafeInteger(pickup.itemId) || pickup.itemId < 0 || pickup.itemId >= this.items.length
            || !Number.isSafeInteger(pickup.collectorLane)
            || pickup.collectorLane < 0 || pickup.collectorLane >= this.laneLayout.laneCount
        ) {
            return false;
        }
        const item = this.items[pickup.itemId];
        if (!item || this.pickupRevisions[pickup.itemId] !== 0
            || this.pickupRevisions.indexOf(pickup.revision) >= 0) return false;
        this.collectorLanes[pickup.itemId] = pickup.collectorLane;
        this.pickupRevisions[pickup.itemId] = pickup.revision;
        this.revision = Math.max(this.revision, pickup.revision);
        item.collected = true;
        if (item.node?.isValid && item.node.active) item.node.active = false;
        if (item.beaconNode?.isValid && item.beaconNode.active) {
            item.pickupEffectRemaining = BEACON_PICKUP_COLLAPSE_SECONDS;
        }
        this.settlePendingPickups();
        return true;
    }

    private settlePendingPickups(): void {
        // 苏打与冰沙效果不可交换；缺序时等待可靠事件或下一份完整账本。
        while (this.settledPickupRevision < this.revision) {
            const next = this.settledPickupRevision + 1;
            const itemId = this.pickupRevisions.indexOf(next);
            if (itemId < 0) return;
            this.settledPickupRevision = next;
            this.applyPickupEffects({ itemId, collectorLane: this.collectorLanes[itemId], revision: next });
        }
    }

    private applyPickupEffects(pickup: StimulantPickup): void {
        const item = this.items[pickup.itemId];
        const racer = this.pickupRacers[pickup.collectorLane] ?? null;
        if (!racer) return;
        const energyRatioBefore = racer.condition.energyRatio;
        const heartRateBefore = racer.swimmer.heartRate;
        let restored = 0;
        if (item.kind === 'calm-slush') {
            racer.swimmer.motor.applyCalmSlush(
                STIMULANT_BRAWL_TUNING.calmSlushHeartRateDrop,
                STIMULANT_BRAWL_TUNING.calmSlushDuration,
            );
            racer.swimmer.triggerCalmSlushReaction(STIMULANT_BRAWL_TUNING.calmSlushDuration);
        } else {
            restored = racer.condition.restoreEnergyRatio(STIMULANT_BRAWL_TUNING.energyRestoreRatio);
            racer.swimmer.motor.applyHeartbeatSoda(
                STIMULANT_BRAWL_TUNING.heartRateBurden,
                STIMULANT_BRAWL_TUNING.heartRateRecoveryHoldSeconds,
            );
            racer.swimmer.triggerStimulantReaction(
                racer.swimmer.heartRate,
                STIMULANT_BRAWL_TUNING.reactionDuration,
            );
        }
        racer.condition.syncHeartRate(racer.swimmer.heartRate);
        this.onPickup({
            ...pickup,
            kind: item.kind,
            wave: item.wave,
            local: pickup.collectorLane === this.localPlayerLane(),
            energyRatioBefore,
            energyRatioAfter: racer.condition.energyRatio,
            infiniteStamina: racer.swimmer.motor.ability.infiniteStamina,
            energyRestored: restored,
            heartRateBefore,
            heartRate: racer.swimmer.heartRate,
        });
    }

    snapshotState(): { revision: number; collectedMask: number; collectorLanes: readonly number[]; pickupRevisions: readonly number[] } {
        let collectedMask = 0;
        for (const item of this.items) {
            if (item.collected) collectedMask |= 1 << item.id;
        }
        return { revision: this.revision, collectedMask: collectedMask >>> 0,
            collectorLanes: this.collectorLanes, pickupRevisions: this.pickupRevisions };
    }

    applySnapshotState(state: { revision: number; collectedMask: number; collectorLanes?: readonly number[]; pickupRevisions?: readonly number[] }): void {
        if (!Number.isSafeInteger(state.revision) || state.revision < this.revision) return;
        this.revision = state.revision;
        for (const item of this.items) {
            const collected = (state.collectedMask & (1 << item.id)) !== 0;
            const collectorLane = state.collectorLanes?.[item.id] ?? -1;
            const pickupRevision = state.pickupRevisions?.[item.id] ?? 0;
            if (collected && collectorLane >= 0 && pickupRevision > 0 && this.pickupRevisions[item.id] === 0) {
                this.applyPickup({ itemId: item.id, collectorLane, revision: pickupRevision });
            }
            if (!collected || item.collected) continue;
            item.collected = true;
            if (item.node?.isValid && item.node.active) item.node.active = false;
            item.pickupEffectRemaining = 0;
            if (item.beaconNode?.isValid && item.beaconNode.active) item.beaconNode.active = false;
        }
    }

    dispose(): void {
        this.disposed = true;
        this.waterSplashes?.cancelOwner(ENTERTAINMENT_SPLASH_OWNER.STIMULANT);
        for (let lane = 0; lane < this.laneLayout.laneCount; lane++) {
            this.pickupRacers[lane]?.swimmer.clearStimulantReaction();
        }
        for (const item of this.items) {
            if (item.node?.isValid) item.node.destroy();
            if (item.beaconNode?.isValid) item.beaconNode.destroy();
        }
        for (const material of this.visualMaterials) {
            if (material?.isValid) material.destroy();
        }
        if (this.visualMesh?.isValid) this.visualMesh.destroy();
        if (this.beaconMaterial?.isValid) this.beaconMaterial.destroy();
        for (const mesh of this.beaconMeshes) {
            if (mesh?.isValid) mesh.destroy();
        }
        this.visualMaterials.length = 0;
        this.beaconMeshes.length = 0;
        this.visualMesh = null;
        this.beaconMaterial = null;
        this.modelBuildJobs.length = 0;
    }

    private createProgramVisuals(): void {
        if (this.disposed || !this.root.isValid) return;
        const mesh = utils.createMesh(primitives.box());
        const sodaMaterial = this.createFallbackMaterial('StimulantCubeMaterial', STIMULANT_CUBE_COLOR);
        const calmMaterial = this.createFallbackMaterial('CalmSlushCubeMaterial', CALM_SLUSH_CUBE_COLOR);
        this.visualMesh = mesh;
        this.visualMaterials.push(sodaMaterial, calmMaterial);
    }

    private buildPendingVisuals(): void {
        if (this.disposed || !this.root.isValid || !this.visualMesh || !this.beaconMaterial) return;
        const end = Math.min(this.items.length, this.visualBuildIndex + VISUAL_ITEMS_PER_FRAME);
        for (; this.visualBuildIndex < end; this.visualBuildIndex++) {
            const item = this.items[this.visualBuildIndex];
            if (item.collected) continue;
            const kindIndex = item.kind === 'calm-slush' ? 1 : 0;
            const node = this.createProgramCube(`StimulantCube_${item.id}`, this.visualMesh, this.visualMaterials[kindIndex]);
            node.setWorldPosition(item.x, item.baseY, item.z);
            node.setScale(ITEM_SCALE, ITEM_SCALE, ITEM_SCALE);
            node.active = false;
            item.node = node;
            const beacon = new Node(`StimulantBeacon_${item.id}`);
            beacon.active = false;
            beacon.setParent(this.root);
            beacon.layer = this.root.layer;
            const renderer = beacon.addComponent(MeshRenderer);
            renderer.mesh = this.beaconMeshes[kindIndex];
            renderer.setMaterial(this.beaconMaterial, 0);
            beacon.setWorldPosition(item.x, this.course.waterY + BEACON_BASE_Y_OFFSET, item.z);
            item.beaconNode = beacon;
        }
        this.buildPendingModels();
    }

    private buildPendingModels(): void {
        let budget = MODEL_INSTANCES_PER_FRAME;
        while (budget > 0 && this.modelBuildJobs.length > 0) {
            // 按道具排期交错准备两种模型，避免先返回的资源阻塞另一种首波道具。
            let job: ModelBuildJob | null = null;
            for (let index = this.modelBuildJobs.length - 1; index >= 0; index--) {
                const candidate = this.modelBuildJobs[index];
                while (candidate.itemIndex < this.items.length) {
                    const pending = this.items[candidate.itemIndex];
                    if (pending.kind === candidate.kind && !pending.collected) break;
                    candidate.itemIndex++;
                }
                if (candidate.itemIndex >= this.items.length) {
                    this.modelBuildJobs.splice(index, 1);
                } else if (this.items[candidate.itemIndex].node && (!job || candidate.itemIndex < job.itemIndex)) {
                    job = candidate;
                }
            }
            if (!job) return;
            const item = this.items[job.itemIndex];
            budget--;
            const node = instantiate(job.prefab);
            if (!job.validated && !this.hasMeshRenderer(node)) {
                node.destroy();
                this.modelBuildJobs.splice(this.modelBuildJobs.indexOf(job), 1);
                job.failures.push(`${job.candidates[job.candidateIndex]}: loaded prefab has no MeshRenderer`);
                this.loadModelVisualsForKind(job.kind, job.candidates, job.candidateIndex + 1, job.failures);
                continue;
            }
            job.validated = true;
            job.itemIndex++;
            const fallback = item.node;
            node.name = `${job.kind === 'calm-slush' ? 'CalmSlush' : 'StimulantPotion'}_${item.id}`;
            node.active = !item.collected && fallback.active;
            node.setParent(this.root);
            this.applyLayerRecursively(node, this.root.layer);
            node.setWorldPosition(item.x, item.baseY, item.z);
            node.setScale(ITEM_MODEL_SCALE, ITEM_MODEL_SCALE, ITEM_MODEL_SCALE);
            item.node = node;
            if (node.active) {
                if (item.visualLanded) this.applyFloatingPresentation(item);
                else this.applyThrowPresentation(item);
            }
            if (fallback.isValid) fallback.destroy();
        }
    }

    private loadModelVisuals(): void {
        this.loadModelVisualsForKind('heartbeat-soda', RESOURCE_PATHS.stimulantBottlePrefabCandidates);
        this.loadModelVisualsForKind('calm-slush', RESOURCE_PATHS.calmSlushPrefabCandidates);
    }

    private loadModelVisualsForKind(
        kind: StimulantItemKind,
        candidates: readonly string[],
        candidateIndex = 0,
        failures: string[] = [],
    ): void {
        if (candidateIndex >= candidates.length) {
            console.warn(
                `[SpeedSwimming] ${kind} model unavailable; keeping program cube fallback; ${failures.join(' | ')}`,
            );
            return;
        }
        const path = candidates[candidateIndex];
        loadRaceAsset(path, Prefab, (error, prefab) => {
            if (this.disposed || !this.root.isValid) return;
            if (error || !prefab) {
                failures.push(`${path}: ${error?.message ?? 'Prefab asset missing'}`);
                this.loadModelVisualsForKind(kind, candidates, candidateIndex + 1, failures);
                return;
            }

            this.modelBuildJobs.push({ kind, candidates, candidateIndex, failures, prefab, itemIndex: 0, validated: false });
        });
    }

    private hasMeshRenderer(node: Node): boolean {
        if (node.getComponent(MeshRenderer)) return true;
        for (const child of node.children) {
            if (this.hasMeshRenderer(child)) return true;
        }
        return false;
    }

    private applyLayerRecursively(node: Node, layer: number): void {
        node.layer = layer;
        for (const child of node.children) {
            this.applyLayerRecursively(child, layer);
        }
    }

    private updateBeaconPresentation(item: ItemState, worldAhead: number, dt: number): void {
        const beacon = item.beaconNode;
        if (!beacon?.isValid) return;

        if (item.collected) {
            if (item.pickupEffectRemaining <= 0) {
                if (beacon.active) beacon.active = false;
                return;
            }
            item.pickupEffectRemaining = Math.max(0, item.pickupEffectRemaining - dt);
            const ratio = item.pickupEffectRemaining / BEACON_PICKUP_COLLAPSE_SECONDS;
            if (!beacon.active) beacon.active = true;
            beacon.setWorldPosition(
                item.x,
                this.course.waterY + BEACON_BASE_Y_OFFSET + (1 - ratio) * 0.65,
                item.z,
            );
            beacon.setScale(Math.max(0.015, ratio), 1 + (1 - ratio) * 0.24, Math.max(0.015, ratio));
            if (item.pickupEffectRemaining <= 0) beacon.active = false;
            return;
        }

        const visible = item.visualSpawnStarted
            && worldAhead <= BEACON_VISIBLE_AHEAD_DISTANCE
            && worldAhead >= -BEACON_VISIBLE_BEHIND_DISTANCE;
        if (beacon.active !== visible) beacon.active = visible;
        if (!visible) return;
        const pulse = 1 + Math.sin(this.presentationTime * 2.25 + item.phase) * 0.055;
        const reveal = item.visualLanded
            ? 1
            : Math.max(0.015, smoothstep((this.throwProgress(item) - BEACON_REVEAL_START) / (1 - BEACON_REVEAL_START)));
        beacon.setWorldPosition(item.x, this.course.waterY + BEACON_BASE_Y_OFFSET, item.z);
        beacon.setScale(pulse, reveal, pulse);
    }

    private createBeaconVisuals(): void {
        if (this.disposed || !this.root.isValid) return;
        const sodaMesh = utils.createMesh(buildStimulantBeaconGeometry('heartbeat-soda'));
        const calmMesh = utils.createMesh(buildStimulantBeaconGeometry('calm-slush'));
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
        material.name = 'StimulantBeaconMaterial';
        material.setProperty('mainColor', Color.WHITE);
        this.beaconMeshes.push(sodaMesh, calmMesh);
        this.beaconMaterial = material;
    }

    private getLaunchReferenceDistance(item: ItemState, fallbackDistance: number): number {
        let leaderDistance = stimulantIsOnCurrentCourseLeg(
            item.distance,
            fallbackDistance,
            this.course.courseLength,
        ) ? fallbackDistance : Number.NEGATIVE_INFINITY;
        for (const racer of this.pickupRacers) {
            if (!racer?.swimmer?.node?.active) continue;
            const racerDistance = racer.swimmer.distance;
            if (
                Number.isFinite(racerDistance)
                && racerDistance > leaderDistance
                && stimulantIsOnCurrentCourseLeg(item.distance, racerDistance, this.course.courseLength)
            ) {
                leaderDistance = racerDistance;
            }
        }
        return Number.isFinite(leaderDistance) ? leaderDistance : fallbackDistance;
    }

    private updateThrowState(item: ItemState, launchReferenceDistance: number, dt: number): void {
        if (item.collected || item.visualLanded) return;
        const launchAhead = item.distance - launchReferenceDistance;
        const leaderOnCurrentLeg = stimulantIsOnCurrentCourseLeg(
            item.distance,
            launchReferenceDistance,
            this.course.courseLength,
        );
        if (!item.visualSpawnStarted) {
            if (!leaderOnCurrentLeg || launchAhead > THROW_TRIGGER_AHEAD_DISTANCE || launchAhead < -2) return;
            item.visualSpawnStarted = true;
            if (launchAhead <= THROW_FORCE_LANDED_AHEAD_DISTANCE) {
                item.visualLanded = true;
                item.throwElapsed = THROW_SECONDS;
                return;
            }
            item.throwElapsed = -(item.id % 3) * THROW_STAGGER_SECONDS;
        }
        item.throwElapsed += dt;
        if (item.throwElapsed < THROW_SECONDS && launchAhead > THROW_FORCE_LANDED_AHEAD_DISTANCE) return;
        item.throwElapsed = THROW_SECONDS;
        item.visualLanded = true;
        this.showLandingSplash(item);
    }

    private throwProgress(item: ItemState): number {
        return clamp01(item.throwElapsed / THROW_SECONDS);
    }

    private applyThrowPresentation(item: ItemState): void {
        const t = this.throwProgress(item);
        const eased = smoothstep(t);
        const throwSide = item.z >= 0 ? 1 : -1;
        const startZ = throwSide * (this.course.poolWidth * 0.5 + THROW_STAND_OFFSET);
        item.node!.setWorldPosition(
            item.x + Math.sin(t * Math.PI) * throwSide * THROW_ALONG_ARC_DISTANCE,
            item.baseY + (1 - t) * THROW_START_HEIGHT + Math.sin(t * Math.PI) * THROW_ARC_HEIGHT,
            lerp(startZ, item.z, eased),
        );
        item.node!.setRotationFromEuler(35 + t * 230, item.id * 53 + t * 330, 20 + t * 165);
    }

    private applyFloatingPresentation(item: ItemState): void {
        const floatAngle = waterFloatPhase(this.presentationTime, item.phase, WATER_FLOAT_PROFILES.pickup);
        const bob = sampleWaterFloatOffset(this.presentationTime, item.phase, WATER_FLOAT_PROFILES.pickup);
        const leanDirection = (item.id & 1) === 0 ? 1 : -1;
        const swayScale = item.kind === 'calm-slush' ? CALM_SLUSH_SWAY_READABILITY_SCALE : 1;
        const yawScale = item.kind === 'calm-slush' ? CALM_SLUSH_YAW_READABILITY_SCALE : 1;
        const pitch = leanDirection * ITEM_BASE_LEAN_DEGREES
            + Math.sin(floatAngle * 0.72 + item.phase * 0.19) * ITEM_PITCH_SWAY_DEGREES * swayScale;
        const roll = Math.cos(floatAngle * 0.61 + item.phase * 1.37) * ITEM_ROLL_SWAY_DEGREES * swayScale;
        const yaw = (this.presentationTime * ITEM_YAW_SPEED_DEGREES * yawScale + item.id * 37) % 360;
        item.node!.setWorldPosition(item.x, item.baseY + bob, item.z);
        item.node!.setRotationFromEuler(pitch, yaw, roll);
    }

    private showLandingSplash(item: ItemState): void {
        const throwSide = item.z >= 0 ? 1 : -1;
        this.splashWorldPosition.set(item.x, this.course.waterY + 0.035, item.z);
        this.waterSplashes?.play({
            owner: ENTERTAINMENT_SPLASH_OWNER.STIMULANT,
            profile: ENTERTAINMENT_SPLASH_PROFILE.LIGHT_ENTRY,
            position: this.splashWorldPosition,
            yawDegrees: throwSide > 0 ? 180 : 0,
            intensity: LANDING_SPLASH_INTENSITY,
            duration: LANDING_SPLASH_SECONDS,
            radialScale: 1.08,
            verticalScale: 0.74,
            layer: this.root.layer,
        });
    }

    private createProgramCube(name: string, mesh: Mesh, material: Material): Node {
        const node = new Node(name);
        node.setParent(this.root);
        node.layer = this.root.layer;
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = mesh;
        renderer.setMaterial(material, 0);
        return node;
    }

    private createFallbackMaterial(name: string, color: Readonly<Color>): Material {
        const material = new Material();
        material.initialize({ effectName: 'builtin-unlit' });
        material.name = name;
        material.setProperty('mainColor', color);
        return material;
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

function buildStimulantBeaconGeometry(kind: StimulantItemKind): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    appendBeaconRibbon(positions, colors, indices, 'x', kind);
    appendBeaconRibbon(positions, colors, indices, 'z', kind);
    appendBeaconBaseHalo(positions, colors, indices, kind);
    return {
        positions,
        colors,
        indices,
        minPos: new Vec3(-BEACON_BASE_RADIUS, 0, -BEACON_BASE_RADIUS),
        maxPos: new Vec3(BEACON_BASE_RADIUS, BEACON_HEIGHT, BEACON_BASE_RADIUS),
    };
}

function appendBeaconRibbon(
    positions: number[],
    colors: number[],
    indices: number[],
    axis: 'x' | 'z',
    kind: StimulantItemKind,
): void {
    const levels = [0, 0.16, 0.48, 0.78, 1] as const;
    const widths = [0.18, 0.76, 1, 0.68, 0.16] as const;
    const alphas = [0, 0.38, 0.46, 0.22, 0] as const;
    const columns = [-1, 0, 1] as const;
    const columnAlpha = [0.08, 1, 0.08] as const;
    const base = positions.length / 3;
    const columnHeight = BEACON_HEIGHT - BEACON_COLUMN_BOTTOM;

    for (let row = 0; row < levels.length; row++) {
        const y = BEACON_COLUMN_BOTTOM + levels[row] * columnHeight;
        for (let column = 0; column < columns.length; column++) {
            const offset = columns[column] * BEACON_HALF_WIDTH * widths[row];
            positions.push(axis === 'x' ? offset : 0, y, axis === 'z' ? offset : 0);
            const rgb = kind === 'calm-slush' ? [0.34, 0.86, 1] : [0.58, 1, 0.72];
            colors.push(rgb[0], rgb[1], rgb[2], alphas[row] * columnAlpha[column]);
        }
    }

    for (let row = 0; row < levels.length - 1; row++) {
        for (let column = 0; column < columns.length - 1; column++) {
            const lower = base + row * columns.length + column;
            const upper = lower + columns.length;
            indices.push(lower, upper, lower + 1, lower + 1, upper, upper + 1);
        }
    }
}

function appendBeaconBaseHalo(
    positions: number[],
    colors: number[],
    indices: number[],
    kind: StimulantItemKind,
): void {
    const segments = 16;
    const base = positions.length / 3;
    const radii = [BEACON_HALO_INNER_RADIUS, BEACON_HALO_PEAK_RADIUS, BEACON_BASE_RADIUS] as const;
    const alphas = [0, 0.2, 0] as const;
    for (let segment = 0; segment <= segments; segment++) {
        const angle = segment / segments * Math.PI * 2;
        for (let ring = 0; ring < radii.length; ring++) {
            positions.push(
                Math.cos(angle) * radii[ring],
                0.025,
                Math.sin(angle) * radii[ring],
            );
            const rgb = kind === 'calm-slush' ? [0.25, 0.78, 1] : [0.42, 1, 0.54];
            colors.push(rgb[0], rgb[1], rgb[2], alphas[ring]);
        }
    }
    for (let segment = 0; segment < segments; segment++) {
        const current = base + segment * radii.length;
        const next = current + radii.length;
        for (let ring = 0; ring < radii.length - 1; ring++) {
            indices.push(
                current + ring,
                next + ring,
                current + ring + 1,
                current + ring + 1,
                next + ring,
                next + ring + 1,
            );
        }
    }
}
