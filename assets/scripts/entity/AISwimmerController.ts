import { _decorator, Component } from 'cc';
import { DIVE_BALANCE, RHYTHM_BALANCE, getRaceDifficultyConfig } from '../core/GameBalance';
import { StrokeType } from '../core/GameConstants';
import { STROKE_QUALITY_TUNING } from '../core/InputTuning';
import { AI_STROKE_TUNING, AI_STRATEGY_TUNING, AIPersonality, getAiPersonality } from '../competitor/CompetitorConfig';
import { AIRaceObserver } from '../competitor/AIRaceObserver';
import { STEERING_TUNING } from '../core/SteeringTuning';
import { scaledDelta } from '../core/TimeScale';
import { Swimmer } from './Swimmer';
import { SHARK_TUNING } from './SharkTuning';

const { ccclass, property } = _decorator;

type AiStrokePhase = 'gap' | 'stroke';

// Simulated-input AI. Instead of the old visual-only motion, the AI now drives
// the SAME stroke path as the player: it "presses" (handleStrokeHeld true +
// handleStroke), holds while watching the arm-pull progress, then "releases"
// (handleStrokeHeld false) at a target release progress. That release timing lands
// in the shared sweet zone (STROKE_QUALITY_TUNING), so AI propulsion comes from the
// exact same stroke-quality-to-acceleration path the player uses. `difficulty` is the
// competitiveness baseline: it sharpens the release accuracy (higher = closer to the
// perfect center every stroke) AND tightens the stroke cadence (higher = faster).
//
// On top of that baseline sits a STRATEGY layer (see AI_STRATEGY_TUNING +
// AI_PERSONALITIES): each AI spends its effort with a purpose (pacing by
// personality) and reacts to the race (subtle rubber-band + duel surge measured
// against the player). Strategy is applied as a small, smoothed EFFORT MODIFIER
// added to `difficulty` — it never overrides difficulty, so catch-up stays hidden.
@ccclass('AISwimmerController')
export class AISwimmerController extends Component {
    @property(Swimmer) public swimmer: Swimmer = null;
    @property({ range: [0, 1, 0.01] }) public difficulty = RHYTHM_BALANCE.aiDifficulty;
    // Small per-lane cadence flavor (BPM units) so equal-difficulty lanes don't
    // stroke in perfect lockstep. Positive = slightly faster cadence.
    @property public bpmOffset = 0;
    @property({ range: [0, 1, 0.01] }) public divePower = DIVE_BALANCE.defaultAiPower;
    @property public diveReaction = DIVE_BALANCE.defaultAiReactionSeconds;

    // Stable racing style. Assigned from the lane's AICompetitorProfile at build
    // time; defaults to a neutral steady pacer for safety.
    public personality: AIPersonality = getAiPersonality('steady');
    // Shared race view used for rank/gap-based strategy. Null before it is wired
    // (or in isolated tests), in which case strategy falls back to pacing only.
    public raceObserver: AIRaceObserver | null = null;

    private _active = false;
    private _phase: AiStrokePhase = 'gap';
    private _timer = 0;
    private _side: StrokeType = StrokeType.LEFT;
    private _nextSide: StrokeType = StrokeType.LEFT;
    private _targetProgress = 0;
    private _holdElapsed = 0;
    // Smoothed strategy effort added to `difficulty`. Eased every frame toward the
    // live target so rank/gap swings translate into gradual, invisible changes.
    private _effortModifier = 0;
    // Shark threat for light evasion (set by GameFlowController each frame when
    // this AI is the shark's current hunt target).
    private _sharkThreat: { active: boolean; sharkZ: number } | null = null;

    startSwimming() {
        // Idempotent: an AI that already began swimming (e.g. right after its own
        // dive) keeps its rhythm instead of being reset when the race-wide start
        // fires. Only a fresh (inactive) controller initializes its schedule.
        if (this._active) {
            return;
        }
        this._active = true;
        this._phase = 'gap';
        this._nextSide = StrokeType.LEFT;
        this._holdElapsed = 0;
        this._effortModifier = 0;
        this._sharkThreat = null;
        this._timer = randomRange(AI_STROKE_TUNING.startDelayMin, AI_STROKE_TUNING.startDelayMax);
    }

    stopSwimming() {
        // Release any in-flight stroke so a stopped AI doesn't leave an arm held.
        if (this._active && this._phase === 'stroke' && this.swimmer) {
            this.swimmer.handleStrokeHeld(this._side, false);
        }
        this._active = false;
        this._phase = 'gap';
        this._sharkThreat = null;
    }

    // Called every frame by the flow layer with the shark's Z when this AI is the
    // current hunt target (null otherwise). Drives light evasion in pickNextSide.
    setSharkThreat(threat: { active: boolean; sharkZ: number } | null) {
        this._sharkThreat = threat;
    }

    update(dt: number) {
        if (!this._active || !this.swimmer || !this.swimmer.isRacing) {
            return;
        }
        const sdt = scaledDelta(dt);
        this.updateEffortModifier(sdt);
        if (this._phase === 'gap') {
            this._timer -= sdt;
            if (this._timer <= 0) {
                this.beginStroke();
            }
            return;
        }
        this.updateStroke(sdt);
    }

    // Effective competitiveness for THIS moment: the baseline difficulty plus the
    // smoothed strategy effort, clamped so strategy never reaches a trivial or
    // hopeless extreme. Everything downstream (accuracy, cadence, steering
    // discipline) reads this instead of raw `difficulty`.
    private effectiveDifficulty(): number {
        return clamp(
            this.difficulty + this._effortModifier,
            AI_STRATEGY_TUNING.minEffective,
            AI_STRATEGY_TUNING.maxEffective,
        );
    }

    // Ease the effort modifier toward the strategy target every frame. Keeping the
    // easing on the modifier (not on the raw signals) is what makes rubber-band
    // catch-up feel like a natural push rather than a visible speed snap.
    private updateEffortModifier(sdt: number) {
        const target = this.computeStrategyTarget();
        const t = clamp(sdt * AI_STRATEGY_TUNING.effortEaseRate, 0, 1);
        this._effortModifier += (target - this._effortModifier) * t;
    }

    // Combine the three strategy sources into a single (small, capped) effort
    // delta: personality pacing over the race, a rubber-band toward the player,
    // and a neck-and-neck duel surge. Rubber-band and duel need the shared
    // observer; without it only pacing applies.
    private computeStrategyTarget(): number {
        const distance = this.swimmer.distance;
        const raceDistance = this.raceObserver?.raceDistance ?? 0;
        const progress = raceDistance > 0 ? clamp(distance / raceDistance, 0, 1) : 0;

        const startWeight = clamp(1 - progress / Math.max(0.05, AI_STRATEGY_TUNING.startFadeProgress), 0, 1);
        const finishSpan = Math.max(0.05, 1 - AI_STRATEGY_TUNING.finishRampStartProgress);
        const finishWeight = clamp((progress - AI_STRATEGY_TUNING.finishRampStartProgress) / finishSpan, 0, 1);
        const pacing = this.personality.startEffort * startWeight + this.personality.finishEffort * finishWeight;

        let rubber = 0;
        let duel = 0;
        if (this.raceObserver) {
            // Per-tier strategy scaling: 入门 barely chases, 世锦赛 clings hard.
            const tier = getRaceDifficultyConfig();
            const competitiveness = clamp(this.personality.competitiveness, 0, 1);
            const gap = this.raceObserver.gapToPlayer(distance); // + = ahead of player
            const normalized = clamp(gap / Math.max(0.5, AI_STRATEGY_TUNING.rubberBandRange), -1, 1);
            // Trailing (gap < 0) → positive effort; leading (gap > 0) → ease off.
            rubber = -normalized * AI_STRATEGY_TUNING.rubberBandStrength * competitiveness * tier.rubberBandScale;
            const absGap = Math.abs(gap);
            if (absGap < AI_STRATEGY_TUNING.duelRange) {
                duel = AI_STRATEGY_TUNING.duelBoost * (1 - absGap / AI_STRATEGY_TUNING.duelRange) * competitiveness * tier.duelScale;
            }
        }

        return clamp(pacing + rubber + duel, -AI_STRATEGY_TUNING.maxModifier, AI_STRATEGY_TUNING.maxModifier);
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
        this._targetProgress = this.pickTargetProgress();
        this._holdElapsed = 0;
        // Replicate the player's promote sequence: mark held first (captures the
        // press time), then record the stroke (creates the StrokeAction).
        this.swimmer.handleStrokeHeld(side, true);
        this.swimmer.handleStroke(side);
        this._phase = 'stroke';
    }

    // Choose the next stroke side. This is the ONLY place the AI "steers": it
    // shares the player's stroke-driven steering, so imperfect side choices make
    // it weave. When off course, effort (effective difficulty) decides whether it
    // takes the corrective side. Its baseline weaving is now a PERSONALITY trait
    // (weaveTendency) rather than pure difficulty noise, dampened as it pushes
    // harder — so a steady AI swims straight with purpose while a weaver flails.
    private pickNextSide(justUsed: StrokeType): StrokeType {
        const opposite = justUsed === StrokeType.LEFT ? StrokeType.RIGHT : StrokeType.LEFT;
        if (!this.swimmer) {
            return opposite;
        }
        // Light shark evasion: if this AI is the shark's current target, with
        // some probability steer away from the shark laterally instead of
        // following normal steering (not guaranteed, so some AI still get eaten).
        if (this._sharkThreat?.active && Math.random() < SHARK_TUNING.aiEvasionChance) {
            return this.evadeStrokeSide();
        }
        const discipline = clamp(this.effectiveDifficulty(), 0, 1);
        const drift = Math.abs(this.swimmer.steeringHeadingRatio);
        if (drift >= clamp(STEERING_TUNING.aiCorrectHeadingRatio, 0, 1)) {
            const corrective = this.swimmer.correctiveStrokeSide();
            const wrong = corrective === StrokeType.LEFT ? StrokeType.RIGHT : StrokeType.LEFT;
            return Math.random() < discipline ? corrective : wrong;
        }
        // Personality weave, thinned out the harder this AI is currently pushing
        // (so a surging fighter tightens up), scaled by the difficulty tier
        // (入门 wobbles more, 世锦赛 swims cleaner), and bounded by the global cap.
        const weaveScale = getRaceDifficultyConfig().weaveScale;
        const weave = clamp(this.personality.weaveTendency * weaveScale * (1 - discipline * 0.6), 0, 1);
        const wanderChance = weave * clamp(STEERING_TUNING.aiWanderChance, 0, 1);
        return Math.random() < wanderChance ? justUsed : opposite;
    }

    private updateStroke(sdt: number) {
        this._holdElapsed += sdt;
        const progress = this.swimmer.aiActiveStrokeProgress(this._side);
        // The stroke settled/cleared on its own (e.g. auto-completed): move on.
        if (progress < 0) {
            this.scheduleGap();
            return;
        }
        const minHold = Math.max(0, STROKE_QUALITY_TUNING.minHoldSeconds);
        const reachedTarget = progress >= this._targetProgress && this._holdElapsed >= minHold;
        const safetyRelease = progress >= AI_STROKE_TUNING.maxReleaseProgress
            || this._holdElapsed >= AI_STROKE_TUNING.maxHoldSeconds;
        if (reachedTarget || safetyRelease) {
            this.swimmer.handleStrokeHeld(this._side, false);
            this.scheduleGap();
        }
    }

    // Target release progress for this stroke: the shared sweet-zone center plus
    // effort-scaled noise. At high effective difficulty the noise collapses to ~0
    // so the AI hits the perfect center every stroke; at low effort the wide
    // spread produces less-perfect hits and occasional full misses (tail below the
    // good zone), exactly like a shaky player.
    // Pick the stroke side that drifts this AI away from the shark in Z.
    // Steering sign (SwimmerMotor.applyStrokeSteering): a LEFT stroke pushes
    // heading by +courseDirection (-> +Z lateral drift), RIGHT by -courseDirection.
    private evadeStrokeSide(): StrokeType {
        const swimmer = this.swimmer!;
        const sharkZ = this._sharkThreat?.sharkZ ?? 0;
        const myZ = swimmer.node.position.z;
        const courseDir = swimmer.raceDirection >= 0 ? 1 : -1;
        const evadeZ = myZ >= sharkZ ? 1 : -1;
        return evadeZ === courseDir ? StrokeType.LEFT : StrokeType.RIGHT;
    }

    private pickTargetProgress(): number {
        const center = (STROKE_QUALITY_TUNING.perfectStart + STROKE_QUALITY_TUNING.perfectEnd) * 0.5;
        const sigma = lerp(AI_STROKE_TUNING.timingSigmaLow, AI_STROKE_TUNING.timingSigmaHigh, this.effectiveDifficulty());
        const target = center + gaussian() * sigma;
        return clamp(target, 0.05, AI_STROKE_TUNING.maxReleaseProgress);
    }

    private scheduleGap() {
        // Decide the next side now that this stroke has settled (its steering has
        // been applied, so the heading reflects it).
        this._nextSide = this.pickNextSide(this._side);
        const base = lerp(AI_STROKE_TUNING.gapSecondsSlow, AI_STROKE_TUNING.gapSecondsFast, this.effectiveDifficulty());
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
