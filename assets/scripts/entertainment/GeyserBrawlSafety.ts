import { SeededRandom } from '../core/SharedRNG';
import { geyserSpec, geyserCycleSeconds, type GeyserIntensity, type GeyserTuning, type GeyserVent } from './GeyserBrawlRules';

/** 已有障碍的危险范围描述。 */
export type GeyserDanger = Readonly<{ x: number; z: number; radius: number }>;
export type GeyserSafetyResult = Readonly<{ mask: number; rejectedSpace: number }>;

/** 每排最多四口；沿用危险范围及池边余量，检查这一排是否把横向通道完全盖住。 */
function rowHasPassage(row: number, mask: number, vents: readonly GeyserVent[],
    halfWidth: number, tuning: GeyserTuning): boolean {
    const bound = halfWidth - .8;
    if (bound <= 0) return false;
    let covered = -bound;
    for (let pass = 0; pass <= vents.length; pass++) {
        let next = covered;
        for (const vent of vents) {
            if (Math.floor(vent.id / 4) !== row) continue;
            const radius = tuning.edgeRadius * (mask & (1 << vent.id) ? tuning.largeRadiusScale : 1) + .25;
            if (vent.z - radius <= covered) next = Math.max(next, vent.z + radius);
        }
        if (next === covered) return true;
        if (next >= bound) return false;
        covered = next;
    }
    return false;
}

/** 只查排布，不搜索选手路线：大口不贴墙、同排最多一个、错峰、不贴近已有障碍，并留出横向通道。 */
export function selectGeyserLargeMask(seed: number, serial: number, intensity: GeyserIntensity,
    vents: readonly GeyserVent[], halfWidth: number, dangers: readonly GeyserDanger[],
    tuning: GeyserTuning): GeyserSafetyResult {
    const spec = geyserSpec(intensity, tuning);
    const random = new SeededRandom((seed ^ Math.imul(serial, 0x9e3779b1) ^ 0x4c415247) >>> 0);
    const candidates = vents.map(v => v.id);
    for (let i = candidates.length - 1; i > 0; i--) {
        const j = random.int(i + 1), tmp = candidates[i]; candidates[i] = candidates[j]; candidates[j] = tmp;
    }
    // 尾排优先，保留原随机顺序及大口间的错峰条件。
    candidates.sort((a, b) => Math.floor(b / 4) - Math.floor(a / 4));
    let mask = 0, count = 0, rejectedSpace = 0;
    const radius = tuning.edgeRadius * tuning.largeRadiusScale;
    const cycle = geyserCycleSeconds(tuning);
    for (const id of candidates) {
        if (count >= spec.largeCount) break;
        const vent = vents[id], row = Math.floor(id / 4);
        let blocked = Math.abs(vent.z) + radius + .25 > halfWidth;
        for (const other of vents) if (mask & (1 << other.id)) {
            const gap = Math.abs(other.offsetSeconds - vent.offsetSeconds);
            if (Math.floor(other.id / 4) === row || gap < tuning.burstSeconds + .02
                || cycle - gap < tuning.burstSeconds + .02) blocked = true;
        }
        for (const danger of dangers) if (Math.hypot(vent.x - danger.x, vent.z - danger.z) < radius + danger.radius + .5) blocked = true;
        const proposed = mask | (1 << id);
        if (blocked || !rowHasPassage(row, proposed, vents, halfWidth, tuning)) { rejectedSpace++; continue; }
        mask = proposed; count++;
    }
    return { mask, rejectedSpace };
}
