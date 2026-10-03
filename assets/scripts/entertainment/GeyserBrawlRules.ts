import { SeededRandom } from '../core/SharedRNG';
import { GEYSER_TUNING } from '../core/EntertainmentBalance';

/** 喷泉的赛果规则与预警节奏；不依赖场景节点或渲染帧率。 */
export type GeyserIntensity = 1 | 2 | 3 | 4 | 5;
export type GeyserVent = Readonly<{ id: number; x: number; z: number; offsetSeconds: number;
    size?: 'small' | 'large'; mixed?: boolean }>;
export type GeyserPulsePhase = 'waiting' | 'warning' | 'burst' | 'falling' | 'rest' | 'done';
export type GeyserHitStrength = 0 | 1 | 2;

export { GEYSER_TUNING } from '../core/EntertainmentBalance';

export type GeyserTuning = Readonly<typeof GEYSER_TUNING>;

export type GeyserSpec = Readonly<{
    ventCount: number;
    pulseCount: number;
    staggerSeconds: number;
    actionSeconds: number;
    largeCount: number;
}>;

const SPECS: readonly GeyserSpec[] = [
    { ventCount: 2, pulseCount: 2, staggerSeconds: 1.1, actionSeconds: 9, largeCount: 0 },
    { ventCount: 4, pulseCount: 2, staggerSeconds: 1.1, actionSeconds: 10, largeCount: 1 },
    { ventCount: 6, pulseCount: 2, staggerSeconds: 1.1, actionSeconds: 10, largeCount: 1 },
    { ventCount: 8, pulseCount: 3, staggerSeconds: 1.1, actionSeconds: 15, largeCount: 2 },
    { ventCount: 10, pulseCount: 3, staggerSeconds: 1.1, actionSeconds: 15, largeCount: 3 },
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

}

export function geyserHitId(serial: number, pulse: number, vent: number, lane: number): number {
    return serial * 1000 + pulse * 128 + vent * 8 + lane + 1;
}

export function geyserSpec(level: GeyserIntensity, tuning: GeyserTuning = GEYSER_TUNING): GeyserSpec {
    const spec = SPECS[level - 1] ?? SPECS[0];
    const lead = spec.largeCount ? tuning.largeWarningLeadSeconds : 0;
    const last = spec.ventCount - 1;
    const end = Math.floor(last / 4) * spec.staggerSeconds + (last % 4) * 0.08
        + (spec.pulseCount - 1) * geyserCycleSeconds(tuning) + lead + tuning.warningSeconds
        + tuning.burstSeconds + tuning.fallingSeconds + 0.3;
    return { ...spec, actionSeconds: Math.ceil(Math.max(spec.actionSeconds + lead, end) * 100) / 100 };
}

export function geyserRadiusScale(vent: GeyserVent, tuning: GeyserTuning = GEYSER_TUNING): number {
    return vent.size === 'large' ? tuning.largeRadiusScale : 1;
}

export function geyserWarningSeconds(vent: GeyserVent, tuning: GeyserTuning = GEYSER_TUNING): number {
    return tuning.warningSeconds + (vent.size === 'large' ? tuning.largeWarningLeadSeconds : 0);
}

export function geyserJetTop(vent: GeyserVent, height: number, swimY: number, waterY: number,
    tuning: GeyserTuning = GEYSER_TUNING): number {
    const top = swimY - 1.4 + height * 2.7;
    return top <= waterY ? top : waterY + (top - waterY) * (vent.size === 'large' ? tuning.largeJetHeightScale : 1);
}

export function geyserLargeMask(vents: readonly GeyserVent[]): number {
    let mask = 0;
    for (const vent of vents) if (vent.size === 'large') mask |= 1 << vent.id;
    return mask;
}

export function applyGeyserSizes(vents: readonly GeyserVent[], mask: number, mixed: boolean): readonly GeyserVent[] {
    return vents.map(vent => ({ ...vent, size: mask & (1 << vent.id) ? 'large' : 'small', mixed }));
}

export function geyserCycleSeconds(tuning: GeyserTuning = GEYSER_TUNING): number {
    return tuning.warningSeconds + tuning.burstSeconds
        + tuning.fallingSeconds + tuning.restSeconds;
}

export function geyserPulseStart(vent: GeyserVent, pulseIndex: number, tuning: GeyserTuning = GEYSER_TUNING): number {
    return vent.offsetSeconds + pulseIndex * geyserCycleSeconds(tuning)
        + (vent.mixed && vent.size !== 'large' ? tuning.largeWarningLeadSeconds : 0);
}

export function geyserPhaseAt(vent: GeyserVent, age: number, pulseCount: number, tuning: GeyserTuning = GEYSER_TUNING): GeyserPulsePhase {
    const first = geyserPulseStart(vent, 0, tuning);
    if (!Number.isFinite(age) || age < first) return 'waiting';
    const cycle = geyserCycleSeconds(tuning);
    const pulse = Math.floor((age - first) / cycle);
    if (pulse >= pulseCount) return 'done';
    const local = age - geyserPulseStart(vent, pulse, tuning) + 1e-8;
    const warning = geyserWarningSeconds(vent, tuning);
    if (local < warning) return 'warning';
    if (local < warning + tuning.burstSeconds) return 'burst';
    if (local < warning + tuning.burstSeconds
        + tuning.fallingSeconds) return 'falling';
    return pulse + 1 >= pulseCount ? 'done' : 'rest';
}

export function geyserPulseIndex(vent: GeyserVent, age: number, tuning: GeyserTuning = GEYSER_TUNING): number {
    return Math.max(0, Math.floor((age - geyserPulseStart(vent, 0, tuning)) / geyserCycleSeconds(tuning)));
}

export function geyserBurstOverlap(vent: GeyserVent, pulse: number,
    fromAge: number, toAge: number, tuning: GeyserTuning = GEYSER_TUNING): number {
    const burstStart = geyserPulseStart(vent, pulse, tuning) + geyserWarningSeconds(vent, tuning);
    const burstEnd = burstStart + tuning.burstSeconds;
    return Math.max(0, Math.min(toAge, burstEnd) - Math.max(fromAge, burstStart));
}

/** 水柱从池底上升；归一化高度可供玩法和表现同时消费。 */
export function geyserBurstHeight(vent: GeyserVent, pulse: number, age: number, tuning: GeyserTuning = GEYSER_TUNING): number {
    const burstAge = age - geyserPulseStart(vent, pulse, tuning) - geyserWarningSeconds(vent, tuning);
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
    const scale = geyserRadiusScale(vent, tuning);
    return distanceSq <= (tuning.coreRadius * scale) ** 2 ? 2
        : distanceSq <= (tuning.edgeRadius * scale) ** 2 ? 1 : 0;
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
