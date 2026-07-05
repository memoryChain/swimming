import { _decorator, Component } from 'cc';
import { COUNTDOWN_SECONDS, GLIDE_SECONDS, getRaceDistance } from './GameBalance';
import { GameState } from './GameConstants';
import { scaledDelta } from './TimeScale';
import { Swimmer } from '../entity/Swimmer';
import { DiveResult } from './DiveResult';

const { ccclass, property } = _decorator;

export type RacePlacementSummary = {
    placement: number;
    racerCount: number;
    leaderboard?: RaceFinishResult[];
};

export type RaceFinishResult = {
    swimmer: Swimmer;
    name: string;
    placement: number;
    time: number;
    isPlayer: boolean;
};

@ccclass('RaceManager')
export class RaceManager extends Component {
    @property(Swimmer) public playerSwimmer: Swimmer = null;
    @property(Swimmer) public aiSwimmer: Swimmer = null;
    @property([Swimmer]) public aiSwimmers: Swimmer[] = [];
    @property public countdownSeconds = COUNTDOWN_SECONDS;
    // Free-swim debug mode: no finish, swim endlessly back and forth.
    public endlessMode = false;

    public onCountdownTick: (value: number) => void = null;
    public onStateChange: (state: GameState) => void = null;
    public onRaceTimerUpdate: (time: number) => void = null;
    public onProgressUpdate: (playerDist: number, aiDist: number) => void = null;
    public onRaceFinished: (playerWin: boolean, playerTime: number, aiTime: number, placement?: RacePlacementSummary) => void = null;
    public onSwimmerFinished: (result: RaceFinishResult) => void = null;
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
        this._finishTimes.clear();
        this._lastCountdownValue = Math.ceil(this._countdownTimer);
        this._diveResolved = false;
        this.setState(GameState.COUNTDOWN);
        this.onCountdownTick?.(this._lastCountdownValue);
    }

    update(dt: number) {
        dt = scaledDelta(dt);
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
        this._finishTimes.clear();
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

        if (this._countdownTimer <= 0) {
            this.playerSwimmer?.prepareDive();
            this.setState(GameState.DIVING);
            this.onDiveReady?.();
        }
    }

    startFromDive(result: DiveResult) {
        if (this._state !== GameState.DIVING || this._diveResolved) {
            return;
        }
        this._diveResolved = true;
        const playerDuration = this.playerSwimmer?.performDive(result) ?? 0;
        this.scheduleOnce(() => {
            if (this._state === GameState.DIVING && this._diveResolved) {
                this.setState(GameState.GLIDING);
                this.scheduleOnce(() => {
                    if (this._state === GameState.GLIDING && this._diveResolved) {
                        this.setState(GameState.RACING);
                    }
                }, GLIDE_SECONDS);
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
        const activeRacers = this.activeRacers();

        this.onRaceTimerUpdate?.(this._raceTimer);
        this.onProgressUpdate?.(playerDist, aiDist);

        for (const swimmer of aiSwimmers) {
            if (!this._aiFinishTimes.has(swimmer) && swimmer.distance >= getRaceDistance()) {
                this._aiFinishTimes.set(swimmer, this._raceTimer);
                swimmer.playFinishTouch();
                this.emitSwimmerFinished(swimmer, this._raceTimer);
            }
        }
        this._aiFinishTime = this.bestAiFinishTime();

        if (!this.endlessMode && !this._playerFinished && playerDist >= getRaceDistance()) {
            this._playerFinished = true;
            this._playerFinishTime = this._raceTimer;
            this.playerSwimmer?.playFinishTouch();
            if (this.playerSwimmer) {
                this.emitSwimmerFinished(this.playerSwimmer, this._raceTimer);
            }
        }

        if (!this.endlessMode && this._playerFinished && this._finishTimes.size >= activeRacers.length) {
            this.finishRace();
        }
    }

    private finishRace() {
        if (!this._playerFinished || this._state === GameState.FINISHED) {
            return;
        }
        const placement = this.calculatePlayerPlacement();
        this.setState(GameState.FINISHED);
        this.onRaceFinished?.(
            placement.placement === 1,
            this._playerFinishTime,
            this._aiFinishTime,
            placement,
        );
    }

    private calculatePlayerPlacement(): RacePlacementSummary {
        const leaderboard = this.finishLeaderboard();
        const playerRow = leaderboard.find((row) => row.isPlayer);
        return {
            placement: playerRow?.placement ?? leaderboard.length,
            racerCount: leaderboard.length,
            leaderboard,
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

    private readonly _finishTimes = new Map<Swimmer, number>();

    private activeRacers(): Swimmer[] {
        const racers: Swimmer[] = [];
        if (this.playerSwimmer?.node.active) {
            racers.push(this.playerSwimmer);
        }
        for (const swimmer of this.activeAiSwimmers()) {
            if (racers.indexOf(swimmer) < 0) {
                racers.push(swimmer);
            }
        }
        return racers;
    }

    private emitSwimmerFinished(swimmer: Swimmer, time: number) {
        if (this._finishTimes.has(swimmer)) {
            return;
        }
        this._finishTimes.set(swimmer, time);
        const result: RaceFinishResult = {
            swimmer,
            name: swimmer.swimmerName,
            placement: this.finishLeaderboard().find((row) => row.swimmer === swimmer)?.placement ?? this._finishTimes.size,
            time,
            isPlayer: swimmer === this.playerSwimmer,
        };
        this.onSwimmerFinished?.(result);
    }

    private finishLeaderboard(): RaceFinishResult[] {
        const rows: RaceFinishResult[] = [];
        for (const swimmer of this.activeRacers()) {
            const time = this._finishTimes.get(swimmer) ?? (swimmer === this.playerSwimmer ? this._playerFinishTime : this._aiFinishTimes.get(swimmer)) ?? 0;
            if (time <= 0) {
                continue;
            }
            rows.push({
                swimmer,
                name: swimmer.swimmerName,
                placement: 0,
                time,
                isPlayer: swimmer === this.playerSwimmer,
            });
        }
        rows.sort((a, b) => a.time - b.time);
        for (let i = 0; i < rows.length; i++) {
            rows[i].placement = i + 1;
        }
        return rows;
    }

    private setState(state: GameState) {
        this._state = state;
        this.onStateChange?.(state);
    }

    get state(): GameState {
        return this._state;
    }
}
