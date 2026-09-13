import test from 'node:test';
import assert from 'node:assert/strict';

import PlayerCondition from '../assets/scripts/condition/PlayerConditionModel.ts';
import AiCondition from '../assets/scripts/condition/AiConditionModel.ts';
import ConditionTypes from '../assets/scripts/condition/ConditionTypes.ts';
import ConditionBalance from '../assets/scripts/core/ConditionBalance.ts';
import NetSimClock from '../assets/scripts/net/NetSimClock.ts';

const { AiConditionModel } = AiCondition;
const { PlayerConditionModel } = PlayerCondition;
const { RacePhase } = ConditionTypes;
const { CONDITION_BALANCE, conditionEfficiencyScale, conditionQualityScale, energyDepletionCadenceScale } = ConditionBalance;
const { NET_SIM_STEP } = NetSimClock;

function near(actual, expected, epsilon = 1e-10) {
    assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

test('体力仅在归零后减弱推进和动作轮速，不额外缩窄心率窗口', () => {
    for (const ratio of [1, .15, .05, .001, .000001]) {
        near(conditionEfficiencyScale(ratio), 1);
        near(energyDepletionCadenceScale(ratio), 1);
    }
    near(conditionEfficiencyScale(0), .15);
    near(energyDepletionCadenceScale(0), .6);
    for (const hr of [0, 109, 110, 149, 150, 175, 200]) near(conditionQualityScale(hr), 1);
});

test('玩家每划固定扣除，心率、判定、间隔和冲刺阶段都不改变成本', () => {
    for (const phase of [RacePhase.PACE, RacePhase.SPRINT]) {
        const model = new PlayerConditionModel(); model.setPhase(phase);
        model.updateFromStroke({ strokeAccepted: false, qualityScore: 1, pressureScore: 1, dt: 0 });
        near(model.energy, 100);
        for (let i = 0; i < 30; i++) {
            model.applyDolphinJumpStrain(i % 2 ? 100 : 0);
            model.updateFromStroke({ strokeAccepted: true, qualityScore: [0, .5, 1][i % 3], pressureScore: i % 2, dt: 0 });
            model.tick(i % 2 ? .1 : 3);
            near(model.energy, 99 - i);
            near(model.efficiencyModifier, 1);
            near(model.strokeCadenceScale, 1);
        }
        model.tick(600); near(model.energy, 70);
    }
});

test('体力属性增加可消耗次数，耗尽后继续结算且不恢复，重新开局恢复满值', () => {
    const model = new PlayerConditionModel();
    model.setProgressionOverrides({ energyTotal: 120 });model.reset();
    for (let i = 0; i < 120; i++) {
        near(model.efficiencyModifier, 1);
        model.updateFromStroke({ strokeAccepted: true, qualityScore: 1, pressureScore: 1, dt: 0 });
    }
    near(model.energy, 0);near(model.efficiencyModifier, .15);
    model.tick(600);near(model.energy, 0);
    model.updateFromStroke({ strokeAccepted: true, qualityScore: 1, pressureScore: 1, dt: 0 });
    near(model.energy, 0);near(model.strokeCadenceScale, .6);
    model.reset();near(model.energy, 120);near(model.efficiencyModifier, 1);
});

test('AI 按结算次数扣除，权威耗尽状态在房主迁移后不恢复', () => {
    const model = new AiConditionModel();model.setPhase(RacePhase.SPRINT);
    model.tickAi({ difficulty: 1, progress: .9, dt: 60 });near(model.energy, 100);
    model.consumeStrokes(25);near(model.energy, 75);
    model.applyAuthoritativeState(.2, 120, .125);near(model.energy, 20);
    model.consumeStrokes(19);near(model.energy, 1);near(model.efficiencyModifier, 1);
    model.consumeStrokes(1);near(model.energy, 0);near(model.efficiencyModifier, .15);
    model.applyAuthoritativeState(0, 120, .125);
    model.tickAi({ difficulty: .7, progress: .5, dt: 60 });
    near(model.energy, 0);near(model.depletionCooldownRemaining, 0);
    model.reset();near(model.energy, 100);
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
            if (steps % 10 === 0) model.consumeStrokes(1);
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


test('小数每划消耗和权威比例还原不会留下额外满力次数', () => {
    const previous=CONDITION_BALANCE.energy.drainPerStroke;
    try {
        CONDITION_BALANCE.energy.drainPerStroke=.1;
        const model=new PlayerConditionModel();model.setProgressionOverrides({energyTotal:1});model.reset();
        for(let i=0;i<10;i++) model.updateFromStroke({strokeAccepted:true,qualityScore:1,pressureScore:1,dt:0});
        near(model.energy,0);near(model.efficiencyModifier,.15);
        CONDITION_BALANCE.energy.drainPerStroke=1;
        const ai=new AiConditionModel();ai.applyAuthoritativeState(.28,120);ai.consumeStrokes(28);
        near(ai.energy,0);near(ai.efficiencyModifier,.15);
    } finally { CONDITION_BALANCE.energy.drainPerStroke=previous; }
});
