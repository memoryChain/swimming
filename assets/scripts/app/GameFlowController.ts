import { Vec3 } from 'cc';
import { RaceCameraDirector, RaceCameraMode, RaceCameraSnapshot } from '../camera/RaceCameraDirector';
import { AISwimmerController } from '../entity/AISwimmerController';
import { Swimmer } from '../entity/Swimmer';
import { DIVE_BALANCE, getRaceDistance } from '../core/GameBalance';
import { STEERING_TUNING } from '../core/SteeringTuning';
import { GameState, StrokeType } from '../core/GameConstants';
import { RaceFinishResult, RaceManager, RacePlacementSummary } from '../core/RaceManager';
import { resolveDiveResult } from '../core/DiveResolver';
import { DiveResult } from '../core/DiveResult';
import { SprintTier } from '../condition/ConditionTypes';
import { CHARACTER_ACTION_CONFIG, selectAdjacentDistinctActions } from '../character/CharacterActionConfig';
import { RACE_PHASE_BALANCE } from '../core/ConditionBalance';
import { UIFlowController } from '../ui/UIFlowController';
import { StrokeSfxManager } from './StrokeSfxManager';

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
    handleModelDebugKickStroke: (type: StrokeType) => boolean;
    setState: (state: GameState) => void;
    getState: () => GameState;
    clearFinishRanks: () => void;
    showFinishRank: (result: RaceFinishResult) => void;
    showAwards: (leaderboard: RaceFinishResult[]) => void;
    applyPlayerDive: (result: DiveResult) => void;
    enterSprint: () => void;
    updateSprintTier: (tier: SprintTier) => void;
    updateScoreboardFeed?: (dt: number, snapshot: RaceCameraSnapshot) => void;
    debug: (message: string) => void;
};

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
    private _cameraFollowAi = false;
    // Once the player surfaces after the dive, switch the swim view to the
    // behind-the-swimmer sprint chase so the steering weave reads clearly.
    private _swimSprintViewApplied = false;
    private readonly _aiDiveTimerIds: ReturnType<typeof setTimeout>[] = [];
    private readonly _playerUpperBodyWorldPosition = new Vec3();

    constructor(private readonly _refs: GameFlowRefs) {}

    startGame() {
        this._refs.debug('startGame');
        StrokeSfxManager.preload();
        this.clearAiDiveTimers();
        this.resetDiveCharge();
        this._sprintTriggered = false;
        this._lastSprintTier = SprintTier.STEADY;
        this._swimSprintViewApplied = false;
        this._refs.clearFinishRanks();        this._refs.exitModelDebug(false);
        this._refs.uiFlow.showRaceHud();
        this._refs.raceManager?.resetRace();
        this.resetExtraAiSwimmers();
        this.prepareShowcaseRoster();
        this._refs.raceCameraDirector.resetToBroadcast();
        this._refs.raceCameraDirector.startPreCountdownOrbit([
            this._refs.playerSwimmer?.node.position.z,
            ...this._refs.aiSwimmers.filter((swimmer) => swimmer.node.active).map((swimmer) => swimmer.node.position.z),
        ].filter((laneZ): laneZ is number => laneZ !== undefined));
        this._refs.setState(GameState.PRECOUNTDOWN);
    }

    refreshPreRaceShowcaseRoster() {
        if (this._refs.getState() !== GameState.PRECOUNTDOWN) {
            return;
        }
        this.prepareShowcaseRoster();
        this._refs.raceCameraDirector.updatePreCountdownRacerLanes([
            this._refs.playerSwimmer?.node.position.z,
            ...this._refs.aiSwimmers.filter((swimmer) => swimmer.node.active).map((swimmer) => swimmer.node.position.z),
        ].filter((laneZ): laneZ is number => laneZ !== undefined));
        this._refs.debug(`pre-race showcase roster refreshed racers=${1 + this._refs.aiSwimmers.filter((swimmer) => swimmer.node.active).length}`);
    }

    restartGame() {
        this._refs.debug('restartGame');
        this.stopAllAi();
        // Leave the awards state before rebuilding the race. Exiting AWARDS
        // restores the non-podium swimmers, so resetRace() and the showcase
        // roster below can initialize every racer instead of only the three
        // nodes that remained active on the podium.
        this._refs.setState(GameState.READY);
        this.startGame();
    }

    handlePrimaryAction() {
        const state = this._refs.getState();
        if (state === GameState.READY) {
            this.startGame();
        } else if (state === GameState.PRECOUNTDOWN) {
            this.skipPreRaceShowcase();
        } else if (state === GameState.FINISHED || state === GameState.AWARDS) {
            this.restartGame();
        }
    }

    handlePlayerStroke(type: StrokeType) {
        if (this._refs.handleModelDebugStroke(type)) {
            return;
        }
        if (!this.isStrokeInputActive()) {
            return;
        }
        const playStrokeSfx = this._refs.getState() === GameState.RACING
            && (this._refs.playerSwimmer?.canAcceptStroke(type) ?? false);
        const result = this._refs.playerSwimmer?.handleStroke(type);
        if (playStrokeSfx) {
            StrokeSfxManager.playStroke();
        }
        if (result) {
            this._refs.uiFlow.showRating(result.rating, result.combo);
        }
    }

    handlePlayerStrokeHeld(type: StrokeType, held: boolean) {
        if (this._refs.handleModelDebugStrokeHeld(type, held)) {
            return;
        }
        if (!this.isStrokeInputActive()) {
            return;
        }
        const result = this._refs.playerSwimmer?.handleStrokeHeld(type, held);
        if (result) {
            this._refs.uiFlow.showRating(result.rating, result.combo);
        }
    }

    handlePlayerKickStroke(type: StrokeType) {
        if (this._refs.handleModelDebugKickStroke(type)) {
            return;
        }
        if (!this.isStrokeInputActive()) {
            return;
        }
        this._refs.playerSwimmer?.handleKickStroke(type);
    }

    private isStrokeInputActive(): boolean {
        const state = this._refs.getState();
        return state === GameState.RACING || state === GameState.GLIDING;
    }

    handleDiveChargeStart() {
        const state = this._refs.getState();
        // Race HUD routes every full-screen press through this callback. During
        // the showcase that first press is consumed only as "skip"; charging
        // starts from the player's next press after COUNTDOWN is active.
        if (state === GameState.PRECOUNTDOWN) {
            this.skipPreRaceShowcase();
            return;
        }
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

    private skipPreRaceShowcase() {
        if (this._refs.getState() !== GameState.PRECOUNTDOWN) {
            return;
        }
        if (!this._refs.raceCameraDirector.skipPreCountdownShowcase()) {
            return;
        }
        this._refs.debug('pre-race showcase skipped by player');
        this._refs.raceManager?.startRace();
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
                this._refs.playerSwimmer?.prepareDive();
                for (const swimmer of this._refs.aiSwimmers) {
                    if (swimmer.node.active) {
                        swimmer.prepareDive();
                    }
                }
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
        raceManager.onProgressUpdate = (playerDist, aiDist) => {
            this._refs.uiFlow.updateProgress(playerDist, aiDist);
        };
        raceManager.onSwimmerFinished = (result) => {
            this._refs.debug(`finish ${result.name} place=${result.placement} time=${result.time.toFixed(2)}`);
            this._refs.showFinishRank(result);
        };
        raceManager.onFinishCountdownTick = (value) => {
            this._refs.uiFlow.showFinishCountdown(value);
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
            this._refs.clearFinishRanks();
            this._refs.showAwards(placement.leaderboard ?? []);
            this._refs.setState(GameState.AWARDS);
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
        raceManager.onProgressUpdate = null;
        raceManager.onSwimmerFinished = null;
        raceManager.onFinishCountdownTick = null;
        raceManager.onRaceFinished = null;
        raceManager.onDiveReady = null;
    }

    cycleRaceCamera(): string {
        return this._refs.raceCameraDirector.cycleMode();
    }

    // Debug (100m AI-debug mode): make the race camera frame the AI opponent
    // instead of the player. Only the visual follow position changes; race logic,
    // placement, and sprint pacing stay anchored to the real player.
    setCameraFollowAi(followAi: boolean) {
        this._cameraFollowAi = followAi;
    }

    updateRaceCamera(dt: number) {
        this.updateDiveCharge(dt);
        const playerSwimmer = this._refs.playerSwimmer;
        if (!playerSwimmer) {
            return;
        }
        const playerDistance = playerSwimmer.distance;
        const distanceToFinish = Math.max(0, getRaceDistance() - playerDistance);
        if (!this._sprintTriggered
            && this._refs.getState() === GameState.RACING
            && distanceToFinish <= RACE_PHASE_BALANCE.sprintDistanceFromFinish) {
            this._sprintTriggered = true;
            this._refs.enterSprint();
            this._refs.debug(`sprint phase entered remaining=${distanceToFinish.toFixed(1)}m`);
        }

        if (this._sprintTriggered && this._refs.getState() === GameState.RACING) {
            this.updateSprintTier(playerSwimmer.effortScore);
        }
        const placement = this.calculatePlayerPlacement();
        // The camera frames this swimmer's position. Normally the player; in
        // AI-debug follow mode it's the opponent, while all race logic above still
        // uses the real player.
        const focus = this._cameraFollowAi && this._refs.aiSwimmers[0]?.node?.isValid
            ? this._refs.aiSwimmers[0]
            : playerSwimmer;
        const cameraSnapshot: RaceCameraSnapshot = {
            playerX: focus.node.position.x,
            playerY: focus.node.position.y,
            playerUpperBodyWorldPosition: focus.getCameraUpperBodyWorldPosition(this._playerUpperBodyWorldPosition),
            playerDistance: focus.distance,
            playerHeading: focus.movementHeading,
            playerKickCadenceHz: focus.kickCadenceHz,
            playerArmStrokeActive: focus.isArmStrokeActive,
            playerUnderwater: focus.isUnderwater,
            closestAiDistanceGap: this.closestAiDistanceGap(playerDistance),
            playerPlacement: placement.placement,
            racerCount: placement.racerCount,
            raceActive: this._refs.getState() === GameState.RACING || this._refs.getState() === GameState.GLIDING,
            countdownActive: this._refs.getState() === GameState.COUNTDOWN || this._refs.getState() === GameState.DIVING,
            sprintActive: this._sprintTriggered,
            playerFlipTurnCameraActive: focus.isFlipTurnCameraActive,
        };
        // Switch to the behind-the-swimmer sprint chase once the player has
        // surfaced from the dive, so the steering weave is clearly visible. Done
        // once; the player can still cycle camera modes manually afterwards.
        if (STEERING_TUNING.useSprintSwimView
            && !this._swimSprintViewApplied
            && this._refs.getState() === GameState.RACING
            && !playerSwimmer.isUnderwater
            && !playerSwimmer.isFlipTurnCameraActive) {
            this._swimSprintViewApplied = true;
            this._refs.raceCameraDirector.selectMode(RaceCameraMode.Sprint);
        }
        this._refs.raceCameraDirector.update(dt, cameraSnapshot);
        // Feed the jumbotron side-view camera the same snapshot so both stay in sync.
        this._refs.updateScoreboardFeed?.(dt, cameraSnapshot);
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

    private prepareShowcaseRoster() {
        const swimmers = [this._refs.playerSwimmer, ...this._refs.aiSwimmers]
            .filter((swimmer): swimmer is Swimmer => Boolean(swimmer?.node?.active))
            .sort((left, right) => left.node.position.z - right.node.position.z);
        const actions = selectAdjacentDistinctActions(
            swimmers.length,
            CHARACTER_ACTION_CONFIG.showcase.actions,
        );
        for (let index = 0; index < swimmers.length; index++) {
            const swimmer = swimmers[index];
            const action = actions[index];
            swimmer.setShowcaseAction(action);
            swimmer.prepareShowcaseStanding();
        }
        this._refs.debug(`showcase actions=${actions.join(',')}`);
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
                // Start this AI swimming the moment it enters the water, so it races
                // on its own reaction time even if the player stalls on the block
                // (the race-wide RACING transition is gated on the player's dive).
                controller?.startSwimming();
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
