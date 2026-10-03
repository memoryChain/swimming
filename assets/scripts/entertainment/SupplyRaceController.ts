import { ENTERTAINMENT_DEBUG_TUNING, STIMULANT_BRAWL_TUNING } from '../core/EntertainmentBalance';
import { stimulantPickupDistanceSquared, StimulantItemKind, StimulantSpawn } from './StimulantBrawlRules';

export type EntertainmentRacerState = {
    active: boolean;
    canContact: boolean;
    finished: boolean;
    distance: number;
    lateral: number;
    heading: number;
};
export type SupplySlot = {
    readonly id: number;
    active: boolean;
    generation: number;
    kind: StimulantItemKind;
    age: number;
    courseX: number;
    lateral: number;
};
export function entertainmentCourseOffset(distance: number, length: number): number {
    const leg = Math.floor(Math.max(0, distance) / length), within = Math.max(0, distance) % length;
    return leg % 2 === 0 ? within : length - within;
}

/** 逻辑投放、落水和拾取独立于表现频率；固定池，不在比赛帧分配道具状态。 */
export class SupplyRaceController {
    readonly slots: SupplySlot[];
    private next = 0;
    private stopped = false;
    private readonly previousX: Float64Array;
    private readonly previousZ: Float64Array;
    constructor(private readonly schedule: readonly StimulantSpawn[], private readonly laneCenters: readonly number[],
        private readonly courseLength: number, private readonly racers: readonly EntertainmentRacerState[],
        private readonly onPickup: (racerIndex: number, kind: StimulantItemKind) => void) {
        this.slots = Array.from({ length: ENTERTAINMENT_DEBUG_TUNING.supplyPoolSize }, (_, id) => ({
            id, active: false, generation: 0, kind: 'heartbeat-soda' as StimulantItemKind, age: 0, courseX: 0, lateral: 0,
        }));
        this.previousX = new Float64Array(racers.length);
        this.previousZ = new Float64Array(racers.length);
        this.reset();
    }
    reset() {
        this.next = 0; this.stopped = false; this.previousX.fill(NaN); this.previousZ.fill(NaN);
        for (const slot of this.slots) { slot.active = false; slot.age = 0; }
    }
    cancelPending() { this.stopped = true; }
    update(dt: number) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        let leader = 0;
        for (const racer of this.racers) if (racer.active) leader = Math.max(leader, racer.distance);
        // 先退休旧物品；池满时放弃该波物品，不增加池，也不积压到下一次倒计时。
        for (const slot of this.slots) if (slot.active) {
            slot.age += dt;
            if (slot.age >= ENTERTAINMENT_DEBUG_TUNING.supplyLifetime) slot.active = false;
        }
        while (!this.stopped && this.next < this.schedule.length
            && leader >= this.schedule[this.next].distance - ENTERTAINMENT_DEBUG_TUNING.supplyLeadDistance) {
            const spawn = this.schedule[this.next++];
            if (leader > spawn.distance + 2) continue;
            let free: SupplySlot | null = null;
            for (const slot of this.slots) if (!slot.active) { free = slot; break; }
            if (!free) continue;
            free.active = true; free.generation++; free.kind = spawn.kind; free.age = 0;
            free.courseX = entertainmentCourseOffset(spawn.distance, this.courseLength);
            free.lateral = this.laneCenters[spawn.laneIndex] + spawn.lateralOffset;
        }
        const radiusSq = STIMULANT_BRAWL_TUNING.pickupRadius ** 2;
        for (let index = 0; index < this.racers.length; index++) {
            const racer = this.racers[index];
            if (!racer.active || !racer.canContact || racer.finished) {
                this.previousX[index] = NaN; this.previousZ[index] = NaN; continue;
            }
            const x = entertainmentCourseOffset(racer.distance, this.courseLength);
            const direction = Math.floor(racer.distance / this.courseLength) % 2 === 0 ? 1 : -1;
            for (const slot of this.slots) {
                if (!slot.active || slot.age < ENTERTAINMENT_DEBUG_TUNING.supplyThrowSeconds) continue;
                if (stimulantPickupDistanceSquared(slot.courseX, slot.lateral, x, racer.lateral,
                    this.previousX[index], this.previousZ[index], Math.cos(racer.heading) * direction,
                    Math.sin(racer.heading), STIMULANT_BRAWL_TUNING.pickupBodyHalfLength, Math.max(3, Math.min(8, dt * 12))) > radiusSq) continue;
                // 先移出公共池，再通知效果，同一物品只由一位选手获得。
                slot.active = false;
                this.onPickup(index, slot.kind);
            }
            this.previousX[index] = x; this.previousZ[index] = racer.lateral;
        }
    }
    targetZForAi(index: number, energyRatio: number, hr: number): number | null {
        const racer = this.racers[index];
        if (!racer.active || racer.finished || !racer.canContact) return null;
        const x = entertainmentCourseOffset(racer.distance, this.courseLength);
        const direction = Math.floor(racer.distance / this.courseLength) % 2 === 0 ? 1 : -1;
        let target: SupplySlot | null = null, best = Infinity;
        for (const slot of this.slots) {
            if (!slot.active) continue;
            if (slot.kind === 'heartbeat-soda' ? energyRatio > .7 || hr >= STIMULANT_BRAWL_TUNING.aiSkipHeartRate
                : hr < STIMULANT_BRAWL_TUNING.calmSlushAiPreferHeartRate) continue;
            const ahead = (slot.courseX - x) * direction;
            if (ahead < .5 || ahead > ENTERTAINMENT_DEBUG_TUNING.aiLookAhead) continue;
            const score = ahead + Math.abs(slot.lateral - racer.lateral) * 1.5;
            if (score < best) { target = slot; best = score; }
        }
        return target?.lateral ?? null;
    }
}
