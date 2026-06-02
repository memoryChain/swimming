import { _decorator, Component } from 'cc';
import { DIVE_BALANCE, RHYTHM_BALANCE, TARGET_INTERVAL } from '../core/GameBalance';
import { StrokeType } from '../core/GameConstants';
import { Swimmer } from './Swimmer';

const { ccclass, property } = _decorator;

@ccclass('AISwimmerController')
export class AISwimmerController extends Component {
    @property(Swimmer) public swimmer: Swimmer = null;
    @property({ range: [0, 1, 0.01] }) public difficulty = RHYTHM_BALANCE.aiDifficulty;
    @property public bpmOffset = 0;
    @property({ range: [0, 1, 0.01] }) public divePower = DIVE_BALANCE.defaultAiPower;
    @property public diveReaction = DIVE_BALANCE.defaultAiReactionSeconds;

    private _active = false;
    private _timer = 0;
    private _interval = TARGET_INTERVAL;
    private _baseInterval = TARGET_INTERVAL;
    private _nextStroke = StrokeType.ARM;

    startSwimming() {
        const bpm = RHYTHM_BALANCE.targetBpm + this.bpmOffset + (Math.random() * 2 - 1) * RHYTHM_BALANCE.aiBpmVariance;
        this._baseInterval = 60 / bpm;
        this._interval = this._baseInterval;
        this._timer = this._interval * 0.35;
        this._nextStroke = StrokeType.ARM;
        this._active = true;
    }

    stopSwimming() {
        this._active = false;
    }

    update(dt: number) {
        if (!this._active || !this.swimmer || !this.swimmer.isRacing) {
            return;
        }

        this._timer += dt;
        if (this._timer < this._interval) {
            return;
        }

        this._timer -= this._interval;
        this.swimmer.handleStroke(this._nextStroke);
        this._nextStroke = this._nextStroke === StrokeType.ARM ? StrokeType.LEG : StrokeType.ARM;

        const rhythmError = (1 - this.difficulty) * 0.32;
        this._interval = this._baseInterval * (1 + (Math.random() * 2 - 1) * rhythmError);
        if (Math.random() > this.difficulty + 0.08) {
            this._timer -= this._interval * 0.45;
        }
    }
}
