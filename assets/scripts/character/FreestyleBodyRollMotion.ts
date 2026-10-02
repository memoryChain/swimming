/** 仅用于本地动作实验：真实左右划水驱动身体侧转，不产生输入或推进。 */
export const FREESTYLE_BODY_ROLL_TUNING = {
    chestDegrees: 32,
    pelvisDegrees: 16,
    headStability: 0.94,
    responseSeconds: 0.045,
    fadeSeconds: 0.10,
    maxSignalSpeed: 10,
    idleGraceSeconds: 0.12,
};

const TAU = Math.PI * 2;
function smooth(value: number, from: number, to: number): number {
    const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
    return t * t * (3 - 2 * t);
}

/** 从后推逐渐侧转，覆盖出水及回臂；前伸结束时回到中立，静止不会自行补划。 */
export function freestyleRecoveryRoll(cycle: number): number {
    const phase = ((cycle / TAU) % 1 + 1) % 1;
    return smooth(phase, 0.12, 0.50) * (1 - smooth(phase, 0.80, 1));
}

export class FreestyleBodyRollMotion {
    private _left = 0;
    private _right = 0;
    private _ready = false;
    private _idle = 0;
    private _weight = 0;
    private _roll = 0;
    get weight(): number { return this._weight; }
    get roll(): number { return this._roll; }

    reset(): void {
        this._ready = false;
        this._left = this._right = this._idle = this._weight = this._roll = 0;
    }

    update(dt: number, left: number, right: number, allowed: boolean,
        bodyUp: number, pitch: number, rollSpeed: number, pitchSpeed: number): void {
        if (!Number.isFinite(dt + left + right + bodyUp + pitch + rollSpeed + pitchSpeed)) {
            this.reset(); return;
        }
        const step = Math.max(0, Math.min(0.2, dt));
        if (!this._ready) {
            this._left = left; this._right = right; this._ready = true; return;
        }
        const dl = left - this._left, dr = right - this._right;
        this._left = left; this._right = right;
        this._idle = dl > 0.00001 || dr > 0.00001 ? 0 : this._idle + step;
        const gate = allowed && dl >= -0.00001 && dr >= -0.00001
            && this._idle <= FREESTYLE_BODY_ROLL_TUNING.idleGraceSeconds
            ? smooth(bodyUp, 0.3, 0.8) * smooth(Math.cos(pitch), 0.65, 0.9)
                * (1 - smooth(Math.max(Math.abs(rollSpeed), Math.abs(pitchSpeed)), 1.2, 3)) : 0;
        const target = gate > 0 ? freestyleRecoveryRoll(left) - freestyleRecoveryRoll(right) : 0;
        const desiredStep = (target - this._roll) * (1 - Math.exp(-step / FREESTYLE_BODY_ROLL_TUNING.responseSeconds));
        const limit = FREESTYLE_BODY_ROLL_TUNING.maxSignalSpeed * step;
        this._roll += Math.max(-limit, Math.min(limit, desiredStep));
        this._weight += (gate - this._weight) * (1 - Math.exp(-step / FREESTYLE_BODY_ROLL_TUNING.fadeSeconds));
        if (gate === 0 && this._weight < 0.001) this._weight = 0;
        if (target === 0 && Math.abs(this._roll) < 0.0001) this._roll = 0;
    }
}
