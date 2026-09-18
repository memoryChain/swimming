import test from 'node:test';
import assert from 'node:assert/strict';

import Rules from '../assets/scripts/core/WhirlpoolBrawlRules.ts';
import CareerRules from '../assets/scripts/progression/CareerRules.ts';
import PlayerProfile from '../assets/scripts/backend/PlayerProfile.ts';

const {
    WHIRLPOOL_SPAWNS,
    sampleWhirlpoolInfluence,
    whirlpoolCenterZ,
    whirlpoolTargetZForAi,
} = Rules;
const { executeCareer } = CareerRules;
const { createDefaultProfile, normalizeProfile } = PlayerProfile;

function influence() {
    return {
        forwardAcceleration: 0,
        lateralAcceleration: 0,
        yawAcceleration: 0,
        rollAcceleration: 0,
        intensity: 0,
        coreIntensity: 0,
        whirlpoolId: -1,
    };
}

test('漩涡固定分布在四个泳段，水流采样可重复', () => {
    assert.deepEqual(WHIRLPOOL_SPAWNS.map(item => item.distance), [28, 72, 128, 172]);
    assert.deepEqual(WHIRLPOOL_SPAWNS.map(item => item.spin), [1, -1, 1, -1]);
    const spawn = WHIRLPOOL_SPAWNS[0];
    const z = whirlpoolCenterZ(spawn, 20);
    assert.deepEqual(
        sampleWhirlpoolInfluence(spawn.distance + 1.2, z + 1.8, 20, influence()),
        sampleWhirlpoolInfluence(spawn.distance + 1.2, z + 1.8, 20, influence()),
    );
});

test('漩涡外圈给前进收益，核心产生明显回卷惩罚', () => {
    const spawn = WHIRLPOOL_SPAWNS[0];
    const center = whirlpoolCenterZ(spawn, 20);
    const outer = sampleWhirlpoolInfluence(spawn.distance, center + 2.85, 20, influence());
    const core = sampleWhirlpoolInfluence(spawn.distance, center, 20, influence());
    assert.ok(outer.forwardAcceleration > 0);
    assert.ok(core.forwardAcceleration < 0);
    assert.ok(core.coreIntensity > 0.9);
});

test('AI 目标落在核心外且不越过泳池边界', () => {
    for (const spawn of WHIRLPOOL_SPAWNS) {
        const target = whirlpoolTargetZForAi(spawn.distance - 10, 0, 20);
        assert.notEqual(target, null);
        assert.ok(Math.abs(target) <= 9.25);
        assert.ok(Math.abs(target - whirlpoolCenterZ(spawn, 20)) > 2.5);
    }
});

test('漩涡赛只允许快速比赛二百米并可从存档恢复', () => {
    const profile = createDefaultProfile();
    const characterId = Object.keys(profile.characters)[0];
    assert.equal(executeCareer(profile, {
        type: 'begin', source: 'quick', characterId, tier: 0, distance: 200, rule: 'whirlpool', seed: 17,
    }).ok, true);
    assert.equal(normalizeProfile(profile).career.quick.rule, 'whirlpool');
    assert.equal(executeCareer(createDefaultProfile(), {
        type: 'begin', source: 'quick', characterId, tier: 0, distance: 400, rule: 'whirlpool', seed: 17,
    }).ok, false);
});
