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
    stimulantPickupRaceDistanceEligible,
    STIMULANT_BRAWL_TUNING,
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
const STIMULANT_CUBE_COLOR = new Color(92, 255, 48, 255);

/** 心跳苏打玩法的独立规则控制器；GameManager 只负责传入泳者和网络事件。 */
export class StimulantBrawlController {
    private readonly items: ItemState[];
    private revision = 0;
    private disposed = false;
    private announcedWaveMask = 0;
    private presentationElapsed = PRESENTATION_INTERVAL;
    private presentationTime = 0;
    private visualMesh: Mesh | null = null;
    private visualMaterial: Material | null = null;
    private beaconMesh: Mesh | null = null;
    private beaconMaterial: Material | null = null;
    private readonly pickupRacers: Array<Racer | null>;
    private readonly pickupCurrentX: Float64Array;
    private readonly pickupCurrentZ: Float64Array;
    private readonly pickupPreviousX: Float64Array;
    private readonly pickupPreviousZ: Float64Array;
    private readonly pickupCurrentDistance: Float64Array;
    private readonly pickupPreviousDistance: Float64Array;
    private readonly splashWorldPosition = new Vec3();

    constructor(
        private readonly root: Node,
        seed: number,
        private readonly laneLayout: LaneLayout,
        private readonly course: RaceCourseLayout,
        racerForLane: (lane: number) => Racer | null,
        private readonly resolveAuthoritatively: (pickup: StimulantPickup) => void,
        private readonly onPickup: (feedback: StimulantPickupFeedback) => void,
        private readonly onWaveApproach: (wave: number) => void,
        private readonly localPlayerLane: () => number,
        private readonly waterSplashes: EntertainmentWaterSplashPool | null,
        schedule?: readonly StimulantSpawn[],
    ) {
        this.pickupRacers = new Array<Racer | null>(laneLayout.laneCount).fill(null);
        this.pickupCurrentX = new Float64Array(laneLayout.laneCount);
        this.pickupCurrentZ = new Float64Array(laneLayout.laneCount);
        this.pickupPreviousX = new Float64Array(laneLayout.laneCount);
        this.pickupPreviousZ = new Float64Array(laneLayout.laneCount);
        this.pickupCurrentDistance = new Float64Array(laneLayout.laneCount);
        this.pickupPreviousDistance = new Float64Array(laneLayout.laneCount);
        this.pickupCurrentX.fill(Number.NaN);
        this.pickupCurrentZ.fill(Number.NaN);
        this.pickupPreviousX.fill(Number.NaN);
        this.pickupPreviousZ.fill(Number.NaN);
        this.pickupCurrentDistance.fill(Number.NaN);
        this.pickupPreviousDistance.fill(Number.NaN);
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
        // 先同步生成单个大方块，保证模型资源尚未就绪时仍能看到和拾取道具。
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
                this.pickupCurrentDistance[lane] = Number.NaN;
                continue;
            }
            const position = racer.swimmer.node.worldPosition;
            this.pickupCurrentX[lane] = position.x;
            this.pickupCurrentZ[lane] = position.z;
            this.pickupCurrentDistance[lane] = racer.swimmer.distance;
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
                if (!stimulantIsOnCurrentCourseLeg(
                    item.distance,
                    this.pickupCurrentDistance[lane],
                    this.course.courseLength,
                )) continue;
                if (!stimulantPickupRaceDistanceEligible(
                    item.distance,
                    this.pickupCurrentDistance[lane],
                    this.pickupPreviousDistance[lane],
                    STIMULANT_BRAWL_TUNING.pickupRadius,
                    STIMULANT_BRAWL_TUNING.pickupBodyHalfLength,
                    MAX_PICKUP_SWEEP_DISTANCE,
                )) continue;
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
            this.pickupPreviousDistance[lane] = this.pickupCurrentDistance[lane];
        }
    }

    updatePresentation(referenceDistance: number, dt: number, allowAnnouncements: boolean): void {
        const distance = Number.isFinite(referenceDistance) ? referenceDistance : 0;
        if (allowAnnouncements) {
            for (const item of this.items) {
                if (item.collected) continue;
                const waveBit = 1 << item.wave;
                if ((this.announcedWaveMask & waveBit) !== 0) continue;
                const ahead = item.distance - distance;
                if (ahead > WAVE_ANNOUNCEMENT_LEAD_DISTANCE || ahead < -2) continue;
                this.announcedWaveMask |= waveBit;
                this.onWaveApproach(item.wave);
            }
        }

        this.presentationElapsed += Math.max(0, Number.isFinite(dt) ? dt : 0);
        if (this.presentationElapsed < PRESENTATION_INTERVAL) return;
        const presentationStep = this.presentationElapsed;
        this.presentationTime += presentationStep;
        this.presentationElapsed = 0;
        for (const item of this.items) {
            const ahead = item.distance - distance;
            const onCurrentLeg = stimulantIsOnCurrentCourseLeg(
                item.distance,
                distance,
                this.course.courseLength,
            );
            this.updateThrowState(
                item,
                this.getLaunchReferenceDistance(item, distance),
                presentationStep,
            );
            const itemVisible = !item.collected
                && item.visualSpawnStarted
                && onCurrentLeg
                && Math.abs(ahead) <= ITEM_VISIBLE_DISTANCE;
            if (item.node?.isValid) {
                if (item.node.active !== itemVisible) item.node.active = itemVisible;
                if (itemVisible) {
                    if (item.visualLanded) this.applyFloatingPresentation(item);
                    else this.applyThrowPresentation(item);
                }
            }
            this.updateBeaconPresentation(item, ahead, onCurrentLeg, presentationStep);
        }
    }

    targetZForAi(
        distance: number,
        currentZ: number,
        heartRate: number,
        energyRatio: number,
        infiniteStamina: boolean,
    ): number | null {
        if (heartRate >= STIMULANT_BRAWL_TUNING.aiSkipHeartRate) return null;
        let best: ItemState | null = null;
        let bestUtility = -Infinity;
        for (const item of this.items) {
            if (item.collected) continue;
            const ahead = item.distance - distance;
            if (ahead < 0.5 || ahead > 14) continue;
            const lateral = Math.abs(item.z - currentZ);
            const recoveryValue = Math.max(0, 1 - energyRatio) * 12;
            const denialValue = (infiniteStamina || energyRatio >= 0.98) && ahead < 3 && lateral < 2 ? 1.2 : 0;
            const utility = recoveryValue + denialValue - ahead * 0.22 - lateral * 0.55;
            if (utility > bestUtility) {
                bestUtility = utility;
                best = item;
            }
        }
        return bestUtility > 0 ? best!.z : null;
    }

    applyPickup(pickup: StimulantPickup): boolean {
        if (
            !Number.isSafeInteger(pickup.revision)
            || pickup.revision <= this.revision && this.items[pickup.itemId]?.collected
        ) {
            return false;
        }
        const item = this.items[pickup.itemId];
        if (!item || item.collected) return false;
        this.revision = Math.max(this.revision, pickup.revision);
        item.collected = true;
        if (item.node?.isValid && item.node.active) item.node.active = false;
        if (item.beaconNode?.isValid && item.beaconNode.active) {
            item.pickupEffectRemaining = BEACON_PICKUP_COLLAPSE_SECONDS;
        }
        const racer = this.pickupRacers[pickup.collectorLane] ?? null;
        if (!racer) return true;
        const energyRatioBefore = racer.condition.energyRatio;
        const heartRateBefore = racer.swimmer.heartRate;
        const restored = racer.condition.restoreEnergyRatio(STIMULANT_BRAWL_TUNING.energyRestoreRatio);
        racer.swimmer.motor.addHeartRateBurden(
            STIMULANT_BRAWL_TUNING.heartRateBurden,
            STIMULANT_BRAWL_TUNING.heartRateRecoveryHoldSeconds,
        );
        racer.condition.syncHeartRate(racer.swimmer.heartRate);
        racer.swimmer.triggerStimulantReaction(
            racer.swimmer.heartRate,
            STIMULANT_BRAWL_TUNING.reactionDuration,
        );
        this.onPickup({
            ...pickup,
            wave: item.wave,
            local: pickup.collectorLane === this.localPlayerLane(),
            energyRatioBefore,
            energyRatioAfter: racer.condition.energyRatio,
            infiniteStamina: racer.swimmer.motor.ability.infiniteStamina,
            energyRestored: restored,
            heartRateBefore,
            heartRate: racer.swimmer.heartRate,
        });
        return true;
    }

    snapshotState(): { revision: number; collectedMask: number } {
        let collectedMask = 0;
        for (const item of this.items) {
            if (item.collected) collectedMask |= 1 << item.id;
        }
        return { revision: this.revision, collectedMask: collectedMask >>> 0 };
    }

    applySnapshotState(state: { revision: number; collectedMask: number }): void {
        if (!Number.isSafeInteger(state.revision) || state.revision < this.revision) return;
        this.revision = state.revision;
        for (const item of this.items) {
            const collected = (state.collectedMask & (1 << item.id)) !== 0;
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
        if (this.visualMaterial?.isValid) this.visualMaterial.destroy();
        if (this.visualMesh?.isValid) this.visualMesh.destroy();
        if (this.beaconMaterial?.isValid) this.beaconMaterial.destroy();
        if (this.beaconMesh?.isValid) this.beaconMesh.destroy();
        this.visualMaterial = null;
        this.visualMesh = null;
        this.beaconMaterial = null;
        this.beaconMesh = null;
    }

    private createProgramVisuals(): void {
        if (this.disposed || !this.root.isValid) return;
        const mesh = utils.createMesh(primitives.box());
        const material = new Material();
        material.initialize({ effectName: 'builtin-unlit' });
        material.name = 'StimulantCubeMaterial';
        material.setProperty('mainColor', STIMULANT_CUBE_COLOR);
        this.visualMesh = mesh;
        this.visualMaterial = material;

        for (const item of this.items) {
            const node = this.createProgramCube(`StimulantCube_${item.id}`, mesh, material);
            node.setWorldPosition(item.x, item.baseY, item.z);
            node.setScale(ITEM_SCALE, ITEM_SCALE, ITEM_SCALE);
            node.active = false;
            item.node = node;
        }
    }

    private loadModelVisuals(candidateIndex = 0, failures: string[] = []): void {
        const candidates = RESOURCE_PATHS.stimulantBottlePrefabCandidates;
        if (candidateIndex >= candidates.length) {
            console.warn(
                `[SpeedSwimming] stimulant model unavailable; keeping program cube fallback; ${failures.join(' | ')}`,
            );
            return;
        }
        const path = candidates[candidateIndex];
        loadRaceAsset(path, Prefab, (error, prefab) => {
            if (this.disposed || !this.root.isValid) return;
            if (error || !prefab) {
                failures.push(`${path}: ${error?.message ?? 'Prefab asset missing'}`);
                this.loadModelVisuals(candidateIndex + 1, failures);
                return;
            }

            const probe = instantiate(prefab);
            if (!this.hasMeshRenderer(probe)) {
                probe.destroy();
                failures.push(`${path}: loaded prefab has no MeshRenderer`);
                this.loadModelVisuals(candidateIndex + 1, failures);
                return;
            }
            probe.destroy();

            for (const item of this.items) {
                const fallback = item.node;
                const node = instantiate(prefab);
                node.name = `StimulantPotion_${item.id}`;
                node.setParent(this.root);
                this.applyLayerRecursively(node, this.root.layer);
                node.setWorldPosition(item.x, item.baseY, item.z);
                node.setScale(ITEM_MODEL_SCALE, ITEM_MODEL_SCALE, ITEM_MODEL_SCALE);
                node.active = !item.collected && (fallback?.active ?? false);
                item.node = node;
                if (node.active) {
                    if (item.visualLanded) this.applyFloatingPresentation(item);
                    else this.applyThrowPresentation(item);
                }
                if (fallback?.isValid) fallback.destroy();
            }
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

    private updateBeaconPresentation(item: ItemState, ahead: number, onCurrentLeg: boolean, dt: number): void {
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
            && onCurrentLeg
            && ahead <= BEACON_VISIBLE_AHEAD_DISTANCE
            && ahead >= -BEACON_VISIBLE_BEHIND_DISTANCE;
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
        const mesh = utils.createMesh(buildStimulantBeaconGeometry());
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
        this.beaconMesh = mesh;
        this.beaconMaterial = material;

        for (const item of this.items) {
            const beacon = new Node(`StimulantBeacon_${item.id}`);
            beacon.setParent(this.root);
            beacon.layer = this.root.layer;
            const renderer = beacon.addComponent(MeshRenderer);
            renderer.mesh = mesh;
            renderer.setMaterial(material, 0);
            beacon.setWorldPosition(item.x, this.course.waterY + BEACON_BASE_Y_OFFSET, item.z);
            beacon.active = false;
            item.beaconNode = beacon;
        }
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
        const pitch = leanDirection * ITEM_BASE_LEAN_DEGREES
            + Math.sin(floatAngle * 0.72 + item.phase * 0.19) * ITEM_PITCH_SWAY_DEGREES;
        const roll = Math.cos(floatAngle * 0.61 + item.phase * 1.37) * ITEM_ROLL_SWAY_DEGREES;
        const yaw = (this.presentationTime * ITEM_YAW_SPEED_DEGREES + item.id * 37) % 360;
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

function buildStimulantBeaconGeometry(): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    appendBeaconRibbon(positions, colors, indices, 'x');
    appendBeaconRibbon(positions, colors, indices, 'z');
    appendBeaconBaseHalo(positions, colors, indices);
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
            colors.push(0.58, 1, 0.72, alphas[row] * columnAlpha[column]);
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

function appendBeaconBaseHalo(positions: number[], colors: number[], indices: number[]): void {
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
            colors.push(0.42, 1, 0.54, alphas[ring]);
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
