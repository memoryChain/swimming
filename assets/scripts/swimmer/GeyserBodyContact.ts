import { geyserBurstHeight, geyserJetTop, geyserRadiusScale, type GeyserVent,
    type GeyserTuning, GEYSER_TUNING } from '../core/GeyserBrawlRules';

/** 标准化泳者的髋部坐标系，前为 +X，右为 +Z；不读取渲染插值或镜头旋转。 */
export type GeyserBodyPose = {
    x: number; y: number; z: number; yaw: number; pitch: number; roll: number;
    scale: number; leftArm: number; rightArm: number;
};
export type GeyserContact = {
    strength: 0 | 1 | 2; along: number; side: number; up: number;
    coverage: number; time: number; region: number;
};
export function emptyGeyserContact(): GeyserContact {
    return { strength: 0, along: 0, side: 0, up: 0, coverage: 0, time: 0, region: 0 };
}
export function emptyGeyserBodyPose(): GeyserBodyPose {
    return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, scale: 1, leftArm: 0, rightArm: 0 };
}
// 三个相接的主要区域，每区三个球组成胶囊近似；手与足尖只能触发擦边。
const ALONG = [0.34, 0.54, 0.74, -0.2, 0, 0.2, -0.9, -0.66, -0.42, 0, 0, -1.1, -1.1];
const RADII = [.18, .19, .17, .2, .21, .2, .13, .16, .18, .085, .085, .075, .075];
const SIDES = [0, 0, 0, 0, 0, 0, 0, 0, 0, -.3, .3, -.13, .13];
export const GEYSER_BODY_REACH = 1.4;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 转向时身体横向投影，供 AI 和安全路线共用；不重复加旧躯干半径。 */
export function geyserBodyClearance(heading: number, scale = 1): number {
    return .22 * scale + Math.abs(Math.sin(heading)) * GEYSER_BODY_REACH * scale;
}

/** 有界时空扫掠：每 1/240 秒采样，长帧最多 256 段；输出复用对象。 */
export function sampleGeyserBodyContact(vent: GeyserVent, pulse: number,
    previous: GeyserBodyPose, current: GeyserBodyPose, fromAge: number, toAge: number,
    overlapStart: number, overlapEnd: number, swimY: number, waterY: number,
    out: GeyserContact, tuning: GeyserTuning = GEYSER_TUNING): GeyserContact {
    out.strength = 0; out.coverage = 0;
    if (overlapEnd <= overlapStart || toAge <= fromAge) return out;
    const span = Math.max(1e-6, toAge - fromAge);
    const teleport = Math.hypot(current.x - previous.x, current.z - previous.z) > 4;
    const radiusScale = geyserRadiusScale(vent, tuning);
    const core = Math.max(.05, tuning.coreRadius * radiusScale - .2);
    const edge = Math.max(core, tuning.edgeRadius * radiusScale - .2);
    const reach = GEYSER_BODY_REACH * Math.max(previous.scale, current.scale) + edge;
    if (Math.min(previous.x, current.x) - reach > vent.x || Math.max(previous.x, current.x) + reach < vent.x
        || Math.min(previous.z, current.z) - reach > vent.z || Math.max(previous.z, current.z) + reach < vent.z) return out;
    const steps = Math.min(256, Math.max(1, Math.ceil((overlapEnd - overlapStart) * 240)));
    let edgeFound = false;
    for (let step = 0; step <= steps; step++) {
        const time = overlapStart + (overlapEnd - overlapStart) * step / steps;
        const t = teleport ? 1 : clamp((time - fromAge) / span, 0, 1);
        const x = previous.x + (current.x - previous.x) * t;
        const y = previous.y + (current.y - previous.y) * t;
        const z = previous.z + (current.z - previous.z) * t;
        const yaw = previous.yaw + Math.atan2(Math.sin(current.yaw - previous.yaw), Math.cos(current.yaw - previous.yaw)) * t;
        const pitch = previous.pitch + Math.atan2(Math.sin(current.pitch - previous.pitch), Math.cos(current.pitch - previous.pitch)) * t;
        const roll = previous.roll + Math.atan2(Math.sin(current.roll - previous.roll), Math.cos(current.roll - previous.roll)) * t;
        const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
        const cr = Math.cos(roll), sr = Math.sin(roll);
        const scale = current.scale;
        const top = geyserJetTop(vent, geyserBurstHeight(vent, pulse, time, tuning), swimY, waterY, tuning);
        let total = 0, alongSum = 0, sideSum = 0, upSum = 0, region = 0, strongest = 0;
        for (let point = 0; point < ALONG.length; point++) {
            let along = ALONG[point] * scale, side = SIDES[point] * scale;
            if (point === 9 || point === 10) {
                const arm = point === 9 ? current.leftArm : current.rightArm;
                along = (.35 + .67 * Math.cos(arm * Math.PI * 2)) * scale;
                side *= 1 + .55 * Math.sin(arm * Math.PI * 2) ** 2;
            }
            const lx = cp * along + sp * sr * side;
            const ly = sp * along - cp * sr * side;
            const lz = cr * side;
            const px = x + cy * lx - sy * lz, pz = z + sy * lx + cy * lz, py = y + ly;
            const bodyRadius = RADII[point] * scale;
            if (py - bodyRadius > top || py + bodyRadius < swimY - 1.4) continue;
            const distance = Math.hypot(px - vent.x, pz - vent.z);
            if (distance > edge + bodyRadius) continue;
            // 接触点位于球的迎水侧，提供连续的左右偏心，正中覆盖自然抵消。
            const vx = vent.x - px, vz = vent.z - pz;
            const offset = distance > 1e-5 ? Math.min(bodyRadius, distance) / distance : 0;
            const contactAlong = along + (vx * cy + vz * sy) * offset * cp;
            const contactSide = side + (-vx * sy + vz * cy) * offset * cr;
            if (!edgeFound) {
                edgeFound = true; out.strength = 1; out.along = contactAlong;
                out.side = contactSide; out.up = ly; out.time = time; out.region = point < 9 ? Math.floor(point / 3) : 3;
            }
            if (point >= 9 || distance > core + bodyRadius) continue;
            const weight = clamp((core + bodyRadius - distance) / Math.max(.05, bodyRadius * 2), .05, 1);
            total += weight; alongSum += contactAlong * weight; sideSum += contactSide * weight; upSum += ly * weight;
            if (weight > strongest) { strongest = weight; region = Math.floor(point / 3); }
        }
        if (total > 0) {
            out.strength = 2; out.along = alongSum / total; out.side = sideSum / total;
            out.up = upSum / total; out.coverage = clamp(total / 6, 0, 1); out.time = time; out.region = region;
            return out;
        }
    }
    return out;
}
