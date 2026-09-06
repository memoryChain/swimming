// 使用真实业务模块与本机 Cocos 数学实现；只替代资源加载和本地存储。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');

function setup() {
    const harness = createHarness({ 'cc/env': { NATIVE: false } });
    const saved = new Map();
    const project = JSON.parse(fs.readFileSync(path.join(harness.root, 'assets/resources/config/tuning.json'), 'utf8'));
    Object.assign(harness.cc, {
        JsonAsset: class {}, native: {},
        Color: class { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } },
        sys: { localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) } },
        resources: { load(_path, _type, callback) { callback(null, { json: project }); } },
    });
    const load = relative => harness.load(path.join(harness.root, 'assets/scripts', relative + '.ts'));
    const tuning = load('core/TuningDebugControls');
    const controls = new Map(tuning.TUNING_GROUPS.flatMap(group => group.controls.map(control => [control.id, control])));
    return { ...harness, loadModule: load, tuning, controls, project, saved };
}

test('项目配置加载后保留主干柔性参数，并采用满槽消耗与新侧墙数值', () => {
    const { tuning, controls, project } = setup();
    let completed = 0;
    tuning.loadSavedTuningAsync(() => completed++);
    assert.equal(completed, 1);
    for (const [id, value] of Object.entries(project.values)) {
        assert.ok(controls.has(id), `配置必须有对应控件：${id}`);
        assert.equal(controls.get(id).get(), value, `项目配置不应被意外改写：${id}`);
    }
    assert.equal(controls.get('ultimate.dolphinCost').get(), 100);
    assert.equal(controls.get('ultimate.maxEnergy').get(), 100);
    assert.equal(controls.get('steer.poolWallMaxTurnRate').get(), 48);
});

test('非法值被忽略、超界值受限，最新本地调参与旧参数迁移仍可加载', () => {
    const { tuning, controls, project, saved } = setup();
    project.values['speed.maxSpeed'] = '错误值';
    project.values['steer.maxHeading'] = 200;
    const originalSpeed = controls.get('speed.maxSpeed').get();
    tuning.loadSavedTuningAsync(() => {});
    assert.equal(controls.get('speed.maxSpeed').get(), originalSpeed);
    assert.ok(controls.get('steer.maxHeading').get() < 90);
    const result = tuning.saveCurrentTuning();
    assert.equal(result.ok, true);
    const [key, encoded] = [...saved.entries()][0];
    const local = JSON.parse(encoded);
    local.updatedAt = '2099-01-01T00:00:00.000Z';
    local.values['speed.maxSpeed'] = 4.1;
    local.values['ultimate.maxEnergy'] = 100;
    local.values['ultimate.dolphinCost'] = 30;
    saved.set(key, JSON.stringify(local));
    tuning.loadSavedTuningAsync(() => {});
    assert.equal(controls.get('speed.maxSpeed').get(), 4.1);
    assert.equal(controls.get('ultimate.dolphinCost').get(), 100);
});

test('海豚跳 30 点与 99 点不可释放，100 点可释放且清空；降低上限消除溢出', () => {
    const { loadModule, controls } = setup();
    const { UltimateEnergyModel } = loadModule('condition/UltimateEnergyModel');
    const energy = new UltimateEnergyModel();
    for (const value of [30, 99, 100]) {
        energy.applyNetEnergy(value, 1);
        assert.equal(energy.canAffordDolphin, value === 100);
    }
    energy.spendDolphin();
    assert.equal(energy.energy, 0);
    assert.equal(energy.canAffordDolphin, false);
    energy.applyNetEnergy(100, 1);
    controls.get('ultimate.maxEnergy').set(60);
    controls.get('ultimate.passivePerSecond').set(0);
    energy.tick(0);
    assert.equal(energy.energy, 60);
    assert.equal(controls.get('ultimate.dolphinCost').get(), 60);
    energy.spendDolphin();
    assert.equal(energy.energy, 0);
});

test('侧墙回正限速、左右对称并能在不同帧率下脱离，不影响随后玩家转向', () => {
    const { loadModule } = setup();
    const { SwimmerMotor } = loadModule('swimmer/SwimmerMotor');
    const { STEERING_TUNING } = loadModule('core/SteeringTuning');
    const radians = Math.PI / 180;
    for (const hz of [30, 60, 120]) for (const sign of [-1, 1]) {
        const motor = new SwimmerMotor();
        motor.correctHeading(-sign * 40 * radians, -sign * 90 * radians, 1);
        motor.returnToLaneFromPoolWall(sign);
        for (let step = 0; step < hz * 5; step++) {
            // 单独推进真实转向更新，不引入位移和划水输入。
            motor.updateSteering(1 / hz);
            assert.ok(Math.abs(motor.headingTurnRate) <= STEERING_TUNING.poolWallMaxTurnRate * radians + 1e-8);
            assert.ok(sign * motor.heading <= STEERING_TUNING.poolWallEscapeHeadingDegrees * radians + 1e-8);
        }
        assert.ok(Math.abs(motor.heading - sign * STEERING_TUNING.poolWallEscapeHeadingDegrees * radians) < 0.01);
        assert.equal(motor.headingTurnRate, 0);
        motor.correctHeading(-sign * 5 * radians, 0, 1);
        motor.updateSteering(1 / hz);
        assert.equal(motor.headingTurnRate, 0, '脱墙后回正弹簧必须停止');
    }
});
