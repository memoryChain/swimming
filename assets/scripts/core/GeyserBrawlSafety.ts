import { SeededRandom } from './SharedRNG';
import { STEERING_TUNING } from './SteeringTuning';
import { applyGeyserSizes, geyserBurstOverlap, geyserRadiusScale, geyserSpec, geyserCycleSeconds,
    type GeyserIntensity, type GeyserTuning, type GeyserVent } from './GeyserBrawlRules';

export type GeyserDanger = Readonly<{ x: number; z: number; radius: number }>;
export type GeyserRouteRacer = Readonly<{
    x: number; z: number; speed: number; direction: number; heading: number; turnRate: number; roll: number;
}>;
export type GeyserSafetyResult = Readonly<{ mask: number; rejectedSpace: number; rejectedRoute: number }>;

function swept(x: number, z: number, nx: number, nz: number, cx: number, cz: number, radius: number): boolean {
    const dx = nx - x, dz = nz - z, length = dx * dx + dz * dz;
    const t = length > 1e-8 ? Math.max(0, Math.min(1, ((cx - x) * dx + (cz - z) * dz) / length)) : 0;
    return (x + dx * t - cx) ** 2 + (z + dz * t - cz) ** 2 < radius * radius;
}

/** 只在生成时做有界连续轨迹检查。使用实际转向配置、当前惯性和侧滚，不允许瞬时换道。 */
export function geyserRouteAvailable(racer: GeyserRouteRacer, vents: readonly GeyserVent[],
    halfWidth: number, pulseCount: number, seconds: number, tuning: GeyserTuning,
    dangers: readonly GeyserDanger[] = []): boolean {
    const bound = halfWidth - 0.8;
    const rad = Math.PI / 180;
    const maxHeading = Math.min(65, STEERING_TUNING.maxHeading) * rad;
    const maxRate = STEERING_TUNING.maxTurnRate * rad;
    const impulse = STEERING_TUNING.turnAngularImpulse * rad * Math.abs(Math.cos(racer.roll));
    let exitX = -Infinity;
    for (const vent of vents) exitX = Math.max(exitX, vent.x * racer.direction
        + tuning.edgeRadius * geyserRadiusScale(vent, tuning) + 1);
    // 每条路径只追一个固定横向出口；证明一条贯穿全片的路，而非各排互不相连的空点。
    for (let candidate = 0; candidate < 11; candidate++) {
        const target = candidate === 0 ? racer.z : -bound + (candidate - 1) * bound * 2 / 9;
        let x = racer.x, z = racer.z, heading = racer.heading, rate = racer.turnRate;
        let nextStroke = 0.3, safe = true;
        for (let time = 0; time < seconds; time += 0.1) {
            if (time >= nextStroke) {
                const desired = Math.max(-maxHeading, Math.min(maxHeading, (target - z) * 0.3));
                const sign = Math.sign(desired - heading - rate * 0.65);
                rate = Math.max(-maxRate, Math.min(maxRate, rate + sign * impulse));
                nextStroke += 0.45;
            }
            heading = Math.max(-maxHeading, Math.min(maxHeading, heading + rate * 0.1));
            rate *= Math.exp(-Math.max(0, STEERING_TUNING.turnAngularDrag) * 0.1);
            const nx = x + racer.direction * racer.speed * Math.cos(heading) * 0.1;
            const nz = z + racer.speed * Math.sin(heading) * 0.1;
            if (Math.abs(nz) > bound) { safe = false; break; }
            for (const danger of dangers) if (swept(x, z, nx, nz, danger.x, danger.z, danger.radius + 0.25)) {
                safe = false; break;
            }
            if (!safe) break;
            for (const vent of vents) {
                const radius = tuning.edgeRadius * geyserRadiusScale(vent, tuning) + 0.18;
                if (!swept(x, z, nx, nz, vent.x, vent.z, radius)) continue;
                for (let pulse = 0; pulse < pulseCount; pulse++) {
                    if (geyserBurstOverlap(vent, pulse, time, time + 0.1, tuning) > 0) { safe = false; break; }
                }
                if (!safe) break;
            }
            if (!safe) break;
            x = nx; z = nz;
            if (x * racer.direction > exitX) return true;
        }
        if (safe) return true;
    }
    // 固定出口无法描述交错两排间的反向划水；再用有界动作搜索验证连续折线路径。
    type Route = { x: number; z: number; heading: number; rate: number; score: number };
    let states: Route[] = [{ x: racer.x, z: racer.z, heading: racer.heading, rate: racer.turnRate, score: 0 }];
    for (let time = 0; time < seconds; ) {
        const duration = Math.min(time === 0 ? 0.3 : 0.45, seconds - time);
        const next: Route[] = [];
        const bins = new Set<string>();
        for (const state of states) for (let input = -1; input <= 1; input++) {
            if (time === 0 && input !== 0) continue;
            let x = state.x, z = state.z, heading = state.heading;
            let rate = Math.max(-maxRate, Math.min(maxRate, state.rate + input * impulse));
            let safe = true;
            for (let step = 0; step < 5; step++) {
                const dt = duration / 5, now = time + step * dt;
                heading = Math.max(-maxHeading, Math.min(maxHeading, heading + rate * dt));
                rate *= Math.exp(-Math.max(0, STEERING_TUNING.turnAngularDrag) * dt);
                const nx = x + racer.direction * racer.speed * Math.cos(heading) * dt;
                const nz = z + racer.speed * Math.sin(heading) * dt;
                if (Math.abs(nz) > bound) { safe = false; break; }
                for (const danger of dangers) if (swept(x, z, nx, nz, danger.x, danger.z, danger.radius + 0.25)) {
                    safe = false; break;
                }
                if (!safe) break;
                for (const vent of vents) {
                    if (!swept(x, z, nx, nz, vent.x, vent.z, tuning.edgeRadius * geyserRadiusScale(vent, tuning) + 0.18)) continue;
                    for (let pulse = 0; pulse < pulseCount; pulse++) {
                        if (geyserBurstOverlap(vent, pulse, now, now + dt, tuning) > 0) { safe = false; break; }
                    }
                    if (!safe) break;
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

/** 生成边沿采集实体残留；圆形包络包含既有椭圆命中与可漂移范围。 */
export function collectGeyserDangers(toWorldX: (distance: number) => number,
    mines: readonly { active: boolean; courseX: number; lateral: number }[],
    litter: readonly { active: boolean; courseX: number; lateral: number; phase: string;
        anchorCourseX: number; anchorLateral: number }[],
    whirlpools: readonly { distance: number; centerFraction: number; radiusScale?: number; variant?: string }[],
    halfWidth: number, mineRadius: number, litterRadius: number,
    whirlpoolRadius: number, superRadiusScale: number): GeyserDanger[] {
    const result: GeyserDanger[] = [];
    for (const mine of mines) if (mine.active) result.push({ x: toWorldX(mine.courseX), z: mine.lateral, radius: mineRadius });
    for (const item of litter) if (item.active) result.push({
        x: toWorldX(item.phase === 'falling' ? item.anchorCourseX : item.courseX),
        z: item.phase === 'falling' ? item.anchorLateral : item.lateral, radius: litterRadius });
    for (const spawn of whirlpools) result.push({ x: toWorldX(spawn.distance),
        z: spawn.centerFraction * Math.max(0.5, halfWidth - 0.8),
        radius: whirlpoolRadius * (spawn.radiusScale ?? 1) * (spawn.variant === 'super' ? superRadiusScale : 1) });
    return result;
}
