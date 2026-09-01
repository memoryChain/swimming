import test from 'node:test';
import assert from 'node:assert/strict';

import CollisionPitchModule from '../assets/scripts/swimmer/CollisionPitchModel.ts';
import CollisionPitchTuningModule from '../assets/scripts/core/CollisionPitchTuning.ts';

const { CollisionPitchModel } = CollisionPitchModule;
const { COLLISION_PITCH_TUNING } = CollisionPitchTuningModule;

const DEG2RAD = Math.PI / 180;

function withRuntimePitchTuning(run) {
    const saved = { ...COLLISION_PITCH_TUNING };
    Object.assign(COLLISION_PITCH_TUNING, {
        enabled: 1,
        rightingTorque: 90,
        angularDrag: 1.1,
        maxAngularSpeed: 420,
        invertedEscapeStartDegrees: 150,
        invertedEscapeMaxAngularSpeed: 45,
        invertedEscapeTorque: 70,
    });
    try {
        run();
    } finally {
        Object.assign(COLLISION_PITCH_TUNING, saved);
    }
}

test('both representations of exact inversion leave through the same deterministic direction', () => {
    withRuntimePitchTuning(() => {
        for (const angle of [Math.PI, -Math.PI, Math.PI - 0.001, -Math.PI + 0.001]) {
            const model = new CollisionPitchModel();
            model.correct(angle, 0, 1);
            model.update(1 / 30, true);
            assert.ok(model.angularVelocityRadians > 0);
        }
    });
});

test('a stationary inverted swimmer returns to the normal surface pose', () => {
    withRuntimePitchTuning(() => {
        const model = new CollisionPitchModel();
        model.correct(Math.PI, 0, 1);
        let recoveredAt = -1;
        for (let step = 1; step <= 600; step++) {
            model.update(1 / 30, true);
            if (recoveredAt < 0 && model.permitsUprightTreadWater) {
                recoveredAt = step / 30;
            }
        }
        assert.ok(recoveredAt > 0);
        assert.ok(recoveredAt < 5);
        assert.ok(Math.abs(model.angleRadians) < 0.1);
    });
});

test('inverted escape does not inject extra motion while underwater or already tumbling fast', () => {
    withRuntimePitchTuning(() => {
        const underwater = new CollisionPitchModel();
        underwater.correct(Math.PI, 0, 1);
        underwater.update(1 / 30, false);
        assert.equal(underwater.angularVelocityRadians, 0);

        const fast = new CollisionPitchModel();
        fast.correct(Math.PI, 120 * DEG2RAD, 1);
        fast.update(1 / 30, true);
        assert.ok(fast.angularVelocityRadians < 120 * DEG2RAD);
        assert.ok(Math.abs(fast.angularVelocityRadians) <= 420 * DEG2RAD);
    });
});
