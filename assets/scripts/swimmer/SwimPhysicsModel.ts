import { SWIMMER_BALANCE } from '../core/GameBalance';

export type SwimPhysicsState = {
    currentSpeed: number;
    distance: number;
};

export type SwimPhysicsInput = {
    dt: number;
    isAI: boolean;
    aiPower: number;
    aiMaxSpeedScale: number;
    strokeAcceleration: number;
    speedCapBonus: number;
};

export class SwimPhysicsModel {
    step(state: SwimPhysicsState, input: SwimPhysicsInput): SwimPhysicsState {
        const maxSpeed = SWIMMER_BALANCE.maxSpeed * (input.isAI ? input.aiMaxSpeedScale : 1) + Math.max(0, input.speedCapBonus);
        const aiPower = input.isAI ? input.aiPower : 1;
        const speedRatio = clamp01(state.currentSpeed / maxSpeed);
        const accelLimit = 0.16 + 0.84 * (1 - Math.pow(speedRatio, 1.6));
        const aiCruiseAccel = input.isAI ? SWIMMER_BALANCE.aiCruiseAccel : 0;
        const accel = (input.strokeAcceleration + aiCruiseAccel) * accelLimit * aiPower;
        const aiDragScale = input.isAI ? Math.max(0.7, 1 - (aiPower - 1) * 0.32) : 1;
        const drag = (
            SWIMMER_BALANCE.poolDeceleration
            + SWIMMER_BALANCE.baseDrag * state.currentSpeed
            + SWIMMER_BALANCE.highSpeedDrag * speedRatio * state.currentSpeed
        ) * aiDragScale;
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
