import { ENTERTAINMENT_RECOVERY_TUNING } from '../core/EntertainmentBalance';
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

export { ENTERTAINMENT_RECOVERY_TUNING } from '../core/EntertainmentBalance';

const RECOVERY_BLINK_TOGGLE_COUNT = 6;

/**
 * 纯表现：急救结束前在旧位置闪退，重生后在新位置闪入。
 * 只读取当前恢复阶段和剩余时间，不改变保护判定。
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

export type EntertainmentRecoveryHooks = {
    onKnocked: (lane: number, state: Readonly<EntertainmentRecoveryLaneState>) => void;
    onRespawn: (lane: number, state: Readonly<EntertainmentRecoveryLaneState>) => void;
    onRecovered: (lane: number, state: Readonly<EntertainmentRecoveryLaneState>) => void;
};

/**
 * 娱乐玩法共用的击倒恢复状态机。仅由本地娱乐生命周期创建。
 * 规则不持有 Cocos 节点；选手退场后退休，重赛时重置。
 */
export class EntertainmentRecoveryController {
    private readonly laneStates: EntertainmentRecoveryLaneState[];
    private readonly retiredLanes = new Set<number>();
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
        this.retiredLanes.clear();
        for (const state of this.laneStates) {
            state.phase = EntertainmentRecoveryPhase.ACTIVE;
            state.reason = EntertainmentRecoveryReason.NONE;
            state.remainingSeconds = 0;
            state.distance = 0;
            state.revision = 0;
        }
    }

    /** 终止本局恢复任务并拒绝迟到状态；reset 后仍由比赛淘汰资格兜底。 */
    retireLane(lane: number): void {
        const state = this.laneStates[lane];
        if (!state || this.retiredLanes.has(lane)) return;
        this.retiredLanes.add(lane);
        state.phase = EntertainmentRecoveryPhase.ACTIVE;
        state.reason = EntertainmentRecoveryReason.NONE;
        state.remainingSeconds = 0;
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
        if (!state || this.retiredLanes.has(event.lane) || event.revision <= state.revision) return false;
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

    stateForLane(lane: number): Readonly<EntertainmentRecoveryLaneState> | null {
        return this.laneStates[lane] ?? null;
    }

    isDamageable(lane: number): boolean {
        return this.laneStates[lane]?.phase === EntertainmentRecoveryPhase.ACTIVE
            && !this.retiredLanes.has(lane);
    }

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
