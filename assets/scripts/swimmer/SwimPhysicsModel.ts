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
    // Added on top of the normal drag so an un-kicked glide bleeds off fast.
    glideDrag?: number;
};

export class SwimPhysicsModel {
    step(state: SwimPhysicsState, input: SwimPhysicsInput): SwimPhysicsState {
        const maxSpeed = SWIMMER_BALANCE.maxSpeed + Math.max(0, input.speedCapBonus);
        const speedRatio = clamp01(state.currentSpeed / maxSpeed);
        const accelLimit = 0.16 + 0.84 * (1 - Math.pow(speedRatio, 1.6));
        // Arm-stroke pulses taper off toward maxSpeed via accelLimit. Kick
        // acceleration is already frequency-scaled and fades into its own ceiling
        // (kickMaxSpeed) in the motor, so it is added directly here. AI and player
        // share this exact model now — the AI drives real stroke acceleration
        // through the same path instead of a separate cruise constant.
        const accel = input.strokeAcceleration * accelLimit + Math.max(0, input.kickAcceleration);
        const speed = state.currentSpeed;
        const drag = (
            SWIMMER_BALANCE.poolDeceleration
            + SWIMMER_BALANCE.baseDrag * speed
            + SWIMMER_BALANCE.highSpeedDrag * speed * speed
            + Math.max(0, input.glideDrag ?? 0) * speed
        );
        const currentSpeed = clamp(state.currentSpeed + (accel - drag) * input.dt, SWIMMER_BALANCE.minSpeed, maxSpeed);

        return {
            currentSpeed,
            distance: state.distance,
        };
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
    return clamp(value, 0, 1);
}
