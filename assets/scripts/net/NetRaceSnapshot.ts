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
//   "S|<hostPos>#<lane>,<distCm>,<latMm>,<fin>,<headMrad>,<speedCms>,<energy>,<rollMrad>,<rollVelMrad>,<headVelMrad>,<pitchMrad>,<pitchVelMrad>,<conditionEnergyPermille>,<conditionHeartRate>,<conditionCooldownMs>,<softness>;..."
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
    stimulantRevision: number;
    stimulantMask: number;
    cannonRevision: number;
    cannonEliminatedMask: number;
    cannonCompletedMask: number;
    cannonActiveStrikeId: number;
    cannonTargetDistance: number;
    cannonTargetZ: number;
    cannonRemainingSeconds: number;
    mineRelay: NetMineRelayState;
    shark?: NetSharkState;
}

export type NetStimulantState = { revision: number; collectedMask: number };
export type NetCannonState = {
    revision: number;
    eliminatedMask: number;
    completedStrikeMask: number;
    activeStrikeId: number;
    targetDistance: number;
    targetZ: number;
    remainingSeconds: number;
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

// Race-global predator state. Only the host simulates target selection, movement,
// bites, and elimination. Guests render this quantized snapshot and use the
// eliminated mask as a best-effort fallback for a missed reliable event.
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
    eliminatedLane: number;
    eliminatedMask: number;
    huntIndex: number;
    eliminationCount: number;
}

const TAG = 'S|';

export function encodeRaceSnapshot(
    hostPos: number,
    entries: NetSnapshotEntry[],
    stimulant?: NetStimulantState | null,
    shark?: NetSharkState | null,
    cannon?: NetCannonState | null,
    mineRelay?: NetMineRelayState | null,
): string {
    const body = entries
        .map((e) => `${e.lane},${Math.round(e.distance * 100)},${Math.round(e.lateral * 1000)},${e.finished ? 1 : 0},${Math.round(e.heading * 1000)},${Math.round(Math.max(0, e.speed) * 100)},${Math.max(0, Math.round(e.energy))},${Math.round(e.axialRoll * 1000)},${Math.round(e.axialRollVelocity * 1000)},${Math.round(e.headingVelocity * 1000)},${Math.round(e.collisionPitch * 1000)},${Math.round(e.collisionPitchVelocity * 1000)},${encodeConditionEnergyRatio(e.conditionEnergyRatio)},${encodeConditionHeartRate(e.conditionHeartRate)},${encodeConditionCooldown(e.conditionDepletionCooldown ?? -1)},${encodeCollisionSoftness(e.collisionSoftness)},${encodeCharacterAbility(e.abilityState)}`)
        .join(';');
    const revision = Math.max(0, Math.floor(stimulant?.revision ?? 0));
    const mask = Math.max(0, Math.floor(stimulant?.collectedMask ?? 0)).toString(16);
    const cannonRevision = Math.max(0, Math.floor(cannon?.revision ?? 0));
    const cannonEliminatedMask = Math.max(0, Math.floor(cannon?.eliminatedMask ?? 0)).toString(16);
    const cannonCompletedMask = Math.max(0, Math.floor(cannon?.completedStrikeMask ?? 0)).toString(16);
    const cannonActiveStrike = Math.max(0, Math.floor((cannon?.activeStrikeId ?? -1) + 1));
    const cannonTargetDistance = Math.max(0, Math.round((cannon?.targetDistance ?? 0) * 100));
    const cannonTargetZ = Math.round((cannon?.targetZ ?? 0) * 1000);
    const cannonRemainingMs = Math.max(0, Math.round((cannon?.remainingSeconds ?? 0) * 1000));
    const mineRevision = Math.max(0, Math.floor(mineRelay?.revision ?? 0));
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
    const sharkBody = shark
        ? `~${Math.max(0, Math.floor(shark.sequence))},${Math.max(0, Math.floor(shark.state))},${Math.max(0, Math.round(shark.raceElapsed * 1000))},${Math.max(0, Math.round(shark.remainingSeconds * 1000))},${Math.max(0, Math.round(shark.huntOpeningGraceSeconds * 1000))},${Math.round(shark.x * 100)},${Math.round(shark.z * 100)},${Math.round(shark.facingX * 1000)},${Math.round(shark.facingZ * 1000)},${Math.round(shark.targetLane)},${Math.round(shark.eliminatedLane)},${Math.max(0, Math.floor(shark.eliminatedMask)).toString(16)},${Math.max(0, Math.floor(shark.huntIndex))},${Math.max(0, Math.floor(shark.eliminationCount))}`
        : '';
    return `${TAG}${hostPos},${revision},${mask},${cannonRevision},${cannonEliminatedMask},${cannonCompletedMask},${cannonActiveStrike},${cannonTargetDistance},${cannonTargetZ},${cannonRemainingMs},${mineRevision},${mineCompletedMask},${mineExplodedMask},${mineResolvedCarriers},${mineActiveRound},${mineCarrierLane},${minePreviousCarrierLane},${mineLastStarterLane},${mineRemainingMs},${mineTransferCooldownMs},${mineReturnProtectionMs},${mineRecoveryMs}#${body}${sharkBody}`;
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
    const stimulantRevision = header.length > 1 ? parseInt(header[1], 10) : 0;
    const stimulantMask = header.length > 2 ? parseInt(header[2], 16) : 0;
    const cannonRevision = header.length > 3 ? parseInt(header[3], 10) : 0;
    const cannonEliminatedMask = header.length > 4 ? parseInt(header[4], 16) : 0;
    const cannonCompletedMask = header.length > 5 ? parseInt(header[5], 16) : 0;
    const cannonActiveStrike = header.length > 6 ? parseInt(header[6], 10) : 0;
    const cannonTargetDistanceCm = header.length > 7 ? parseInt(header[7], 10) : 0;
    const cannonTargetZMm = header.length > 8 ? parseInt(header[8], 10) : 0;
    const cannonRemainingMs = header.length > 9 ? parseInt(header[9], 10) : 0;
    const mineRevision = header.length > 10 ? parseInt(header[10], 10) : 0;
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
            });
        }
    }
    let shark: NetSharkState | undefined;
    if (sharkSeparator >= 0) {
        const p = stateBody.slice(sharkSeparator + 1).split(',');
        if (p.length >= 14) {
            const values = p.map((value, index) => parseInt(value, index === 11 ? 16 : 10));
            if (values.slice(0, 14).every(Number.isFinite)) {
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
                    eliminatedLane: values[10],
                    eliminatedMask: Math.max(0, values[11]),
                    huntIndex: Math.max(0, values[12]),
                    eliminationCount: Math.max(0, values[13]),
                };
            }
        }
    }
    return {
        hostPos: Number.isFinite(hostPos) ? hostPos : 0,
        entries,
        stimulantRevision: Number.isSafeInteger(stimulantRevision) && stimulantRevision >= 0 ? stimulantRevision : 0,
        stimulantMask: Number.isSafeInteger(stimulantMask) && stimulantMask >= 0 ? stimulantMask : 0,
        cannonRevision: Number.isSafeInteger(cannonRevision) && cannonRevision >= 0 ? cannonRevision : 0,
        cannonEliminatedMask: Number.isSafeInteger(cannonEliminatedMask) && cannonEliminatedMask >= 0 ? cannonEliminatedMask : 0,
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
        shark,
    };
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
//   "P|<lane>,<distCm>,<latMm>,<fin>,<headMrad>,<speedCms>,<energy>,<rollMrad>,<rollVelMrad>,<headVelMrad>,<pitchMrad>,<pitchVelMrad>,<conditionEnergyPermille>,<conditionHeartRate>,<ownerStateSeq>,<ownerPos>,<softness>"
const SELF_TAG = 'P|';

export function encodeSelfSnapshot(
    entry: NetSnapshotEntry,
    ownerStateSeq = entry.ownerStateSeq ?? -1,
    ownerPos = entry.ownerPos ?? -1,
): string {
    return `${SELF_TAG}${entry.lane},${Math.round(entry.distance * 100)},${Math.round(entry.lateral * 1000)},${entry.finished ? 1 : 0},${Math.round(entry.heading * 1000)},${Math.round(Math.max(0, entry.speed) * 100)},${Math.max(0, Math.round(entry.energy))},${Math.round(entry.axialRoll * 1000)},${Math.round(entry.axialRollVelocity * 1000)},${Math.round(entry.headingVelocity * 1000)},${Math.round(entry.collisionPitch * 1000)},${Math.round(entry.collisionPitchVelocity * 1000)},${encodeConditionEnergyRatio(entry.conditionEnergyRatio)},${encodeConditionHeartRate(entry.conditionHeartRate)},${encodeOwnerStateSeq(ownerStateSeq)},${encodeOwnerStateSeq(ownerPos)},${encodeCollisionSoftness(entry.collisionSoftness)},${encodeCharacterAbility(entry.abilityState)}`;
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
