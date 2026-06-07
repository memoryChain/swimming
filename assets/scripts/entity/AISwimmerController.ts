import { _decorator, Component } from 'cc';
import { DIVE_BALANCE, RHYTHM_BALANCE, SWIMMER_BALANCE, getTargetInterval } from '../core/GameBalance';
import { StrokeType } from '../core/GameConstants';
import { Swimmer } from './Swimmer';

const { ccclass, property } = _decorator;

const MIN_VISUAL_STROKE_INTERVAL = 0.18;
const LOW_SPEED_INTERVAL_SCALE = 1.34;
const HIGH_SPEED_INTERVAL_SCALE = 0.76;

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

    startSwimming() {
        const bpm = Math.max(60, RHYTHM_BALANCE.targetBpm + this.bpmOffset + (Math.random() * 2 - 1) * RHYTHM_BALANCE.aiBpmVariance);
        this._baseInterval = 60 / bpm;
        this._strokeTimer = this._baseInterval * randomRange(0.2, 0.5);
        this._nextStroke = StrokeType.LEFT;
        this._active = true;
    }

    stopSwimming() {
        this._active = false;
    }

    update(dt: number) {
        if (!this._active || !this.swimmer || !this.swimmer.isRacing) {
            return;
        }

        this._strokeTimer -= dt;
        if (this._strokeTimer > 0) {
            return;
        }

        const type = this.chooseStrokeType();
        this.swimmer.playAiStrokeVisual(type);
        this._nextStroke = type === StrokeType.LEFT ? StrokeType.RIGHT : StrokeType.LEFT;
        this._strokeTimer = this.nextStrokeInterval();
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
        const speedRatio = this.currentSpeedRatio();
        const speedIntervalScale = lerp(LOW_SPEED_INTERVAL_SCALE, HIGH_SPEED_INTERVAL_SCALE, smoothStep(speedRatio));
        let interval = this._baseInterval * speedIntervalScale * (1 + randomRange(-jitter, jitter));
        if (Math.random() < mistakeChance) {
            interval *= randomRange(0.78, 1.28);
        }
        return Math.max(MIN_VISUAL_STROKE_INTERVAL, interval);
    }

    private currentSpeedRatio(): number {
        if (!this.swimmer) {
            return 0;
        }
        const maxSpeed = SWIMMER_BALANCE.maxSpeed * Math.max(0.1, this.swimmer.aiMaxSpeedScale);
        return maxSpeed > 0 ? clamp(this.swimmer.currentSpeed / maxSpeed, 0, 1) : 0;
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

function smoothStep(value: number): number {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
}
