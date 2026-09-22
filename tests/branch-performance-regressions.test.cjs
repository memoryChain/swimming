const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

class Vector {
    constructor(x = 0, y = 0, z = 0, w = 0) { this.set(x, y, z, w); }
    set(x, y, z, w) { Object.assign(this, { x, y, z, w }); return this; }
    static transformQuat(out, value) { out.set(value.x, value.y, value.z); }
    static scaleAndAdd(out, a, b, scale) { out.set(a.x + b.x * scale, a.y + b.y * scale, a.z + b.z * scale); }
}
Vector.FORWARD = new Vector(0, 0, -1);
Vector.UP = new Vector(0, 1, 0);
class Color { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } }
Color.WHITE = new Color(255, 255, 255, 255);
class Material {
    isValid = true; properties = new Map(); writes = 0;
    passes = [{ getHandle: () => 1 }];
    initialize() {}
    setProperty(key, value) {
        this.properties.set(key, value);
        if (key === 'reflectClipParams') {
            this.writes++;
            this.reflectUniform = [value.x, value.y, value.z, value.w];
        }
    }
    getProperty(key) { return this.properties.get(key); }
    destroy() { this.isValid = false; }
}
class Mesh { isValid = true; destroy() { this.isValid = false; } }
class Renderer { setMaterial(material) { this.material = material; } }
class Texture {}
class Node {
    isValid = true; active = true; layer = 0; children = []; components = []; position = new Vector();
    constructor(name = '') { this.name = name; }
    setParent(parent) { this.parent = parent; parent.children.push(this); }
    setWorldPosition(x, y, z) { this.position.set(x, y, z); }
    setPosition() {} setScale() {} setRotationFromEuler() {}
    addComponent(Type) { const value = new Type(); this.components.push(value); return value; }
    getComponent(Type) { return this.components.find(value => value instanceof Type); }
    destroy() { this.isValid = false; this.active = false; }
}
function evaluate(source, globals = {}) {
    const module = { exports: {} };
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, ...globals });
    return module.exports;
}
function harness() {
    const cache = new Map(), callbacks = [];
    const counters = { instances: 0 };
    const cc = { Color, Material, Mesh, Node, MeshRenderer: Renderer, SkinnedMeshRenderer: Renderer,
        Texture2D: Texture, Vec3: Vector, Vec4: Vector, Quat: Vector, Prefab: class {},
        gfx: { CullMode: { NONE: 0 }, PrimitiveMode: { TRIANGLE_LIST: 0 } },
        utils: { createMesh: () => new Mesh() }, primitives: { box: () => ({}) },
        instantiate(prefab) { counters.instances++; const node = new Node(); if (prefab.valid) node.addComponent(Renderer); return node; },
    };
    function load(relative) {
        const file = path.resolve(root, relative);
        if (cache.has(file)) return cache.get(file);
        const result = evaluate(fs.readFileSync(file, 'utf8'), { require(id) {
            if (id === 'cc') return cc;
            if (id.endsWith('/RaceBundleLoader')) return { loadRaceAsset: (name, type, callback) => callbacks.push({ name, callback }) };
            return load(path.resolve(path.dirname(file), id + '.ts'));
        } });
        cache.set(file, result); return result;
    }
    return { load, callbacks, counters, cc };
}
function method(file, className, name, globals) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
    const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === className);
    const member = cls.members.find(n => name === 'constructor' ? ts.isConstructorDeclaration(n) : n.name?.getText(source) === name);
    return evaluate(`export class Fixture { ${member.getText(source)} }`, globals).Fixture;
}

function bindBodyInstance(tuning, shared, instance) {
    const Fixture = method('assets/scripts/entity/CartoonSwimmerRig.ts', 'CartoonSwimmerRig', 'bindDiveChargeBodyMaterials', {
        bindSwimmerBodyMaterialInstance: tuning.bindSwimmerBodyMaterialInstance,
        DIVE_CHARGE_BLUE: Color.WHITE, DIVE_CHARGE_YELLOW: Color.WHITE, DIVE_CHARGE_RED: Color.WHITE,
        console: { log() {} },
    });
    shared.passes = [{ getHandle: () => 1 }];
    const rig = new Fixture();
    rig._diveChargeBodyMaterials = [];
    rig._skinnedRenderers = [{ isValid: true, node: new Node(), sharedMaterials: [shared],
        getSharedMaterial: () => shared, getMaterialInstance: () => instance }];
    rig.bindDiveChargeBodyMaterials();
    return rig;
}

test('发光绑定实际材质后立即同步反射，镜头移动只写实际实例且清理不重复销毁', () => {
    const tuning = harness().load('assets/scripts/venue/WaterColorTuning.ts');
    const owner = new Node(), shared = new Material(), instance = new Material();
    tuning.registerSwimmerBodyMaterial(shared, owner);
    instance.setProperty('reflectClipParams', new Vector());
    tuning.setSwimmerReflectClip(true, new Vector(3, 1, 0));
    bindBodyInstance(tuning, shared, instance);
    assert.deepEqual(instance.reflectUniform, [1, 3, 1, 0], '静止镜头下绑定也立即更新独立 uniform');
    const parentWrites = shared.writes, instanceWrites = instance.writes;
    tuning.setSwimmerReflectClip(true, new Vector(4, 1, 0));
    assert.deepEqual(instance.reflectUniform, [1, 4, 1, 0]);
    assert.equal(shared.writes, parentWrites);
    assert.equal(instance.writes, instanceWrites + 1);
    tuning.setSwimmerReflectClip(false);
    assert.deepEqual(instance.reflectUniform, [0, 0, 0, 0]);
    tuning.disposeSwimmerBodyMaterials(owner);
    const after = instance.writes;
    tuning.setSwimmerReflectClip(true, new Vector(5, 1, 0));
    assert.equal(instance.writes, after);
    assert(!shared.isValid);
    assert(instance.isValid, '实例由渲染器管理，不在父材质清理时重复销毁');
});

test('实例替换和水色调参保持反射与发光状态，无水预览始终禁用裁切', () => {
    const tuning = harness().load('assets/scripts/venue/WaterColorTuning.ts');
    const shared = new Material(), first = new Material(), next = new Material();
    tuning.registerSwimmerBodyMaterial(shared, new Node());
    bindBodyInstance(tuning, shared, first);
    tuning.setSwimmerReflectClip(true, new Vector(2, 1, 0));
    const firstWrites = first.writes;
    bindBodyInstance(tuning, shared, next);
    assert.deepEqual(next.reflectUniform, [1, 2, 1, 0]);
    const charge = new Vector(1, 2, 3, 4);
    next.setProperty('chargeParams', charge);
    const dry = new Material(), dryInstance = new Material();
    tuning.registerSwimmerBodyMaterial(dry, new Node(), false);
    bindBodyInstance(tuning, dry, dryInstance);
    tuning.WATER_COLOR_TUNING.bodyR = 12;
    tuning.applyWaterColorTuning();
    assert.equal(next.getProperty('underwaterColor').r, 12);
    assert.equal(next.getProperty('chargeParams'), charge);
    assert.deepEqual(dryInstance.reflectUniform, [0, 0, 0, 0]);
    const dryWrites = dryInstance.writes;
    tuning.setSwimmerReflectClip(true, new Vector(3, 1, 0));
    assert.equal(first.writes, firstWrites);
    assert.equal(dryInstance.writes, dryWrites);
    next.passes.length = 0;
    assert(next.isValid, '模拟 Cocos 实例直接清空 passes 而保留 isValid');
    tuning.setSwimmerReflectClip(false);
    assert.deepEqual(shared.reflectUniform, [0, 0, 0, 0], '实例失效后回到父材质');
});

test('连续换肤并触发发光后只更新当前实例，渲染器独立释放旧实例', () => {
    const h = harness(), tuning = h.load('assets/scripts/venue/WaterColorTuning.ts');
    const { applyCharacterSkin } = h.load('assets/scripts/character/CharacterSkinApplier.ts');
    const owner = new Node(), imported = new Material(), instances = [];
    imported.setProperty('mainTexture', new Texture());
    let shared = imported, instance = null;
    const renderer = { getSharedMaterial: i => i === 0 ? shared : null, setMaterial(value) {
        if (instance) instance.destroy();
        instance = null;
        shared = value;
    } };
    for (let i = 0; i < 20; i++) {
        applyCharacterSkin({ model: owner, root: owner, skinnedRenderers: [renderer], preserveOriginalMaterial: true,
            dynamicColorEffect: {}, dynamicColorMode: 'whiteKey', waterLine: 0, playerOutline: false,
            skinColor: Color.WHITE, suitColor: Color.WHITE, capColor: Color.WHITE, setOutlineRoot() {} });
        instance = new Material();
        let destroys = 0;
        instance.destroy = function () { assert.equal(++destroys, 1); this.isValid = false; };
        instances.push(instance);
        bindBodyInstance(tuning, shared, instance);
        const before = instances.reduce((sum, material) => sum + material.writes, 0);
        tuning.setSwimmerReflectClip(true, new Vector(i + 1, 1, 0));
        assert.equal(instances.reduce((sum, material) => sum + material.writes, 0), before + 1);
        assert.deepEqual(instance.reflectUniform, [1, i + 1, 1, 0]);
    }
    tuning.disposeSwimmerBodyMaterials(owner);
    assert(instance.isValid);
    instance.destroy();
    const before = instances.reduce((sum, material) => sum + material.writes, 0);
    tuning.setSwimmerReflectClip(false);
    assert.equal(instances.reduce((sum, material) => sum + material.writes, 0), before);
    assert(instances.every(material => !material.isValid));
    assert(imported.isValid);
});

function cannonFixture(entertainment) {
    const h = harness();
    const { CannonBrawlPresentation } = h.load('assets/scripts/core/CannonBrawlPresentation.ts');
    const course = { startX: 0, finishX: 50, poolWidth: 20, waterY: 0, swimPosition: (x, z) => ({ x, z }) };
    const Fixture = method('assets/scripts/core/GameManager.ts', 'GameManager', 'ensureCannonBrawlPresentation', {
        CannonBrawlPresentation, COURSE_LAYOUT: course, isEntertainmentBrawlMode: () => entertainment,
    });
    const manager = new Fixture();
    manager._worldRoot = new Node();
    manager.entertainmentWaterSplashes = () => null;
    const presentation = manager.ensureCannonBrawlPresentation();
    assert.equal(manager.ensureCannonBrawlPresentation(), presentation);
    return { presentation, parent: manager._worldRoot };
}

test('统一娱乐炮台预热与重置保持隐藏，预告入场、权威恢复和退出复用节点', () => {
    const { presentation: p, parent } = cannonFixture(true);
    const visible = () => parent.children.filter(node => node.active).length;
    assert.equal(visible(), 0);
    p.reset();
    p.update(0, null, 0, false);
    for (let i = 0; i < 600; i++) p.update(1 / 60, null, 0, true);
    assert.equal(visible(), 0);
    const count = parent.children.length;
    for (let round = 0; round < 20; round++) {
        p.beginEntrance();
        assert.equal(visible(), 2);
        for (let i = 0; i < 120; i++) p.update(1 / 60, null, 0, true);
        assert.equal(Math.abs(p.cannons[0].position.z), 11.4);
        p.beginExit();
        for (let i = 0; i < 90; i++) p.update(1 / 60, null, 0, true);
        assert.equal(visible(), 0);
        p.snapDeployed();
        assert.equal(visible(), 2);
        p.reset();
        assert.equal(visible(), 0);
        assert.equal(parent.children.length, count);
    }
    p.dispose();
    assert.equal(visible(), 0);
});

test('独立炮火模式仍默认就位，发射与重置保留两侧炮台', () => {
    const { presentation: p, parent } = cannonFixture(false);
    assert.equal(p.cannons.filter(node => node.active).length, 2);
    p.showLaunch({ strikeId: 0, targetDistance: 20, targetZ: 0 });
    assert.equal(parent.children.filter(node => node.active).length, 4);
    p.reset();
    assert.equal(parent.children.filter(node => node.active).length, 2);
    p.dispose();
});

function cannonRecoveryFixture(freshController = false) {
    const h = harness();
    const directorModule = h.load('assets/scripts/core/EntertainmentModeDirector.ts');
    const { EntertainmentModeDirector: Director, EntertainmentEventId: Event, EntertainmentDirectorPhase: Phase } = directorModule;
    const host = new Director(2, 400), guest = new Director(2, 400);
    const { presentation, parent } = cannonFixture(true);
    const globals = { ...directorModule, isEntertainmentBrawlMode: () => true,
        getSharedRandomSeed: () => 2, entertainmentBannerIcon: () => 'cannon',
        entertainmentActiveBannerCategory: () => '', isSuperWhirlpool: () => false,
        CannonBrawlController: h.load('assets/scripts/core/CannonBrawlController.ts').CannonBrawlController,
        LANE_LAYOUT: { laneCount: 1 }, COURSE_LAYOUT: { poolWidth: 20 }, getRaceDistance: () => 400,
        isCannonBrawlMode: () => directorModule.isEntertainmentEventResident(Event.CANNON) };
    const file = 'assets/scripts/core/GameManager.ts';
    const Handle = method(file, 'GameManager', 'handleEntertainmentDirectorTransition', globals);
    const Activate = method(file, 'GameManager', 'activateEntertainmentEvent', globals);
    const Setup = method(file, 'GameManager', 'setupCannonBrawl', globals);
    const manager = new Handle();
    let restarts = 0;
    Object.assign(manager, {
        _entertainmentDirector: guest, _cannonBrawlPresentation: presentation, _cannonPreviewPending: false,
        _cannonBrawl: freshController ? null : { restart() { restarts++; } }, _raceManager: {},
        _cannonBrawlHud: { reset() {}, hide() {} },
        _entertainmentEventBanner: { hideEvent() {}, showDirectorEvent() {} },
        entertainmentAnchorDistance: event => guest.anchorDistanceForEvent(event),
        entertainmentCannonStrikeTriggers: () => [],
        ensureCannonBrawlPresentation: () => presentation,
        setupCannonBrawl: Setup.prototype.setupCannonBrawl,
        activateEntertainmentEvent(event, ...args) {
            if (event === Event.CANNON) Activate.prototype.activateEntertainmentEvent.call(this, event, ...args);
        },
    });
    const seek = phase => {
        for (let i = 0; i < 300; i++) {
            host.update(100, 399, true);
            const state = host.snapshot();
            if (state.phase === phase && host.currentEvent() === Event.CANNON) return state;
        }
        throw new Error('未找到目标炮火阶段');
    };
    const receive = state => {
        const transition = guest.applySnapshot(state);
        assert(transition.snapshotAccepted);
        manager.handleEntertainmentDirectorTransition(transition);
        return transition;
    };
    const step = seconds => { for (let i = 0; i < seconds * 60; i++) presentation.update(1 / 60, null, 0, true); };
    const visible = () => presentation.cannons.filter(node => node.active).length;
    return { host, guest, manager, presentation, parent, Event, Phase, seek, receive, step, visible, restarts: () => restarts };
}

test('错过整轮炮火直接恢复间隔或结束快照时，重置控制器且炮台持续隐藏', () => {
    for (const complete of [false, true]) for (const freshController of [false, true]) {
        const f = cannonRecoveryFixture(freshController);
        f.seek(f.Phase.ACTIVE);
        f.host.update(100, 399, true);
        if (complete) f.host.lockAfterFirstFinish();
        const transition = f.receive(f.host.snapshot());
        assert.equal(transition.recoveredEvent, f.Event.CANNON);
        assert.equal(transition.finishedEvent, null);
        assert.equal(f.restarts(), freshController ? 0 : 1);
        assert(f.manager._cannonBrawl, '首次恢复也建立控制器以接收权威子状态');
        assert.equal(f.visible(), 0);
        f.step(10);
        assert.equal(f.visible(), 0);
    }
});

test('炮火代次补偿在已结束状态下保持隐藏，活动和收尾恢复立即就位', () => {
    const f = cannonRecoveryFixture();
    f.receive(f.seek(f.Phase.ACTIVE));
    assert.equal(f.visible(), 2);
    f.host.lockAfterFirstFinish();
    f.receive(f.host.snapshot());
    assert.equal(f.visible(), 2);
    f.host.update(100, 399, true);
    f.receive(f.host.snapshot());
    f.step(2);
    assert.equal(f.visible(), 0);
    f.manager.activateEntertainmentEvent(f.Event.CANNON, false, 99);
    assert.equal(f.visible(), 0);
    f.step(10);
    assert.equal(f.visible(), 0);
});

test('跨轮恢复到炮火预告后再补偿旧代次，保持进场且不被旧结束事件退场', () => {
    const f = cannonRecoveryFixture();
    f.receive(f.seek(f.Phase.ACTIVE));
    const transition = f.receive(f.seek(f.Phase.PREVIEW));
    assert.equal(transition.finishedEvent, f.Event.CANNON);
    assert.equal(transition.previewEvent, f.Event.CANNON);
    f.manager.activateEntertainmentEvent(f.Event.CANNON, false, 99);
    assert.equal(f.visible(), 2);
    assert(Math.abs(f.presentation.cannons[0].position.z) > 11.4, '预告仍从看台开始入场');
    f.step(3);
    assert.equal(f.visible(), 2);
    assert.equal(Math.abs(f.presentation.cannons[0].position.z), 11.4);
    assert.equal(f.manager._cannonPreviewPending, true);
});

test('错过中间轮次直接恢复新一轮炮击，旧轮结束通知不能关闭新炮台', () => {
    const f = cannonRecoveryFixture();
    f.receive(f.seek(f.Phase.ACTIVE));
    const count = f.parent.children.length;
    const transition = f.receive(f.seek(f.Phase.ACTIVE));
    assert.equal(transition.finishedEvent, f.Event.CANNON);
    assert.equal(transition.activatedEvent, f.Event.CANNON);
    f.step(3);
    assert.equal(f.visible(), 2);
    assert.equal(f.parent.children.length, count);
});

test('炮火预告后断流并恢复到其他事件，旧预告标记不能让代次补偿重开炮台', () => {
    const f = cannonRecoveryFixture();
    f.receive(f.seek(f.Phase.PREVIEW));
    assert.equal(f.manager._cannonPreviewPending, true);
    let next = null;
    for (let i = 0; i < 100; i++) {
        f.host.update(100, 399, true);
        if (f.host.snapshot().phase === f.Phase.ACTIVE && f.host.currentEvent() !== f.Event.CANNON) {
            next = f.host.snapshot();
            break;
        }
    }
    assert(next);
    f.receive(next);
    assert.equal(f.manager._cannonPreviewPending, false);
    f.manager.activateEntertainmentEvent(f.Event.CANNON, false, 99);
    f.step(10);
    assert.equal(f.visible(), 0);
});

test('炮台进场中取消预告从当前位置连续退回，重复取消不重置退场且返场复用节点', () => {
    for (const hz of [30, 60]) for (const elapsed of [0.1, 0.3, 1.4]) {
        const f = cannonRecoveryFixture();
        f.receive(f.seek(f.Phase.PREVIEW));
        for (let i = 0; i < elapsed * hz; i++) f.presentation.update(1 / hz, null, 0, true);
        const before = f.presentation.cannons.map(node => Math.abs(node.position.z));
        const nodeCount = f.parent.children.length;
        f.host.lockAfterFirstFinish();
        assert.equal(f.receive(f.host.snapshot()).cancelledPreview, true);
        assert.deepEqual(f.presentation.cannons.map(node => Math.abs(node.position.z)), before);
        const previous = [...before];
        for (let frame = 0; frame < Math.ceil(1.3 * hz); frame++) {
            f.presentation.beginExit();
            f.presentation.update(1 / hz, null, 0, true);
            f.presentation.cannons.forEach((node, i) => {
                const distance = Math.abs(node.position.z);
                assert(distance + 1e-9 >= previous[i], `${hz} Hz、${elapsed} 秒取消后不得向池边跳回`);
                assert(distance <= 15.6 + 1e-9);
                previous[i] = distance;
            });
        }
        assert.equal(f.visible(), 0, '重复取消仍在原定退场时长内隐藏');
        f.presentation.beginEntrance();
        f.step(2);
        assert.equal(f.visible(), 2);
        assert.equal(Math.abs(f.presentation.cannons[0].position.z), 11.4);
        f.presentation.beginExit();
        f.step(1.3);
        assert.equal(f.visible(), 0);
        assert.equal(f.parent.children.length, nodeCount);
    }
});

test('连续换肤与离场只更新存活材质，旧材质释放且纹理保持原引用', () => {
    const h = harness(), tuning = h.load('assets/scripts/venue/WaterColorTuning.ts');
    const { applyCharacterSkin } = h.load('assets/scripts/character/CharacterSkinApplier.ts');
    const model = new Node(), texture = new Texture(), imported = new Material();
    imported.setProperty('mainTexture', texture);
    let current = imported;
    const renderer = { getSharedMaterial: i => i === 0 ? current : null, setMaterial: value => { current = value; } };
    const old = [];
    for (let i = 0; i < 100; i++) {
        applyCharacterSkin({ model, root: model, skinnedRenderers: [renderer], preserveOriginalMaterial: true,
            dynamicColorEffect: {}, dynamicColorMode: 'whiteKey', waterLine: 0, playerOutline: false,
            skinColor: Color.WHITE, suitColor: Color.WHITE, capColor: Color.WHITE, setOutlineRoot() {} });
        old.push(current);
        assert.equal(current.getProperty('mainTexture'), texture);
    }
    assert(imported.isValid, '不销毁导入资源里的原材质');
    assert(old.slice(0, -1).every(material => !material.isValid));
    const before = old.reduce((sum, material) => sum + material.writes, 0);
    tuning.setSwimmerReflectClip(true, new Vector(9, 1, 0));
    assert.equal(old.reduce((sum, material) => sum + material.writes, 0) - before, 1);
    tuning.disposeSwimmerBodyMaterials(model);
    tuning.disposeSwimmerBodyMaterials(model);
    const after = current.writes;
    tuning.setSwimmerReflectClip(true, new Vector(10, 1, 0));
    assert.equal(current.writes, after);
    assert(!current.isValid);
});

test('干燥预览不参与反射写入，漏掉主动清理的失效所有者有兜底', () => {
    const tuning = harness().load('assets/scripts/venue/WaterColorTuning.ts');
    const dry = new Material(), live = new Material(), abandoned = new Material(), owner = new Node();
    tuning.registerSwimmerBodyMaterial(dry, new Node(), false);
    tuning.registerSwimmerBodyMaterial(live, new Node());
    tuning.registerSwimmerBodyMaterial(abandoned, owner);
    const before = dry.writes;
    owner.destroy();
    tuning.setSwimmerReflectClip(true, new Vector(1, 2, 3));
    assert.equal(dry.writes, before);
    assert(!abandoned.isValid);
    const liveBefore = live.writes;
    tuning.setSwimmerReflectClip(true, new Vector(1, 2, 3));
    assert.equal(live.writes, liveBefore, '静止镜头没有重复写入');
});

test('六十帧内反射只采样三十次，每次相机与裁切坐标一致，出水立即关闭', () => {
    let clip = null, writes = 0;
    const Fixture = method('assets/scripts/venue/WaterRefractionController.ts', 'WaterRefractionController', 'updateReflection', {
        Vec3: Vector, REFLECTION_ACTIVE_MARGIN: 0.05, REFLECTION_LOOK_AHEAD: 8,
        PERFORMANCE_CONFIG: { water: { reflectionFramesPerSecond: 30 } },
        setSwimmerReflectClip(on, position) { clip = on ? { ...position } : null; if (on) writes++; },
    });
    const controller = new Fixture(), position = new Vector(0, -1, 0);
    const reflection = { isValid: true, enabled: false, node: { setWorldPosition(p) { this.position = { ...p }; }, lookAt() {} } };
    Object.assign(controller, { _reflectionCamera: reflection, _mainCamera: { isValid: true,
        node: { getWorldPosition(out) { out.set(position.x, position.y, position.z); }, worldRotation: {} } },
        _waterY: 0, _underwaterViewActive: true, _reflectionActive: false, _reflectionElapsed: 0 });
    for (const name of ['_tmpCamPos', '_tmpFwd', '_tmpUp', '_tmpAhead', '_tmpReflPos', '_tmpReflAhead', '_tmpReflUp']) controller[name] = new Vector();
    let renders = 0;
    for (let i = 0; i < 60; i++) {
        position.x = i * 0.1;
        controller.updateReflection(1 / 60);
        if (reflection.enabled) { renders++; assert.deepEqual(reflection.node.position, clip); }
    }
    assert.equal(renders, 30); assert.equal(writes, 30);
    controller._underwaterViewActive = false;
    controller.updateReflection(1 / 60);
    assert.equal(reflection.enabled, false); assert.equal(clip, null);
    controller._underwaterViewActive = true;
    controller.updateReflection(0);
    assert.equal(reflection.enabled, true, '再次入水首帧立即采样');
});

test('画中画关闭时不构建资源，二十赫兹配置限制实际渲染次数', () => {
    const file = 'assets/scripts/camera/RaceEventPictureInPictureCamera.ts';
    let builds = 0;
    const Fixture = method(file, 'RaceEventPictureInPictureCamera', 'constructor', {
        PERFORMANCE_CONFIG: { eventPictureInPicture: { enabled: false } },
    });
    Fixture.prototype.buildCamera = Fixture.prototype.buildHud = () => builds++;
    new Fixture({}); assert.equal(builds, 0);
    const Gate = method(file, 'RaceEventPictureInPictureCamera', 'shouldRender', {});
    const gate = new Gate(); Object.assign(gate, { renderElapsed: 0, renderInterval: 1 / 20, camera: { isValid: true, enabled: true } });
    let renders = 0;
    for (let i = 0; i < 60; i++) if (gate.shouldRender(1 / 60)) renders++;
    assert.equal(renders, 20);
});

test('资源完成回调不批量实例化，节点分帧创建，收集和销毁后的任务安全跳过', () => {
    const h = harness();
    const { StimulantBrawlController } = h.load('assets/scripts/core/StimulantBrawlController.ts');
    const schedule = Array.from({ length: 21 }, (_, id) => ({ id, kind: id < 14 ? 'heartbeat-soda' : 'calm-slush',
        wave: Math.floor(id / 3), laneIndex: 0, lateralOffset: 0, distance: 30 + id }));
    const controller = new StimulantBrawlController(new Node(), 1, { laneCount: 1, centerZ: () => 0 },
        { swimPosition: (x, z) => ({ x, z }), waterY: 0 }, () => null, () => {}, () => {}, () => {}, () => 0, null, schedule);
    assert.equal(controller.items.filter(item => item.node).length, 0);
    for (const request of h.callbacks.splice(0)) request.callback(null, { valid: true });
    assert.equal(h.counters.instances, 0, '资源完成只入队');
    controller.items[5].collected = true;
    for (let frame = 0; frame < 40; frame++) {
        const before = h.counters.instances, nodesBefore = controller.items.filter(item => item.node).length;
        controller.buildPendingVisuals();
        assert(h.counters.instances - before <= 1);
        assert(controller.items.filter(item => item.node).length - nodesBefore <= 2);
    }
    assert.equal(h.counters.instances, 20);
    assert.equal(controller.items[5].node, null);
    controller.dispose();
    const before = h.counters.instances;
    controller.buildPendingVisuals();
    assert.equal(h.counters.instances, before);
    assert.equal(controller.modelBuildJobs.length, 0);
});

test('共享水花实际几何符合分层预算，包括局部碎水喷散', () => {
    const h = harness();
    const source = fs.readFileSync(path.join(root, 'assets/scripts/core/EntertainmentWaterSplash.ts'), 'utf8');
    const names = [...source.matchAll(/function (build\w+Geometry)\(/g)].map(match => match[1]);
    const builders = evaluate(source + '\nexport const auditBuilders = {' + names.join(',') + '};', { require: () => h.cc }).auditBuilders;
    const triangles = name => builders[name]().indices.length / 3;
    assert(triangles('buildLightEntryGeometry') <= 128);
    assert(triangles('buildHeavyEntryBodyGeometry') + triangles('buildHeavyImpactRingGeometry') <= 256);
    const water = triangles('buildExplosionBodyGeometry') + triangles('buildExplosionImpactRingGeometry');
    assert(water <= 480);
    assert(water + triangles('buildLocalWaterBurstGeometry') <= 600);
});

test('缺失模型使用下一候选且保持每帧预算，离场后的加载结果不再入队', () => {
    const h = harness();
    const { StimulantBrawlController } = h.load('assets/scripts/core/StimulantBrawlController.ts');
    const controller = new StimulantBrawlController(new Node(), 1, { laneCount: 1, centerZ: () => 0 },
        { swimPosition: (x, z) => ({ x, z }), waterY: 0 }, () => null, () => {}, () => {}, () => {}, () => 0, null,
        [{ id: 0, kind: 'heartbeat-soda', wave: 1, laneIndex: 0, lateralOffset: 0, distance: 30 }]);
    const first = h.callbacks.shift(), late = h.callbacks.shift();
    first.callback(null, { valid: false });
    controller.buildPendingVisuals();
    assert.equal(h.counters.instances, 1);
    const fallback = controller.items[0].node;
    assert(fallback.isValid);
    assert.equal(h.callbacks.length, 1, '无网格预制体触发下一个候选');
    h.callbacks.shift().callback(null, { valid: true });
    controller.buildPendingVisuals();
    assert.equal(h.counters.instances, 2);
    assert(!fallback.isValid);
    controller.dispose();
    late.callback(null, { valid: true });
    assert.equal(controller.modelBuildJobs.length, 0);
    controller.updatePresentation(30, 1 / 60, true);
    assert.equal(h.counters.instances, 2);
});

test('两种资源同时就绪时按道具排期准备，首波冰沙不等待整批苏打', () => {
    const h = harness();
    const { StimulantBrawlController } = h.load('assets/scripts/core/StimulantBrawlController.ts');
    const controller = new StimulantBrawlController(new Node(), 1, { laneCount: 1, centerZ: () => 0 },
        { swimPosition: (x, z) => ({ x, z }), waterY: 0 }, () => null, () => {}, () => {}, () => {}, () => 0, null,
        ['calm-slush', 'heartbeat-soda'].map((kind, id) => ({ id, kind, wave: id + 1, laneIndex: 0, lateralOffset: 0, distance: 30 + id * 20 })));
    for (const request of h.callbacks.splice(0)) request.callback(null, { valid: true });
    controller.buildPendingVisuals();
    assert.equal(controller.items[0].node.name, 'CalmSlush_0');
    assert.equal(controller.items[1].node.name, 'StimulantCube_1');
    assert.equal(h.counters.instances, 1);
    controller.buildPendingVisuals();
    assert.equal(controller.items[1].node.name, 'StimulantPotion_1');
    controller.dispose();
});
