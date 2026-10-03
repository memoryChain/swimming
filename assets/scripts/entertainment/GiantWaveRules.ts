import { SeededRandom } from '../core/SharedRNG';
import { GIANT_WAVE_TUNING, GIANT_WAVE_INTENSITY_TUNING } from '../core/EntertainmentBalance';

/** 位置为世界坐标；顺浪为正作用，迎浪为负作用。仅用于独立调试模式。 */
export type GiantWavePreset = 'three' | 'single';
export type GiantWaveIntensity = 1 | 2 | 3 | 4 | 5;
export { GIANT_WAVE_TUNING, GIANT_WAVE_INTENSITY_TUNING } from '../core/EntertainmentBalance';

/** 开局快照；保存的基础调参与各档增减量共同决定实际规格。 */
export function giantWaveSpec(level: GiantWaveIntensity = 3): Readonly<typeof GIANT_WAVE_TUNING> {
    const offsets = GIANT_WAVE_INTENSITY_TUNING;
    const offset = offsets[level - 1] ?? offsets[2];
    const base = GIANT_WAVE_TUNING;
    return {
        ...base,
        widthFraction: Math.max(0.25, Math.min(0.8, base.widthFraction + offset.widthOffset)),
        lengthFraction: Math.max(0.06, Math.min(0.2, base.lengthFraction + offset.lengthOffset)),
        oppositionSlowdown: Math.max(0.1, Math.min(0.5, base.oppositionSlowdown + offset.slowdownOffset)),
        gapSeconds: Math.max(3, Math.min(10, base.gapSeconds + offset.gapOffset)),
    };
}

/** three 保留旧预设身份；200 米三波、400 米七波，每个非末泳段最多一波。 */
export function giantWaveCount(preset: GiantWavePreset, raceDistance = 200, courseLength = 50): number {
    return preset === 'single' ? 1 : Math.max(1, Math.ceil(raceDistance / Math.max(1, courseLength)) - 1);
}
export interface GiantWaveSample {
    distance: number; x: number; z: number; direction: number; speed: number; eligible: boolean;
}
export interface GiantWaveState {
    phase: 'waiting' | 'preview' | 'active' | 'gap' | 'complete';
    wave: number; age: number; timer: number; closing: boolean;
    x: number; startX: number; z: number; direction: number;
    width: number; length: number; boost: number; slowdown: number;
    entrance: number; fadeTime: number; endX: number; travelDistance: number; speed: number;
    growthTime: number; impactTime: number;
}
export function newGiantWaveState(): GiantWaveState {
    return { phase: 'waiting', wave: 0, age: 0, timer: 0, x: 0, startX: 0, z: 0,
        direction: 1, width: 1, length: 1, boost: 1.1, slowdown: 0.3,
        entrance: 1.2, fadeTime: 1, closing: false,
        endX: 44, travelDistance: 44, speed: 4.2, growthTime: 3.5, impactTime: 1.2 };
}
export function waveArrivalTime(s: GiantWaveState): number { return s.travelDistance / s.speed; }
export function waveDuration(s: GiantWaveState): number { return waveArrivalTime(s) + s.impactTime + s.fadeTime; }
/** 统一浪速，不读取人群位置、排名、朝向或游速；抵岸精确截停。 */
export function waveTravel(s: GiantWaveState, age: number): number {
    return Math.min(s.travelDistance, Math.max(0, age) * s.speed);
}
export function waveEnvelope(s: GiantWaveState): number {
    if (s.phase !== 'active') return 0;
    const grow = Math.max(0, Math.min(1, s.age / s.growthTime));
    const settle = Math.max(0, Math.min(1, (s.age - waveArrivalTime(s)) / (s.impactTime + s.fadeTime)));
    return grow * grow * (3 - 2 * grow) * (1 - settle * settle * (3 - 2 * settle));
}
/** 同一浪面空间强度相同，按当前泳段方向返回正负；折返后自然换边。 */
export function waveWeight(s: GiantWaveState, x: number, z: number, direction: number): number {
    if (s.phase !== 'active' || s.age < s.entrance || s.age >= waveArrivalTime(s)) return 0;
    const t = Math.max(0, Math.min(1, s.age / s.growthTime));
    const grow = t * t * (3 - 2 * t), lengthScale = 0.25 + 0.75 * grow;
    const center = s.x - s.direction * s.length * (1 - lengthScale) * 0.5;
    const along = Math.abs(x - center) / (s.length * lengthScale * 0.5);
    const lateral = Math.abs(z - s.z) / (s.width * (0.5 + grow * 0.5) * 0.5);
    if (along >= 1 || lateral >= 1) return 0;
    const edge = Math.cos(lateral * Math.PI * 0.5);
    const strength = Math.min(1, (1 - along) * 4) * edge * edge * waveEnvelope(s);
    return direction === s.direction ? strength : -strength;
}
/** 短路径采样覆盖迎面快速穿浪；瞬移不沿整条路径补领作用。 */
export function sweptWaveWeight(s: GiantWaveState, x: number, z: number, oldX: number,
    oldZ: number, direction: number, dt: number): number {
    if (s.phase !== 'active' || s.age < s.entrance || s.age >= waveArrivalTime(s)) return 0;
    if (Math.hypot(x - oldX, z - oldZ) > 3) return waveWeight(s, x, z, direction);
    const movement = s.direction * (waveTravel(s, s.age) - waveTravel(s, Math.max(0, s.age - dt)));
    let sum = 0;
    for (let i = 0; i < 4; i++) {
        const t = (i + 0.5) / 4;
        sum += waveWeight(s, oldX + (x - oldX) * t + movement * (1 - t),
            oldZ + (z - oldZ) * t, direction);
    }
    return sum * 0.25;
}
/** AI 只消费已公开的预告和当前位置：顺浪并入，迎浪寻找最近的可用侧边。 */
export function giantWaveTargetZ(s: GiantWaveState, p: GiantWaveSample, index: number,
    poolWidth: number, worldScale: number): number | null {
    if (!p?.eligible || s.phase !== 'preview' && s.phase !== 'active'
        || s.phase === 'active' && s.age >= waveArrivalTime(s) - 0.5) return null;
    const ahead = (s.x - p.x) * p.direction;
    if (p.direction !== s.direction) {
        if (s.phase === 'active' && (ahead < -s.length * 0.5
            || ahead > s.length + (s.speed + p.speed * worldScale) * 3)) return null;
        if (Math.abs(p.z - s.z) > s.width * 0.5 + 0.25) return null;
        const limit = poolWidth * 0.5 - 0.55;
        const left = s.z - s.width * 0.5 - 0.65, right = s.z + s.width * 0.5 + 0.65;
        if (left < -limit) return right <= limit ? right : null;
        if (right > limit) return left;
        return Math.abs(p.z - left) <= Math.abs(p.z - right) ? left : right;
    }
    if (s.phase === 'active') {
        const catchUp = Math.max(0, s.speed - p.speed * worldScale) * 3;
        if (ahead < -s.length * 0.5 - catchUp || ahead > s.length + p.speed * worldScale * 1.5) return null;
    }
    const target = s.z + (((index * 5) % 8) / 7 - 0.5) * s.width * 0.45;
    const lateralTime = Math.abs(target - p.z) / Math.max(0.4, p.speed * 0.4);
    return lateralTime <= waveArrivalTime(s) - s.age - 1 ? target : null;
}
/** 单一有符号槽，过零时分别积分助力和阻力，避免两套状态叠加或帧率误差。 */
export function advanceWaveBoost(current: number, target: number, maximum: number, dt: number,
    out: { speed: number; average: number; positiveAverage?: number; negativeAverage?: number },
    tuning: Readonly<typeof GIANT_WAVE_TUNING> = GIANT_WAVE_TUNING): void {
    const opposing = target < 0 || target === 0 && current < 0;
    const building = Math.abs(target) > Math.abs(current) || current * target < 0;
    const seconds = opposing
        ? building ? tuning.oppositionRiseSeconds : tuning.oppositionReleaseSeconds
        : building ? tuning.riseSeconds : tuning.releaseSeconds;
    const rate = Math.max(0.01, maximum) / Math.max(0.05, seconds);
    const time = Math.min(Math.max(0, dt), Math.abs(target - current) / rate);
    out.speed = current + Math.sign(target - current) * rate * time;
    const area = (current + out.speed) * 0.5 * time + out.speed * (dt - time);
    out.average = dt > 0 ? area / dt : current;
    let positive = Math.max(0, (current + out.speed) * 0.5) * time;
    let negative = Math.max(0, -(current + out.speed) * 0.5) * time;
    if (current * out.speed < 0) {
        const cross = Math.abs(current) / rate;
        positive = (current > 0 ? current * cross : out.speed * (time - cross)) * 0.5;
        negative = (current < 0 ? -current * cross : -out.speed * (time - cross)) * 0.5;
    }
    out.positiveAverage = dt > 0 ? (positive + Math.max(0, out.speed) * (dt - time)) / dt : Math.max(0, current);
    out.negativeAverage = dt > 0 ? (negative + Math.max(0, -out.speed) * (dt - time)) / dt : Math.max(0, -current);
}

export class GiantWaveSimulation {
    readonly state = newGiantWaveState();
    readonly spec: Readonly<typeof GIANT_WAVE_TUNING>;
    readonly maxWaves: number;
    private readonly random = new SeededRandom(1);
    previews = 0;
    cancelled = 0;
    constructor(readonly courseLength: number, readonly minX: number, readonly maxX: number,
        readonly poolWidth: number, readonly seed: number, readonly preset: GiantWavePreset,
        readonly swimSpan = maxX - minX, readonly intensity: GiantWaveIntensity = 3,
        readonly raceDistance = 200) {
        this.spec = giantWaveSpec(intensity);
        this.maxWaves = giantWaveCount(preset, raceDistance, courseLength);
    }
    reset(): void { Object.assign(this.state, newGiantWaveState()); this.previews = 0; this.cancelled = 0; }
    update(dt: number, samples: readonly GiantWaveSample[], finished: boolean): void {
        const s = this.state;
        if (!(dt > 0) || !Number.isFinite(dt) || s.phase === 'complete') return;
        if (finished) s.closing = true;
        if (s.closing && s.phase !== 'active') { s.phase = 'complete'; return; }
        if (s.phase === 'active') {
            s.age = Math.min(waveDuration(s), s.age + dt);
            s.x = s.age >= waveArrivalTime(s) ? s.endX : s.startX + s.direction * waveTravel(s, s.age);
            if (s.age >= waveDuration(s)) {
                s.phase = s.closing ? 'complete' : 'gap';
                s.timer = this.spec.gapSeconds + this.spec.releaseSeconds;
            }
            return;
        }
        if (s.phase === 'gap') {
            s.timer = Math.max(0, s.timer - dt);
            if (s.timer === 0) { s.wave++; s.phase = 'waiting'; }
            return;
        }
        if (s.wave >= this.maxWaves) { s.phase = 'complete'; return; }
        if (s.phase === 'waiting') {
            // 赛程只负责排期；方向、位置与浪速不消费任何选手数据。
            let lead = 0;
            for (let i = 0; i < samples.length; i++) lead = Math.max(lead, samples[i].distance);
            if (lead >= (s.wave + 1) * this.courseLength) { s.wave++; this.cancelled++; return; }
            if (lead < (s.wave + this.spec.anchorFraction) * this.courseLength) return;
            this.prepare();
            s.phase = 'preview'; s.timer = this.spec.previewSeconds; this.previews++;
            return;
        }
        s.timer = Math.max(0, s.timer - dt);
        if (s.timer === 0) { s.phase = 'active'; s.age = 0; }
    }
    private prepare(): void {
        const s = this.state, t = this.spec;
        // 使用 SharedRNG 的独立子流。每波两次独立抽样，取消或其他系统用随机数均不串流。
        this.random.seed((this.seed ^ 0x73ab19d5 ^ Math.imul(s.wave + 1, 0x45d9f3b)) >>> 0);
        s.direction = this.random.next() < 0.5 ? -1 : 1;
        s.width = this.poolWidth * t.widthFraction;
        s.length = Math.max(2, (this.maxX - this.minX) * t.lengthFraction);
        const lateralRoom = Math.max(0, (this.poolWidth - s.width) * 0.5 - 0.3);
        s.z = this.random.range(-lateralRoom, lateralRoom);
        s.startX = (s.direction > 0 ? this.minX : this.maxX) + s.direction * s.length * 0.5;
        s.endX = (s.direction > 0 ? this.maxX : this.minX) - s.direction * s.length * 0.5;
        s.travelDistance = (s.endX - s.startX) * s.direction; s.x = s.startX; s.age = 0;
        s.speed = t.travelSpeed * this.swimSpan / this.courseLength;
        s.boost = t.boostSpeed; s.slowdown = t.oppositionSlowdown;
        s.entrance = t.entranceSeconds; s.growthTime = t.growthSeconds;
        s.impactTime = t.impactSeconds; s.fadeTime = t.fadeSeconds;
    }
}
