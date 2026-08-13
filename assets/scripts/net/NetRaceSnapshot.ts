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
//   "S|<hostPos>#<lane>,<distCm>,<latMm>,<fin>,<headMrad>,<speedCms>,<energy>,<conditionEnergyPermille>,<heartRate>,<skillRemainingMs>,<skillCharges>,<skillPulses>;..."
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
// The leading "S|" tag distinguishes snapshots from other broadcast messages.

export interface NetSnapshotEntry {
    lane: number;
    distance: number;
    lateral: number;
    finished: boolean;
    heading: number;
    // Owner's authoritative swim speed (m/s). Drives the tread-water<->freestyle pose on
    // remote copies so the pose follows the owner instead of the remote's local input
    // replay (which jitters over the network → "treading water while sliding forward").
    // -1 = not provided (consumer falls back to the local motor speed).
    speed: number;
    // Ultimate energy (0..100, integer points). For human lanes the owner's reliable
    // frame self-report is authoritative; for AI lanes the host S| snapshot is
    // authoritative. -1 = not provided by an older payload.
    energy: number;
    // Owner's condition-energy ratio (0..1) and heart rate (0..200). Remote humans
    // derive their speed/quality/cap/cadence modifiers from these authoritative values.
    // -1 = not provided by an older payload or for a lane without an owner report.
    conditionEnergyRatio: number;
    conditionHeartRate: number;
    // Remaining prototype-ultimate duration in seconds. -1 keeps old payloads
    // compatible and means the consumer should keep its local timer.
    skillRemainingSeconds: number;
    // Extra compact dedicated-skill state. Character id is already synchronized
    // in the modifier digest, so the receiver resolves skill type locally.
    skillCharges: number;
    skillPulsesTriggered: number;
}

// Race-global state appended to the host snapshot after the lane entries. It is
// deliberately host-authoritative: predator target selection and elimination are
// outcome-affecting and cannot rely on floating-point local simulation.
export interface NetSharkSnapshot {
    sequence: number;
    state: number;
    remainingSeconds: number;
    huntOpeningGraceSeconds: number;
    x: number;
    z: number;
    ownerLane: number;
    targetLane: number;
    eliminatedLane: number;
}

// A decoded snapshot: the authoritative host's seat plus the per-lane state.
export interface DecodedRaceSnapshot {
    hostPos: number;
    entries: NetSnapshotEntry[];
    shark?: NetSharkSnapshot;
}

const TAG = 'S|';

export function encodeRaceSnapshot(hostPos: number, entries: NetSnapshotEntry[], shark?: NetSharkSnapshot | null): string {
    const body = entries
        .map((e) => `${e.lane},${Math.round(e.distance * 100)},${Math.round(e.lateral * 1000)},${e.finished ? 1 : 0},${Math.round(e.heading * 1000)},${Math.round(Math.max(0, e.speed) * 100)},${Math.max(0, Math.round(e.energy))},${encodeConditionEnergyRatio(e.conditionEnergyRatio)},${encodeConditionHeartRate(e.conditionHeartRate)},${encodeSkillRemainingMs(e.skillRemainingSeconds)},${encodeSkillStateInt(e.skillCharges)},${encodeSkillStateInt(e.skillPulsesTriggered)}`)
        .join(';');
    const sharkBody = shark
        ? `~${Math.max(0, Math.round(shark.sequence))},${Math.max(0, Math.round(shark.state))},${Math.max(0, Math.round(shark.remainingSeconds * 1000))},${Math.max(0, Math.round(shark.huntOpeningGraceSeconds * 1000))},${Math.round(shark.x * 100)},${Math.round(shark.z * 100)},${Math.round(shark.ownerLane)},${Math.round(shark.targetLane)},${Math.round(shark.eliminatedLane)}`
        : '';
    return `${TAG}${hostPos}#${body}${sharkBody}`;
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
    const stateBody = rest.slice(hash + 1);
    const sharkSeparator = stateBody.indexOf('~');
    const body = sharkSeparator >= 0 ? stateBody.slice(0, sharkSeparator) : stateBody;
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
            const conditionEnergyPermille = parts.length > 7 ? parseInt(parts[7], 10) : -1;
            const conditionHeartRate = parts.length > 8 ? parseInt(parts[8], 10) : -1;
            const skillRemainingMs = parts.length > 9 ? parseInt(parts[9], 10) : -1;
            const skillCharges = parts.length > 10 ? parseInt(parts[10], 10) : -1;
            const skillPulsesTriggered = parts.length > 11 ? parseInt(parts[11], 10) : -1;
            entries.push({
                lane,
                distance: distCm / 100,
                lateral: latMm / 1000,
                finished: fin,
                heading: Number.isFinite(headMrad) ? headMrad / 1000 : 0,
                speed: Number.isFinite(speedCms) && speedCms >= 0 ? speedCms / 100 : -1,
                energy: Number.isFinite(energy) && energy >= 0 ? energy : -1,
                conditionEnergyRatio: Number.isFinite(conditionEnergyPermille) && conditionEnergyPermille >= 0
                    ? Math.min(1, conditionEnergyPermille / 1000)
                    : -1,
                conditionHeartRate: Number.isFinite(conditionHeartRate) && conditionHeartRate >= 0
                    ? Math.min(200, conditionHeartRate)
                    : -1,
                skillRemainingSeconds: Number.isFinite(skillRemainingMs) && skillRemainingMs >= 0
                    ? Math.min(9.999, skillRemainingMs / 1000)
                    : -1,
                skillCharges: Number.isFinite(skillCharges) && skillCharges >= 0 ? Math.min(9, skillCharges) : -1,
                skillPulsesTriggered: Number.isFinite(skillPulsesTriggered) && skillPulsesTriggered >= 0 ? Math.min(9, skillPulsesTriggered) : -1,
            });
        }
    }
    let shark: NetSharkSnapshot | undefined;
    if (sharkSeparator >= 0) {
        const p = stateBody.slice(sharkSeparator + 1).split(',');
        if (p.length >= 8) {
            const hasOpeningGrace = p.length >= 9;
            const values = p.slice(0, hasOpeningGrace ? 9 : 8).map((v) => parseInt(v, 10));
            if (values.every(Number.isFinite)) {
                shark = {
                    sequence: values[0], state: values[1], remainingSeconds: Math.max(0, values[2] / 1000),
                    huntOpeningGraceSeconds: hasOpeningGrace ? Math.max(0, values[3] / 1000) : 0,
                    x: values[hasOpeningGrace ? 4 : 3] / 100, z: values[hasOpeningGrace ? 5 : 4] / 100,
                    ownerLane: values[hasOpeningGrace ? 6 : 5], targetLane: values[hasOpeningGrace ? 7 : 6], eliminatedLane: values[hasOpeningGrace ? 8 : 7],
                };
            }
        }
    }
    return { hostPos: Number.isFinite(hostPos) ? hostPos : 0, entries, shark };
}

// Self-position report (tag "P|"): a single lane's own-authoritative position, sent by
// the client that CONTROLS that swimmer (each human broadcasts their own player). Every
// other client eases that swimmer toward this so its on-screen copy "catches up" to how
// its owner actually sees it — the owner predicts locally with zero input lag, so the
// owner's position is the truth; input-replay alone leaves the remote copy ~1 RTT behind
// and drifting. Same field layout as one snapshot entry (incl. speed, ultimate energy,
// and condition state), so it also carries those authoritative values in broadcast-only
// mode (iOS high-performance+), where they can no longer ride the lock-step frame self.
//   "P|<lane>,<distCm>,<latMm>,<fin>,<headMrad>,<speedCms>,<energy>,<conditionEnergyPermille>,<heartRate>,<skillRemainingMs>,<skillCharges>,<skillPulses>"
const SELF_TAG = 'P|';

export function encodeSelfSnapshot(entry: NetSnapshotEntry): string {
    return `${SELF_TAG}${entry.lane},${Math.round(entry.distance * 100)},${Math.round(entry.lateral * 1000)},${entry.finished ? 1 : 0},${Math.round(entry.heading * 1000)},${Math.round(Math.max(0, entry.speed) * 100)},${Math.max(0, Math.round(entry.energy))},${encodeConditionEnergyRatio(entry.conditionEnergyRatio)},${encodeConditionHeartRate(entry.conditionHeartRate)},${encodeSkillRemainingMs(entry.skillRemainingSeconds)},${encodeSkillStateInt(entry.skillCharges)},${encodeSkillStateInt(entry.skillPulsesTriggered)}`;
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
    const conditionEnergyPermille = parts.length > 7 ? parseInt(parts[7], 10) : -1;
    const conditionHeartRate = parts.length > 8 ? parseInt(parts[8], 10) : -1;
    const skillRemainingMs = parts.length > 9 ? parseInt(parts[9], 10) : -1;
    const skillCharges = parts.length > 10 ? parseInt(parts[10], 10) : -1;
    const skillPulsesTriggered = parts.length > 11 ? parseInt(parts[11], 10) : -1;
    return {
        lane,
        distance: distCm / 100,
        lateral: latMm / 1000,
        finished: fin,
        heading: Number.isFinite(headMrad) ? headMrad / 1000 : 0,
        speed: Number.isFinite(speedCms) && speedCms >= 0 ? speedCms / 100 : -1,
        energy: Number.isFinite(energy) && energy >= 0 ? energy : -1,
        conditionEnergyRatio: Number.isFinite(conditionEnergyPermille) && conditionEnergyPermille >= 0
            ? Math.min(1, conditionEnergyPermille / 1000)
            : -1,
        conditionHeartRate: Number.isFinite(conditionHeartRate) && conditionHeartRate >= 0
            ? Math.min(200, conditionHeartRate)
            : -1,
        skillRemainingSeconds: Number.isFinite(skillRemainingMs) && skillRemainingMs >= 0
            ? Math.min(9.999, skillRemainingMs / 1000)
            : -1,
        skillCharges: Number.isFinite(skillCharges) && skillCharges >= 0 ? Math.min(9, skillCharges) : -1,
        skillPulsesTriggered: Number.isFinite(skillPulsesTriggered) && skillPulsesTriggered >= 0 ? Math.min(9, skillPulsesTriggered) : -1,
    };
}

function encodeConditionEnergyRatio(value: number): number {
    return Number.isFinite(value) && value >= 0
        ? Math.max(0, Math.min(1000, Math.floor(value * 1000)))
        : -1;
}

function encodeConditionHeartRate(value: number): number {
    return Number.isFinite(value) && value >= 0
        ? Math.max(0, Math.min(200, Math.floor(value)))
        : -1;
}

function encodeSkillRemainingMs(value: number): number {
    return Number.isFinite(value) && value >= 0
        ? Math.max(0, Math.min(9999, Math.round(value * 1000)))
        : -1;
}

function encodeSkillStateInt(value: number): number {
    return Number.isFinite(value) && value >= 0 ? Math.max(0, Math.min(9, Math.round(value))) : -1;
}
