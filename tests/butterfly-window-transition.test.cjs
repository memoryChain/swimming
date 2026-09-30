const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../scripts/analyze-stroke-efficiency.cjs');
const { ButterflyStroke } = load('swimmer/ButterflyStroke');
const { SwimmerMotor } = load('swimmer/SwimmerMotor');
const { BUTTERFLY_TUNING } = load('core/ButterflyTuning');
const { StrokeType, Rating } = load('core/GameConstants');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('收束在30/60/120帧及卡顿中连续下移和缩窄，先完成再进入甜区，后段不再移动', () => {
    for (const dt of [1 / 30, 1 / 60, 1 / 120, .2]) {
        const m = new SwimmerMotor(); m.startRace(); m.enableButterflyTest(true); m.beginButterfly();
        const b = m.butterfly;
        near(b.perfectStart, .25); near(b.perfectEnd, .5);
        near(b.targetPerfectStart, .31); near(b.targetPerfectEnd, .53);
        let center = .375, width = .25;
        const targetProgress = .42;
        while (b.progress < targetProgress - 1e-12) {
            b.advance(Math.min(dt, (targetProgress - b.progress) * b.duration));
            const nextCenter = (b.perfectStart + b.perfectEnd) / 2, nextWidth = b.perfectEnd - b.perfectStart;
            assert.ok(nextCenter >= center - 1e-9); assert.ok(nextWidth <= width + 1e-9);
            assert.ok(b.windowTransitionEndProgress < b.perfectStart);
            center = nextCenter; width = nextWidth;
            for (const side of [StrokeType.LEFT, StrokeType.RIGHT]) {
                const guide = m.strokeTimingGuideForSide(side);
                const zone = guide.intervals.find(i => i.rating === Rating.PERFECT);
                near(zone.startRatio, b.perfectStart); near(zone.endRatio, b.perfectEnd);
            }
            if (b.progress >= b.windowTransitionEndProgress) {
                assert.equal(b.perfectStart, b.targetPerfectStart); assert.equal(b.perfectEnd, b.targetPerfectEnd);
            }
        }
        assert.equal(b.release(), true); assert.equal(b.quality, 1);
    }
});

test('宽窄角色与所有心率档保留窗口取舍，宽区减少下移而不强行挤窄，超时前留安全距离', () => {
    for (const scale of [.65, 1, 1.4, 2, 3]) for (const hr of [80, 120, 140, 160, 180]) {
        const b = new ButterflyStroke(); b.start(1, hr, scale);
        const oldHalf = Math.min(.21, .11 * b.perfectWidthScale);
        assert.ok(b.targetPerfectEnd - b.targetPerfectStart >= oldHalf * 2 - 1e-9);
        for (const fraction of [.03, .06, .09, .12, .2]) {
            b.advance((fraction - b.progress) * b.duration);
            assert.ok(b.perfectStart >= .16 - 1e-9);
            assert.ok(b.perfectEnd <= b.timeout - .01 + 1e-9);
            assert.ok(b.perfectStart > b.windowTransitionEndProgress);
        }
        const start = b.perfectStart, end = b.perfectEnd;
        b.advance(b.duration * .2);
        near(b.perfectStart, start); near(b.perfectEnd, end);
    }
});

test('过渡前松手不获得完美，调参只影响下一拍，非法过渡参数仍在可命中区前完成', () => {
    const old = BUTTERFLY_TUNING.windowTransitionEndProgress;
    try {
        for (const value of [0, -1, 100, NaN, Infinity]) {
            BUTTERFLY_TUNING.windowTransitionEndProgress = value;
            const b = new ButterflyStroke(); b.start(.5, 180, 3);
            assert.ok(b.windowTransitionEndProgress >= .04 && b.windowTransitionEndProgress <= .15);
            b.advance(b.duration * .02); b.release(); assert.equal(b.quality, 0);
        }
        BUTTERFLY_TUNING.windowTransitionEndProgress = .12;
        const b = new ButterflyStroke(); b.start();
        BUTTERFLY_TUNING.windowTransitionEndProgress = .04;
        assert.equal(b.windowTransitionEndProgress, .12);
        b.advance(b.duration * .06);
        assert.ok(b.perfectStart < b.targetPerfectStart);
        b.reset(); b.start(); assert.equal(b.windowTransitionEndProgress, .04);
    } finally { BUTTERFLY_TUNING.windowTransitionEndProgress = old; }
});
