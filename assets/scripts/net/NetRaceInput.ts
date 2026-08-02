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
//   "<senderPos>|<token>;<token>;...|<selfPos>"
// where senderPos identifies which room member produced it (WeChat posNum), each token
// is one input event, and the optional trailing "<selfPos>" is the sender's OWN
// authoritative position "<lane>,<distCm>,<latMm>,<fin>,<headMrad>". Positions ride the
// RELIABLE lock-step frame channel (not best-effort broadcasts, which drop intermittently
// and froze remote swimmers), so every client's copy of every human catches up reliably.
// An empty event list is "<senderPos>|" (optionally "<senderPos>||<selfPos>").

import type { NetSnapshotEntry } from './NetRaceSnapshot';

// Side of a stroke/kick. 0 = LEFT, 1 = RIGHT (kept numeric so the codec doesn't
// depend on the game's StrokeType enum; the controller maps between them).
export type NetInputSide = 0 | 1;

export const enum NetInputKind {
    Stroke = 's',      // arm stroke (recordStroke)
    Kick = 'k',        // leg kick (recordKickTap)
    HeldOn = 'h',      // stroke-held begin
    HeldOff = 'H',     // stroke-held end
    DiveCharge = 'c',  // dive charge start (countdown/diving)
    DiveRelease = 'r', // dive release (carries charge power)
    DolphinJump = 'd', // dolphin jump trigger (both-hands gesture)
}

export interface NetInputEvent {
    kind: NetInputKind;
    // Present for Stroke / Kick / HeldOn / HeldOff.
    side?: NetInputSide;
    // Present for DiveRelease: the 0..1 charge power at release.
    power?: number;
}

export interface DecodedInputFrame {
    // Room member (posNum) that produced these events; -1 if unattributable.
    senderPos: number;
    events: NetInputEvent[];
    // The sender's own authoritative position this frame, if it included one.
    self?: NetSnapshotEntry;
}

const TOKEN_SEP = ';';
const HEADER_SEP = '|';
// Dive power is quantized to integer per-mille so it stays deterministic across
// clients (no float formatting differences) and compact.
const POWER_SCALE = 1000;

function encodeEvent(event: NetInputEvent): string {
    switch (event.kind) {
        case NetInputKind.Stroke:
        case NetInputKind.Kick:
        case NetInputKind.HeldOn:
        case NetInputKind.HeldOff:
            return `${event.kind}${event.side === 1 ? 1 : 0}`;
        case NetInputKind.DiveCharge:
            return NetInputKind.DiveCharge;
        case NetInputKind.DolphinJump:
            return NetInputKind.DolphinJump;
        case NetInputKind.DiveRelease: {
            const power = Math.max(0, Math.min(POWER_SCALE, Math.round((event.power ?? 0) * POWER_SCALE)));
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
        case NetInputKind.DolphinJump:
            return { kind };
        case NetInputKind.DiveRelease: {
            const raw = parseInt(token.slice(1), 10);
            const power = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw / POWER_SCALE)) : 0;
            return { kind, power };
        }
        default:
            return null;
    }
}

// Encode one client's events for one frame into its uploadFrame payload string. An
// optional self-position (the sender's own authoritative position) rides along on the
// reliable frame channel so remote copies catch up without best-effort broadcasts.
export function encodeInputFrame(senderPos: number, events: NetInputEvent[], self?: NetSnapshotEntry | null): string {
    const body = events.map(encodeEvent).filter((token) => token.length > 0).join(TOKEN_SEP);
    let out = `${senderPos}${HEADER_SEP}${body}`;
    if (self) {
        out += `${HEADER_SEP}${self.lane},${Math.round(self.distance * 100)},${Math.round(self.lateral * 1000)},${self.finished ? 1 : 0},${Math.round(self.heading * 1000)},${Math.round(Math.max(0, self.speed) * 100)}`;
    }
    return out;
}

// Decode one uploadFrame payload (as delivered inside onSyncFrame.actionList).
export function decodeInputFrame(payload: string): DecodedInputFrame {
    if (typeof payload !== 'string' || payload.length === 0) {
        return { senderPos: -1, events: [] };
    }
    // Format is "<pos>|<events>|<selfPos?>"; events never contain '|' (they use ';'), so
    // splitting on '|' is unambiguous.
    const parts = payload.split(HEADER_SEP);
    if (parts.length < 2) {
        return { senderPos: -1, events: [] };
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
                self = {
                    lane,
                    distance: distCm / 100,
                    lateral: latMm / 1000,
                    finished: fin,
                    heading: Number.isFinite(headMrad) ? headMrad / 1000 : 0,
                    speed: Number.isFinite(speedCms) && speedCms >= 0 ? speedCms / 100 : -1,
                    energy: -1,
                };
            }
        }
    }
    return { senderPos: Number.isFinite(senderPos) ? senderPos : -1, events, self };
}
