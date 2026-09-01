import test from 'node:test';
import assert from 'node:assert/strict';

import CollisionRagdollModule from '../assets/scripts/character/CollisionRagdollController.ts';

const {
    COLLISION_RAGDOLL_ELBOW_FLEX_LIMIT_DEGREES,
    COLLISION_RAGDOLL_KNEE_FLEX_LIMIT_DEGREES,
    CollisionRagdollController,
    collisionRagdollHingeFlexionDegrees,
    collisionRagdollHeadGuardWeight,
    collisionRagdollSpineFlexionDegrees,
} = CollisionRagdollModule;
const DEG2RAD = Math.PI / 180;

function poseSnapshot(controller) {
    return {
        weight: controller.weight,
        strokePoseWeight: controller.strokePoseWeight,
        leftArmSwing: controller.leftArmSwing,
        rightArmSwing: controller.rightArmSwing,
        leftElbowBend: controller.leftElbowBend,
        rightElbowBend: controller.rightElbowBend,
        leftLegSwing: controller.leftLegSwing,
        rightLegSwing: controller.rightLegSwing,
        leftKneeBend: controller.leftKneeBend,
        rightKneeBend: controller.rightKneeBend,
        spinePitch: controller.spinePitch,
        headRoll: controller.headRoll,
    };
}

test('inactive controller keeps the authored swim pose untouched', () => {
    const controller = new CollisionRagdollController();
    controller.update(1, 0, 0, true);

    assert.equal(controller.weight, 0);
    assert.equal(controller.strokePoseWeight, 1);
    assert.equal(controller.leftElbowBend, 0);
    assert.equal(controller.rightKneeBend, 0);
});

test('same lane seed and authoritative motion produce the same loose-limb pose', () => {
    const first = new CollisionRagdollController();
    const second = new CollisionRagdollController();
    first.setStableSeed(-2625);
    second.setStableSeed(-2625);

    for (const controller of [first, second]) {
        controller.trigger(2, 2.8, 280 * DEG2RAD, -160 * DEG2RAD);
        controller.update(2.016, 250 * DEG2RAD, -130 * DEG2RAD, true);
    }

    assert.deepEqual(poseSnapshot(first), poseSnapshot(second));
    assert.ok(first.weight > 0.4);
    assert.ok(first.strokePoseWeight >= 0.35);
    assert.ok(first.strokePoseWeight < 1);
    assert.ok(first.leftElbowBend > 0);
    assert.ok(first.rightKneeBend > 0);
});

test('a synchronized collision event joins the same reaction phase after network delay', () => {
    const source = new CollisionRagdollController();
    const remote = new CollisionRagdollController();
    source.setStableSeed(2625);
    remote.setStableSeed(2625);

    source.trigger(2, 2.8, -240 * DEG2RAD, 170 * DEG2RAD);
    const age = 0.198;
    source.update(2 + age, -210 * DEG2RAD, 150 * DEG2RAD, true);
    remote.triggerSynchronized(
        50,
        age,
        source.impactStrength,
        source.impactRollSign,
        source.impactPitchSign,
        source.impactPhase,
    );
    remote.update(50, -210 * DEG2RAD, 150 * DEG2RAD, true);

    const expected = poseSnapshot(source);
    const actual = poseSnapshot(remote);
    for (const key of Object.keys(expected)) {
        assert.ok(Math.abs(expected[key] - actual[key]) < 1e-9, key);
    }
});

test('gradual stroke-driven roll does not wake a collision-only reaction', () => {
    const controller = new CollisionRagdollController();
    controller.update(0, 0, 0, true);
    for (let step = 1; step <= 20; step++) {
        controller.update(step * 0.033, step * 8 * DEG2RAD, 0, true);
    }

    assert.equal(controller.weight, 0);
    assert.equal(controller.strokePoseWeight, 1);
});

test('a network-style angular-velocity correction can retrigger the visual reaction', () => {
    const controller = new CollisionRagdollController();
    controller.update(0, 0, 0, true);
    controller.update(0.1, 180 * DEG2RAD, -120 * DEG2RAD, true);

    assert.ok(controller.weight > 0);
    assert.ok(controller.leftElbowBend > 0);
    assert.ok(controller.rightElbowBend > 0);
});

test('explicit-event mode does not double-trigger from a later pitch correction', () => {
    const controller = new CollisionRagdollController();
    controller.setSnapshotRetriggerEnabled(false);
    controller.update(0, 0, 0, true);
    controller.update(0.1, 180 * DEG2RAD, -120 * DEG2RAD, true);

    assert.equal(controller.weight, 0);
    assert.equal(controller.strokePoseWeight, 1);
});

test('an axial-only network correction does not mistake a normal stroke for collision', () => {
    const controller = new CollisionRagdollController();
    controller.update(0, 0, 0, true);
    controller.update(0.1, 220 * DEG2RAD, 0, true);

    assert.equal(controller.weight, 0);
    assert.equal(controller.strokePoseWeight, 1);
});

test('a disallowed pose damps the reaction instead of snapping it off', () => {
    const controller = new CollisionRagdollController();
    controller.trigger(0, 3.2, 220 * DEG2RAD, 180 * DEG2RAD);
    controller.update(0.05, 180 * DEG2RAD, 140 * DEG2RAD, true);
    const activeWeight = controller.weight;
    assert.ok(activeWeight > 0);

    controller.update(0.25, 0, 0, false);
    assert.ok(controller.weight > 0);
    assert.ok(controller.weight < activeWeight);

    controller.update(5, 0, 0, false);
    assert.equal(controller.weight, 0);
    assert.equal(controller.strokePoseWeight, 1);
});

test('a long off-screen update gap cannot revive an expired reaction', () => {
    const controller = new CollisionRagdollController();
    controller.trigger(0, 3.2, 220 * DEG2RAD, 180 * DEG2RAD);
    controller.update(0.05, 180 * DEG2RAD, 140 * DEG2RAD, true);
    assert.ok(controller.weight > 0);

    // No calls while culled; the next visible sample carries the real absolute time.
    controller.update(5, 0, 0, true);
    assert.ok(controller.weight < 0.001);
    assert.equal(controller.leftElbowBend, 0);
    assert.equal(controller.rightKneeBend, 0);
});

test('reaction eventually decays fully after angular motion stops', () => {
    const controller = new CollisionRagdollController();
    controller.trigger(0, 3.2, 220 * DEG2RAD, 180 * DEG2RAD);
    controller.update(0.05, 180 * DEG2RAD, 140 * DEG2RAD, true);

    for (let step = 1; step <= 80; step++) {
        controller.update(0.05 + step * 0.05, 0, 0, true);
    }
    assert.ok(controller.weight < 0.01);
});

test('persistent root tumbling no longer holds the loose limbs indefinitely', () => {
    const controller = new CollisionRagdollController();
    controller.trigger(0, 3.2, 220 * DEG2RAD, 180 * DEG2RAD);
    controller.update(0.05, 420 * DEG2RAD, 320 * DEG2RAD, true);
    assert.ok(controller.weight > 0.4);

    for (let step = 1; step <= 50; step++) {
        controller.update(0.05 + step * 0.05, 420 * DEG2RAD, 320 * DEG2RAD, true);
    }
    assert.ok(controller.weight < 0.01);
    assert.equal(controller.strokePoseWeight, 1);
});

test('loose limbs are forced back to the authored pose by the absolute deadline', () => {
    const controller = new CollisionRagdollController();
    controller.trigger(0, 3.2, 220 * DEG2RAD, 180 * DEG2RAD);
    controller.update(0.05, 420 * DEG2RAD, 320 * DEG2RAD, true);
    assert.ok(controller.weight > 0);

    controller.update(0.81, 420 * DEG2RAD, 320 * DEG2RAD, true);
    assert.equal(controller.weight, 0);
    assert.equal(controller.strokePoseWeight, 1);
});

test('a weak follow-up contact cannot revive an almost faded strong reaction', () => {
    const controller = new CollisionRagdollController();
    controller.trigger(0, 3.2, 220 * DEG2RAD, 180 * DEG2RAD);
    controller.update(0.05, 0, 0, true);
    for (let step = 1; step <= 19; step++) {
        controller.update(0.05 + step * 0.05, 0, 0, true);
    }
    const fadedWeight = controller.weight;
    assert.ok(fadedWeight < 0.1);

    controller.trigger(1, 0.16, 0, 0);
    controller.update(1.016, 0, 0, true);
    assert.ok(controller.weight < 0.1);

    const freshWeakReaction = new CollisionRagdollController();
    freshWeakReaction.trigger(0, 0.16, 0, 0);
    freshWeakReaction.update(0.016, 0, 0, true);
    assert.ok(Math.abs(controller.weight - freshWeakReaction.weight) < 0.001);
});

test('head guard keeps safe arm poses and attenuates only an inward candidate', () => {
    assert.equal(collisionRagdollHeadGuardWeight(0.5, 0.3, 1), 1);
    assert.equal(collisionRagdollHeadGuardWeight(0.2, 0.24, 1), 1);

    const guarded = collisionRagdollHeadGuardWeight(0.5, 0.1, 1);
    assert.ok(guarded > 0);
    assert.ok(guarded < 1);
    assert.equal(collisionRagdollHeadGuardWeight(0.2, 0.1, 1), 0);
});

test('anatomical hinge and spine helpers reject hyperextension and excessive flexion', () => {
    assert.equal(collisionRagdollHingeFlexionDegrees(8, 20, 35), 0);
    assert.equal(
        collisionRagdollHingeFlexionDegrees(90, -10, COLLISION_RAGDOLL_ELBOW_FLEX_LIMIT_DEGREES),
        35,
    );
    assert.equal(
        collisionRagdollHingeFlexionDegrees(90, -10, COLLISION_RAGDOLL_KNEE_FLEX_LIMIT_DEGREES),
        28,
    );
    assert.equal(collisionRagdollSpineFlexionDegrees(7), -7);
    assert.equal(collisionRagdollSpineFlexionDegrees(-90), -12);
});
