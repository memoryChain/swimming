import { _decorator, Component } from 'cc';
import { DIVE_BALANCE, RHYTHM_BALANCE, getTargetInterval } from '../core/GameBalance';
import { StrokeType } from '../core/GameConstants';
import { Swimmer } from './Swimmer';

const { ccclass, property } = _decorator;

const MIN_STROKE_INTERVAL = 0.12;
const QUEUE_RETRY_SECONDS = 0.06;
const MIN_HOLD_RATIO = 0.08;
const MAX_HOLD_RATIO = 0.88;

@ccclass('AISwimmerController')
export class AISwimmerController extends Component {
    @property(Swimmer) public swimmer: Swimmer = null;
    @property({ range: [0, 1, 0.01] }) public difficulty = RHYTHM_BALANCE.aiDifficulty;
    @property public bpmOffset = 0;
    @property({ range: [0, 1, 0.01] }) public divePower = DIVE_BALANCE.defaultAiPower;
    @property public diveReaction = DIVE_BALANCE.defaultAiReactionSeconds;

    private _active = false;
    private _strokeTimer = 0;
    private _baseInterval = getTargetInterval();
    private _nextStroke = StrokeType.LEFT;
    private _leftHoldSeconds = 0;
    private _rightHoldSeconds = 0;
    private _targetHoldRatio = 0.46;

    startSwimming() {
        this.releaseHeldStroke(StrokeType.LEFT);
        this.releaseHeldStroke(StrokeType.RIGHT);
        const bpm = Math.max(60, RHYTHM_BALANCE.targetBpm + this.bpmOffset + (Math.random() * 2 - 1) * RHYTHM_BALANCE.aiBpmVariance);
        this._baseInterval = 60 / bpm;
        this._strokeTimer = this._baseInterval * randomRange(0.25, 0.55);
        this._nextStroke = StrokeType.LEFT;
        this._leftHoldSeconds = 0;
        this._rightHoldSeconds = 0;
        this._targetHoldRatio = randomRange(0.4, 0.52);
        this._active = true;
    }

    stopSwimming() {
        this.releaseHeldStroke(StrokeType.LEFT);
        this.releaseHeldStroke(StrokeType.RIGHT);
        this._active = false;
    }

    update(dt: number) {
        if (!this._active || !this.swimmer || !this.swimmer.isRacing) {
            return;
        }

        this.updateHeldStrokeTimers(dt);

        this._strokeTimer -= dt;
        if (this._strokeTimer > 0) {
            return;
        }

        if (!this.tryStartStroke(this.chooseStrokeType())) {
            this._strokeTimer = QUEUE_RETRY_SECONDS;
            return;
        }

        this._strokeTimer = this.nextStrokeInterval();
    }

    private tryStartStroke(type: StrokeType): boolean {
        if (!this.swimmer || !this.swimmer.canAcceptStroke(type) || this.isStrokeHeld(type)) {
            return false;
        }

        this.swimmer.handleStrokeHeld(type, true);
        this.swimmer.handleStroke(type);
        this.setHoldSeconds(type, this.nextHoldSeconds());
        this._nextStroke = type === StrokeType.LEFT ? StrokeType.RIGHT : StrokeType.LEFT;
        return true;
    }

    private chooseStrokeType(): StrokeType {
        const mistakeChance = lerp(0.08, 0.005, this.difficulty);
        if (Math.random() < mistakeChance) {
            return this._nextStroke === StrokeType.LEFT ? StrokeType.RIGHT : StrokeType.LEFT;
        }
        return this._nextStroke;
    }

    private nextStrokeInterval(): number {
        const jitter = lerp(0.24, 0.025, this.difficulty);
        const mistakeChance = lerp(0.12, 0.01, this.difficulty);
        let interval = this._baseInterval * (1 + randomRange(-jitter, jitter));
        if (Math.random() < mistakeChance) {
            interval *= randomRange(0.72, 1.34);
        }
        return Math.max(MIN_STROKE_INTERVAL, interval);
    }

    private nextHoldSeconds(): number {
        const cycleSeconds = Math.max(0.001, this.swimmer?.actionCycleSeconds ?? this._baseInterval);
        const jitter = lerp(0.18, 0.025, this.difficulty);
        const mistakeChance = lerp(0.14, 0.008, this.difficulty);
        let ratio = this._targetHoldRatio + randomRange(-jitter, jitter);
        if (Math.random() < mistakeChance) {
            ratio += randomRange(-0.32, 0.32);
        }
        ratio = clamp(ratio, MIN_HOLD_RATIO, MAX_HOLD_RATIO);
        const sameSideInterval = Math.max(MIN_STROKE_INTERVAL, this._baseInterval * 2);
        return Math.min(cycleSeconds * ratio, sameSideInterval * 0.86);
    }

    private updateHeldStrokeTimers(dt: number) {
        if (this._leftHoldSeconds > 0) {
            this._leftHoldSeconds = Math.max(0, this._leftHoldSeconds - dt);
            if (this._leftHoldSeconds <= 0) {
                this.releaseHeldStroke(StrokeType.LEFT);
            }
        }
        if (this._rightHoldSeconds > 0) {
            this._rightHoldSeconds = Math.max(0, this._rightHoldSeconds - dt);
            if (this._rightHoldSeconds <= 0) {
                this.releaseHeldStroke(StrokeType.RIGHT);
            }
        }
    }

    private releaseHeldStroke(type: StrokeType) {
        if (!this.swimmer || !this.isStrokeHeld(type)) {
            return;
        }
        this.setHoldSeconds(type, 0);
        this.swimmer.handleStrokeHeld(type, false);
    }

    private isStrokeHeld(type: StrokeType): boolean {
        return type === StrokeType.LEFT ? this._leftHoldSeconds > 0 : this._rightHoldSeconds > 0;
    }

    private setHoldSeconds(type: StrokeType, seconds: number) {
        if (type === StrokeType.LEFT) {
            this._leftHoldSeconds = seconds;
        } else {
            this._rightHoldSeconds = seconds;
        }
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
