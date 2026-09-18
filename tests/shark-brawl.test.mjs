import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import SharkTuning from '../assets/scripts/entity/SharkTuning.ts';
import CareerRules from '../assets/scripts/progression/CareerRules.ts';
import PlayerProfile from '../assets/scripts/backend/PlayerProfile.ts';

const { SHARK_TUNING, SharkState } = SharkTuning;
const { executeCareer } = CareerRules;
const { createDefaultProfile, normalizeProfile } = PlayerProfile;

test('鲨鱼大乱斗固定进行三轮追猎并在第三轮后退场', () => {
    assert.deepEqual(SHARK_TUNING.hungerSchedule, [15, 35, 55]);
    assert.ok(SHARK_TUNING.warningSeconds > 0);
    assert.ok(SHARK_TUNING.huntOpeningGraceSeconds > 0);
    assert.ok(SHARK_TUNING.huntSeconds > 0);
    assert.equal(SharkState.WANDER, 4);
    assert.equal(SharkState.SATIATED, 5);
});

test('鲨鱼模式使用固定场景控制器而非角色技能召唤', () => {
    const controller = readFileSync(
        new URL('../assets/scripts/entity/SharkController.ts', import.meta.url),
        'utf8',
    );
    assert.match(controller, /hungerSchedule/);
    assert.match(controller, /beginHuntBeat/);
    assert.match(controller, /resolveObstacleCollisions/);
    assert.match(controller, /onKnockDown/);
    assert.match(controller, /knockedLane/);
    assert.doesNotMatch(controller, /eliminatedMask|applyElimination/);
    assert.doesNotMatch(controller, /trySummon|ownerLane/);
    assert.equal(existsSync(new URL('../assets/race/models/SharkModel.glb', import.meta.url)), true);
});

test('鲨鱼规则只允许快速比赛二百米并可从存档恢复', () => {
    const profile = createDefaultProfile();
    const characterId = Object.keys(profile.characters)[0];
    const ok = executeCareer(profile, {
        type: 'begin', source: 'quick', characterId, tier: 0, distance: 200, rule: 'shark', seed: 17,
    });
    assert.equal(ok.ok, true);
    assert.equal(normalizeProfile(profile).career.quick.rule, 'shark');
    assert.equal(executeCareer(createDefaultProfile(), {
        type: 'begin', source: 'quick', characterId, tier: 0, distance: 400, rule: 'shark', seed: 17,
    }).ok, false);
    assert.equal(executeCareer(createDefaultProfile(), {
        type: 'begin', source: 'league', characterId, tier: 0, distance: 200, rule: 'shark', seed: 17,
    }).ok, false);
});
