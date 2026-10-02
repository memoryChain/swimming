import type { GeyserReactionSnapshot } from '../swimmer/GeyserReactionModel';

/** 可靠命中与 GY 共用；角度/位置千分之一量化，轻擦和余摆可脱离飞行存在。 */
export function encodeGeyserReaction(state: GeyserReactionSnapshot): string {
    const s = state.start;
    return [s.hitId, s.strength, s.duration * 1000, s.pitch * 1000, s.roll * 1000,
        s.pitchVelocity * 1000, s.rollVelocity * 1000, s.along * 1000,
        s.side * 1000, s.up * 1000, state.age * 1000]
        .map(v => Math.round(v).toString(36)).join('.');
}
export function decodeGeyserReaction(value: string): GeyserReactionSnapshot | null {
    if (!/^[0-9a-z.-]+$/.test(value) || value.length > 130) return null;
    const v = value.split('.');
    if (v.length !== 11 || v.some(s => !/^-?[0-9a-z]+$/.test(s))) return null;
    const n = v.map(s => parseInt(s, 36));
    if (!n.every(Number.isSafeInteger)) return null;
    const [hitId, strength, duration, pitch, roll, pv, rv, along, side, up, age] = n;
    if (hitId < 1000 || hitId > 1000000999 || (strength !== 1 && strength !== 2)
        || duration < 100 || duration > 5000 || Math.abs(pitch) > 100000 || Math.abs(roll) > 100000
        || Math.abs(pv) > 4000 || Math.abs(rv) > 4000 || Math.abs(along) > 3000
        || Math.abs(side) > 3000 || Math.abs(up) > 3000 || age < 0 || age > duration + 2000) return null;
    return { start: { hitId, strength, duration: duration / 1000, pitch: pitch / 1000,
        roll: roll / 1000, pitchVelocity: pv / 1000, rollVelocity: rv / 1000,
        along: along / 1000, side: side / 1000, up: up / 1000 }, age: age / 1000 };
}
