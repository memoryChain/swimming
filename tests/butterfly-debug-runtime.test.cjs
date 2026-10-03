// 执行真实调试入口，验证门控、动作切换及模型生命周期。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const { createRig, load, root, SWIMMER_MODEL_FILES } = require('./helpers/character-contact-harness.cjs');
const { BUTTERFLY_PREVIEW_TUNING } = load(path.join(root, 'assets/scripts/character/ButterflyMotion.ts'));
const { DEBUG_SWIMMER_ACTION_PREVIEWS } = load(path.join(root, 'assets/scripts/core/ResourcePaths.ts'));
const positiveMod = (a,b) => ((a % b) + b) % b;
function methods(file, name, names, globals = {}) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(root,file),'utf8'), ts.ScriptTarget.Latest,true);
    const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === name);
    const members = names.map(id => {
        const m = cls.members.find(n => n.name?.getText(source) === id); assert.ok(m,id); return m.getText(source);
    });
    const module = { exports: {} };
    vm.runInNewContext(ts.transpileModule(`export class Subject { ${members.join('\n')} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText, { module, exports: module.exports, console: { log() {} }, ...globals });
    return module.exports.Subject;
}
const Rig = methods('assets/scripts/entity/CartoonSwimmerRig.ts', 'CartoonSwimmerRig', [
    'updateDebugActionPreview','applyModelDebugSetup','setDebugActionPose','setModelDebugMode',
    'isFlipTurnDebugPose','isBreaststrokeDebugPose','isDivePrepDebugPose','isSampledActionDebugPose','motionPreviewSpeedScale',
], { positiveMod, BUTTERFLY_PREVIEW_TUNING });
function rig(pose = null, wrapper = {}) {
    const r = new Rig(), calls = { samples: [], sync: 0, splash: 0, reset: 0, setup: 0 };
    pose ??= { setMovementDirection() {}, setMovementHeadingRadians() {}, setMovementPitchRadians() {},
        applyButterflyDebugPose(p) { calls.samples.push(p); }, setSwimHeadLift() {}, restoreBasePose() {} };
    Object.assign(r, { calls, _pose: pose, _selfTime: 0, _loaded: true, _modelDebugMode: true, _debugActionPose: 'butterfly',
        _debugSampledActionId: null, _debugMotionSpeedScale: 1, _model: wrapper, root: pose.root ?? {},
        _skinnedRenderers: [], _animationPlayer: { disable() {} },
        _poseState: { applyRaceModelSetup() { calls.setup++; }, enterFreestyle() {} },
        configureSkinnedRenderers() {}, resetDebugFlipTurnState() {}, swimHeadLiftDegrees() { return 6; },
        resetPose() { calls.reset++; this._pose.restoreBasePose(); },
        _splashEmitter: { setVisible(value) { calls.visible = value; } },
        syncSplashState() { calls.sync++; }, updateSplashSurface() { calls.splash++; },
    });
    return r;
}
test('未加载或未进入模型调试时入口不采样，不操作水花', () => {
    for (const key of ['_loaded','_modelDebugMode']) {
        const r = rig(); r[key] = false;
        for (let i=0;i<120;i++) { r._selfTime += 1/60; r.updateDebugActionPreview(1/60); }
        assert.equal(r.calls.samples.length,0); assert.equal(r.calls.splash,0); assert.equal(r.calls.sync,0);
    }
});
test('15至120Hz与调试速度倍率均从已有时钟采样，不创建或修改比赛状态', () => {
    for (const fps of [15,30,60,120]) for (const scale of [.1,.5,1,1.5]) {
        const r = rig(); r._debugMotionSpeedScale = scale;
        const cycle = BUTTERFLY_PREVIEW_TUNING.cycleSeconds / Math.max(.25,scale);
        for (let frame=1;frame<=fps*2;frame++) { r._selfTime = frame/fps; r.updateDebugActionPreview(1/fps); }
        assert.equal(r.calls.samples.length,fps*2);
        assert.ok(Math.abs(r.calls.samples.at(-1)-positiveMod(2/cycle,1))<1e-10);
        assert.equal(r.calls.reset,0); assert.equal(r.calls.setup,0);
        assert.equal(r._armAction,0); assert.equal(r._kickAction,0);
        assert.equal(r.calls.sync,fps*2); assert.equal(r.calls.splash,fps*2);
    }
});
test('同动作选择无操作，反复退出／重进恢复全部骨骼，不残留蝶泳腰髋偏移', () => {
    for (const file of SWIMMER_MODEL_FILES) {
        const actual = createRig(file); actual.wrapper.setRotationFromEuler(90,90,0);
        const r=rig(actual.pose,actual.wrapper);
        r.setDebugActionPose('butterfly'); assert.equal(r.calls.reset,0);
        for (let i=0;i<3;i++) {
            r._selfTime=.73*.95; r.updateDebugActionPreview(.1);
            r.setModelDebugMode(false);
            const snapshot = () => JSON.stringify([actual.pose.root.position,actual.pose.root.rotation,
                ...actual.pose._basePoseBones.map(p => [p.bone.position,p.bone.rotation])]);
            const restored=snapshot(); actual.pose.restoreBasePose(); assert.equal(snapshot(),restored,file);
            r.updateDebugActionPreview(.1); assert.equal(snapshot(),restored);
            r.setModelDebugMode(true); assert.equal(r.calls.visible,false);
        }
        r.setDebugActionPose('freestyle');
        const mixed=JSON.stringify(actual.pose._manualBones.map(b=>b.rotation));
        actual.pose.restoreBasePose(); actual.pose.applyFreestylePose(0,0,0,0,0,1,1,.9);
        assert.equal(JSON.stringify(actual.pose._manualBones.map(b=>b.rotation)),mixed,file);
    }
});
test('动作列表提供独立蝶泳角色，重复切换只移动相机并保留各角色与动作时间', () => {
    assert.equal(DEBUG_SWIMMER_ACTION_PREVIEWS.filter(a=>a.id==='butterfly').length,1);
    assert.equal(DEBUG_SWIMMER_ACTION_PREVIEWS.find(a=>a.id==='butterfly').pose,'butterfly');
    const Flow=methods('assets/scripts/app/ModelDebugFlowController.ts','ModelDebugFlowController',[
        'switchActionPreview','refreshActionPreviewVisibility','currentActionPreview',
    ],{ DEBUG_SWIMMER_ACTION_PREVIEWS,positiveMod });
    const flow=new Flow();let cameras=0,labels=0;
    const previews=DEBUG_SWIMMER_ACTION_PREVIEWS.map((config,i)=>({ config,node:{active:true},rig:{_selfTime:i+.25} }));
    Object.assign(flow,{_active:true,_actionPreviewIndex:0,_actionPreviews:previews,
        _refs:{ debug() {} }, updateCamera() { cameras++; }, updateActionLabel() { labels++; } });
    const nodes=previews.map(p=>p.node), times=previews.map(p=>p.rig._selfTime);
    for(let i=0;i<DEBUG_SWIMMER_ACTION_PREVIEWS.length*5;i++) flow.switchActionPreview();
    assert.deepEqual(previews.map(p=>p.node),nodes);assert.deepEqual(previews.map(p=>p.rig._selfTime),times);
    assert.equal(flow._actionPreviews.length,DEBUG_SWIMMER_ACTION_PREVIEWS.length);
    assert.equal(cameras,DEBUG_SWIMMER_ACTION_PREVIEWS.length*5);assert.equal(labels,cameras);
    const before=cameras;flow._active=false;flow.switchActionPreview();assert.equal(cameras,before);
});
