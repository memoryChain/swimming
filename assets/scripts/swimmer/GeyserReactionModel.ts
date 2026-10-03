import { GEYSER_TUNING, type GeyserTuning } from '../entertainment/GeyserBrawlRules';
import type { GeyserContact } from './GeyserBodyContact';

export type GeyserReactionStart = Readonly<{
    hitId: number; strength: 1 | 2; duration: number;
    pitch: number; roll: number; pitchVelocity: number; rollVelocity: number;
    along: number; side: number; up: number;
}>;
export type GeyserReactionSample = { pitch: number; roll: number; weight: number; forward: number; side: number };
const RAD = Math.PI / 180;
const clamp = (v: number, limit: number) => Math.max(-limit, Math.min(limit, v));
export function blendGeyserAngle(base: number, target: number, weight: number): number {
    return weight <= 0 ? base : base + Math.atan2(Math.sin(target - base), Math.cos(target - base)) * weight;
}

/** 接触时保存姿态与有限冲量，后续只按年龄采样，不重复施力。 */
export function createGeyserReaction(hitId: number, strength: 1 | 2, duration: number,
    pitch: number, roll: number, pitchVelocity: number, rollVelocity: number,
    contact?: GeyserContact, tuning: GeyserTuning = GEYSER_TUNING): GeyserReactionStart {
    const along = contact?.along ?? 0, side = contact?.side ?? 0;
    const gain = strength === 1 ? .4 : 1;
    return { hitId, strength, duration, pitch: Math.atan2(Math.sin(pitch), Math.cos(pitch)),
        roll: Math.atan2(Math.sin(roll), Math.cos(roll)),
        pitchVelocity: clamp(pitchVelocity * .25 + clamp(along / .65, 1) * tuning.pitchImpulseMaxDegPerSec * RAD * gain, 4),
        // local +Z 受向上力产生负 X 转矩。
        rollVelocity: clamp(rollVelocity * .25 - clamp(side / .2, 1) * tuning.rollImpulseMaxDegPerSec * RAD * gain, 4),
        along, side, up: contact?.up ?? 0 };
}

export function sampleGeyserReaction(start: GeyserReactionStart, age: number,
    out: GeyserReactionSample, tuning: GeyserTuning = GEYSER_TUNING): GeyserReactionSample {
    const time = Math.max(0, age), activeAge = Math.min(time, start.duration);
    const damping = Math.max(.1, tuning.rotationDamping);
    const integral = (1 - Math.exp(-damping * activeAge)) / damping;
    const settle = Math.max(.01, tuning.landingSettleSeconds);
    const u = Math.max(0, Math.min(1, (time - start.duration) / settle));
    const weight = 1 - u * u * (3 - 2 * u);
    const pitchLimit = (start.strength === 1 ? tuning.grazeTiltMaxDegrees : tuning.pitchMaxDegrees) * RAD;
    const rollLimit = (start.strength === 1 ? tuning.grazeTiltMaxDegrees : tuning.rollMaxDegrees) * RAD;
    out.pitch = start.pitch + clamp(start.pitchVelocity * integral, pitchLimit);
    out.roll = start.roll + clamp(start.rollVelocity * integral, rollLimit);
    out.weight = weight;
    // 延后启动的轻量肢体惯性，复用现有关节约束叠加，不写马达碰撞状态。
    const lag = Math.sin(Math.min(1, time / .16) * Math.PI * .5) * Math.exp(-time * 2.5) * weight;
    out.forward = -start.pitchVelocity * .035 * lag;
    out.side = start.rollVelocity * .035 * lag;
    return out;
}
