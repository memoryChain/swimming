import { SeededRandom } from '../core/SharedRNG';
import { STEERING_TUNING } from '../core/SteeringTuning';
import { GEYSER_BODY_REACH } from '../swimmer/GeyserBodyContact';
import { applyGeyserSizes, geyserPulseStart, geyserWarningSeconds, geyserRadiusScale, geyserSpec, geyserCycleSeconds,
    type GeyserIntensity, type GeyserTuning, type GeyserVent } from './GeyserBrawlRules';

export type GeyserDanger = Readonly<{ x: number; z: number; radius: number }>;
export type GeyserRouteRacer = Readonly<{
    x: number; z: number; speed: number; direction: number; heading: number; turnRate: number; roll: number;
    bodyScale?: number; steeringEnabled?: boolean;
}>;
export type GeyserSafetyResult = Readonly<{ mask: number; rejectedSpace: number; rejectedRoute: number }>;

function swept(x: number, z: number, nx: number, nz: number, cx: number, cz: number, radius: number): boolean {
    const dx = nx - x, dz = nz - z, length = dx * dx + dz * dz;
    const t = length > 1e-8 ? Math.max(0, Math.min(1, ((cx - x) * dx + (cz - z) * dz) / length)) : 0;
    return (x + dx * t - cx) ** 2 + (z + dz * t - cz) ** 2 < radius * radius;
}

/** 与身体判定相同的纵向包络，预检略留余量；侧身和转向不能只避开根节点。 */
function bodySwept(x: number, z: number, nx: number, nz: number, dx: number,
    dz: number, scale: number, vent: GeyserVent, radius: number): boolean {
    for (let part = -1; part <= 1; part++) {
        const offset = part * GEYSER_BODY_REACH * .78 * scale;
        if (swept(x + dx * offset, z + dz * offset, nx + dx * offset, nz + dz * offset,
            vent.x, vent.z, radius - .2 + .25 * scale)) return true;
    }
    return false;
}

/** 只在生成时做有界连续轨迹检查。使用实际转向配置、当前惯性和侧滚，不允许瞬时换道。 */
export function geyserRouteAvailable(racer: GeyserRouteRacer, vents: readonly GeyserVent[],
    halfWidth: number, pulseCount: number, seconds: number, tuning: GeyserTuning,
    dangers: readonly GeyserDanger[] = []): boolean {
    const bound = halfWidth - 0.8;
    const rad = Math.PI / 180;
    const steering = racer.steeringEnabled !== false;
    const maxHeading = steering ? Math.min(65, STEERING_TUNING.maxHeading) * rad : 0;
    const maxRate = steering ? STEERING_TUNING.maxTurnRate * rad : 0;
    const impulse = steering ? STEERING_TUNING.turnAngularImpulse * rad * Math.abs(Math.cos(racer.roll)) : 0;
    // 只在一组启动时创建。各条候选路线共用喷发时间表，
    // 未喷发的喷口不做身体距离检查，也不在每个动作分支重复计算时间。
    const radii = new Float64Array(vents.length);
    const intervals = new Float64Array(vents.length * pulseCount * 2);
    for (let i = 0; i < vents.length; i++) {
        radii[i] = tuning.edgeRadius * geyserRadiusScale(vents[i], tuning) + .18;
        for (let pulse = 0; pulse < pulseCount; pulse++) {
            const at = (i * pulseCount + pulse) * 2;
            intervals[at] = geyserPulseStart(vents[i], pulse, tuning) + geyserWarningSeconds(vents[i], tuning);
            intervals[at + 1] = intervals[at] + tuning.burstSeconds;
        }
    }
    const straightMasks: number[] = [];
    for (let time = 0; time < seconds; time += .1) straightMasks.push(burstMask(intervals, vents.length, pulseCount, time, time + .1));
    const straightDamping = Math.exp(-Math.max(0, STEERING_TUNING.turnAngularDrag) * .1);
    let exitX = -Infinity;
    for (const vent of vents) exitX = Math.max(exitX, vent.x * racer.direction
        + tuning.edgeRadius * geyserRadiusScale(vent, tuning) + 1);
    // 每条路径只追一个固定横向出口；证明一条贯穿全片的路，而非各排互不相连的空点。
    for (let candidate = 0; candidate < (steering ? 11 : 1); candidate++) {
        const target = candidate === 0 ? racer.z : -bound + (candidate - 1) * bound * 2 / 9;
        let x = racer.x, z = racer.z, heading = racer.heading, rate = racer.turnRate;
        let nextStroke = 0.3, safe = true;
        let tick = 0;
        for (let time = 0; time < seconds; time += 0.1, tick++) {
            if (time >= nextStroke) {
                const desired = Math.max(-maxHeading, Math.min(maxHeading, (target - z) * 0.3));
                const sign = Math.sign(desired - heading - rate * 0.65);
                rate = Math.max(-maxRate, Math.min(maxRate, rate + sign * impulse));
                nextStroke += 0.45;
            }
            heading = Math.max(-maxHeading, Math.min(maxHeading, heading + rate * 0.1));
            rate *= straightDamping;
            const cosine = Math.cos(heading), sine = Math.sin(heading);
            const nx = x + racer.direction * racer.speed * cosine * 0.1;
            const nz = z + racer.speed * sine * 0.1;
            if (Math.abs(nz) > bound) { safe = false; break; }
            for (const danger of dangers) if (swept(x, z, nx, nz, danger.x, danger.z, danger.radius + 0.25)) {
                safe = false; break;
            }
            if (!safe) break;
            for (let i = 0; i < vents.length; i++) {
                if (!(straightMasks[tick] & (1 << i))) continue;
                if (bodySwept(x, z, nx, nz, racer.direction * cosine, sine, racer.bodyScale ?? 1, vents[i], radii[i])) {
                    safe = false; break;
                }
            }
            if (!safe) break;
            x = nx; z = nz;
            if (x * racer.direction > exitX) return true;
        }
        if (safe) return true;
    }
    if (!steering) return false;
    // 固定出口无法描述交错两排间的反向划水；再用有界动作搜索验证连续折线路径。
    type Route = { x: number; z: number; heading: number; rate: number; score: number };
    let states: Route[] = [{ x: racer.x, z: racer.z, heading: racer.heading, rate: racer.turnRate, score: 0 }];
    const branchMasks = new Uint16Array(5);
    for (let time = 0; time < seconds; ) {
        const duration = Math.min(time === 0 ? 0.3 : 0.45, seconds - time);
        const dt = duration / 5;
        const damping = Math.exp(-Math.max(0, STEERING_TUNING.turnAngularDrag) * dt);
        for (let step = 0; step < 5; step++) {
            const now = time + step * dt;
            branchMasks[step] = burstMask(intervals, vents.length, pulseCount, now, now + dt);
        }
        const next: Route[] = [];
        const bins = new Set<string>();
        for (const state of states) for (let input = -1; input <= 1; input++) {
            if (time === 0 && input !== 0) continue;
            let x = state.x, z = state.z, heading = state.heading;
            let rate = Math.max(-maxRate, Math.min(maxRate, state.rate + input * impulse));
            let safe = true;
            for (let step = 0; step < 5; step++) {
                heading = Math.max(-maxHeading, Math.min(maxHeading, heading + rate * dt));
                rate *= damping;
                const cosine = Math.cos(heading), sine = Math.sin(heading);
                const nx = x + racer.direction * racer.speed * cosine * dt;
                const nz = z + racer.speed * sine * dt;
                if (Math.abs(nz) > bound) { safe = false; break; }
                for (const danger of dangers) if (swept(x, z, nx, nz, danger.x, danger.z, danger.radius + 0.25)) {
                    safe = false; break;
                }
                if (!safe) break;
                for (let i = 0; i < vents.length; i++) {
                    if (!(branchMasks[step] & (1 << i))) continue;
                    if (bodySwept(x, z, nx, nz, racer.direction * cosine, sine, racer.bodyScale ?? 1, vents[i], radii[i])) {
                        safe = false; break;
                    }
                }
                if (!safe) break;
                x = nx; z = nz;
                if (x * racer.direction > exitX) return true;
            }
            if (!safe) continue;
            const key = `${Math.round(z * 4)},${Math.round(heading * 8)},${Math.round(rate * 8)}`;
            if (bins.has(key)) continue;
            bins.add(key);
            next.push({ x, z, heading, rate, score: -x * racer.direction * 2
                + Math.abs(z - racer.z) * 0.04 + Math.abs(heading) * 0.15 + Math.abs(rate) * 0.1 });
        }
        if (!next.length) return false;
        next.sort((a, b) => a.score - b.score);
        states = next.slice(0, 48);
        time += duration;
    }
    return states.length > 0;
}

/** 当前玩法最多十口；严格重叠判断与原 geyserBurstOverlap() > 0 相同。 */
function burstMask(intervals: Float64Array, ventCount: number, pulseCount: number, from: number, to: number): number {
    let mask = 0;
    for (let i = 0; i < ventCount; i++) for (let pulse = 0; pulse < pulseCount; pulse++) {
        const at = (i * pulseCount + pulse) * 2;
        if (intervals[at] < to && intervals[at + 1] > from) { mask |= 1 << i; break; }
    }
    return mask;
}

export function selectGeyserLargeMask(seed: number, serial: number, intensity: GeyserIntensity,
    vents: readonly GeyserVent[], halfWidth: number, racers: readonly GeyserRouteRacer[],
    dangers: readonly GeyserDanger[], tuning: GeyserTuning): GeyserSafetyResult {
    const spec = geyserSpec(intensity, tuning);
    const random = new SeededRandom((seed ^ Math.imul(serial, 0x9e3779b1) ^ 0x4c415247) >>> 0);
    const candidates = vents.map(v => v.id);
    for (let i = candidates.length - 1; i > 0; i--) {
        const j = random.int(i + 1), tmp = candidates[i]; candidates[i] = candidates[j]; candidates[j] = tmp;
    }
    // 尾排槽位最少，先安排尾排，避免前排的晚喷口耗尽尾排的错峰选择。
    candidates.sort((a, b) => Math.floor(b / 4) - Math.floor(a / 4));
    let mask = 0, count = 0, rejectedSpace = 0, rejectedRoute = 0;
    const radius = tuning.edgeRadius * tuning.largeRadiusScale;
    for (const id of candidates) {
        if (count >= spec.largeCount) break;
        const vent = vents[id];
        let blocked = Math.abs(vent.z) + radius + 0.25 > halfWidth;
        for (const other of vents) if (mask & (1 << other.id)) {
            if (Math.floor(other.id / 4) === Math.floor(id / 4)
                || Math.abs(other.offsetSeconds - vent.offsetSeconds) < tuning.burstSeconds + 0.02
                || geyserCycleSeconds(tuning) - Math.abs(other.offsetSeconds - vent.offsetSeconds) < tuning.burstSeconds + 0.02) blocked = true;
        }
        for (const danger of dangers) if (Math.hypot(vent.x - danger.x, vent.z - danger.z) < radius + danger.radius + 0.5) blocked = true;
        if (blocked) { rejectedSpace++; continue; }
        const proposed = mask | (1 << id);
        const mixed = applyGeyserSizes(vents, proposed, spec.largeCount > 0);
        if (racers.some(racer => !geyserRouteAvailable(racer, mixed, halfWidth, spec.pulseCount,
            spec.actionSeconds, tuning, dangers))) { rejectedRoute++; continue; }
        mask = proposed; count++;
    }
    return { mask, rejectedSpace, rejectedRoute };
}
