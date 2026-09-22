import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import Rules from '../assets/scripts/core/StimulantBrawlRules.ts';
import PlayerCondition from '../assets/scripts/condition/PlayerConditionModel.ts';
import CareerRules from '../assets/scripts/progression/CareerRules.ts';
import PlayerProfile from '../assets/scripts/backend/PlayerProfile.ts';
import WaterFloatMotion from '../assets/scripts/core/WaterFloatMotion.ts';
import StrokeHeartRate from '../assets/scripts/condition/StrokeHeartRateModel.ts';

const {
    buildStimulantSchedule,
    buildEntertainmentStimulantSchedule,
    STIMULANT_BRAWL_TUNING,
    STIMULANT_ENTERTAINMENT_WALL_CLEARANCE,
    STIMULANT_PUBLIC_WAVE_DISTANCES,
    stimulantIsOnCurrentCourseLeg,
    stimulantPickupDistanceSquared,
    stimulantTurnDragScale,
    stimulantTurnImpulseScale,
} = Rules;
const { PlayerConditionModel } = PlayerCondition;
const { executeCareer } = CareerRules;
const { createDefaultProfile, normalizeProfile } = PlayerProfile;
const { sampleWaterFloatOffset, WATER_FLOAT_PROFILES } = WaterFloatMotion;
const { StrokeHeartRateModel } = StrokeHeartRate;

test('水面漂浮物共用双波形规则并按物体质量分档', () => {
    const pickup = WATER_FLOAT_PROFILES.pickup;
    const samples = Array.from({ length: 120 }, (_, index) => (
        sampleWaterFloatOffset(index / 20, 0.83, pickup)
    ));
    assert.ok(Math.max(...samples) > 0.07, '心跳苏打应有清晰可见的上浮阶段');
    assert.ok(Math.min(...samples) < -0.07, '心跳苏打应有清晰可见的下沉阶段');
    assert.ok(samples.every(value => Math.abs(value) <= pickup.amplitude * 1.22 + 1e-9));

    const minefield = readFileSync(
        new URL('../assets/scripts/core/MinefieldBrawlPresentation.ts', import.meta.url),
        'utf8',
    );
    const litter = readFileSync(
        new URL('../assets/scripts/core/LitterBrawlPresentation.ts', import.meta.url),
        'utf8',
    );
    assert.match(minefield, /WATER_FLOAT_PROFILES\.heavyHazard/);
    assert.match(litter, /WATER_FLOAT_PROFILES\.rigidDebris/);
    assert.match(litter, /WATER_FLOAT_PROFILES\.softDebris/);
});

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

test('六合一苏打动态投放避开折返墙并保持波次间距', () => {
    for (const [raceDistance, lastAnchor] of [[200, 175], [400, 365]]) {
        for (let anchor = 0; anchor <= lastAnchor; anchor += 0.25) {
            const schedule = buildEntertainmentStimulantSchedule(
                123456,
                8,
                anchor,
                raceDistance,
                50,
            );
            const distances = [...new Set(schedule.map(item => item.distance))];
            assert.ok(distances[0] >= anchor + 4 - 1e-9, '首波必须保持至少四米前向安全距离');
            for (let index = 1; index < distances.length; index++) {
                assert.ok(distances[index] - distances[index - 1] >= 4 - 1e-9, '相邻波次不能因避墙而堆叠');
            }
            for (const distance of distances) {
                for (let wall = 50; wall < raceDistance; wall += 50) {
                    assert.ok(
                        Math.abs(distance - wall) >= STIMULANT_ENTERTAINMENT_WALL_CLEARANCE - 1e-9,
                        `投放点 ${distance} 距折返墙 ${wall} 过近`,
                    );
                }
            }
        }
    }
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
    assert.match(controller, /ITEM_MODEL_SCALE = 0\.84/);
    assert.match(controller, /ITEM_BASE_Y_OFFSET = 0\.4/);
    assert.match(controller, /ITEM_MODEL_HALF_HEIGHT \* ITEM_MODEL_SCALE/);
    assert.match(controller, /WATER_FLOAT_PROFILES\.pickup/);
    assert.match(controller, /sampleWaterFloatOffset/);
    assert.match(controller, /ITEM_BASE_LEAN_DEGREES = 8/);
    assert.match(controller, /setRotationFromEuler\(pitch, yaw, roll\)/);
    assert.match(controller, /THROW_TRIGGER_AHEAD_DISTANCE = 18/);
    assert.match(controller, /THROW_FORCE_LANDED_AHEAD_DISTANCE = 6/);
    assert.match(controller, /THROW_SECONDS = 1\.25/);
    assert.match(controller, /owner: ENTERTAINMENT_SPLASH_OWNER\.STIMULANT/);
    assert.match(controller, /profile: ENTERTAINMENT_SPLASH_PROFILE\.LIGHT_ENTRY/);
    assert.match(controller, /LANDING_SPLASH_SECONDS = 0\.42/);
    assert.match(controller, /verticalScale: 0\.74/);
    assert.doesNotMatch(controller, /landingSplashes|buildWaterExplosionGeometry|Graphics|ParticleSystem/);
    assert.match(controller, /Math\.sin\(t \* Math\.PI\) \* THROW_ARC_HEIGHT/);
    assert.match(controller, /this\.course\.poolWidth \* 0\.5 \+ THROW_STAND_OFFSET/);
    assert.match(controller, /BEACON_REVEAL_START = 0\.72/);
    assert.doesNotMatch(controller, /positions\.push\(0, 0\.025, 0\)/);
    assert.doesNotMatch(controller, /this\.presentationTime \* 82/);
    assert.match(controller, /depthWrite: false/);
    assert.match(controller, /if \(item\.collected \|\| !item\.visualLanded\) continue/);
    assert.match(controller, /const energyRatioBefore = racer\.condition\.energyRatio/);
    assert.match(controller, /const heartRateBefore = racer\.swimmer\.heartRate/);
    assert.match(controller, /energyRatioAfter: racer\.condition\.energyRatio/);
    assert.match(controller, /infiniteStamina: racer\.swimmer\.motor\.ability\.infiniteStamina/);
    assert.match(controller, /heartRateBefore,/);
    assert.doesNotMatch(controller, /StimulantBottleGlowMaterial|applyMaterialRecursively/);
    assert.doesNotMatch(controller, /StimulantMarkerCube|MARKER_SCALE|MARKER_HEIGHT/);
});

test('已投放补给使用世界公共拾取并按物理方位显示', () => {
    const controller = readFileSync(
        new URL('../assets/scripts/core/StimulantBrawlController.ts', import.meta.url),
        'utf8',
    );
    const rules = readFileSync(
        new URL('../assets/scripts/core/StimulantBrawlRules.ts', import.meta.url),
        'utf8',
    );
    assert.doesNotMatch(controller, /stimulantPickupRaceDistanceEligible/);
    assert.doesNotMatch(rules, /export function stimulantPickupRaceDistanceEligible/);
    assert.match(controller, /const referenceWorldX = this\.course\.distanceToWorldX\(distance\)/);
    assert.match(controller, /const worldAhead = \(item\.x - referenceWorldX\) \* referenceDirection/);
    assert.match(controller, /item\.visualSpawnStarted\s*&& Math\.abs\(worldAhead\) <= ITEM_VISIBLE_DISTANCE/);
    assert.match(controller, /if \(item\.collected \|\| !item\.visualSpawnStarted\) continue/);
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

test('补给按波次使用二比一洗牌袋且同一波不会混装', () => {
    for (let seed = 1; seed <= 40; seed++) {
        const schedule = buildStimulantSchedule(seed);
        const kinds = [];
        for (let wave = 1; wave <= STIMULANT_PUBLIC_WAVE_DISTANCES.length; wave++) {
            const waveKinds = new Set(schedule.filter(item => item.wave === wave).map(item => item.kind));
            assert.equal(waveKinds.size, 1, `seed=${seed} wave=${wave}`);
            kinds.push([...waveKinds][0]);
        }
        for (let start = 0; start + 3 <= kinds.length; start += 3) {
            const bag = kinds.slice(start, start + 3);
            assert.equal(bag.filter(kind => kind === 'heartbeat-soda').length, 2);
            assert.equal(bag.filter(kind => kind === 'calm-slush').length, 1);
        }
    }
});

test('冷静冰沙资源保持单网格单材质并接入独立蓝色表现', () => {
    const gltf = JSON.parse(readFileSync(
        new URL('../assets/race/items/CalmSlush.gltf', import.meta.url),
        'utf8',
    ));
    assert.equal(gltf.meshes.length, 1);
    assert.equal(gltf.materials.length, 1);
    assert.equal(gltf.meshes[0].primitives.length, 1);
    assert.ok(gltf.meshes[0].primitives[0].attributes.COLOR_0 !== undefined);

    const controller = readFileSync(
        new URL('../assets/scripts/core/StimulantBrawlController.ts', import.meta.url),
        'utf8',
    );
    assert.match(controller, /calmSlushPrefabCandidates/);
    assert.match(controller, /buildStimulantBeaconGeometry\('calm-slush'\)/);
    assert.match(controller, /applyCalmSlush/);
    assert.match(controller, /triggerCalmSlushReaction/);
    assert.match(controller, /CALM_SLUSH_SWAY_READABILITY_SCALE = 1\.55/);
    assert.match(controller, /CALM_SLUSH_YAW_READABILITY_SCALE = 1\.18/);
    assert.match(controller, /item\.kind === 'calm-slush' \? CALM_SLUSH_SWAY_READABILITY_SCALE : 1/);

    const ui = readFileSync(
        new URL('../assets/scripts/ui/SharkEventBanner.ts', import.meta.url),
        'utf8',
    );
    const resourcePaths = readFileSync(
        new URL('../assets/scripts/core/ResourcePaths.ts', import.meta.url),
        'utf8',
    );
    assert.doesNotMatch(resourcePaths, /calm-slush-pickup-base/);
    assert.match(ui, /this\.artFrames\.get\('stimulant-card'\)/);
    assert.match(ui, /STIMULANT_BRAWL_TUNING\.calmSlushPropulsionScale/);
    assert.match(ui, /`推进 \$\{Math\.round\(scale \* 100\)\}%`/);
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

test('折返泳池仍按赛程单程触发对应波次投放', () => {
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

test('苏打瓶按自身上限恢复三成且不溢出', () => {
    const condition = new PlayerConditionModel();
    condition.setProgressionOverrides({ energyTotal: 120 });
    condition.reset();
    condition.consumeEnergy(100);
    assert.equal(condition.energy, 20);
    assert.equal(STIMULANT_BRAWL_TUNING.energyRestoreRatio, 0.3);
    assert.equal(condition.restoreEnergyRatio(STIMULANT_BRAWL_TUNING.energyRestoreRatio), 36);
    assert.equal(condition.energy, 56);
    assert.equal(condition.restoreEnergyRatio(STIMULANT_BRAWL_TUNING.energyRestoreRatio), 36);
    assert.equal(condition.energy, 92);
    assert.equal(condition.restoreEnergyRatio(STIMULANT_BRAWL_TUNING.energyRestoreRatio), 28);
    assert.equal(condition.energy, 120);
});

test('心跳苏打增加四十心率并在四秒内只许上升不许自然回落', () => {
    assert.equal(STIMULANT_BRAWL_TUNING.heartRateBurden, 40);
    assert.equal(STIMULANT_BRAWL_TUNING.heartRateRecoveryHoldSeconds, 4);
    const savedTuning = JSON.parse(readFileSync(
        new URL('../assets/resources/config/tuning.json', import.meta.url),
        'utf8',
    ));
    assert.equal(savedTuning.version, 61);
    assert.equal(savedTuning.values['stimulant.energyRestoreRatio'], 0.3);
    assert.equal(savedTuning.values['stimulant.heartRateBurden'], 40);
    assert.equal(savedTuning.values['stimulant.heartRateRecoveryHoldSeconds'], 4);

    const model = new StrokeHeartRateModel();
    model.addBurden(
        STIMULANT_BRAWL_TUNING.heartRateBurden,
        STIMULANT_BRAWL_TUNING.heartRateRecoveryHoldSeconds,
    );
    assert.equal(model.heartRate, 120);
    model.tick(2.5);
    assert.equal(model.heartRate, 120, '滞留时间内不能向静息目标回落');

    model.addBurden(
        STIMULANT_BRAWL_TUNING.heartRateBurden,
        STIMULANT_BRAWL_TUNING.heartRateRecoveryHoldSeconds,
    );
    assert.equal(model.heartRate, 160);
    model.tick(4);
    assert.equal(model.heartRate, 160, '重复拾取应从最后一次拾取重新计算四秒滞留');
    model.tick(2.5);
    assert.ok(Math.abs(model.heartRate - (80 + 80 * Math.exp(-1))) < 1e-9);

    const singleStep = new StrokeHeartRateModel();
    singleStep.addBurden(40, 4);
    singleStep.tick(6.5);
    assert.ok(Math.abs(singleStep.heartRate - (80 + 40 * Math.exp(-1))) < 1e-9,
        '跨过滞留边界的大步长必须与拆分更新得到相同结果');

    const rising = new StrokeHeartRateModel();
    rising.recordStart();
    rising.addBurden(10, 4);
    rising.tick(1);
    assert.ok(rising.heartRate > 90, '滞留只能禁止回落，不能阻止划水继续推高心率');
});

test('冷静冰沙降低六十心率并立即解除苏打回落锁定', () => {
    assert.equal(STIMULANT_BRAWL_TUNING.calmSlushHeartRateDrop, 60);
    assert.equal(STIMULANT_BRAWL_TUNING.calmSlushDuration, 3);
    assert.equal(STIMULANT_BRAWL_TUNING.calmSlushPropulsionScale, 0.9);
    const model = new StrokeHeartRateModel();
    model.addBurden(80, 4);
    assert.equal(model.heartRate, 160);
    model.applyCooling(STIMULANT_BRAWL_TUNING.calmSlushHeartRateDrop);
    assert.equal(model.heartRate, 100);
    model.tick(1);
    assert.ok(model.heartRate < 100, '冰沙必须清除苏打留下的四秒回落锁定');
    model.applyCooling(60);
    assert.equal(model.heartRate, 80, '冰沙不能把心率降到静息下限以下');

    const motor = readFileSync(
        new URL('../assets/scripts/swimmer/SwimmerMotor.ts', import.meta.url),
        'utf8',
    );
    assert.match(motor, /strokeAcceleration \*= propulsionScale/);
    assert.match(motor, /kickAcceleration \*= propulsionScale/);
    assert.match(motor, /this\._calmSlushTimer <= 0\s*\? stimulantTurnImpulseScale/);
    assert.match(motor, /applyHeartbeatSoda[\s\S]*this\._calmSlushTimer = 0/);
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
