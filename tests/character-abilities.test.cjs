const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const analysis = require('../scripts/analyze-stroke-efficiency.cjs');
const { load } = analysis;
const { SwimmerMotor } = load('swimmer/SwimmerMotor');
const { CharacterAbilityState } = load('swimmer/CharacterAbilityState');
const { CHARACTER_ABILITY_TUNING: tuning, abilityValue } = load('core/CharacterAbilityConfig');
const { StrokeType } = load('core/GameConstants');
const { PLAYER_CHARACTER_DEFINITIONS: roster } = load('app/PlayerCharacterConfig');
const { resolveModifiersFromDigest, applyRaceModifiersToMotor } = load('progression/RaceModifiers');
const near = (a, b, e = 1e-8) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);

function motor(id = 'none') { const m = new SwimmerMotor(); m.setCharacterAbility(id); m.startRace(10, 2); return m; }
function stroke(m, progress = .375, side = StrokeType.LEFT) {
    m.setStrokeHeld(side, true, .25);
    assert.equal(m.recordStroke(side), true);
    const action = (side === StrokeType.LEFT ? m._leftActions : m._rightActions)[0];
    action.progress = progress * Math.PI * 2;
    const result = m.setStrokeHeld(side, false);
    return { result, action };
}

test('全角色能力按稳定ID解析；重开清状态、重绑同角色保留状态、换角色清状态', () => {
    assert.equal(new Set(roster.map(c => c.abilityId)).size, 11);
    for (const character of roster) {
        const m = motor();
        const profile = resolveModifiersFromDigest({ characterId: character.id, level: 30 });
        applyRaceModifiersToMotor(m, profile);
        assert.equal(m.ability.id, character.abilityId);
        near(m.weight, character.weight);
        m.ability.depth = .7; m.ability.stacks = 4;
        applyRaceModifiersToMotor(m, profile); near(m.ability.stacks, 4);
        m.startRace(); near(m.ability.depth, 0); near(m.ability.stacks, 0);
        assert.equal(m.ability.id, character.abilityId);
        applyRaceModifiersToMotor(m, resolveModifiersFromDigest({ characterId: 'unknown', level: 30 }));
        assert.equal(m.ability.id, 'none'); near(m.ability.depth, 0);
    }
});

test('机甲玩家和AI划水不扣体力，仍受心率影响；切回普通角色立即恢复扣费', () => {
    for (const name of ['PlayerConditionModel', 'AiConditionModel']) {
        const C = load('condition/' + name)[name], c = new C(); c.setInfiniteStamina(true); c.reset();
        const initial = c.energy;
        for (let i = 0; i < 500; i++) name === 'PlayerConditionModel'
            ? c.updateFromStroke({ strokeAccepted: true }) : c.consumeStrokes(1);
        c.consumeEnergy(999); near(c.energy, initial); near(c.energyRatio, 1);
        assert.equal(c.energyDepleted, false);
        c.setInfiniteStamina(false); c.consumeEnergy(999); near(c.energy, 0);
        assert.equal(c.energyDepleted, true);
    }
    const m = motor('exoskeleton'); assert.equal(m.ability.allowsDolphin, false);
    for (let i = 0; i < 40; i++) { m._heartRate.recordStart(); m._heartRate.tick(.2); }
    assert.ok(m.heartRate > 100);
});

test('蛙妹与忍者哥完美区、实际判定、HUD一致；窗口不跨出GOOD', () => {
    for (const id of ['frogSense', 'precision']) for (const hr of [80, 180]) {
        const m = motor(id); m.applyAuthoritativeHeartRate(hr, true); m.update(.3, { isAI: false });
        m.setStrokeHeld(StrokeType.LEFT, true, .2); m.recordStroke(StrokeType.LEFT);
        const action = m._leftActions[0], guide = m.strokeTimingGuideForSide(StrokeType.LEFT);
        const perfect = guide.intervals.find(i => i.rating === load('core/GameConstants').Rating.PERFECT);
        near(perfect.startRatio, action.ranges.perfect.start); near(perfect.endRatio, action.ranges.perfect.end);
        assert.ok(action.ranges.perfect.start >= action.ranges.good.start);
        action.progress = action.ranges.perfect.start * Math.PI * 2;
        assert.equal(m.setStrokeHeld(StrokeType.LEFT, false).strokeQuality, 1);
    }
    const neutral = motor(), frog = motor('frogSense'), ninja = motor('precision');
    for (const m of [neutral, frog, ninja]) { m.update(.3, { isAI: false }); stroke(m); }
    assert.ok(frog._strokeAcceleration < neutral._strokeAcceleration);
    assert.ok(ninja._strokeAcceleration > neutral._strokeAcceleration);
});

test('超级腿踢腿更快但手划更弱；飞毛腿只加强蹬墙；肌肉男保持原运动规则', () => {
    const normal = motor(), legs = motor('powerKick');
    for (let i = 0; i < 1200; i++) {
        if (i % 15 === 0) for (const m of [normal, legs]) m.recordKickTap(StrokeType.LEFT);
        for (const m of [normal, legs]) m.update(1 / 60, { isAI: false });
    }
    assert.ok(legs.currentSpeed > normal.currentSpeed * 1.08);
    near(legs.heartRate, normal.heartRate);
    const weak = motor('powerKick'), wall = motor('wallKick'), heavy = motor('heavyBody');
    for (const m of [weak, wall, heavy]) { m.update(.3, { isAI: false }); stroke(m); }
    assert.ok(weak._leftActions[0].propulsionScale < heavy._leftActions[0].propulsionScale);
    assert.ok(wall.burstWallLaunchSpeedScale > heavy.burstWallLaunchSpeedScale);
    near(wall.burstLaunchSpeedScale, heavy.burstLaunchSpeedScale);
    near(heavy._leftActions[0].propulsionScale, 1);
});

test('教练适中划频降低心率，高频取消优势；猫姐碰撞角动量更快衰减', () => {
    for (const hz of [1.5, 4]) {
        const base = motor(), coach = motor('breathControl');
        for (let i = 0; i < 100; i++) for (const m of [base, coach]) { m._heartRate.recordStart(); m._heartRate.tick(1 / hz); }
        if (hz < 2) assert.ok(coach.heartRate < base.heartRate - 10); else near(coach.heartRate, base.heartRate, .5);
    }
    const a = motor(), b = motor('catBalance');
    for (const m of [a, b]) { m.applyCollisionAxialImpulse(12); m.applyCollisionPitchImpulse(8); }
    for (let i = 0; i < 30; i++) for (const m of [a, b]) m.update(1 / 60, { isAI: false });
    assert.ok(Math.abs(b.axialRollAngularVelocity) < Math.abs(a.axialRollAngularVelocity));
});

test('潜水哥不会点一下立即免碰撞，持续踢腿下潜，手划和停踢上浮，池壁仍约束', () => {
    for (const fps of [30, 60, 120]) {
        const m = motor('kickDive'); m.setLateralOffsetBounds(-1, 1);
        m.recordKickTap(StrokeType.LEFT); assert.equal(m.ability.ignoresSwimmers, false);
        m.update(1 / fps, { isAI: false }); assert.equal(m.ability.ignoresSwimmers, false);
        for (let i = 0; i < fps; i++) { if (i % (fps / 5) === 0) m.recordKickTap(StrokeType.LEFT); m.update(1 / fps, { isAI: false }); }
        near(m.ability.depth, tuning.diverDepth); assert.equal(m.ability.ignoresSwimmers, true);
        assert.equal(m.ability.allowsDolphin, false);
        m.setStrokeHeld(StrokeType.LEFT, true, .2); m.recordStroke(StrokeType.LEFT);
        for (let i = 0; i < fps; i++) m.update(1 / fps, { isAI: false });
        near(m.ability.depth, 0); assert.equal(m.ability.ignoresSwimmers, false);
        assert.ok(Math.abs(m.lateralOffset) <= 1);
        m.ability.depth = .8; m.setGlidePhase(true); m.update(.1, { isAI: false }); near(m.ability.depth, 0);
    }
    const a = new CharacterAbilityState(), b = new CharacterAbilityState();
    for (const state of [a,b]) { state.configure('kickDive'); state.kick(); }
    a.tick(1, false); for (let i=0;i<120;i++) b.tick(1/120,false); near(a.depth,b.depth);
});

test('风火轮连续PERFECT叠至上限，GOOD/BAD/超时清零，短按与重复结算不刷层', () => {
    const m = motor('perfectChain'); m._physics.step = s => s;
    m.update(.3, { isAI: false });
    for (let i = 0; i < 7; i++) {
        const side = i % 2 ? StrokeType.RIGHT : StrokeType.LEFT;
        stroke(m, .375, side);
        const stacks = m.ability.stacks;
        assert.equal(m.setStrokeHeld(side, false), null); near(m.ability.stacks, stacks);
        for (let n=0;n<24;n++) m.update(.3/24, { isAI: false });
    }
    near(m.ability.stacks, 5);
    assert.ok(m.chainPropulsionScale() > 1);
    stroke(m, .2, StrokeType.RIGHT); near(m.ability.stacks, 0);
    m.ability.settle(1, 1); m.setGlidePhase(true); m.update(5, { isAI: false }); near(m.ability.stacks, 1);
    m.setGlidePhase(false); m.update(5, { isAI: false }); near(m.ability.stacks, 0);
    m.startRace(10,2); m.ability.settle(1,1); m.update(.3,{isAI:false});
    m.setStrokeHeld(StrokeType.LEFT,true,.2);m.recordStroke(StrokeType.LEFT);
    m._leftActions[0].progress=.9*Math.PI*2; m.update(.01,{isAI:false}); near(m.ability.stacks,0);
    m.ability.settle(1,1);m.stopRace();near(m.ability.stacks,0);
});

test('三条同步通道保留下潜和连击；非法值安全降级，远端不由本地输入覆盖深度', () => {
    const net = load('net/NetRaceSnapshot'), frame = load('net/NetRaceInput');
    const codec = load('net/NetCharacterAbilityCodec');
    const entry = { lane:1,distance:12,lateral:0,finished:false,heading:0,headingVelocity:0,speed:2,energy:50,
        axialRoll:0,axialRollVelocity:0,collisionPitch:0,collisionPitchVelocity:0,conditionEnergyRatio:1,conditionHeartRate:100,
        abilityState:{depth:.8,kickRemaining:.35,stacks:5,idleRemaining:.62} };
    const states = [net.decodeRaceSnapshot(net.encodeRaceSnapshot(0,[entry])).entries[0],
        net.decodeSelfSnapshot(net.encodeSelfSnapshot(entry,3,1)),frame.decodeInputFrame(frame.encodeInputFrame(1,[],entry,3,2)).self];
    for (const result of states) assert.equal(JSON.stringify(result.abilityState),JSON.stringify(entry.abilityState));
    for (const token of ['NaN:0:0:0','-1:0:0:0','1:2:3','Infinity:0:0:0']) near(codec.decodeCharacterAbility(token).depth,0);
    const m = motor('kickDive');m.ability.applySnapshot(states[0].abilityState,true);
    m.ability.armStart();m.ability.tick(5,true);m.ability.suspend();near(m.ability.depth,.8);
    m.ability.applySnapshot({depth:0,kickRemaining:0,stacks:0,idleRemaining:0},true);near(m.ability.depth,0);
    m.ability.reset();m.ability.kick();m.ability.tick(.5,false);assert.ok(m.ability.depth>.4);
    const chain = motor('perfectChain');chain.ability.applySnapshot(states[0].abilityState,false);
    chain.ability.tick(.3,false);chain.ability.applySnapshot(states[0].abilityState,false);
    near(chain.ability.idleRemaining,.32); // 缓存快照不反复续命，房主迁移能继续计时。
});

// 执行真实实体入口和阶段控制器；仅替换渲染组件，验证能力没有绕过原有阶段/扣费保护。
function bodyFixture(id) {
    const { createHarness } = require('./helpers/cocos-math-harness.cjs');
    const h = createHarness();
    const tsPath = process.env.PATH.split(path.delimiter).map(dir => path.resolve(dir,'../typescript/lib/typescript.js')).find(p=>fs.existsSync(p));
    const ts = require(tsPath);
    const file = path.join(h.root,'assets/scripts/entity/Swimmer.ts');
    const source = ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    const decl = source.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='Swimmer');
    const names = ['tryDolphinJump','applyAcceptedNetDolphinJump','isCollisionActive','applyCoursePosition','motor','courseLayout','startPosition','playFinishTouch','handleKickStroke','confirmKickStroke','canUseDolphinAbility'];
    const members = decl.members.filter(n=>names.includes(n.name?.getText(source)));
    assert.equal(members.length,names.length);
    const { DOLPHIN_JUMP } = load('core/DolphinJumpConfig');
    const { getRaceDistance } = load('core/GameBalance');
    const js = ts.transpileModule(`class Body {${members.map(n=>n.getText(source)).join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
    const Body = vm.runInNewContext(js+';Body',{DOLPHIN_JUMP,abilityValue,getRaceDistance,Quat:h.cc.Quat,Tween:{stopAllByTarget(){}}});
    const body = new Body(); body._motor = motor(id); body.node = new h.cc.Node(); body.node.active = true;
    body._courseLayout = load('venue/RaceCourseLayout').DEFAULT_RACE_COURSE_LAYOUT;
    body._startPosition = new h.cc.Vec3();
    body._tmpCourseRotation = new h.cc.Quat(); body._cameraNeutralCourseRotation = new h.cc.Quat();
    body.cartoonRig = {axialRollVisualWeight:1,setDiveStreamlinePose(){},setLegSplashSuppressed(){},setPerfectGlowActive(){},triggerSplashBurst(){},finishDiveChargeEffect(){},setFinishFloating(){}};
    body.finishFloatX = () => 0;
    body._ultimate = new (load('condition/UltimateEnergyModel').UltimateEnergyModel)(); body._ultimate.applyNetEnergy(100,1);
    body._phases = new (load('entity/SwimmerRacePhases').SwimmerRacePhases)(body);
    const condition = new (load('condition/PlayerConditionModel').PlayerConditionModel)();
    body.onDolphinJumpEnergyCost = cost => condition.consumeEnergy(cost);
    return {body, condition};
}

test('实际实体：机甲按钮和远端回放均禁跳；蛙少短跳低扣费；失败/重复不扣费', () => {
    const mech = bodyFixture('exoskeleton');
    assert.equal(mech.body.tryDolphinJump(),false); assert.equal(mech.body.applyAcceptedNetDolphinJump(),false);
    near(mech.condition.energy,100); near(mech.body._ultimate.energy,100);
    const normal = bodyFixture('none'), frog = bodyFixture('frogHop');
    for (const fixture of [normal,frog]) {
        assert.equal(fixture.body.tryDolphinJump(),true);
        const remaining = fixture.condition.energy;
        assert.equal(fixture.body.tryDolphinJump(),false);near(fixture.condition.energy,remaining);
        assert.equal(fixture.body.applyAcceptedNetDolphinJump(),false);near(fixture.condition.energy,remaining);
    }
    near(normal.condition.energy,95);near(frog.condition.energy,98);
    assert.ok(frog.body._phases._dolphinHorizontalSpeed < normal.body._phases._dolphinHorizontalSpeed);
    const energy = load('condition/UltimateEnergyModel').UltimateEnergyModel;
    const a = new energy(), b = new energy(); b.setAbilityGainScale(tuning.frogEnergyGain);
    a.tick(1);b.tick(1);near(b.energy,a.energy*tuning.frogEnergyGain);
});

test('实际实体：下潜深度同时驱动Y和碰撞，未够深不免碰撞，上浮恢复，脚本潜水不叠深度', () => {
    const {body} = bodyFixture('kickDive'), ability = body.motor.ability;
    body.applyCoursePosition(10);const surface = body.node.position.y;
    for (const depth of [0,.1,.44,.45,.8,.3,0]) {
        ability.depth=depth;body.applyCoursePosition(10);near(body.node.position.y,surface-depth);
        assert.equal(body.isCollisionActive,depth<tuning.diverCollisionDepth);
    }
    ability.depth=.8;assert.equal(body.tryDolphinJump(),false);
    body._phases.startDiveUnderwaterPhase();body.applyCoursePosition(10);
    near(body.node.position.y,body._phases.visualSwimY());assert.equal(body.isCollisionActive,false);
    body._phases.clearDiveUnderwaterPhase();ability.depth=.8;body.applyCoursePosition(10);
    body.playFinishTouch();near(body.node.position.y,body._startPosition.y+.01);near(ability.depth,0);
});

test('潜水哥水面、水下、上浮及重开后均禁海豚跳，按钮与回放一致且不扣资源', () => {
    const {body,condition} = bodyFixture('kickDive');
    const heartRate = body.motor.heartRate;
    for (const depth of [0,.8,.3,0]) {
        body.motor.ability.depth = depth;
        assert.equal(body.canUseDolphinAbility,false);
        assert.equal(body.tryDolphinJump(),false);
        assert.equal(body.applyAcceptedNetDolphinJump(),false);
        near(condition.energy,100);near(body._ultimate.energy,100);near(body.motor.heartRate,heartRate);
        assert.equal(body._phases.isDolphinJumpActive,false);
    }
    body.motor.startRace(10,2);
    assert.equal(body.canUseDolphinAbility,false);
    assert.equal(body.applyAcceptedNetDolphinJump(),false);
    body.motor.setCharacterAbility('frogHop');
    assert.equal(body.canUseDolphinAbility,true);
    body.motor.setCharacterAbility('kickDive');
    assert.equal(body.canUseDolphinAbility,false);
});

test('实际实体：按下反馈不改变潜水深度和Y，短按确认不重复推进，脚本阶段不能确认潜航', () => {
    const {body} = bodyFixture('kickDive');
    body.cartoonRig.triggerKick = () => {};
    body.applyCoursePosition(10); const surfaceY = body.node.position.y;
    for (let i = 0; i < 20; i++) {
        body.handleKickStroke(StrokeType.LEFT, false);
        body.motor.update(1 / 60, {isAI:false}); body.applyCoursePosition(body.motor.distance);
        near(body.motor.ability.depth, 0); near(body.node.position.y, surfaceY);
        assert.equal(body.isCollisionActive, true);
    }
    const speed = body.motor.currentSpeed, cadence = body.motor.kickCadenceHz;
    body.confirmKickStroke(); near(body.motor.currentSpeed, speed); near(body.motor.kickCadenceHz, cadence);
    body.motor.update(.2, {isAI:false}); body.applyCoursePosition(body.motor.distance);
    assert.ok(body.motor.ability.depth > 0); assert.ok(body.node.position.y < surfaceY);
    body.motor.ability.reset(); body._phases.startDiveUnderwaterPhase();
    body.confirmKickStroke(); near(body.motor.ability.kickRemaining,0);
    body._phases.clearDiveUnderwaterPhase();
    body.motor.ability.applySnapshot({depth:.6,kickRemaining:.2,stacks:0,idleRemaining:0},true);
    body.handleKickStroke(StrokeType.RIGHT,false);body.confirmKickStroke();
    near(body.motor.ability.depth,.6);near(body.motor.ability.kickRemaining,.2);
});

test('真实输入回放：风火轮满层在30/60/120Hz与1/30级均提升约一成普通游速', () => {
    for (const level of [1,30]) for (const fps of [30,60,120]) {
        const profile = resolveModifiersFromDigest({characterId:'cartonSwimmer14',level});
        const opts = {playerBalance:profile.balance,fps,heartRate:180};
        const base = analysis.replay(.375,true,false,opts);
        const chain = analysis.replay(.375,true,false,{...opts,abilityId:'perfectChain'});
        const gain = chain.meanSpeed/base.meanSpeed-1;
        assert.ok(gain>=.09&&gain<=.13,`${level}/${fps}: ${gain}`);
        assert.equal(chain.bad+chain.good,0);
    }
});
