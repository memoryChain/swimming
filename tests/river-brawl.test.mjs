import test from 'node:test';
import assert from 'node:assert/strict';

import CombatModule from '../assets/scripts/entity/SwimmerCombatResolver.ts';
import FallModule from '../assets/scripts/entity/RiverFallController.ts';
import BalanceModule from '../assets/scripts/core/RiverBrawlBalance.ts';

const { resolveSideKick } = CombatModule;
const { RiverFallController } = FallModule;
const { RIVER_BRAWL_BALANCE } = BalanceModule;

test('river movement keeps course flow separate from the personal swim cap', () => {
    assert.equal(RIVER_BRAWL_BALANCE.raceDistance, 400);
    assert.equal(RIVER_BRAWL_BALANCE.flowSpeed, 8);
    assert.equal(RIVER_BRAWL_BALANCE.personalMaxSpeed, 4);
    assert.equal(RIVER_BRAWL_BALANCE.flowSpeed + RIVER_BRAWL_BALANCE.personalMaxSpeed, 12);
});

function fakeSwimmer({ x, z, direction = 1, heading = 0, weight = 1, active = true }) {
    const calls = [];
    return {
        node: { position: { x, y: 0, z } },
        canRiverCombat: active,
        raceDirection: direction,
        movementHeading: heading,
        weight,
        calls,
        playCombatKick(side) { calls.push(['kick', side]); },
        applyCollisionImpulse(distance, lateral) { calls.push(['move', distance, lateral]); },
        applyCollisionAxialImpulse(value) { calls.push(['roll', value]); },
        applyCollisionPitchImpulse(value) { calls.push(['pitch', value]); },
        applyCollisionSoftnessImpulse(side, forward) { calls.push(['soft', side, forward]); },
        addCollisionEnergyBonus(value) { calls.push(['energy', value]); },
        flashCollision() { calls.push(['flash']); },
        playCombatImpact() { calls.push(['impact']); },
    };
}

test('side kick reaches an adjacent lane and pushes the victim outward', () => {
    const attacker = fakeSwimmer({ x: 10, z: 0 });
    const target = fakeSwimmer({ x: 10.4, z: 2.625 });
    const result = resolveSideKick(attacker, [attacker, target]);
    assert.equal(result?.target, target);
    const move = target.calls.find((call) => call[0] === 'move');
    assert.ok(move);
    assert.ok(move[2] > 3.5);
    assert.deepEqual(target.calls.find((call) => call[0] === 'roll'), ['roll', -2.4]);
    assert.deepEqual(target.calls.find((call) => call[0] === 'pitch'), ['pitch', -0.8]);
    assert.deepEqual(target.calls.find((call) => call[0] === 'soft'), ['soft', 0.6, -0.4]);
    assert.ok(target.calls.some((call) => call[0] === 'soft'));
    assert.ok(target.calls.some((call) => call[0] === 'impact'));
});

test('side kick chooses the nearest stable candidate and rejects invalid targets', () => {
    const attacker = fakeSwimmer({ x: 0, z: 0 });
    const inactive = fakeSwimmer({ x: 0, z: 1, active: false });
    const far = fakeSwimmer({ x: 0, z: 2.9 });
    const near = fakeSwimmer({ x: 0.2, z: 2.0 });
    const result = resolveSideKick(attacker, [attacker, inactive, far, near]);
    assert.equal(result?.target, near);
    assert.equal(far.calls.length, 0);
    assert.equal(inactive.calls.length, 0);
});

test('side kick uses actual heading when projecting its attack window', () => {
    const attacker = fakeSwimmer({ x: 0, z: 0, heading: Math.PI / 6 });
    const sideX = -Math.sin(Math.PI / 6);
    const sideZ = Math.cos(Math.PI / 6);
    const target = fakeSwimmer({ x: sideX * 2.2, z: sideZ * 2.2 });
    assert.equal(resolveSideKick(attacker, [attacker, target])?.target, target);
});

test('fall controller keeps the racer active, sets back progress, and ends protection on time', () => {
    const calls = [];
    const node = {
        active: true,
        isValid: true,
        position: { x: 40, y: 0, z: 10.6 },
        setPosition(x, y, z) { this.position = { x, y, z }; },
        setRotationFromEuler() {},
    };
    const swimmer = {
        node,
        distance: 40,
        canRiverCombat: true,
        beginRiverFall() {
            calls.push(['fall']);
            this.canRiverCombat = false;
        },
        respawnAfterRiverFall(distance, speed) {
            calls.push(['respawn', distance, speed]);
            this.distance = distance;
        },
        setRespawnProtectionActive(active) {
            calls.push(['protect', active]);
            this.canRiverCombat = !active;
        },
        cancelRiverFallState() {
            calls.push(['cancel']);
            this.canRiverCombat = true;
        },
    };
    const controller = new RiverFallController();
    controller.update(0, [swimmer], 10.5, true);
    assert.deepEqual(calls[0], ['fall']);
    assert.equal(node.active, true);

    controller.update(0.9, [swimmer], 10.5, true);
    assert.deepEqual(calls.find((call) => call[0] === 'respawn'), ['respawn', 35, 1.2]);
    assert.ok(calls.some((call) => call[0] === 'protect' && call[1] === true));
    controller.update(1.24, [swimmer], 10.5, true);
    assert.equal(swimmer.canRiverCombat, false);
    controller.update(0.02, [swimmer], 10.5, true);
    assert.equal(swimmer.canRiverCombat, true);
    assert.equal(node.active, true);
});
