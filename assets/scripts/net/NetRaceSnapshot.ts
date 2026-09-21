import { encodeCharacterAbility, decodeCharacterAbility } from './NetCharacterAbilityCodec';
import type { CollisionSoftnessState } from '../swimmer/CollisionSoftnessModel';
import { encodeCollisionSoftness, decodeCollisionSoftness } from './NetCollisionSoftnessCodec';

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
//   "S|<hostPos>#<lane>,<distCm>,<latMm>,<fin>,<headMrad>,<speedCms>,<energy>,<rollMrad>,<rollVelMrad>,<headVelMrad>,<pitchMrad>,<pitchVelMrad>,<conditionEnergyPermille>,<conditionHeartRate>,<conditionCooldownMs>,<softness>,<ability>,<calmSlushMs>;..."
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
    abilityState?: Readonly<import('../swimmer/CharacterAbilityState').CharacterAbilitySnapshot>;
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
    collisionSoftness?: Readonly<CollisionSoftnessState>;
    // Condition state is appended after every existing pose field. Human lanes use
    // their owner's self report; genuine AI lanes use the host S| snapshot.
    // -1 means an older payload or a source that is not authoritative for this lane.
    conditionEnergyRatio: number;
    conditionHeartRate: number;
    // Genuine-AI depletion cooldown remaining, authoritative only on host S|.
    // Optional/-1 on human P|/frame self and legacy snapshots.
    conditionDepletionCooldown?: number;
    // Heartbeat-brawl cooling status. Appended after ability state on every owner
    // snapshot so a missed pickup event or host migration recovers the 3s penalty.
    calmSlushRemaining?: number;
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
    sequence: number;
    entries: NetSnapshotEntry[];
    stimulantRevision: number;
    stimulantMask: number;
    stimulantCollectors: readonly number[];
    stimulantPickupRevisions: readonly number[];
    eventEpochs: readonly number[];
    cannonRevision: number;
    cannonCompletedMask: number;
    cannonActiveStrikeId: number;
    cannonTargetDistance: number;
    cannonTargetZ: number;
    cannonRemainingSeconds: number;
    mineRelay: NetMineRelayState;
    minefield: NetMinefieldState;
    entertainmentDirector: NetEntertainmentDirectorState;
    recovery: NetEntertainmentRecoveryState;
    shark?: NetSharkState;
}

export type NetStimulantState = {
    revision: number; collectedMask: number;
    collectorLanes?: readonly number[];
    pickupRevisions?: readonly number[];
};
export type NetCannonState = {
    revision: number;
    completedStrikeMask: number;
    activeStrikeId: number;
    targetDistance: number;
    targetZ: number;
    remainingSeconds: number;
};
export type NetEntertainmentRecoveryLaneState = {
    phase: number;
    reason: number;
    remainingSeconds: number;
    distance: number;
    revision: number;
};
export type NetEntertainmentRecoveryState = {
    revision: number;
    lanes: readonly NetEntertainmentRecoveryLaneState[];
};
export type NetMineRelayState = {
    revision: number;
    completedRoundMask: number;
    explodedRoundMask: number;
    resolvedCarrierLanesPacked: number;
    activeRoundId: number;
    carrierLane: number;
    previousCarrierLane: number;
    lastStarterLane: number;
    remainingSeconds: number;
    transferCooldownSeconds: number;
    returnProtectionSeconds: number;
    recoverySeconds: number;
};
export type NetMinefieldState = {
    revision: number;
    elapsedSeconds: number;
    activeMask: number;
    armedMask: number;
    waveIndex: number;
    slotWavesPacked: number;
};
export type NetEntertainmentDirectorState = {
    revision: number;
    phase: number;
    eventIndex: number;
    eventCount: number;
    remainingSeconds: number;
    packedEvents: number;
    activatedMask: number;
    residentMask: number;
    specialMask: number;
    activationSerial: number;
    lastActivatedEvent: number | null;
    encoreRound: number;
    encoreEvent: number | null;
    anchorDistance: number;
    eventAnchorDistances: readonly number[];
};

// Race-global predator state. Only the host simulates target selection, movement,
// bites, and knockdowns. Guests render this quantized snapshot; recovery state is
// carried separately as a best-effort fallback for a missed reliable event.
export interface NetSharkState {
    sequence: number;
    state: number;
    raceElapsed: number;
    remainingSeconds: number;
    huntOpeningGraceSeconds: number;
    x: number;
    z: number;
    facingX: number;
    facingZ: number;
    targetLane: number;
    knockedLane: number;
    huntIndex: number;
}

const TAG = 'S|';

const LEDGER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// 每个领取序号占一个字节：道具编号×8＋泳道，255 为尚未恢复的序号。
// 21 字节编码为 28 字符，保留空洞与次序，不依赖浏览器或 Node 的 Base64 API。
function encodeStimulantLedger(state?: NetStimulantState | null): string {
    if (!state?.collectorLanes?.length || !state.pickupRevisions) return '';
    const bytes = new Uint8Array(21).fill(255);
    for (let item = 0; item < Math.min(21, state.collectorLanes.length); item++) {
        const lane = state.collectorLanes[item];
        const revision = state.pickupRevisions[item];
        if (Number.isInteger(lane) && lane >= 0 && lane < 8
            && Number.isInteger(revision) && revision > 0 && revision <= 21) {
            bytes[revision - 1] = item * 8 + lane;
        }
    }
    let body = '!';
    for (let i = 0; i < 21; i += 3) {
        const word = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        body += LEDGER_ALPHABET[(word >>> 18) & 63] + LEDGER_ALPHABET[(word >>> 12) & 63]
            + LEDGER_ALPHABET[(word >>> 6) & 63] + LEDGER_ALPHABET[word & 63];
    }
    return body;
}

function decodeStimulantLedger(body: string): { collectors: number[]; revisions: number[] } {
    const empty = { collectors: [], revisions: [] };
    if (!/^![A-Za-z0-9_-]{28}$/.test(body)) return empty;
    const collectors = new Array<number>(21).fill(-1);
    const revisions = new Array<number>(21).fill(0);
    let revision = 0;
    for (let i = 1; i < body.length; i += 4) {
        const word = (LEDGER_ALPHABET.indexOf(body[i]) << 18) | (LEDGER_ALPHABET.indexOf(body[i + 1]) << 12)
            | (LEDGER_ALPHABET.indexOf(body[i + 2]) << 6) | LEDGER_ALPHABET.indexOf(body[i + 3]);
        for (let shift = 16; shift >= 0; shift -= 8) {
            const value = (word >>> shift) & 255;
            revision++;
            if (value === 255) continue;
            const item = value >>> 3;
            if (item >= 21 || revisions[item] !== 0) return empty;
            collectors[item] = value & 7;
            revisions[item] = revision;
        }
    }
    return { collectors, revisions };
}

// 大修订号使用紧凑整数，给整包序号保留字节；小整数保持原长度。
function encodeSnapshotRevision(value: number): number | string {
    return value >= 10000 ? '!' + value.toString(36) : value;
}

function decodeSnapshotRevision(value = ''): number {
    return value.startsWith('!') ? parseInt(value.slice(1), 36) : parseInt(value, 10);
}

export function encodeRaceSnapshot(
    hostPos: number,
    entries: NetSnapshotEntry[],
    stimulant?: NetStimulantState | null,
    shark?: NetSharkState | null,
    cannon?: NetCannonState | null,
    mineRelay?: NetMineRelayState | null,
    recovery?: NetEntertainmentRecoveryState | null,
    minefield?: NetMinefieldState | null,
    entertainmentDirector?: NetEntertainmentDirectorState | null,
    eventEpochs?: readonly number[],
    sequence = -1,
): string {
    const body = entries
        .map((e) => `${e.lane},${Math.round(e.distance * 100)},${Math.round(e.lateral * 1000)},${e.finished ? 1 : 0},${Math.round(e.heading * 1000)},${Math.round(Math.max(0, e.speed) * 100)},${Math.max(0, Math.round(e.energy))},${Math.round(e.axialRoll * 1000)},${Math.round(e.axialRollVelocity * 1000)},${Math.round(e.headingVelocity * 1000)},${Math.round(e.collisionPitch * 1000)},${Math.round(e.collisionPitchVelocity * 1000)},${encodeConditionEnergyRatio(e.conditionEnergyRatio)},${encodeConditionHeartRate(e.conditionHeartRate)},${encodeConditionCooldown(e.conditionDepletionCooldown ?? -1)},${encodeCollisionSoftness(e.collisionSoftness)},${encodeCharacterAbility(e.abilityState)},${encodeConditionCooldown(e.calmSlushRemaining ?? -1)}`)
        .join(';');
    const revision = encodeSnapshotRevision(Math.max(0, Math.floor(stimulant?.revision ?? 0)));
    const mask = Math.max(0, Math.floor(stimulant?.collectedMask ?? 0)).toString(16);
    const collectors = encodeStimulantLedger(stimulant);
    const epochs = eventEpochs ? '!' + eventEpochs.slice(0, 3).map(value => safeNonNegativeInteger(value).toString(36)).join('.') : '';
    const cannonRevision = encodeSnapshotRevision(Math.max(0, Math.floor(cannon?.revision ?? 0)));
    // 复用保留槽位记录整包序号，其他字段位置不变；0 保留为旧格式。
    const cannonReservedMask = Number.isSafeInteger(sequence) && sequence >= 0
        ? '!' + sequence.toString(36) : '0';
    const cannonCompletedMask = Math.max(0, Math.floor(cannon?.completedStrikeMask ?? 0)).toString(16);
    const cannonActiveStrike = Math.max(0, Math.floor((cannon?.activeStrikeId ?? -1) + 1));
    const cannonTargetDistance = Math.max(0, Math.round((cannon?.targetDistance ?? 0) * 100));
    const cannonTargetZ = Math.round((cannon?.targetZ ?? 0) * 1000);
    const cannonRemainingMs = Math.max(0, Math.round((cannon?.remainingSeconds ?? 0) * 1000));
    const mineRevision = encodeSnapshotRevision(Math.max(0, Math.floor(mineRelay?.revision ?? 0)));
    const mineCompletedMask = Math.max(0, Math.floor(mineRelay?.completedRoundMask ?? 0)).toString(16);
    const mineExplodedMask = Math.max(0, Math.floor(mineRelay?.explodedRoundMask ?? 0)).toString(16);
    const mineResolvedCarriers = Math.max(0, Math.floor(mineRelay?.resolvedCarrierLanesPacked ?? 0)).toString(16);
    const mineActiveRound = Math.max(0, Math.floor((mineRelay?.activeRoundId ?? -1) + 1));
    const mineCarrierLane = Math.max(0, Math.floor((mineRelay?.carrierLane ?? -1) + 1));
    const minePreviousCarrierLane = Math.max(0, Math.floor((mineRelay?.previousCarrierLane ?? -1) + 1));
    const mineLastStarterLane = Math.max(0, Math.floor((mineRelay?.lastStarterLane ?? -1) + 1));
    const mineRemainingMs = Math.max(0, Math.round((mineRelay?.remainingSeconds ?? 0) * 1000));
    const mineTransferCooldownMs = Math.max(0, Math.round((mineRelay?.transferCooldownSeconds ?? 0) * 1000));
    const mineReturnProtectionMs = Math.max(0, Math.round((mineRelay?.returnProtectionSeconds ?? 0) * 1000));
    const mineRecoveryMs = Math.max(0, Math.round((mineRelay?.recoverySeconds ?? 0) * 1000));
    const recoveryRevision = encodeSnapshotRevision(Math.max(0, Math.floor(recovery?.revision ?? 0)));
    // 整数使用 36 进制，抵消领取账本和返场代次的新增字节；不降低量化精度。
    const recoveryBody = recovery ? '!' + recovery.lanes
        .map((lane) => `${Math.max(0, Math.floor(lane.phase)).toString(36)}.${Math.max(0, Math.floor(lane.reason)).toString(36)}.${Math.max(0, Math.round(lane.remainingSeconds * 1000)).toString(36)}.${Math.max(0, Math.round(lane.distance * 100)).toString(36)}.${Math.max(0, Math.floor(lane.revision)).toString(36)}`)
        .join(':') : '';
    const minefieldRevision = encodeSnapshotRevision(Math.max(0, Math.floor(minefield?.revision ?? 0)));
    const minefieldElapsedMs = Math.max(0, Math.round((minefield?.elapsedSeconds ?? 0) * 1000));
    const minefieldActiveMask = Math.max(0, Math.floor(minefield?.activeMask ?? 0)).toString(16);
    // Slot 27 now carries the host-authoritative spawn-safe/armed state without shifting later fields.
    const minefieldArmedMask = Math.max(0, Math.floor(minefield?.armedMask ?? 0)).toString(16);
    const minefieldWaveIndex = Math.max(0, Math.floor(minefield?.waveIndex ?? 0));
    const minefieldSlotWavesPacked = Math.max(0, Math.floor(minefield?.slotWavesPacked ?? 0)).toString(16);
    const directorRevision = encodeSnapshotRevision(Math.max(0, Math.floor(entertainmentDirector?.revision ?? 0)));
    const directorPhase = Math.max(0, Math.floor(entertainmentDirector?.phase ?? 0));
    const directorEventIndex = Math.max(0, Math.floor(entertainmentDirector?.eventIndex ?? 0));
    const directorEventCount = Math.max(0, Math.floor(entertainmentDirector?.eventCount ?? 0));
    const directorRemainingMs = Math.max(0, Math.round((entertainmentDirector?.remainingSeconds ?? 0) * 1000));
    const directorPackedEvents = Math.max(0, Math.floor(entertainmentDirector?.packedEvents ?? 0)).toString(16);
    const directorActivatedMask = Math.max(0, Math.floor(entertainmentDirector?.activatedMask ?? 0)).toString(16);
    const directorResidentMask = Math.max(0, Math.floor(entertainmentDirector?.residentMask ?? 0)).toString(16);
    const directorAnchorCm = Math.max(0, Math.round((entertainmentDirector?.anchorDistance ?? 0) * 100));
    // v93 用带标记的 36 进制保留厘米精度，为比赛身份外壳留出字节预算。
    const directorEventAnchors = entertainmentDirector ? '!' + entertainmentDirector.eventAnchorDistances
        .map(distance => Math.max(0, Math.round(distance * 100)).toString(36))
        .join('.') : '';
    const directorSpecialMask = Math.max(0, Math.floor(entertainmentDirector?.specialMask ?? 0)).toString(16);
    const directorActivationSerial = encodeSnapshotRevision(Math.max(0, Math.floor(entertainmentDirector?.activationSerial ?? 0)));
    const directorEncoreRound = encodeSnapshotRevision(Math.max(0, Math.floor(entertainmentDirector?.encoreRound ?? 0)));
    const directorEncoreEvent = Math.max(0, Math.floor((entertainmentDirector?.encoreEvent ?? -1) + 1));
    const directorLastActivatedEvent = Math.max(0, Math.floor((entertainmentDirector?.lastActivatedEvent ?? -1) + 1));
    const sharkBody = shark
        ? `~${Math.max(0, Math.floor(shark.sequence))},${Math.max(0, Math.floor(shark.state))},${Math.max(0, Math.round(shark.raceElapsed * 1000))},${Math.max(0, Math.round(shark.remainingSeconds * 1000))},${Math.max(0, Math.round(shark.huntOpeningGraceSeconds * 1000))},${Math.round(shark.x * 100)},${Math.round(shark.z * 100)},${Math.round(shark.facingX * 1000)},${Math.round(shark.facingZ * 1000)},${Math.round(shark.targetLane)},${Math.round(shark.knockedLane)},${Math.max(0, Math.floor(shark.huntIndex))}`
        : '';
    return `${TAG}${hostPos},${revision},${mask},${cannonRevision},${cannonReservedMask},${cannonCompletedMask},${cannonActiveStrike},${cannonTargetDistance},${cannonTargetZ},${cannonRemainingMs},${mineRevision},${mineCompletedMask},${mineExplodedMask},${mineResolvedCarriers},${mineActiveRound},${mineCarrierLane},${minePreviousCarrierLane},${mineLastStarterLane},${mineRemainingMs},${mineTransferCooldownMs},${mineReturnProtectionMs},${mineRecoveryMs},${recoveryRevision},${recoveryBody},${minefieldRevision},${minefieldElapsedMs},${minefieldActiveMask},${minefieldArmedMask},${directorRevision},${directorPhase},${directorEventIndex},${directorRemainingMs},${directorPackedEvents},${directorActivatedMask},${directorResidentMask},${directorAnchorCm},${directorEventAnchors},${directorEventCount},${directorSpecialMask},${directorActivationSerial},${directorEncoreRound},${directorEncoreEvent},${directorLastActivatedEvent},${minefieldWaveIndex},${minefieldSlotWavesPacked},${collectors},${epochs}#${body}${sharkBody}`;
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
    const header = rest.slice(0, hash).split(',');
    const hostPos = parseInt(header[0], 10);
    const sequenceField = header[4] ?? '0';
    const sequence = sequenceField === '0' ? -1 : parseInt(sequenceField.slice(1), 36);
    if (sequenceField !== '0' && (!/^![0-9a-z]+$/.test(sequenceField)
        || !Number.isSafeInteger(sequence) || sequence < 0)) return null;
    const stimulantRevision = decodeSnapshotRevision(header[1]);
    const stimulantMask = header.length > 2 ? parseInt(header[2], 16) : 0;
    const cannonRevision = decodeSnapshotRevision(header[3]);
    const cannonCompletedMask = header.length > 5 ? parseInt(header[5], 16) : 0;
    const cannonActiveStrike = header.length > 6 ? parseInt(header[6], 10) : 0;
    const cannonTargetDistanceCm = header.length > 7 ? parseInt(header[7], 10) : 0;
    const cannonTargetZMm = header.length > 8 ? parseInt(header[8], 10) : 0;
    const cannonRemainingMs = header.length > 9 ? parseInt(header[9], 10) : 0;
    const mineRevision = decodeSnapshotRevision(header[10]);
    const mineCompletedMask = header.length > 11 ? parseInt(header[11], 16) : 0;
    const mineExplodedMask = header.length > 12 ? parseInt(header[12], 16) : 0;
    const mineResolvedCarriers = header.length > 13 ? parseInt(header[13], 16) : 0;
    const mineActiveRound = header.length > 14 ? parseInt(header[14], 10) : 0;
    const mineCarrierLane = header.length > 15 ? parseInt(header[15], 10) : 0;
    const minePreviousCarrierLane = header.length > 16 ? parseInt(header[16], 10) : 0;
    const mineLastStarterLane = header.length > 17 ? parseInt(header[17], 10) : 0;
    const mineRemainingMs = header.length > 18 ? parseInt(header[18], 10) : 0;
    const mineTransferCooldownMs = header.length > 19 ? parseInt(header[19], 10) : 0;
    const mineReturnProtectionMs = header.length > 20 ? parseInt(header[20], 10) : 0;
    const mineRecoveryMs = header.length > 21 ? parseInt(header[21], 10) : 0;
    const recoveryRevision = decodeSnapshotRevision(header[22]);
    const recoveryBody = header.length > 23 ? header[23] : '';
    const minefieldRevision = decodeSnapshotRevision(header[24]);
    const minefieldElapsedMs = header.length > 25 ? parseInt(header[25], 10) : 0;
    const minefieldActiveMask = header.length > 26 ? parseInt(header[26], 16) : 0;
    const minefieldArmedMask = header.length > 27 ? parseInt(header[27], 16) : 0;
    const directorRevision = decodeSnapshotRevision(header[28]);
    const directorPhase = header.length > 29 ? parseInt(header[29], 10) : 0;
    const directorEventIndex = header.length > 30 ? parseInt(header[30], 10) : 0;
    const directorRemainingMs = header.length > 31 ? parseInt(header[31], 10) : 0;
    const directorPackedEvents = header.length > 32 ? parseInt(header[32], 16) : 0;
    const directorActivatedMask = header.length > 33 ? parseInt(header[33], 16) : 0;
    const directorResidentMask = header.length > 34 ? parseInt(header[34], 16) : 0;
    const directorAnchorCm = header.length > 35 ? parseInt(header[35], 10) : 0;
    const directorEventAnchors = header.length > 36 ? decodeCentimeterList(header[36]) : [0, 0, 0, 0, 0, 0];
    const directorEventCount = header.length > 37 ? parseInt(header[37], 10) : 0;
    const directorSpecialMask = header.length > 38 ? parseInt(header[38], 16) : 0;
    const directorActivationSerial = decodeSnapshotRevision(header[39]);
    const directorEncoreRound = decodeSnapshotRevision(header[40]);
    const directorEncoreEvent = header.length > 41 ? parseInt(header[41], 10) : 0;
    const directorLastActivatedEvent = header.length > 42 ? parseInt(header[42], 10) : 0;
    const minefieldWaveIndex = header.length > 43 ? parseInt(header[43], 10) : 0;
    const minefieldSlotWavesPacked = header.length > 44 ? parseInt(header[44], 16) : 0;
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
                collisionSoftness: decodeCollisionSoftness(parts[15]),
                abilityState: decodeCharacterAbility(parts[16]),
                calmSlushRemaining: decodeConditionCooldown(parts.length > 17 ? parseInt(parts[17], 10) : -1),
            });
        }
    }
    let shark: NetSharkState | undefined;
    if (sharkSeparator >= 0) {
        const p = stateBody.slice(sharkSeparator + 1).split(',');
        if (p.length >= 12) {
            const values = p.map((value) => parseInt(value, 10));
            if (values.slice(0, 12).every(Number.isFinite)) {
                shark = {
                    sequence: Math.max(0, values[0]),
                    state: Math.max(0, values[1]),
                    raceElapsed: Math.max(0, values[2] / 1000),
                    remainingSeconds: Math.max(0, values[3] / 1000),
                    huntOpeningGraceSeconds: Math.max(0, values[4] / 1000),
                    x: values[5] / 100,
                    z: values[6] / 100,
                    facingX: values[7] / 1000,
                    facingZ: values[8] / 1000,
                    targetLane: values[9],
                    knockedLane: values[10],
                    huntIndex: Math.max(0, values[11]),
                };
            }
        }
    }
    const ledger = decodeStimulantLedger(header[45] ?? '');
    return {
        hostPos: Number.isFinite(hostPos) ? hostPos : 0,
        sequence,
        entries,
        stimulantRevision: Number.isSafeInteger(stimulantRevision) && stimulantRevision >= 0 ? stimulantRevision : 0,
        stimulantMask: Number.isSafeInteger(stimulantMask) && stimulantMask >= 0 ? stimulantMask : 0,
        stimulantCollectors: ledger.collectors,
        stimulantPickupRevisions: ledger.revisions,
        eventEpochs: decodeEventEpochs(header[46] ?? ''),
        cannonRevision: Number.isSafeInteger(cannonRevision) && cannonRevision >= 0 ? cannonRevision : 0,
        cannonCompletedMask: Number.isSafeInteger(cannonCompletedMask) && cannonCompletedMask >= 0 ? cannonCompletedMask : 0,
        cannonActiveStrikeId: Number.isSafeInteger(cannonActiveStrike) && cannonActiveStrike > 0 ? cannonActiveStrike - 1 : -1,
        cannonTargetDistance: Number.isSafeInteger(cannonTargetDistanceCm) && cannonTargetDistanceCm >= 0 ? cannonTargetDistanceCm / 100 : 0,
        cannonTargetZ: Number.isSafeInteger(cannonTargetZMm) ? cannonTargetZMm / 1000 : 0,
        cannonRemainingSeconds: Number.isSafeInteger(cannonRemainingMs) && cannonRemainingMs >= 0 ? cannonRemainingMs / 1000 : 0,
        mineRelay: {
            revision: safeNonNegativeInteger(mineRevision),
            completedRoundMask: safeNonNegativeInteger(mineCompletedMask),
            explodedRoundMask: safeNonNegativeInteger(mineExplodedMask),
            resolvedCarrierLanesPacked: safeNonNegativeInteger(mineResolvedCarriers),
            activeRoundId: Number.isSafeInteger(mineActiveRound) && mineActiveRound > 0 ? mineActiveRound - 1 : -1,
            carrierLane: Number.isSafeInteger(mineCarrierLane) && mineCarrierLane > 0 ? mineCarrierLane - 1 : -1,
            previousCarrierLane: Number.isSafeInteger(minePreviousCarrierLane) && minePreviousCarrierLane > 0 ? minePreviousCarrierLane - 1 : -1,
            lastStarterLane: Number.isSafeInteger(mineLastStarterLane) && mineLastStarterLane > 0 ? mineLastStarterLane - 1 : -1,
            remainingSeconds: safeMilliseconds(mineRemainingMs),
            transferCooldownSeconds: safeMilliseconds(mineTransferCooldownMs),
            returnProtectionSeconds: safeMilliseconds(mineReturnProtectionMs),
            recoverySeconds: safeMilliseconds(mineRecoveryMs),
        },
        minefield: {
            revision: safeNonNegativeInteger(minefieldRevision),
            elapsedSeconds: safeMilliseconds(minefieldElapsedMs),
            activeMask: safeNonNegativeInteger(minefieldActiveMask),
            armedMask: safeNonNegativeInteger(minefieldArmedMask),
            waveIndex: safeNonNegativeInteger(minefieldWaveIndex),
            slotWavesPacked: safeNonNegativeInteger(minefieldSlotWavesPacked),
        },
        entertainmentDirector: {
            revision: safeNonNegativeInteger(directorRevision),
            phase: safeNonNegativeInteger(directorPhase),
            eventIndex: safeNonNegativeInteger(directorEventIndex),
            eventCount: safeNonNegativeInteger(directorEventCount),
            remainingSeconds: safeMilliseconds(directorRemainingMs),
            packedEvents: safeNonNegativeInteger(directorPackedEvents),
            activatedMask: safeNonNegativeInteger(directorActivatedMask),
            residentMask: safeNonNegativeInteger(directorResidentMask),
            specialMask: safeNonNegativeInteger(directorSpecialMask),
            activationSerial: safeNonNegativeInteger(directorActivationSerial),
            lastActivatedEvent: Number.isSafeInteger(directorLastActivatedEvent)
                && directorLastActivatedEvent > 0
                ? directorLastActivatedEvent - 1
                : null,
            encoreRound: safeNonNegativeInteger(directorEncoreRound),
            encoreEvent: Number.isSafeInteger(directorEncoreEvent) && directorEncoreEvent > 0
                ? directorEncoreEvent - 1
                : null,
            anchorDistance: Number.isSafeInteger(directorAnchorCm) && directorAnchorCm >= 0 ? directorAnchorCm / 100 : 0,
            eventAnchorDistances: directorEventAnchors.length === 6 ? directorEventAnchors : [0, 0, 0, 0, 0, 0],
        },
        recovery: decodeRecoveryState(recoveryRevision, recoveryBody),
        shark,
    };
}

function decodeCentimeterList(body: string): number[] {
    const radix = body.startsWith('!') ? 36 : 10;
    if (radix === 36) body = body.slice(1);
    if (body.length === 0) return [];
    const values: number[] = [];
    for (const token of body.split('.')) {
        if (!(radix === 36 ? /^[0-9a-z]+$/ : /^\d+$/).test(token)) return [];
        const value = parseInt(token, radix);
        if (!Number.isSafeInteger(value) || value < 0) return [];
        values.push(value / 100);
    }
    return values;
}

function decodeEventEpochs(body: string): number[] {
    const compact = body.startsWith('!');
    if (compact) body = body.slice(1);
    if (!(compact ? /^[0-9a-z]+\.[0-9a-z]+\.[0-9a-z]+$/ : /^\d+\.\d+\.\d+$/).test(body)) return [0, 0, 0];
    return body.split('.').map(value => safeNonNegativeInteger(parseInt(value, compact ? 36 : 10)));
}

function decodeRecoveryState(revision: number, body: string): NetEntertainmentRecoveryState {
    const lanes: NetEntertainmentRecoveryLaneState[] = [];
    const radix = body.startsWith('!') ? 36 : 10;
    if (radix === 36) body = body.slice(1);
    if (body.length > 0) {
        for (const token of body.split(':')) {
            const values = token.split('.').map(value => parseInt(value, radix));
            if (values.length !== 5 || !values.every(value => Number.isSafeInteger(value) && value >= 0)) continue;
            lanes.push({
                phase: values[0],
                reason: values[1],
                remainingSeconds: values[2] / 1000,
                distance: values[3] / 100,
                revision: values[4],
            });
        }
    }
    return { revision: safeNonNegativeInteger(revision), lanes };
}

function safeNonNegativeInteger(value: number): number {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeMilliseconds(value: number): number {
    return Number.isSafeInteger(value) && value >= 0 ? value / 1000 : 0;
}

// Self-position report (tag "P|"): a single lane's own-authoritative position, sent by
// the client that CONTROLS that swimmer (each human broadcasts their own player). Every
// other client eases that swimmer toward this so its on-screen copy "catches up" to how
// its owner actually sees it — the owner predicts locally with zero input lag, so the
// owner's position is the truth; input-replay alone leaves the remote copy ~1 RTT behind
// and drifting. Same field layout as one snapshot entry (incl. speed + energy), so it
// also carries authoritative pose-speed and ultimate energy — required in broadcast-only
// mode (iOS high-performance+), where these can no longer ride the lock-step frame self.
//   "P|<lane>,<distCm>,<latMm>,<fin>,<headMrad>,<speedCms>,<energy>,<rollMrad>,<rollVelMrad>,<headVelMrad>,<pitchMrad>,<pitchVelMrad>,<conditionEnergyPermille>,<conditionHeartRate>,<ownerStateSeq>,<ownerPos>,<softness>,<ability>,<calmSlushMs>"
const SELF_TAG = 'P|';

export function encodeSelfSnapshot(
    entry: NetSnapshotEntry,
    ownerStateSeq = entry.ownerStateSeq ?? -1,
    ownerPos = entry.ownerPos ?? -1,
): string {
    return `${SELF_TAG}${entry.lane},${Math.round(entry.distance * 100)},${Math.round(entry.lateral * 1000)},${entry.finished ? 1 : 0},${Math.round(entry.heading * 1000)},${Math.round(Math.max(0, entry.speed) * 100)},${Math.max(0, Math.round(entry.energy))},${Math.round(entry.axialRoll * 1000)},${Math.round(entry.axialRollVelocity * 1000)},${Math.round(entry.headingVelocity * 1000)},${Math.round(entry.collisionPitch * 1000)},${Math.round(entry.collisionPitchVelocity * 1000)},${encodeConditionEnergyRatio(entry.conditionEnergyRatio)},${encodeConditionHeartRate(entry.conditionHeartRate)},${encodeOwnerStateSeq(ownerStateSeq)},${encodeOwnerStateSeq(ownerPos)},${encodeCollisionSoftness(entry.collisionSoftness)},${encodeCharacterAbility(entry.abilityState)},${encodeConditionCooldown(entry.calmSlushRemaining ?? -1)}`;
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
        collisionSoftness: decodeCollisionSoftness(parts[16]),
        abilityState: decodeCharacterAbility(parts[17]),
        calmSlushRemaining: decodeConditionCooldown(parts.length > 18 ? parseInt(parts[18], 10) : -1),
    };
}

export function encodeConditionEnergyRatio(value: number): number {
    return Number.isFinite(value) && value >= 0
        // 正体力不能量化成 0，否则远端会提前进入耗尽推进。
        ? Math.max(value > 0 ? 1 : 0, Math.min(1000, Math.round(value * 1000)))
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
