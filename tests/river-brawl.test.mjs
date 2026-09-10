import test from 'node:test';
import assert from 'node:assert/strict';

import CombatModule from '../assets/scripts/entity/SwimmerCombatResolver.ts';
import BalanceModule from '../assets/scripts/core/RiverBrawlBalance.ts';

const { resolveSideKick } = CombatModule;
const {
    RIVER_BRAWL_BALANCE,
    riverBankContactRatio,
    updateRiverBankResistance,
} = BalanceModule;

test('river movement keeps course flow separate from the personal swim cap', () => {
    assert.equal(RIVER_BRAWL_BALANCE.raceDistance, 400);
    assert.equal(RIVER_BRAWL_BALANCE.flowSpeed, 8);
    assert.equal(RIVER_BRAWL_BALANCE.personalMaxSpeed, 4);
    assert.equal(RIVER_BRAWL_BALANCE.flowSpeed + RIVER_BRAWL_BALANCE.personalMaxSpeed, 12);
    assert.equal(
        RIVER_BRAWL_BALANCE.flowSpeed * RIVER_BRAWL_BALANCE.bankFlowSpeedScale
            + RIVER_BRAWL_BALANCE.personalMaxSpeed * RIVER_BRAWL_BALANCE.bankPersonalSpeedScale,
        5.4,
    );
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

test('river bank resistance is smooth across the final 1.5 metres', () => {
    assert.equal(riverBankContactRatio(8.5, 10, 1.5), 0);
    assert.equal(riverBankContactRatio(9.25, 10, 1.5), 0.5);
    assert.equal(riverBankContactRatio(10, 10, 1.5), 1);
});

test('river bank resistance engages immediately and releases over the configured interval', () => {
    assert.equal(updateRiverBankResistance(0, 1, 1 / 60, 0.4), 1);
    assert.equal(updateRiverBankResistance(1, 0, 0.2, 0.4), 0.5);
    assert.equal(updateRiverBankResistance(0.5, 0, 0.2, 0.4), 0);
    assert.equal('respawnSetback' in RIVER_BRAWL_BALANCE, false);
});
