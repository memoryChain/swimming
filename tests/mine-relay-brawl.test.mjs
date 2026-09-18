import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import ControllerModule from '../assets/scripts/core/MineRelayBrawlController.ts';
import GameConstants from '../assets/scripts/core/GameConstants.ts';
import CareerRules from '../assets/scripts/progression/CareerRules.ts';
import PlayerProfile from '../assets/scripts/backend/PlayerProfile.ts';

const {
    MineRelayBrawlController,
    MINE_RELAY_ROUNDS,
    MINE_RELAY_TUNING,
} = ControllerModule;
const { GameState } = GameConstants;
const { executeCareer } = CareerRules;
const { createDefaultProfile, normalizeProfile } = PlayerProfile;

function fixture(seed = 137) {
    const racers = Array.from({ length: 8 }, (_, lane) => ({
        active: true,
        finished: false,
        distance: lane === 0 ? 24 : 20,
        lateral: 8.75 - lane * 2.5,
    }));
    const arms = [];
    const transfers = [];
    const resolutions = [];
    const controller = new MineRelayBrawlController(
        racers.length,
        seed,
        20,
        lane => racers[lane],
        event => arms.push({ ...event }),
        event => transfers.push({ ...event }),
        event => resolutions.push({ ...event }),
    );
    return { racers, arms, transfers, resolutions, controller };
}

function putTogether(f, laneA, laneB) {
    f.racers[laneB].distance = f.racers[laneA].distance + 0.25;
    f.racers[laneB].lateral = f.racers[laneA].lateral + 0.2;
}

test('首轮由种子稳定装雷，始终只有一颗活动水雷', () => {
    const a = fixture(912);
    const b = fixture(912);
    a.controller.update(0, GameState.RACING, true);
    b.controller.update(0, GameState.RACING, true);
    assert.deepEqual(a.arms[0], b.arms[0]);
    assert.equal(a.arms[0].roundId, 0);
    assert.equal(a.arms[0].fuseSeconds, MINE_RELAY_ROUNDS[0].fuseSeconds);
    a.racers[0].distance = MINE_RELAY_ROUNDS[1].triggerDistance;
    a.controller.update(0.1, GameState.RACING, true);
    assert.equal(a.arms.length, 1);
});

test('贴身自动传雷具有全局冷却和上一持有者防回传', () => {
    const f = fixture();
    f.controller.update(0, GameState.RACING, true);
    const first = f.controller.currentCarrierLane();
    const second = first === 0 ? 1 : 0;
    putTogether(f, first, second);
    f.controller.update(MINE_RELAY_TUNING.transferCooldownSeconds + 0.01, GameState.RACING, true);
    assert.equal(f.transfers.length, 1);
    assert.equal(f.transfers[0].fromLane, first);
    assert.equal(f.transfers[0].toLane, second);
    f.controller.update(MINE_RELAY_TUNING.transferCooldownSeconds + 0.01, GameState.RACING, true);
    assert.equal(f.transfers.length, 1, '上一持有者仍在防回传期内');
    f.controller.update(MINE_RELAY_TUNING.returnProtectionSeconds, GameState.RACING, true);
    assert.equal(f.transfers.length, 2);
    assert.equal(f.transfers[1].toLane, first);
});

test('最后锁定阶段不能继续传雷，归零只击飞当前持有者', () => {
    const f = fixture();
    f.controller.update(0, GameState.RACING, true);
    const carrier = f.controller.currentCarrierLane();
    const target = carrier === 0 ? 1 : 0;
    for (let lane = 0; lane < f.racers.length; lane++) {
        if (lane !== carrier) {
            f.racers[lane].distance += 20;
            f.racers[lane].lateral = lane;
        }
    }
    f.controller.update(MINE_RELAY_ROUNDS[0].fuseSeconds - MINE_RELAY_TUNING.lockSeconds + 0.05, GameState.RACING, true);
    assert.equal(f.controller.isLocked(), true);
    putTogether(f, carrier, target);
    f.controller.update(0.1, GameState.RACING, true);
    assert.equal(f.transfers.length, 0);
    f.controller.update(MINE_RELAY_TUNING.lockSeconds, GameState.RACING, true);
    assert.equal(f.resolutions.length, 1);
    assert.deepEqual(f.resolutions[0], {
        roundId: 0,
        carrierLane: carrier,
        exploded: true,
        revision: 2,
    });
});

test('持雷者冲线后拆弹，不触发爆炸', () => {
    const f = fixture();
    f.controller.update(0, GameState.RACING, true);
    const carrier = f.controller.currentCarrierLane();
    f.racers[carrier].finished = true;
    f.controller.update(0.1, GameState.RACING, true);
    assert.equal(f.resolutions.length, 1);
    assert.equal(f.resolutions[0].exploded, false);
    assert.equal(f.controller.currentArm(), null);
});

test('快照恢复持有者、冷却和爆炸，迟到可靠事件不会重复结算', () => {
    const host = fixture(77);
    const guest = fixture(77);
    host.controller.update(0, GameState.RACING, true);
    const first = host.controller.currentCarrierLane();
    const second = first === 0 ? 1 : 0;
    putTogether(host, first, second);
    host.controller.update(MINE_RELAY_TUNING.transferCooldownSeconds + 0.01, GameState.RACING, true);
    let applied = guest.controller.applySnapshotState(host.controller.snapshotState());
    assert.equal(applied.activeChanged, true);
    assert.equal(applied.carrierChanged, true);
    assert.equal(guest.controller.currentCarrierLane(), second);
    host.controller.update(MINE_RELAY_ROUNDS[0].fuseSeconds, GameState.RACING, true);
    applied = guest.controller.applySnapshotState(host.controller.snapshotState());
    assert.equal(applied.newlyExplodedMask, 1);
    assert.equal(guest.controller.resolvedCarrierLane(0), second);
    assert.equal(guest.controller.applyResolution(host.resolutions.at(-1)), false);
});

test('同版本迟到快照不能把引信倒回更长时间', () => {
    const f = fixture();
    f.controller.update(0, GameState.RACING, true);
    const stale = f.controller.snapshotState();
    f.controller.update(1.5, GameState.RACING, false);
    const before = f.controller.currentRemainingSeconds();
    f.controller.applySnapshotState(stale);
    assert.equal(f.controller.currentRemainingSeconds(), before);
});

test('AI 持雷后追人，附近非持雷 AI 向相反方向躲避', () => {
    const f = fixture();
    f.controller.update(0, GameState.RACING, true);
    const carrier = f.controller.currentCarrierLane();
    const target = carrier === 0 ? 1 : 0;
    f.racers[target].distance = f.racers[carrier].distance + 1;
    f.racers[target].lateral = f.racers[carrier].lateral + 1;
    f.controller.update(MINE_RELAY_TUNING.aiReactionSlowSeconds, GameState.RACING, false);
    assert.equal(f.controller.targetZForAi(carrier, 1), f.racers[target].lateral);
    const avoid = f.controller.targetZForAi(target, 1);
    assert.notEqual(avoid, null);
    assert.ok(Math.abs(avoid - f.racers[carrier].lateral) > 1);
});

test('水雷 HUD 和表现遵守低频差量更新及固定网格约束', () => {
    const hud = readFileSync(new URL('../assets/scripts/ui/MineRelayBrawlHud.ts', import.meta.url), 'utf8');
    assert.match(hud, /SAMPLE_SECONDS = 0\.1/);
    assert.match(hud, /text !== this\.lastText/);
    assert.doesNotMatch(hud, /Graphics\.clear|\.clear\(\)/);
    const presentation = readFileSync(
        new URL('../assets/scripts/core/MineRelayBrawlPresentation.ts', import.meta.url),
        'utf8',
    );
    assert.match(presentation, /PRESENTATION_INTERVAL = 1 \/ 20/);
    assert.match(presentation, /buildMineGeometry/);
    assert.doesNotMatch(presentation, /Graphics|\.clear\(\)/);
});

test('水雷接力赛只允许快速比赛二百米并可保存选择', () => {
    const profile = createDefaultProfile();
    const characterId = Object.keys(profile.characters)[0];
    assert.equal(executeCareer(profile, {
        type: 'begin', source: 'quick', characterId, tier: 0, distance: 200, rule: 'mine-relay', seed: 17,
    }).ok, true);
    assert.equal(normalizeProfile(profile).career.quick.rule, 'mine-relay');
    assert.equal(executeCareer(createDefaultProfile(), {
        type: 'begin', source: 'league', characterId, tier: 0, distance: 200, rule: 'mine-relay', seed: 17,
    }).ok, false);
});
