import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import Rules from '../assets/scripts/core/StimulantBrawlRules.ts';
import PlayerCondition from '../assets/scripts/condition/PlayerConditionModel.ts';
import CareerRules from '../assets/scripts/progression/CareerRules.ts';
import PlayerProfile from '../assets/scripts/backend/PlayerProfile.ts';

const {
    buildStimulantSchedule,
    buildEntertainmentStimulantSchedule,
    STIMULANT_PUBLIC_WAVE_DISTANCES,
    stimulantIsOnCurrentCourseLeg,
    stimulantPickupDistanceSquared,
    stimulantPickupRaceDistanceEligible,
    stimulantTurnDragScale,
    stimulantTurnImpulseScale,
} = Rules;
const { PlayerConditionModel } = PlayerCondition;
const { executeCareer } = CareerRules;
const { createDefaultProfile, normalizeProfile } = PlayerProfile;

test('400 米娱乐长局生成四波苏打且不越过冲刺收尾区', () => {
    const schedule = buildEntertainmentStimulantSchedule(123456, 8, 350, 400);
    assert.equal(schedule.length, 12);
    assert.deepEqual([...new Set(schedule.map(item => item.wave))], [1, 2, 3, 4]);
    assert.ok(schedule.every(item => item.distance >= 355 && item.distance <= 390));
});

test('六合一苏打首波始终生成在激活领先位置前方，不会贴脸白送', () => {
    const shortAnchor = 84.25;
    const shortSchedule = buildEntertainmentStimulantSchedule(123456, 8, shortAnchor, 200);
    assert.equal(Math.min(...shortSchedule.map(item => item.distance)), shortAnchor + 6);

    const longAnchor = 214.5;
    const longSchedule = buildEntertainmentStimulantSchedule(123456, 8, longAnchor, 400);
    assert.equal(Math.min(...longSchedule.map(item => item.distance)), longAnchor + 5);
});

test('心跳苏打显式预制体包含模型渲染器，加载器保留多路径、单方块兜底和远距光柱', () => {
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
    assert.match(controller, /BEACON_COLUMN_BOTTOM/);
    assert.match(controller, /BEACON_HALO_INNER_RADIUS/);
    assert.doesNotMatch(controller, /positions\.push\(0, 0\.025, 0\)/);
    assert.match(controller, /depthWrite: false/);
    assert.doesNotMatch(controller, /StimulantBottleGlowMaterial|applyMaterialRecursively/);
    assert.doesNotMatch(controller, /StimulantMarkerCube|MARKER_SCALE|MARKER_HEIGHT/);
});

test('心跳苏打赛程由种子稳定生成七波公共争抢且不再包含开局保证波', () => {
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

test('公共心跳苏打使用身体胶囊并扫掠短距离经过路径', () => {
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

test('公共心跳苏打只允许拾取当前赛程趟数附近的道具', () => {
    assert.equal(
        stimulantPickupRaceDistanceEligible(35, 34.2, 33.9, 1.2, 0.8, 3),
        true,
        '身体判定范围内的当前波次应该允许拾取',
    );
    assert.equal(
        stimulantPickupRaceDistanceEligible(35, 37.4, 34.8, 1.2, 0.8, 3),
        true,
        '一次短更新跨过道具时应该允许扫掠拾取',
    );
    assert.equal(
        stimulantPickupRaceDistanceEligible(135, 35, 34.8, 1.2, 0.8, 3),
        false,
        '物理位置重合也不能提前拾取后续趟数的隐藏道具',
    );
    assert.equal(
        stimulantPickupRaceDistanceEligible(35, 135, 134.8, 1.2, 0.8, 3),
        false,
        '经过同一物理位置时不能补拾已经错过的前序趟数道具',
    );
    assert.equal(
        stimulantPickupRaceDistanceEligible(35, 40, 30, 1.2, 0.8, 3),
        false,
        '过长的网络校正不能沿整段赛程距离补捡',
    );
});

test('折返泳池只显示当前单程的苏打瓶和光柱', () => {
    assert.equal(stimulantIsOnCurrentCourseLeg(35, 40, 50), true);
    assert.equal(
        stimulantIsOnCurrentCourseLeg(60, 40, 50),
        false,
        '折返后的 60 米道具不能在第一趟提前显示',
    );
    assert.equal(
        stimulantIsOnCurrentCourseLeg(60, 50, 50),
        true,
        '完成 50 米转身后应立即显示第二趟道具',
    );
    assert.equal(stimulantIsOnCurrentCourseLeg(85, 99.9, 50), true);
    assert.equal(stimulantIsOnCurrentCourseLeg(110, 99.9, 50), false);
    assert.equal(stimulantIsOnCurrentCourseLeg(110, 100, 50), true);
});

test('心率只在 130 以上逐步放大转向并降低阻尼', () => {
    assert.equal(stimulantTurnImpulseScale(130), 1);
    assert.equal(stimulantTurnDragScale(130), 1);
    assert.ok(Math.abs(stimulantTurnImpulseScale(180) - 1.65) < 1e-9);
    assert.ok(Math.abs(stimulantTurnDragScale(180) - 0.55) < 1e-9);
});

test('苏打瓶按自身上限恢复一半且不溢出', () => {
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

test('心跳苏打规则只允许快速比赛 200 米并可从存档恢复', () => {
    const profile = createDefaultProfile();
    const characterId = Object.keys(profile.characters)[0];
    const ok = executeCareer(profile, { type: 'begin', source: 'quick', characterId, tier: 0, distance: 200, rule: 'stimulant', seed: 7 });
    assert.equal(ok.ok, true);
    assert.equal(normalizeProfile(profile).career.quick.rule, 'stimulant');
    assert.equal(executeCareer(createDefaultProfile(), { type: 'begin', source: 'quick', characterId, tier: 0, distance: 400, rule: 'stimulant', seed: 7 }).ok, false);
    assert.equal(executeCareer(createDefaultProfile(), { type: 'begin', source: 'league', characterId, tier: 0, distance: 200, rule: 'stimulant', seed: 7 }).ok, false);
});
