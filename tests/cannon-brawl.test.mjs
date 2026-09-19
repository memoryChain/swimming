import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import ControllerModule from '../assets/scripts/core/CannonBrawlController.ts';
import GameConstants from '../assets/scripts/core/GameConstants.ts';
import CareerRules from '../assets/scripts/progression/CareerRules.ts';
import PlayerProfile from '../assets/scripts/backend/PlayerProfile.ts';

const { CannonBrawlController, CANNON_BRAWL_TUNING } = ControllerModule;
const { GameState } = GameConstants;
const { executeCareer } = CareerRules;
const { createDefaultProfile, normalizeProfile } = PlayerProfile;

function fixture(seed = 137) {
    const racers = Array.from({ length: 8 }, (_, lane) => ({
        active: true,
        finished: false,
        damageable: true,
        distance: lane === 0 ? 25 : 20,
        lateral: 8.75 - lane * 2.5,
        speed: 3,
    }));
    const launches = [];
    const impacts = [];
    const controller = new CannonBrawlController(
        racers.length,
        seed,
        20,
        lane => racers[lane],
        launch => launches.push({ ...launch }),
        impact => impacts.push({ ...impact }),
    );
    return { racers, launches, impacts, controller };
}

test('炮击落点锁定，核心只击倒最接近中心的一人', () => {
    const f = fixture();
    f.controller.update(0, GameState.RACING, true);
    assert.equal(f.launches.length, 1);
    const launch = f.launches[0];
    assert.equal(launch.strikeId, 0);
    for (const racer of f.racers) racer.distance = launch.targetDistance + 12;
    f.racers[3].distance = launch.targetDistance;
    f.racers[3].lateral = launch.targetZ;
    f.controller.update(CANNON_BRAWL_TUNING.warningSeconds + 0.01, GameState.RACING, true);
    assert.equal(f.impacts.length, 1);
    assert.equal(f.impacts[0].knockedLane, 3);
    assert.equal(f.impacts[0].knockedDistance, launch.targetDistance);
    assert.equal(f.impacts[0].hitMask, 1 << 3);
});

test('外围冲击只记录命中，不触发击倒', () => {
    const f = fixture(19);
    f.controller.update(0, GameState.RACING, true);
    const launch = f.launches[0];
    for (const racer of f.racers) racer.distance = launch.targetDistance + 12;
    f.racers[2].distance = launch.targetDistance;
    f.racers[2].lateral = launch.targetZ + CANNON_BRAWL_TUNING.coreLateralRadius + 0.45;
    f.controller.update(CANNON_BRAWL_TUNING.warningSeconds + 0.01, GameState.RACING, true);
    assert.equal(f.impacts[0].hitMask, 1 << 2);
    assert.equal(f.impacts[0].knockedLane, -1);
});

test('炮火扩大的外围冲击能覆盖原范围外的选手', () => {
    assert.equal(CANNON_BRAWL_TUNING.splashAlongRadius, 3.4);
    assert.equal(CANNON_BRAWL_TUNING.splashLateralRadius, 2.85);
    const f = fixture(41);
    f.controller.update(0, GameState.RACING, true);
    const launch = f.launches[0];
    for (const racer of f.racers) racer.distance = launch.targetDistance + 12;
    f.racers[5].distance = launch.targetDistance + 3.1;
    f.racers[5].lateral = launch.targetZ;
    f.controller.update(CANNON_BRAWL_TUNING.warningSeconds + 0.01, GameState.RACING, true);
    assert.equal(f.impacts[0].hitMask, 1 << 5);
    assert.equal(f.impacts[0].knockedLane, -1);
});

test('活动炮弹和已完成波次可由快照恢复', () => {
    const host = fixture(77);
    const guest = fixture(77);
    host.controller.update(0, GameState.RACING, true);
    let applied = guest.controller.applySnapshotState(host.controller.snapshotState());
    assert.equal(applied.activeChanged, true);
    assert.equal(guest.controller.currentLaunch().strikeId, 0);
    const launch = host.launches[0];
    for (const racer of host.racers) racer.distance = launch.targetDistance + 12;
    host.racers[4].distance = launch.targetDistance;
    host.racers[4].lateral = launch.targetZ;
    host.controller.update(CANNON_BRAWL_TUNING.warningSeconds + 0.01, GameState.RACING, true);
    applied = guest.controller.applySnapshotState(host.controller.snapshotState());
    assert.equal(applied.activeChanged, true);
    assert.equal(guest.controller.currentLaunch(), null);
    assert.equal(guest.controller.applyImpact(host.impacts[0]), true);
    assert.equal(guest.controller.applyImpact(host.impacts[0]), false);
});

test('同一炮击修订的旧快照不会延长当前落点倒计时', () => {
    const host = fixture(77);
    const guest = fixture(77);
    host.controller.update(0, GameState.RACING, true);
    const snapshot = host.controller.snapshotState();
    guest.controller.applySnapshotState(snapshot);
    guest.controller.update(1, GameState.RACING, false);
    const remaining = guest.controller.currentRemainingSeconds();
    guest.controller.applySnapshotState(snapshot);
    assert.equal(guest.controller.currentRemainingSeconds(), remaining);
});

test('同一种子生成相同首发落点，AI 在反应延迟后选择核心外安全区', () => {
    const a = fixture(912);
    const b = fixture(912);
    a.controller.update(0, GameState.RACING, true);
    b.controller.update(0, GameState.RACING, true);
    assert.deepEqual(a.launches[0], b.launches[0]);
    const launch = a.launches[0];
    assert.equal(a.controller.targetZForAi(launch.targetDistance, launch.targetZ, 1), null);
    a.controller.update(0.2, GameState.RACING, false);
    const target = a.controller.targetZForAi(launch.targetDistance, launch.targetZ, 1);
    assert.notEqual(target, null);
    assert.ok(Math.abs(target - launch.targetZ) > CANNON_BRAWL_TUNING.splashLateralRadius);
});

test('只剩一名可攻击选手时仍会生成炮击', () => {
    const f = fixture();
    for (let lane = 1; lane < f.racers.length; lane++) f.racers[lane].active = false;
    f.controller.update(0, GameState.RACING, true);
    assert.equal(f.launches.length, 1);
});

test('炮火 HUD 限制十赫兹采样且不逐帧重绘图形', () => {
    const source = readFileSync(new URL('../assets/scripts/ui/CannonBrawlHud.ts', import.meta.url), 'utf8');
    assert.match(source, /SAMPLE_SECONDS = 0\.1/);
    assert.match(source, /consumeSample/);
    assert.match(source, /text !== this\.lastText/);
    assert.doesNotMatch(source, /Graphics\.clear|\.clear\(\)/);
    const presentation = readFileSync(
        new URL('../assets/scripts/core/CannonBrawlPresentation.ts', import.meta.url),
        'utf8',
    );
    assert.match(presentation, /PRESENTATION_INTERVAL = 1 \/ 20/);
    assert.match(presentation, /buildCannonGeometry/);
    assert.doesNotMatch(presentation, /Graphics|\.clear\(\)/);
});

test('看台大炮使用分层炮架、轮毂、斜撑和渐细炮管并保持单网格共享材质', () => {
    const presentation = readFileSync(
        new URL('../assets/scripts/core/CannonBrawlPresentation.ts', import.meta.url),
        'utf8',
    );
    const model = presentation.match(/function buildCannonGeometry[\s\S]*?\n}/)?.[0] ?? '';
    assert.match(model, /appendBeamYZ/);
    assert.match(model, /appendTaperedCylinder/);
    assert.match(model, /轮轴贯穿两侧车轮/);
    assert.match(model, /双层炮口/);
    assert.match(model, /暗色圆面覆盖炮口端盖/);
    const wheelLayers = [...model.matchAll(
        /appendCylinder\(positions, colors, indices, wheelCenterX, 0\.46, 0\.08, 0\.(\d+), 0\.(\d+), 'x'/g,
    )].map(match => ({ radius: Number(`0.${match[1]}`), length: Number(`0.${match[2]}`) }));
    assert.equal(wheelLayers.length, 3);
    assert.ok(wheelLayers[0].length < wheelLayers[1].length);
    assert.ok(wheelLayers[1].length < wheelLayers[2].length);
    assert.match(presentation, /this\.cannonMesh = utils\.createMesh\(buildCannonGeometry\(\)\)/);
    assert.match(presentation, /this\.cannonMesh, this\.cannonMaterial/);
    assert.doesNotMatch(presentation, /resources\.load|assetManager\.load/);
});

test('炮火逃生赛只允许快速比赛二百米，旧末位存档迁移为炮火规则', () => {
    const profile = createDefaultProfile();
    const characterId = Object.keys(profile.characters)[0];
    assert.equal(executeCareer(profile, {
        type: 'begin', source: 'quick', characterId, tier: 0, distance: 200, rule: 'cannon', seed: 17,
    }).ok, true);
    assert.equal(normalizeProfile(profile).career.quick.rule, 'cannon');
    const legacy = createDefaultProfile();
    legacy.career.quick.rule = 'last-place';
    assert.equal(normalizeProfile(legacy).career.quick.rule, 'cannon');
    assert.equal(executeCareer(createDefaultProfile(), {
        type: 'begin', source: 'league', characterId, tier: 0, distance: 200, rule: 'cannon', seed: 17,
    }).ok, false);
});
