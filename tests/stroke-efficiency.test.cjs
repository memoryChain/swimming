const test = require('node:test');
const assert = require('node:assert/strict');
const analysis = require('../scripts/analyze-stroke-efficiency.cjs');

test('整个完美区含两端优于提前 GOOD，前中后收益形成平台', () => {
    for (const kicks of [true, false]) {
        // 在边界内侧百万分之一级取样，避免把越界的 GOOD 混进 PERFECT。
        const points = Array.from({ length: 26 }, (_, i) => 0.25001 + 0.24998 * i / 25);
        const perfect = points.map(p => analysis.replay(p, kicks, true));
        const good = [0.15, 0.18, 0.21, 0.23, 0.24, 0.245, 0.249, 0.24999]
            .map(p => analysis.replay(p, kicks, true));
        for (const p of perfect) {
            assert.ok(p.perfect > 0);
            assert.equal(p.good + p.bad + p.rejected, 0, '每个样本的全部划水都必须实际命中完美区');
        }
        assert.ok(good.every(p => p.perfect === 0), '提前 GOOD 不得跨帧误判成 PERFECT');
        const worst = Math.min(...perfect.map(p => p.meanSpeed));
        const best = Math.max(...perfect.map(p => p.meanSpeed));
        const bestGood = Math.max(...good.map(p => p.meanSpeed));
        assert.ok(worst > bestGood * 1.03, `最差 PERFECT ${worst} 必须胜过最佳提前 GOOD ${bestGood}`);
        assert.ok(best / worst < 1.02, `完美区内速度波动不超过 2%：${worst}～${best}`);
        const varied = analysis.replay(.375, kicks, true, { targets: points });
        assert.equal(varied.good + varied.bad + varied.rejected, 0);
        assert.ok(varied.meanSpeed > bestGood * 1.03, '松手位置在整个完美区内变化时仍有优势');
    }
});

test('30/60/120 帧的前中后段均实际命中 PERFECT，正常帧输入下也胜过提前 GOOD', () => {
    for (const fps of [30, 60, 120]) {
        const perfect = [.26, .375, .42].map(p => analysis.replay(p, true, true, { fps, exactRelease: false }));
        const good = analysis.replay(.18, true, true, { fps, exactRelease: false });
        assert.equal(good.perfect, 0);
        for (const p of perfect) {
            assert.equal(p.good + p.bad + p.rejected, 0);
            assert.ok(p.meanSpeed > good.meanSpeed * 1.03);
        }
    }
});

test('标准周期补偿的单划单位时间预算在整个完美区一致，空等不能额外领奖', () => {
    const { SwimmerMotor } = analysis.load('swimmer/SwimmerMotor');
    const motor = new SwimmerMotor(); motor.startRace(0, 2.5);
    const heldCycle = Math.PI * 2 / (motor.currentActionCycleSpeed()
        * analysis.load('core/InputTuning').MOTION_TUNING.heldMotionSpeedScale);
    const ratios = [.25, .3, .375, .45, .5].map(p => {
        const single = analysis.singleStroke(p);
        assert.equal(single.quality, 1, '精确边界也必须判为 PERFECT');
        return single.impulse / (.2 + heldCycle * p);
    });
    assert.ok(Math.max(...ratios) - Math.min(...ratios) < 1e-9);
    assert.equal(motor.strokeActionTimeScale(.4, .375), motor.strokeActionTimeScale(100, .375));
    assert.equal(motor.strokeActionTimeScale(.4, .5), motor.strokeActionTimeScale(100, .58));
});


test('0.8倍率低心率实际完美窗至少156ms，白点/手臂/松手判定共用放慢后的进度', () => {
    const { SwimmerMotor } = analysis.load('swimmer/SwimmerMotor');
    const { StrokeType, Rating } = analysis.load('core/GameConstants');
    const { MOTION_TUNING } = analysis.load('core/InputTuning');
    const { perfectWidthScale } = analysis.load('core/ConditionBalance');
    for (const speed of [1, 3]) for (const heartRate of [80, 120, 180]) for (const side of [StrokeType.LEFT, StrokeType.RIGHT]) {
        const motor = new SwimmerMotor(); motor.startRace(0, speed);
        motor._physics.step = state => state;
        motor.update(.3, { isAI: false }); motor.applyAuthoritativeHeartRate(heartRate, true);
        motor.setStrokeHeld(side, true, .2); motor.recordStroke(side);
        const action = (side === StrokeType.LEFT ? motor._leftActions : motor._rightActions)[0];
        const rate = motor.currentActionCycleSpeed() * MOTION_TUNING.heldMotionSpeedScale;
        const ranges = action.ranges.perfect;
        const window = (ranges.end - ranges.start) * Math.PI * 2 / rate;
        if (heartRate === 80) assert.ok(window >= .156 && window <= .174);
        assert.ok(Math.abs(window - .25 * perfectWidthScale(heartRate) * Math.PI * 2 / rate) < 1e-9);
        motor.update(.375 * Math.PI * 2 / rate, { isAI: false });
        const guide = motor.buildGuideFromAction(action);
        assert.ok(Math.abs(guide.currentRatio - .375) < 1e-9);
        const band = guide.intervals.find(i => i.rating === Rating.PERFECT);
        assert.equal(band.startRatio, ranges.start); assert.equal(band.endRatio, ranges.end);
        assert.equal(motor.isActiveStrokeInPerfectZone(side), true);
        assert.equal(motor.setStrokeHeld(side, false).strokeQuality, 1);
    }
});

test('放慢输入后按标准周期补偿，连续PERFECT基准游速与原来相差不到3%', () => {
    const { MOTION_TUNING } = analysis.load('core/InputTuning');
    const saved = MOTION_TUNING.heldMotionSpeedScale;
    try {
        for (const fps of [30, 60, 120]) {
            MOTION_TUNING.heldMotionSpeedScale = 1;
            const before = analysis.replay(.375, true, true, { fps });
            MOTION_TUNING.heldMotionSpeedScale = saved;
            const after = analysis.replay(.375, true, true, { fps });
            assert.equal(after.good + after.bad + after.rejected, 0);
            // 按住总时间包含不随动作倍率变化的200ms输入分类；只比较起划后的活动段。
            const activeRatio = (after.holdSeconds - .2) / (before.holdSeconds - .2);
            assert.ok(activeRatio > 1.23 && activeRatio < 1.27);
            assert.ok(Math.abs(after.meanSpeed / before.meanSpeed - 1) < .03);
        }
    } finally { MOTION_TUNING.heldMotionSpeedScale = saved; }
});
