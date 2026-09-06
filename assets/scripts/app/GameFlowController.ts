import { Vec3 } from 'cc';
import { isSurfaceRaceCameraRiseReady, RaceCameraDirector, RaceCameraMode, RaceCameraSnapshot } from '../camera/RaceCameraDirector';
import { AISwimmerController } from '../entity/AISwimmerController';
import { Swimmer } from '../entity/Swimmer';
import { DIVE_BALANCE, getRaceDistance } from '../core/GameBalance';
import { STEERING_TUNING } from '../core/SteeringTuning';
import { randomFloat } from '../core/SharedRNG';
import { GameState, StrokeType } from '../core/GameConstants';
import { RaceFinishResult, RaceManager, RacePlacementSummary } from '../core/RaceManager';
import { resolveDiveResult } from '../core/DiveResolver';
import { DiveResult } from '../core/DiveResult';
import { SprintTier } from '../condition/ConditionTypes';
import { CHARACTER_ACTION_CONFIG, selectAdjacentDistinctActions } from '../character/CharacterActionConfig';
import { RACE_PHASE_BALANCE } from '../core/ConditionBalance';
import { UIFlowController } from '../ui/UIFlowController';
import { StrokeSfxManager } from './StrokeSfxManager';
import { captureNetInput } from '../net/NetInputCapture';
import { NetInputKind, NetInputSide } from '../net/NetRaceInput';

// Map the game's StrokeType to the codec's numeric side (0=LEFT, 1=RIGHT). BOTH
// (rare) collapses to LEFT — the mobile input only ever produces LEFT/RIGHT.
function netSide(type: StrokeType): NetInputSide {
    return type === StrokeType.RIGHT ? 1 : 0;
}

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
    isLiveRanksEnabled: () => boolean;
    showLiveRanks: (results: RaceFinishResult[]) => void;
    showFinishRank: (result: RaceFinishResult) => void;
    onSwimmerEliminated: (swimmer: Swimmer) => void;
    // Begin the pre-dive countdown. Single-player starts immediately; a networked race
    // waits for the host's synchronized GO so all players' countdowns start together.
    beginCountdown: () => void;
    // Networked race: adopt the host's authoritative final placement (single-player
    // passes the local leaderboard straight to `done`).
    resolveNetLeaderboard: (leaderboard: RaceFinishResult[], done: (leaderboard: RaceFinishResult[]) => void) => void;
    showAwards: (leaderboard: RaceFinishResult[]) => void;
    applyPlayerDive: (result: DiveResult) => void;
    applyPlayerDolphinJumpStrain: () => void;
    playerDiveSpeedScale: () => number;
    awardProgression: (input: { placement: number; racerCount: number; maxCombo: number; perfectCount: number; goodCount: number; finished: boolean }) =>
        { characterId: string; coinsGained: number } | null;
    enterSprint: () => void;
    updateSprintTier: (tier: SprintTier) => void;
    updateScoreboardFeed?: (dt: number, snapshot: RaceCameraSnapshot) => void;
    updateCameraSpeedLines?: (dt: number, speed: number, visible: boolean, sprintBoost: boolean) => void;
    debug: (message: string) => void;
};

// Sprint effort -> tier thresholds (doc 19.8). The flow layer reads the player's
// sustained effort during SPRINT and interprets it as STEADY / PUSH / GAMBLE.
const SPRINT_PUSH_EFFORT = 0.6;
const SPRINT_GAMBLE_EFFORT = 0.85;
const LIVE_RANK_REFRESH_SECONDS = 0.2;
const LATE_DIVE_START_SECONDS = 1.2;

export class GameFlowController {
    private _diveChargeStarted = false;
    private _diveChargeElapsed = 0;
    private _diveChargePower = 0;
    private _diveCommitted = false;
    private _sprintTriggered = false;
    private _lastSprintTier: SprintTier = SprintTier.STEADY;
    private _cameraFollowAi = false;
    private _liveRankRefreshElapsed = LIVE_RANK_REFRESH_SECONDS;
    // Once the opening dive rises close to the surface, switch the swim view to
    // the behind-the-swimmer sprint chase so the steering weave reads clearly.
    private _swimSprintViewApplied = false;
    private _preRaceDivePrepApplied = false;
    private _divingElapsed = 0;
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
        this._preRaceDivePrepApplied = false;
        this._divingElapsed = 0;
        this._liveRankRefreshElapsed = LIVE_RANK_REFRESH_SECONDS;
        this._refs.clearFinishRanks();        this._refs.exitModelDebug(false);
        this._refs.uiFlow.showRaceHud();
        this._refs.raceManager?.resetRace();
        this.resetExtraAiSwimmers();
        this.prepareShowcaseRoster();
        this._refs.raceCameraDirector.setPlayerLaneZ(this._refs.playerSwimmer?.node.position.z ?? 0);
        this._refs.raceCameraDirector.resetToBroadcast();
        this._refs.raceCameraDirector.startPreRacePresentation();
        this._refs.setState(GameState.PRECOUNTDOWN);
    }

    refreshPreRaceShowcaseRoster() {
        if (this._refs.getState() !== GameState.PRECOUNTDOWN) {
            return;
        }
        if (this._preRaceDivePrepApplied) {
            this.prepareDiveRoster();
        } else {
            this.prepareShowcaseRoster();
        }
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
        captureNetInput({ kind: NetInputKind.Stroke, side: netSide(type) });
        if (playStrokeSfx) {
            StrokeSfxManager.playStroke();
        }
        if (result) {
            this._refs.uiFlow.showRating(result.rating, result.combo);
        }
    }

    handlePlayerStrokeHeld(type: StrokeType, held: boolean, preHeldSeconds = 0): boolean {
        if (this._refs.handleModelDebugStrokeHeld(type, held)) {
            return true;
        }
        if (!this.isStrokeInputActive()) {
            return false;
        }
        if (held && !this._refs.playerSwimmer?.canUseArmStroke) {
            return false;
        }
        const result = this._refs.playerSwimmer?.handleStrokeHeld(type, held, preHeldSeconds);
        captureNetInput({ kind: held ? NetInputKind.HeldOn : NetInputKind.HeldOff, side: netSide(type) });
        if (result) {
            this._refs.uiFlow.showRating(result.rating, result.combo);
        }
        return true;
    }

    handlePlayerKickStroke(type: StrokeType) {
        if (this._refs.handleModelDebugKickStroke(type)) {
            return;
        }
        if (!this.isStrokeInputActive()) {
            return;
        }
        this._refs.playerSwimmer?.handleKickStroke(type);
        captureNetInput({ kind: NetInputKind.Kick, side: netSide(type) });
    }

    private isStrokeInputActive(): boolean {
        const state = this._refs.getState();
        return state === GameState.RACING || state === GameState.GLIDING;
    }

    // Both-hands long-press gesture: launch the player into a dolphin jump. Only
    // from surface racing; the swimmer/phase controller rejects it otherwise.
    handleDolphinJump() {
        if (this._refs.getState() !== GameState.RACING) {
            return;
        }
        const swimmer = this._refs.playerSwimmer;
        if (!swimmer) {
            return;
        }
        if (swimmer.tryDolphinJump()) {
            this._refs.applyPlayerDolphinJumpStrain();
            captureNetInput({ kind: NetInputKind.DolphinJump });
            this._refs.debug('dolphin jump');
        }
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
        // Once the dive is committed, DIVING remains active through the whole
        // airborne sequence. Reject later taps so the gather cannot restart
        // after the release halo has played.
        if ((state !== GameState.COUNTDOWN && state !== GameState.DIVING)
            || this._diveChargeStarted
            || this._diveCommitted) {
            return;
        }
        this._diveChargeStarted = true;
        this._diveChargeElapsed = 0;
        this._diveChargePower = 0;
        this._refs.playerSwimmer?.setDiveChargeEffect(this._diveChargePower, true);
        captureNetInput({ kind: NetInputKind.DiveCharge });
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
        if (!this._refs.raceCameraDirector.skipPreRacePresentation()) {
            return;
        }
        this._refs.debug('pre-race showcase skipped by player');
        this._refs.beginCountdown();
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
                if (!this._preRaceDivePrepApplied) {
                    this._preRaceDivePrepApplied = true;
                    this.prepareDiveRoster();
                }
                this._refs.raceCameraDirector.resetCountdownTimers();
            }
            if (state === GameState.DIVING) {
                this._divingElapsed = 0;
                this._refs.uiFlow.showGo();
                this.prepareAndScheduleAiDives();
            }
            if (state === GameState.GLIDING) {
                // The pre-jump burst must not survive into the airborne/entry phase.
                this._refs.playerSwimmer?.clearDiveChargeBurstBeforeTakeoff();
                this._refs.raceCameraDirector.resetRaceTimers();
                this._refs.uiFlow.showGliding();
            }
            if (state === GameState.RACING) {
                this._refs.playerSwimmer?.finishDiveChargeEffect();
                this._refs.uiFlow.hideCountdown();
                this.startAllAi();
            }
        };
        raceManager.onProgressUpdate = (playerDist, aiDist, dt) => {
            this._refs.uiFlow.updateProgress(playerDist, aiDist);
            if (this._refs.getState() !== GameState.RACING) {
                this._liveRankRefreshElapsed = LIVE_RANK_REFRESH_SECONDS;
                return;
            }
            this._liveRankRefreshElapsed += Math.max(0, dt);
            if (this._refs.isLiveRanksEnabled() && this._liveRankRefreshElapsed >= LIVE_RANK_REFRESH_SECONDS) {
                this._liveRankRefreshElapsed = 0;
                this._refs.showLiveRanks(raceManager.getLiveLeaderboard());
            }
        };
        raceManager.onSwimmerFinished = (result) => {
            this._refs.debug(`finish ${result.name} place=${result.placement} time=${result.time.toFixed(2)}`);
            this._refs.showFinishRank(result);
            if (result.isPlayer) {
                this._refs.uiFlow.setSprintActive(false);
            }
        };
        raceManager.onSwimmerEliminated = (swimmer) => {
            this._refs.debug(`eliminated ${swimmer.swimmerName}`);
            this._refs.onSwimmerEliminated(swimmer);
        };
        raceManager.onFinishCountdownTick = (value) => {
            this._refs.uiFlow.showFinishCountdown(value);
        };
        raceManager.onRaceFinished = (playerWin, playerTime, aiTime, placementSummary) => {
            this._refs.debug(`finished win=${playerWin} player=${playerTime.toFixed(2)} ai=${aiTime.toFixed(2)}`);
            this.stopAllAi();
            const rhythm = this._refs.playerSwimmer?.rhythmStats;
            const placement = placementSummary ?? this.calculatePlayerPlacement();
            const localLeaderboard = placement.leaderboard ?? [];
            // Networked race: adopt the host's authoritative ordering before showing
            // results (single-player resolves synchronously with the local order).
            this._refs.resolveNetLeaderboard(localLeaderboard, (leaderboard) => {
                const playerRow = leaderboard.find((row) => row.isPlayer);
                const finalPlacement = playerRow?.placement ?? placement.placement;
                const finalPlayerWin = !!playerRow?.finished && finalPlacement === 1;
                // Networked race: the host's authoritative time (adopted into playerRow)
                // is the shared truth, so both screens show the same headline result.
                const finalPlayerTime = playerRow && playerRow.time > 0 ? playerRow.time : playerTime;
                this._refs.uiFlow.showResult(finalPlayerWin, finalPlayerTime, aiTime, {
                    averageSpeed: finalPlayerTime > 0 ? getRaceDistance() / finalPlayerTime : 0,
                    maxCombo: rhythm?.maxCombo ?? 0,
                    perfectCount: rhythm?.perfectCount ?? 0,
                    goodCount: rhythm?.goodCount ?? 0,
                    missCount: rhythm?.missCount ?? 0,
                    placement: finalPlacement,
                    racerCount: placement.racerCount,
                    leaderboard,
                });
                // Progression uses the authoritative (net-resolved) placement/time so
                // the XP reward matches the result the player actually sees.
                const progressionResult = this._refs.awardProgression({
                    placement: finalPlacement,
                    racerCount: placement.racerCount,
                    maxCombo: rhythm?.maxCombo ?? 0,
                    perfectCount: rhythm?.perfectCount ?? 0,
                    goodCount: rhythm?.goodCount ?? 0,
                    finished: finalPlayerTime > 0,
                });
                this._refs.uiFlow.showProgressionResult(progressionResult);
                this._refs.uiFlow.setSprintActive(false);
                this._refs.clearFinishRanks();
                this._refs.showAwards(leaderboard);
                this._refs.setState(GameState.AWARDS);
            });
        };
        raceManager.onDiveReady = () => {
            if (this._diveChargeStarted) {
                this.commitDive(this._diveChargePower, 'countdown-end auto');
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
        raceManager.onSwimmerEliminated = null;
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
        if (this._refs.getState() === GameState.DIVING) {
            this._divingElapsed += Math.max(0, dt);
        }
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
            playerSpeed: focus.currentSpeed,
            playerUpperBodyWorldPosition: focus.getCameraUpperBodyWorldPosition(this._playerUpperBodyWorldPosition),
            playerDistance: focus.distance,
            playerHeading: focus.cameraHeading,
            playerFlightPitch: focus.flightPitch,
            playerKickCadenceHz: focus.kickCadenceHz,
            playerArmStrokeActive: focus.isArmStrokeActive,
            playerUnderwater: focus.isUnderwater,
            playerUnderwaterRiseProgress: focus.underwaterRiseProgress,
            closestAiDistanceGap: this.closestAiDistanceGap(playerDistance),
            playerPlacement: placement.placement,
            racerCount: placement.racerCount,
            raceActive: this._refs.getState() === GameState.RACING || this._refs.getState() === GameState.GLIDING,
            countdownActive: this._refs.getState() === GameState.COUNTDOWN || this._refs.getState() === GameState.DIVING,
            sprintActive: this._sprintTriggered,
            playerFlipTurnCameraActive: focus.isFlipTurnCameraActive,
            playerDolphinCameraActive: focus.isDolphinCameraActive,
        };
        // Switch to the behind-the-swimmer sprint chase as the opening dive rises
        // close to the surface. Gameplay remains underwater until the rise really
        // completes; only the local presentation hands off early. Done once; the
        // player can still cycle camera modes manually afterwards.
        const openingDiveCameraReady = !playerSwimmer.isUnderwater
            || isSurfaceRaceCameraRiseReady(playerSwimmer.underwaterRiseProgress);
        if (STEERING_TUNING.useSprintSwimView
            && !this._swimSprintViewApplied
            && this._refs.getState() === GameState.RACING
            && openingDiveCameraReady
            && !playerSwimmer.isFlipTurnCameraActive
            && !playerSwimmer.isDolphinCameraActive) {
            this._swimSprintViewApplied = true;
            this._refs.raceCameraDirector.selectMode(RaceCameraMode.Sprint, true);
        }
        this._refs.raceCameraDirector.update(dt, cameraSnapshot);
        if (this._refs.getState() === GameState.PRECOUNTDOWN
            && this._refs.raceCameraDirector.preRacePhase === 'athlete'
            && !this._preRaceDivePrepApplied) {
            this._preRaceDivePrepApplied = true;
            this.prepareDiveRoster();
            this._refs.debug('pre-race showcase transitioned to dive prep');
        }
        // Speed lines: normally only in the sprint chase (not top/underwater). Also
        // force them ON while the player is airborne during a dolphin jump — the
        // burst out of the water shows speed lines until it re-enters the water.
        const dolphinAirborne = playerSwimmer.isDolphinAirActive;
        this._refs.updateCameraSpeedLines?.(
            dt,
            cameraSnapshot.playerSpeed,
            dolphinAirborne
                || (this._refs.raceCameraDirector.mode === RaceCameraMode.Sprint
                    && !this._refs.raceCameraDirector.topViewActive
                    && !this._refs.raceCameraDirector.underwaterViewActive),
            this._sprintTriggered || dolphinAirborne,
        );
        // Feed the jumbotron side-view camera the same snapshot so both stay in sync.
        this._refs.updateScoreboardFeed?.(dt, cameraSnapshot);
        if (this._refs.getState() === GameState.PRECOUNTDOWN && this._refs.raceCameraDirector.consumePreCountdownReady()) {
            this._refs.debug('pre-countdown camera ready');
            this._refs.beginCountdown();
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

    private prepareDiveRoster() {
        this._refs.playerSwimmer?.prepareDive();
        for (const swimmer of this._refs.aiSwimmers) {
            if (swimmer.node.active) {
                swimmer.prepareDive();
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
            // Networked remote human: its dive comes from network input, not the AI
            // dive timer. Still prepareDive()'d above so the body is on the block.
            if (controller?.remoteDriven) {
                continue;
            }
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
        return Math.max(0.03, baseReaction + randomFloat() * DIVE_BALANCE.aiReactionRandomSeconds);
    }

    private aiDivePower(swimmer: Swimmer, controller: AISwimmerController | null): number {
        const basePower = controller?.divePower ?? DIVE_BALANCE.defaultAiPower;
        const variance = (randomFloat() * 2 - 1) * DIVE_BALANCE.aiPowerVariance;
        return Math.max(DIVE_BALANCE.aiPowerMin, Math.min(DIVE_BALANCE.aiPowerMax, basePower + variance));
    }

    private updateDiveCharge(dt: number) {
        const state = this._refs.getState();
        // Defense in depth: even if stale input marks charging active after the
        // release edge, never drive the inward gather once take-off is committed.
        if (!this._diveChargeStarted
            || this._diveCommitted
            || (state !== GameState.COUNTDOWN && state !== GameState.DIVING)) {
            return;
        }
        this._diveChargeElapsed += Math.max(0, dt);
        this._diveChargePower = diveChargePingPong(this._diveChargeElapsed);
        this._refs.playerSwimmer?.setDiveChargeEffect(this._diveChargePower, true);
        this._refs.uiFlow.updateDiveCharge(this._diveChargePower, true);
    }

    private resetDiveCharge() {
        this._diveChargeStarted = false;
        this._diveChargeElapsed = 0;
        this._diveChargePower = 0;
        this._diveCommitted = false;
        this._refs.playerSwimmer?.setDiveChargeEffect(0, false);
        this._refs.uiFlow.updateDiveCharge(0, false);
    }

    private commitDive(charge: number, reason: string) {
        if (this._diveCommitted || this._refs.getState() !== GameState.DIVING) {
            return;
        }
        const power = this.calculateDivePower(charge);
        this._diveCommitted = true;
        this._diveChargeStarted = false;
        // Freeze the last charge value through the crouch/extension anticipation.
        // Swimmer.performDive switches it to the release burst on the exact
        // take-off frame, so there is no empty visual gap after input release.
        this._refs.debug(`dive commit reason=${reason} charge=${charge.toFixed(2)} power=${power.toFixed(2)}`);
        this._refs.uiFlow.showDiveRelease(power, this._divingElapsed > LATE_DIVE_START_SECONDS);
        this._refs.raceCameraDirector.startDiveShot();
        const diveResult = resolveDiveResult(power);
        const diveSpeedScale = this._refs.playerDiveSpeedScale();
        if (diveSpeedScale !== 1) {
            diveResult.launchSpeed *= diveSpeedScale;
        }
        // Publish the final owner-authoritative result only after progression has
        // adjusted it. This covers manual and countdown-end dives and keeps older
        // clients compatible because the launch-speed suffix is optional.
        captureNetInput({
            kind: NetInputKind.DiveRelease,
            power,
            launchSpeed: diveResult.launchSpeed,
        });
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
