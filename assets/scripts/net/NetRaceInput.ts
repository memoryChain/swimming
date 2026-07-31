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
//   "<senderPos>|<token>;<token>;..."
// where senderPos identifies which room member produced it (WeChat posNum), and each
// token is one input event. An empty event list is "<senderPos>|".

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
        case NetInputKind.DiveRelease: {
            const raw = parseInt(token.slice(1), 10);
            const power = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw / POWER_SCALE)) : 0;
            return { kind, power };
        }
        default:
            return null;
    }
}

// Encode one client's events for one frame into its uploadFrame payload string.
export function encodeInputFrame(senderPos: number, events: NetInputEvent[]): string {
    const body = events.map(encodeEvent).filter((token) => token.length > 0).join(TOKEN_SEP);
    return `${senderPos}${HEADER_SEP}${body}`;
}

// Decode one uploadFrame payload (as delivered inside onSyncFrame.actionList).
export function decodeInputFrame(payload: string): DecodedInputFrame {
    if (typeof payload !== 'string' || payload.length === 0) {
        return { senderPos: -1, events: [] };
    }
    const headerEnd = payload.indexOf(HEADER_SEP);
    if (headerEnd < 0) {
        return { senderPos: -1, events: [] };
    }
    const senderPos = parseInt(payload.slice(0, headerEnd), 10);
    const body = payload.slice(headerEnd + 1);
    const events: NetInputEvent[] = [];
    if (body.length > 0) {
        for (const token of body.split(TOKEN_SEP)) {
            const event = decodeToken(token);
            if (event) {
                events.push(event);
            }
        }
    }
    return { senderPos: Number.isFinite(senderPos) ? senderPos : -1, events };
}
