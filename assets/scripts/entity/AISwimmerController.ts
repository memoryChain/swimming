import { _decorator, Component } from 'cc';
import { DIVE_BALANCE, RHYTHM_BALANCE } from '../core/GameBalance';
import { StrokeType } from '../core/GameConstants';
import { STABILITY_TUNING } from '../core/InputTuning';
import { AI_STROKE_TUNING } from '../competitor/CompetitorConfig';
import { scaledDelta } from '../core/TimeScale';
import { Swimmer } from './Swimmer';

const { ccclass, property } = _decorator;

type AiStrokePhase = 'gap' | 'stroke';

// Simulated-input AI. Instead of the old visual-only motion, the AI now drives
// the SAME stroke path as the player: it "presses" (handleStrokeHeld true +
// handleStroke), holds while watching the arm-pull progress, then "releases"
// (handleStrokeHeld false) at a target release progress. That release timing lands
// in the shared sweet zone (STABILITY_TUNING), so AI propulsion comes from the
// exact same stability→acceleration path the player uses. `difficulty` is the one
// competitiveness axis: it sharpens the release accuracy (higher = closer to the
// perfect center every stroke) AND tightens the stroke cadence (higher = faster).
@ccclass('AISwimmerController')
export class AISwimmerController extends Component {
    @property(Swimmer) public swimmer: Swimmer = null;
    @property({ range: [0, 1, 0.01] }) public difficulty = RHYTHM_BALANCE.aiDifficulty;
    // Small per-lane cadence flavor (BPM units) so equal-difficulty lanes don't
    // stroke in perfect lockstep. Positive = slightly faster cadence.
    @property public bpmOffset = 0;
    @property({ range: [0, 1, 0.01] }) public divePower = DIVE_BALANCE.defaultAiPower;
    @property public diveReaction = DIVE_BALANCE.defaultAiReactionSeconds;

    private _active = false;
    private _phase: AiStrokePhase = 'gap';
    private _timer = 0;
    private _side: StrokeType = StrokeType.LEFT;
    private _nextSide: StrokeType = StrokeType.LEFT;
    private _targetProgress = 0;
    private _holdElapsed = 0;

    startSwimming() {
        this._active = true;
        this._phase = 'gap';
        this._nextSide = StrokeType.LEFT;
        this._holdElapsed = 0;
        this._timer = randomRange(AI_STROKE_TUNING.startDelayMin, AI_STROKE_TUNING.startDelayMax);
    }

    stopSwimming() {
        // Release any in-flight stroke so a stopped AI doesn't leave an arm held.
        if (this._active && this._phase === 'stroke' && this.swimmer) {
            this.swimmer.handleStrokeHeld(this._side, false);
        }
        this._active = false;
        this._phase = 'gap';
    }

    update(dt: number) {
        if (!this._active || !this.swimmer || !this.swimmer.isRacing) {
            return;
        }
        const sdt = scaledDelta(dt);
        if (this._phase === 'gap') {
            this._timer -= sdt;
            if (this._timer <= 0) {
                this.beginStroke();
            }
            return;
        }
        this.updateStroke(sdt);
    }

    private beginStroke() {
        const side = this._nextSide;
        // A previous same-side pull may still be sweeping out its released tail;
        // wait a beat and retry rather than dropping the stroke.
        if (!this.swimmer.canAcceptStroke(side)) {
            this._timer = 0.02;
            return;
        }
        this._side = side;
        this._nextSide = side === StrokeType.LEFT ? StrokeType.RIGHT : StrokeType.LEFT;
        this._targetProgress = this.pickTargetProgress();
        this._holdElapsed = 0;
        // Replicate the player's promote sequence: mark held first (captures the
        // press time), then record the stroke (creates the StrokeAction).
        this.swimmer.handleStrokeHeld(side, true);
        this.swimmer.handleStroke(side);
        this._phase = 'stroke';
    }

    private updateStroke(sdt: number) {
        this._holdElapsed += sdt;
        const progress = this.swimmer.aiActiveStrokeProgress(this._side);
        // The stroke settled/cleared on its own (e.g. auto-completed): move on.
        if (progress < 0) {
            this.scheduleGap();
            return;
        }
        const minHold = Math.max(0, STABILITY_TUNING.minHoldSeconds);
        const reachedTarget = progress >= this._targetProgress && this._holdElapsed >= minHold;
        const safetyRelease = progress >= AI_STROKE_TUNING.maxReleaseProgress
            || this._holdElapsed >= AI_STROKE_TUNING.maxHoldSeconds;
        if (reachedTarget || safetyRelease) {
            this.swimmer.handleStrokeHeld(this._side, false);
            this.scheduleGap();
        }
    }

    // Target release progress for this stroke: the shared sweet-zone center plus
    // difficulty-scaled noise. At difficulty 1 the noise collapses to ~0 so the AI
    // hits the perfect center every stroke; at low difficulty the wide spread
    // produces less-perfect hits and occasional full misses (tail below the good
    // zone), exactly like a shaky player.
    private pickTargetProgress(): number {
        const center = (STABILITY_TUNING.perfectStart + STABILITY_TUNING.perfectEnd) * 0.5;
        const sigma = lerp(AI_STROKE_TUNING.timingSigmaLow, AI_STROKE_TUNING.timingSigmaHigh, this.difficulty);
        const target = center + gaussian() * sigma;
        return clamp(target, 0.05, AI_STROKE_TUNING.maxReleaseProgress);
    }

    private scheduleGap() {
        const base = lerp(AI_STROKE_TUNING.gapSecondsSlow, AI_STROKE_TUNING.gapSecondsFast, this.difficulty);
        // bpmOffset nudges cadence a little: higher offset = slightly tighter gap.
        const flavor = clamp(1 - this.bpmOffset * 0.002, 0.85, 1.15);
        const jitter = 1 + randomRange(-AI_STROKE_TUNING.gapJitter, AI_STROKE_TUNING.gapJitter);
        this._timer = Math.max(0, base * flavor * jitter);
        this._phase = 'gap';
    }
}

function randomRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * clamp(t, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

// Standard normal sample (Box-Muller). Mean 0, std 1.
function gaussian(): number {
    let u = 0;
    let v = 0;
    while (u === 0) {
        u = Math.random();
    }
    while (v === 0) {
        v = Math.random();
    }
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

