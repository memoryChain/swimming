import { RaceCameraDirector } from '../camera/RaceCameraDirector';
import { AISwimmerController } from '../entity/AISwimmerController';
import { Swimmer } from '../entity/Swimmer';
import { DIVE_BALANCE, RACE_DISTANCE } from '../core/GameBalance';
import { GameState, StrokeType } from '../core/GameConstants';
import { RaceManager } from '../core/RaceManager';
import { UIFlowController } from '../ui/UIFlowController';

export type GameFlowRefs = {
    raceManager: RaceManager;
    playerSwimmer: Swimmer;
    aiSwimmers: Swimmer[];
    aiControllers: AISwimmerController[];
    uiFlow: UIFlowController;
    raceCameraDirector: RaceCameraDirector;
    exitModelDebug: (showStart: boolean) => void;
    handleModelDebugStroke: (type: StrokeType) => boolean;
    setState: (state: GameState) => void;
    getState: () => GameState;
    debug: (message: string) => void;
};

export class GameFlowController {
    private _diveChargeStarted = false;
    private readonly _aiDiveTimerIds: ReturnType<typeof setTimeout>[] = [];

    constructor(private readonly _refs: GameFlowRefs) {}

    startGame() {
        this._refs.debug('startGame');
        this.clearAiDiveTimers();
        this._refs.exitModelDebug(false);
        this._refs.uiFlow.showRaceHud();
        this._refs.raceManager?.resetRace();
        this.resetExtraAiSwimmers();
        this._refs.raceCameraDirector.resetToBroadcast();
        this._refs.raceManager?.startRace();
    }

    restartGame() {
        this._refs.debug('restartGame');
        this.stopAllAi();
        this.startGame();
    }

    showStartScreen() {
        this._refs.debug('showStartScreen');
        this._refs.setState(GameState.READY);
        this.stopAllAi();
        this._refs.raceManager?.resetRace();
        this.resetExtraAiSwimmers();
        this._refs.uiFlow.resetSpeedBar();
        this._refs.raceCameraDirector.resetToBroadcast();
        this._refs.uiFlow.showStartScreen();
    }

    handlePrimaryAction() {
        const state = this._refs.getState();
        if (state === GameState.READY) {
            this.startGame();
        } else if (state === GameState.FINISHED) {
            this.restartGame();
        }
    }

    handlePlayerStroke(type: StrokeType) {
        if (this._refs.handleModelDebugStroke(type)) {
            return;
        }
        if (this._refs.getState() !== GameState.RACING) {
            return;
        }
        const result = this._refs.playerSwimmer?.handleStroke(type);
        if (result) {
            this._refs.debug(`stroke=${type} rating=${result.rating} combo=${result.combo}`);
            this._refs.uiFlow.showRating(result.rating, result.combo);
        }
    }

    handleDiveChargeStart() {
        const state = this._refs.getState();
        if ((state !== GameState.COUNTDOWN && state !== GameState.DIVING) || this._diveChargeStarted) {
            return;
        }
        this._diveChargeStarted = true;
        this._refs.debug('dive charging');
        if (state === GameState.DIVING) {
            this._refs.uiFlow.showDiveCharging();
        }
    }

    handleDiveRelease(holdSeconds: number) {
        if (this._refs.getState() === GameState.COUNTDOWN) {
            this._diveChargeStarted = false;
            this._refs.debug('dive charge cancelled before start');
            return;
        }
        if (this._refs.getState() !== GameState.DIVING) {
            return;
        }
        const effectiveHold = this._diveChargeStarted ? holdSeconds : DIVE_BALANCE.defaultFallbackHoldSeconds;
        const power = this.calculateDivePower(effectiveHold);
        this._diveChargeStarted = false;
        this._refs.debug(`dive release hold=${effectiveHold.toFixed(2)} power=${power.toFixed(2)}`);
        this._refs.uiFlow.showDiveRelease(power);
        this._refs.raceManager?.startFromDive(power);
    }

    bindRaceManagerCallbacks() {
        const raceManager = this._refs.raceManager;
        if (!raceManager) {
            return;
        }
        raceManager.onCountdownTick = (value) => this._refs.uiFlow.showCountdown(value);
        raceManager.onStateChange = (state) => {
            this._refs.setState(state);
            this._refs.debug(`state=${state}`);
            if (state === GameState.COUNTDOWN) {
                this._diveChargeStarted = false;
                this._refs.raceCameraDirector.resetCountdownTimers();
            }
            if (state === GameState.DIVING) {
                if (this._diveChargeStarted) {
                    this._refs.uiFlow.showDiveCharging();
                } else {
                    this._refs.uiFlow.showDivePrompt();
                }
                this.prepareAndScheduleAiDives();
            }
            if (state === GameState.GLIDING) {
                this._refs.raceCameraDirector.resetRaceTimers();
                this._refs.uiFlow.showGliding();
            }
            if (state === GameState.RACING) {
                this._refs.uiFlow.hideCountdown();
                this.startAllAi();
            }
        };
        raceManager.onRaceTimerUpdate = (time) => this._refs.uiFlow.updateTimer(time);
        raceManager.onProgressUpdate = (playerDist, aiDist) => {
            this._refs.uiFlow.updateProgress(playerDist, aiDist);
        };
        raceManager.onRaceFinished = (playerWin, playerTime, aiTime) => {
            this._refs.debug(`finished win=${playerWin} player=${playerTime.toFixed(2)} ai=${aiTime.toFixed(2)}`);
            this.stopAllAi();
            const rhythm = this._refs.playerSwimmer?.rhythmStats;
            const placement = this.calculatePlayerPlacement();
            this._refs.uiFlow.showResult(playerWin, playerTime, aiTime, {
                averageSpeed: playerTime > 0 ? RACE_DISTANCE / playerTime : 0,
                maxCombo: rhythm?.maxCombo ?? 0,
                perfectCount: rhythm?.perfectCount ?? 0,
                goodCount: rhythm?.goodCount ?? 0,
                missCount: rhythm?.missCount ?? 0,
                placement: placement.placement,
                racerCount: placement.racerCount,
            });
        };
        raceManager.onDiveReady = () => {
            if (this._diveChargeStarted) {
                this._refs.uiFlow.showDiveCharging();
            } else {
                this._refs.uiFlow.showDivePrompt();
            }
        };
    }

    clearRaceManagerCallbacks() {
        const raceManager = this._refs.raceManager;
        if (!raceManager) {
            return;
        }
        raceManager.onCountdownTick = null;
        raceManager.onStateChange = null;
        raceManager.onRaceTimerUpdate = null;
        raceManager.onProgressUpdate = null;
        raceManager.onRaceFinished = null;
        raceManager.onDiveReady = null;
    }

    cycleRaceCamera(): string {
        return this._refs.raceCameraDirector.cycleMode();
    }

    toggleFreeRaceCamera(): string {
        return this._refs.raceCameraDirector.toggleFreeMode();
    }

    updateRaceCamera(dt: number) {
        const playerSwimmer = this._refs.playerSwimmer;
        if (!playerSwimmer) {
            return;
        }
        const playerDistance = playerSwimmer.distance;
        this._refs.raceCameraDirector.update(dt, {
            playerX: playerSwimmer.node.position.x,
            playerDistance,
            closestAiDistanceGap: this.closestAiDistanceGap(playerDistance),
            raceActive: this._refs.getState() === GameState.RACING || this._refs.getState() === GameState.GLIDING,
            countdownActive: this._refs.getState() === GameState.COUNTDOWN || this._refs.getState() === GameState.DIVING,
        });
    }

    resetExtraAiSwimmers() {
        for (const swimmer of this._refs.aiSwimmers) {
            if (swimmer !== this._refs.raceManager?.aiSwimmer) {
                swimmer.reset();
            }
        }
    }

    startAllAi() {
        for (const controller of this._refs.aiControllers) {
            controller.startSwimming();
        }
    }

    stopAllAi() {
        this.clearAiDiveTimers();
        for (const controller of this._refs.aiControllers) {
            controller.stopSwimming();
        }
    }

    private closestAiDistanceGap(playerDistance: number): number {
        let gap = Number.POSITIVE_INFINITY;
        for (const swimmer of this._refs.aiSwimmers) {
            if (swimmer.node.active) {
                gap = Math.min(gap, Math.abs(swimmer.distance - playerDistance));
            }
        }
        return gap;
    }

    private prepareAndScheduleAiDives() {
        this.clearAiDiveTimers();
        for (let i = 0; i < this._refs.aiSwimmers.length; i++) {
            const swimmer = this._refs.aiSwimmers[i];
            swimmer.prepareDive();
            const controller = this._refs.aiControllers[i];
            const delayMs = Math.round(this.aiDiveReactionDelay(controller) * 1000);
            const power = this.aiDivePower(swimmer, controller);
            const timerId = setTimeout(() => {
                const state = this._refs.getState();
                if (state !== GameState.DIVING && state !== GameState.GLIDING && state !== GameState.RACING) {
                    return;
                }
                swimmer.performDive(power);
                this._refs.debug(`ai dive ${swimmer.swimmerName} power=${power.toFixed(2)} delay=${(delayMs / 1000).toFixed(2)}`);
            }, delayMs);
            this._aiDiveTimerIds.push(timerId);
        }
    }

    private clearAiDiveTimers() {
        while (this._aiDiveTimerIds.length > 0) {
            clearTimeout(this._aiDiveTimerIds.pop());
        }
    }

    private aiDiveReactionDelay(controller: AISwimmerController | null): number {
        const baseReaction = controller?.diveReaction ?? DIVE_BALANCE.defaultAiReactionSeconds;
        return Math.max(0.03, baseReaction + Math.random() * DIVE_BALANCE.aiReactionRandomSeconds);
    }

    private aiDivePower(swimmer: Swimmer, controller: AISwimmerController | null): number {
        const basePower = controller?.divePower ?? DIVE_BALANCE.defaultAiPower;
        const variance = (Math.random() * 2 - 1) * DIVE_BALANCE.aiPowerVariance;
        return Math.max(DIVE_BALANCE.aiPowerMin, Math.min(DIVE_BALANCE.aiPowerMax, basePower + variance));
    }

    private calculateDivePower(holdSeconds: number): number {
        const minHold = DIVE_BALANCE.minHoldSeconds;
        const maxHold = DIVE_BALANCE.maxHoldSeconds;
        if (holdSeconds <= minHold) {
            return DIVE_BALANCE.minPower;
        }
        return Math.max(DIVE_BALANCE.minPower, Math.min(1, (holdSeconds - minHold) / (maxHold - minHold)));
    }

    private calculatePlayerPlacement(): { placement: number; racerCount: number } {
        const player = this._refs.playerSwimmer;
        const racers = [
            { isPlayer: true, distance: player?.distance ?? 0 },
            ...this._refs.aiSwimmers
                .filter((swimmer) => swimmer.node.active)
                .map((swimmer) => ({ isPlayer: false, distance: swimmer.distance })),
        ];
        racers.sort((a, b) => b.distance - a.distance);
        const placement = racers.findIndex((racer) => racer.isPlayer) + 1;
        return {
            placement: placement > 0 ? placement : racers.length,
            racerCount: racers.length,
        };
    }
}
