// PERFECT 区间专项核查：加载真实运动模块和项目保存配置，不修改运行时参数文件。
// 执行：npx.cmd --yes --package typescript@5.4.5 -c "node scripts/analyze-perfect-window.cjs"
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load, STROKE_QUALITY_TUNING: tuning } = require('./analyze-stroke-efficiency.cjs');
const { SwimmerMotor } = load('swimmer/SwimmerMotor');
const { StrokeType, Rating } = load('core/GameConstants');
const { setRaceDifficulty } = load('core/GameBalance');
const { MOTION_TUNING } = load('core/InputTuning');
const { conditionQualityScale, energyDepletionCadenceScale } = load('core/ConditionBalance');
const cycle = Math.PI * 2;
let checks = 0;
function check(value) { assert.ok(value); checks++; }
function motorAt(speed = 2) {
    const motor = new SwimmerMotor();
    motor.startRace(0, speed);
    motor._physics.step = state => state;
    motor.update(0.3, { isAI: false });
    motor.setStrokeHeld(StrokeType.LEFT, true, tuning.minHoldSeconds);
    motor.recordStroke(StrokeType.LEFT);
    return motor;
}
const times = [];
for (const mode of ['beginner', 'competitive', 'championship']) {
    setRaceDifficulty(mode);
    for (const speed of [0.5, 1, 2, 3, 4]) {
        const motor = motorAt(speed);
        const rate = motor.currentActionCycleSpeed() / cycle * MOTION_TUNING.heldMotionSpeedScale;
        check(motor._effectiveReleaseRanges.perfect.start === 0.25);
        check(motor._effectiveReleaseRanges.perfect.end === 0.5);
        times.push({ mode, speed, cyclesPerSecond: rate,
            fromPressStartMs: (tuning.minHoldSeconds + 0.25 / rate) * 1000,
            fromPressEndMs: (tuning.minHoldSeconds + 0.5 / rate) * 1000,
            windowMs: 0.25 / rate * 1000 });
    }
}
setRaceDifficulty('beginner');
function quality(progress) {
    const motor = motorAt();
    motor.update(0.15, { isAI: false });
    const action = motor._leftActions[0];
    action.progress = cycle * progress;
    return motor.setStrokeHeld(StrokeType.LEFT, false).strokeQuality;
}
const judgments = [];
for (const progress of [0.249, 0.25, 0.375, 0.5, 0.501, 0.52, 0.529, 0.531]) {
    const normal = quality(progress);
    judgments.push({ progress, normal });
    check((normal === 1) === (progress >= 0.25 && progress <= 0.5));
}
for (const hr of [0, 70, 120, 160, 200]) check(conditionQualityScale(hr) === 1);
for (const energy of [0, 0.01, 0.5, 1]) check(energyDepletionCadenceScale(energy) === 1);
const motor = motorAt();
const ranges = JSON.stringify(motor._effectiveReleaseRanges);
motor.setConditionQualityScale(0.1);
check(JSON.stringify(motor._effectiveReleaseRanges) === ranges);
const guide = motor.buildGuideFromAction(motor._leftActions[0]);
const perfectBand = guide.intervals.find(interval => interval.rating === Rating.PERFECT);
check(perfectBand.startRatio === 0.25 && perfectBand.endRatio === 0.5);
check(guide.displayEndRatio === 0.6);
// 同一划内变速仍会即时改变逻辑进度推进率。
for (const speed of [1, 3]) {
    motor._currentSpeed = speed;
    const action = motor._leftActions[0];
    const before = action.progress;
    const rate = motor.currentActionCycleSpeed();
    motor.update(0.01, { isAI: false });
    check(Math.abs(action.progress - before - rate * 0.01) < 1e-9);
}
const recoveryJudgments = [];
for (const target of [0.3, 0.4]) {
    const next = motorAt(2);
    next.update(0.2, { isAI: false });
    next.setStrokeHeld(StrokeType.LEFT, false);
    const previous = next._leftActions[0];
    next.update(0.2, { isAI: false });
    next.setStrokeHeld(StrokeType.LEFT, true, tuning.minHoldSeconds);
    check(!next.recordStroke(StrokeType.LEFT));
    for (let i = 0; next._leftActions[0] === previous && i < 100; i++) {
        next.update(0.001, { isAI: false });
    }
    check(next._leftActions[0] !== previous);
    const action = next._leftActions[0];
    const dt = (target * cycle - action.progress) / next.currentActionCycleSpeed();
    next.update(dt, { isAI: false });
    action.progress = target * cycle;
    check(next.isActiveStrokeInPerfectZone(StrokeType.LEFT));
    const settled = next.setStrokeHeld(StrokeType.LEFT, false);
    recoveryJudgments.push({ target, holdSeconds: settled.holdSeconds,
        quality: settled.strokeQuality, downgradedToKick: !!settled.downgradedToKick });
    check(!settled.downgradedToKick && settled.strokeQuality === 1);
}
const result = { checks, times, judgments, recoveryJudgments, guide: {
    perfectStart: perfectBand.startRatio, perfectEnd: perfectBand.endRatio,
    displayEndRatio: guide.displayEndRatio,
}, note: '读取项目保存配置；三个入口共用轮速，已移除隐藏容错，续划保留长按识别时间。时间表未计逐帧延迟和回收等待。' };
fs.mkdirSync('temp', { recursive: true });
fs.writeFileSync('temp/perfect-window-audit.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
