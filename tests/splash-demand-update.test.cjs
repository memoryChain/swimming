// 执行完整水花控制器；真实 Cocos 数学负责坐标变换，粒子桩记录出生参数和生命周期。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
const root = path.resolve(__dirname, '..');
const { Node: MathNode, Vec3, Quat } = createHarness();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function evaluate(text, globals = {}) {
    const module = { exports: {} };
    const source = ts.createSourceFile('subject.ts', text, ts.ScriptTarget.Latest, true);
    const code = source.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(source)).join('\n');
    vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText,
        { module, exports: module.exports, ...globals });
    return module.exports;
}
const TUNING = evaluate(read('assets/scripts/character/SplashEmitterTuning.ts')).SPLASH_EMITTER_TUNING;
const currentSource = read('assets/scripts/character/SplashEmitter.ts');
const counter = { writes: 0 };
class Node extends MathNode {
    constructor(name = '') { super(); this.name = name; this.active = true; }
    setParent(parent) { this.parent = parent; parent.children.push(this); }
    get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
    get worldPosition() { return this.getWorldPosition(new Vec3()); }
    setPosition(...args) { counter.writes++; super.setPosition(...args); }
    setWorldPosition(point) { counter.writes++; super.setWorldPosition(point); }
    setRotationFromEuler(...args) { counter.writes++; super.setRotationFromEuler(...args); }
}
function moduleFor(source = currentSource) {
    let seed = 43;
    const math = Object.create(Math); math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    return evaluate(source + '\nexport { WorldWakeEmitter' + (source.includes('class SplashBoneSamples')
        ? ', SplashBoneSamples, wakeSplashSystem, keepSplashSystemAwake, clearSplashSystem' : '') + ' };', {
        SPLASH_EMITTER_TUNING: TUNING, STROKE_QUALITY_TUNING: { armCycleSpeedStart: 0, armCycleSpeedFull: 5 },
        Vec3, Node, Math: math, CurveRange: { Mode: { Constant: 0, TwoConstants: 1 } },
    });
}
function setup(source) {
    const api = moduleFor(source), parent = new Node(), owner = new Node(); owner.setParent(parent);
    const pose = { LeftHand: new Vec3(1, .4, -1), RightHand: new Vec3(1, .4, 1),
        LeftFoot: new Vec3(-1, .1, -.3), RightFoot: new Vec3(-1, .1, .3), Body: new Vec3() };
    const reads = {}; const readBone = (name, out) => {
        reads[name] = (reads[name] || 0) + 1;
        if (name === 'FootFoam') {
            const right = new Vec3(); readBone('LeftFoot', out); readBone('RightFoot', right); Vec3.lerp(out, out, right, .5); return true;
        }
        if (!pose[name]) return false;
        out.set(pose[name]); return true;
    };
    const h = new api.SplashEmitter({ owner, parent, name: 'Splash', waterY: 0, getBoneWorldPosition: readBone });
    const births = [], systems = []; let frame = 0;
    function systemFor(node) {
        let enabled = true, playing = true; const particles = [];
        const system = { node, particles, plays: 0, pauses: 0, enableWrites: 0, shapeModule: {},
            startLifetime: {}, startSpeed: {}, gravityModifier: {}, startSizeX: {}, startSizeY: {}, startSizeZ: {}, startRotationZ: {},
            get enabled() { return enabled; }, set enabled(value) { enabled = value; this.enableWrites++; },
            get enabledInHierarchy() { return enabled && node.activeInHierarchy; },
            get isPlaying() { return playing; }, play() { playing = true; this.plays++; }, pause() { playing = false; this.pauses++; },
            getParticleCount() { return particles.length; },
            clear() { if (this.enabledInHierarchy) particles.length = 0; },
            processor: { clear() { particles.length = 0; } },
            emit(count, dt) {
                assert(this.enabledInHierarchy && playing, '发射前组件和根节点已唤醒');
                const position = node.worldPosition, rotation = node.getWorldRotation(new Quat());
                const fields = ['startLifetime', 'startSpeed', 'gravityModifier', 'startSizeX', 'startSizeY', 'startSizeZ', 'startRotationZ'];
                births.push({ frame, name: node.name, count, dt, position: [position.x, position.y, position.z],
                    rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
                    ranges: fields.map(key => ({ ...this[key] })), shape: { ...this.shapeModule } });
                for (let i = 0; i < count; i++) particles.push({ remaining: (this.startLifetime.constantMax || this.startLifetime.constant || .4) + dt,
                    position: position.clone() });
            },
            tick(dt) {
                if (!this.enabledInHierarchy || !playing) return;
                for (let i = particles.length - 1; i >= 0; i--) if ((particles[i].remaining -= dt) < 0) particles.splice(i, 1);
            },
        };
        systems.push(system); return system;
    }
    for (const role of ['hand', 'leg']) for (const side of ['left', 'right']) {
        const sign = side === 'left' ? -1 : 1, sideZ = TUNING.particleEmitters[`${side}${role === 'hand' ? 'Hand' : 'Leg'}Z`];
        for (const tuning of TUNING.particleEmitters[`${role}Cluster`]) {
            const node = new Node(`${side}-${role}-${tuning.visual}`); node.setParent(h.node);
            h._particleEmitters.push({ ...tuning, side, node, system: systemFor(node),
                basePosition: new Vec3(tuning.basePosition[0], tuning.basePosition[1], sideZ + tuning.basePosition[2] + sign * tuning.sideOffsetZ),
                palmOffset: new Vec3(tuning.palmOffset[0], tuning.palmOffset[1], sign * tuning.palmOffset[2]),
                lateralTilt: sign * tuning.lateralTilt, sprayTime: 0, sprayRate: 0, sprayCarry: 0, lastContact: 0, cooldown: 0, keepAlive: 0 });
        }
    }
    const state = { armAction: 0, kickAction: 0, armCycleMotion: 0, kickCycleMotion: 0, movementDirection: 1, movementHeadingRadians: 0,
        legSplashSuppressed: false, leftHandWaterContact: 0, rightHandWaterContact: 0, leftHandWaterEntry: 0, rightHandWaterEntry: 0,
        leftHandWaterProgress: 0, rightHandWaterProgress: 0 };
    h.setState(state);
    return { api, h, owner, pose, reads, births, systems, state,
        step(dt = 1 / 60, speed = 3) { frame++; h.decay(dt); h.update(speed); for (const system of systems) system.tick(dt); },
        addWake() {
            const node = new Node('Wake'); node.setParent(h.node); const system = systemFor(node); system.startLifetime.constantMax = 1.15;
            h._wake = Object.assign(Object.create(api.WorldWakeEmitter.prototype), { node, system, parent: h.node,
                ready: false, elapsed: 0, remaining: 0, reduced: false, point: new Vec3(), last: new Vec3() });
            return system;
        },
    };
}

test('无发射期间保留每次手掌检测，八个发射器零位置更新且只休眠一次', () => {
    const s = setup(); s.step(); counter.writes = 0;
    for (let i = 0; i < 120; i++) s.step();
    assert.equal(counter.writes, 0); assert.equal(s.births.length, 0);
    assert.equal(s.reads.LeftHand, 121); assert.equal(s.reads.RightHand, 121); assert.equal(s.reads.LeftFoot, undefined);
    for (const system of s.systems) { assert.equal(system.enabled, false); assert.equal(system.enableWrites, 1); assert.equal(system.pauses, 1); }
});

test('骨骼按调用复用，双脚中点复用足部采样，缺失骨骼与同帧姿态改变不会读到旧值', () => {
    const { SplashBoneSamples } = moduleFor(); let left = true, right = true, height = 1; const calls = {};
    const cache = new SplashBoneSamples((name, out) => {
        calls[name] = (calls[name] || 0) + 1;
        if ((name === 'LeftFoot' && !left) || (name === 'RightFoot' && !right)) return false;
        out.set(name === 'RightFoot' ? 4 : 2, height, 0); return true;
    });
    const out = new Vec3(); cache.begin(); cache.get('FootFoam', out); assert.equal(out.x, 3);
    cache.get('LeftFoot', out); cache.get('RightFoot', out); assert.equal(calls.LeftFoot, 1); assert.equal(calls.RightFoot, 1);
    cache.get('LeftHand', out); out.y = 99; cache.get('LeftHand', out); assert.equal(out.y, 1);
    height = 2; cache.begin(); cache.get('LeftHand', out); assert.equal(out.y, 2);
    left = false; cache.begin(); assert(cache.get('FootFoam', out)); assert.equal(out.x, 4);
    right = false; cache.begin(); assert.equal(cache.get('FootFoam', out), false);
    left = true; cache.begin(); assert(cache.get('FootFoam', out)); assert.equal(out.x, 2);
});

test('主角尾流与左右脚水片共用采样；下一次更新重新采样', () => {
    const s = setup(); s.addWake(); s.h.triggerKick(); s.step(.2);
    assert.equal(s.reads.LeftFoot, 1); assert.equal(s.reads.RightFoot, 1);
    assert(s.births.some(b => b.name === 'Wake')); assert(s.births.some(b => b.name.includes('leg')));
    s.pose.LeftFoot.x = 8; s.pose.RightFoot.x = 10; s.step(.2);
    assert.equal(s.reads.LeftFoot, 2); assert.equal(s.reads.RightFoot, 2);
    assert.equal(s.h._wake.last.x, 9);
});

test('尾流等待实际粒子消失再休眠；从新位置唤醒不重建系统', () => {
    const s = setup(), wake = s.addWake(); s.step(.2);
    assert(wake.enabled); const first = wake.particles[0].position.clone();
    s.owner.position.x = 5; s.step(.2, 0);
    assert(wake.enabled); assert(Vec3.distance(first, wake.particles[0].position) < 1e-9);
    for (let i = 0; i < 12; i++) s.step(.1, 0);
    assert.equal(wake.enabled, false);
    s.pose.LeftFoot.x = 7; s.pose.RightFoot.x = 9; s.step(.2);
    assert(wake.enabled); assert.equal(wake.particles[0].position.x, 8); assert.equal(s.systems.length, 9);
});

test('帧间事件更新发射器位置和转向时，已有波纹仍留在原水面', () => {
    const s = setup(); s.step();
    const node = new Node('RightHandRipple'); node.setParent(s.h.node);
    const part = { node, rippleTime: .4, frozenWorldPosition: new Vec3(3, .02, 1) };
    s.h._parts.push(part); s.h.keepHandRippleFrozen(part);
    s.owner.position.x = 10; s.state.movementDirection = -1; s.state.movementHeadingRadians = .35;
    s.h.triggerStrokeFeedback('left', true);
    assert(Vec3.distance(node.worldPosition, part.frozenWorldPosition) < 1e-8);
});

test('判定反馈、起跳、出水爆发均能唤醒；倒计时归零不能截断活粒子，隐藏重置清空残留', () => {
    for (const event of ['feedback', 'takeoff', 'big']) {
        const s = setup(); s.step(); s.owner.position.x = 7; s.pose.LeftHand.x = 9; s.pose.RightHand.x = 9;
        if (event === 'feedback') s.h.triggerStrokeFeedback('left', true);
        if (event === 'takeoff') s.h.triggerTakeoffSurfaceBurst();
        if (event === 'big') s.h.triggerBigSurfaceBurst();
        assert(s.births.length > 0, event); assert(s.h.node.active);
        for (const emitter of s.h._particleEmitters) emitter.keepAlive = 0;
        s.h.update(0); assert(s.h.node.active, '保留仍存活的水花');
        const live = s.systems.find(system => system.getParticleCount() > 0); assert(live.enabled);
        s.h.setVisible(false); s.h.reset();
        assert(s.systems.every(system => system.getParticleCount() === 0 && !system.enabled));
        s.h.triggerStrokeFeedback('left', false); assert(s.h.node.active); assert(s.systems.some(system => system.getParticleCount() > 0));
        s.h.setCulled(true); assert(s.systems.every(system => system.getParticleCount() === 0));
        const count = s.births.length; s.h.triggerStrokeFeedback('left', true); assert.equal(s.births.length, count);
        s.h.setCulled(false); s.h.setParticleEffectsEnabled(false); s.h.triggerStrokeFeedback('left', true); assert.equal(s.births.length, count);
        s.h.setParticleEffectsEnabled(true); s.h.triggerStrokeFeedback('right', true); assert(s.births.length > count);
    }
});

function sequence(source) {
    const s = setup(source); counter.writes = 0;
    for (let i = 0; i < 160; i++) {
        const direction = i < 80 ? 1 : -1; s.state.movementDirection = direction;
        s.state.movementHeadingRadians = i < 40 ? 0 : i < 110 ? .3 : -.2;
        s.owner.position.x += direction * .04;
        for (const [side, offset] of [['left', 0], ['right', 10]]) {
            const phase = (i + offset) % 20;
            s.pose[`${side === 'left' ? 'Left' : 'Right'}Hand`].set(s.owner.position.x + direction * (.6 + phase * .02), phase < 10 ? .4 : -.1, offset ? 1 : -1);
            s.state[`${side}HandWaterEntry`] = phase < 10 ? 0 : .8;
            s.state[`${side}HandWaterContact`] = phase < 10 ? 0 : 1;
            s.state[`${side}HandWaterProgress`] = phase / 20;
        }
        s.pose.LeftFoot.x = s.pose.RightFoot.x = s.owner.position.x - direction;
        s.step(i % 3 === 0 ? 1 / 30 : 1 / 60);
        if (i === 45) s.h.triggerStrokeFeedback('left', true);
        if (i === 65) s.h.triggerTakeoffSurfaceBurst();
    }
    return { births: JSON.parse(JSON.stringify(s.births)), writes: counter.writes, reads: Object.values(s.reads).reduce((n, count) => n + count, 0) };
}
if (process.env.SPLASH_BASELINE_FILE) test('固定动作和随机序列下，优化前后粒子出生时刻、数量、落点、方向和参数一致', () => {
    const before = sequence(fs.readFileSync(process.env.SPLASH_BASELINE_FILE, 'utf8')), after = sequence();
    assert.equal(after.births.length, before.births.length);
    const normalize = data => JSON.parse(JSON.stringify(data, (_, value) => typeof value === 'number' ? Math.round(value * 1e8) / 1e8 : value));
    assert.deepEqual(normalize(after.births), normalize(before.births));
    assert(after.writes < before.writes * .5); assert(after.reads < before.reads * .5);
    console.log(`水花离线轨迹对照：${after.births.length} 次发射一致，变换写入 ${before.writes} → ${after.writes}，骨骼读取 ${before.reads} → ${after.reads}`);
});
