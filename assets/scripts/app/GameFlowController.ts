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
    constructor(private readonly _refs: GameFlowRefs) {}

    startGame() {
        this._refs.debug('startGame');
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
                this._refs.raceCameraDirector.resetCountdownTimers();
            }
            if (state === GameState.RACING) {
                this._refs.raceCameraDirector.resetRaceTimers();
                this._refs.uiController?.hideCountdown();
                this.startExtraAiSwimmers();
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
            countdownActive: this._refs.getState() === GameState.COUNTDOWN,
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
        for (const controller of this._refs.aiControllers) {
            controller.stopSwimming();
        }
    }

    private startExtraAiSwimmers() {
        for (const swimmer of this._refs.aiSwimmers) {
            if (swimmer !== this._refs.raceManager?.aiSwimmer) {
                swimmer.startRace();
            }
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
}
