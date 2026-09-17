import { Color, instantiate, Material, Mesh, MeshRenderer, Node, Prefab, primitives, utils } from 'cc';
import { PlayerConditionModel } from '../condition/PlayerConditionModel';
import { AiConditionModel } from '../condition/AiConditionModel';
import { Swimmer } from '../entity/Swimmer';
import { LaneLayout } from '../venue/LaneLayout';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { loadRaceAsset } from './RaceBundleLoader';
import { RESOURCE_PATHS } from './ResourcePaths';
import { buildStimulantSchedule, STIMULANT_BRAWL_TUNING, StimulantSpawn } from './StimulantBrawlRules';

type Condition = PlayerConditionModel | AiConditionModel;
type Racer = { swimmer: Swimmer; condition: Condition };
type ItemState = StimulantSpawn & {
    collected: boolean;
    node: Node | null;
    x: number;
    z: number;
    baseY: number;
    phase: number;
};

export type StimulantPickup = { itemId: number; collectorLane: number; revision: number };
export type StimulantPickupFeedback = StimulantPickup & {
    wave: number;
    local: boolean;
    energyRestored: number;
    heartRate: number;
};

const ITEM_VISIBLE_DISTANCE = 38;
const WAVE_ANNOUNCEMENT_LEAD_DISTANCE = 18;
const PRESENTATION_INTERVAL = 1 / 20;
const ITEM_SCALE = 0.9;
const ITEM_MODEL_SCALE = 1;
const STIMULANT_CUBE_COLOR = new Color(92, 255, 48, 255);

/** 兴奋剂玩法的独立规则控制器；GameManager 只负责传入泳者和网络事件。 */
export class StimulantBrawlController {
    private readonly items: ItemState[];
    private revision = 0;
    private disposed = false;
    private announcedWaveMask = 0;
    private presentationElapsed = PRESENTATION_INTERVAL;
    private presentationTime = 0;
    private visualMesh: Mesh | null = null;
    private visualMaterial: Material | null = null;

    constructor(
        private readonly root: Node,
        seed: number,
        private readonly laneLayout: LaneLayout,
        private readonly course: RaceCourseLayout,
        private readonly racerForLane: (lane: number) => Racer | null,
        private readonly resolveAuthoritatively: (pickup: StimulantPickup) => void,
        private readonly onPickup: (feedback: StimulantPickupFeedback) => void,
        private readonly onWaveApproach: (wave: number) => void,
        private readonly localPlayerLane: () => number,
    ) {
        this.items = buildStimulantSchedule(seed, laneLayout.laneCount).map(spawn => {
            const laneZ = laneLayout.centerZ(spawn.laneIndex) + spawn.lateralOffset;
            const p = course.swimPosition(spawn.distance, laneZ);
            return {
                ...spawn,
                collected: false,
                node: null,
                x: p.x,
                z: p.z,
                baseY: course.waterY + 0.78,
                phase: spawn.id * 0.83,
            };
        });
        // 先同步生成单个大方块，保证模型资源尚未就绪时仍能看到和拾取道具。
        this.createProgramVisuals();
        this.loadModelVisuals();
    }

    update(): void {
        if (this.disposed) return;
        const radiusSq = STIMULANT_BRAWL_TUNING.pickupRadius * STIMULANT_BRAWL_TUNING.pickupRadius;
        const guaranteedRadius = Math.max(
            STIMULANT_BRAWL_TUNING.pickupRadius,
            this.laneLayout.laneWidth * 0.55,
        );
        const guaranteedRadiusSq = guaranteedRadius * guaranteedRadius;
        for (const item of this.items) {
            if (item.collected) continue;
            let bestLane = -1;
            let bestSq = item.guaranteed ? guaranteedRadiusSq : radiusSq;
            for (let lane = 0; lane < this.laneLayout.laneCount; lane++) {
                if (item.guaranteed && lane !== item.laneIndex) continue;
                const racer = this.racerForLane(lane);
                if (!racer?.swimmer?.node?.active) continue;
                const pickupRadius = item.guaranteed ? guaranteedRadius : STIMULANT_BRAWL_TUNING.pickupRadius;
                if (Math.abs(racer.swimmer.distance - item.distance) > pickupRadius) continue;
                const p = racer.swimmer.node.worldPosition;
                const dx = p.x - item.x;
                const dz = p.z - item.z;
                const distanceSq = dx * dx + dz * dz;
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
        this.presentationTime += this.presentationElapsed;
        this.presentationElapsed = 0;
        for (const item of this.items) {
            if (!item.node?.isValid) continue;
            const ahead = item.distance - distance;
            const visible = !item.collected && Math.abs(ahead) <= ITEM_VISIBLE_DISTANCE;
            if (item.node.active !== visible) item.node.active = visible;
            if (!visible) continue;
            const bob = Math.sin(this.presentationTime * 3.1 + item.phase) * 0.12;
            item.node.setWorldPosition(item.x, item.baseY + bob, item.z);
            item.node.setRotationFromEuler(0, (this.presentationTime * 82 + item.id * 37) % 360, 0);
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
        const racer = this.racerForLane(pickup.collectorLane);
        if (!racer) return true;
        const restored = racer.condition.restoreEnergyRatio(STIMULANT_BRAWL_TUNING.energyRestoreRatio);
        racer.swimmer.motor.addHeartRateBurden(STIMULANT_BRAWL_TUNING.heartRateBurden);
        racer.condition.syncHeartRate(racer.swimmer.heartRate);
        racer.swimmer.triggerStimulantReaction(
            racer.swimmer.heartRate,
            STIMULANT_BRAWL_TUNING.reactionDuration,
        );
        this.onPickup({
            ...pickup,
            wave: item.wave,
            local: pickup.collectorLane === this.localPlayerLane(),
            energyRestored: restored,
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
        }
    }

    dispose(): void {
        this.disposed = true;
        for (let lane = 0; lane < this.laneLayout.laneCount; lane++) {
            this.racerForLane(lane)?.swimmer.clearStimulantReaction();
        }
        for (const item of this.items) {
            if (item.node?.isValid) item.node.destroy();
        }
        if (this.visualMaterial?.isValid) this.visualMaterial.destroy();
        if (this.visualMesh?.isValid) this.visualMesh.destroy();
        this.visualMaterial = null;
        this.visualMesh = null;
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
            node.active = !item.collected && Math.abs(item.distance) <= ITEM_VISIBLE_DISTANCE;
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
