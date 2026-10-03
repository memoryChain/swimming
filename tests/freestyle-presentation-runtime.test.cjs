// 执行正式接线、权威门控与姿态调度；渲染外壳只记录调用。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
const { createAiHarness } = require('./helpers/ai-race-harness.cjs');
const { createRig } = require('./helpers/character-contact-harness.cjs');
const h = createHarness();
const { FreestyleBodyRollMotion } = h.load(path.join(h.root, 'assets/scripts/character/FreestyleBodyRollMotion.ts'));
const { CHARACTER_POSE_TUNING, FREESTYLE_POSE_TUNING } = h.load(path.join(h.root, 'assets/scripts/character/CharacterMotionTuning.ts'));
const { PERFORMANCE_CONFIG } = h.load(path.join(h.root, 'assets/scripts/core/PerformanceConfig.ts'));
function methods(file, className, names, globals = {}) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(h.root, file), 'utf8'), ts.ScriptTarget.Latest, true);
    const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === className);
    const module = { exports: {} };
    const code = `export class Subject { ${names.map(name => {
        const member = cls.members.find(n => n.name?.getText(source) === name);
        assert.ok(member, name); return member.getText(source);
    }).join('\n')} }`;
    vm.runInNewContext(ts.transpileModule(code, { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
    } }).outputText, { module, exports: module.exports, ...globals });
    return module.exports.Subject;
}
const Rig = methods('assets/scripts/entity/CartoonSwimmerRig.ts', 'CartoonSwimmerRig', [
    'consumeThrottledMotionDt', 'updateFreestyleFromMotor', 'updateFreestyle', 'updateTreadWaterBlend',
    'updateVisualArmCycles', 'setTreadWaterSpeedOverride', 'updateUnderwaterKickFromMotor',
    'setDiveStreamlinePose', 'startDiveStreamlineTransition', 'setFinishFloating',
], { FreestyleBodyRollMotion, FREESTYLE_POSE_TUNING, CHARACTER_POSE_TUNING, PERFORMANCE_CONFIG,
    positiveMod: (a, b) => ((a % b) + b) % b, VISUAL_BODY_UP_HYSTERESIS: .15,
    isArmCycleBoundary: cycle => Math.min(((cycle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI),
        2 * Math.PI - ((cycle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) < .0001,
});
function rig() {
    const r = new Rig(), draws = [];
    const pose = { weight: -1, resets: 0,
        setFreestylePresentation(weight, roll = 0, left = 0, right = 0) { Object.assign(this, { weight, roll, left, right }); },
        setMovementHeadingRadians(value) { this.heading = value; }, setMovementPitchRadians(value) { this.pitch = value; },
        setMovementDirection() {}, setSurfaceBodyUpProjection(value) { this.up = value; },
        resetCollisionSoftness() { this.resets++; }, applyCollisionSoftness() {},
        applyFreestyleTreadBlendPose(...args) { draws.push({ weight: this.weight, roll: this.roll, left: this.left, right: this.right, tread: args.at(-1) }); },
        handWaterContact() { return 0; }, handWaterEntry() { return 0; }, handWaterProgress() { return 0; },
    };
    Object.assign(r, { _pose: pose, draws, _splashEmitter: null, _modelDebugMode: false, _freestyleBodyRoll: null, _loaded: true, root: {},
        _poseState: { isFreestyleActive: true, enterGlide() {}, enterDiveFlight() {}, enterTreadWater() {} },
        _splashCulled: false, _motionThrottleStride: 1, _motionThrottleAccumDt: 0, _motionThrottleCountdown: 0,
        _treadWaterWeight: 0, _treadWaterPhase: 0, _treadExitHold: 0, _treadSpeedOverride: -1,
        _hasVisualArmCycles: false, _visualArmCycleDirection: 1, _visualLeftArmCycle: 0, _visualRightArmCycle: 0,
        _armAction: 0, _kickAction: 0, _animationPlayer: { stop() {} },
        updateArmCycleMotion() {}, updateKickCycleMotion() {}, updateSplashSurface() {},
        applyTreadBlendModelPlacement() {}, visualHandWaterEntry(_, value) { return value; },
        motionPreviewSpeedScale() { return 1; }, clearCollisionPitchPivotCompensation() {},
    });
    return r;
}
function motor() { return { leftArmCycle: 0, rightArmCycle: 0, leftKickCycle: 0, rightKickCycle: Math.PI,
    bodyPhase: 0, currentSpeed: 2, heading: .3, collisionPitchRadians: 0, axialRollRadians: 0,
    axialRollAngularVelocity: 0, collisionPitchAngularVelocity: 0, permitsUprightTreadWater: true, collisionSoftness: {} }; }
function swim(r, m, count = 120, allowed = true, enabled = true) {
    for (let i = 0; i < count; i++) {
        m.leftArmCycle += 2 * Math.PI / 60;
        m.rightArmCycle = m.leftArmCycle + Math.PI;
        r.updateFreestyleFromMotor(1 / 60, m, 1, m.collisionPitchRadians, m.heading,
            Math.cos(m.axialRollRadians) * Math.cos(m.collisionPitchRadians), allowed, enabled);
    }
}
test('正式接线使用真实相位，玩家与AI降频都能抬肘，取消后回到原姿态', () => {
    for (const stride of [1, 2, 3]) {
        const r = rig(), m = motor(); r._motionThrottleStride = stride; swim(r, m);
        assert.ok(r.draws.some(d => d.left > .9 && d.right > .9));
        assert.ok(r.draws.some(d => Math.abs(d.roll * d.weight) > .5));
        assert.equal(r._pose.weight, -1, '每次姿态采样后清除临时显示配置');
        const instance = r._freestyleBodyRoll; swim(r, m, 180);
        assert.equal(r._freestyleBodyRoll, instance, '整局复用同一状态对象');
        swim(r, m, 180, true, false); assert.equal(instance.weight, 0);
        assert.equal(r.draws.at(-1).weight, -1);
    }
});
test('离屏裁剪在新动作计算之前返回，既不采样也不创建状态', () => {
    const r = rig(), m = motor(); r._splashCulled = true; swim(r, m, 120);
    assert.equal(r.draws.length, 0); assert.equal(r._freestyleBodyRoll, null);
    r._splashCulled = false; swim(r, m); assert.ok(r.draws.length > 0);
});
test('远端门控沿用权威速度与转体俯仰，独立本地速度不能留下新转体', () => {
    const r = rig(), m = motor(); r.setTreadWaterSpeedOverride(2); m.currentSpeed = 0;
    swim(r, m); assert.equal(r._treadWaterWeight, 0); assert.ok(r._freestyleBodyRoll.leftRecovery > .9);
    r.setTreadWaterSpeedOverride(0); m.currentSpeed = 2; swim(r, m, 180);
    assert.equal(r._treadWaterWeight, 1); assert.equal(r._freestyleBodyRoll.weight, 0);
    r.setTreadWaterSpeedOverride(2); m.axialRollRadians = Math.PI; m.axialRollAngularVelocity = 4;
    m.collisionPitchRadians = Math.PI / 2; swim(r, m, 180);
    assert.equal(r._freestyleBodyRoll.weight, 0); assert.equal(r._freestyleBodyRoll.leftRecovery, 0);
    assert.equal(r._pose.pitch, Math.PI / 2); assert.equal(r._pose.heading, m.heading);
});
test('水下、跳水、出墙滑行和完赛接管清空动作平滑状态', () => {
    for (const transition of ['setDiveStreamlinePose', 'startDiveStreamlineTransition', 'setFinishFloating', 'updateUnderwaterKickFromMotor']) {
        const r = rig(), m = motor(); swim(r, m); assert.ok(r._freestyleBodyRoll.weight > .9);
        if (transition === 'updateUnderwaterKickFromMotor') r[transition](1 / 60, m);
        else r[transition]();
        assert.equal(r._freestyleBodyRoll.weight, 0); assert.equal(r._freestyleBodyRoll.leftRecovery, 0);
    }
    const r = rig(), m = motor(); swim(r, m); swim(r, m, 180, false);
    assert.equal(r._freestyleBodyRoll.weight, 0); assert.equal(r._freestyleBodyRoll.rightRecovery, 0);
});
test('实体将特殊阶段和潜水能力排除，启用表现不改变玩法结果', () => {
    const a = createAiHarness(), { Swimmer } = a.load('entity/Swimmer');
    const run = enabled => {
        a.load('core/SharedRNG').reseedSharedRandom(20261003);
        const scene = a.create('cartonSwimmer6', 1, 1), body = scene.body, r = rig();
        r.axialRollVisualWeight = 1; r.setLegSplashSuppressed = () => {};
        const originalRig = body.cartoonRig;
        body.cartoonRig = new Proxy(r, { get: (target, key) => key in target ? target[key] : originalRig[key] }); body.updateBodyMotion = Swimmer.prototype.updateBodyMotion;
        body.enableFreestylePresentation(enabled);
        for (let i = 0; i < 600; i++) scene.step(1 / 60);
        return { distance: body.distance, speed: body.currentSpeed, energy: scene.condition.energyRatio,
            heartRate: body.heartRate, left: body.motor.leftArmCycle, right: body.motor.rightArmCycle,
            rotation: [body.node.rotation.x, body.node.rotation.y, body.node.rotation.z, body.node.rotation.w],
            newPose: r.draws.some(d => d.left > .9) };
    };
    const off = run(false), on = run(true); assert.equal(off.newPose, false); assert.equal(on.newPose, true);
    delete off.newPose; delete on.newPose; assert.deepEqual(on, off);
    const Body = methods('assets/scripts/entity/Swimmer.ts', 'Swimmer', ['updateBodyMotion'], { StrokeType: a.load('core/GameConstants').StrokeType });
    for (const key of ['isUnderwater', 'isDiveGlidePoseActive', 'isFlipTurnActive', 'isDolphinJumpActive', 'depth']) {
        const b = new Body(); let args;
        Object.assign(b, { _freestylePresentationEnabled: true, raceDirection: 1,
            _motor: { isRacing: true, collisionPitchRadians: 0, axialRollRadians: 0, heading: 0, ability: { depth: key === 'depth' ? .2 : 0 }, isActiveStrokeHeld() { return true; } },
            _phases: { diveRecoveryLean() { return 0; }, dolphinRollResidualRadians() { return 0; }, canUseArmStroke: true, [key]: true },
            cartoonRig: { axialRollVisualWeight: 1, setLegSplashSuppressed() {}, updateFreestyleFromMotor(...value) { args = value; } } });
        b.updateBodyMotion(1 / 60); assert.equal(args[6], false, key);
    }
});
test('全周期转体与高肘求解复用临时向量和四元数', () => {
    const counted = createHarness(); let allocations = 0;
    for (const name of ['Vec3', 'Quat']) {
        const Original = counted.cc[name];
        counted.cc[name] = class extends Original { constructor(...args) { super(...args); allocations++; } };
    }
    const { FreestylePoseController } = counted.load(path.join(h.root, 'assets/scripts/character/FreestylePoseController.ts'));
    const r = createRig('CartonSwimmer16.glb'); r.wrapper.setRotationFromEuler(90, 90, 0);
    const p = new FreestylePoseController(); p.bind(r.pose.root); p.captureBasePose(); p.setDiveHandContact(r.hands);
    const before = allocations;
    for (let i = 0; i < 480; i++) {
        const cycle = i / 480 * Math.PI * 2; p.setFreestylePresentation(1, Math.sin(cycle), 1, 1);
        p.applyFreestylePose(cycle, cycle + Math.PI, cycle * 3, cycle * 3 + Math.PI, cycle, 1, 1, 1);
    }
    assert.equal(allocations, before, '完整姿态求解不得新建 Vec3／Quat');
});
