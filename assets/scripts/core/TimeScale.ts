// Global debug time-scale ("bullet time"). Cocos Creator 3.x drives each
// Component.update(dt) through the component scheduler with the RAW frame delta;
// director.getScheduler().setTimeScale() only affects schedule()/tween, NOT
// Component.update — so it cannot slow the gameplay world on its own. Instead we
// keep one global scale here and multiply it into the dt at the top of the
// gameplay components that read dt. Input classification deliberately keeps using
// wall-clock time, so key presses stay responsive while the world is slowed.
export const TIME_SCALE = { value: 1 };

export function setTimeScale(scale: number) {
    TIME_SCALE.value = Math.max(0, scale);
}

export function scaledDelta(dt: number): number {
    return dt * TIME_SCALE.value;
}
