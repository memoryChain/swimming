import test from 'node:test';
import assert from 'node:assert/strict';

import CollisionResolver from '../assets/scripts/entity/SwimmerCollisionResolver.ts';

const { SWIMMER_COLLISION, resolveSwimmerCollisions } = CollisionResolver;

function makeSwimmer({ x, z, direction, startZ = z }) {
    const impulses = [];
    return {
        node: { position: { x, y: 0, z } },
        isCollisionActive: true,
        isAI: false,
        weight: 1,
        raceDirection: direction,
        startPosition: { x: 0, y: 0, z: startZ },
        currentSpeed: 5,
        movementHeading: 0,
        impulses,
        applyCollisionPush(dx, dz) {
            this.node.position.x += dx;
            this.node.position.z += dz;
        },
        applyCollisionImpulse(distance, lateral) {
            impulses.push({ distance, lateral });
        },
        addCollisionEnergyBonus() {},
        applyCollisionAxialImpulse() {},
        applyCollisionPitchImpulse() {},
    };
}

function clearCollisionContacts() {
    const enabled = SWIMMER_COLLISION.enabled;
    SWIMMER_COLLISION.enabled = false;
    resolveSwimmerCollisions([]);
    SWIMMER_COLLISION.enabled = enabled;
}

function runCentredHeadOn(reverseOrder) {
    clearCollisionContacts();
    const left = makeSwimmer({ x: -0.85, z: 0, direction: 1 });
    const right = makeSwimmer({ x: 0.85, z: 0, direction: -1 });
    resolveSwimmerCollisions(reverseOrder ? [right, left] : [left, right]);
    return { left, right };
}

test('centred head-on collision pushes both swimmers sideways in stable opposite directions', () => {
    const normalOrder = runCentredHeadOn(false);
    const reversedOrder = runCentredHeadOn(true);

    assert.equal(normalOrder.left.impulses.length, 1);
    assert.equal(normalOrder.right.impulses.length, 1);
    assert.ok(normalOrder.left.impulses[0].lateral < 0);
    assert.ok(normalOrder.right.impulses[0].lateral > 0);
    assert.ok(Math.abs(normalOrder.left.impulses[0].lateral) >= 1.7);
    assert.ok(Math.abs(normalOrder.right.impulses[0].lateral) >= 1.7);

    assert.equal(
        Math.sign(reversedOrder.left.impulses[0].lateral),
        Math.sign(normalOrder.left.impulses[0].lateral),
    );
    assert.equal(
        Math.sign(reversedOrder.right.impulses[0].lateral),
        Math.sign(normalOrder.right.impulses[0].lateral),
    );
});

test('an existing left-right relationship is amplified without swapping sides', () => {
    clearCollisionContacts();
    const upper = makeSwimmer({ x: -0.85, z: 0.01, direction: 1 });
    const lower = makeSwimmer({ x: 0.85, z: -0.01, direction: -1 });

    resolveSwimmerCollisions([upper, lower]);

    assert.equal(upper.impulses.length, 1);
    assert.equal(lower.impulses.length, 1);
    assert.ok(upper.impulses[0].lateral > 0);
    assert.ok(lower.impulses[0].lateral < 0);
});

function runConcentricHeadOn(reverseOrder) {
    clearCollisionContacts();
    const firstLane = makeSwimmer({ x: 0, z: 0, startZ: -1, direction: 1 });
    const secondLane = makeSwimmer({ x: 0, z: 0, startZ: 1, direction: -1 });
    resolveSwimmerCollisions(reverseOrder ? [secondLane, firstLane] : [firstLane, secondLane]);
    return { firstLane, secondLane };
}

test('fully concentric head-on separation and impulse stay stable when pair order reverses', () => {
    const normalOrder = runConcentricHeadOn(false);
    const reversedOrder = runConcentricHeadOn(true);

    assert.ok(normalOrder.firstLane.node.position.z < 0);
    assert.ok(normalOrder.secondLane.node.position.z > 0);
    assert.ok(normalOrder.firstLane.impulses[0].lateral < 0);
    assert.ok(normalOrder.secondLane.impulses[0].lateral > 0);

    assert.equal(
        Math.sign(reversedOrder.firstLane.node.position.z),
        Math.sign(normalOrder.firstLane.node.position.z),
    );
    assert.equal(
        Math.sign(reversedOrder.secondLane.node.position.z),
        Math.sign(normalOrder.secondLane.node.position.z),
    );
    assert.equal(
        Math.sign(reversedOrder.firstLane.impulses[0].lateral),
        Math.sign(normalOrder.firstLane.impulses[0].lateral),
    );
    assert.equal(
        Math.sign(reversedOrder.secondLane.impulses[0].lateral),
        Math.sign(normalOrder.secondLane.impulses[0].lateral),
    );
});

test('continuous contact injects the escape impulse only once', () => {
    const { left, right } = runCentredHeadOn(false);

    resolveSwimmerCollisions([left, right]);

    assert.equal(left.impulses.length, 1);
    assert.equal(right.impulses.length, 1);
    clearCollisionContacts();
});
