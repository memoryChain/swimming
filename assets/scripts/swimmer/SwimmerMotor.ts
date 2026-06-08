import { getRaceDistance, SWIMMER_BALANCE } from '../core/GameBalance';
import { Rating, StrokeType } from '../core/GameConstants';
import { MOTION_TUNING, STABILITY_TUNING } from '../core/InputTuning';
import { SwimPhysicsModel } from './SwimPhysicsModel';

const CYCLE_AMOUNT = Math.PI * 2;
const MAX_QUEUED_MOTION = CYCLE_AMOUNT * 2;

export type StrokeStabilityResult = {
    type: StrokeType;
    stability: number;
    badReason?: string;
    holdSeconds: number;
    actionSeconds: number;
    minHoldSeconds: number;
    holdTimeValid: boolean;
    holdRatio: number;
    inputFreshness: number;
    inputLeadSeconds: number;
    inputLeadRatio: number;
    meanRatio: number;
    ratioStdDev: number;
    sampleCount: number;
};

type StrokeAction = {
    queuedAt: number;
    startedAt: number;
    pressedAt: number;
    releasedAt: number;
    progress: number;
    baseAccelerationStarted: boolean;
    stabilitySettled: boolean;
    alternationQuality: number;
    inputFreshness: number;
    inputLeadSeconds: number;
    inputLeadRatio: number;
};

type QueueSideStrokeResult = {
    queued: boolean;
    startedImmediately: boolean;
};

export type SwimmerMotorOptions = {
    isAI: boolean;
    aiPower: number;
    aiMaxSpeedScale: number;
};

export type StrokeTimingGuideInterval = {
    rating: Rating;
    startRatio: number;
    endRatio: number;
};

export type StrokeTimingGuide = {
    active: boolean;
    currentRatio: number;
    holdSeconds: number;
    actionSeconds: number;
    minHoldRatio: number;
    intervals: StrokeTimingGuideInterval[];
};

export class SwimmerMotor {
    private readonly _physics = new SwimPhysicsModel();
    private _currentSpeed = 0;
    private _distance = 0;
    private _isRacing = false;
    private _bodyPhase = 0;
    private _leftArmCycle = 0;
    private _rightArmCycle = 0;
    private _leftKickCycle = 0;
    private _rightKickCycle = 0;
    private _leftArmMotionRemaining = 0;
    private _rightArmMotionRemaining = 0;
    private _leftKickMotionRemaining = 0;
    private _rightKickMotionRemaining = 0;
    private _armAction = 0;
    private _kickAction = 0;
    private _leftStrokeHeld = false;
    private _rightStrokeHeld = false;
    private _motionClock = 0;
    private _leftPressStartedAt = -1;
    private _rightPressStartedAt = -1;
    private readonly _leftActions: StrokeAction[] = [];
    private readonly _rightActions: StrokeAction[] = [];
    private readonly _holdRatioHistory: number[] = [];
    private readonly _alternationHistory: StrokeType[] = [];
    private readonly _pendingStabilityResults: StrokeStabilityResult[] = [];
    private _strokeAcceleration = 0;
    private _strokeAccelerationSeconds = 0;
    private _speedCapBonus = 0;
    private _lastStability = 0;
    private _lastInputFreshness = 1;
    private _currentAcceleration = 0;

    startRace(initialDistance = 0, initialSpeed = SWIMMER_BALANCE.baseSpeed) {
        this._isRacing = true;
        this._currentSpeed = initialSpeed;
        this.resetRaceState(initialDistance);
    }

    stopRace() {
        this._isRacing = false;
    }

    reset() {
        this._currentSpeed = 0;
        this._isRacing = false;
        this.resetRaceState();
    }

    recordStroke(type: StrokeType): boolean {
        let queued = false;
        if (type === StrokeType.LEFT) {
            const left = this.queueSideStroke(StrokeType.LEFT);
            queued = left.queued || queued;
        } else if (type === StrokeType.RIGHT) {
            const right = this.queueSideStroke(StrokeType.RIGHT);
            queued = right.queued || queued;
        } else {
            const left = this.queueSideStroke(StrokeType.LEFT);
            const right = this.queueSideStroke(StrokeType.RIGHT);
            queued = left.queued || right.queued || queued;
        }
        if (!queued) {
            return false;
        }
        this._armAction = 1;
        this._kickAction = 1;
        return true;
    }

    canRecordStroke(type: StrokeType): boolean {
        if (type === StrokeType.LEFT) {
            return this.canQueueSideStroke(StrokeType.LEFT);
        }
        if (type === StrokeType.RIGHT) {
            return this.canQueueSideStroke(StrokeType.RIGHT);
        }
        return this.canQueueSideStroke(StrokeType.LEFT) || this.canQueueSideStroke(StrokeType.RIGHT);
    }

    recordAiVisualStroke(type: StrokeType): boolean {
        let queued = false;
        if (type === StrokeType.LEFT) {
            queued = this.queueVisualSideStroke(StrokeType.LEFT) || queued;
        } else if (type === StrokeType.RIGHT) {
            queued = this.queueVisualSideStroke(StrokeType.RIGHT) || queued;
        } else {
            queued = this.queueVisualSideStroke(StrokeType.LEFT) || queued;
            queued = this.queueVisualSideStroke(StrokeType.RIGHT) || queued;
        }
        if (queued) {
            this._armAction = 1;
            this._kickAction = 1;
        }
        return queued;
    }

    setStrokeHeld(type: StrokeType, held: boolean): StrokeStabilityResult | null {
        let result: StrokeStabilityResult | null = null;
        if (type === StrokeType.LEFT) {
            result = this.setSideHeld(StrokeType.LEFT, held);
        } else if (type === StrokeType.RIGHT) {
            result = this.setSideHeld(StrokeType.RIGHT, held);
        } else {
            const left = this.setSideHeld(StrokeType.LEFT, held);
            const right = this.setSideHeld(StrokeType.RIGHT, held);
            result = strongerStability(left, right);
        }
        return result;
    }

    update(dt: number, options: SwimmerMotorOptions): boolean {
        if (!this._isRacing) {
            return false;
        }

        this._motionClock += dt;
        this._armAction = Math.max(0, this._armAction - dt * 4.6);
        this._kickAction = Math.max(0, this._kickAction - dt * 6.8);
        const strokeAcceleration = this.consumeStrokeAcceleration(dt);
        const next = this._physics.step(
            {
                currentSpeed: this._currentSpeed,
                distance: this._distance,
            },
            {
                dt,
                isAI: options.isAI,
                aiPower: options.aiPower,
                aiMaxSpeedScale: options.aiMaxSpeedScale,
                strokeAcceleration,
                speedCapBonus: this._speedCapBonus,
            },
        );
        this._currentAcceleration = dt > 0 ? (next.currentSpeed - this._currentSpeed) / dt : 0;
        this._currentSpeed = next.currentSpeed;
        this.decaySpeedCapBonus(dt);
        const raceDistance = getRaceDistance();
        this._distance = Math.min(raceDistance, this._distance + this._currentSpeed * dt);
        this.updateMotionCycles(dt, options);

        if (this._distance >= raceDistance) {
            this._isRacing = false;
            return true;
        }
        return false;
    }

    private resetRaceState(initialDistance = 0) {
        this._distance = Math.max(0, initialDistance);
        this._bodyPhase = 0;
        this._leftArmCycle = 0;
        this._rightArmCycle = 0;
        this._leftKickCycle = 0;
        this._rightKickCycle = 0;
        this._leftArmMotionRemaining = 0;
        this._rightArmMotionRemaining = 0;
        this._leftKickMotionRemaining = 0;
        this._rightKickMotionRemaining = 0;
        this._armAction = 0;
        this._kickAction = 0;
        this._leftStrokeHeld = false;
        this._rightStrokeHeld = false;
        this._motionClock = 0;
        this._leftPressStartedAt = -1;
        this._rightPressStartedAt = -1;
        this._leftActions.length = 0;
        this._rightActions.length = 0;
        this._holdRatioHistory.length = 0;
        this._alternationHistory.length = 0;
        this._pendingStabilityResults.length = 0;
        this._strokeAcceleration = 0;
        this._strokeAccelerationSeconds = 0;
        this._speedCapBonus = 0;
        this._lastStability = 0;
        this._lastInputFreshness = 1;
        this._currentAcceleration = 0;
    }

    applyPerfectComboBoost(combo: number): number {
        const interval = Math.round(SWIMMER_BALANCE.perfectComboBoostInterval);
        if (interval <= 0 || combo <= 0 || combo % interval !== 0) {
            return 0;
        }
        return this.addSpeedBonus(SWIMMER_BALANCE.perfectComboSpeedBonus);
    }

    private addSpeedBonus(amount: number): number {
        const bonus = Math.max(0, amount);
        const maxOvercap = Math.max(0, SWIMMER_BALANCE.perfectComboMaxOvercap);
        if (bonus <= 0 || maxOvercap <= 0) {
            return 0;
        }
        const before = this._currentSpeed;
        const maxBoostedSpeed = SWIMMER_BALANCE.maxSpeed + maxOvercap;
        this._currentSpeed = clamp(this._currentSpeed + bonus, SWIMMER_BALANCE.minSpeed, maxBoostedSpeed);
        const awarded = Math.max(0, this._currentSpeed - before);
        this._speedCapBonus = Math.max(this._speedCapBonus, Math.max(0, this._currentSpeed - SWIMMER_BALANCE.maxSpeed));
        this._speedCapBonus = clamp(this._speedCapBonus, 0, maxOvercap);
        return awarded;
    }

    private decaySpeedCapBonus(dt: number) {
        if (this._speedCapBonus <= 0) {
            return;
        }
        const decay = Math.max(0, SWIMMER_BALANCE.perfectComboOvercapDecay) * Math.max(0, dt);
        const neededForCurrentSpeed = Math.max(0, this._currentSpeed - SWIMMER_BALANCE.maxSpeed);
        this._speedCapBonus = Math.max(neededForCurrentSpeed, this._speedCapBonus - decay);
        this._speedCapBonus = clamp(this._speedCapBonus, 0, Math.max(0, SWIMMER_BALANCE.perfectComboMaxOvercap));
    }

    private updateMotionCycles(dt: number, options: SwimmerMotorOptions) {
        const speedRatio = this.speedRatio();
        const armCycleSpeed = CYCLE_AMOUNT * lerp(MOTION_TUNING.armMinCyclesPerSecond, MOTION_TUNING.maxCyclesPerSecond, speedRatio);
        const kickCycleSpeed = CYCLE_AMOUNT * lerp(MOTION_TUNING.kickMinCyclesPerSecond, MOTION_TUNING.maxCyclesPerSecond, speedRatio);
        const actionCycleSpeed = CYCLE_AMOUNT * lerp(
            (MOTION_TUNING.armMinCyclesPerSecond + MOTION_TUNING.kickMinCyclesPerSecond) * 0.5,
            MOTION_TUNING.maxCyclesPerSecond,
            speedRatio,
        );

        this._bodyPhase += dt * Math.max(6, this._currentSpeed * 1.2);
        if (options.isAI) {
            const visualSpeedScale = MOTION_TUNING.releasedMotionSpeedScale * MOTION_TUNING.animationSpeedScale * Math.max(0.7, options.aiPower);
            this._leftArmCycle += this.advanceQueuedMotion(dt, armCycleSpeed, '_leftArmMotionRemaining', visualSpeedScale);
            this._rightArmCycle += this.advanceQueuedMotion(dt, armCycleSpeed, '_rightArmMotionRemaining', visualSpeedScale);
            this._leftKickCycle += this.advanceQueuedMotion(dt, kickCycleSpeed, '_leftKickMotionRemaining', visualSpeedScale);
            this._rightKickCycle += this.advanceQueuedMotion(dt, kickCycleSpeed, '_rightKickMotionRemaining', visualSpeedScale);
            return;
        }
        this._leftArmCycle += this.advanceQueuedMotion(dt, armCycleSpeed, '_leftArmMotionRemaining', this.motionSpeedScaleForSide(StrokeType.LEFT));
        this._rightArmCycle += this.advanceQueuedMotion(dt, armCycleSpeed, '_rightArmMotionRemaining', this.motionSpeedScaleForSide(StrokeType.RIGHT));
        this._leftKickCycle += this.advanceQueuedMotion(dt, kickCycleSpeed, '_leftKickMotionRemaining', this.motionSpeedScaleForSide(StrokeType.RIGHT));
        this._rightKickCycle += this.advanceQueuedMotion(dt, kickCycleSpeed, '_rightKickMotionRemaining', this.motionSpeedScaleForSide(StrokeType.LEFT));
        this.advanceSideActions(dt, actionCycleSpeed, StrokeType.LEFT, this.motionSpeedScaleForSide(StrokeType.LEFT));
        this.advanceSideActions(dt, actionCycleSpeed, StrokeType.RIGHT, this.motionSpeedScaleForSide(StrokeType.RIGHT));
    }

    private setSideHeld(type: StrokeType, held: boolean): StrokeStabilityResult | null {
        const isLeft = type === StrokeType.LEFT;
        const actions = isLeft ? this._leftActions : this._rightActions;
        if (isLeft) {
            this._leftStrokeHeld = held;
            this._leftPressStartedAt = held ? this._motionClock : -1;
        } else {
            this._rightStrokeHeld = held;
            this._rightPressStartedAt = held ? this._motionClock : -1;
        }

        if (!held) {
            for (const action of actions) {
                if (action.releasedAt < 0) {
                    action.releasedAt = this._motionClock;
                }
            }
            const activeAction = actions[0];
            if (activeAction?.startedAt >= 0 && !activeAction.stabilitySettled) {
                return this.settleActionStability(type, activeAction, this.predictedActionSecondsAfterRelease(activeAction), false);
            }
        }
        return null;
    }

    private finishAction(type: StrokeType, action: StrokeAction, completedAt: number) {
        const actionSeconds = Math.max(0.001, completedAt - action.startedAt);
        if (action.stabilitySettled) {
            return;
        }
        this.settleActionStability(type, action, actionSeconds, true);
    }

    private settleActionStability(type: StrokeType, action: StrokeAction, actionSeconds: number, queueResult: boolean): StrokeStabilityResult {
        const completedAt = action.startedAt + actionSeconds;
        const releasedAt = action.releasedAt >= 0 ? action.releasedAt : completedAt;
        const holdStart = Math.max(action.pressedAt, action.startedAt);
        const holdEnd = Math.min(releasedAt, completedAt);
        const holdSeconds = action.pressedAt >= 0 ? Math.max(0, holdEnd - holdStart) : 0;
        const holdRatio = clamp01(holdSeconds / actionSeconds);
        const minHoldSeconds = Math.max(0, STABILITY_TUNING.minHoldSeconds);
        const holdTimeValid = holdSeconds >= minHoldSeconds;
        this._holdRatioHistory.push(holdRatio);
        while (this._holdRatioHistory.length > Math.max(1, Math.round(STABILITY_TUNING.sampleWindowSize))) {
            this._holdRatioHistory.shift();
        }

        const stats = stabilityFromRatios(this._holdRatioHistory);
        const freshness = this.updateActionInputFreshness(action, actionSeconds);
        const stability = holdTimeValid ? clamp01(stats.stability * freshness) : 0;
        const badReason = stability <= 0 ? describeBadReason({
            holdTimeValid,
            holdSeconds,
            minHoldSeconds,
            meanRatio: stats.meanRatio,
            ratioStdDev: stats.ratioStdDev,
            sampleCount: stats.sampleCount,
            inputFreshness: freshness,
            inputLeadRatio: action.inputLeadRatio,
        }) : undefined;
        this._lastStability = stability;
        this._lastInputFreshness = freshness;
        this.startStabilityAcceleration(stability, action);
        action.stabilitySettled = true;
        const result = {
            type,
            stability,
            badReason,
            holdSeconds,
            actionSeconds,
            minHoldSeconds,
            holdTimeValid,
            holdRatio,
            inputFreshness: freshness,
            inputLeadSeconds: action.inputLeadSeconds,
            inputLeadRatio: action.inputLeadRatio,
            meanRatio: stats.meanRatio,
            ratioStdDev: stats.ratioStdDev,
            sampleCount: stats.sampleCount,
        };
        if (queueResult) {
            this._pendingStabilityResults.push(result);
        }
        return result;
    }

    private predictedActionSecondsAfterRelease(action: StrokeAction): number {
        const elapsed = Math.max(0, this._motionClock - action.startedAt);
        const remainingProgress = Math.max(0, CYCLE_AMOUNT - action.progress);
        const releaseSpeed = this.currentActionCycleSpeed() * MOTION_TUNING.releasedMotionSpeedScale * MOTION_TUNING.animationSpeedScale;
        const remainingSeconds = releaseSpeed > 0 ? remainingProgress / releaseSpeed : 0;
        return Math.max(0.001, elapsed + remainingSeconds);
    }

    private startActionBaseAcceleration(type: StrokeType, action: StrokeAction) {
        action.alternationQuality = this.recordAlternation(type);
        action.baseAccelerationStarted = true;
        this.updateActionInputFreshness(action, this.currentCycleSeconds());
        const scale = lerp(SWIMMER_BALANCE.alternationBaseMinScale, 1, action.alternationQuality);
        this.startStrokeAcceleration(SWIMMER_BALANCE.strokeBaseAccel * scale * action.inputFreshness, false);
    }

    private startStabilityAcceleration(stability: number, action: StrokeAction) {
        if (stability <= 0) {
            return;
        }
        const scale = lerp(SWIMMER_BALANCE.alternationStabilityMinScale, 1, action.alternationQuality);
        this.startStrokeAcceleration(stability * SWIMMER_BALANCE.strokeStabilityAccel * scale, true);
    }

    private updateActionInputFreshness(action: StrokeAction, actionSeconds: number): number {
        const leadSeconds = Math.max(0, action.startedAt - action.queuedAt);
        const leadRatio = leadSeconds / Math.max(0.001, actionSeconds);
        action.inputLeadSeconds = leadSeconds;
        action.inputLeadRatio = leadRatio;
        action.inputFreshness = inputFreshnessWeight(leadRatio);
        return action.inputFreshness;
    }

    private startStrokeAcceleration(accel: number, additive: boolean) {
        if (accel <= 0) {
            return;
        }
        if (additive) {
            this._strokeAcceleration = Math.max(this._strokeAcceleration + accel, accel);
        } else {
            this._strokeAcceleration = Math.max(this._strokeAcceleration, accel);
        }
        this._strokeAccelerationSeconds = Math.max(
            this._strokeAccelerationSeconds,
            this.currentCycleSeconds() * SWIMMER_BALANCE.strokeAccelDurationRatio,
        );
    }

    private consumeStrokeAcceleration(dt: number): number {
        if (this._strokeAccelerationSeconds <= 0) {
            this._strokeAcceleration = 0;
            return 0;
        }
        this._strokeAccelerationSeconds = Math.max(0, this._strokeAccelerationSeconds - dt);
        const acceleration = this._strokeAcceleration;
        if (this._strokeAccelerationSeconds <= 0) {
            this._strokeAcceleration = 0;
        }
        return acceleration;
    }

    private currentCycleSeconds(): number {
        return CYCLE_AMOUNT / Math.max(0.05, this.currentActionCycleSpeed() * MOTION_TUNING.animationSpeedScale);
    }

    private currentActionCycleSpeed(): number {
        return CYCLE_AMOUNT * lerp(
            (MOTION_TUNING.armMinCyclesPerSecond + MOTION_TUNING.kickMinCyclesPerSecond) * 0.5,
            MOTION_TUNING.maxCyclesPerSecond,
            this.speedRatio(),
        );
    }

    private speedRatio(): number {
        return SWIMMER_BALANCE.maxSpeed > 0 ? clamp01(this._currentSpeed / SWIMMER_BALANCE.maxSpeed) : 0;
    }

    private queueSideStroke(type: StrokeType): QueueSideStrokeResult {
        const isLeft = type === StrokeType.LEFT;
        const actions = isLeft ? this._leftActions : this._rightActions;
        const armKey = isLeft ? '_leftArmMotionRemaining' : '_rightArmMotionRemaining';
        const kickKey = isLeft ? '_rightKickMotionRemaining' : '_leftKickMotionRemaining';
        if (!this.canQueueSideStroke(type)) {
            return { queued: false, startedImmediately: false };
        }

        this.queueMotionCycle(armKey);
        this.queueMotionCycle(kickKey);
        const held = isLeft ? this._leftStrokeHeld : this._rightStrokeHeld;
        const pressedAt = held ? Math.max(0, isLeft ? this._leftPressStartedAt : this._rightPressStartedAt) : -1;
        const startedImmediately = actions.length === 0;
        actions.push({
            queuedAt: this._motionClock,
            startedAt: startedImmediately ? this._motionClock : -1,
            pressedAt,
            releasedAt: held ? -1 : this._motionClock,
            progress: 0,
            baseAccelerationStarted: false,
            stabilitySettled: false,
            alternationQuality: 0,
            inputFreshness: 1,
            inputLeadSeconds: 0,
            inputLeadRatio: 0,
        });
        if (startedImmediately) {
            this.startActionBaseAcceleration(type, actions[actions.length - 1]);
        }
        return { queued: true, startedImmediately };
    }

    private canQueueSideStroke(type: StrokeType): boolean {
        const isLeft = type === StrokeType.LEFT;
        const actions = isLeft ? this._leftActions : this._rightActions;
        const armKey = isLeft ? '_leftArmMotionRemaining' : '_rightArmMotionRemaining';
        const kickKey = isLeft ? '_rightKickMotionRemaining' : '_leftKickMotionRemaining';
        return actions.length < 2 && this.canQueueMotionCycle(armKey) && this.canQueueMotionCycle(kickKey);
    }

    private queueVisualSideStroke(type: StrokeType): boolean {
        const isLeft = type === StrokeType.LEFT;
        const armKey = isLeft ? '_leftArmMotionRemaining' : '_rightArmMotionRemaining';
        const kickKey = isLeft ? '_rightKickMotionRemaining' : '_leftKickMotionRemaining';
        if (!this.canQueueMotionCycle(armKey) || !this.canQueueMotionCycle(kickKey)) {
            return false;
        }
        const armQueued = this.queueMotionCycle(armKey);
        const kickQueued = this.queueMotionCycle(kickKey);
        return armQueued || kickQueued;
    }

    private canQueueMotionCycle(
        remainingKey: '_leftArmMotionRemaining' | '_rightArmMotionRemaining' | '_leftKickMotionRemaining' | '_rightKickMotionRemaining',
    ): boolean {
        return this[remainingKey] + CYCLE_AMOUNT <= MAX_QUEUED_MOTION + 0.0001;
    }

    private queueMotionCycle(
        remainingKey: '_leftArmMotionRemaining' | '_rightArmMotionRemaining' | '_leftKickMotionRemaining' | '_rightKickMotionRemaining',
    ): boolean {
        const next = Math.min(MAX_QUEUED_MOTION, this[remainingKey] + CYCLE_AMOUNT);
        if (next <= this[remainingKey]) {
            return false;
        }
        this[remainingKey] = next;
        return true;
    }

    private advanceQueuedMotion(
        dt: number,
        speed: number,
        remainingKey: '_leftArmMotionRemaining' | '_rightArmMotionRemaining' | '_leftKickMotionRemaining' | '_rightKickMotionRemaining',
        speedScale: number,
    ): number {
        const remaining = this[remainingKey];
        if (remaining <= 0) {
            return 0;
        }

        const step = Math.min(remaining, speed * speedScale * dt);
        this[remainingKey] -= step;
        return step;
    }

    private advanceSideActions(dt: number, speed: number, type: StrokeType, speedScale: number) {
        const actions = type === StrokeType.LEFT ? this._leftActions : this._rightActions;
        if (actions.length === 0) {
            return;
        }
        const scaledSpeed = speed * speedScale;
        if (scaledSpeed <= 0) {
            return;
        }

        const frameStartedAt = this._motionClock - dt;
        let remainingStep = scaledSpeed * dt;
        let elapsed = 0;
        while (remainingStep > 0.00001 && actions.length > 0) {
            const action = actions[0];
            if (action.startedAt < 0) {
                action.startedAt = frameStartedAt + elapsed;
                if (!action.baseAccelerationStarted) {
                    this.startActionBaseAcceleration(type, action);
                }
            }
            const needed = CYCLE_AMOUNT - action.progress;
            const consumed = Math.min(needed, remainingStep);
            action.progress += consumed;
            remainingStep -= consumed;
            elapsed += consumed / scaledSpeed;

            if (action.progress >= CYCLE_AMOUNT - 0.00001) {
                actions.shift();
                this.finishAction(type, action, frameStartedAt + elapsed);
            }
        }
    }

    private motionSpeedScaleForSide(type: StrokeType): number {
        const activeAction = type === StrokeType.LEFT ? this._leftActions[0] : this._rightActions[0];
        if (activeAction && activeAction.releasedAt >= 0) {
            return MOTION_TUNING.releasedMotionSpeedScale * MOTION_TUNING.animationSpeedScale;
        }
        const held = type === StrokeType.LEFT ? this._leftStrokeHeld : this._rightStrokeHeld;
        const sideScale = held ? MOTION_TUNING.heldMotionSpeedScale : MOTION_TUNING.releasedMotionSpeedScale;
        return sideScale * MOTION_TUNING.animationSpeedScale;
    }

    private recordAlternation(type: StrokeType): number {
        if (type !== StrokeType.LEFT && type !== StrokeType.RIGHT) {
            return 1;
        }

        this._alternationHistory.push(type);
        const windowSize = Math.max(2, Math.round(SWIMMER_BALANCE.alternationWindowSize));
        while (this._alternationHistory.length > windowSize) {
            this._alternationHistory.shift();
        }

        let leftCount = 0;
        let rightCount = 0;
        for (const side of this._alternationHistory) {
            if (side === StrokeType.LEFT) {
                leftCount += 1;
            } else if (side === StrokeType.RIGHT) {
                rightCount += 1;
            }
        }

        const count = leftCount + rightCount;
        if (count <= 0) {
            return 1;
        }
        return clamp01(1 - Math.abs(leftCount - rightCount) / count);
    }

    get currentSpeed(): number {
        return this._currentSpeed;
    }

    get distance(): number {
        return this._distance;
    }

    get isRacing(): boolean {
        return this._isRacing;
    }

    get bodyPhase(): number {
        return this._bodyPhase;
    }

    get armCycle(): number {
        return this._leftArmCycle;
    }

    get kickCycle(): number {
        return this._rightKickCycle;
    }

    get leftArmCycle(): number {
        return this._leftArmCycle;
    }

    get rightArmCycle(): number {
        return this._rightArmCycle;
    }

    get leftKickCycle(): number {
        return this._leftKickCycle;
    }

    get rightKickCycle(): number {
        return this._rightKickCycle;
    }

    get armAction(): number {
        return this._armAction;
    }

    get kickAction(): number {
        return this._kickAction;
    }

    get lastStability(): number {
        return this._lastStability;
    }

    get lastInputFreshness(): number {
        return this._lastInputFreshness;
    }

    get currentAcceleration(): number {
        return this._currentAcceleration;
    }

    get actionCycleSeconds(): number {
        return this.currentCycleSeconds();
    }

    get strokeTimingGuide(): StrokeTimingGuide {
        const action = this.currentGuideAction();
        const actionSeconds = action ? this.predictedActionSecondsAfterRelease(action) : this.currentCycleSeconds();
        const holdSeconds = action ? this.currentHoldSeconds(action) : 0;
        return {
            active: !!action && action.releasedAt < 0,
            currentRatio: clamp01(holdSeconds / Math.max(0.001, actionSeconds)),
            holdSeconds,
            actionSeconds,
            minHoldRatio: clamp01(STABILITY_TUNING.minHoldSeconds / Math.max(0.001, actionSeconds)),
            intervals: this.timingGuideIntervals(action, actionSeconds),
        };
    }

    consumeStabilityResults(): StrokeStabilityResult[] {
        if (this._pendingStabilityResults.length === 0) {
            return [];
        }
        return this._pendingStabilityResults.splice(0);
    }

    private currentGuideAction(): StrokeAction | null {
        const left = this._leftActions[0];
        const right = this._rightActions[0];
        const candidates = [left, right].filter((action) => action && action.startedAt >= 0 && !action.stabilitySettled);
        if (candidates.length === 0) {
            return null;
        }
        candidates.sort((a, b) => a.startedAt - b.startedAt);
        return candidates[0];
    }

    private currentHoldSeconds(action: StrokeAction): number {
        if (action.pressedAt < 0 || action.startedAt < 0) {
            return 0;
        }
        const holdStart = Math.max(action.pressedAt, action.startedAt);
        const holdEnd = action.releasedAt >= 0 ? Math.min(action.releasedAt, this._motionClock) : this._motionClock;
        return Math.max(0, holdEnd - holdStart);
    }

    private timingGuideIntervals(action: StrokeAction | null, actionSeconds: number): StrokeTimingGuideInterval[] {
        const intervals: StrokeTimingGuideInterval[] = [];
        const steps = 96;
        let openRating = this.ratingForGuideRatio(0.5 / steps, action, actionSeconds);
        let openStart = 0;
        for (let i = 1; i <= steps; i++) {
            const start = i / steps;
            const end = Math.min(1, (i + 1) / steps);
            const rating = i < steps ? this.ratingForGuideRatio((start + end) * 0.5, action, actionSeconds) : openRating;
            if (i >= steps || rating !== openRating) {
                intervals.push({
                    rating: openRating,
                    startRatio: openStart,
                    endRatio: start,
                });
                openRating = rating;
                openStart = start;
            }
        }
        return intervals;
    }

    private ratingForGuideRatio(holdRatio: number, action: StrokeAction | null, actionSeconds: number): Rating {
        const holdSeconds = clamp01(holdRatio) * Math.max(0.001, actionSeconds);
        if (holdSeconds < STABILITY_TUNING.minHoldSeconds) {
            return Rating.BAD;
        }
        const ratios = this._holdRatioHistory.slice();
        ratios.push(clamp01(holdRatio));
        while (ratios.length > Math.max(1, Math.round(STABILITY_TUNING.sampleWindowSize))) {
            ratios.shift();
        }
        const stats = stabilityFromRatios(ratios);
        const freshness = action ? this.guideInputFreshness(action, actionSeconds) : 1;
        return ratingForGuideStability(clamp01(stats.stability * freshness));
    }

    private guideInputFreshness(action: StrokeAction, actionSeconds: number): number {
        const leadSeconds = Math.max(0, action.startedAt - action.queuedAt);
        const leadRatio = leadSeconds / Math.max(0.001, actionSeconds);
        return inputFreshnessWeight(leadRatio);
    }
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * clamp01(t);
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
    return clamp(value, 0, 1);
}

function strongerStability(a: StrokeStabilityResult | null, b: StrokeStabilityResult | null): StrokeStabilityResult | null {
    if (!a) {
        return b;
    }
    if (!b) {
        return a;
    }
    return a.stability >= b.stability ? a : b;
}

function stabilityFromRatios(ratios: number[]): { stability: number; meanRatio: number; ratioStdDev: number; sampleCount: number } {
    const sampleCount = ratios.length;
    if (sampleCount === 0) {
        return { stability: 0, meanRatio: 0, ratioStdDev: 0, sampleCount: 0 };
    }

    const currentRatio = ratios[ratios.length - 1];
    const meanRatio = ratios.reduce((sum, value) => sum + value, 0) / sampleCount;
    const varianceSamples = ratios.filter((ratio) => usefulRatioWeight(ratio) > 0);
    const consistencyRatios = varianceSamples.length > 0 ? varianceSamples : [currentRatio];
    const consistencyMean = consistencyRatios.reduce((sum, value) => sum + value, 0) / consistencyRatios.length;
    const variance = consistencyRatios.reduce((sum, value) => sum + Math.pow(value - consistencyMean, 2), 0) / consistencyRatios.length;
    const ratioStdDev = Math.sqrt(variance);
    const badStdDev = Math.max(STABILITY_TUNING.badStdDev, STABILITY_TUNING.perfectStdDev + 0.001);
    const stdDevRange = badStdDev - STABILITY_TUNING.perfectStdDev;
    const stdDevT = clamp01((ratioStdDev - STABILITY_TUNING.perfectStdDev) / stdDevRange);
    const consistency = 1 - smoothstep(stdDevT);
    const validity = usefulRatioWeight(currentRatio);
    return {
        stability: clamp01(consistency * validity),
        meanRatio,
        ratioStdDev,
        sampleCount: consistencyRatios.length,
    };
}

function usefulRatioWeight(meanRatio: number): number {
    const edge = Math.max(0.001, STABILITY_TUNING.usefulRatioEdgeWindow);
    const low = smoothstep(clamp01((meanRatio - STABILITY_TUNING.minUsefulRatio) / edge));
    const high = 1 - smoothstep(clamp01((meanRatio - STABILITY_TUNING.maxUsefulRatio) / edge));
    return clamp01(low * high);
}

function inputFreshnessWeight(leadRatio: number): number {
    const grace = Math.max(0, STABILITY_TUNING.inputFreshnessGraceRatio);
    const penalty = Math.max(0.001, STABILITY_TUNING.inputFreshnessPenaltyRatio);
    const minScale = clamp01(STABILITY_TUNING.inputFreshnessMinScale);
    const t = smoothstep(clamp01((leadRatio - grace) / penalty));
    return lerp(1, minScale, t);
}

function describeBadReason(data: {
    holdTimeValid: boolean;
    holdSeconds: number;
    minHoldSeconds: number;
    meanRatio: number;
    ratioStdDev: number;
    sampleCount: number;
    inputFreshness: number;
    inputLeadRatio: number;
}): string {
    const reasons: string[] = [];
    if (!data.holdTimeValid) {
        reasons.push(`hold_too_short(${data.holdSeconds.toFixed(2)}<${data.minHoldSeconds.toFixed(2)})`);
    }
    if (data.sampleCount <= 0) {
        reasons.push('no_samples');
    }
    if (data.meanRatio < STABILITY_TUNING.minUsefulRatio) {
        reasons.push(`hold_ratio_low(${(data.meanRatio * 100).toFixed(0)}%<${(STABILITY_TUNING.minUsefulRatio * 100).toFixed(0)}%)`);
    } else if (data.meanRatio > STABILITY_TUNING.maxUsefulRatio) {
        reasons.push(`hold_ratio_high(${(data.meanRatio * 100).toFixed(0)}%>${(STABILITY_TUNING.maxUsefulRatio * 100).toFixed(0)}%)`);
    }
    if (data.ratioStdDev >= Math.max(STABILITY_TUNING.badStdDev, STABILITY_TUNING.perfectStdDev + 0.001)) {
        reasons.push(`ratio_unstable(std=${data.ratioStdDev.toFixed(3)})`);
    }
    if (data.inputFreshness <= 0 && data.inputLeadRatio > STABILITY_TUNING.inputFreshnessGraceRatio) {
        reasons.push(`input_too_early(lead=${(data.inputLeadRatio * 100).toFixed(0)}%)`);
    }
    return reasons.length > 0 ? reasons.join('|') : 'stability_zero';
}

function smoothstep(value: number): number {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
}

function ratingForGuideStability(stability: number): Rating {
    if (stability >= 0.999) {
        return Rating.PERFECT;
    }
    if (stability > 0) {
        return Rating.GOOD;
    }
    return Rating.BAD;
}
