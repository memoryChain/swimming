import { _decorator, Component } from 'cc';
import { COUNTDOWN_SECONDS, FINISH_STRAGGLER_COUNTDOWN_SECONDS, GLIDE_SECONDS, getRaceDistance } from './GameBalance';
import { GameState } from './GameConstants';
import { scaledDelta } from './TimeScale';
import { Swimmer } from '../entity/Swimmer';
import { DiveResult } from './DiveResult';

const { ccclass, property } = _decorator;

export type RacePlacementSummary = {
    placement: number;
    racerCount: number;
    leaderboard?: RaceFinishResult[];
    playerEliminatedByShark?: boolean;
};

export type RaceFinishResult = {
    swimmer: Swimmer;
    name: string;
    placement: number;
    time: number;
    isPlayer: boolean;
    // false when the swimmer never reached the wall before the straggler
    // countdown ended (未完成 / DNF, sharing the last placement).
    finished: boolean;
};

@ccclass('RaceManager')
export class RaceManager extends Component {
    @property(Swimmer) public playerSwimmer: Swimmer = null;
    @property(Swimmer) public aiSwimmer: Swimmer = null;
    @property([Swimmer]) public aiSwimmers: Swimmer[] = [];
    @property public countdownSeconds = COUNTDOWN_SECONDS;

    public onCountdownTick: (value: number) => void = null;
    public onStateChange: (state: GameState) => void = null;
    public onProgressUpdate: (playerDist: number, aiDist: number) => void = null;
    public onRaceFinished: (playerWin: boolean, playerTime: number, aiTime: number, placement?: RacePlacementSummary) => void = null;
    public onSwimmerFinished: (result: RaceFinishResult) => void = null;
    public onFinishCountdownTick: (value: number) => void = null;
    public onDiveReady: () => void = null;
    public onSwimmerEliminated: ((swimmer: Swimmer) => void) | null = null;

    private _state = GameState.READY;
    private _countdownTimer = 0;
    private _raceTimer = 0;
    private _playerFinished = false;
    private _playerFinishTime = 0;
    private _aiFinishTime = 0;
    private readonly _aiFinishTimes = new Map<Swimmer, number>();
    private _lastCountdownValue = -1;
    private _diveResolved = false;
    private _finishCountdownActive = false;
    private _finishCountdownTimer = 0;
    private _lastFinishCountdownValue = -1;
    private readonly _eliminatedSwimmers = new Set<Swimmer>();
    private _playerEliminatedByShark = false;

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
        this._finishCountdownActive = false;
        this._finishCountdownTimer = 0;
        this._lastFinishCountdownValue = -1;
        this._eliminatedSwimmers.clear();
        this._playerEliminatedByShark = false;
        this.setState(GameState.COUNTDOWN);
        this.onCountdownTick?.(this._lastCountdownValue);
    }

    // Called when the shark catches a swimmer. Removes the swimmer from the
    // active race, fires onSwimmerEliminated, and - when the player was eaten -
    // ends the race immediately so the player can restart without waiting.
    eliminateSwimmer(swimmer: Swimmer) {
        if (this._state === GameState.FINISHED) {
            return;
        }
        if (this._eliminatedSwimmers.has(swimmer)) {
            return;
        }
        this._eliminatedSwimmers.add(swimmer);
        swimmer.eliminateByShark();
        this.onSwimmerEliminated?.(swimmer);

        if (swimmer === this.playerSwimmer) {
            this._playerEliminatedByShark = true;
            this.finishRace();
        }
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
        this._finishCountdownActive = false;
        this._finishCountdownTimer = 0;
        this._lastFinishCountdownValue = -1;
        this._eliminatedSwimmers.clear();
        this._playerEliminatedByShark = false;
        this.playerSwimmer?.reset();
        for (const swimmer of this.activeAiSwimmers()) {
            swimmer.reset();
        }
        this.onProgressUpdate?.(0, 0);
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
        this.onProgressUpdate?.(this.playerSwimmer?.distance ?? 0, this.aiSwimmer?.distance ?? 0);
    }

    private updateGliding(dt: number) {
        this._raceTimer += dt;
        this.onProgressUpdate?.(this.playerSwimmer?.distance ?? 0, this.aiSwimmer?.distance ?? 0);
    }

    private updateRacing(dt: number) {
        this._raceTimer += dt;
        const playerDist = this.playerSwimmer?.distance ?? 0;
        const aiDist = this.aiSwimmer?.distance ?? 0;
        const aiSwimmers = this.activeAiSwimmers();
        const activeRacers = this.activeRacers();

        this.onProgressUpdate?.(playerDist, aiDist);

        for (const swimmer of aiSwimmers) {
            if (this._eliminatedSwimmers.has(swimmer)) {
                continue;
            }
            if (!this._aiFinishTimes.has(swimmer) && swimmer.distance >= getRaceDistance()) {
                this._aiFinishTimes.set(swimmer, this._raceTimer);
                swimmer.playFinishTouch();
                this.emitSwimmerFinished(swimmer, this._raceTimer);
            }
        }
        this._aiFinishTime = this.bestAiFinishTime();

        if (!this._playerFinished && playerDist >= getRaceDistance()) {
            this._playerFinished = true;
            this._playerFinishTime = this._raceTimer;
            this.playerSwimmer?.playFinishTouch();
            if (this.playerSwimmer) {
                this.emitSwimmerFinished(this.playerSwimmer, this._raceTimer);
            }
        }

        // The moment the first racer touches the wall, give everyone else a
        // fixed window to also finish.
        if (!this._finishCountdownActive && this._finishTimes.size >= 1) {
            this.startFinishCountdown();
        }
        if (this._finishCountdownActive) {
            this._finishCountdownTimer -= dt;
            const value = Math.max(0, Math.ceil(this._finishCountdownTimer));
            if (value !== this._lastFinishCountdownValue) {
                this._lastFinishCountdownValue = value;
                this.onFinishCountdownTick?.(value);
            }
        }

        const everyoneFinished = this._finishTimes.size >= activeRacers.length;
        const countdownExpired = this._finishCountdownActive && this._finishCountdownTimer <= 0;
        if (everyoneFinished || countdownExpired) {
            this.finishRace();
        }
    }

    private startFinishCountdown() {
        this._finishCountdownActive = true;
        this._finishCountdownTimer = FINISH_STRAGGLER_COUNTDOWN_SECONDS;
        this._lastFinishCountdownValue = Math.ceil(this._finishCountdownTimer);
        this.onFinishCountdownTick?.(this._lastFinishCountdownValue);
    }

    private finishRace() {
        if (this._state === GameState.FINISHED) {
            return;
        }
        this._finishCountdownActive = false;
        const placement = this.calculatePlayerPlacement();
        this.setState(GameState.FINISHED);
        this.onRaceFinished?.(
            this._playerFinished && placement.placement === 1,
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
            playerEliminatedByShark: this._playerEliminatedByShark,
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
        if (this.playerSwimmer?.node.active && !this._eliminatedSwimmers.has(this.playerSwimmer)) {
            racers.push(this.playerSwimmer);
        }
        for (const swimmer of this.activeAiSwimmers()) {
            if (this._eliminatedSwimmers.has(swimmer)) {
                continue;
            }
            if (racers.indexOf(swimmer) < 0) {
                racers.push(swimmer);
            }
        }
        return racers;
    }

    // All racers including eliminated ones. Used for the final leaderboard so an
    // eliminated swimmer still appears in the standings (marked DNF).
    private allRacers(): Swimmer[] {
        const racers = this.activeRacers();
        for (const swimmer of this._eliminatedSwimmers) {
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
            finished: true,
        };
        this.onSwimmerFinished?.(result);
    }

    private finishLeaderboard(): RaceFinishResult[] {
        const finishers: RaceFinishResult[] = [];
        const unfinished: RaceFinishResult[] = [];
        for (const swimmer of this.allRacers()) {
            const time = this._finishTimes.get(swimmer) ?? (swimmer === this.playerSwimmer ? this._playerFinishTime : this._aiFinishTimes.get(swimmer)) ?? 0;
            const isPlayer = swimmer === this.playerSwimmer;
            if (time > 0) {
                finishers.push({ swimmer, name: swimmer.swimmerName, placement: 0, time, isPlayer, finished: true });
            } else {
                unfinished.push({ swimmer, name: swimmer.swimmerName, placement: 0, time: 0, isPlayer, finished: false });
            }
        }
        finishers.sort((a, b) => a.time - b.time);
        for (let i = 0; i < finishers.length; i++) {
            finishers[i].placement = i + 1;
        }
        // Swimmers still in the water when the countdown ended are 未完成 and share
        // the single placement right after the last finisher.
        const lastPlacement = finishers.length + 1;
        for (const row of unfinished) {
            row.placement = lastPlacement;
        }
        return [...finishers, ...unfinished];
    }

    private setState(state: GameState) {
        this._state = state;
        this.onStateChange?.(state);
    }

    get state(): GameState {
        return this._state;
    }
}
