import { SeededRandom } from './SharedRNG';

/** 喷泉的赛果规则与预警节奏；不依赖场景节点或渲染帧率。 */
export type GeyserIntensity = 1 | 2 | 3 | 4 | 5;
export type GeyserVent = Readonly<{ id: number; x: number; z: number; offsetSeconds: number }>;
export type GeyserPulsePhase = 'waiting' | 'warning' | 'burst' | 'falling' | 'rest' | 'done';
export type GeyserHitStrength = 0 | 1 | 2;

export const GEYSER_TUNING = {
    warningSeconds: 1.5,
    burstSeconds: 0.95,
    burstRiseSeconds: 0.15,
    fallingSeconds: 0.45,
    restSeconds: 1.8,
    coreRadius: 0.65,
    edgeRadius: 1.2,
    visualWarningRadius: 1.35,
    flightSeconds: 1,
    submergedFlightSeconds: 1.2,
    peakHeight: 1.2,
    entrySpeedScale: 0.75,
    exitSpeedScale: 0.6,
    edgeSlowdownScale: 0.9,
    edgeSeconds: 0.25,
    rehitGraceSeconds: 0.8,
};

export type GeyserTuning = Readonly<typeof GEYSER_TUNING>;
// 同协议联机采用固定规则；单机调参仍使用原对象。
const GEYSER_NET_TUNING: GeyserTuning = Object.freeze({ ...GEYSER_TUNING });
export function geyserTuningForRace(networked: boolean): GeyserTuning {
    return networked ? GEYSER_NET_TUNING : GEYSER_TUNING;
}

export type GeyserSpec = Readonly<{
    ventCount: number;
    pulseCount: number;
    staggerSeconds: number;
    actionSeconds: number;
}>;

const SPECS: readonly GeyserSpec[] = [
    { ventCount: 2, pulseCount: 2, staggerSeconds: 1.1, actionSeconds: 9 },
    { ventCount: 4, pulseCount: 2, staggerSeconds: 1.1, actionSeconds: 10 },
    { ventCount: 6, pulseCount: 2, staggerSeconds: 1.1, actionSeconds: 10 },
    { ventCount: 8, pulseCount: 3, staggerSeconds: 1.1, actionSeconds: 15 },
    { ventCount: 10, pulseCount: 3, staggerSeconds: 1.1, actionSeconds: 15 },
];

/** 每代独立记录喷口/轮次；擦边可升级为核心，乱序和补发不能重复施加。 */
export class GeyserHitLedger {
    private serial = -1;
    private readonly strengths = new Uint8Array(1000);

    accepts(hitId: number, strength: 1 | 2): boolean {
        if (!Number.isSafeInteger(hitId) || hitId < 1000) return false;
        const serial = Math.floor(hitId / 1000);
        return serial > this.serial || (serial === this.serial && this.strengths[hitId % 1000] < strength);
    }

    record(hitId: number, strength: 1 | 2): void {
        if (!this.accepts(hitId, strength)) return;
        const serial = Math.floor(hitId / 1000);
        if (serial !== this.serial) { this.strengths.fill(0); this.serial = serial; }
        this.strengths[hitId % 1000] = strength;
    }

    reset(): void { this.serial = -1; this.strengths.fill(0); }

    snapshot(serial: number, lane: number): { edges: number; cores: number } {
        let edges = 0, cores = 0;
        if (serial === this.serial) for (let pulse = 0; pulse < 3; pulse++) for (let vent = 0; vent < 10; vent++) {
            const strength = this.strengths[pulse * 128 + vent * 8 + lane + 1];
            const bit = 1 << (pulse * 10 + vent);
            if (strength >= 1) edges |= bit;
            if (strength >= 2) cores |= bit;
        }
        return { edges, cores };
    }

    merge(serial: number, lane: number, edges: number, cores: number): void {
        for (let pulse = 0; pulse < 3; pulse++) for (let vent = 0; vent < 10; vent++) {
            const bit = 1 << (pulse * 10 + vent);
            if (edges & bit) this.record(geyserHitId(serial, pulse, vent, lane), cores & bit ? 2 : 1);
        }
    }
}

export function geyserHitId(serial: number, pulse: number, vent: number, lane: number): number {
    return serial * 1000 + pulse * 128 + vent * 8 + lane + 1;
}

export function geyserSpec(level: GeyserIntensity): GeyserSpec {
    return SPECS[level - 1] ?? SPECS[0];
}

export function geyserCycleSeconds(tuning: GeyserTuning = GEYSER_TUNING): number {
    return tuning.warningSeconds + tuning.burstSeconds
        + tuning.fallingSeconds + tuning.restSeconds;
}

export function geyserPulseStart(vent: GeyserVent, pulseIndex: number, tuning: GeyserTuning = GEYSER_TUNING): number {
    return vent.offsetSeconds + pulseIndex * geyserCycleSeconds(tuning);
}

export function geyserPhaseAt(vent: GeyserVent, age: number, pulseCount: number, tuning: GeyserTuning = GEYSER_TUNING): GeyserPulsePhase {
    if (!Number.isFinite(age) || age < vent.offsetSeconds) return 'waiting';
    const cycle = geyserCycleSeconds(tuning);
    const pulse = Math.floor((age - vent.offsetSeconds) / cycle);
    if (pulse >= pulseCount) return 'done';
    const local = age - geyserPulseStart(vent, pulse, tuning) + 1e-8;
    if (local < tuning.warningSeconds) return 'warning';
    if (local < tuning.warningSeconds + tuning.burstSeconds) return 'burst';
    if (local < tuning.warningSeconds + tuning.burstSeconds
        + tuning.fallingSeconds) return 'falling';
    return pulse + 1 >= pulseCount ? 'done' : 'rest';
}

export function geyserPulseIndex(vent: GeyserVent, age: number, tuning: GeyserTuning = GEYSER_TUNING): number {
    return Math.max(0, Math.floor((age - vent.offsetSeconds) / geyserCycleSeconds(tuning)));
}

export function geyserBurstOverlap(vent: GeyserVent, pulse: number,
    fromAge: number, toAge: number, tuning: GeyserTuning = GEYSER_TUNING): number {
    const burstStart = geyserPulseStart(vent, pulse, tuning) + tuning.warningSeconds;
    const burstEnd = burstStart + tuning.burstSeconds;
    return Math.max(0, Math.min(toAge, burstEnd) - Math.max(fromAge, burstStart));
}

/** 水柱从池底上升；归一化高度可供玩法和表现同时消费。 */
export function geyserBurstHeight(vent: GeyserVent, pulse: number, age: number, tuning: GeyserTuning = GEYSER_TUNING): number {
    const burstAge = age - geyserPulseStart(vent, pulse, tuning) - tuning.warningSeconds;
    if (burstAge < 0 || burstAge >= tuning.burstSeconds) return 0;
    return Math.min(1, burstAge / tuning.burstRiseSeconds);
}

/** 只检查 XZ 中心距离；半径已经包含人物躯干近似体积。 */
export function geyserSweptHit(vent: GeyserVent,
    fromX: number, fromZ: number, toX: number, toZ: number, tuning: GeyserTuning = GEYSER_TUNING): GeyserHitStrength {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const lengthSq = dx * dx + dz * dz;
    const ratio = lengthSq > 1e-8 ? Math.max(0, Math.min(1,
        ((vent.x - fromX) * dx + (vent.z - fromZ) * dz) / lengthSq)) : 0;
    const offsetX = fromX + dx * ratio - vent.x;
    const offsetZ = fromZ + dz * ratio - vent.z;
    const distanceSq = offsetX * offsetX + offsetZ * offsetZ;
    return distanceSq <= tuning.coreRadius ** 2 ? 2
        : distanceSq <= tuning.edgeRadius ** 2 ? 1 : 0;
}

/** 喷口坐标是实体泳池坐标；保留一条连续横向安全通路。 */
export function planGeyserVents(seed: number, activationSerial: number,
    intensity: GeyserIntensity, centerX: number, centerZ: number,
    halfLength: number, halfWidth: number, direction = 1): readonly GeyserVent[] {
    const spec = geyserSpec(intensity);
    const random = new SeededRandom((seed ^ Math.imul(activationSerial, 0x9e3779b1) ^ 0x47455953) >>> 0);
    const vents: GeyserVent[] = [];
    const safeHalfLength = Math.max(0, halfLength - 4);
    const safeHalfWidth = Math.max(0, halfWidth - 1.2);
    const laneRotation = random.int(8);
    // 每排最多四口隔道布置，下一排补空道；整片预先冻结，往返方向共用规则。
    for (let index = 0; index < spec.ventCount; index++) {
        const row = Math.floor(index / 4);
        const column = index % 4;
        const lane = (column * 2 + row + laneRotation) % 8;
        const x = centerX + Math.max(-safeHalfLength, Math.min(safeHalfLength,
            direction * (row * 3.4 + random.range(-0.18, 0.18))));
        const z = centerZ + Math.max(-safeHalfWidth, Math.min(safeHalfWidth,
            halfWidth - (lane + 0.5) * halfWidth / 4 + random.range(-0.18, 0.18)));
        vents.push({ id: index, x, z, offsetSeconds: row * spec.staggerSeconds + column * 0.08 });
    }
    return vents;
}
