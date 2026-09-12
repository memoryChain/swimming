import test from 'node:test';
import assert from 'node:assert/strict';

import CollisionResolver from '../assets/scripts/entity/SwimmerCollisionResolver.ts';
import CharacterConfig from '../assets/scripts/app/PlayerCharacterConfig.ts';

const { SWIMMER_COLLISION, resolveSwimmerCollisions } = CollisionResolver;

function makeSwimmer({ x, z, direction, startZ = z, isAI = false, remoteHuman = false, weight = 1 }) {
    const impulses = [];
    const rolls = [];
    const pitches = [];
    return {
        node: { position: { x, y: 0, z } },
        isCollisionActive: true,
        isAI,
        collisionParticipantIsAI: isAI && !remoteHuman,
        weight,
        raceDirection: direction,
        startPosition: { x: 0, y: 0, z: startZ },
        currentSpeed: 5,
        movementHeading: 0,
        impulses,
        rolls,
        pitches,
        applyCollisionPush(dx, dz) {
            this.node.position.x += dx;
            this.node.position.z += dz;
        },
        applyCollisionImpulse(distance, lateral) {
            impulses.push({ distance, lateral });
        },
        addCollisionEnergyBonus() {},
        applyCollisionSoftnessImpulse() {},
        applyCollisionAxialImpulse(value) { rolls.push(value); },
        applyCollisionPitchImpulse(value) { pitches.push(value); },
    };
}

function clearCollisionContacts() {
    const enabled = SWIMMER_COLLISION.enabled;
    SWIMMER_COLLISION.enabled = false;
    resolveSwimmerCollisions([]);
    SWIMMER_COLLISION.enabled = enabled;
}

test('肌肉男正撞蛙妹主要推开轻角色，双方顺序变化不改变分离和击退', () => {
    const heavyWeight = CharacterConfig.characterWeightForModel('muscleMan');
    const lightWeight = CharacterConfig.characterWeightForModel('cartonSwimmer6');
    const run = reverse => {
        clearCollisionContacts();
        const heavy = makeSwimmer({ x: -0.85, z: 0, direction: 1, weight: heavyWeight });
        const light = makeSwimmer({ x: 0.85, z: 0, direction: -1, weight: lightWeight, isAI: true });
        resolveSwimmerCollisions(reverse ? [light, heavy] : [heavy, light]);
        return { heavy, light };
    };
    const normal = run(false);
    const reverse = run(true);
    for (const key of ['heavy', 'light']) {
        assert.deepEqual(normal[key].node.position, reverse[key].node.position);
        assert.deepEqual(normal[key].impulses, reverse[key].impulses);
        assert.deepEqual(normal[key].rolls, reverse[key].rolls);
        assert.deepEqual(normal[key].pitches, reverse[key].pitches);
    }
    const heavyImpulse = Math.abs(normal.heavy.impulses[0].distance);
    const lightImpulse = Math.abs(normal.light.impulses[0].distance);
    assert.ok(heavyImpulse < 0.35, '重角色保留明显抗撞优势');
    assert.ok(lightImpulse > 3.6, '轻角色承担绝大多数迎面击退');
    assert.ok(lightImpulse / heavyImpulse > 12);
    assert.ok(Math.abs(normal.light.node.position.x - 0.85)
        > Math.abs(normal.heavy.node.position.x + 0.85) * 12);
    assert.ok(Math.abs(normal.light.impulses[0].lateral) <= SWIMMER_COLLISION.headOnEscapeMaxImpulse);
});

test('侧撞的击退与翻滚保留体重优势，同体重仍对称且线性档可用于对照', () => {
    const original = SWIMMER_COLLISION.weightContrastExponent;
    try {
        for (const exponent of [1, 6]) for (const lightWeight of [0.85, 1.3]) {
            SWIMMER_COLLISION.weightContrastExponent = exponent;
            clearCollisionContacts();
            const heavy = makeSwimmer({ x: 0, z: -0.85, direction: 1, weight: 1.3 });
            const light = makeSwimmer({ x: 0, z: 0.85, direction: 1, weight: lightWeight });
            heavy.movementHeading = Math.PI / 2;
            light.movementHeading = -Math.PI / 2;
            resolveSwimmerCollisions([heavy, light]);
            const expectedRatio = Math.pow(1.3 / lightWeight, exponent);
            assert.ok(Math.abs(Math.abs(light.impulses[0].lateral / heavy.impulses[0].lateral) - expectedRatio) < 1e-10);
            assert.ok(Math.abs(Math.abs(light.rolls[0] / heavy.rolls[0]) - expectedRatio) < 1e-10);
            assert.equal(heavy.impulses[0].distance, 0);
            assert.equal(light.impulses[0].distance, 0);
        }
    } finally {
        SWIMMER_COLLISION.weightContrastExponent = original;
        clearCollisionContacts();
    }
});

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

test('远端真人与真正 AI 都遵守同一正面阻挡、击退和脱困规则', () => {
    for (const remoteHuman of [true, false]) {
        clearCollisionContacts();
        const first = makeSwimmer({ x: -0.85, z: 0, direction: 1, isAI: true, remoteHuman });
        const second = makeSwimmer({ x: 0.85, z: 0, direction: -1, isAI: true, remoteHuman });
        resolveSwimmerCollisions([first, second]);
        assert.ok(first.impulses[0].distance < 0);
        assert.ok(first.impulses[0].lateral < 0);
        assert.ok(second.impulses[0].lateral > 0);
        assert.ok(first.node.position.x < -0.85);
        assert.ok(second.node.position.x > 0.85);
    }
    clearCollisionContacts();
});
