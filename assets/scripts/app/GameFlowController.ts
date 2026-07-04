import { Vec3 } from 'cc';
import { RaceCameraDirector } from '../camera/RaceCameraDirector';
import { AISwimmerController } from '../entity/AISwimmerController';
import { Swimmer } from '../entity/Swimmer';
import { DIVE_BALANCE, getRaceDistance } from '../core/GameBalance';
import { GameState, Rating, StrokeType } from '../core/GameConstants';
import { RaceFinishResult, RaceManager, RacePlacementSummary } from '../core/RaceManager';
import { resolveDiveResult } from '../core/DiveResolver';
import { DiveResult } from '../core/DiveResult';
import { SprintTier } from '../condition/ConditionTypes';
import { formatStabilityLog } from '../core/StabilityScoring';
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
    handleModelDebugStrokeHeld: (type: StrokeType, held: boolean) => boolean;
    setState: (state: GameState) => void;
    getState: () => GameState;
    clearFinishRanks: () => void;
    showFinishRank: (result: RaceFinishResult) => void;
    applyPlayerDive: (result: DiveResult) => void;
    enterSprint: () => void;
    updateSprintTier: (tier: SprintTier) => void;
    debug: (message: string) => void;
};

const SPRINT_TRIGGER_FRACTION = 0.85;

// Sprint effort -> tier thresholds (doc 19.8). The flow layer reads the player's
// sustained effort during SPRINT and interprets it as STEADY / PUSH / GAMBLE.
const SPRINT_PUSH_EFFORT = 0.6;
const SPRINT_GAMBLE_EFFORT = 0.85;

export class GameFlowController {
    private _diveChargeStarted = false;
    private _diveChargeElapsed = 0;
    private _diveChargePower = 0;
    private _diveCommitted = false;
    private _sprintTriggered = false;
    private _lastSprintTier: SprintTier = SprintTier.STEADY;
    private readonly _aiDiveTimerIds: ReturnType<typeof setTimeout>[] = [];
    private readonly _playerUpperBodyWorldPosition = new Vec3();

    constructor(private readonly _refs: GameFlowRefs) {}

    startGame() {
        this._refs.debug('startGame');
        this.clearAiDiveTimers();
        this.resetDiveCharge();
        this._sprintTriggered = false;
        this._lastSprintTier = SprintTier.STEADY;
        this._refs.clearFinishRanks();
        this._refs.exitModelDebug(false);
        this._refs.uiFlow.showRaceHud();
        this._refs.raceManager?.resetRace();
        this.resetExtraAiSwimmers();
        this._refs.raceCameraDirector.resetToBroadcast();
        this._refs.raceCameraDirector.startPreCountdownOrbit();
        this._refs.setState(GameState.PRECOUNTDOWN);
    }

    restartGame() {
        this._refs.debug('restartGame');
        this.stopAllAi();
        this.startGame();
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
            this._refs.debug(`stroke=${type} rating=${result.rating} badReason=${result.badReason ?? 'none'} combo=${result.combo}`);
            this.triggerPerfectFeedback(result.rating);
            this._refs.uiFlow.showRating(result.rating, result.combo);
        }
    }

    handlePlayerStrokeHeld(type: StrokeType, held: boolean) {
        if (this._refs.handleModelDebugStrokeHeld(type, held)) {
            return;
        }
        if (this._refs.getState() !== GameState.RACING) {
            return;
        }
        const result = this._refs.playerSwimmer?.handleStrokeHeld(type, held);
        if (result) {
            this._refs.debug(formatStabilityLog(`hold=${type}`, result));
            this.triggerPerfectFeedback(result.rating);
            this._refs.uiFlow.showRating(result.rating, result.combo);
        }
    }

    handleDiveChargeStart() {
        const state = this._refs.getState();
        if ((state !== GameState.COUNTDOWN && state !== GameState.DIVING) || this._diveChargeStarted) {
            return;
        }
        this._diveChargeStarted = true;
        this._diveChargeElapsed = 0;
        this._diveChargePower = 0;
        this._refs.uiFlow.updateDiveCharge(this._diveChargePower, true);
        this._refs.debug('dive charging');
        if (state === GameState.DIVING) {
            this._refs.uiFlow.showDiveCharging();
        }
    }

    handleDiveRelease(holdSeconds: number) {
        if (this._diveCommitted) {
            return;
        }
        if (this._refs.getState() === GameState.COUNTDOWN) {
            this.resetDiveCharge();
            this._refs.debug('dive charge cancelled before start');
            return;
        }
        if (this._refs.getState() !== GameState.DIVING) {
            return;
        }
        const charge = this._diveChargeStarted ? this._diveChargePower : 0;
        this.commitDive(charge, `release hold=${holdSeconds.toFixed(2)}`);
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
                this.resetDiveCharge();
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
        raceManager.onSwimmerFinished = (result) => {
            this._refs.debug(`finish ${result.name} place=${result.placement} time=${result.time.toFixed(2)}`);
            this._refs.showFinishRank(result);
        };
        raceManager.onRaceFinished = (playerWin, playerTime, aiTime, placementSummary) => {
            this._refs.debug(`finished win=${playerWin} player=${playerTime.toFixed(2)} ai=${aiTime.toFixed(2)}`);
            this.stopAllAi();
            const rhythm = this._refs.playerSwimmer?.rhythmStats;
            const placement = placementSummary ?? this.calculatePlayerPlacement();
            this._refs.uiFlow.showResult(playerWin, playerTime, aiTime, {
                averageSpeed: playerTime > 0 ? getRaceDistance() / playerTime : 0,
                maxCombo: rhythm?.maxCombo ?? 0,
                perfectCount: rhythm?.perfectCount ?? 0,
                goodCount: rhythm?.goodCount ?? 0,
                missCount: rhythm?.missCount ?? 0,
                placement: placement.placement,
                racerCount: placement.racerCount,
                leaderboard: placement.leaderboard,
            });
        };
        raceManager.onDiveReady = () => {
            if (this._diveChargeStarted) {
                this.commitDive(this._diveChargePower, 'countdown-end auto');
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
        raceManager.onSwimmerFinished = null;
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
        this.updateDiveCharge(dt);
        const playerSwimmer = this._refs.playerSwimmer;
        if (!playerSwimmer) {
            return;
        }
        const playerDistance = playerSwimmer.distance;
        if (!this._sprintTriggered
            && this._refs.getState() === GameState.RACING
            && playerDistance >= getRaceDistance() * SPRINT_TRIGGER_FRACTION) {
            this._sprintTriggered = true;
            this._refs.enterSprint();
            this._refs.debug('sprint phase entered');
        }

        if (this._sprintTriggered && this._refs.getState() === GameState.RACING) {
            this.updateSprintTier(playerSwimmer.effortScore);
        }
        const placement = this.calculatePlayerPlacement();
        this._refs.uiFlow.updatePlacement(placement.placement, placement.racerCount);
        this._refs.raceCameraDirector.update(dt, {
            playerX: playerSwimmer.node.position.x,
            playerY: playerSwimmer.node.position.y,
            playerUpperBodyWorldPosition: playerSwimmer.getCameraUpperBodyWorldPosition(this._playerUpperBodyWorldPosition),
            playerDistance,
            playerUnderwater: playerSwimmer.isUnderwater,
            closestAiDistanceGap: this.closestAiDistanceGap(playerDistance),
            playerPlacement: placement.placement,
            racerCount: placement.racerCount,
            raceActive: this._refs.getState() === GameState.RACING || this._refs.getState() === GameState.GLIDING,
            countdownActive: this._refs.getState() === GameState.COUNTDOWN || this._refs.getState() === GameState.DIVING,
        });
        if (this._refs.getState() === GameState.PRECOUNTDOWN && this._refs.raceCameraDirector.consumePreCountdownReady()) {
            this._refs.debug('pre-countdown camera ready');
            this._refs.raceManager?.startRace();
        }
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
            const diveResult = resolveDiveResult(power);
            const timerId = setTimeout(() => {
                const state = this._refs.getState();
                if (state !== GameState.DIVING && state !== GameState.GLIDING && state !== GameState.RACING) {
                    return;
                }
                swimmer.performDive(diveResult);
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

    private updateDiveCharge(dt: number) {
        const state = this._refs.getState();
        if (!this._diveChargeStarted || (state !== GameState.COUNTDOWN && state !== GameState.DIVING)) {
            return;
        }
        this._diveChargeElapsed += Math.max(0, dt);
        this._diveChargePower = diveChargePingPong(this._diveChargeElapsed);
        this._refs.uiFlow.updateDiveCharge(this._diveChargePower, true);
    }

    private resetDiveCharge() {
        this._diveChargeStarted = false;
        this._diveChargeElapsed = 0;
        this._diveChargePower = 0;
        this._diveCommitted = false;
        this._refs.uiFlow.updateDiveCharge(0, false);
    }

    private commitDive(charge: number, reason: string) {
        if (this._diveCommitted || this._refs.getState() !== GameState.DIVING) {
            return;
        }
        const power = this.calculateDivePower(charge);
        this._diveCommitted = true;
        this._diveChargeStarted = false;
        this._refs.debug(`dive commit reason=${reason} charge=${charge.toFixed(2)} power=${power.toFixed(2)}`);
        this._refs.uiFlow.showDiveRelease(power);
        this._refs.raceCameraDirector.startDiveShot();
        const diveResult = resolveDiveResult(power);
        this._refs.applyPlayerDive(diveResult);
        this._refs.raceManager?.startFromDive(diveResult);
    }

    private calculateDivePower(charge: number): number {
        return Math.max(DIVE_BALANCE.minPower, Math.min(1, DIVE_BALANCE.minPower + clamp01(charge) * (1 - DIVE_BALANCE.minPower)));
    }

    private triggerPerfectFeedback(rating: Rating) {
        if (rating === Rating.PERFECT) {
            this._refs.playerSwimmer?.playPerfectFlash();
        }
    }

    // Interpret sustained sprint effort into a tier and push it only on change
    // (doc 19: flow layer drives sprintTier; STEADY/PUSH/GAMBLE).
    private updateSprintTier(effort: number) {
        let tier = SprintTier.STEADY;
        if (effort >= SPRINT_GAMBLE_EFFORT) {
            tier = SprintTier.GAMBLE;
        } else if (effort >= SPRINT_PUSH_EFFORT) {
            tier = SprintTier.PUSH;
        }
        if (tier !== this._lastSprintTier) {
            this._lastSprintTier = tier;
            this._refs.updateSprintTier(tier);
            this._refs.debug(`sprint tier=${tier}`);
        }
    }

    private calculatePlayerPlacement(): RacePlacementSummary {
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

function diveChargePingPong(seconds: number): number {
    const cycle = Math.max(0.1, DIVE_BALANCE.chargeCycleSeconds);
    const phase = (seconds % cycle) / cycle;
    return phase <= 0.5 ? phase * 2 : (1 - phase) * 2;
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}
