/** 狂野／娱乐跟游参数；距离单位米，时间单位秒。 */
export const DRAFTING_TUNING = {
    enabled: true,
    energySavingRatio: 0.15,
    minDistance: 2.2,
    maxDistance: 5,
    width: 1.6,
    maxAge: 2.5,
    startSpeed: 0.8,
    stopSpeed: 0.6,
    enterSeconds: 0.15,
    exitSeconds: 0.15,
    residueSeconds: 0.4,
    visuals: true,
};
export const DRAFTING_SAMPLE_SECONDS = 1 / 15;
export const DRAFTING_POINTS = 48;
const MAX_SAMPLE_DISTANCE_SQUARED = 2.25;

export interface DraftingRacer {
    x: number;
    z: number;
    dx: number;
    dz: number;
    speed: number;
    leg: number;
    eligible: boolean;
    /** 位置大校正或瞬移的代次；改变时切断历史轨迹。 */
    epoch: number;
}

export class DraftingPath {
    readonly x = new Float32Array(DRAFTING_POINTS);
    readonly z = new Float32Array(DRAFTING_POINTS);
    readonly time = new Float64Array(DRAFTING_POINTS);
    count = 0;
    head = -1;
    leg = -1;
    epoch = -1;
    generating = false;
    stoppedAt = -1;
    clear(): void { this.count = 0; this.head = -1; this.generating = false; this.stoppedAt = -1; }
    index(back: number): number { return (this.head - back + DRAFTING_POINTS) % DRAFTING_POINTS; }
}

/** 固定容量、无引擎依赖。显示和判定消费同一条世界路径。 */
export class DraftingModel {
    readonly racers: DraftingRacer[];
    readonly paths: DraftingPath[];
    readonly source: Int8Array;
    private readonly candidate: Int8Array;
    private readonly confirmed: Float32Array;
    private readonly missing: Float32Array;
    clock = 0;
    revision = 0;

    constructor(count: number) {
        this.racers = Array.from({ length: count }, () => ({ x: 0, z: 0, dx: 1, dz: 0, speed: 0, leg: 0, eligible: false, epoch: 0 }));
        this.paths = Array.from({ length: count }, () => new DraftingPath());
        this.source = new Int8Array(count).fill(-1);
        this.candidate = new Int8Array(count).fill(-1);
        this.confirmed = new Float32Array(count);
        this.missing = new Float32Array(count);
    }

    reset(): void {
        for (const path of this.paths) path.clear();
        this.source.fill(-1); this.candidate.fill(-1);
        this.confirmed.fill(0); this.missing.fill(0);
        this.revision++;
    }

    step(dt: number): void {
        this.clock += Math.max(0, dt);
        for (let lane = 0; lane < this.racers.length; lane++) this.sample(lane);
        for (let lane = 0; lane < this.racers.length; lane++) {
            const old = this.source[lane];
            if (!this.racers[lane].eligible) { this.clearSource(lane); continue; }
            if (old >= 0 && this.contains(lane, old)) {
                this.missing[lane] = 0;
                continue;
            }
            if (old >= 0) {
                this.missing[lane] += dt;
                if (this.hardValid(lane, old) && this.missing[lane] < DRAFTING_TUNING.exitSeconds) continue;
                this.clearSource(lane);
            }
            let next = -1;
            for (let other = 0; other < this.racers.length; other++) {
                if (this.contains(lane, other)) { next = other; break; }
            }
            if (next !== this.candidate[lane]) {
                this.candidate[lane] = next; this.confirmed[lane] = 0;
            }
            if (next >= 0) {
                this.confirmed[lane] += dt;
                if (this.confirmed[lane] + 1e-6 >= DRAFTING_TUNING.enterSeconds) this.source[lane] = next;
            }
        }
        this.revision++;
    }

    private clearSource(lane: number): void {
        this.source[lane] = -1; this.candidate[lane] = -1;
        this.confirmed[lane] = 0; this.missing[lane] = 0;
    }

    private sample(lane: number): void {
        const r = this.racers[lane], p = this.paths[lane];
        if (!r.eligible || p.leg !== r.leg || p.epoch !== r.epoch) { p.clear(); this.clearSource(lane); }
        p.leg = r.leg; p.epoch = r.epoch;
        if (!r.eligible) return;
        if (r.speed < (p.generating ? DRAFTING_TUNING.stopSpeed : DRAFTING_TUNING.startSpeed)) {
            if (p.generating) { p.generating = false; p.stoppedAt = this.clock; }
            if (p.stoppedAt >= 0 && this.clock - p.stoppedAt >= DRAFTING_TUNING.residueSeconds) p.clear();
            return;
        }
        if (p.head >= 0) {
            const dx = r.x - p.x[p.head], dz = r.z - p.z[p.head];
            // 有效位置跨越过大时只重建，不画出横穿泳池的长线。
            if (dx * dx + dz * dz > MAX_SAMPLE_DISTANCE_SQUARED) { p.clear(); this.clearSource(lane); }
            else if (dx * dx + dz * dz < 0.0025) {
                // 远端位置包之间可能有数个相同采样，不能把每个间隔都当作停游。
                if (this.clock - p.time[p.head] < 0.2) return;
                if (p.generating) { p.generating = false; p.stoppedAt = this.clock; }
                if (this.clock - p.stoppedAt >= DRAFTING_TUNING.residueSeconds) p.clear();
                return;
            }
        }
        p.generating = true; p.stoppedAt = -1;
        p.head = (p.head + 1) % DRAFTING_POINTS;
        p.x[p.head] = r.x; p.z[p.head] = r.z; p.time[p.head] = this.clock;
        p.count = Math.min(DRAFTING_POINTS, p.count + 1);
    }

    hardValid(lane: number, leader: number): boolean {
        if (leader < 0 || leader >= this.racers.length || leader === lane) return false;
        const r = this.racers[lane], l = this.racers[leader], p = this.paths[leader];
        return r.eligible && l.eligible && r.leg === l.leg && p.leg === l.leg && p.epoch === l.epoch
            && p.count >= 2 && this.pathIsContinuous(leader) && r.dx * l.dx + r.dz * l.dz > 0.7
            && (l.x - r.x) * l.dx + (l.z - r.z) * l.dz > 0
            && this.clock - p.time[p.head] <= DRAFTING_TUNING.maxAge
            && (p.generating || (p.stoppedAt >= 0 && this.clock - p.stoppedAt < DRAFTING_TUNING.residueSeconds));
    }

    contains(lane: number, leader: number): boolean {
        if (!this.hardValid(lane, leader)) return false;
        const r = this.racers[lane], l = this.racers[leader], p = this.paths[leader];
        const dx = r.x - l.x, dz = r.z - l.z;
        if (dx * dx + dz * dz < DRAFTING_TUNING.minDistance * DRAFTING_TUNING.minDistance) return false;
        if (dx * dx + dz * dz > Math.pow(DRAFTING_TUNING.maxDistance + DRAFTING_TUNING.width, 2)) return false;
        let along = Math.hypot(l.x - p.x[p.head], l.z - p.z[p.head]);
        for (let back = 1; back < p.count; back++) {
            const a = p.index(back - 1), b = p.index(back);
            if (this.clock - p.time[b] > DRAFTING_TUNING.maxAge) break;
            const vx = p.x[a] - p.x[b], vz = p.z[a] - p.z[b];
            const length2 = vx * vx + vz * vz, length = Math.sqrt(length2);
            if (length < 0.001) continue;
            const t = ((r.x - p.x[b]) * vx + (r.z - p.z[b]) * vz) / length2;
            const distance = along + (1 - t) * length;
            const ex = r.x - p.x[b] - vx * t, ez = r.z - p.z[b] - vz * t;
            if (t >= -1e-5 && t <= 1.00001 && distance >= DRAFTING_TUNING.minDistance && distance <= DRAFTING_TUNING.maxDistance
                && ex * ex + ez * ez <= DRAFTING_TUNING.width * DRAFTING_TUNING.width * 0.25
                && (r.dx * vx + r.dz * vz) / length > 0.7) return true;
            along += length;
            if (along > DRAFTING_TUNING.maxDistance) break;
        }
        return false;
    }

    costScale(lane: number): number {
        const leader = this.source[lane];
        const own = this.paths[lane], racer = this.racers[lane];
        return DRAFTING_TUNING.enabled && own.epoch === racer.epoch && own.leg === racer.leg
            && this.pathIsContinuous(lane) && this.contains(lane, leader)
            ? 1 - Math.max(0, Math.min(0.5, DRAFTING_TUNING.energySavingRatio)) : 1;
    }

    private pathIsContinuous(lane: number): boolean {
        const p = this.paths[lane], r = this.racers[lane];
        if (p.head < 0) return false;
        const dx = r.x - p.x[p.head], dz = r.z - p.z[p.head];
        return dx * dx + dz * dz <= MAX_SAMPLE_DISTANCE_SQUARED;
    }

    /** AI 只寻找附近的可跟随者，目标窗口由原 AI 观察节奏保持。 */
    targetLane(lane: number): number {
        const current = this.source[lane];
        const r = this.racers[lane];
        if (current >= 0 && this.hardValid(lane, current)) {
            const leader = this.racers[current];
            const gap = (leader.x - r.x) * leader.dx + (leader.z - r.z) * leader.dz;
            if (gap >= DRAFTING_TUNING.minDistance + 0.3 && r.speed <= leader.speed + 0.3) return current;
        }
        let best = -1, score = Infinity;
        for (let other = 0; other < this.racers.length; other++) {
            if (!this.hardValid(lane, other)) continue;
            const l = this.racers[other];
            const forward = (l.x - r.x) * l.dx + (l.z - r.z) * l.dz;
            const side = Math.abs((l.x - r.x) * l.dz - (l.z - r.z) * l.dx);
            if (forward < DRAFTING_TUNING.minDistance + 0.3 || forward > DRAFTING_TUNING.maxDistance
                || side > 2.5 || r.speed > l.speed + 0.3) continue;
            const value = side * 2 + Math.abs(forward - 3.4);
            if (value < score) { best = other; score = value; }
        }
        return best;
    }
}
