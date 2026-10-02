import { Vec3 } from 'cc';

// 手工设计的蝶泳关键方向：外侧、前方、腹侧。保留骨长，双侧镜像共用。
// 水下抱推后以接近伸直的双臂从身体两侧回摆，区别于自由泳高肘回臂。
const KEYS: readonly (readonly number[])[] = [
    [0,    0.12, 1, 0.02,  0.06, 1, 0.06],
    [0.16, 0.55, 0.7, 0.42, -0.1, 0.4, 0.91],
    [0.32, 0.65, 0.1, 0.55, -0.3, -0.6, 0.74],
    [0.46, 0.27,-0.9, 0.32, 0.05,-0.97, 0.12],
    [0.58, 0.65,-0.74,-0.24, 0.65,-0.75,-0.2],
    [0.73, 0.98, 0.06,-0.28, 0.98, 0.1,-0.25],
    [0.88, 0.5, 0.85,-0.18, 0.4, 0.91,-0.14],
    [1,    0.12, 1, 0.02,  0.06, 1, 0.06],
];

export function butterflyExtension(phase: number): number {
    return smooth(phase < 0.5 ? (0.12 - phase) / 0.09 : (phase - 0.91) / 0.09);
}

/** 手腕细节只作用于手骨；首尾归零，不能把翻掌扭转传回肩腋。 */
export function butterflyWristFlex(phase: number): number {
    return -6 * pulse(phase, 0.06, 0.20, 0.34, 0.48)
        + 4 * pulse(phase, 0.53, 0.64, 0.78, 0.94);
}

export function butterflyWristFeather(phase: number): number {
    return 8 * pulse(phase, 0.48, 0.60, 0.75, 0.94);
}

/** 两次下踢仍同频同相：推水附近更明确，前伸附近较轻；不增加原峰值。 */
export function butterflyKickPower(phase: number, detail: number): number {
    return 1.35 * (1 - 0.22 * detail * (0.5 + 0.5 * Math.cos((phase - 0.95) * Math.PI * 2)));
}

function pulse(p: number, start: number, rise: number, fall: number, end: number): number {
    return smooth((p - start) / (rise - start)) * (1 - smooth((p - fall) / (end - fall)));
}

export function sampleButterflyArm(phase: number, upper: Vec3, fore: Vec3): void {
    const p = Math.max(0, Math.min(1, phase));
    let i = 0;
    while (i < KEYS.length - 2 && p > KEYS[i + 1][0]) i++;
    // 周期三次插值保留经过关键点的速度，避免每段缓入缓出造成推水停顿。
    upper.set(component(i, p, 1), component(i, p, 2), component(i, p, 3));
    fore.set(component(i, p, 4), component(i, p, 5), component(i, p, 6));
    Vec3.normalize(upper, upper); Vec3.normalize(fore, fore);
}

function component(i: number, p: number, axis: number): number {
    const a = KEYS[i], b = KEYS[i + 1];
    const previous = KEYS[i === 0 ? KEYS.length - 2 : i - 1];
    const next = KEYS[i + 2 === KEYS.length ? 1 : i + 2];
    const previousTime = previous[0] - (i === 0 ? 1 : 0);
    const nextTime = next[0] + (i + 2 === KEYS.length ? 1 : 0);
    const span = b[0] - a[0], t = (p - a[0]) / span, t2 = t * t, t3 = t2 * t;
    const m0 = (b[axis] - previous[axis]) / (b[0] - previousTime);
    const m1 = (next[axis] - a[axis]) / (nextTime - a[0]);
    return (2 * t3 - 3 * t2 + 1) * a[axis] + (t3 - 2 * t2 + t) * span * m0
        + (-2 * t3 + 3 * t2) * b[axis] + (t3 - t2) * span * m1;
}

function smooth(v: number): number { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); }
