/** 仅供本地蝶泳测试的自由泳换气表现，不参与推进、体力或输入判定。 */
export const FREESTYLE_BREATHING_TUNING = {
    rightStrokeInterval: 2,
    chestTurnDegrees: 34,
    pelvisTurnDegrees: 6,
    headTurnDegrees: 18,
    preparationPhase: 0.26,
    bodyRiseSeconds: 0.13,
    bodyReturnStartSeconds: 0.22,
    bodyEndSeconds: 0.37,
    headStartSeconds: 0.045,
    headRiseEndSeconds: 0.115,
    headReturnStartSeconds: 0.22,
    headEndSeconds: 0.32,
    cancelBodySeconds: 0.16,
    cancelHeadSeconds: 0.10,
};

const TAU = Math.PI * 2;

/** 使用外层身体姿态，避免把换气自己的头颈旋转反馈进准入判断。 */
export function permitsFreestyleBreathing(
    bodyUpProjection: number, pitch: number, rollSpeed: number, pitchSpeed: number,
): boolean {
    return bodyUpProjection > 0.65 && Math.cos(pitch) > 0.85
        && Math.abs(rollSpeed) < 1.2 && Math.abs(pitchSpeed) < 1.2;
}

/** 已开始的动作容许普通晃动；明显侧翻、前后翻转或高速翻滚才打断。 */
export function interruptsFreestyleBreathing(
    bodyUpProjection: number, pitch: number, rollSpeed: number, pitchSpeed: number,
): boolean {
    return !Number.isFinite(bodyUpProjection + pitch + rollSpeed + pitchSpeed)
        || bodyUpProjection < 0.35 || Math.cos(pitch) < 0.65
        || Math.abs(rollSpeed) > 3 || Math.abs(pitchSpeed) > 3;
}

export class FreestyleBreathingMotion {
    private _lastCycle = -1;
    private _lastPhase = 0;
    private _opportunities = 0;
    private _active = false;
    private _idleSeconds = 0;
    private _stableSeconds = 0;
    private _weight = 0;
    private _headWeight = 0;
    private _elapsed = 0;
    private _timeScale = 1;
    private _lastPoseTurns = 0;
    private _entryTurn = 0;
    private _returning = false;
    private _returnElapsed = 0;
    private _returnBody = 0;
    private _returnHead = 0;

    get headWeight(): number { return this._headWeight; }

    reset(): void {
        this._lastCycle = -1;
        this._lastPhase = this._opportunities = 0;
        this._active = this._returning = false;
        this._idleSeconds = this._stableSeconds = this._weight = 0;
        this._headWeight = 0;
        this._elapsed = this._lastPoseTurns = this._entryTurn = 0;
        this._timeScale = 1;
        this._returnElapsed = this._returnBody = this._returnHead = 0;
    }

    update(dt: number, sourceCycle: number, poseCycle: number, eligible: boolean, interrupted = !eligible): number {
        if (!Number.isFinite(sourceCycle) || !Number.isFinite(poseCycle)) {
            this.reset();
            return 0;
        }
        const step = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0));
        const poseTurns = poseCycle / TAU;
        const phase = ((poseTurns % 1) + 1) % 1;
        if (this._lastCycle < 0 || sourceCycle < this._lastCycle - 0.00001) {
            this.reset();
            this._lastCycle = sourceCycle;
            this._lastPhase = phase;
            this._lastPoseTurns = poseTurns;
            return 0;
        }
        const moving = sourceCycle > this._lastCycle + 0.000001;
        const poseDelta = poseTurns - this._lastPoseTurns;
        this._idleSeconds = moving ? 0 : this._idleSeconds + step;
        this._stableSeconds = eligible ? this._stableSeconds + step : 0;
        if (this._active && (interrupted || this._idleSeconds > 0.12 || poseDelta < -0.000001)) {
            this._active = false;
            this._returning = true;
            this._returnElapsed = 0;
            this._returnBody = this._weight;
            this._returnHead = this._headWeight;
        }
        const tuning = FREESTYLE_BREATHING_TUNING;
        // 拉水后段提前准备；相位只决定起点，完整胸肩动作由实际经过的时间推进。
        if (moving && poseDelta > 0 && eligible && !interrupted && this._stableSeconds >= 0.18
            && this._lastPhase < tuning.preparationPhase && phase >= tuning.preparationPhase && phase < 0.48) {
            const interval = Math.max(1, Math.round(FREESTYLE_BREATHING_TUNING.rightStrokeInterval));
            const selected = ++this._opportunities % interval === 0;
            const rate = step > 0 ? poseDelta / step : 0;
            // 超快或跳变的一拍不强行塞入换气，不改变原划水速度。
            if (selected && !this._active && !this._returning && rate >= 0.9 && (0.98 - phase) / rate >= 0.22) {
                this._active = true;
                // 慢划允许延长配合时间；快速回臂仍保留完整的基础过渡时长。
                this._timeScale = Math.max(1, Math.min(2, 1.8 / rate));
                this._elapsed = Math.min(step, (phase - tuning.preparationPhase) / rate) - step;
                this._entryTurn = Math.floor(poseTurns) + 0.98;
            }
        }
        if (this._returning) {
            this._returnElapsed += step;
            this._weight = this._returnBody * (1 - smooth(this._returnElapsed, 0, tuning.cancelBodySeconds));
            this._headWeight = this._returnHead * (1 - smooth(this._returnElapsed, 0, tuning.cancelHeadSeconds));
            if (this._returnElapsed >= tuning.cancelBodySeconds) this._returning = false;
        } else if (this._active) {
            this._elapsed += step;
            const progressSeconds = this._elapsed / this._timeScale;
            this._weight = smooth(progressSeconds, 0, tuning.bodyRiseSeconds)
                * (1 - smooth(progressSeconds, tuning.bodyReturnStartSeconds, tuning.bodyEndSeconds));
            this._headWeight = smooth(progressSeconds, tuning.headStartSeconds, tuning.headRiseEndSeconds)
                * (1 - smooth(progressSeconds, tuning.headReturnStartSeconds, tuning.headEndSeconds))
                * smooth(poseTurns, this._entryTurn - 0.58, this._entryTurn - 0.44)
                * (1 - smooth(poseTurns, this._entryTurn - 0.17, this._entryTurn));
            if (progressSeconds >= tuning.bodyEndSeconds) this._active = false;
        } else this._weight = this._headWeight = 0;
        this._lastCycle = sourceCycle;
        this._lastPhase = phase;
        this._lastPoseTurns = poseTurns;
        return this._weight;
    }
}

function smooth(value: number, start: number, end: number): number {
    const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
    return t * t * (3 - 2 * t);
}
