import type { CollisionSoftnessState } from '../swimmer/CollisionSoftnessModel';

// 放在现有快照尾部的单个字段；静止为 0，活动时四个量各量化到千分之一。
export function encodeCollisionSoftness(state?: Readonly<CollisionSoftnessState>): string {
    if (!state || !(state.side || state.forward || state.sideVelocity || state.forwardVelocity)) return '0';
    return `${quantize(state.side, 2)}:${quantize(state.forward, 2)}:${quantize(state.sideVelocity, 20)}:${quantize(state.forwardVelocity, 20)}`;
}

const IDLE: Readonly<CollisionSoftnessState> = Object.freeze({ side: 0, forward: 0, sideVelocity: 0, forwardVelocity: 0 });

export function decodeCollisionSoftness(token: string | undefined): Readonly<CollisionSoftnessState> {
    if (!token || token === '0') return IDLE;
    const fields = token.split(':');
    if (fields.length !== 4) return IDLE;
    const side = Number(fields[0]);
    const forward = Number(fields[1]);
    const sideVelocity = Number(fields[2]);
    const forwardVelocity = Number(fields[3]);
    if (!Number.isFinite(side) || !Number.isFinite(forward)
        || !Number.isFinite(sideVelocity) || !Number.isFinite(forwardVelocity)) return IDLE;
    return {
        side: quantize(side / 1000, 2) / 1000,
        forward: quantize(forward / 1000, 2) / 1000,
        sideVelocity: quantize(sideVelocity / 1000, 20) / 1000,
        forwardVelocity: quantize(forwardVelocity / 1000, 20) / 1000,
    };
}

function quantize(value: number, limit: number): number {
    return Number.isFinite(value) ? Math.round(Math.max(-limit, Math.min(limit, value)) * 1000) : 0;
}
