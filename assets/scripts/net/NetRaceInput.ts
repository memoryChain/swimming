import { encodeCharacterAbility, decodeCharacterAbility } from './NetCharacterAbilityCodec';
import { encodeCollisionSoftness, decodeCollisionSoftness } from './NetCollisionSoftnessCodec';

// Per-frame input encoding for WeChat lock-step (帧同步) races.
//
// In lock-step, every client uploads ITS OWN input for each logical frame via
// uploadFrame(string); the server collects all clients' inputs for that frame and
// delivers them together via onSyncFrame({ frameId, actionList }). Every client then
// advances the deterministic simulation by one fixed step, applying every member's
// decoded input. Identical seed (SharedRNG) + identical inputs => identical world.
//
// This module is the pure codec: it turns a swimmer's discrete input events for one
// frame into a compact string and back. It has NO engine/game dependencies so it can
// be unit-reasoned in isolation. The NetRaceController owns capturing local events,
// calling uploadFrame each tick, and applying decoded remote events to swimmers.
//
// Wire format (one client's payload for one frame):
//   "<senderPos>|<token>;<token>;...|<selfPos>|<inputSeq>"
// where senderPos identifies which room member produced it (WeChat posNum), each token
// is one input event, and the optional trailing "<selfPos>" is the sender's OWN
// authoritative state "<lane>,<distCm>,<latMm>,<fin>,<headMrad>,<speedCms>,<energy>,<rollMrad>,<rollVelMrad>,<headVelMrad>,<pitchMrad>,<pitchVelMrad>,<conditionEnergyPermille>,<conditionHeartRate>,<ownerStateSeq>,<softness>,<ability>,<calmSlushMs>".
// Position, pose speed, outcome-affecting ultimate energy, and condition state ride the
// RELIABLE lock-step frame channel (not best-effort broadcasts, which drop intermittently),
// so every client's copy of every human catches up to its owner reliably.
// An empty event list is "<senderPos>|" (optionally "<senderPos>||<selfPos>").

import {
    decodeConditionEnergyRatio,
    decodeConditionHeartRate,
    decodeConditionCooldown,
    encodeConditionEnergyRatio,
    encodeConditionHeartRate,
    encodeConditionCooldown,
    encodeOwnerStateSeq,
    decodeOwnerStateSeq,
    type NetSnapshotEntry,
} from './NetRaceSnapshot';

// Side of a stroke/kick. 0 = LEFT, 1 = RIGHT (kept numeric so the codec doesn't
// depend on the game's StrokeType enum; the controller maps between them).
export type NetInputSide = 0 | 1;

export const enum NetInputKind {
    Stroke = 's',      // arm stroke (recordStroke)
    Kick = 'k',        // leg kick (recordKickTap)
    HeldOn = 'h',      // stroke-held begin
    HeldOff = 'H',     // stroke-held end
    DiveCharge = 'c',  // dive charge start (countdown/diving)
    DiveRelease = 'r', // dive release (carries final power + optional final launch speed)
    DolphinJump = 'd', // dolphin jump trigger (both-hands gesture)
    StimulantPickup = 'p', // host-authoritative item id, collector lane, revision
    SharkKnockdown = 'e', // host-authoritative shark sequence, knocked lane and recovery distance
    CannonLaunch = 'l', // host-authoritative strike id, target distance/Z, warning and revision
    CannonImpact = 'x', // host-authoritative strike id, hit mask, knocked lane/distance and revision
    MineRelayArm = 'm', // host-authoritative round, carrier, fuse and revision
    MineRelayTransfer = 't', // host-authoritative round, from/to lanes, remaining fuse and revision
    MineRelayResolution = 'b', // host-authoritative round, carrier, explosion center, hit mask and revision
    MinefieldImpact = 'i', // host-authoritative obstacle mine id, direct lane, position, hit mask and revision
    LitterContact = 'g', // host-authoritative garbage slot contact, resulting trajectory and revision
    EntertainmentKnockdown = 'u', // host-authoritative global recovery lane/reason/distance/revision
}

export interface NetInputEvent {
    /** 实际输入发生时的心率，百分之一 bpm，避免同包快照比动作更晚。 */
    heartRate?: number;
    kind: NetInputKind;
    // Present for Stroke / Kick / HeldOn / HeldOff.
    side?: NetInputSide;
    // Present for DiveRelease: the final normalized 0..1 dive power.
    power?: number;
    // Present for newer DiveRelease payloads: the owner's final progression-adjusted
    // launch speed in m/s. Optional so older payloads keep decoding correctly.
    launchSpeed?: number;
    itemId?: number;
    collectorLane?: number;
    revision?: number;
    sharkSequence?: number;
    targetLane?: number;
    cannonStrikeId?: number;
    targetDistance?: number;
    targetZ?: number;
    warningSeconds?: number;
    hitMask?: number;
    knockedLane?: number;
    knockedDistance?: number;
    mineRoundId?: number;
    mineCarrierLane?: number;
    mineFromLane?: number;
    mineToLane?: number;
    mineDistance?: number;
    mineLateral?: number;
    fuseSeconds?: number;
    remainingSeconds?: number;
    exploded?: boolean;
    mineId?: number;
    mineHitLane?: number;
    recoveryLane?: number;
    recoveryReason?: number;
    litterSlotId?: number;
    litterGeneration?: number;
    litterKind?: number;
    litterLane?: number;
    litterAway?: number;
    litterCourseX?: number;
    litterLateral?: number;
    litterBounceAlong?: number;
    litterBounceLateral?: number;
}

export interface DecodedInputFrame {
    // Room member (posNum) that produced these events; -1 if unattributable.
    senderPos: number;
    events: NetInputEvent[];
    // The sender's own authoritative position this frame, if it included one.
    self?: NetSnapshotEntry;
    // Per-sender input ordering token. -1 means an older payload.
    inputSeq: number;
}

const TOKEN_SEP = ';';
const HEADER_SEP = '|';
// Dive power is quantized to integer per-mille so it stays deterministic across
// clients (no float formatting differences) and compact.
const POWER_SCALE = 1000;
const SPEED_SCALE = 100;

function encodeEvent(event: NetInputEvent): string {
    switch (event.kind) {
        case NetInputKind.Stroke:
            return Number.isFinite(event.heartRate)
                ? `s${event.side === 1 ? 1 : 0},${Math.round(Math.max(80, Math.min(180, event.heartRate!)) * 100)}`
                : `s${event.side === 1 ? 1 : 0}`;
        case NetInputKind.Kick:
        case NetInputKind.HeldOn:
        case NetInputKind.HeldOff:
            return `${event.kind}${event.side === 1 ? 1 : 0}`;
        case NetInputKind.DiveCharge:
            return NetInputKind.DiveCharge;
        case NetInputKind.DolphinJump:
            return NetInputKind.DolphinJump;
        case NetInputKind.StimulantPickup:
            return `${NetInputKind.StimulantPickup}${Math.max(0, Math.floor(event.itemId ?? 0))},${Math.max(0, Math.floor(event.collectorLane ?? 0))},${Math.max(0, Math.floor(event.revision ?? 0))}`;
        case NetInputKind.SharkKnockdown:
            return `${NetInputKind.SharkKnockdown}${Math.max(0, Math.floor(event.sharkSequence ?? 0))},${Math.max(0, Math.floor(event.targetLane ?? 0))},${Math.max(0, Math.round((event.knockedDistance ?? 0) * 100))}`;
        case NetInputKind.CannonLaunch:
            return `${NetInputKind.CannonLaunch}${Math.max(0, Math.floor(event.cannonStrikeId ?? 0))},${Math.max(0, Math.round((event.targetDistance ?? 0) * 100))},${Math.round((event.targetZ ?? 0) * 1000)},${Math.max(0, Math.round((event.warningSeconds ?? 0) * 1000))},${Math.max(0, Math.floor(event.revision ?? 0))}`;
        case NetInputKind.CannonImpact:
            return `${NetInputKind.CannonImpact}${Math.max(0, Math.floor(event.cannonStrikeId ?? 0))},${Math.max(0, Math.floor(event.hitMask ?? 0)).toString(16)},${Math.max(0, Math.floor((event.knockedLane ?? -1) + 1))},${Math.max(0, Math.round((event.knockedDistance ?? 0) * 100))},${Math.max(0, Math.floor(event.revision ?? 0))}`;
        case NetInputKind.MineRelayArm:
            return `${NetInputKind.MineRelayArm}${Math.max(0, Math.floor(event.mineRoundId ?? 0))},${Math.max(0, Math.floor(event.mineCarrierLane ?? 0))},${Math.max(0, Math.round((event.fuseSeconds ?? 0) * 1000))},${Math.max(0, Math.floor(event.revision ?? 0))}`;
        case NetInputKind.MineRelayTransfer:
            return `${NetInputKind.MineRelayTransfer}${Math.max(0, Math.floor(event.mineRoundId ?? 0))},${Math.max(0, Math.floor(event.mineFromLane ?? 0))},${Math.max(0, Math.floor(event.mineToLane ?? 0))},${Math.max(0, Math.round((event.remainingSeconds ?? 0) * 1000))},${Math.max(0, Math.floor(event.revision ?? 0))}`;
        case NetInputKind.MineRelayResolution:
            return `${NetInputKind.MineRelayResolution}${Math.max(0, Math.floor(event.mineRoundId ?? 0))},${Math.max(0, Math.floor(event.mineCarrierLane ?? 0))},${event.exploded ? 1 : 0},${Math.max(0, Math.round((event.mineDistance ?? 0) * 100))},${Math.round((event.mineLateral ?? 0) * 1000)},${Math.max(0, Math.floor(event.hitMask ?? 0)).toString(16)},${Math.max(0, Math.floor(event.revision ?? 0))}`;
        case NetInputKind.MinefieldImpact:
            return `${NetInputKind.MinefieldImpact}${Math.max(0, Math.floor(event.mineId ?? 0))},${Math.max(0, Math.floor(event.mineHitLane ?? 0))},${Math.max(0, Math.round((event.mineDistance ?? 0) * 100))},${Math.round((event.mineLateral ?? 0) * 1000)},${Math.max(0, Math.floor(event.hitMask ?? 0)).toString(16)},${Math.max(0, Math.floor(event.revision ?? 0))}`;
        case NetInputKind.LitterContact:
            return `${NetInputKind.LitterContact}${Math.max(0, Math.floor(event.litterSlotId ?? 0))},${Math.max(0, Math.floor(event.litterGeneration ?? 0))},${event.litterKind === 1 ? 1 : 0},${Math.max(0, Math.floor(event.litterLane ?? 0))},${event.litterAway === 1 ? 1 : 0},${Math.round((event.litterCourseX ?? 0) * 100)},${Math.round((event.litterLateral ?? 0) * 1000)},${Math.round((event.litterBounceAlong ?? 0) * 1000)},${Math.round((event.litterBounceLateral ?? 0) * 1000)},${Math.max(0, Math.floor(event.revision ?? 0))}`;
        case NetInputKind.EntertainmentKnockdown:
            return `${NetInputKind.EntertainmentKnockdown}${Math.max(0, Math.floor(event.recoveryLane ?? 0))},${Math.max(0, Math.floor(event.recoveryReason ?? 0))},${Math.max(0, Math.round((event.knockedDistance ?? 0) * 100))},${Math.max(0, Math.floor(event.revision ?? 0))}`;
        case NetInputKind.DiveRelease: {
            const power = Math.max(0, Math.min(POWER_SCALE, Math.round((event.power ?? 0) * POWER_SCALE)));
            if (Number.isFinite(event.launchSpeed) && (event.launchSpeed ?? -1) >= 0) {
                const launchSpeed = Math.max(0, Math.round((event.launchSpeed ?? 0) * SPEED_SCALE));
                return `${NetInputKind.DiveRelease}${power},${launchSpeed}`;
            }
            return `${NetInputKind.DiveRelease}${power}`;
        }
        default:
            return '';
    }
}

function decodeToken(token: string): NetInputEvent | null {
    if (!token) {
        return null;
    }
    const kind = token.charAt(0) as NetInputKind;
    switch (kind) {
        case NetInputKind.Stroke: {
            const value = Number(token.slice(3));
            const side = token.charAt(1) === '1' ? 1 : 0;
            return token.charAt(2) === ',' && Number.isFinite(value) && value >= 8000 && value <= 18000
                ? { kind, side, heartRate: value / 100 } : { kind, side };
        }
        case NetInputKind.Kick:
        case NetInputKind.HeldOn:
        case NetInputKind.HeldOff:
            return { kind, side: token.charAt(1) === '1' ? 1 : 0 };
        case NetInputKind.DiveCharge:
            return { kind };
        case NetInputKind.DolphinJump:
            return { kind };
        case NetInputKind.StimulantPickup: {
            const values = token.slice(1).split(',').map(value => parseInt(value, 10));
            return values.length === 3 && values.every(value => Number.isSafeInteger(value) && value >= 0)
                ? { kind, itemId: values[0], collectorLane: values[1], revision: values[2] }
                : null;
        }
        case NetInputKind.SharkKnockdown: {
            const values = token.slice(1).split(',').map(value => parseInt(value, 10));
            return values.length === 3 && values.every(value => Number.isSafeInteger(value) && value >= 0)
                ? { kind, sharkSequence: values[0], targetLane: values[1], knockedDistance: values[2] / 100 }
                : null;
        }
        case NetInputKind.CannonLaunch: {
            const values = token.slice(1).split(',').map(value => parseInt(value, 10));
            return values.length === 5
                && values.every(value => Number.isSafeInteger(value))
                && values[0] >= 0 && values[1] >= 0 && values[3] >= 0 && values[4] >= 0
                ? {
                    kind,
                    cannonStrikeId: values[0],
                    targetDistance: values[1] / 100,
                    targetZ: values[2] / 1000,
                    warningSeconds: values[3] / 1000,
                    revision: values[4],
                }
                : null;
        }
        case NetInputKind.CannonImpact: {
            const parts = token.slice(1).split(',');
            const strikeId = parseInt(parts[0], 10);
            const hitMask = parseInt(parts[1], 16);
            const knockedLanePlusOne = parseInt(parts[2], 10);
            const knockedDistanceCm = parseInt(parts[3], 10);
            const revision = parseInt(parts[4], 10);
            return parts.length === 5
                && [strikeId, hitMask, knockedLanePlusOne, knockedDistanceCm, revision]
                    .every(value => Number.isSafeInteger(value) && value >= 0)
                ? {
                    kind,
                    cannonStrikeId: strikeId,
                    hitMask,
                    knockedLane: knockedLanePlusOne - 1,
                    knockedDistance: knockedDistanceCm / 100,
                    revision,
                }
                : null;
        }
        case NetInputKind.MineRelayArm: {
            const values = token.slice(1).split(',').map(value => parseInt(value, 10));
            return values.length === 4 && values.every(value => Number.isSafeInteger(value) && value >= 0)
                ? { kind, mineRoundId: values[0], mineCarrierLane: values[1], fuseSeconds: values[2] / 1000, revision: values[3] }
                : null;
        }
        case NetInputKind.MineRelayTransfer: {
            const values = token.slice(1).split(',').map(value => parseInt(value, 10));
            return values.length === 5 && values.every(value => Number.isSafeInteger(value) && value >= 0)
                ? {
                    kind,
                    mineRoundId: values[0],
                    mineFromLane: values[1],
                    mineToLane: values[2],
                    remainingSeconds: values[3] / 1000,
                    revision: values[4],
                }
                : null;
        }
        case NetInputKind.MineRelayResolution: {
            const parts = token.slice(1).split(',');
            const values = parts.map((value, index) => parseInt(value, index === 5 ? 16 : 10));
            return values.length === 7
                && values.every(value => Number.isSafeInteger(value))
                && values[0] >= 0 && values[1] >= 0 && values[2] >= 0 && values[2] <= 1
                && values[3] >= 0 && values[5] >= 0 && values[6] >= 0
                ? {
                    kind,
                    mineRoundId: values[0],
                    mineCarrierLane: values[1],
                    exploded: values[2] === 1,
                    mineDistance: values[3] / 100,
                    mineLateral: values[4] / 1000,
                    hitMask: values[5],
                    revision: values[6],
                }
                : null;
        }
        case NetInputKind.MinefieldImpact: {
            const parts = token.slice(1).split(',');
            const values = parts.map((value, index) => parseInt(value, index === 4 ? 16 : 10));
            return values.length === 6
                && values.every(value => Number.isSafeInteger(value))
                && values[0] >= 0 && values[1] >= 0 && values[2] >= 0 && values[4] >= 0 && values[5] >= 0
                ? {
                    kind,
                    mineId: values[0],
                    mineHitLane: values[1],
                    mineDistance: values[2] / 100,
                    mineLateral: values[3] / 1000,
                    hitMask: values[4],
                    revision: values[5],
                }
                : null;
        }
        case NetInputKind.LitterContact: {
            const values = token.slice(1).split(',').map(value => parseInt(value, 10));
            return values.length === 10
                && values.every(Number.isSafeInteger)
                && values[0] >= 0 && values[1] >= 0 && values[2] >= 0 && values[2] <= 1
                && values[3] >= 0 && values[4] >= 0 && values[4] <= 1 && values[9] > 0
                ? {
                    kind,
                    litterSlotId: values[0],
                    litterGeneration: values[1],
                    litterKind: values[2],
                    litterLane: values[3],
                    litterAway: values[4] === 1 ? 1 : -1,
                    litterCourseX: values[5] / 100,
                    litterLateral: values[6] / 1000,
                    litterBounceAlong: values[7] / 1000,
                    litterBounceLateral: values[8] / 1000,
                    revision: values[9],
                }
                : null;
        }
        case NetInputKind.EntertainmentKnockdown: {
            const values = token.slice(1).split(',').map(value => parseInt(value, 10));
            return values.length === 4
                && values.every(value => Number.isSafeInteger(value) && value >= 0)
                && values[1] >= 1 && values[1] <= 4 && values[3] > 0
                ? {
                    kind,
                    recoveryLane: values[0],
                    recoveryReason: values[1],
                    knockedDistance: values[2] / 100,
                    revision: values[3],
                }
                : null;
        }
        case NetInputKind.DiveRelease: {
            const values = token.slice(1).split(',');
            const raw = parseInt(values[0], 10);
            const power = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw / POWER_SCALE)) : 0;
            const launchSpeedCms = values.length > 1 ? parseInt(values[1], 10) : -1;
            return Number.isFinite(launchSpeedCms) && launchSpeedCms >= 0
                ? { kind, power, launchSpeed: launchSpeedCms / SPEED_SCALE }
                : { kind, power };
        }
        default:
            return null;
    }
}

// Encode one client's events for one frame into its uploadFrame payload string. An
// optional self-position (the sender's own authoritative position) rides along on the
// reliable frame channel so remote copies catch up without best-effort broadcasts.
export function encodeInputFrame(
    senderPos: number,
    events: NetInputEvent[],
    self?: NetSnapshotEntry | null,
    ownerStateSeq = self?.ownerStateSeq ?? -1,
    inputSeq = -1,
): string {
    const body = events.map(encodeEvent).filter((token) => token.length > 0).join(TOKEN_SEP);
    let out = `${senderPos}${HEADER_SEP}${body}`;
    if (self) {
        out += `${HEADER_SEP}${self.lane},${Math.round(self.distance * 100)},${Math.round(self.lateral * 1000)},${self.finished ? 1 : 0},${Math.round(self.heading * 1000)},${Math.round(Math.max(0, self.speed) * 100)},${Math.max(0, Math.round(self.energy))},${Math.round(self.axialRoll * 1000)},${Math.round(self.axialRollVelocity * 1000)},${Math.round(self.headingVelocity * 1000)},${Math.round(self.collisionPitch * 1000)},${Math.round(self.collisionPitchVelocity * 1000)},${encodeConditionEnergyRatio(self.conditionEnergyRatio)},${encodeConditionHeartRate(self.conditionHeartRate)},${encodeOwnerStateSeq(ownerStateSeq)},${encodeCollisionSoftness(self.collisionSoftness)},${encodeCharacterAbility(self.abilityState)},${encodeConditionCooldown(self.calmSlushRemaining ?? -1)}`;
    } else if (inputSeq >= 0) {
        // Preserve the self slot so old decoders still see a valid empty field.
        out += HEADER_SEP;
    }
    if (inputSeq >= 0) {
        out += `${HEADER_SEP}${Math.floor(inputSeq)}`;
    }
    return out;
}

// Decode one uploadFrame payload (as delivered inside onSyncFrame.actionList).
export function decodeInputFrame(payload: string): DecodedInputFrame {
    if (typeof payload !== 'string' || payload.length === 0) {
        return { senderPos: -1, events: [], inputSeq: -1 };
    }
    // Format is "<pos>|<events>|<selfPos?>"; events never contain '|' (they use ';'), so
    // splitting on '|' is unambiguous.
    const parts = payload.split(HEADER_SEP);
    if (parts.length < 2) {
        return { senderPos: -1, events: [], inputSeq: -1 };
    }
    const senderPos = parseInt(parts[0], 10);
    const body = parts[1];
    const events: NetInputEvent[] = [];
    if (body.length > 0) {
        for (const token of body.split(TOKEN_SEP)) {
            const event = decodeToken(token);
            if (event) {
                events.push(event);
            }
        }
    }
    let self: NetSnapshotEntry | undefined;
    if (parts.length >= 3 && parts[2].length > 0) {
        const p = parts[2].split(',');
        if (p.length >= 4) {
            const lane = parseInt(p[0], 10);
            const distCm = parseInt(p[1], 10);
            const latMm = parseInt(p[2], 10);
            const fin = p[3] === '1';
            const headMrad = p.length > 4 ? parseInt(p[4], 10) : 0;
            if (Number.isFinite(lane) && Number.isFinite(distCm) && Number.isFinite(latMm)) {
                const speedCms = p.length > 5 ? parseInt(p[5], 10) : -1;
                const energy = p.length > 6 ? parseInt(p[6], 10) : -1;
                const rollMrad = p.length > 7 ? parseInt(p[7], 10) : 0;
                const rollVelMrad = p.length > 8 ? parseInt(p[8], 10) : 0;
                const headVelMrad = p.length > 9 ? parseInt(p[9], 10) : 0;
                const pitchMrad = p.length > 10 ? parseInt(p[10], 10) : 0;
                const pitchVelMrad = p.length > 11 ? parseInt(p[11], 10) : 0;
                const conditionEnergyPermille = p.length > 12 ? parseInt(p[12], 10) : -1;
                const conditionHeartRate = p.length > 13 ? parseInt(p[13], 10) : -1;
                const ownerStateSeq = p.length > 14 ? parseInt(p[14], 10) : -1;
                self = {
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
                    collisionSoftness: decodeCollisionSoftness(p[15]),
                abilityState: decodeCharacterAbility(p[16]),
                calmSlushRemaining: decodeConditionCooldown(p.length > 17 ? parseInt(p[17], 10) : -1),
                };
            }
        }
    }
    const inputSeq = parts.length > 3 ? parseInt(parts[3], 10) : -1;
    return {
        senderPos: Number.isFinite(senderPos) ? senderPos : -1,
        events,
        self,
        inputSeq: Number.isFinite(inputSeq) && inputSeq >= 0 ? Math.floor(inputSeq) : -1,
    };
}
