import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import Rules from '../assets/scripts/core/StimulantBrawlRules.ts';
import PlayerCondition from '../assets/scripts/condition/PlayerConditionModel.ts';
import CareerRules from '../assets/scripts/progression/CareerRules.ts';
import PlayerProfile from '../assets/scripts/backend/PlayerProfile.ts';

const {
    buildStimulantSchedule,
    STIMULANT_PUBLIC_WAVE_DISTANCES,
    stimulantPickupDistanceSquared,
    stimulantTurnDragScale,
    stimulantTurnImpulseScale,
} = Rules;
const { PlayerConditionModel } = PlayerCondition;
const { executeCareer } = CareerRules;
const { createDefaultProfile, normalizeProfile } = PlayerProfile;

test('兴奋剂显式预制体包含模型渲染器，加载器保留多路径、单方块兜底和远距光柱', () => {
    const prefab = JSON.parse(readFileSync(
        new URL('../assets/race/items/StimulantPotion.prefab', import.meta.url),
        'utf8',
    ));
    const renderer = prefab.find(entry => entry.__type__ === 'cc.MeshRenderer');
    assert.ok(renderer);
    assert.equal(renderer._mesh.__uuid__, '2a623d89-1c89-4b0b-96ce-0c1f4a895036@f5ff4');
    assert.equal(
        renderer._materials[0].__uuid__,
        '2a623d89-1c89-4b0b-96ce-0c1f4a895036@b9684',
    );

    const controller = readFileSync(
        new URL('../assets/scripts/core/StimulantBrawlController.ts', import.meta.url),
        'utf8',
    );
    assert.match(controller, /stimulantBottlePrefabCandidates/);
    assert.match(controller, /hasMeshRenderer/);
    assert.match(controller, /buildStimulantBeaconGeometry/);
    assert.match(controller, /BEACON_VISIBLE_AHEAD_DISTANCE = 82/);
    assert.match(controller, /depthWrite: false/);
    assert.doesNotMatch(controller, /StimulantBottleGlowMaterial|applyMaterialRecursively/);
    assert.doesNotMatch(controller, /StimulantMarkerCube|MARKER_SCALE|MARKER_HEIGHT/);
});

test('兴奋剂赛程由种子稳定生成七波公共争抢且不再包含开局保证波', () => {
    const a = buildStimulantSchedule(123456);
    const b = buildStimulantSchedule(123456);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, buildStimulantSchedule(654321));
    assert.equal(a.length, 21);
    assert.equal(a.some(item => item.wave === 0), false);

    let previousLaneKey = '';
    for (let wave = 1; wave <= STIMULANT_PUBLIC_WAVE_DISTANCES.length; wave++) {
        const items = a.filter(item => item.wave === wave);
        assert.equal(items.length, 3);
        assert.equal(new Set(items.map(item => item.laneIndex)).size, 3);
        assert.ok(items.every(item => Math.abs(item.lateralOffset) >= 0.36 && Math.abs(item.lateralOffset) <= 0.72));
        assert.ok(items.every(item => item.distance === STIMULANT_PUBLIC_WAVE_DISTANCES[wave - 1]));
        const laneKey = items.map(item => item.laneIndex).sort((x, y) => x - y).join(',');
        assert.notEqual(laneKey, previousLaneKey);
        previousLaneKey = laneKey;
    }
});

test('公共争抢在一批种子中覆盖全部泳道', () => {
    const laneHits = new Array(8).fill(0);
    for (let seed = 1; seed <= 32; seed++) {
        for (const item of buildStimulantSchedule(seed)) {
            laneHits[item.laneIndex]++;
        }
    }
    assert.ok(laneHits.every(hits => hits > 0));
});

test('公共兴奋剂使用身体胶囊并扫掠短距离经过路径', () => {
    const bodyHit = stimulantPickupDistanceSquared(
        0, 0,
        1.7, 0,
        Number.NaN, Number.NaN,
        1, 0,
        0.8,
        3,
    );
    assert.ok(bodyHit <= 1.2 ** 2, '根节点在范围外时，身体前端接近仍应拾取');

    const sweepHit = stimulantPickupDistanceSquared(
        0, 0,
        1.5, 1.1,
        -1.5, 1.1,
        1, 0,
        0.2,
        3.1,
    );
    assert.ok(sweepHit <= 1.2 ** 2, '短路径从道具旁经过时不应漏捡');

    const correctionMiss = stimulantPickupDistanceSquared(
        0, 0,
        4, 0,
        -4, 0,
        1, 0,
        0.2,
        3,
    );
    assert.ok(correctionMiss > 1.2 ** 2, '过长网络校正不能沿整段路径补捡');
});

test('心率只在 130 以上逐步放大转向并降低阻尼', () => {
    assert.equal(stimulantTurnImpulseScale(130), 1);
    assert.equal(stimulantTurnDragScale(130), 1);
    assert.ok(Math.abs(stimulantTurnImpulseScale(180) - 1.65) < 1e-9);
    assert.ok(Math.abs(stimulantTurnDragScale(180) - 0.55) < 1e-9);
});

test('药瓶按自身上限恢复一半且不溢出', () => {
    const condition = new PlayerConditionModel();
    condition.setProgressionOverrides({ energyTotal: 120 });
    condition.reset();
    condition.consumeEnergy(100);
    assert.equal(condition.energy, 20);
    assert.equal(condition.restoreEnergyRatio(0.5), 60);
    assert.equal(condition.energy, 80);
    assert.equal(condition.restoreEnergyRatio(0.5), 40);
    assert.equal(condition.energy, 120);
});

test('兴奋剂规则只允许快速比赛 200 米并可从存档恢复', () => {
    const profile = createDefaultProfile();
    const characterId = Object.keys(profile.characters)[0];
    const ok = executeCareer(profile, { type: 'begin', source: 'quick', characterId, tier: 0, distance: 200, rule: 'stimulant', seed: 7 });
    assert.equal(ok.ok, true);
    assert.equal(normalizeProfile(profile).career.quick.rule, 'stimulant');
    assert.equal(executeCareer(createDefaultProfile(), { type: 'begin', source: 'quick', characterId, tier: 0, distance: 400, rule: 'stimulant', seed: 7 }).ok, false);
    assert.equal(executeCareer(createDefaultProfile(), { type: 'begin', source: 'league', characterId, tier: 0, distance: 200, rule: 'stimulant', seed: 7 }).ok, false);
});
