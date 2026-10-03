const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const { createFixedMeshHarness } = require('./helpers/fixed-mesh-harness.cjs');

// 执行正式模型加载、皮肤与描边创建、显隐及卸载代码，只模拟引擎渲染组件。
function harness({ delayed = false } = {}) {
    const requests = [];
    const h = createFixedMeshHarness({
        '../core/RaceBundleLoader': { loadRaceAsset(_path, _type, done) {
            if (delayed) requests.push(done); else done(null, new h.cc.EffectAsset());
        } },
        '../venue/WaterColorTuning': { registerSwimmerBodyMaterial() {} },
    });
    class SkinnedMeshRenderer extends h.cc.MeshRenderer {
        _enabled = true; enabledWrites = 0;
        get isValid() { return this.node.isValid; }
        get enabled() { return this._enabled; }
        set enabled(value) { this._enabled = value; this.enabledWrites++; }
        getSharedMaterial(index) { return this.sharedMaterials[index] || null; }
        setUseBakedAnimation() {}
        uploadAnimation() {}
    }
    const originalAdd = h.Node.prototype.addComponent;
    h.Node.prototype.addComponent = function(C) {
        const component = originalAdd.call(this, C); component.node = this; return component;
    };
    h.Node.prototype.setWorldScale = function(value) {
        if (this.parent) h.Vec3.divide(this.scale, value, this.parent.getWorldScale(new h.Vec3()));
        else h.Vec3.copy(this.scale, value);
    };
    Object.defineProperty(h.Node.prototype, 'activeInHierarchy', {
        get() { return this.active && (!this.parent || this.parent.activeInHierarchy); },
    });
    Object.assign(h.cc, { SkinnedMeshRenderer, Texture2D: class {}, SkeletalAnimation: class {} });
    const loader = h.loadModule('character/CharacterModelLoader');
    const { applyCharacterSkin } = h.loadModule('character/CharacterSkinApplier');
    const variant = { id: 'cartonSwimmer6', candidates: ['test'], outlineWidth: 3 };
    const sourceFile = path.resolve(__dirname, '../assets/scripts/entity/CartoonSwimmerRig.ts');
    const source = ts.createSourceFile(sourceFile, fs.readFileSync(sourceFile, 'utf8'), ts.ScriptTarget.Latest, true);
    const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'CartoonSwimmerRig');
    const names = ['loadModelForCurrentVariant', 'clearLoadedModel', 'configureSkinnedRenderers',
        'applyLaneMaterials', 'setSkinnedRenderersEnabled', 'lateUpdate', 'setRecoveryBlinkVisible',
        'setOutlineVisible', 'applyOutlineVisibility', 'outlineVisible', 'prepareTimedWaterBalloonMount', 'releaseTimedWaterBalloonMount'];
    const code = `class Subject { ${names.map(name => {
        const member = cls.members.find(n => n.name?.getText(source) === name);
        assert.ok(member, name); return member.getText(source);
    }).join('\n')} }`;
    function instantiate() {
        const model = new h.Node('Model'); const armature = new h.Node('Armature'); armature.setParent(model); new h.Node('Spine02').setParent(armature);
        for (const name of ['Body', 'Cap']) {
            const skin = new h.Node(name); skin.setParent(model);
            const renderer = skin.addComponent(SkinnedMeshRenderer);
            renderer.mesh = { name }; renderer.skeleton = { name: 'Skeleton' };
            renderer.setMaterial(new h.cc.Material(), 0);
            renderer.setMaterial(new h.cc.Material(), 1);
        }
        return model;
    }
    const globals = { ...loader, ...h.cc, applyCharacterSkin, ...h.loadModule('character/TimedWaterBalloonMount'),
        findSwimmerModelVariant: () => variant, defaultSwimmerModelVariant: () => variant,
        findSwimmerColorVariant: () => ({}), defaultSwimmerColorVariant: () => ({}),
        loadSwimmerPrefab: done => done(null, { prefab: {}, path: 'test' }), instantiate,
        initializeRaceModel: create => create(), TUTORIAL_RUNTIME: { paused: false },
        console: { log() {}, warn() {}, error() {} },
    };
    const Rig = vm.runInNewContext(ts.transpileModule(code, { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
    } }).outputText + '; Subject', globals);
    function createRig() {
        const rig = new Rig();
        const pose = { rootBaseEuler: new h.Vec3(), setModelVariantId() {}, setSurfaceSwimStyle() {},
            bind() {}, unbind() {}, setSwimHeadLift() {}, captureBasePose() {}, setDiveHandContact() {},
            getHipWorldPosition: () => false, setBreaststrokeSamplesOverride() {}, setDivePrepPoseOverride() {} };
        const contact = () => ({ bind() {}, clear() {} });
        Object.assign(rig, { node: new h.Node('Swimmer'), _model: null, root: null, _pose: pose,
            _modelLoadToken: 0, _modelVariantId: 'cartonSwimmer6', _waterBalloonMount: null, _waterBalloonMountRequested: false, _sampledActionOverrideLoadToken: 0,
            _sampledActionOverrides: new Map(), _skinnedRenderers: [], _outlineRenderers: [],
            _outlineRoot: null, _outlineVisible: true, _recoveryBlinkVisible: true,
            _loaded: false, _rendererRevealFramesRemaining: 0, _colorOverride: null,
            _skinColor: new h.cc.Color(255, 200, 150), _suitColor: new h.cc.Color(0, 100, 200),
            _capColor: new h.cc.Color(200, 100, 0), _playerOutline: true,
            _diveChargeBodyMaterials: [], _geyserBodyPivot: new h.Vec3(),
            _collisionPitchVisualOffset: new h.Vec3(), _standingSoles: contact(), _headBounds: contact(),
            _handContact: contact(), _animationPlayer: { bind() {}, disable() {} },
            _poseState: { applyRaceModelSetup() {}, reapplyCurrentState() {}, resetRuntime() {}, setShowcaseAction() {} },
            attachModelToSwimmerNode() { this._model.setParent(this.node); return true; },
            swimHeadLiftDegrees: () => 0, preserveOriginalMaterial: () => true,
            refreshShowcaseAction() {}, loadSampledActionOverrides() {}, resetPose() {},
            restorePerfectGlowMaterials() {}, updatePerfectGlowMaterial() {},
        });
        return rig;
    }
    const shells = rig => rig._outlineRoot?.children.flatMap(n => n.components) || [];
    const reveal = rig => { rig.lateUpdate(); rig.lateUpdate(); };
    const finish = (error = null) => requests.splice(0).forEach(done => done(error, error ? null : new h.cc.EffectAsset()));
    return { ...h, createRig, shells, reveal, finish, requests, loader };
}

test('描边材质命中缓存时，两帧等待结束后本体和描边一起显示', () => {
    const h = harness(), rig = h.createRig(); rig.loadModelForCurrentVariant();
    const body = rig._skinnedRenderers, shells = h.shells(rig);
    assert.equal(shells.length, body.length);
    assert.ok([...body, ...shells].every(r => !r.enabled), '绑定姿态期间全部隐藏');
    rig.lateUpdate(); assert.ok([...body, ...shells].every(r => !r.enabled));
    rig.lateUpdate(); assert.ok([...body, ...shells].every(r => r.enabled), '不能只显示本体而漏掉描边');
    shells.forEach((shell, i) => {
        assert.equal(shell.mesh, body[i].mesh); assert.equal(shell.skeleton, body[i].skeleton);
        assert.equal(shell.sharedMaterials.length, 2);
    });
});

test('描边异步到达时，继承当前两帧等待与闪烁状态', () => {
    for (const frames of [0, 1, 2]) for (const blink of [false, true]) {
        const h = harness({ delayed: true }), rig = h.createRig(); rig.loadModelForCurrentVariant();
        for (let frame = 0; frame < frames; frame++) rig.lateUpdate();
        rig.setRecoveryBlinkVisible(blink); h.finish();
        assert.ok(h.shells(rig).every(r => r.enabled === (frames === 2 && blink)));
        h.reveal(rig); assert.ok([...rig._skinnedRenderers, ...h.shells(rig)].every(r => r.enabled === blink));
        rig.setRecoveryBlinkVisible(true);
        assert.ok([...rig._skinnedRenderers, ...h.shells(rig)].every(r => r.enabled));
    }
});

test('恢复闪烁与远处对手描边隐藏互不覆盖，重复状态不反复写渲染属性', () => {
    const h = harness(), rig = h.createRig(); rig.loadModelForCurrentVariant(); h.reveal(rig);
    const renderers = [...rig._skinnedRenderers, ...h.shells(rig)], root = rig._outlineRoot;
    rig.setOutlineVisible(false); rig.setRecoveryBlinkVisible(false);
    assert.ok(renderers.every(r => !r.enabled)); assert.equal(root.active, false);
    rig.setRecoveryBlinkVisible(true);
    assert.ok(renderers.every(r => r.enabled)); assert.equal(root.active, false, '恢复不能强制打开远处描边');
    rig.setOutlineVisible(true); assert.equal(root.active, true);
    const enabledWrites = renderers.map(r => r.enabledWrites), activeWrites = root.writes;
    for (let i = 0; i < 100; i++) {
        rig.setRecoveryBlinkVisible(true); rig.setOutlineVisible(true); rig.setSkinnedRenderersEnabled(true); rig.lateUpdate();
    }
    assert.deepEqual(renderers.map(r => r.enabledWrites), enabledWrites); assert.equal(root.writes, activeWrites);
    rig.node.getComponent = () => assert.fail('闪烁期间不能重新扫描节点');
    rig._model.getComponent = rig.node.getComponent;
    for (let i = 0; i < 10; i++) {
        rig.setRecoveryBlinkVisible(false); rig.setRecoveryBlinkVisible(true);
    }
    assert.ok(renderers.every(r => r.enabled));
});

test('主干距离策略继续控制对手描边，恢复闪烁不改变近远距离判定', () => {
    const h = harness(), player = h.createRig(), opponent = h.createRig();
    for (const rig of [player, opponent]) { rig.isValid = true; rig.loadModelForCurrentVariant(); h.reveal(rig); }
    const camera = new h.Node('Camera');
    const { CharacterOutlineVisibility } = h.loadModule('character/CharacterOutlineVisibility');
    const { PERFORMANCE_CONFIG } = h.loadModule('core/PerformanceConfig');
    const policy = new CharacterOutlineVisibility(), config = PERFORMANCE_CONFIG.characterOutline;
    const swimmer = rig => ({ node: rig.node, cartoonRig: rig });
    const p = swimmer(player), o = swimmer(opponent);
    opponent.node.setPosition(config.opponentDisableDistance + 1, 0, 0);
    policy.update(config.refreshSeconds, camera, p, [o]);
    assert.equal(opponent._outlineRoot.active, false); assert.equal(player._outlineRoot.active, true);
    opponent.setRecoveryBlinkVisible(false); opponent.setRecoveryBlinkVisible(true);
    assert.equal(opponent._outlineRoot.active, false);
    opponent.node.setPosition(config.opponentEnableDistance - 1, 0, 0);
    policy.update(config.refreshSeconds, camera, p, [o]);
    assert.equal(opponent._outlineRoot.active, true);
});

test('连续换角色清理描边缓存，旧模型的迟到成功和失败不能覆盖新模型', () => {
    for (const fail of [false, true]) {
        const h = harness({ delayed: true }), rig = h.createRig();
        for (let cycle = 0; cycle < 5; cycle++) {
            rig.loadModelForCurrentVariant(); const oldRoot = rig._outlineRoot;
            rig.clearLoadedModel();
            assert.equal(rig._outlineRenderers.length, 0); assert.equal(rig._outlineRoot, null);
            rig.loadModelForCurrentVariant(); const newRoot = rig._outlineRoot;
            assert.notEqual(oldRoot, newRoot); h.finish(fail ? new Error('材质加载失败') : null);
            if (!fail) {
                assert.equal(rig._outlineRoot, newRoot); h.reveal(rig);
                assert.equal(rig._outlineRenderers.length, 2);
                assert.ok(h.shells(rig).every(r => r.enabled));
                rig.configureSkinnedRenderers(); assert.equal(rig._skinnedRenderers.length, 2, '本体缓存不得包含描边');
            } else {
                assert.equal(rig._outlineRoot, null); assert.equal(rig._outlineRenderers.length, 0);
            }
            rig.clearLoadedModel();
            assert.equal(rig._outlineRenderers.length, 0); assert.equal(rig._skinnedRenderers.length, 0);
        }
    }
});

test('同一模型重建描边时，延后销毁的旧根回调不能清掉新的根', () => {
    const h = harness({ delayed: true }), rig = h.createRig(); rig.loadModelForCurrentVariant();
    const oldRoot = rig._outlineRoot, destroy = oldRoot.destroy;
    // Creator 的 destroy 会等帧末释放，旧引用在回调期间仍可能 isValid。
    oldRoot.destroy = function() { this.destroyRequested = true; };
    rig.applyLaneMaterials(rig._skinColor, rig._suitColor, rig._capColor, false, false);
    rig.applyLaneMaterials(rig._skinColor, rig._suitColor, rig._capColor, false, true);
    const newRoot = rig._outlineRoot, changes = [];
    let current = newRoot;
    Object.defineProperty(rig, '_outlineRoot', { get: () => current, set(value) { changes.push(value); current = value; } });
    h.finish(new Error('材质加载失败'));
    assert.equal(changes.length, 1, '只有当前根的失败回调可以清空引用');
    assert.equal(rig._outlineRoot, null); assert.equal(rig._outlineRenderers.length, 0);
    destroy.call(oldRoot); rig.clearLoadedModel();
});

// 验证正式加载/卸载方法里的申请门禁，而非重新实现一个替身 API。
test('普通角色不建水球挂点；申请后加载完成只创建一次，重绑和退出正确释放', () => {
    const h = harness(), rig = h.createRig();
    rig.loadModelForCurrentVariant(); assert.equal(rig._waterBalloonMount, null);
    const model = rig._model, count = h.nodes.length;
    const mount = rig.prepareTimedWaterBalloonMount(); assert.ok(mount?.isValid); assert.equal(mount.parent.name, 'Spine02');
    for (let i=0;i<100;i++) assert.equal(rig.prepareTimedWaterBalloonMount(), mount);
    assert.equal(h.nodes.length, count+1); assert.equal(rig._model,model);
    rig.clearLoadedModel(); assert.equal(mount.isValid,false); assert.equal(rig._waterBalloonMount,null);
    rig.loadModelForCurrentVariant(); const next=rig._waterBalloonMount; assert.ok(next?.isValid); assert.notEqual(next,mount);
    rig.releaseTimedWaterBalloonMount(); assert.equal(next.isValid,false); assert.equal(rig._waterBalloonMount,null);
    rig.clearLoadedModel(); rig.loadModelForCurrentVariant(); assert.equal(rig._waterBalloonMount,null);
    const late=h.createRig(); assert.equal(late.prepareTimedWaterBalloonMount(),null);late.releaseTimedWaterBalloonMount();late.loadModelForCurrentVariant();assert.equal(late._waterBalloonMount,null);
});
