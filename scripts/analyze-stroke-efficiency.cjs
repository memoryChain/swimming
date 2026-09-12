// 离线数值分析：使用真实输入与运动代码，不修改运行时配置、不启动 Creator。
// 执行：npx --yes --package typescript@5.4.5 -c "node scripts/analyze-stroke-efficiency.cjs"
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('../tests/helpers/cocos-math-harness.cjs');
const h = createHarness({ 'cc/env': { NATIVE: false } });
const root = h.root;
const source = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/tuning.json'), 'utf8'));
Object.assign(h.cc, {
    JsonAsset: class {}, native: {}, Color: class {},
    sys: { localStorage: { getItem: () => null } },
    resources: { load(_p, _t, callback) { callback(null, { json: source }); } },
});
const load = name => h.load(path.join(root, 'assets/scripts', name + '.ts'));
load('core/TuningDebugControls').loadSavedTuningAsync(() => {});
const { SwimmerMotor } = load('swimmer/SwimmerMotor');
const { InputRouter } = load('core/InputRouter');
const { StrokeType } = load('core/GameConstants');
const { SWIMMER_BALANCE, setRaceDifficulty } = load('core/GameBalance');
const { MOTION_TUNING, STROKE_QUALITY_TUNING } = load('core/InputTuning');
const { AXIAL_ROLL_TUNING } = load('core/AxialRollTuning');
setRaceDifficulty('beginner');
const rollFloor = AXIAL_ROLL_TUNING.minForwardScale;
const fps = Number(process.env.STROKE_ANALYSIS_FPS || 240);
const duration = 50, warmup = 30, gap = 0.02;

// 连续交替输入：达到指定动作进度即松手，间隔 20ms 后按下另一侧。
// 包含输入分类等待、动作占用和共享推进脉冲的合并，而非简单相加单次奖励。
function replay(target, kicks, roll, options = {}) {
    const fps = options.fps || Number(process.env.STROKE_ANALYSIS_FPS || 240);
    const duration = options.duration || 50, warmup = options.warmup || 30;
    const gap = options.gap ?? 0.02;
    AXIAL_ROLL_TUNING.minForwardScale = roll ? rollFloor : 1;
    const motor = new SwimmerMotor(); motor.startRace(0, 0.8); motor.setSteeringEnabled(true);
    // 默认隔离心率比较松手收益；heartRate:null 启用实际心率积累。
    if (options.heartRate !== null) motor.applyAuthoritativeHeartRate(options.heartRate ?? 80, true);
    motor.setConditionQualityScale(options.qualityScale ?? 1);
    motor.setConditionCadenceScale(options.cadenceScale ?? 1);
    let time = 0, nextPress = 0, activeSide = null, side = StrokeType.LEFT, pressedAt = 0;
    let strokeIndex = 0, releaseTarget = target;
    let measured = 0, distance = 0, speedSum = 0, armImpulse = 0, kickImpulse = 0;
    let releases = 0, holdSum = 0, actualProgressSum = 0, qualitySum = 0, rejected = 0;
    let perfect = 0, good = 0, bad = 0, lastPress = -1, intervalSum = 0, intervalCount = 0;
    let peak = 0, trough = Infinity;
    const physicsStep = motor._physics.step.bind(motor._physics);
    motor._physics.step = (state, input) => {
        const next = physicsStep(state, input);
        if (time >= warmup) {
            // 通过同一物理步移除手臂输入的反事实，统计限速后的手臂边际推进。
            const withoutArm = physicsStep(state, { ...input, strokeAcceleration: 0 });
            armImpulse += next.currentSpeed - withoutArm.currentSpeed;
            kickImpulse += input.kickAcceleration * input.dt;
        }
        return next;
    };
    const judge = result => {
        if (!result || time < warmup) return;
        releases++; holdSum += result.holdSeconds; actualProgressSum += result.holdRatio;
        qualitySum += result.strokeQuality;
        if (result.strokeQuality === 1) perfect++; else if (result.strokeQuality > 0) good++; else bad++;
    };
    const router = new InputRouter(new h.cc.Node(), {
        onStrokeHeld: (s, held, pre) => { judge(motor.setStrokeHeld(s, held, pre)); return true; },
        onStroke: s => { if (!motor.recordStroke(s) && time >= warmup) rejected++; },
        onKickStroke: s => { if (kicks) motor.recordKickTap(s); },
    });
    const previousNow = Date.now;
    Date.now = () => 1000 + time * 1000;
    try {
        while (time < duration - 1e-9) {
            if (activeSide === null && time + 1e-9 >= nextPress) {
                activeSide = side; pressedAt = time;
                // 固定可复现的分层时机序列，覆盖完美区内不同松手位置，无结果随机源。
                if (options.targets) releaseTarget = options.targets[(strokeIndex++ * 7) % options.targets.length];
                if (lastPress >= warmup) { intervalSum += time - lastPress; intervalCount++; }
                lastPress = time;
                router.handleScreenStroke(side);
            }
            router.tick();
            // 同侧上次划水的回收动作仍有进度，不能误认作本次长按的松手目标。
            const readyToRelease = activeSide !== null
                && time - pressedAt >= STROKE_QUALITY_TUNING.minHoldSeconds
                && motor.isActiveStrokeHeld(activeSide)
                && motor.activeStrokeReleaseProgress(activeSide) >= releaseTarget;
            if (activeSide !== null && (readyToRelease || time - pressedAt > 2)) {
                router.handleScreenStrokeEnd(activeSide);
                activeSide = null; side = side === StrokeType.LEFT ? StrokeType.RIGHT : StrokeType.LEFT;
                nextPress = time + gap;
            }
            // 理想时机扫描在输入事件附近细分积分，避免 GOOD 被一整帧跨成 PERFECT。
            // fps 仍是最大积分步长；可关闭细分来另测真实逐帧输入的容错。
            let dt = Math.min(1 / fps, duration - time);
            if (options.exactRelease !== false) {
                if (activeSide === null && nextPress > time) dt = Math.min(dt, nextPress - time);
                const promoteAt = pressedAt + STROKE_QUALITY_TUNING.minHoldSeconds;
                if (activeSide !== null && promoteAt > time + 1e-9) dt = Math.min(dt, promoteAt - time);
                if (activeSide !== null && motor.isActiveStrokeHeld(activeSide)) {
                    const remaining = releaseTarget - motor.activeStrokeReleaseProgress(activeSide);
                    if (remaining > 0) dt = Math.min(dt, 0.95 * remaining * Math.PI * 2
                        / (motor.currentActionCycleSpeed() * MOTION_TUNING.heldMotionSpeedScale));
                }
            }
            if (time < warmup) dt = Math.min(dt, warmup - time);
            // Motor 的动作推进忽略小于 1e-5 弧度的步长，避免细分停在该阈值下。
            dt = Math.max(2e-5 / (motor.currentActionCycleSpeed()
                * MOTION_TUNING.heldMotionSpeedScale), dt);
            const before = motor.distance;
            motor.update(dt, { isAI: false });
            for (const result of motor.consumeStrokeQualityResults()) judge(result);
            if (time >= warmup) {
                // 无偏航、无碰撞测试中没有横向位移，赛程增量即平面实际移动距离。
                const delta = motor.distance - before;
                measured += dt; distance += delta; speedSum += motor.currentSpeed * dt;
                peak = Math.max(peak, delta / dt); trough = Math.min(trough, delta / dt);
            }
            time += dt;
        }
    } finally { Date.now = previousNow; }
    return {
        heartRate: motor.heartRate,
        x: target / STROKE_QUALITY_TUNING.armStrokeTimeoutProgress * 100,
        target, meanSpeed: distance / measured, internalSpeed: speedSum / measured,
        armPerSecond: armImpulse / measured, kickPerSecond: kickImpulse / measured,
        holdSeconds: holdSum / Math.max(1, releases), intervalSeconds: intervalSum / Math.max(1, intervalCount),
        actualProgress: actualProgressSum / Math.max(1, releases), quality: qualitySum / Math.max(1, releases),
        hz: intervalCount / Math.max(0.001, intervalSum), perfect, good, bad, rejected, peak, trough,
    };
}

// 中性角色、固定速度的单划预算，独立于连续输入中的脉冲覆盖与水阻。
function singleStroke(target) {
    AXIAL_ROLL_TUNING.minForwardScale = 1;
    const motor = new SwimmerMotor(); motor.startRace(0, 2.5);
    motor._physics.step = state => state;
    // 先度过输入分类等待，避免 pressedAt 落入负数（未按下哨兵值）。
    motor.update(STROKE_QUALITY_TUNING.minHoldSeconds, { isAI: false });
    motor.setStrokeHeld(StrokeType.LEFT, true, STROKE_QUALITY_TUNING.minHoldSeconds);
    motor.recordStroke(StrokeType.LEFT);
    const action = motor._leftActions[0];
    const heldTime = Math.PI * 2 * target / (motor.currentActionCycleSpeed() * MOTION_TUNING.heldMotionSpeedScale);
    const steps = Math.max(1, Math.ceil(heldTime * fps));
    for (let i = 0; i < steps; i++) motor.update(heldTime / steps, { isAI: false });
    // 去除积分末位误差，固定基准精确比较判定边界。
    action.progress = target * Math.PI * 2;
    const result = motor.setStrokeHeld(StrokeType.LEFT, false);
    const impulse = action.heldBaseImpulse + motor._strokeAcceleration * motor._strokeAccelerationSeconds;
    return { x: target / STROKE_QUALITY_TUNING.armStrokeTimeoutProgress * 100,
        impulse, holdSeconds: STROKE_QUALITY_TUNING.minHoldSeconds + heldTime,
        actionSeconds: result.actionSeconds, quality: result.strokeQuality,
        idealPerSecond: impulse / (STROKE_QUALITY_TUNING.minHoldSeconds + heldTime + gap) };
}

if (require.main === module) {
const targets = [...new Set([...Array.from({ length: 58 }, (_, i) => +(0.02 + i * 0.01).toFixed(3)),
    0.245, 0.249, 0.24999, 0.25001, 0.251, 0.375, 0.495, 0.499, 0.49999, 0.501])].sort((a,b) => a-b);
const scenarios = [
    { id: 'isolated', label: '含踢腿 · 排除翻滚', kicks: true, roll: false },
    { id: 'arms', label: '仅手臂 · 排除翻滚', kicks: false, roll: false },
    { id: 'current', label: '含踢腿 · 保留翻滚', kicks: true, roll: true },
];
const output = { generatedAt: new Date().toISOString(), fps, duration, warmup, gap,
    sampling: 'event-substepped',
    configUpdatedAt: source.updatedAt, values: source.values,
    perfect: [STROKE_QUALITY_TUNING.perfectStart, STROKE_QUALITY_TUNING.perfectEnd].map(p => p / STROKE_QUALITY_TUNING.armStrokeTimeoutProgress * 100),
    good: [STROKE_QUALITY_TUNING.goodStart, STROKE_QUALITY_TUNING.goodEnd].map(p => p / STROKE_QUALITY_TUNING.armStrokeTimeoutProgress * 100),
    single: targets.map(singleStroke), scenarios: [] };
for (const point of output.single) {
    if (point.x > output.perfect[0] && point.x < output.perfect[1] && point.quality !== 1) {
        throw new Error('单划基准未命中预期完美区，请检查时间原点与角色条件');
    }
}
for (const scenario of scenarios) {
    const points = targets.map(target => replay(target, scenario.kicks, scenario.roll));
    if (points.some(point => point.rejected > 0 || !Number.isFinite(point.meanSpeed))) {
        throw new Error('回放存在输入拒绝或无效均速，不能作为划水时机收益曲线');
    }
    output.scenarios.push({ ...scenario, points });
    const best = points.reduce((a,b) => a.meanSpeed > b.meanSpeed ? a : b);
    console.log(scenario.id, JSON.stringify({ best, early: points.find(p=>p.target===0.24), edge: points.find(p=>p.target===0.25), center: points.find(p=>p.target===0.375), late: points.find(p=>p.target===0.495) }));
}
const outputPath = path.resolve(process.argv[2] || path.join(root, 'temp/stroke-efficiency.json'));
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(output, (_key, value) => typeof value === 'number' ? +value.toFixed(6) : value, 2));
console.log(outputPath);
}

module.exports = { replay, singleStroke, load, SWIMMER_BALANCE, STROKE_QUALITY_TUNING };
