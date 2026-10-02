// 真实玩家输入分类器／AI控制器、实体与运动模型；每帧记录供动作重放。
const { createAiHarness } = require('./ai-race-harness.cjs');

function replayBreathingInput({ mode = 'player', fps = 60, seconds = 6, releaseProgress = .39, gap = .02 } = {}) {
    const h = createAiHarness();
    h.load('core/SharedRNG').reseedSharedRandom(20261001);
    const { InputRouter } = h.load('core/InputRouter');
    const { StrokeType } = h.load('core/GameConstants');
    const { STROKE_QUALITY_TUNING } = h.load('core/InputTuning');
    const scene = h.create('cartonSwimmer6', 1, 1);
    const body = scene.body, motor = body.motor;
    const isAI = mode === 'ai';
    if (!isAI) { scene.ai.stopSwimming(); body.isAI = false; }
    const router = new InputRouter(body.node, {
        onStrokeHeld: (side, held, pre) => { body.handleStrokeHeld(side, held, pre); return true; },
        onStroke: side => body.handleStroke(side),
        onKickStroke: side => body.handleKickStroke(side),
    });
    let time = 0, nextPress = 0, pressedAt = 0, pressed = null, side = StrokeType.LEFT;
    const originalNow = Date.now;
    const frames = [];
    Date.now = () => 1000 + time * 1000;
    try {
        for (let i = 0; i < Math.round(seconds * fps); i++) {
            const dt = 1 / fps;
            if (!isAI) {
                if (pressed === null && time >= nextPress) {
                    pressed = side; pressedAt = time; router.handleScreenStroke(side);
                }
                router.tick();
                if (pressed !== null && time - pressedAt >= STROKE_QUALITY_TUNING.minHoldSeconds
                    && ((motor.isActiveStrokeHeld(pressed) && motor.activeStrokeReleaseProgress(pressed) >= releaseProgress)
                        || time-pressedAt > 0.8)) {
                    router.handleScreenStrokeEnd(pressed); pressed = null;
                    side = side === StrokeType.LEFT ? StrokeType.RIGHT : StrokeType.LEFT;
                    nextPress = time + gap;
                }
                body.stepSimulation(dt); body.consumeRhythmResults();
            } else scene.step(dt);
            frames.push({ time, dt, left: motor.leftArmCycle, right: motor.rightArmCycle,
                leftKick: motor.leftKickCycle, rightKick: motor.rightKickCycle, bodyPhase: motor.bodyPhase,
                speed: motor.currentSpeed, heading: motor.heading, pitch: motor.collisionPitchRadians,
                roll: motor.axialRollRadians, rollSpeed: motor.axialRollAngularVelocity,
                pitchSpeed: motor.collisionPitchAngularVelocity,
                rotation: [body.node.rotation.x,body.node.rotation.y,body.node.rotation.z,body.node.rotation.w],
                surface: !body.isUnderwater && !body.isFlipTurning && !body.isDolphinJumpActive,
                distance: motor.distance, heartRate: motor.heartRate });
            time += dt;
        }
    } finally { Date.now = originalNow; }
    return frames;
}
module.exports = { replayBreathingInput };
