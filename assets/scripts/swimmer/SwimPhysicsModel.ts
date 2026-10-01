import { SWIMMER_BALANCE } from '../core/GameBalance';

export type SwimPhysicsState = {
    currentSpeed: number;
    distance: number;
};

export type SwimPhysicsInput = {
    dt: number;
    strokeAcceleration: number;
    kickAcceleration: number;
    speedCapBonus: number;
    // Extra drag coefficient (per m/s) active only during the underwater glide.
    glideDrag?: number;
    // World-space soft obstacles add drag only; they never write heading or position.
    environmentDrag?: number;
};

export class SwimPhysicsModel {
    step(state: SwimPhysicsState, input: SwimPhysicsInput): SwimPhysicsState {
        return {
            currentSpeed: this.speedAfterStep(state.currentSpeed, input),
            distance: state.distance,
        };
    }

    /** 标量入口供本地蝶泳小步积分复用，普通及联机 step 的计算顺序保持原样。 */
    speedAfterStep(speed: number, input: SwimPhysicsInput): number {
        const maxSpeed = SWIMMER_BALANCE.maxSpeed + Math.max(0, input.speedCapBonus);
        const speedRatio = clamp01(speed / maxSpeed);
        const accelLimit = 0.16 + 0.84 * (1 - Math.pow(speedRatio, 1.6));
        const accel = input.strokeAcceleration * accelLimit + Math.max(0, input.kickAcceleration);
        const drag = (
            SWIMMER_BALANCE.poolDeceleration
            + SWIMMER_BALANCE.baseDrag * speed
            + SWIMMER_BALANCE.highSpeedDrag * speed * speed
            + Math.max(0, input.glideDrag ?? 0) * speed
            + Math.max(0, input.environmentDrag ?? 0) * speed
        );
        return clamp(speed + (accel - drag) * input.dt, SWIMMER_BALANCE.minSpeed, maxSpeed);
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
    return clamp(value, 0, 1);
}
