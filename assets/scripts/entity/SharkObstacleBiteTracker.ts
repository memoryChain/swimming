export type SharkObstacleBiteTrackerTuning = {
    blockedSeconds: number;
    reverseDistance: number;
    forwardSpeedTolerance: number;
    sameTargetCooldownSeconds: number;
    globalCooldownSeconds: number;
};

type ContactState = {
    contacting: boolean;
    blockedSeconds: number;
    lastDistance: number;
    furthestDistance: number;
    cooldownSeconds: number;
};

const MAX_TRACKED_LANES = 32;

/**
 * 只记录巡游鲨鱼与选手持续卡住的状态，不接触 Cocos 节点。
 * 房主／单机每帧喂入权威位置；短暂擦碰、同向同行和仍能正常前进都不会触发。
 */
export class SharkObstacleBiteTracker {
    private readonly states: Array<ContactState | undefined> = [];
    private globalCooldownSeconds = 0;

    constructor(private readonly tuning: Readonly<SharkObstacleBiteTrackerTuning>) {}

    reset(): void {
        this.states.length = 0;
        this.globalCooldownSeconds = 0;
    }

    beginFrame(dt: number): number {
        const step = safeStep(dt);
        if (step <= 0) return 0;
        this.globalCooldownSeconds = Math.max(0, this.globalCooldownSeconds - step);
        for (let lane = 0; lane < this.states.length; lane++) {
            const state = this.states[lane];
            if (state) state.cooldownSeconds = Math.max(0, state.cooldownSeconds - step);
        }
        return step;
    }

    registerBite(lane: number, distance: number): void {
        if (!Number.isSafeInteger(lane) || lane < 0 || lane >= MAX_TRACKED_LANES || !Number.isFinite(distance)) return;
        let state = this.states[lane];
        if (!state) {
            state = {
                contacting: false,
                blockedSeconds: 0,
                lastDistance: Math.max(0, distance),
                furthestDistance: Math.max(0, distance),
                cooldownSeconds: 0,
            };
            this.states[lane] = state;
        }
        state.cooldownSeconds = Math.max(state.cooldownSeconds, this.tuning.sameTargetCooldownSeconds);
        this.globalCooldownSeconds = Math.max(this.globalCooldownSeconds, this.tuning.globalCooldownSeconds);
        resetContact(state, Math.max(0, distance));
    }

    sample(
        lane: number,
        contact: boolean,
        opposing: boolean,
        damageable: boolean,
        distance: number,
        step: number,
    ): boolean {
        if (!Number.isSafeInteger(lane) || lane < 0 || lane >= MAX_TRACKED_LANES || !Number.isFinite(distance)) return false;
        const safeDistance = Math.max(0, distance);
        let state = this.states[lane];
        if (!state) {
            if (!contact || !opposing || !damageable) return false;
            state = {
                contacting: false,
                blockedSeconds: 0,
                lastDistance: safeDistance,
                furthestDistance: safeDistance,
                cooldownSeconds: 0,
            };
            this.states[lane] = state;
        }

        if (!contact || !opposing || !damageable) {
            resetContact(state, safeDistance);
            return false;
        }
        if (!state.contacting) {
            state.contacting = true;
            state.blockedSeconds = 0;
            state.lastDistance = safeDistance;
            state.furthestDistance = safeDistance;
            return false;
        }

        const safeStepSeconds = safeStep(step);
        const forwardStep = safeDistance - state.lastDistance;
        const toleratedForwardStep = Math.max(0, this.tuning.forwardSpeedTolerance) * safeStepSeconds;
        if (safeStepSeconds > 0 && forwardStep <= toleratedForwardStep + 0.0001) {
            state.blockedSeconds += safeStepSeconds;
        } else if (forwardStep > toleratedForwardStep + 0.0001) {
            state.blockedSeconds = 0;
        }
        state.lastDistance = safeDistance;
        state.furthestDistance = Math.max(state.furthestDistance, safeDistance);

        const blockedLongEnough = state.blockedSeconds >= Math.max(0, this.tuning.blockedSeconds);
        const pushedBackFarEnough = state.furthestDistance - safeDistance
            >= Math.max(0, this.tuning.reverseDistance);
        if ((!blockedLongEnough && !pushedBackFarEnough)
            || state.cooldownSeconds > 0 || this.globalCooldownSeconds > 0) return false;

        this.registerBite(lane, safeDistance);
        return true;
    }
}

function resetContact(state: ContactState, distance: number): void {
    state.contacting = false;
    state.blockedSeconds = 0;
    state.lastDistance = distance;
    state.furthestDistance = distance;
}

function safeStep(dt: number): number {
    return Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
}
