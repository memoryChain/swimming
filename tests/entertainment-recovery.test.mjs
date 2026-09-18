import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import RecoveryModule from '../assets/scripts/core/EntertainmentRecoveryController.ts';

const { EntertainmentRecoveryController, ENTERTAINMENT_RECOVERY_TUNING } = RecoveryModule;
const ACTIVE = 0;
const KNOCKED = 1;
const INVULNERABLE = 2;
const SHARK = 1;
const CANNON = 2;
const TIMED_BOMB = 3;

function fixture(lanes = 4) {
    const events = [];
    const controller = new EntertainmentRecoveryController(lanes, {
        onKnocked: (lane, state) => events.push(['knocked', lane, state.distance]),
        onRespawn: (lane, state) => events.push(['respawn', lane, state.distance]),
        onRecovered: lane => events.push(['recovered', lane]),
    });
    return { controller, events };
}

test('击倒后按等待、无敌、恢复三个阶段推进并保留权威距离', () => {
    const f = fixture();
    assert.equal(ENTERTAINMENT_RECOVERY_TUNING.knockedSeconds, 2.5);
    const event = f.controller.tryKnockDown(2, SHARK, 54.32);
    assert.deepEqual(event, { lane: 2, reason: SHARK, distance: 54.32, revision: 1 });
    assert.equal(f.controller.stateForLane(2).phase, KNOCKED);
    assert.equal(f.controller.isDamageable(2), false);
    assert.equal(f.controller.tryKnockDown(2, CANNON, 60), null);

    f.controller.update(ENTERTAINMENT_RECOVERY_TUNING.knockedSeconds - 0.01);
    assert.equal(f.controller.stateForLane(2).phase, KNOCKED);
    f.controller.update(0.02);
    assert.equal(f.controller.stateForLane(2).phase, INVULNERABLE);
    assert.deepEqual(f.events.slice(0, 2), [['knocked', 2, 54.32], ['respawn', 2, 54.32]]);

    f.controller.update(ENTERTAINMENT_RECOVERY_TUNING.invulnerableSeconds);
    assert.equal(f.controller.stateForLane(2).phase, ACTIVE);
    assert.equal(f.controller.isDamageable(2), true);
    assert.deepEqual(f.events.at(-1), ['recovered', 2]);
});

test('恢复快照可补回丢失事件，且同版本旧阶段不能倒退本地状态', () => {
    const host = fixture(3);
    const guest = fixture(3);
    host.controller.applyKnockDown({ lane: 1, reason: CANNON, distance: 88.75, revision: 4 });
    assert.equal(guest.controller.applySnapshot(host.controller.snapshot()), true);
    assert.equal(guest.controller.stateForLane(1).phase, KNOCKED);

    host.controller.update(ENTERTAINMENT_RECOVERY_TUNING.knockedSeconds);
    assert.equal(guest.controller.applySnapshot(host.controller.snapshot()), true);
    assert.equal(guest.controller.stateForLane(1).phase, INVULNERABLE);

    assert.equal(guest.controller.applySnapshot({
        revision: 4,
        lanes: [
            { phase: ACTIVE, reason: 0, remainingSeconds: 0, distance: 0, revision: 0 },
            { phase: KNOCKED, reason: CANNON, remainingSeconds: 1, distance: 88.75, revision: 4 },
            { phase: ACTIVE, reason: 0, remainingSeconds: 0, distance: 0, revision: 0 },
        ],
    }), true);
    assert.equal(guest.controller.stateForLane(1).phase, INVULNERABLE);
});

test('定时炸弹致命命中复用同一套原进度重生和无敌流程', () => {
    const f = fixture();
    assert.equal(f.controller.applyKnockDown({
        lane: 0,
        reason: TIMED_BOMB,
        distance: 72.45,
        revision: 6,
    }), true);
    assert.equal(f.controller.stateForLane(0).phase, KNOCKED);
    assert.equal(f.controller.stateForLane(0).reason, TIMED_BOMB);
    f.controller.update(ENTERTAINMENT_RECOVERY_TUNING.knockedSeconds);
    assert.equal(f.controller.stateForLane(0).phase, INVULNERABLE);
    assert.deepEqual(f.events.slice(0, 2), [['knocked', 0, 72.45], ['respawn', 0, 72.45]]);
});

test('鲨鱼、炮火和定时炸弹接入复用泳者节点，不走永久淘汰或最后幸存者结算', () => {
    const source = readFileSync(new URL('../assets/scripts/core/GameManager.ts', import.meta.url), 'utf8');
    assert.match(source, /respawnAfterEntertainmentHit/);
    assert.match(source, /setSharkKnockdownListener/);
    assert.match(source, /knockDownCannonHitLane/);
    assert.match(source, /EntertainmentRecoveryReason\.TIMED_BOMB/);
    assert.match(source, /isDamageable\(lane\)/);
    assert.match(source, /recovery\?\.phase === EntertainmentRecoveryPhase\.KNOCKED/);
    assert.doesNotMatch(source, /eliminateCannonHitLane|handleSharkElimination|enqueueSharkElimination/);
    const swimmer = readFileSync(new URL('../assets/scripts/entity/Swimmer.ts', import.meta.url), 'utf8');
    assert.match(swimmer, /suspendForEntertainmentKnockout/);
    assert.match(swimmer, /resumeAfterEntertainmentHit/);
    assert.doesNotMatch(swimmer.match(/respawnAfterEntertainmentHit[\s\S]*?\n    }/)?.[0] ?? '', /\.startRace\(/);
});

test('本地击倒使用独占急救遮罩，重生后再显示无敌状态条', () => {
    const hud = readFileSync(new URL('../assets/scripts/ui/EntertainmentRecoveryHud.ts', import.meta.url), 'utf8');
    assert.match(hud, /急救中……/);
    assert.match(hud, /BlockInputEvents/);
    assert.match(hud, /phase === EntertainmentRecoveryPhase\.KNOCKED/);
    assert.match(hud, /phase === EntertainmentRecoveryPhase\.INVULNERABLE/);
    assert.match(hud, /无敌保护/);
});
