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

test('炮击落点锁定，核心只淘汰最接近中心的一人', () => {
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
    assert.equal(f.impacts[0].eliminatedLane, 3);
    assert.equal(f.impacts[0].hitMask, 1 << 3);
    assert.equal(f.controller.isLaneEliminated(3), true);
});

test('外围冲击只记录命中，不触发淘汰', () => {
    const f = fixture(19);
    f.controller.update(0, GameState.RACING, true);
    const launch = f.launches[0];
    for (const racer of f.racers) racer.distance = launch.targetDistance + 12;
    f.racers[2].distance = launch.targetDistance;
    f.racers[2].lateral = launch.targetZ + CANNON_BRAWL_TUNING.coreLateralRadius + 0.45;
    f.controller.update(CANNON_BRAWL_TUNING.warningSeconds + 0.01, GameState.RACING, true);
    assert.equal(f.impacts[0].hitMask, 1 << 2);
    assert.equal(f.impacts[0].eliminatedLane, -1);
    assert.equal(f.controller.isLaneEliminated(2), false);
});

test('活动炮弹和淘汰掩码可由快照恢复', () => {
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
    assert.equal(applied.newEliminatedMask, 1 << 4);
    assert.equal(applied.activeChanged, true);
    assert.equal(guest.controller.currentLaunch(), null);
    assert.equal(guest.controller.applyImpact(host.impacts[0]), true);
    assert.equal(guest.controller.applyImpact(host.impacts[0]), false);
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

test('只剩一名在场选手时不再生成炮击', () => {
    const f = fixture();
    for (let lane = 1; lane < f.racers.length; lane++) f.racers[lane].active = false;
    f.controller.update(0, GameState.RACING, true);
    assert.equal(f.launches.length, 0);
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
