export const enum EntertainmentRecoveryPhase {
    ACTIVE = 0,
    KNOCKED = 1,
    INVULNERABLE = 2,
}

export const enum EntertainmentRecoveryReason {
    NONE = 0,
    SHARK = 1,
    CANNON = 2,
    TIMED_BOMB = 3,
    MINEFIELD = 4,
}

export const ENTERTAINMENT_RECOVERY_TUNING = {
    knockedSeconds: 3.5,
    invulnerableSeconds: 2,
    respawnSpeed: 0,
    disappearBlinkSeconds: 0.55,
    appearBlinkSeconds: 0.65,
};

const RECOVERY_BLINK_TOGGLE_COUNT = 6;

/**
 * 纯表现：急救结束前在旧位置闪退，重生后在新位置闪入。
 * 只读取现有权威阶段和剩余时间，不增加联机字段，也不改变无敌判定。
 */
export function entertainmentRecoveryBodyVisible(
    phase: EntertainmentRecoveryPhase,
    remainingSeconds: number,
): boolean {
    const remaining = Number.isFinite(remainingSeconds) ? Math.max(0, remainingSeconds) : 0;
    if (phase === EntertainmentRecoveryPhase.KNOCKED) {
        const blinkSeconds = Math.min(
            Math.max(0, ENTERTAINMENT_RECOVERY_TUNING.knockedSeconds),
            Math.max(0, ENTERTAINMENT_RECOVERY_TUNING.disappearBlinkSeconds),
        );
        if (blinkSeconds <= 0 || remaining > blinkSeconds) return true;
        if (remaining <= 0) return false;
        const elapsedRatio = Math.min(0.999999, Math.max(0, (blinkSeconds - remaining) / blinkSeconds));
        return Math.floor(elapsedRatio * RECOVERY_BLINK_TOGGLE_COUNT) % 2 === 0;
    }
    if (phase === EntertainmentRecoveryPhase.INVULNERABLE) {
        const invulnerableSeconds = Math.max(0, ENTERTAINMENT_RECOVERY_TUNING.invulnerableSeconds);
        const blinkSeconds = Math.min(
            invulnerableSeconds,
            Math.max(0, ENTERTAINMENT_RECOVERY_TUNING.appearBlinkSeconds),
        );
        if (blinkSeconds <= 0) return true;
        const elapsed = Math.max(0, invulnerableSeconds - remaining);
        if (elapsed >= blinkSeconds) return true;
        const elapsedRatio = Math.min(0.999999, elapsed / blinkSeconds);
        // 重生交界先保持隐藏，确保位置和姿态复位不会在屏幕上硬跳。
        return Math.floor(elapsedRatio * RECOVERY_BLINK_TOGGLE_COUNT) % 2 === 1;
    }
    return true;
}

export type EntertainmentRecoveryEvent = {
    lane: number;
    reason: EntertainmentRecoveryReason;
    distance: number;
    revision: number;
};

export type EntertainmentRecoveryLaneState = {
    phase: EntertainmentRecoveryPhase;
    reason: EntertainmentRecoveryReason;
    remainingSeconds: number;
    distance: number;
    revision: number;
};

export type EntertainmentRecoverySnapshot = {
    revision: number;
    lanes: readonly EntertainmentRecoveryLaneState[];
};

export type EntertainmentRecoveryHooks = {
    onKnocked: (lane: number, state: Readonly<EntertainmentRecoveryLaneState>) => void;
    onRespawn: (lane: number, state: Readonly<EntertainmentRecoveryLaneState>) => void;
    onRecovered: (lane: number, state: Readonly<EntertainmentRecoveryLaneState>) => void;
};

/**
 * 鲨鱼／炮火／定时炸弹／水雷娱乐玩法共用的击倒恢复状态机。
 * 规则不持有 Cocos 节点；房主、单机和访客都推进同一阶段，权威快照负责纠偏。
 */
export class EntertainmentRecoveryController {
    private readonly laneStates: EntertainmentRecoveryLaneState[];
    private revision = 0;

    constructor(
        laneCount: number,
        private readonly hooks: EntertainmentRecoveryHooks,
    ) {
        this.laneStates = Array.from({ length: Math.max(0, Math.floor(laneCount)) }, () => ({
            phase: EntertainmentRecoveryPhase.ACTIVE,
            reason: EntertainmentRecoveryReason.NONE,
            remainingSeconds: 0,
            distance: 0,
            revision: 0,
        }));
    }

    reset(): void {
        this.revision = 0;
        for (const state of this.laneStates) {
            state.phase = EntertainmentRecoveryPhase.ACTIVE;
            state.reason = EntertainmentRecoveryReason.NONE;
            state.remainingSeconds = 0;
            state.distance = 0;
            state.revision = 0;
        }
    }

    tryKnockDown(
        lane: number,
        reason: EntertainmentRecoveryReason,
        distance: number,
    ): EntertainmentRecoveryEvent | null {
        const state = this.laneStates[lane];
        if (!state || state.phase !== EntertainmentRecoveryPhase.ACTIVE
            || reason === EntertainmentRecoveryReason.NONE || !Number.isFinite(distance)) return null;
        const event = {
            lane,
            reason,
            distance: Math.max(0, distance),
            revision: this.revision + 1,
        };
        return this.applyKnockDown(event) ? event : null;
    }

    applyKnockDown(event: EntertainmentRecoveryEvent): boolean {
        if (!isValidRecoveryEvent(event)) return false;
        const state = this.laneStates[event.lane];
        if (!state || event.revision <= state.revision) return false;
        this.revision = Math.max(this.revision, event.revision);
        state.phase = EntertainmentRecoveryPhase.KNOCKED;
        state.reason = event.reason;
        state.remainingSeconds = Math.max(0, ENTERTAINMENT_RECOVERY_TUNING.knockedSeconds);
        state.distance = Math.max(0, event.distance);
        state.revision = event.revision;
        this.hooks.onKnocked(event.lane, state);
        return true;
    }

    update(dt: number): void {
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        if (step <= 0) return;
        for (let lane = 0; lane < this.laneStates.length; lane++) {
            const state = this.laneStates[lane];
            let remainingStep = step;
            if (state.phase === EntertainmentRecoveryPhase.KNOCKED) {
                if (remainingStep < state.remainingSeconds) {
                    state.remainingSeconds -= remainingStep;
                    continue;
                }
                remainingStep = Math.max(0, remainingStep - state.remainingSeconds);
                state.phase = EntertainmentRecoveryPhase.INVULNERABLE;
                state.remainingSeconds = Math.max(0, ENTERTAINMENT_RECOVERY_TUNING.invulnerableSeconds);
                this.hooks.onRespawn(lane, state);
            }
            if (state.phase !== EntertainmentRecoveryPhase.INVULNERABLE) continue;
            if (remainingStep < state.remainingSeconds) {
                state.remainingSeconds -= remainingStep;
                continue;
            }
            state.phase = EntertainmentRecoveryPhase.ACTIVE;
            state.reason = EntertainmentRecoveryReason.NONE;
            state.remainingSeconds = 0;
            this.hooks.onRecovered(lane, state);
        }
    }

    applySnapshot(snapshot: EntertainmentRecoverySnapshot): boolean {
        if (!isValidRecoverySnapshot(snapshot, this.laneStates.length) || snapshot.revision < this.revision) return false;
        this.revision = Math.max(this.revision, snapshot.revision);
        for (let lane = 0; lane < this.laneStates.length; lane++) {
            this.applyLaneSnapshot(lane, snapshot.lanes[lane]);
        }
        return true;
    }

    snapshot(): EntertainmentRecoverySnapshot {
        return {
            revision: this.revision,
            lanes: this.laneStates.map(state => ({ ...state })),
        };
    }

    stateForLane(lane: number): Readonly<EntertainmentRecoveryLaneState> | null {
        return this.laneStates[lane] ?? null;
    }

    isDamageable(lane: number): boolean {
        return this.laneStates[lane]?.phase === EntertainmentRecoveryPhase.ACTIVE;
    }

    private applyLaneSnapshot(lane: number, incoming: Readonly<EntertainmentRecoveryLaneState>): void {
        const state = this.laneStates[lane];
        if (incoming.revision < state.revision) return;
        const previousPhase = state.phase;
        if (incoming.revision === state.revision) {
            const previousRank = phaseRank(previousPhase);
            const incomingRank = phaseRank(incoming.phase);
            if (incomingRank < previousRank) return;
            if (incoming.phase === previousPhase) {
                state.remainingSeconds = Math.min(state.remainingSeconds, Math.max(0, incoming.remainingSeconds));
                state.distance = Math.max(0, incoming.distance);
                state.reason = incoming.reason;
                return;
            }
        }
        state.phase = incoming.phase;
        state.reason = incoming.reason;
        state.remainingSeconds = Math.max(0, incoming.remainingSeconds);
        state.distance = Math.max(0, incoming.distance);
        state.revision = incoming.revision;
        if (incoming.phase === EntertainmentRecoveryPhase.KNOCKED) {
            this.hooks.onKnocked(lane, state);
            return;
        }
        if (incoming.phase === EntertainmentRecoveryPhase.INVULNERABLE) {
            this.hooks.onRespawn(lane, state);
            return;
        }
        if (previousPhase === EntertainmentRecoveryPhase.KNOCKED) this.hooks.onRespawn(lane, state);
        if (previousPhase !== EntertainmentRecoveryPhase.ACTIVE) this.hooks.onRecovered(lane, state);
    }
}

function phaseRank(phase: EntertainmentRecoveryPhase): number {
    return phase === EntertainmentRecoveryPhase.KNOCKED
        ? 1
        : phase === EntertainmentRecoveryPhase.INVULNERABLE ? 2 : 3;
}

function isValidRecoveryEvent(event: EntertainmentRecoveryEvent): boolean {
    return !!event
        && Number.isSafeInteger(event.lane) && event.lane >= 0
        && (event.reason === EntertainmentRecoveryReason.SHARK
            || event.reason === EntertainmentRecoveryReason.CANNON
            || event.reason === EntertainmentRecoveryReason.TIMED_BOMB
            || event.reason === EntertainmentRecoveryReason.MINEFIELD)
        && Number.isFinite(event.distance) && event.distance >= 0
        && Number.isSafeInteger(event.revision) && event.revision > 0;
}

function isValidRecoverySnapshot(snapshot: EntertainmentRecoverySnapshot, laneCount: number): boolean {
    return !!snapshot && Number.isSafeInteger(snapshot.revision) && snapshot.revision >= 0
        && Array.isArray(snapshot.lanes) && snapshot.lanes.length === laneCount
        && snapshot.lanes.every((state) => !!state
            && (state.phase === EntertainmentRecoveryPhase.ACTIVE
                || state.phase === EntertainmentRecoveryPhase.KNOCKED
                || state.phase === EntertainmentRecoveryPhase.INVULNERABLE)
            && (state.reason === EntertainmentRecoveryReason.NONE
                || state.reason === EntertainmentRecoveryReason.SHARK
                || state.reason === EntertainmentRecoveryReason.CANNON
                || state.reason === EntertainmentRecoveryReason.TIMED_BOMB
                || state.reason === EntertainmentRecoveryReason.MINEFIELD)
            && Number.isFinite(state.remainingSeconds) && state.remainingSeconds >= 0
            && Number.isFinite(state.distance) && state.distance >= 0
            && Number.isSafeInteger(state.revision) && state.revision >= 0);
}
