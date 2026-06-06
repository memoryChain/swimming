import { _decorator, Component } from 'cc';
import { COUNTDOWN_SECONDS, RACE_DISTANCE } from './GameBalance';
import { GameState } from './GameConstants';
import { Swimmer } from '../entity/Swimmer';

const { ccclass, property } = _decorator;

@ccclass('RaceManager')
export class RaceManager extends Component {
    @property(Swimmer) public playerSwimmer: Swimmer = null;
    @property(Swimmer) public aiSwimmer: Swimmer = null;
    @property public countdownSeconds = COUNTDOWN_SECONDS;

    public onCountdownTick: (value: number) => void = null;
    public onStateChange: (state: GameState) => void = null;
    public onRaceTimerUpdate: (time: number) => void = null;
    public onProgressUpdate: (playerDist: number, aiDist: number) => void = null;
    public onRaceFinished: (playerWin: boolean, playerTime: number, aiTime: number) => void = null;
    public onDiveReady: () => void = null;

    private _state = GameState.READY;
    private _countdownTimer = 0;
    private _raceTimer = 0;
    private _playerFinished = false;
    private _aiFinished = false;
    private _playerFinishTime = 0;
    private _aiFinishTime = 0;
    private _lastCountdownValue = -1;
    private _diveResolved = false;

    startRace() {
        this.unscheduleAllCallbacks();
        this._countdownTimer = this.countdownSeconds;
        this._raceTimer = 0;
        this._playerFinished = false;
        this._aiFinished = !this.aiSwimmer;
        this._playerFinishTime = 0;
        this._aiFinishTime = 0;
        this._lastCountdownValue = Math.ceil(this._countdownTimer);
        this._diveResolved = false;
        this.setState(GameState.COUNTDOWN);
        this.onCountdownTick?.(this._lastCountdownValue);
    }

    update(dt: number) {
        if (this._state === GameState.COUNTDOWN) {
            this.updateCountdown(dt);
        } else if (this._state === GameState.DIVING) {
            this.updateDiving(dt);
        } else if (this._state === GameState.GLIDING) {
            this.updateGliding(dt);
        } else if (this._state === GameState.RACING) {
            this.updateRacing(dt);
        }
    }

    resetRace() {
        this.unscheduleAllCallbacks();
        this._state = GameState.READY;
        this._countdownTimer = 0;
        this._raceTimer = 0;
        this._playerFinished = false;
        this._aiFinished = !this.aiSwimmer;
        this._lastCountdownValue = -1;
        this._diveResolved = false;
        this.playerSwimmer?.reset();
        this.aiSwimmer?.reset();
        this.onProgressUpdate?.(0, 0);
        this.onRaceTimerUpdate?.(0);
    }

    private updateCountdown(dt: number) {
        this._countdownTimer -= dt;
        const value = Math.max(0, Math.ceil(this._countdownTimer));
        if (value !== this._lastCountdownValue) {
            this._lastCountdownValue = value;
            this.onCountdownTick?.(value);
        }

        if (this._countdownTimer <= -0.35) {
            this.playerSwimmer?.prepareDive();
            this.setState(GameState.DIVING);
            this.onDiveReady?.();
        }
    }

    startFromDive(playerDivePower: number) {
        if (this._state !== GameState.DIVING || this._diveResolved) {
            return;
        }
        this._diveResolved = true;
        const playerDuration = this.playerSwimmer?.performDive(playerDivePower) ?? 0;
        this.scheduleOnce(() => {
            if (this._state === GameState.DIVING && this._diveResolved) {
                this.setState(GameState.RACING);
            }
        }, playerDuration);
    }

    private updateDiving(dt: number) {
        this._raceTimer += dt;
        this.onRaceTimerUpdate?.(this._raceTimer);
        this.onProgressUpdate?.(this.playerSwimmer?.distance ?? 0, this.aiSwimmer?.distance ?? 0);
    }

    private updateGliding(dt: number) {
        this._raceTimer += dt;
        this.onRaceTimerUpdate?.(this._raceTimer);
        this.onProgressUpdate?.(this.playerSwimmer?.distance ?? 0, this.aiSwimmer?.distance ?? 0);
    }

    private updateRacing(dt: number) {
        this._raceTimer += dt;
        const playerDist = this.playerSwimmer?.distance ?? 0;
        const aiDist = this.aiSwimmer?.distance ?? 0;

        this.onRaceTimerUpdate?.(this._raceTimer);
        this.onProgressUpdate?.(playerDist, aiDist);

        if (!this._playerFinished && playerDist >= RACE_DISTANCE) {
            this._playerFinished = true;
            this._playerFinishTime = this._raceTimer;
            this.playerSwimmer?.playFinishTouch();
        }
        if (this.aiSwimmer && !this._aiFinished && aiDist >= RACE_DISTANCE) {
            this._aiFinished = true;
            this._aiFinishTime = this._raceTimer;
            this.aiSwimmer?.stopRace();
        }

        if (this._playerFinished && this._aiFinished) {
            this.setState(GameState.FINISHED);
            this.onRaceFinished?.(
                !this.aiSwimmer || this._playerFinishTime <= this._aiFinishTime,
                this._playerFinishTime,
                this._aiFinishTime,
            );
        }
    }

    private setState(state: GameState) {
        this._state = state;
        this.onStateChange?.(state);
    }

    get state(): GameState {
        return this._state;
    }
}
