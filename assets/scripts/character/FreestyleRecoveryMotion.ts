import { Vec3 } from 'cc';

/** 稳定俯泳的回臂方向，坐标依次为身体外侧、前方、腹侧；保持原骨长。 */
const RECOVERY_KEYS: readonly (readonly number[])[] = [
    [0.40, 0.38,-0.81, 0.45,  0.23,-0.95, 0.20],
    [0.52, 0.55,-0.78,-0.18,  0.45,-0.83, 0.32],
    [0.64, 0.70,-0.40,-0.30,  0.22,-0.12, 0.97],
    [0.76, 0.60, 0.35,-0.38,  0.15, 0.65, 0.75],
    [0.86, 0.35, 0.85,-0.22, -0.05, 0.70, 0.71],
    [0.94, 0.18, 0.98,-0.10,  0.00, 0.91, 0.42],
    [1.00, 0.00, 1.00, 0.00,  0.00, 1.00, 0.00],
];

const TAU = Math.PI * 2;
export function recoveryPhase(cycle: number): number { return ((cycle / TAU) % 1 + 1) % 1; }
function smooth(value: number, from: number, to: number): number {
    const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
    return t * t * (3 - 2 * t);
}

export function highElbowRecoveryEnvelope(cycle: number): number {
    const phase = recoveryPhase(cycle);
    return smooth(phase, 0.40, 0.62) * (1 - smooth(phase, 0.90, 1));
}

/** 连续方向插值：肘先前移，手低于肘，入水后再展开。只在回臂窗口调用。 */
export function sampleHighElbowRecovery(cycle: number, upper: Vec3, fore: Vec3): void {
    const phase = Math.max(0.40, recoveryPhase(cycle));
    let index = 0;
    while (index < RECOVERY_KEYS.length - 2 && phase > RECOVERY_KEYS[index + 1][0]) index++;
    const a = RECOVERY_KEYS[index], b = RECOVERY_KEYS[index + 1];
    const previous = RECOVERY_KEYS[Math.max(0, index - 1)];
    const next = RECOVERY_KEYS[Math.min(RECOVERY_KEYS.length - 1, index + 2)];
    const width = b[0] - a[0], t = (phase - a[0]) / width, t2 = t * t, t3 = t2 * t;
    for (let component = 1; component <= 6; component++) {
        const value = (2 * t3 - 3 * t2 + 1) * a[component] + (-2 * t3 + 3 * t2) * b[component]
            + (t3 - 2 * t2 + t) * width * (b[component] - previous[component]) / (b[0] - previous[0])
            + (t3 - t2) * width * (next[component] - a[component]) / (next[0] - a[0]);
        const target = component <= 3 ? upper : fore;
        if (component === 1 || component === 4) target.x = value;
        else if (component === 2 || component === 5) target.y = value;
        else target.z = value;
    }
    Vec3.normalize(upper, upper);
    Vec3.normalize(fore, fore);
}

/** 只读物理姿态；视觉侧倾不参与准入。恢复稳定后在回臂前重新接入，避免中途折手。 */
export class FreestyleRecoveryAdmission {
    private _stable = 0;
    private _leftArmed = false;
    private _rightArmed = false;
    private _left = 0;
    private _right = 0;
    get left(): number { return this._left; }
    get right(): number { return this._right; }

    reset(): void {
        this._stable = this._left = this._right = 0;
        this._leftArmed = this._rightArmed = false;
    }

    update(dt: number, left: number, right: number, allowed: boolean,
        bodyUp: number, pitch: number, rollSpeed: number, pitchSpeed: number): void {
        const rate = Math.max(Math.abs(rollSpeed), Math.abs(pitchSpeed));
        const stable = allowed && bodyUp > 0.75 && Math.cos(pitch) > 0.85 && rate < 1.2;
        this._stable = stable ? this._stable + dt : 0;
        if (!stable) this._leftArmed = this._rightArmed = false;
        else if (this._stable >= 0.15) {
            if (recoveryPhase(left) < 0.40) this._leftArmed = true;
            if (recoveryPhase(right) < 0.40) this._rightArmed = true;
        }
        const blend = 1 - Math.exp(-dt / 0.08);
        this._left += ((this._leftArmed ? 1 : 0) - this._left) * blend;
        this._right += ((this._rightArmed ? 1 : 0) - this._right) * blend;
        if (!this._leftArmed && this._left < 0.001) this._left = 0;
        if (!this._rightArmed && this._right < 0.001) this._right = 0;
    }
}
