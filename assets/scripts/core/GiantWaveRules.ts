import { SeededRandom } from './SharedRNG';

/** 位置为世界坐标；顺浪为正作用，迎浪为负作用。仅用于独立调试模式。 */
export type GiantWavePreset = 'three' | 'single';
export type GiantWaveIntensity = 1 | 2 | 3 | 4 | 5;
export const GIANT_WAVE_TUNING = {
    widthFraction: 0.55, lengthFraction: 0.12, height: 0.48,
    previewSeconds: 3, entranceSeconds: 1.2,
    growthSeconds: 3.5, impactSeconds: 1.2, fadeSeconds: 1, gapSeconds: 5,
    travelSpeed: 4.2, boostSpeed: 1.1, oppositionSlowdown: 0.3,
    riseSeconds: 0.35, releaseSeconds: 0.6,
    oppositionRiseSeconds: 0.12, oppositionReleaseSeconds: 0.2, anchorFraction: 0.04,
};
const GIANT_WAVE_DEFAULTS = { ...GIANT_WAVE_TUNING };
/** 综合导演每次只发一波，窗口包含拍岸、余沫及推进恢复。 */
export const ENTERTAINMENT_GIANT_WAVE_SECONDS = 20;

/** 以原有调参为三档基准；档位只改变覆盖、迎浪压力与间隔，不提高顺浪收益。 */
export const GIANT_WAVE_INTENSITY_TUNING = [
    { widthOffset: -0.20, lengthOffset: -0.04, slowdownOffset: -0.15, gapOffset: 2 },
    { widthOffset: -0.10, lengthOffset: -0.02, slowdownOffset: -0.08, gapOffset: 1 },
    { widthOffset: 0, lengthOffset: 0, slowdownOffset: 0, gapOffset: 0 },
    { widthOffset: 0.10, lengthOffset: 0.02, slowdownOffset: 0.08, gapOffset: -1 },
    { widthOffset: 0.20, lengthOffset: 0.04, slowdownOffset: 0.15, gapOffset: -2 },
];
const GIANT_WAVE_DEFAULT_OFFSETS = GIANT_WAVE_INTENSITY_TUNING.map(value => ({ ...value }));

/** 开局快照；保存的基础调参与各档增减量共同决定实际规格。 */
export function giantWaveSpec(level: GiantWaveIntensity = 3, formal = false): Readonly<typeof GIANT_WAVE_TUNING> {
    const offsets = formal ? GIANT_WAVE_DEFAULT_OFFSETS : GIANT_WAVE_INTENSITY_TUNING;
    const offset = offsets[level - 1] ?? offsets[2];
    const base = formal ? GIANT_WAVE_DEFAULTS : GIANT_WAVE_TUNING;
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
        readonly raceDistance = 200, readonly formal = false) {
        this.spec = giantWaveSpec(intensity, formal);
        this.maxWaves = giantWaveCount(preset, raceDistance, courseLength);
    }
    reset(): void { Object.assign(this.state, newGiantWaveState()); this.previews = 0; this.cancelled = 0; }
    /** 综合事件由导演激活，不能再次等待首泳段或再播一次独立预告。 */
    seekEvent(age: number): void {
        if (!Number.isFinite(age) || age < 0) return;
        if (this.state.phase === 'waiting') this.prepare();
        const s = this.state;
        s.age = Math.max(s.age, Math.min(waveDuration(s), age));
        s.phase = s.age >= waveDuration(s) ? 'complete' : 'active';
        s.x = s.age >= waveArrivalTime(s) ? s.endX : s.startX + s.direction * waveTravel(s, s.age);
    }
    /** 仅离线复测；版本 3 校验档位、赛程与冻结规格，不作为联机协议。 */
    snapshot() {
        return { version: 3, seed: this.seed, preset: this.preset, courseLength: this.courseLength,
            intensity: this.intensity, raceDistance: this.raceDistance, spec: { ...this.spec },
            minX: this.minX, maxX: this.maxX, poolWidth: this.poolWidth, swimSpan: this.swimSpan,
            state: { ...this.state }, previews: this.previews, cancelled: this.cancelled };
    }
    restore(value: ReturnType<GiantWaveSimulation['snapshot']>): boolean {
        if (!value || value.version !== 3 || value.seed !== this.seed || value.preset !== this.preset
            || value.intensity !== this.intensity || value.raceDistance !== this.raceDistance || !value.spec
            || value.courseLength !== this.courseLength || value.minX !== this.minX
            || value.maxX !== this.maxX || value.poolWidth !== this.poolWidth || value.swimSpan !== this.swimSpan || !value.state) return false;
        for (const key of Object.keys(this.spec)) if (value.spec[key] !== this.spec[key]) return false;
        const s = value.state;
        if (['waiting', 'preview', 'active', 'gap', 'complete'].indexOf(s.phase) < 0
            || typeof s.closing !== 'boolean' || !Number.isInteger(s.wave) || s.wave < 0 || s.wave > this.maxWaves
            || !Number.isInteger(value.previews) || value.previews < 0 || value.previews > this.maxWaves
            || !Number.isInteger(value.cancelled) || value.cancelled < 0 || value.cancelled > this.maxWaves) return false;
        for (const key of Object.keys(this.state)) {
            if (key === 'phase' || key === 'closing') continue;
            if (!Number.isFinite(s[key])) return false;
        }
        if (s.direction !== 1 && s.direction !== -1 || s.width <= 0 || s.length <= 0
            || s.width > this.poolWidth || s.length > this.maxX - this.minX
            || s.entrance <= 0 || s.fadeTime <= 0 || s.speed <= 0 || s.growthTime <= 0 || s.impactTime <= 0
            || s.travelDistance <= 0 || s.age < 0 || s.age > waveDuration(s) || s.boost <= 0
            || s.slowdown < 0 || s.slowdown > 0.6) return false;
        if (s.phase === 'preview' || s.phase === 'active') {
            if (s.x < this.minX || s.x > this.maxX || s.endX < this.minX || s.endX > this.maxX
                || Math.abs(s.z) + s.width * 0.5 > this.poolWidth * 0.5 + 1e-6
                || Math.abs((s.endX - s.startX) * s.direction - s.travelDistance) > 1e-6) return false;
        }
        Object.assign(this.state, s); this.previews = value.previews; this.cancelled = value.cancelled;
        return true;
    }
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
