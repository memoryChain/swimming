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
// authoritative state "<lane>,<distCm>,<latMm>,<fin>,<headMrad>,<speedCms>,<energy>,<rollMrad>,<rollVelMrad>,<headVelMrad>,<pitchMrad>,<pitchVelMrad>,<conditionEnergyPermille>,<conditionHeartRate>,<ownerStateSeq>,<sprintActive>".
// Position, pose speed, outcome-affecting ultimate energy, and condition state ride the
// RELIABLE lock-step frame channel (not best-effort broadcasts, which drop intermittently),
// so every client's copy of every human catches up to its owner reliably.
// An empty event list is "<senderPos>|" (optionally "<senderPos>||<selfPos>").

import {
    decodeConditionEnergyRatio,
    decodeConditionHeartRate,
    encodeConditionEnergyRatio,
    encodeConditionHeartRate,
    encodeOwnerStateSeq,
    decodeOwnerStateSeq,
    type NetSnapshotEntry,
} from './NetRaceSnapshot';
import type {
    DolphinJumpStartState,
    DolphinRagdollCarrySnapshot,
} from '../core/DolphinJumpConfig';

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
    DolphinJump = 'd', // owner-accepted dolphin ability; optional suffix 1 = deep-dive form
    AiDolphinJump = 'a', // host-accepted AI dolphin ability with stable action seq + launch state
    CollisionRagdoll = 'g', // authority-only loose-limb visual edge; stable seq + redundant age
}

export interface NetInputEvent {
    kind: NetInputKind;
    // Present for Stroke / Kick / HeldOn / HeldOff.
    side?: NetInputSide;
    // Present for DiveRelease: the final normalized 0..1 dive power.
    power?: number;
    // Present for newer DiveRelease payloads: the owner's final progression-adjusted
    // launch speed in m/s. Optional so older payloads keep decoding correctly.
    launchSpeed?: number;
    // DolphinJump / AiDolphinJump: true selects the underwater inverse arc.
    dolphinDive?: boolean;
    // DolphinJump only: compact fallback for the inherited loose-limb pose. The
    // ordinary CollisionRagdoll edge remains independently repeated, but this
    // snapshot makes the accepted action visually self-contained under packet loss.
    dolphinRagdoll?: DolphinRagdollCarrySnapshot;
    // AiDolphinJump only: stable assigned race lane of the host-authoritative AI.
    aiLane?: number;
    // AiDolphinJump only: per-host, per-lane monotonic action identity. Every
    // redundant transmission of one action carries the same value.
    aiActionSeq?: number;
    // AiDolphinJump only: authoritative launch edge used for deterministic replay.
    aiStart?: DolphinJumpStartState;
    // CollisionRagdoll only. The owner sends human lanes; the active host sends
    // genuine AI lanes. Repeated packets keep the same action sequence.
    ragdollLane?: number;
    ragdollActionSeq?: number;
    ragdollStrength?: number;
    ragdollSignBits?: number;
    ragdollPhase?: number;
    ragdollAgeTicks?: number;
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
const RAGDOLL_STRENGTH_SCALE = 255;
const RAGDOLL_PHASE_SCALE = 255;
const RAGDOLL_MAX_AGE_TICKS = 24;
const RAGDOLL_AGE_TICK_SECONDS = 33 / 1000;
const TAU = Math.PI * 2;

function encodeEvent(event: NetInputEvent): string {
    switch (event.kind) {
        case NetInputKind.Stroke:
        case NetInputKind.Kick:
        case NetInputKind.HeldOn:
        case NetInputKind.HeldOff:
            return `${event.kind}${event.side === 1 ? 1 : 0}`;
        case NetInputKind.DiveCharge:
            return NetInputKind.DiveCharge;
        case NetInputKind.DolphinJump: {
            const mode = event.dolphinDive ? 1 : 0;
            const ragdoll = event.dolphinRagdoll;
            if (!ragdoll || !Number.isFinite(ragdoll.strength) || ragdoll.strength <= 0) {
                return mode === 1 ? `${NetInputKind.DolphinJump}1` : NetInputKind.DolphinJump;
            }
            const strength = Math.max(0, Math.min(
                RAGDOLL_STRENGTH_SCALE,
                Math.round(ragdoll.strength * RAGDOLL_STRENGTH_SCALE),
            ));
            const signBits = (ragdoll.rollSign >= 0 ? 1 : 0)
                | (ragdoll.pitchSign >= 0 ? 2 : 0);
            const phase = positiveModulo(ragdoll.phase, TAU);
            const phaseByte = Math.max(0, Math.min(
                RAGDOLL_PHASE_SCALE,
                Math.round(phase / TAU * RAGDOLL_PHASE_SCALE),
            ));
            const ageSeconds = Number.isFinite(ragdoll.ageSeconds)
                ? Math.max(0, ragdoll.ageSeconds)
                : 0;
            const ageTicks = Math.max(0, Math.min(
                RAGDOLL_MAX_AGE_TICKS,
                Math.round(ageSeconds / RAGDOLL_AGE_TICK_SECONDS),
            ));
            return `${NetInputKind.DolphinJump}${mode},${strength},${signBits},${phaseByte},${ageTicks}`;
        }
        case NetInputKind.AiDolphinJump: {
            const lane = Math.max(0, Math.floor(event.aiLane ?? 0));
            const actionSeq = Math.floor(event.aiActionSeq ?? -1);
            const start = event.aiStart;
            if (actionSeq < 0 || !start) {
                // Kept parse-compatible for old payload construction, but protocol 7
                // senders always provide the stable identity and authoritative edge.
                return `${NetInputKind.AiDolphinJump}${lane},${event.dolphinDive ? 1 : 0}`;
            }
            return `${NetInputKind.AiDolphinJump}${lane},${event.dolphinDive ? 1 : 0},${actionSeq}`
                + `,${Math.round(start.distance * 100)},${Math.round(start.lateral * 1000)}`
                + `,${Math.round(start.heading * 1000)},${Math.round(start.headingVelocity * 1000)}`
                + `,${Math.round(Math.max(0, start.speed) * 100)}`
                + `,${Math.round(start.axialRoll * 1000)},${Math.round(start.axialRollVelocity * 1000)}`
                + `,${Math.round(start.collisionPitch * 1000)},${Math.round(start.collisionPitchVelocity * 1000)}`
                + `,${Math.round(start.knockbackDistance * 1000)},${Math.round(start.knockbackLateral * 1000)}`;
        }
        case NetInputKind.CollisionRagdoll: {
            const lane = Math.max(0, Math.floor(event.ragdollLane ?? 0));
            const actionSeq = Math.floor(event.ragdollActionSeq ?? -1);
            if (actionSeq < 0) {
                return '';
            }
            const strength = Math.max(0, Math.min(
                RAGDOLL_STRENGTH_SCALE,
                Math.round((event.ragdollStrength ?? 0) * RAGDOLL_STRENGTH_SCALE),
            ));
            const signBits = Math.max(0, Math.min(3, Math.floor(event.ragdollSignBits ?? 0)));
            const phase = positiveModulo(event.ragdollPhase ?? 0, TAU);
            const phaseByte = Math.max(0, Math.min(
                RAGDOLL_PHASE_SCALE,
                Math.round(phase / TAU * RAGDOLL_PHASE_SCALE),
            ));
            const ageTicks = Math.max(0, Math.min(
                RAGDOLL_MAX_AGE_TICKS,
                Math.floor(event.ragdollAgeTicks ?? 0),
            ));
            return `${NetInputKind.CollisionRagdoll}${lane},${actionSeq},${strength},${signBits},${phaseByte},${ageTicks}`;
        }
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
        case NetInputKind.Stroke:
        case NetInputKind.Kick:
        case NetInputKind.HeldOn:
        case NetInputKind.HeldOff:
            return { kind, side: token.charAt(1) === '1' ? 1 : 0 };
        case NetInputKind.DiveCharge:
            return { kind };
        case NetInputKind.DolphinJump: {
            const values = token.slice(1).split(',');
            const event: NetInputEvent = { kind, dolphinDive: values[0] === '1' };
            if (values.length < 5) {
                return event;
            }
            const raw = values.slice(1, 5).map((value) => parseInt(value, 10));
            // Visual metadata must never veto an already accepted gameplay action.
            // A malformed suffix falls back to the legacy jump/dive token.
            if (raw.some((value) => !Number.isFinite(value)) || raw[0] <= 0) {
                return event;
            }
            const signBits = Math.max(0, Math.min(3, Math.floor(raw[1])));
            event.dolphinRagdoll = {
                strength: Math.max(0, Math.min(1, raw[0] / RAGDOLL_STRENGTH_SCALE)),
                rollSign: (signBits & 1) !== 0 ? 1 : -1,
                pitchSign: (signBits & 2) !== 0 ? 1 : -1,
                phase: Math.max(0, Math.min(RAGDOLL_PHASE_SCALE, raw[2]))
                    / RAGDOLL_PHASE_SCALE * TAU,
                ageSeconds: Math.max(0, Math.min(RAGDOLL_MAX_AGE_TICKS, raw[3]))
                    * RAGDOLL_AGE_TICK_SECONDS,
            };
            return event;
        }
        case NetInputKind.AiDolphinJump: {
            const values = token.slice(1).split(',');
            const lane = parseInt(values[0], 10);
            if (!Number.isFinite(lane) || lane < 0) {
                return null;
            }
            // Legacy a<lane>,<mode> remains decodable, but protocol-gated gameplay
            // ignores it because it has no stable action identity.
            if (values.length < 14) {
                return { kind, aiLane: lane, dolphinDive: values[1] === '1' };
            }
            const raw = values.slice(2, 14).map((value) => parseInt(value, 10));
            if (raw.some((value) => !Number.isFinite(value)) || raw[0] < 0) {
                return null;
            }
            return {
                kind,
                aiLane: lane,
                dolphinDive: values[1] === '1',
                aiActionSeq: Math.floor(raw[0]),
                aiStart: {
                    distance: raw[1] / 100,
                    lateral: raw[2] / 1000,
                    heading: raw[3] / 1000,
                    headingVelocity: raw[4] / 1000,
                    speed: Math.max(0, raw[5] / 100),
                    axialRoll: raw[6] / 1000,
                    axialRollVelocity: raw[7] / 1000,
                    collisionPitch: raw[8] / 1000,
                    collisionPitchVelocity: raw[9] / 1000,
                    knockbackDistance: raw[10] / 1000,
                    knockbackLateral: raw[11] / 1000,
                },
            };
        }
        case NetInputKind.CollisionRagdoll: {
            const values = token.slice(1).split(',').map((value) => parseInt(value, 10));
            if (values.length < 6
                || values.some((value) => !Number.isFinite(value))
                || values[0] < 0
                || values[1] < 0) {
                return null;
            }
            return {
                kind,
                ragdollLane: Math.floor(values[0]),
                ragdollActionSeq: Math.floor(values[1]),
                ragdollStrength: Math.max(0, Math.min(1, values[2] / RAGDOLL_STRENGTH_SCALE)),
                ragdollSignBits: Math.max(0, Math.min(3, Math.floor(values[3]))),
                ragdollPhase: Math.max(0, Math.min(RAGDOLL_PHASE_SCALE, values[4]))
                    / RAGDOLL_PHASE_SCALE * TAU,
                ragdollAgeTicks: Math.max(0, Math.min(RAGDOLL_MAX_AGE_TICKS, Math.floor(values[5]))),
            };
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

function positiveModulo(value: number, divisor: number): number {
    const finiteValue = Number.isFinite(value) ? value : 0;
    const remainder = finiteValue % divisor;
    return remainder < 0 ? remainder + divisor : remainder;
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
        out += `${HEADER_SEP}${self.lane},${Math.round(self.distance * 100)},${Math.round(self.lateral * 1000)},${self.finished ? 1 : 0},${Math.round(self.heading * 1000)},${Math.round(Math.max(0, self.speed) * 100)},${Math.max(0, Math.round(self.energy))},${Math.round(self.axialRoll * 1000)},${Math.round(self.axialRollVelocity * 1000)},${Math.round(self.headingVelocity * 1000)},${Math.round(self.collisionPitch * 1000)},${Math.round(self.collisionPitchVelocity * 1000)},${encodeConditionEnergyRatio(self.conditionEnergyRatio)},${encodeConditionHeartRate(self.conditionHeartRate)},${encodeOwnerStateSeq(ownerStateSeq)},${self.sprintActive ? 1 : 0}`;
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
                const sprintActive = p.length > 15 && p[15] === '1';
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
                    sprintActive,
                    ownerStateSeq: decodeOwnerStateSeq(ownerStateSeq),
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
