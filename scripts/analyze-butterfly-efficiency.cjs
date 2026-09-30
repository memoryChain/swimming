// 比较当前配置下的连续划水；无碰撞、固定心率与体力，不代表整场比赛成绩。
const assert = require('node:assert/strict');
const { load } = require('./analyze-stroke-efficiency.cjs');
const { SwimmerMotor } = load('swimmer/SwimmerMotor');
const { InputRouter } = load('core/InputRouter');
const { StrokeType } = load('core/GameConstants');
const { STROKE_QUALITY_TUNING } = load('core/InputTuning');

function measure(butterfly, fps = 240) {
    const motor = new SwimmerMotor();
    motor.enableButterflyTest(butterfly); motor.startRace(0, .8);
    motor.setSteeringEnabled(false); motor.applyAuthoritativeHeartRate(80, true);
    let time = 0, pressed = false, nextPress = 0, side = StrokeType.LEFT;
    let distance = 0, count = 0, energy = 0, perfect = 0, rejected = 0;
    const dt = 1 / fps, warmup = 15, duration = 30;
    const judge = result => {
        if (!result || time < warmup) return;
        count++; energy += result.energyCost;
        if (result.strokeQuality === 1) perfect++;
    };
    const router = new InputRouter({}, {
        butterfly: butterfly ? {
            begin: () => { const ok = motor.beginButterfly(); if (!ok) rejected++; return ok; },
            release: () => motor.releaseButterfly(), cancel: () => motor.cancelButterfly(),
        } : undefined,
        onStrokeHeld: (s, held, pre) => { judge(motor.setStrokeHeld(s, held, pre)); return true; },
        onStroke: s => { if (!motor.recordStroke(s)) rejected++; },
        onKickStroke: () => {},
    });
    const oldNow = Date.now;
    Date.now = () => 1000 + time * 1000;
    try {
        for (let frame = 0; frame < duration * fps; frame++) {
            time = frame / fps;
            assert.ok(motor.isRacing, '测量期间不能已经完赛');
            if (!pressed && time >= nextPress && (!butterfly || !motor.butterfly.active)) {
                router.handleScreenStroke(side);
                if (butterfly) router.handleScreenStroke(StrokeType.RIGHT);
                pressed = true;
            }
            router.tick();
            const release = butterfly ? motor.butterfly.held && motor.butterfly.progress >= .39
                : motor.isActiveStrokeHeld(side) && motor.activeStrokeReleaseProgress(side)
                    >= (STROKE_QUALITY_TUNING.perfectStart + STROKE_QUALITY_TUNING.perfectEnd) / 2;
            if (pressed && release) {
                router.handleScreenStrokeEnd(side);
                if (butterfly) router.handleScreenStrokeEnd(StrokeType.RIGHT);
                else side = side === StrokeType.LEFT ? StrokeType.RIGHT : StrokeType.LEFT;
                pressed = false; nextPress = time + .02;
            }
            const before = motor.distance;
            motor.update(dt, { isAI: false });
            motor.consumeStrokeQualityResults().forEach(judge);
            if (time >= warmup) distance += motor.distance - before;
        }
    } finally { Date.now = oldNow; }
    assert.equal(rejected, 0); assert.equal(perfect, count);
    return { stroke: butterfly ? '蝶泳' : '自由泳', fps, meanSpeed: distance / (duration - warmup),
        settlementsPerSecond: count / (duration - warmup), grossEnergyPerSecond: energy / (duration - warmup) };
}

if (require.main === module) {
    console.log('保存调参；中性角色；心率80；不扣减体力；无额外踢腿；保持直线；连续完美；30秒中后15秒统计。');
    for (const fps of [60, 240]) for (const butterfly of [false, true]) console.log(JSON.stringify(measure(butterfly, fps)));
}
module.exports = { measure };
