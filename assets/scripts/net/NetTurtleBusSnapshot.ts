import type { TurtleBusDirection, TurtleBusPhase } from '../core/TurtleBusRules';

/** 房主权威四圈账本，乘客编号使用固定泳道，不使用各端不同的数组下标。 */
export type NetTurtleBusState = Readonly<{
    tripId: number;
    phase: TurtleBusPhase;
    age: number;
    direction: TurtleBusDirection;
    routeZ: number;
    startOffset: number;
    occupants: readonly number[];
    hands: readonly number[];
}>;

const PHASES: readonly TurtleBusPhase[] = [
    'idle', 'preview', 'boarding', 'accelerating', 'cruising',
    'unloading', 'submerging', 'done',
];
const ROUTES = [-4, 0, 4] as const;

export function encodeTurtleBusSnapshot(state: NetTurtleBusState | null | undefined): string {
    if (!state || state.tripId <= 0) return '';
    const phase = PHASES.indexOf(state.phase);
    const route = ROUTES.indexOf(state.routeZ as typeof ROUTES[number]);
    if (phase < 0 || route < 0 || !Number.isFinite(state.startOffset)
        || state.startOffset < 10 || state.startOffset > 30
        || state.occupants.length !== 4 || state.hands.length !== 4) return '';
    let occupants = 0;
    let hands = 0;
    let used = 0;
    for (let ring = 0; ring < 4; ring++) {
        const lane = state.occupants[ring];
        const grip = state.hands[ring];
        if (!Number.isInteger(lane) || lane < -1 || lane > 7
            || !Number.isInteger(grip) || grip < 0 || grip > 3
            || (lane < 0 && grip !== 0) || (lane >= 0 && grip === 0)
            || (lane >= 0 && (used & (1 << lane)) !== 0)) return '';
        if (lane >= 0) used |= 1 << lane;
        occupants |= (lane + 1) << (ring * 4);
        hands |= grip << (ring * 2);
    }
    return `^${Math.floor(state.tripId).toString(36)}.${phase.toString(36)}.${Math.round(state.age * 100).toString(36)}.${state.direction > 0 ? 1 : 0}.${route}.${Math.round(state.startOffset * 10).toString(36)}.${occupants.toString(36)}.${hands.toString(36)}`;
}

export function decodeTurtleBusSnapshot(payload: string): NetTurtleBusState | null {
    if (!/^\^[0-9a-z]+(?:\.[0-9a-z]+){7}$/.test(payload)) return null;
    const values = payload.slice(1).split('.').map(part => parseInt(part, 36));
    const [tripId, phase, ageCentis, direction, route, offsetDecis, packedOccupants, packedHands] = values;
    if (!values.every(Number.isSafeInteger) || tripId <= 0 || phase < 0 || phase >= PHASES.length
        || ageCentis < 0 || ageCentis > 6000 || direction > 1 || route >= ROUTES.length
        || offsetDecis < 100 || offsetDecis > 300
        || packedOccupants > 0xffff || packedHands > 0xff) return null;
    const occupants: number[] = [];
    const hands: number[] = [];
    let used = 0;
    for (let ring = 0; ring < 4; ring++) {
        const lane = ((packedOccupants >>> (ring * 4)) & 15) - 1;
        const grip = (packedHands >>> (ring * 2)) & 3;
        if (lane > 7 || (lane < 0 && grip !== 0) || (lane >= 0 && grip === 0)
            || (lane >= 0 && (used & (1 << lane)) !== 0)) return null;
        if (lane >= 0) used |= 1 << lane;
        occupants.push(lane);
        hands.push(grip);
    }
    return { tripId, phase: PHASES[phase], age: ageCentis / 100,
        direction: direction ? 1 : -1, routeZ: ROUTES[route], startOffset: offsetDecis / 10,
        occupants, hands };
}

export type NetTurtleBusPacket = Readonly<{
    hostPos: number;
    sequence: number;
    state: NetTurtleBusState;
}>;

/** 独立 TB| 状态包守住原 S| 满载 1536 字节上限；房间身份仍由外层前缀隔离。 */
export function encodeTurtleBusPacket(hostPos: number, sequence: number,
    state: NetTurtleBusState): string {
    const body = encodeTurtleBusSnapshot(state);
    if (!body || !Number.isInteger(hostPos) || hostPos < 0 || hostPos > 7
        || !Number.isSafeInteger(sequence) || sequence < 0) return '';
    return `TB|${hostPos},${sequence.toString(36)}${body}`;
}

export function decodeTurtleBusPacket(payload: string): NetTurtleBusPacket | null {
    if (typeof payload !== 'string' || !payload.startsWith('TB|')) return null;
    const marker = payload.indexOf('^', 3);
    if (marker < 0) return null;
    const head = payload.slice(3, marker);
    if (!/^[0-7],[0-9a-z]+$/.test(head)) return null;
    const comma = head.indexOf(',');
    const hostPos = parseInt(head.slice(0, comma), 10);
    const sequence = parseInt(head.slice(comma + 1), 36);
    const state = decodeTurtleBusSnapshot(payload.slice(marker));
    return Number.isSafeInteger(sequence) && state
        ? { hostPos, sequence, state } : null;
}
