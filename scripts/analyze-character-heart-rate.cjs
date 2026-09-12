// 真实模型回放：固定 2.5 次/秒起划；恢复测试保留停划前两秒的负荷历史。
// 执行：npx --yes --package typescript@5.4.5 -c "node scripts/analyze-character-heart-rate.cjs"
const { load } = require('./analyze-stroke-efficiency.cjs');
const { StrokeHeartRateModel } = load('condition/StrokeHeartRateModel');
const { HEART_RATE_TRAITS, HEART_RATE_TUNING } = load('core/ConditionBalance');

function measureTrait(trait) {
    const rise = new StrokeHeartRateModel();
    rise.setTrait(trait);
    let to140 = null, to160 = null;
    for (let i = 0; i < 40000; i++) {
        if (i >= 200 && (i - 200) % 400 === 0) rise.recordStart();
        rise.tick(.001);
        if (to140 === null && rise.heartRate >= 140) to140 = (i + 1) / 1000;
        if (to160 === null && rise.heartRate >= 160) to160 = (i + 1) / 1000;
    }
    const recovery = new StrokeHeartRateModel();
    recovery.setTrait(trait);
    for (let i = 0; i < 2000; i++) {
        if (i >= 200 && (i - 200) % 400 === 0) recovery.recordStart();
        recovery.tick(.001);
    }
    recovery.applyAuthoritative(180);
    let to100 = null;
    for (let i = 0; i < 20000; i++) {
        recovery.tick(.001);
        if (recovery.heartRate <= 100) { to100 = (i + 1) / 1000; break; }
    }
    const profile = HEART_RATE_TRAITS[trait];
    return { trait, label: profile.label, riseSeconds: HEART_RATE_TUNING[profile.riseKey],
        recoverySeconds: HEART_RATE_TUNING[profile.recoveryKey], to140, to160, to100 };
}

if (require.main === module) console.table(Object.keys(HEART_RATE_TRAITS).map(measureTrait));
module.exports = { measureTrait };
