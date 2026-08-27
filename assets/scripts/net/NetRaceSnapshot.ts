// Authoritative race-position snapshot codec for the host-authoritative sync model.
//
// In a networked race every client simulates locally (immediate input for feel,
// including collisions), but the HOST is the single source of truth. The host
// periodically broadcasts a compact snapshot of every lane's race progress + lane
// offset; each client eases its swimmers toward these values so all clients converge
// to the host's result (and collision outcomes never diverge permanently).
//
// This module is the pure codec (no engine deps). NetRaceController sends/receives it.
//
// Wire format (broadcast message body):
//   "S|<hostPos>#<lane>,<distCm>,<latMm>,<fin>,<headMrad>,<speedCms>,<energy>,<rollMrad>,<rollVelMrad>,<headVelMrad>,<pitchMrad>,<pitchVelMrad>,<conditionEnergyPermille>,<conditionHeartRate>,<conditionCooldownMs>;..."
// hostPos   = the seat index (posNum) of the client that produced this snapshot, i.e.
//             who currently believes it is the authoritative host. Clients use it for
//             deterministic host migration: if the host goes silent, the lowest
//             surviving posNum takes over, and this field lets everyone agree on (and
//             defer to) the highest-priority (lowest-pos) live host.
// distCm    = distance in centimetres (round(distance*100))    — race progress
// latMm     = lane offset in millimetres (round(lateralOffset*1000))
// fin       = 1 if that lane has finished, else 0
// headMrad  = steering heading in milliradians (round(heading*1000)) — facing/weave,
//             which drifts across JS engines (Math.sin/cos) so must be synced too.
// headVelMrad = persistent steering angular velocity in milliradians/second.
// The leading "S|" tag distinguishes snapshots from other broadcast messages.

export interface NetSnapshotEntry {
    lane: number;
    distance: number;
    lateral: number;
    finished: boolean;
    heading: number;
    // Persistent steering angular velocity (rad/s). Appended to the wire format
    // for backward compatibility; older payloads decode it as zero.
    headingVelocity: number;
    // Owner's authoritative swim speed (m/s). Drives the tread-water<->freestyle pose on
    // remote copies so the pose follows the owner instead of the remote's local input
    // replay (which jitters over the network → "treading water while sliding forward").
    // -1 = not provided (consumer falls back to the local motor speed).
    speed: number;
    // Ultimate energy (0..100, integer points). For human lanes the owner's reliable
    // frame self-report is authoritative; for AI lanes the host S| snapshot is
    // authoritative. -1 = not provided by an older payload.
    energy: number;
    // Powered long-axis side-fall angle + angular velocity. The periodic angle is
    // normalized to [-pi, pi]; velocity keeps remote correction continuous.
    axialRoll: number;
    axialRollVelocity: number;
    // Collision-only end-over-end ragdoll state. Appended for backward
    // compatibility; older payloads decode both values as zero.
    collisionPitch: number;
    collisionPitchVelocity: number;
    // Condition state is appended after every existing pose field. Human lanes use
    // their owner's self report; genuine AI lanes use the host S| snapshot.
    // -1 means an older payload or a source that is not authoritative for this lane.
    conditionEnergyRatio: number;
    conditionHeartRate: number;
    // Genuine-AI depletion cooldown remaining, authoritative only on host S|.
    // Optional/-1 on human P|/frame self and legacy snapshots.
    conditionDepletionCooldown?: number;
    // Human owner-state ordering token. Appended after condition fields on P| and
    // input-frame self payloads; -1/undefined means an older sender without ordering.
    ownerStateSeq?: number;
    // P|-only claimed owner seat. It catches accidental lane/seat mismatches; the
    // room protocol gate supplies compatibility, while the platform broadcast API
    // itself still cannot cryptographically authenticate a payload sender.
    ownerPos?: number;
}

// A decoded snapshot: the authoritative host's seat plus the per-lane state.
export interface DecodedRaceSnapshot {
    hostPos: number;
    entries: NetSnapshotEntry[];
}

const TAG = 'S|';

export function encodeRaceSnapshot(hostPos: number, entries: NetSnapshotEntry[]): string {
    const body = entries
        .map((e) => `${e.lane},${Math.round(e.distance * 100)},${Math.round(e.lateral * 1000)},${e.finished ? 1 : 0},${Math.round(e.heading * 1000)},${Math.round(Math.max(0, e.speed) * 100)},${Math.max(0, Math.round(e.energy))},${Math.round(e.axialRoll * 1000)},${Math.round(e.axialRollVelocity * 1000)},${Math.round(e.headingVelocity * 1000)},${Math.round(e.collisionPitch * 1000)},${Math.round(e.collisionPitchVelocity * 1000)},${encodeConditionEnergyRatio(e.conditionEnergyRatio)},${encodeConditionHeartRate(e.conditionHeartRate)},${encodeConditionCooldown(e.conditionDepletionCooldown ?? -1)}`)
        .join(';');
    return `${TAG}${hostPos}#${body}`;
}

// Returns null if the payload is not a race snapshot (so other broadcast messages
// are ignored cleanly).
export function decodeRaceSnapshot(payload: string): DecodedRaceSnapshot | null {
    if (typeof payload !== 'string' || payload.slice(0, TAG.length) !== TAG) {
        return null;
    }
    const rest = payload.slice(TAG.length);
    const hash = rest.indexOf('#');
    if (hash < 0) {
        return null;
    }
    const hostPos = parseInt(rest.slice(0, hash), 10);
    const body = rest.slice(hash + 1);
    const entries: NetSnapshotEntry[] = [];
    if (body.length > 0) {
        for (const token of body.split(';')) {
            const parts = token.split(',');
            if (parts.length < 4) {
                continue;
            }
            const lane = parseInt(parts[0], 10);
            const distCm = parseInt(parts[1], 10);
            const latMm = parseInt(parts[2], 10);
            const fin = parts[3] === '1';
            const headMrad = parts.length > 4 ? parseInt(parts[4], 10) : 0;
            if (!Number.isFinite(lane) || !Number.isFinite(distCm) || !Number.isFinite(latMm)) {
                continue;
            }
            const speedCms = parts.length > 5 ? parseInt(parts[5], 10) : -1;
            const energy = parts.length > 6 ? parseInt(parts[6], 10) : -1;
            const rollMrad = parts.length > 7 ? parseInt(parts[7], 10) : 0;
            const rollVelMrad = parts.length > 8 ? parseInt(parts[8], 10) : 0;
            const headVelMrad = parts.length > 9 ? parseInt(parts[9], 10) : 0;
            const pitchMrad = parts.length > 10 ? parseInt(parts[10], 10) : 0;
            const pitchVelMrad = parts.length > 11 ? parseInt(parts[11], 10) : 0;
            const conditionEnergyPermille = parts.length > 12 ? parseInt(parts[12], 10) : -1;
            const conditionHeartRate = parts.length > 13 ? parseInt(parts[13], 10) : -1;
            const conditionCooldownMs = parts.length > 14 ? parseInt(parts[14], 10) : -1;
            entries.push({
                lane,
                distance: distCm / 100,
                lateral: latMm / 1000,
                finished: fin,
                heading: Number.isFinite(headMrad) ? headMrad / 1000 : 0,
                headingVelocity: Number.isFinite(headVelMrad) ? headVelMrad / 1000 : 0,
                speed: Number.isFinite(speedCms) && speedCms >= 0 ? speedCms / 100 : -1,
                energy: Number.isFinite(energy) && energy >= 0 ? energy : -1,
                axialRoll: Number.isFinite(rollMrad) ? rollMrad / 1000 : 0,
                axialRollVelocity: Number.isFinite(rollVelMrad) ? rollVelMrad / 1000 : 0,
                collisionPitch: Number.isFinite(pitchMrad) ? pitchMrad / 1000 : 0,
                collisionPitchVelocity: Number.isFinite(pitchVelMrad) ? pitchVelMrad / 1000 : 0,
                conditionEnergyRatio: decodeConditionEnergyRatio(conditionEnergyPermille),
                conditionHeartRate: decodeConditionHeartRate(conditionHeartRate),
                conditionDepletionCooldown: decodeConditionCooldown(conditionCooldownMs),
            });
        }
    }
    return { hostPos: Number.isFinite(hostPos) ? hostPos : 0, entries };
}

// Self-position report (tag "P|"): a single lane's own-authoritative position, sent by
// the client that CONTROLS that swimmer (each human broadcasts their own player). Every
// other client eases that swimmer toward this so its on-screen copy "catches up" to how
// its owner actually sees it — the owner predicts locally with zero input lag, so the
// owner's position is the truth; input-replay alone leaves the remote copy ~1 RTT behind
// and drifting. Same field layout as one snapshot entry (incl. speed + energy), so it
// also carries authoritative pose-speed and ultimate energy — required in broadcast-only
// mode (iOS high-performance+), where these can no longer ride the lock-step frame self.
//   "P|<lane>,<distCm>,<latMm>,<fin>,<headMrad>,<speedCms>,<energy>,<rollMrad>,<rollVelMrad>,<headVelMrad>,<pitchMrad>,<pitchVelMrad>,<conditionEnergyPermille>,<conditionHeartRate>,<ownerStateSeq>,<ownerPos>"
const SELF_TAG = 'P|';

export function encodeSelfSnapshot(
    entry: NetSnapshotEntry,
    ownerStateSeq = entry.ownerStateSeq ?? -1,
    ownerPos = entry.ownerPos ?? -1,
): string {
    return `${SELF_TAG}${entry.lane},${Math.round(entry.distance * 100)},${Math.round(entry.lateral * 1000)},${entry.finished ? 1 : 0},${Math.round(entry.heading * 1000)},${Math.round(Math.max(0, entry.speed) * 100)},${Math.max(0, Math.round(entry.energy))},${Math.round(entry.axialRoll * 1000)},${Math.round(entry.axialRollVelocity * 1000)},${Math.round(entry.headingVelocity * 1000)},${Math.round(entry.collisionPitch * 1000)},${Math.round(entry.collisionPitchVelocity * 1000)},${encodeConditionEnergyRatio(entry.conditionEnergyRatio)},${encodeConditionHeartRate(entry.conditionHeartRate)},${encodeOwnerStateSeq(ownerStateSeq)},${encodeOwnerStateSeq(ownerPos)}`;
}

// Returns null if the payload is not a self-position report.
export function decodeSelfSnapshot(payload: string): NetSnapshotEntry | null {
    if (typeof payload !== 'string' || payload.slice(0, SELF_TAG.length) !== SELF_TAG) {
        return null;
    }
    const parts = payload.slice(SELF_TAG.length).split(',');
    if (parts.length < 4) {
        return null;
    }
    const lane = parseInt(parts[0], 10);
    const distCm = parseInt(parts[1], 10);
    const latMm = parseInt(parts[2], 10);
    const fin = parts[3] === '1';
    const headMrad = parts.length > 4 ? parseInt(parts[4], 10) : 0;
    if (!Number.isFinite(lane) || !Number.isFinite(distCm) || !Number.isFinite(latMm)) {
        return null;
    }
    const speedCms = parts.length > 5 ? parseInt(parts[5], 10) : -1;
    const energy = parts.length > 6 ? parseInt(parts[6], 10) : -1;
    const rollMrad = parts.length > 7 ? parseInt(parts[7], 10) : 0;
    const rollVelMrad = parts.length > 8 ? parseInt(parts[8], 10) : 0;
    const headVelMrad = parts.length > 9 ? parseInt(parts[9], 10) : 0;
    const pitchMrad = parts.length > 10 ? parseInt(parts[10], 10) : 0;
    const pitchVelMrad = parts.length > 11 ? parseInt(parts[11], 10) : 0;
    const conditionEnergyPermille = parts.length > 12 ? parseInt(parts[12], 10) : -1;
    const conditionHeartRate = parts.length > 13 ? parseInt(parts[13], 10) : -1;
    const ownerStateSeq = parts.length > 14 ? parseInt(parts[14], 10) : -1;
    const ownerPos = parts.length > 15 ? parseInt(parts[15], 10) : -1;
    return {
        lane,
        distance: distCm / 100,
        lateral: latMm / 1000,
        finished: fin,
        heading: Number.isFinite(headMrad) ? headMrad / 1000 : 0,
        headingVelocity: Number.isFinite(headVelMrad) ? headVelMrad / 1000 : 0,
        speed: Number.isFinite(speedCms) && speedCms >= 0 ? speedCms / 100 : -1,
        energy: Number.isFinite(energy) && energy >= 0 ? energy : -1,
        axialRoll: Number.isFinite(rollMrad) ? rollMrad / 1000 : 0,
        axialRollVelocity: Number.isFinite(rollVelMrad) ? rollVelMrad / 1000 : 0,
        collisionPitch: Number.isFinite(pitchMrad) ? pitchMrad / 1000 : 0,
        collisionPitchVelocity: Number.isFinite(pitchVelMrad) ? pitchVelMrad / 1000 : 0,
        conditionEnergyRatio: decodeConditionEnergyRatio(conditionEnergyPermille),
        conditionHeartRate: decodeConditionHeartRate(conditionHeartRate),
        ownerStateSeq: decodeOwnerStateSeq(ownerStateSeq),
        ownerPos: decodeOwnerStateSeq(ownerPos),
    };
}

export function encodeConditionEnergyRatio(value: number): number {
    return Number.isFinite(value) && value >= 0
        ? Math.max(0, Math.min(1000, Math.round(value * 1000)))
        : -1;
}

export function encodeConditionHeartRate(value: number): number {
    return Number.isFinite(value) && value >= 0
        // Zone thresholds are integers and use >=. Flooring guarantees a value just
        // below 110/150/175 cannot round upward into a different zone remotely.
        ? Math.max(0, Math.min(200, Math.floor(value)))
        : -1;
}

export function decodeConditionEnergyRatio(value: number): number {
    return Number.isFinite(value) && value >= 0
        ? Math.max(0, Math.min(1, value / 1000))
        : -1;
}

export function decodeConditionHeartRate(value: number): number {
    return Number.isFinite(value) && value >= 0
        ? Math.max(0, Math.min(200, value))
        : -1;
}

export function encodeConditionCooldown(value: number): number {
    return Number.isFinite(value) && value >= 0
        ? Math.max(0, Math.round(value * 1000))
        : -1;
}

export function decodeConditionCooldown(value: number): number {
    return Number.isFinite(value) && value >= 0 ? value / 1000 : -1;
}

export function encodeOwnerStateSeq(value: number): number {
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : -1;
}

export function decodeOwnerStateSeq(value: number): number {
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : -1;
}
