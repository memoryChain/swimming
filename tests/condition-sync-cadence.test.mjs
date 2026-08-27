import test from 'node:test';
import assert from 'node:assert/strict';

import AiCondition from '../assets/scripts/condition/AiConditionModel.ts';
import ConditionTypes from '../assets/scripts/condition/ConditionTypes.ts';
import ConditionBalance from '../assets/scripts/core/ConditionBalance.ts';
import NetSimClock from '../assets/scripts/net/NetSimClock.ts';

const { AiConditionModel } = AiCondition;
const { RacePhase } = ConditionTypes;
const { CONDITION_BALANCE, energyDepletionCadenceScale } = ConditionBalance;
const { NET_SIM_STEP } = NetSimClock;

function near(actual, expected, epsilon = 1e-10) {
    assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

test('default exhaustion cadence curve is continuous and monotonic', () => {
    near(energyDepletionCadenceScale(1), 1);
    near(energyDepletionCadenceScale(0.15), 1);
    near(energyDepletionCadenceScale(0.10), 0.925);
    near(energyDepletionCadenceScale(0.05), 0.85);
    near(energyDepletionCadenceScale(0.025), 0.725);
    near(energyDepletionCadenceScale(0), 0.6);
    near(energyDepletionCadenceScale(-1), 0.6);
    near(energyDepletionCadenceScale(Number.NaN), 1);
});

test('collapsed and zero cadence thresholds have a defined continuous fallback', () => {
    const cadence = CONDITION_BALANCE.cadence;
    const saved = { ...cadence };
    try {
        cadence.warningRatio = 0.1;
        cadence.exhaustedRatio = 0.1;
        cadence.warningScale = 0.85;
        cadence.exhaustedScale = 0.6;
        near(energyDepletionCadenceScale(0.1), 1);
        near(energyDepletionCadenceScale(0.05), 0.8);
        near(energyDepletionCadenceScale(0), 0.6);

        cadence.exhaustedRatio = 0;
        near(energyDepletionCadenceScale(0.05), 0.8);
        near(energyDepletionCadenceScale(0), 0.6);

        cadence.warningRatio = 0;
        near(energyDepletionCadenceScale(0.01), 1);
        near(energyDepletionCadenceScale(0), 0.6);
    } finally {
        Object.assign(cadence, saved);
    }
});

test('authoritative AI cooldown transfers exact remaining time for host migration', () => {
    const model = new AiConditionModel();
    model.applyAuthoritativeState(0, 120, 0.125);
    near(model.depletionCooldownRemaining, 0.125);
    model.setPhase(RacePhase.PACE);
    model.tickAi({ difficulty: 0.7, progress: 0.5, dt: NET_SIM_STEP });
    near(model.depletionCooldownRemaining, 0.092);

    model.applyAuthoritativeState(0, 120, 0);
    near(model.depletionCooldownRemaining, 0);
    model.applyAuthoritativeState(0.2, 120, 0);
    near(model.depletionCooldownRemaining, 0);
});

function simulateAi(renderDt, renderFrames) {
    const model = new AiConditionModel();
    model.setPhase(RacePhase.PACE);
    let accumulator = 0;
    let steps = 0;
    for (let frame = 0; frame < renderFrames; frame++) {
        accumulator += renderDt;
        while (accumulator + 1e-12 >= NET_SIM_STEP) {
            accumulator -= NET_SIM_STEP;
            model.tickAi({ difficulty: 0.7, progress: 0.5, dt: NET_SIM_STEP });
            steps++;
        }
    }
    return { steps, energy: model.energy, heartRate: model.heartRate, cadence: model.strokeCadenceScale };
}

test('fixed-step AI condition is identical at 30/60/120 render fps', () => {
    const at30 = simulateAi(1 / 30, 99);
    const at60 = simulateAi(1 / 60, 198);
    const at120 = simulateAi(1 / 120, 396);
    assert.equal(at30.steps, 100);
    assert.deepEqual(at60, at30);
    assert.deepEqual(at120, at30);
});
