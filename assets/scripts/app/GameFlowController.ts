import { Node } from 'cc';
import { RaceCameraDirector } from '../camera/RaceCameraDirector';
import { AISwimmerController } from '../entity/AISwimmerController';
import { Swimmer } from '../entity/Swimmer';
import { GameState, StrokeType } from '../core/GameConstants';
import { RaceManager } from '../core/RaceManager';
import { UIController } from '../ui/UIController';

export type GameFlowRefs = {
    raceManager: RaceManager;
    playerSwimmer: Swimmer;
    aiSwimmers: Swimmer[];
    aiControllers: AISwimmerController[];
    startScreen: Node;
    raceHud: Node;
    modelDebugHud: Node;
    uiController: UIController;
    raceCameraDirector: RaceCameraDirector;
    drawSpeedBar: (ratio: number) => void;
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
        this._refs.startScreen.active = false;
        this._refs.raceHud.active = true;
        this._refs.uiController?.resetAll();
        this._refs.raceManager?.resetRace();
        this.resetExtraAiSwimmers();
        this._refs.drawSpeedBar(0);
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
        this._refs.drawSpeedBar(0);
        this._refs.raceCameraDirector.resetToBroadcast();
        if (this._refs.raceHud) {
            this._refs.raceHud.active = false;
        }
        if (this._refs.modelDebugHud) {
            this._refs.modelDebugHud.active = false;
        }
        if (this._refs.startScreen) {
            this._refs.startScreen.active = true;
        }
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
            this._refs.uiController?.showRating(result.rating, result.combo);
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
            this._refs.uiController?.showDiveCharging();
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
        const effectiveHold = this._diveChargeStarted ? holdSeconds : 0.12;
        const power = this.calculateDivePower(effectiveHold);
        this._diveChargeStarted = false;
        this._refs.debug(`dive release hold=${effectiveHold.toFixed(2)} power=${power.toFixed(2)}`);
        this._refs.uiController?.showDiveRelease(power);
        this._refs.raceManager?.startFromDive(power);
    }

    bindRaceManagerCallbacks() {
        const raceManager = this._refs.raceManager;
        if (!raceManager) {
            return;
        }
        raceManager.onCountdownTick = (value) => this._refs.uiController?.showCountdown(value);
        raceManager.onStateChange = (state) => {
            this._refs.setState(state);
            this._refs.debug(`state=${state}`);
            if (state === GameState.COUNTDOWN) {
                this._diveChargeStarted = false;
                this._refs.raceCameraDirector.resetCountdownTimers();
            }
            if (state === GameState.DIVING) {
                if (this._diveChargeStarted) {
                    this._refs.uiController?.showDiveCharging();
                } else {
                    this._refs.uiController?.showDivePrompt();
                }
                this.prepareAndScheduleAiDives();
            }
            if (state === GameState.RACING) {
                this._refs.raceCameraDirector.resetRaceTimers();
                this._refs.uiController?.hideCountdown();
                this.startAllAi();
            }
        };
        raceManager.onRaceTimerUpdate = (time) => this._refs.uiController?.updateTimer(time);
        raceManager.onProgressUpdate = (playerDist, aiDist) => {
            this._refs.uiController?.updateProgress(playerDist, aiDist);
        };
        raceManager.onRaceFinished = (playerWin, playerTime, aiTime) => {
            this._refs.debug(`finished win=${playerWin} player=${playerTime.toFixed(2)} ai=${aiTime.toFixed(2)}`);
            this.stopAllAi();
            this._refs.uiController?.showResult(playerWin, playerTime, aiTime);
        };
        raceManager.onDiveReady = () => {
            if (this._diveChargeStarted) {
                this._refs.uiController?.showDiveCharging();
            } else {
                this._refs.uiController?.showDivePrompt();
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
            raceActive: this._refs.getState() === GameState.RACING,
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
                if (state !== GameState.DIVING && state !== GameState.RACING) {
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
        const difficulty = controller?.difficulty ?? 0.85;
        return Math.max(0.03, (1 - difficulty) * 0.34 + Math.random() * 0.12);
    }

    private aiDivePower(swimmer: Swimmer, controller: AISwimmerController | null): number {
        const powerScore = (swimmer.aiPower - 0.92) / 0.48;
        const difficulty = controller?.difficulty ?? 0.85;
        const variance = (Math.random() * 2 - 1) * 0.08;
        return Math.max(0.38, Math.min(0.96, powerScore * 0.62 + difficulty * 0.28 + variance));
    }

    private calculateDivePower(holdSeconds: number): number {
        const minHold = 0.08;
        const maxHold = 1.1;
        if (holdSeconds <= minHold) {
            return 0.18;
        }
        return Math.max(0.18, Math.min(1, (holdSeconds - minHold) / (maxHold - minHold)));
    }
}
