// 执行实际水花构建、裁剪和姿态调度逻辑，不启动 Creator。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
const root = path.resolve(__dirname, '..');
function read(file) { return fs.readFileSync(path.join(root, 'assets/scripts', file), 'utf8'); }
function evaluate(source, globals = {}) {
    const module = { exports: {} };
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, ...globals });
    return module.exports;
}
function methods(file, className, names, globals = {}) {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
    const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === className);
    return evaluate(`export class Subject { ${names.map(name => cls.members.find(n => n.name?.getText(source) === name).getText(source)).join('\n')} }`, globals).Subject;
}
const TUNING = evaluate(read('character/SplashEmitterTuning.ts')).SPLASH_EMITTER_TUNING;
const PERFORMANCE_CONFIG = evaluate(read('core/PerformanceConfig.ts')).PERFORMANCE_CONFIG;
const splashSource = ts.createSourceFile('SplashEmitter.ts', read('character/SplashEmitter.ts'), ts.ScriptTarget.Latest, true);
const { clearSplashSystem } = evaluate('export ' + splashSource.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'clearSplashSystem').getText(splashSource));

test('本机主角创建尾流与波纹；AI、远端选手只创建简化手脚水花', () => {
    let wakes = 0;
    const Subject = methods('character/SplashEmitter.ts', 'SplashEmitter', ['build'], {
        TUNING, Material: class {}, Texture2D: class {}, RESOURCE_PATHS: {},
        _splashParticleTexture: null, _splashSprayTexture: null,
        loadRaceAsset: (_, __, callback) => callback(null, {}),
        WorldWakeEmitter: class { constructor() { wakes++; } },
    });
    for (const reduced of [false, true]) {
        const h = new Subject(), parts = [], hands = [], legs = [];
        Object.assign(h, { _reduced: reduced, _parts: [], node: { isValid: true },
            createPart: (_, part) => parts.push(part.name),
            createParticleEmitterCluster: name => hands.push(name),
            createLegParticleEmitter: name => legs.push(name),
            createBodyParticleEmitter: () => assert.fail('默认不创建躯干系统'), update() {},
        });
        const previous = wakes; h.build();
        assert.equal(wakes - previous, reduced ? 0 : 1);
        assert.equal(parts.length, reduced ? 0 : TUNING.foam.parts.filter(p => p.ripple).length + 1);
        assert.equal(hands.length, 2); assert.equal(legs.length, 2);
    }
});

test('裁剪清除残留、跳过骨骼采样，姿态切换不能重新激活水花', () => {
    const Subject = methods('character/SplashEmitter.ts', 'SplashEmitter',
        ['setCulled', 'setVisible', 'triggerArmStroke', 'triggerKick', 'triggerBurst', 'update'], { TUNING, clearSplashSystem });
    const h = new Subject(); let clears = 0, resets = 0;
    const reset = { reset() { resets++; } };
    const emitter = { cooldown: 1, keepAlive: 1, sprayTime: 1, sprayRate: 1, sprayCarry: 1,
        system: { enabledInHierarchy: true, clear() { clears++; } } };
    Object.assign(h, { _culled: false, node: { isValid: true, active: true },
        _parts: [{ rippleTime: 1, rippleScale: 3 }], _particleEmitters: [emitter],
        _leftHandImpact: reset, _rightHandImpact: reset, _wake: reset,
        _splashBurst: 3, _armSplashBurst: 2, _kickSplashBurst: 2, _kickParticleBurstPending: true,
    });
    h.setCulled(true);
    for (let i = 0; i < 120; i++) {
        h.setCulled(true); h.setVisible(true); h.triggerArmStroke(); h.triggerKick(); h.triggerBurst(); h.update(3);
    }
    assert.equal(h.node.active, false); assert.equal(clears, 1); assert.equal(resets, 3);
    for (const key of ['cooldown', 'keepAlive', 'sprayTime', 'sprayRate', 'sprayCarry']) assert.equal(emitter[key], 0);
    assert.equal(h._splashBurst, 0); assert.equal(h._armSplashBurst, 0); assert.equal(h._kickSplashBurst, 0);
    assert.equal(h._kickParticleBurstPending, false); assert.equal(h._parts[0].rippleTime, 0);
    h.setCulled(false); h.setVisible(true); assert.equal(h.node.active, true);
    assert.equal(h._armSplashBurst, 0, '重新靠近时没有积压爆发');
});

function rigSubject() {
    return methods('entity/CartoonSwimmerRig.ts', 'CartoonSwimmerRig',
        ['setSplashCulled', 'distantSplashCulled', 'setDistantSplashCulled', 'consumeThrottledMotionDt', 'updateSplashSurface'],
        { PERFORMANCE_CONFIG });
}
function rig() {
    const Subject = rigSubject(), h = new Subject();
    Object.assign(h, { _splashCulled: false, _distantSplashCulled: false, _motionThrottleStride: 1,
        _motionThrottleCountdown: 0, _motionThrottleAccumDt: 0, _pose: { resetCollisionSoftness() {} } });
    return h;
}
test('屏内远对手只停水花，继续姿态更新；离屏与距离两道开关互不覆盖', () => {
    const h = rig(), changes = [];
    h._splashEmitter = { setCulled: value => changes.push(value), update: () => assert.fail('裁剪时不更新水花') };
    h.syncSplashState = () => assert.fail('裁剪时不组装水花状态');
    h.setDistantSplashCulled(true); h.updateSplashSurface(3);
    assert.equal(h._splashCulled, false); assert.equal(h.consumeThrottledMotionDt(0.1), 0.1);
    h.setSplashCulled(true); h.setDistantSplashCulled(false); h.updateSplashSurface(3);
    assert.equal(changes.at(-1), true); assert.equal(h.consumeThrottledMotionDt(0.1), -1);
    h.setSplashCulled(false); assert.equal(changes.at(-1), false);
    assert.equal(h.consumeThrottledMotionDt(0.1), 0.1);
    const count = changes.length; h.setSplashCulled(false); h.setDistantSplashCulled(false);
    assert.equal(changes.length, count, '重复状态不写特效');
});

test('主角周围水平世界距离防抖，AI 与远端使用同一路径，关闭调试裁剪可恢复', () => {
    const { Vec3 } = createHarness(); let visible = true;
    const Subject = methods('core/GameManager.ts', 'GameManager', ['updateSplashCulling', 'toggleSplashCulling'], {
        PERFORMANCE_CONFIG, Camera: class {},
        geometry: { AABB: { set() {} }, intersect: { aabbFrustum: () => visible ? 1 : 0 } },
    });
    const h = new Subject();
    const opponent = () => {
        const value = rig();
        value.node = { isValid: true, position: new Vec3(), worldPosition: new Vec3(100, 0, 112) };
        value.setMotionThrottleStride = () => {};
        return value;
    };
    const ai = opponent(), remote = opponent();
    Object.assign(h, { _splashCullingEnabled: true, _aiSwimmers: [ai, remote, null],
        _playerSwimmer: { node: { isValid: true, position: new Vec3(), worldPosition: new Vec3(100, 5, 100) },
            setSplashCulled: () => assert.fail('主角不裁剪'), setDistantSplashCulled: () => assert.fail('主角不裁剪') },
        _cameraNode: { getComponent: () => ({ camera: { frustum: {} } }) },
        _tmpSplashCullCenter: new Vec3(), _splashCullAabb: {}, motionStrideForDistance: () => 2, debug() {},
    });
    h.updateSplashCulling(); assert(ai.distantSplashCulled); assert(remote.distantSplashCulled);
    ai.node.worldPosition.z = 109; h.updateSplashCulling(); assert(ai.distantSplashCulled);
    ai.node.worldPosition.z = 108; h.updateSplashCulling(); assert.equal(ai.distantSplashCulled, false);
    ai.node.worldPosition.z = 109; h.updateSplashCulling(); assert.equal(ai.distantSplashCulled, false);
    ai.node.worldPosition.z = 110; h.updateSplashCulling(); assert(ai.distantSplashCulled);
    assert.equal(ai._splashCulled, false, '屏内远处动作继续');
    visible = false; ai.node.worldPosition.z = 100; h.updateSplashCulling();
    assert.equal(ai.distantSplashCulled, false); assert(ai._splashCulled, '靠近但离屏时仍按原规则裁剪');
    h.toggleSplashCulling();
    for (const value of [ai, remote]) { assert.equal(value.distantSplashCulled, false); assert.equal(value._splashCulled, false); }
    h._cameraNode = null; h._splashCullingEnabled = true; ai.node.worldPosition.x = 112;
    h.updateSplashCulling(); assert(ai._splashCulled); assert(ai.distantSplashCulled);
});
