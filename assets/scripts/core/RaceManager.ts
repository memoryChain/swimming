import { _decorator, Component } from 'cc';
import { COUNTDOWN_SECONDS, RACE_DISTANCE } from './GameBalance';
import { GameState } from './GameConstants';
import { Swimmer } from '../entity/Swimmer';

const { ccclass, property } = _decorator;

export type RacePlacementSummary = {
    placement: number;
    racerCount: number;
};

@ccclass('RaceManager')
export class RaceManager extends Component {
    @property(Swimmer) public playerSwimmer: Swimmer = null;
    @property(Swimmer) public aiSwimmer: Swimmer = null;
    @property([Swimmer]) public aiSwimmers: Swimmer[] = [];
    @property public countdownSeconds = COUNTDOWN_SECONDS;

    public onCountdownTick: (value: number) => void = null;
    public onStateChange: (state: GameState) => void = null;
    public onRaceTimerUpdate: (time: number) => void = null;
    public onProgressUpdate: (playerDist: number, aiDist: number) => void = null;
    public onRaceFinished: (playerWin: boolean, playerTime: number, aiTime: number, placement?: RacePlacementSummary) => void = null;
    public onDiveReady: () => void = null;

    private _state = GameState.READY;
    private _countdownTimer = 0;
    private _raceTimer = 0;
    private _playerFinished = false;
    private _playerFinishTime = 0;
    private _aiFinishTime = 0;
    private readonly _aiFinishTimes = new Map<Swimmer, number>();
    private _lastCountdownValue = -1;
    private _diveResolved = false;

    startRace() {
        this.unscheduleAllCallbacks();
        this._countdownTimer = this.countdownSeconds;
        this._raceTimer = 0;
        this._playerFinished = false;
        this._playerFinishTime = 0;
        this._aiFinishTime = 0;
        this._aiFinishTimes.clear();
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
        this._playerFinishTime = 0;
        this._aiFinishTime = 0;
        this._aiFinishTimes.clear();
        this._lastCountdownValue = -1;
        this._diveResolved = false;
        this.playerSwimmer?.reset();
        for (const swimmer of this.activeAiSwimmers()) {
            swimmer.reset();
        }
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
        const aiSwimmers = this.activeAiSwimmers();

        this.onRaceTimerUpdate?.(this._raceTimer);
        this.onProgressUpdate?.(playerDist, aiDist);

        for (const swimmer of aiSwimmers) {
            if (!this._aiFinishTimes.has(swimmer) && swimmer.distance >= RACE_DISTANCE) {
                this._aiFinishTimes.set(swimmer, this._raceTimer);
                swimmer.stopRace();
            }
        }
        this._aiFinishTime = this.bestAiFinishTime();

        if (!this._playerFinished && playerDist >= RACE_DISTANCE) {
            this._playerFinished = true;
            this._playerFinishTime = this._raceTimer;
            this.playerSwimmer?.playFinishTouch();
            this.finishRace();
        }
    }

    private finishRace() {
        if (!this._playerFinished || this._state === GameState.FINISHED) {
            return;
        }
        const placement = this.calculatePlayerPlacement();
        for (const swimmer of this.activeAiSwimmers()) {
            swimmer.stopRace();
        }
        this.setState(GameState.FINISHED);
        this.onRaceFinished?.(
            placement.placement === 1,
            this._playerFinishTime,
            this._aiFinishTime,
            placement,
        );
    }

    private calculatePlayerPlacement(): RacePlacementSummary {
        const playerTime = this._playerFinishTime;
        let ahead = 0;
        for (const finishTime of this._aiFinishTimes.values()) {
            if (finishTime > 0 && playerTime > 0 && finishTime < playerTime - 0.0001) {
                ahead += 1;
            }
        }
        return {
            placement: ahead + 1,
            racerCount: this.activeAiSwimmers().length + 1,
        };
    }

    private bestAiFinishTime(): number {
        let best = Number.POSITIVE_INFINITY;
        for (const time of this._aiFinishTimes.values()) {
            best = Math.min(best, time);
        }
        return Number.isFinite(best) ? best : 0;
    }

    private activeAiSwimmers(): Swimmer[] {
        const swimmers: Swimmer[] = [];
        const add = (swimmer: Swimmer | null) => {
            if (swimmer && swimmer.node.active && swimmers.indexOf(swimmer) < 0) {
                swimmers.push(swimmer);
            }
        };
        add(this.aiSwimmer);
        for (const swimmer of this.aiSwimmers) {
            add(swimmer);
        }
        return swimmers;
    }

    private setState(state: GameState) {
        this._state = state;
        this.onStateChange?.(state);
    }

    get state(): GameState {
        return this._state;
    }
}
