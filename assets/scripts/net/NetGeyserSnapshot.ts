import type { ForcedLaunchStart } from '../swimmer/ForcedLaunchModel';
import { geyserSpec, geyserTuningForRace, geyserCycleSeconds, type GeyserIntensity } from '../core/GeyserBrawlRules';

export type GeyserWorldState = Readonly<{
    serial: number; intensity: GeyserIntensity; anchorDistance: number;
    age: number; stoppedAt: number; active: boolean; largeVentMask: number;
}>;
export type GeyserLaneState = Readonly<{
    lane: number; edges: number; cores: number; grace: number; edge: number;
    hitId: number; launchAge: number; start: ForcedLaunchStart | null;
}>;
export type NetGeyserState = Readonly<{
    world: GeyserWorldState; raceElapsed: number; lanes: readonly GeyserLaneState[];
}>;
export type NetGeyserPacket = Readonly<{
    hostPos: number; sequence: number; state: NetGeyserState;
}>;

const MASK = 0x3fffffff;
const pack = (values: readonly number[]) => values.map(v => Math.round(v).toString(36)).join('.');
function unpack(value: string, count: number): number[] | null {
    if (!/^-?[0-9a-z]+(?:\.-?[0-9a-z]+)*$/.test(value)) return null;
    const values = value.split('.').map(v => parseInt(v, 36));
    return values.length === count && values.every(Number.isSafeInteger) ? values : null;
}

/** 八泳道、三轮十口的有界恢复包；不扩充已有 S| 主快照。 */
export function encodeGeyserPacket(hostPos: number, sequence: number, state: NetGeyserState): string {
    const w = state.world;
    const header = pack([hostPos, sequence, w.serial, w.intensity, w.anchorDistance * 100,
        w.age * 1000, w.stoppedAt < 0 ? -1 : w.stoppedAt * 1000, +w.active, state.raceElapsed * 1000, w.largeVentMask]);
    const lanes = state.lanes.map(l => {
        const base = pack([l.lane, l.edges, l.cores, l.grace * 1000, l.edge * 1000, l.hitId, l.launchAge * 1000]);
        const s = l.start;
        return base + (s ? '~' + pack([s.distance * 100, s.lateral * 1000, s.y * 1000,
            s.surfaceY * 1000, s.speed * 100, s.heading * 1000, s.duration * 1000,
            s.peakHeight * 1000, s.entryScale * 1000, s.exitScale * 1000]) : '');
    }).join(';');
    const packet = 'GY|' + header + '|' + lanes;
    return decodeGeyserPacket(packet) ? packet : '';
}

export function decodeGeyserPacket(packet: string): NetGeyserPacket | null {
    if (packet.length > 1400 || !packet.startsWith('GY|')) return null;
    const parts = packet.split('|');
    if (parts.length !== 3) return null;
    const h = unpack(parts[1], 10);
    if (!h) return null;
    const [hostPos, sequence, serial, intensity, anchor, age, stop, active, elapsed, largeVentMask] = h;
    if (hostPos < 0 || hostPos > 15 || sequence < 0 || serial < 1 || serial > 1000000
        || intensity < 1 || intensity > 5 || anchor < 0 || anchor > 40000
        || age < 0 || age > 30000 || stop < -1 || stop > age
        || (active !== 0 && active !== 1) || elapsed < 0 || elapsed > 86400000) return null;
    const spec = geyserSpec(intensity as GeyserIntensity);
    if (age > Math.round(spec.actionSeconds * 1000) || largeVentMask < 0 || largeVentMask >= (1 << spec.ventCount)) return null;
    let count = 0;
    for (let row = 0; row < 3; row++) {
        const bits = (largeVentMask >> (row * 4)) & 15;
        if (bits && (bits & (bits - 1))) return null;
        if (bits) count++;
    }
    if (count > spec.largeCount) return null;
    const tuning = geyserTuningForRace(true);
    for (let a = 0; a < spec.ventCount; a++) if (largeVentMask & (1 << a)) {
        for (let b = a + 1; b < spec.ventCount; b++) if (largeVentMask & (1 << b)) {
            const gap = (Math.floor(b / 4) - Math.floor(a / 4)) * spec.staggerSeconds + (b % 4 - a % 4) * 0.08;
            if (gap < tuning.burstSeconds + 0.02 || geyserCycleSeconds(tuning) - gap < tuning.burstSeconds + 0.02) return null;
        }
    }
    const rows = parts[2] ? parts[2].split(';') : [];
    if (rows.length > 8) return null;
    const lanes: GeyserLaneState[] = [];
    let seen = 0;
    for (const row of rows) {
        const fields = row.split('~');
        if (fields.length > 2) return null;
        const v = unpack(fields[0], 7);
        if (!v) return null;
        const [lane, edges, cores, grace, edge, hitId, launchAge] = v;
        if (lane < 0 || lane > 7 || (seen & (1 << lane)) || edges < 0 || edges > MASK
            || cores < 0 || cores > MASK || (cores & edges) !== cores
            || grace < 0 || grace > 10000 || edge < 0 || edge > 10000
            || hitId < 0 || launchAge < 0 || launchAge > 10000) return null;
        seen |= 1 << lane;
        let start: ForcedLaunchStart | null = null;
        if (fields.length === 2) {
            const s = unpack(fields[1], 10);
            if (!s) return null;
            const [distance, lateral, y, surface, speed, heading, duration, peak, entry, exit] = s;
            const slot = hitId - serial * 1000 - lane - 1;
            const pulse = Math.floor(slot / 128), vent = (slot % 128) / 8;
            if (pulse < 0 || pulse > 2 || !Number.isInteger(vent) || vent < 0 || vent > 9
                || !(cores & (1 << (pulse * 10 + vent))) || distance < 0 || distance > 40000
                || Math.abs(lateral) > 30000 || Math.abs(y) > 20000 || Math.abs(surface) > 20000
                || speed < 0 || speed > 5000 || Math.abs(heading) > 7000
                || duration < 100 || duration > 5000 || launchAge > duration
                || peak < 0 || peak > 10000 || entry < 0 || entry > 2000 || exit < 0 || exit > 2000) return null;
            start = { distance: distance / 100, lateral: lateral / 1000, y: y / 1000,
                surfaceY: surface / 1000, speed: speed / 100, heading: heading / 1000,
                duration: duration / 1000, peakHeight: peak / 1000, entryScale: entry / 1000, exitScale: exit / 1000 };
        } else if (hitId !== 0 || launchAge !== 0) return null;
        lanes.push({ lane, edges, cores, grace: grace / 1000, edge: edge / 1000,
            hitId, launchAge: launchAge / 1000, start });
    }
    return { hostPos, sequence, state: {
        world: { serial, intensity: intensity as GeyserIntensity, anchorDistance: anchor / 100,
            age: age / 1000, stoppedAt: stop < 0 ? -1 : stop / 1000, active: !!active, largeVentMask },
        raceElapsed: elapsed / 1000, lanes,
    } };
}
