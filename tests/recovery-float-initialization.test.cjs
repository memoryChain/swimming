// 验证 Creator 使用的 Babel 字段初始化语义；tsc 的降级顺序不能代替这一检查。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');

test('Creator Babel 编译后先保存构造参数，再创建扶圈动作，准备页角色可正常实例化', () => {
    const h = createHarness();
    const config = JSON.parse(fs.readFileSync(path.join(h.root, 'temp/tsconfig.cocos.json'), 'utf8'));
    const engine = process.env.COCOS_ENGINE_ROOT || path.resolve(config.compilerOptions.paths['db://internal/*'][0], '../../..');
    const babelModule = name => require(path.join(engine, 'node_modules/@babel', name));
    const file = path.join(h.root, 'assets/scripts/character/CharacterPoseStateController.ts');
    const { code } = babelModule('core').transformSync(fs.readFileSync(file, 'utf8'), {
        filename: file, babelrc: false, configFile: false,
        plugins: [babelModule('plugin-transform-typescript'),
            [babelModule('plugin-transform-class-properties'), { loose: true }],
            babelModule('plugin-transform-modules-commonjs')],
    });
    const mod = { exports: {} };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
        id => id === 'cc' ? h.cc : h.load(path.resolve(path.dirname(file), id + '.ts')), mod, mod.exports);
    const pose = { setDiveSupportPlane() {} };
    const options = { pose, getModel: () => null, getRoot: () => null, getSelfTime: () => 0,
        updateSplashSurface() {}, setSplashVisible() {}, modelScale: () => 1,
        raceModelYOffset: () => 0, raceModelEulerDegrees: () => [90, 90, 0] };
    for (let i = 0; i < 8; i++) {
        const controller = new mod.exports.CharacterPoseStateController(options);
        assert.equal(controller.state, mod.exports.CharacterPoseState.Preview);
        assert.equal(controller._recoverySequence.pose, pose, '浮圈序列应收到本角色姿态对象');
    }
});
