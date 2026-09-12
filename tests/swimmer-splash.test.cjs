// 验证水花方向和发射预算，不依赖编辑器或真实渲染。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
const root = path.resolve(__dirname, '..');
function evaluate(source, globals = {}) {
    const module = { exports: {} };
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText,
        { module, exports: module.exports, ...globals });
    return module.exports;
}
const TUNING = evaluate(fs.readFileSync(path.join(root, 'assets/scripts/character/SplashEmitterTuning.ts'), 'utf8')).SPLASH_EMITTER_TUNING;
const source = ts.createSourceFile('SplashEmitter.ts', fs.readFileSync(path.join(root, 'assets/scripts/character/SplashEmitter.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'SplashEmitter');
function method(name, globals) {
    return evaluate(`export class Subject { ${cls.members.find(n => n.name?.getText(source) === name).getText(source)} }`, { TUNING, ...globals }).Subject;
}
test('尾流在正向、反向和转向时始终落在双脚后方', () => {
    const math = createHarness();
    const { Node, Vec3 } = math;
    const Subject = method('resolvePartPosition');
    for (const direction of [1, -1]) for (const yaw of [0, 35, -35]) {
        const h = new Subject();h.node = new Node();h.node.setRotationFromEuler(0, yaw, 0);
        h._state = { movementDirection: direction };h._waterY = 0;h._tmpWorld = new Vec3();h._tmpLocal = new Vec3();
        const foot = new Node(h.node, -direction, 0, 0);
        h._options = { getBoneWorldPosition: (_, out) => { foot.getWorldPosition(out); return true; } };
        const part = { node: new Node(h.node), basePosition: new Vec3(0, 0.005, 0) };
        h.resolvePartPosition(part, 1, 0, true, false, 0);
        assert(direction * (part.node.position.x - foot.position.x) < -0.3);
        assert(Math.abs(part.node.position.z - foot.position.z) < 1e-6);
    }
});
test('每次水片爆发只发一张，不再叠加连续发射', () => {
    const Subject = method('playParticleBurst', {
        lerp: (a,b,t) => a+(b-a)*t,
        setCurveRange: () => {}, setCurveRangeTwoConstants: () => {},
    });
    const h = new Subject();h.node = {};h._countSpeedFactor = 1;
    h.particleLifetimeMin = () => 0.16;h.particleLifetimeMax = () => 0.28;
    const counts = [];h.emitJitteredParticles = (_, count) => counts.push(count);
    const emitter = { role: 'hand', visual: 'plume', sizeScale: 4, heightScale: 0.8, countScale: 0.2, system: { play() {} } };
    h.playParticleBurst(emitter, 30, 1, 1);
    assert.deepEqual(counts, [1]);assert.equal(emitter.sprayRate, 0);assert.equal(emitter.sprayTime, 0);
});
test('离水阶段停止后续脚部发射，不清掉刚触发的出水爆发', () => {
    const Subject = method('updateLegParticleEmitter');const h = new Subject();h._state = { legSplashSuppressed: true };
    const emitter = { lastContact: 1, sprayTime: 1, sprayRate: 10, sprayCarry: 1 };
    h.updateLegParticleEmitter(emitter, 1, true);
    assert.equal(emitter.sprayTime, 0);assert.equal(emitter.sprayRate, 0);
});

test('路径泡沫按移动距离采样，静止和离水不持续发射，瞬移不连接旧轨迹', () => {
    const math = createHarness();const { Vec3 } = math;
    const wake = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'WorldWakeEmitter');
    const update = wake.members.find(n => n.name?.getText(source) === 'update').getText(source);
    const { Subject } = evaluate(`export class Subject { ${update} }`, { Vec3, setCurveRange() {}, randomRange: () => 0 });
    const h = new Subject();let count = 0;let position = new Vec3();
    Object.assign(h,{remaining:0,elapsed:0,ready:false,reduced:false,point:new Vec3(),last:new Vec3(),node:{setWorldPosition(){}},system:{play(){},emit(){count++;}}});
    const state = {legSplashSuppressed:false,movementDirection:1,movementHeadingRadians:0};
    const options={getBoneWorldPosition(_,out){out.set(position);return true;}};
    for(let i=0;i<120;i++)h.update(1/60,0,3,state,options);
    assert.equal(count,1,'没有位移时不在脚下堆叠泡沫');
    position.x=0.4;h.update(0.2,0,3,state,options);assert.equal(count,2);
    state.legSplashSuppressed=true;position.x=0.8;h.update(0.2,0,3,state,options);assert.equal(count,2);
    state.legSplashSuppressed=false;position.x=20;h.update(0.2,0,3,state,options);assert.equal(count,3);
    assert.equal(h.last.x,20,'重新从当前位置采样');
    h.update(0.2,0,0,state,options);assert.equal(count,3,'静止时不发射');
});

test('动态粒子显式创建并绑定缺失模块，重复初始化不替换模块', () => {
    const fn=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='initializeSplashModules');
    const calls=[];
    class Module {onInit(v){calls.push(['shape',v]);}bindTarget(v){calls.push(['bind',v]);}}
    const { initializeSplashModules:init }=evaluate('export '+fn.getText(source),{js:{getClassByName:()=>Module}});
    const system={processor:{}};init(system);const shape=system.shapeModule;
    assert.equal(calls.length,4);init(system);assert.equal(calls.length,4);assert.equal(system.shapeModule,shape);
    assert(calls.slice(1).every(x=>x[1]===system.processor));
});

test('生命周期透明度使用 Cocos 的 0～255 单位，初始可见且末尾为零', () => {
    const fn=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='setParticleFadeOut');
    class Key {} class Color {constructor(...values){this.values=values;}}
    class Gradient {setKeys(colors,alpha){this.alpha=alpha;}}
    const { setParticleFadeOut:fade }=evaluate('export '+fn.getText(source),{TUNING,Color,ColorKey:Key,AlphaKey:Key,Gradient,GradientRange:{Mode:{Gradient:1}}});
    const system={colorOverLifetimeModule:{color:{}}};fade(system,'hand');
    const alpha=system.colorOverLifetimeModule.color.gradient.alpha;
    assert.equal(alpha[0].alpha,255);assert.equal(alpha[1].alpha,255);assert.equal(alpha.at(-1).alpha,0);
});

test('手掌下穿水面才触发，前伸悬停、上浮和水下停留均不触发', () => {
    const {Vec3}=createHarness();
    const cls=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='HandWaterContact');
    const {HandWaterContact}=evaluate('export '+cls.getText(source),{TUNING,Vec3});
    const left=new HandWaterContact(),right=new HandWaterContact();
    let x=1,y=.4;
    const options={getBoneWorldPosition:(_,out)=>{out.set(x,y,3);return true;}};
    const step=(tracker,height)=>{y=height;tracker.update(options,'LeftHand',.15,false);return tracker.triggered;};
    assert.equal(step(left,.4),false);
    x=1.3;assert.equal(step(left,.35),false,'向前伸手且在空中不触发');
    assert.equal(step(left,.2),false);
    x=1.5;assert.equal(step(left,.18),true,'穿过手掌接触带立即触发');
    assert(Math.abs(left.point.x-1.4)<1e-6,'落点在前后两帧之间插值');
    assert.equal(left.point.y,.15);
    assert.equal(step(left,.1),false);assert.equal(step(left,.2),false,'上浮不触发');
    step(left,.4);assert.equal(step(left,.1),true,'下一次拍水可重触发');
    assert.equal(step(right,.1),false,'另一只手初始在水下不凭空触发');
    step(right,.4);assert.equal(step(right,.1),true);
    step(left,.4);left.update(options,'LeftHand',.15,true);assert.equal(step(left,.1),false,'离水动作恢复先重新采样');
    step(left,.4);x=20;assert.equal(step(left,.1),false,'瞬移不生成穿水事件');
});

test('拍水在各自手骨落点即时发射少量水滴，无持续补发', () => {
    const { Vec3 } = createHarness();
    const Subject=method('playHandImpact',{lerp:(a,b,t)=>a+(b-a)*t,setCurveRange:()=>{},setCurveRangeTwoConstants:()=>{}});
    for(const side of ['left','right']) for(const speed of [0,1]) {
        const h=new Subject();let position;const counts=[];
        h.node={active:true};h._state={movementDirection:1};h._waterY=2;h._tmpWorld=new Vec3();
        h._leftHandImpact={point:new Vec3(3,2,11)};h._rightHandImpact={point:new Vec3(5,2,12)};
        const emitter={side,node:{setWorldPosition:p=>position={x:p.x,y:p.y,z:p.z},setRotationFromEuler(){}},system:{shapeModule:{},play(){},emit:n=>counts.push(n)},sprayTime:1,sprayRate:20,sprayCarry:1};
        h.playHandImpact(emitter,speed);
        assert.deepEqual(position,{x:side==='left'?3:5,y:2+TUNING.handImpact.height,z:side==='left'?11:12});
        assert.deepEqual(counts,[speed===0?4:6,TUNING.handImpact.fineCount]);
        assert.equal(emitter.sprayTime,0);assert.equal(emitter.sprayRate,0);assert.equal(emitter.sprayCarry,0);
        assert.equal(emitter.keepAlive,TUNING.handImpact.lifetimeMax);
    }
});

test('绑定水滴材质保留手部可见长度，不覆盖成脚部短水滴', () => {
    const fn=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='applyParticleTexture');
    const {applyParticleTexture:apply}=evaluate('export '+fn.getText(source),{TUNING,getSplashParticleTexture:()=>({}),getSplashParticleMaterial:()=>({})});
    const hand={renderer:{},processor:{updateMaterialParams(){}}};
    const leg={renderer:{},processor:{updateMaterialParams(){}}};
    apply(hand,'spray','hand');apply(leg,'spray','leg');
    assert.equal(hand.renderer.lengthScale,TUNING.handImpact.lengthScale);
    assert.equal(leg.renderer.lengthScale,TUNING.particleSystem.stretchLengthScale);
    assert(hand.renderer.lengthScale>leg.renderer.lengthScale);
});

test('水滴与水片消费同一次真实接触，前伸信号不会提前喷发', () => {
    const {Vec3}=createHarness();
    const Subject=method('updateParticleEmitters',{lerp:(a,b,t)=>a+(b-a)*t,clamp:(v,a,b)=>Math.max(a,Math.min(b,v))});
    const h=new Subject(),hits=[];h._tmpWorld=new Vec3();
    h._leftHandImpact={triggered:false,point:new Vec3(3,.15,5)};h._rightHandImpact={triggered:false};
    h._state={leftHandWaterContact:1,leftHandWaterEntry:1,leftHandWaterProgress:0};
    h._armSplashBurst=0;h._splashBurst=0;
    h._particleEmitters=['spray','plume'].map(visual=>({role:'hand',side:'left',visual,cooldown:1,node:{setWorldPosition:p=>assert.equal(p.x,3)}}));
    h.positionParticleEmitter=()=>{};h.emitSprayFrame=()=>{};
    h.playHandImpact=()=>hits.push('spray');h.playParticleBurst=()=>hits.push('plume');
    h.updateParticleEmitters(.5);assert.equal(hits.length,0);
    h._leftHandImpact.triggered=true;h.updateParticleEmitters(.5);
    assert.deepEqual(hits,['spray','plume'],'判定反馈的冷却不吞掉真正接触');
});

test('正反向游动的左右手飞溅轴均向外后方抬起', () => {
    const {Node,Vec3}=createHarness();
    const Subject=method('playHandImpact',{lerp:(a,b,t)=>a+(b-a)*t,setCurveRange:()=>{},setCurveRangeTwoConstants:()=>{}});
    for(const direction of [1,-1]) for(const side of ['left','right']) {
        const h=new Subject();h.node={active:true};h._waterY=0;h._tmpWorld=new Vec3();h._state={movementDirection:direction};
        h._leftHandImpact=h._rightHandImpact={point:new Vec3()};
        const node=new Node();node.setWorldPosition=()=>{};
        const emitter={side,node,system:{shapeModule:{},play(){},emit(){}}};
        h.playHandImpact(emitter,.5);
        const axis=new Vec3();Vec3.transformMat4(axis,new Vec3(0,0,-1),node.worldMatrix);
        assert(axis.x*direction<-.3,'主要朝后');
        assert(axis.z*(side==='left'?-1:1)*direction>.3,'主要朝该手外侧');
        assert(axis.y>.3,'先向上飞溅，再由重力落回');
    }
});
