const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createAiHarness } = require('./helpers/ai-race-harness.cjs');

function harness() {
    const h = createAiHarness();
    const load = name => h.load(name);
    return { h, ...load('tutorial/TutorialLesson'), ...load('core/GameConstants'), ...load('tutorial/TutorialSession') };
}

test('课程必须按真实操作推进，错误侧/失误/长按不计入对应练习', () => {
    const { TutorialLesson, GameState: S, StrokeType: T, Rating: R } = harness();
    const lesson = new TutorialLesson();
    assert.equal(lesson.paused, true); assert.equal(lesson.allowsStroke(T.LEFT), false);
    assert.equal(lesson.step,'diveInfo','进场只有一次起跳说明');
    lesson.advance(); lesson.tick(1, S.GLIDING, true); assert.equal(lesson.step, 'flight');
    lesson.tick(1, S.RACING, true); assert.equal(lesson.step, 'flight');
    lesson.tick(1, S.RACING, false); assert.equal(lesson.step, 'leftInfo');
    lesson.advance();
    lesson.stroke(T.RIGHT, R.PERFECT); lesson.stroke(T.LEFT, R.BAD); lesson.tick(1, S.RACING, false);
    assert.equal(lesson.step, 'left');
    for(let i=0;i<6;i++) {
        const side=i%2?T.RIGHT:T.LEFT, wrong=i%2?T.LEFT:T.RIGHT;
        const active=i%2?'right':'left';
        assert.equal(lesson.step,active);
        assert.equal(lesson.allowsStroke(wrong),false,'必须自己切到另一侧，不能连划同侧');
        assert.equal(lesson.stroke(wrong,R.PERFECT),false);
        assert.equal(lesson.stroke(side,R.BAD),false);lesson.kick(side);
        lesson.tick(2,S.RACING,false);
        assert.equal(lesson.guidedStrokeCount,i,'错误侧、失误和踢水不能推进引导');
        assert.equal(lesson.step,active);
        assert.equal(lesson.stroke(side,R.GOOD),true);
        assert.equal(lesson.guidedStrokeCount,i+1);
        assert.equal(lesson.showingSuccess,true);
        assert.equal(lesson.stroke(side,R.GOOD),false,'反馈期间不能重复计数');
        lesson.tick(.8,S.RACING,false);
        if(i===0) {assert.equal(lesson.step,'rightInfo');lesson.advance();}
        else if(i<5)assert.equal(lesson.paused,false,'后两轮换侧只更新提示，不反复弹窗');
    }
    assert.equal(lesson.step,'alternateInfo');lesson.advance();
    assert.equal(lesson.step,'alternate');
    for(let i=0;i<6;i++) {
        const side=i%2?T.RIGHT:T.LEFT;
        lesson.stroke(side,R.GOOD);lesson.stroke(side,R.PERFECT);
        assert.equal(lesson.count,i+1,'重复同侧不计入交替练习');
    }
    lesson.tick(.8,S.RACING,false);
    assert.equal(lesson.step, 'kickInfo'); lesson.advance();
    lesson.stroke(T.LEFT, R.PERFECT); assert.equal(lesson.count, 0);
    lesson.kick(T.LEFT); lesson.kick(T.LEFT); assert.equal(lesson.count, 1);
    lesson.kick(T.RIGHT); lesson.kick(T.LEFT); lesson.kick(T.RIGHT); lesson.tick(1, S.RACING, false);
    assert.equal(lesson.step, 'turnInfo'); assert.equal(lesson.paused, true);
    lesson.advance();
    lesson.observeCourse(51,50,false,false); assert.equal(lesson.step,'turn','不能用距离替代真实折返');
    lesson.observeCourse(49,50,true,false);
    lesson.observeCourse(52,50,false,true); assert.equal(lesson.step,'turn');
    lesson.observeCourse(55,50,false,false); assert.equal(lesson.step,'heart');
    const exercise = (info, active, next) => {
        assert.equal(lesson.step, info);
        if (lesson.paused) lesson.advance();
        assert.equal(lesson.step, active);
        const count = lesson.targetCount;
        for (let i=0;i<count;i++) lesson.stroke(i%2 ? T.RIGHT:T.LEFT, lesson.heartExperience ? R.BAD:R.GOOD);
        assert.equal(lesson.step, active); lesson.tick(.8,S.RACING,false); assert.equal(lesson.step,next);
    };
    exercise('heart','heartLow','heartWork');
    exercise('heartWork','heartWork','heartHigh');
    exercise('heartHigh','heartHigh','heartMax');
    exercise('heartMax','heartMax','rest');
    assert.equal(lesson.allowsArmStroke, false);
    for(let i=0;i<4;i++)lesson.kick(i%2?T.RIGHT:T.LEFT);
    lesson.tick(6,S.RACING,false,130); assert.equal(lesson.step,'rest');
    lesson.tick(.1,S.RACING,false,99); assert.equal(lesson.step,'heartRecovery');
    assert.equal(lesson.count,0,'直接进入恢复对照时必须清零踢水计数');
    exercise('heartRecovery','heartRecovery','dolphinApproach');
    lesson.observeCourse(98,50,false,false); assert.equal(lesson.step,'dolphinApproach');
    lesson.observeCourse(102,50,false,true); assert.equal(lesson.step,'dolphinApproach');
    lesson.observeCourse(106,50,false,false); assert.equal(lesson.step,'dolphinInfo');
    lesson.advance(); lesson.observeDolphin(false,false,false,false); assert.equal(lesson.step,'dolphinCharge');
    lesson.stroke(T.LEFT,R.GOOD); lesson.stroke(T.RIGHT,R.GOOD);
    lesson.observeDolphin(true,false,true,false); assert.equal(lesson.step,'dolphinCharge');
    lesson.observeDolphin(true,false,false,false); assert.equal(lesson.step,'dolphin');
    assert.equal(lesson.paused,false,'满气直接开放按钮，不再二次确认');
    lesson.observeDolphin(false,true,false,false); assert.equal(lesson.step,'dolphinFlight');
    lesson.observeDolphin(false,false,true,false); assert.equal(lesson.step,'dolphinFlight');
    lesson.observeDolphin(false,false,false,false); assert.equal(lesson.step,'practice');
    assert.equal(lesson.count,0,'海豚落水衔接必须重新开始交替练习');
    exercise('practice','practice','finalApproach');
    lesson.observeCourse(153,50,false,true); assert.equal(lesson.step,'finalApproach');
    lesson.observeCourse(156,50,false,false); assert.equal(lesson.step,'staminaRun');
    lesson.beginStaminaExperience(null);
    assert.equal(lesson.paused,false,'先体验动作变慢，不立即弹出说明');
    exercise('staminaEmpty','staminaEmpty','staminaEmptyInfo');
    lesson.advance();assert.equal(lesson.step,'finish');
    lesson.tick(100,S.RACING,false); assert.equal(lesson.step,'finish');
    lesson.touchFinish(); assert.equal(lesson.step,'finishTouch');
    lesson.tick(1.2,S.RACING,false); assert.equal(lesson.step,'complete'); assert.equal(lesson.paused,true);
});

test('专属教学无触壁结算，暂停时选手、AI、倒计时不推进，普通比赛不受影响', () => {
    const { h, TUTORIAL_RUNTIME: runtime, GameState: S } = harness();
    const { RaceManager } = h.load('core/RaceManager');
    const { getRaceDistance, isRaceSteeringEnabled, setRaceDifficulty } = h.load('core/GameBalance');
    const race = new RaceManager(); race._state = S.COUNTDOWN; race._countdownTimer = 3;
    const { body, ai } = h.create(); let bodySteps = 0, aiSteps = 0;
    body.stepSimulation = () => bodySteps++; ai.stepSimulation = () => aiSteps++;
    runtime.active = true; runtime.paused = true;
    race.update(1); body.update(1); ai.update(1);
    assert.equal(race._countdownTimer, 3); assert.equal(bodySteps, 0); assert.equal(aiSteps, 0);
    assert.equal(getRaceDistance(), 200); assert.equal(isRaceSteeringEnabled(), false);
    race.tutorialMode = true; race._state = S.RACING;
    race.playerSwimmer = { distance: 2000000 }; race.trackFinishers(1000);
    assert.equal(race._playerFinished, false);
    runtime.active = false; runtime.paused = false; race._state = S.COUNTDOWN;
    race.update(1); body.update(1); ai.update(1);
    assert.equal(race._countdownTimer, 2); assert.equal(bodySteps, 1); assert.equal(aiSteps, 1);
    setRaceDifficulty('beginner'); assert.equal(getRaceDistance(), 200);
});

test('教学请求只消费一次，未完成中断不产生账号完成状态', () => {
    const { requestTutorial, consumeTutorialRequest, TutorialLesson } = harness();
    assert.equal(consumeTutorialRequest(), false);
    requestTutorial(); assert.equal(consumeTutorialRequest(), true); assert.equal(consumeTutorialRequest(), false);
    const interrupted = new TutorialLesson(); interrupted.advance();
    assert.equal(new TutorialLesson().step, 'diveInfo');
});

function controllerFixture() {
    const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
    const h = createAiHarness();
    const {TutorialLesson} = h.load('tutorial/TutorialLesson');
    const {TUTORIAL_RUNTIME: runtime} = h.load('tutorial/TutorialSession');
    const {GameState,StrokeType,Rating} = h.load('core/GameConstants');
    const time = h.load('core/TimeScale');
    runtime.active = true;
    let scale = 1, resets = 0, leaves = 0, writes = 0, resolveSave, rejectSave;
    const frames = [];
    class Overlay {
        show(...args) { frames.push(args); }
        setStage(text) { this.stage = text; }
        setCue(text) { this.cue = text; }
        dispose() { this.disposed = true; }
    }
    const source = fs.readFileSync(path.join(__dirname, '../assets/scripts/tutorial/TutorialRaceController.ts'), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const module = { exports: {} };
    const profile = { tutorialCompleted: false };
    const imports = {
        cc: { director: { getScheduler: () => ({ setTimeScale: value => scale = value }), getScene: () => null } },
        '../backend/PlayerData': { PlayerData: { profile, completeTutorial: () => { writes++; return new Promise((resolve, reject) => { resolveSave = resolve; rejectSave = reject; }); } } },
        './TutorialLesson': { TutorialLesson }, './TutorialContent': h.load('tutorial/TutorialContent'), './TutorialOverlay': { TutorialOverlay: Overlay },
        './TutorialSession': h.load('tutorial/TutorialSession'),
        '../core/TimeScale': time, '../core/GameConstants': {GameState,StrokeType,Rating},
    };
    vm.runInNewContext(output, { module, exports: module.exports, require: key => imports[key] ?? {} });
    const {body: swimmer} = h.create(); swimmer.isAI = false; const race = {};
    const condition = new (h.load('condition/PlayerConditionModel').PlayerConditionModel)();
    const refreshHud = () => {
        for(const event of swimmer.consumeConditionInputs())condition.updateFromStroke(event);
        condition.syncHeartRate(swimmer.heartRate); condition.tick(0);
        swimmer.applyConditionSpeedScale(condition.efficiencyModifier);
        swimmer.applyConditionCadenceScale(condition.strokeCadenceScale);
    };
    const controller = new module.exports.TutorialRaceController({children:[]}, swimmer, race, () => resets++, () => leaves++, condition, refreshHud);
    return { h, controller, swimmer, race, runtime, frames, GameState, StrokeType, Rating, time, condition, refreshHud, profile,
        get scale() { return scale; }, get resets() { return resets; }, get leaves() { return leaves; }, get writes() { return writes; },
        resolve: () => resolveSave(), reject: () => rejectSave(Error('离线')) };
}

test('教学面板无逐帧文案更新，完成防重入、意外保存失败仍返回及销毁释放暂停', async () => {
    const f = controllerFixture();
    assert.equal(f.scale, 0); assert.equal(f.race.tutorialMode, true);
    const initialFrames = f.frames.length;
    for (let i = 0; i < 120; i++) f.controller.update(1 / 60, f.GameState.PRECOUNTDOWN);
    assert.equal(f.frames.length, initialFrames); assert.equal(f.resets, 1);
    f.controller.lesson.step = 'complete'; f.controller.update(0, f.GameState.RACING);
    const save = f.frames.at(-1)[4]; save(); save(); assert.equal(f.writes, 1);
    f.reject(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.leaves, 1); assert.equal(f.profile.tutorialCompleted, true);
    assert.equal(f.frames.at(-1)[3], '回大厅，开游！');
    assert.ok(!f.frames.some(frame => /保存|正在记下/.test(frame[1])),'教学完成不出现阻塞保存界面');
    f.controller.dispose(); f.controller.dispose();
    assert.equal(f.scale, 1); assert.equal(f.runtime.paused, false);
    assert.equal(f.runtime.active, false); assert.equal(f.swimmer.onObservedRhythmResult, null);
});

test('返回失败保持输入锁；保存途中销毁后迟到响应不再导航', async () => {
    const f = controllerFixture(); f.controller.lesson.step = 'practice';
    f.controller.returnFailed(); assert.equal(f.controller.paused, true);
    assert.equal(f.controller.allowsStroke('left'), false);
    f.controller.update(100, f.GameState.RACING); assert.equal(f.scale, 0);
    f.controller.dispose();
    const g = controllerFixture(); g.controller.lesson.step = 'complete'; g.controller.update(0, g.GameState.RACING);
    g.frames.at(-1)[4](); g.controller.dispose(); g.resolve();
    await new Promise(resolve => setImmediate(resolve)); assert.equal(g.leaves, 0); assert.equal(g.scale, 1);
});

test('教学高亮跨不同 Canvas 相机转换实际控件边界，不把输入向量误用成输出', () => {
    const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
    class Canvas {} class UITransform {}
    class Vec3 { constructor(x=0,y=0,z=0) { Object.assign(this,{x,y,z}); } }
    class Rect { constructor(x,y,width,height) { Object.assign(this,{x,y,width,height}); } }
    let sourceReady=false,targetReady=false;
    const sourceCamera = { camera:{update(){sourceReady=true;}}, worldToScreen(input, out) {
        Object.assign(out,sourceReady?{x:input.x*2+1000,y:input.y*2+500}:{x:0,y:0});return out;
    } };
    const targetCamera = { camera:{update(){targetReady=true;}}, screenToWorld(input, out) {
        Object.assign(out,targetReady?{x:(input.x-300)/2,y:(input.y-100)/2}:{x:0,y:0});return out;
    } };
    const sourceCanvas = { parent:null,getComponent:C=>C===Canvas?{cameraComponent:sourceCamera}:null };
    const targetCanvas = { parent:null,getComponent:C=>C===Canvas?{cameraComponent:targetCamera}:null };
    const target = { isValid:true,parent:sourceCanvas,getComponent:C=>C===UITransform?
        {width:352,height:102,convertToWorldSpaceAR:v=>new Vec3(v.x+100,v.y+200)}:null };
    const root = { parent:targetCanvas,getComponent:C=>C===UITransform?
        {convertToNodeSpaceAR:v=>new Vec3(v.x-50,v.y-75)}:null };
    const module = { exports:{} };
    const js = ts.transpileModule(fs.readFileSync(path.join(__dirname,'../assets/scripts/tutorial/TutorialOverlay.ts'),'utf8'),
        {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
    vm.runInNewContext(js,{module,exports:module.exports,require:key=>key==='cc'?{Canvas,UITransform,Vec3,Rect}:{}});
    const view = Object.create(module.exports.TutorialOverlay.prototype);view.root=root;view.target=target;
    const rect = view.targetRect();
    assert.deepEqual([rect.x,rect.y,rect.width,rect.height],[212,262,376,126]);
    target.isValid=false;assert.equal(view.targetRect(),null);
});

test('场景入口拒绝把教学带入联机、房间或调试，普通单机保留赛事票据', () => {
    const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
    const code=fs.readFileSync(path.join(__dirname,'../assets/scripts/core/GameManager.ts'),'utf8');
    const ast=ts.createSourceFile('GameManager.ts',code,ts.ScriptTarget.Latest,true);
    const cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='GameManager');
    const method=cls.members.find(n=>n.name?.getText(ast)==='initializeRaceContext').getText(ast);
    const js=ts.transpileModule(`class Entry { ${method} }; module.exports=Entry`,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
    function entry({net=null,room=false,debug=false,requested=true,allowed=true}={}) {
        const state={active:false,paused:false},ai={opponentCount:1};let count=0,selectedAi=null;
        const ticket={distance:400,ai:{opponentCount:7},seed:7},module={exports:{}};
        vm.runInNewContext(js,{module,consumeRoomMode:()=>room,consumeNetRaceSession:()=>net,
            consumeTutorialRequest:()=>{count++;return requested;},TUTORIAL_RUNTIME:state,TUTORIAL_AI:ai,
            setSoloRaceTicket(){},setSoloRaceDistance(){},setSoloAiEvent:v=>selectedAi=v,
            getSoloRaceTicket:()=>ticket,reseedSharedRandom(){},NetRaceController:class{}});
        const owner=new module.exports();owner._aiDebugMode=debug;owner.initializeRaceContext(allowed);
        return {owner,state,selectedAi,count};
    }
    for(const scenario of [{net:{seed:2}},{room:true},{debug:true},{allowed:false}]) {
        const f=entry(scenario);assert.equal(f.owner._tutorialMode,false);assert.equal(f.state.active,false);assert.equal(f.count,1);
    }
    assert.equal(entry().selectedAi.opponentCount,1); // 此处测试的是入口按原样传入配置，真实零对手配置另测。
    const solo=entry({requested:false});assert.equal(solo.selectedAi.opponentCount,7);assert.equal(solo.owner._tutorialMode,false);
});

function simulateFrame(f, dt=1/60) {
    f.controller.update(dt,f.GameState.RACING);
    if (!f.controller.paused) {
        f.refreshHud(); f.swimmer.update(dt); f.swimmer.consumeRhythmResults();
    }
}
function enterLesson(f, info) {
    f.controller.lesson.step=info; simulateFrame(f,0);
    if(f.controller.paused)f.controller.continueLesson();
}
function performStroke(f, side, scales) {
    const b=f.swimmer;
    for(let i=0;b.motor._motionClock<.2&&i<30;i++)simulateFrame(f);
    for(let i=0;!b.canAcceptStroke(side)&&i<600;i++)simulateFrame(f);
    assert.ok(b.canUseArmStroke);
    f.controller.pressChanged(side,true);
    b.handleKickStroke(side,false);
    b.handleStrokeHeld(side,true,f.h.load('core/InputTuning').STROKE_QUALITY_TUNING.minHoldSeconds);
    f.controller.armStrokeStarted();
    b.handleStroke(side);
    let result=null;
    for(let i=0;i<900;i++) {
        simulateFrame(f);
        scales?.add(f.time.TIME_SCALE.value);
        if(b.motor.isActiveStrokeInPerfectZone(side)) {
            simulateFrame(f,0); scales?.add(f.time.TIME_SCALE.value);
            f.controller.pressChanged(side,false);
            result=b.handleStrokeHeld(side,false); break;
        }
    }
    assert.ok(result && result.rating!==f.Rating.BAD,JSON.stringify({message:'必须通过真实松手判定',result,step:f.controller.lesson.step,scale:f.scale,paused:f.runtime.paused,actions:b.motor._leftActions,clock:b.motor._motionClock}));
    return result;
}

test('子弹时间驱动真实划水进度，完美区再次减速，松手恢复正常且不清掉正在按住的输入',()=>{
    const f=controllerFixture(), scales=new Set();
    enterLesson(f,'leftInfo');
    for(let i=0;i<6;i++) {
        const side=i%2?f.StrokeType.RIGHT:f.StrokeType.LEFT;
        assert.equal(f.controller.lesson.step,i%2?'right':'left');
        performStroke(f,side,scales);
        assert.equal(f.controller.lesson.guidedStrokeCount,i+1);
        assert.equal(f.controller.lesson.showingSuccess,true);
        assert.equal(f.time.TIME_SCALE.value,1);
        for(let frame=0;frame<50;frame++)simulateFrame(f);
        if(i===0) {
            assert.equal(f.controller.lesson.step,'rightInfo');assert.equal(f.scale,0);
            f.controller.continueLesson();
        } else if(i<5) {
            assert.equal(f.controller.paused,false);
            assert.match(f.frames.at(-1)[1],new RegExp('已完成 '+(i+1)+' / 6'));
        }
    }
    assert.ok(scales.has(.25)); assert.ok(scales.has(.12));
    assert.equal(f.controller.lesson.step,'alternateInfo');
    f.controller.continueLesson();
    const normalScales=new Set();
    for(let i=0;i<6;i++)performStroke(f,i%2?f.StrokeType.RIGHT:f.StrokeType.LEFT,normalScales);
    assert.deepEqual([...normalScales],[1],'自主交替练习须恢复正常速度，包括进入完美区时');
    for(let i=0;i<50;i++)simulateFrame(f);
    assert.equal(f.controller.lesson.step,'kickInfo');
    f.controller.dispose(); assert.equal(f.time.TIME_SCALE.value,1);
});

test('四档心率同步判定窗口且解除后自然恢复',()=>{
    const f=controllerFixture(), b=f.swimmer;
    const widths=[];
    enterLesson(f,'heart');
    for(const [step,rate] of [['heartLow',90],['heartWork',120],['heartHigh',150],['heartMax',170]]) {
        assert.equal(f.controller.lesson.step,step);
        assert.equal(f.controller.paused,false,'换档不暂停，不需点击确认');
        assert.equal(b.heartRate,rate); assert.equal(f.condition.heartRate,rate);
        const guide=b.strokeTimingGuideForSide(f.StrokeType.LEFT);
        const zone=guide.intervals.find(i=>i.rating===f.Rating.PERFECT);
        widths.push(zone.endRatio-zone.startRatio);
        for(let i=0;i<4;i++) {
            performStroke(f,i%2?f.StrokeType.RIGHT:f.StrokeType.LEFT);
            assert.equal(f.controller.lesson.count,i+1);
            assert.equal(f.controller.lesson.showingSuccess,i===3);
        }
        for(let i=0;i<50;i++)simulateFrame(f);
    }
    assert.ok(widths.every((w,i)=>i===0||w<widths[i-1]));
    assert.equal(f.controller.lesson.step,'rest');
    const before=f.condition.energy;
    for(let i=0;i<4;i++)f.controller.kick(i%2?f.StrokeType.RIGHT:f.StrokeType.LEFT);
    for(let i=0;i<1200&&f.controller.lesson.step==='rest';i++)simulateFrame(f);
    assert.equal(f.controller.lesson.step,'heartRecovery'); assert.ok(b.heartRate<=100);
    assert.equal(f.condition.energy,before);
    const recovered=b.strokeTimingGuideForSide(f.StrokeType.LEFT).intervals.find(i=>i.rating===f.Rating.PERFECT);
    assert.ok(recovered.endRatio-recovered.startRatio>widths[3]);
    for(let i=0;i<4;i++)performStroke(f,i%2?f.StrokeType.RIGHT:f.StrokeType.LEFT);
    for(let i=0;i<50;i++)simulateFrame(f);
    assert.equal(f.controller.lesson.step,'dolphinApproach');
    f.controller.dispose();
});

test('海豚课必须真实蓄气、起跳与落水，最后必须游到实际池壁才能完成',()=>{
    const f=controllerFixture(),b=f.swimmer;
    enterLesson(f,'turnInfo');
    assert.equal(f.controller.allowsDolphin,false);
    let sawTurn=false;
    for(let i=0;i<30000&&f.controller.lesson.step==='turn';i++) {
        if(i%8===0)b.handleKickStroke(i%16?f.StrokeType.RIGHT:f.StrokeType.LEFT);
        simulateFrame(f);
        if(b.isFlipTurning)sawTurn=true;
        if(b.isFlipTurning||b.isUnderwater)assert.equal(f.controller.lesson.step,'turn');
    }
    assert.ok(sawTurn); assert.ok(b.distance>=b.courseLayout.courseLength);
    assert.equal(f.controller.lesson.step,'heart');
    assert.equal(f.controller.lesson.firstTurnCompleted,true);
    f.controller.lesson.step='dolphinApproach'; simulateFrame(f,0);
    for(let i=0;i<30000&&f.controller.lesson.step==='dolphinApproach';i++) {
        if(i%8===0)b.handleKickStroke(i%16?f.StrokeType.RIGHT:f.StrokeType.LEFT);
        simulateFrame(f);
    }
    assert.equal(f.controller.lesson.step,'dolphinInfo'); assert.ok(b.distance>=100);
    const earnedEnergy=b.ultimate.energy;
    f.controller.continueLesson();
    assert.equal(b.ultimate.energy,earnedEnergy,'折返前攒下的气不能清空');
    for(let i=0;i<8&&f.controller.lesson.step==='dolphinCharge';i++) {
        performStroke(f,i%2?f.StrokeType.RIGHT:f.StrokeType.LEFT);
        simulateFrame(f);
    }
    assert.equal(b.ultimate.canAffordDolphin,true);
    assert.equal(f.controller.lesson.step,'dolphin'); assert.equal(f.controller.allowsDolphin,true);
    assert.equal(b.tryDolphinJump(),true); simulateFrame(f);
    assert.equal(f.controller.lesson.step,'dolphinFlight'); assert.equal(f.controller.allowsDolphin,false);
    assert.equal(b.ultimate.canAffordDolphin,false);
    for(let i=0;i<1800&&f.controller.lesson.step==='dolphinFlight';i++)simulateFrame(f);
    assert.equal(f.controller.lesson.step,'practice');
    assert.equal(f.controller.paused,false);
    enterLesson(f,'finish'); const target=f.runtime.finishDistance, start=b.distance;
    assert.equal(target,200); assert.ok(target>start); assert.equal(target%b.courseLayout.courseLength,0);
    for(let i=0;i<30000&&f.controller.lesson.step==='finish';i++) {
        // 最后一段自由踢水抵达，验证不是计数够了就自动过关。
        if(i%8===0)b.handleKickStroke(i%16?f.StrokeType.RIGHT:f.StrokeType.LEFT);
        simulateFrame(f);
    }
    assert.equal(f.controller.lesson.step,'finishTouch'); assert.equal(b.distance,target);
    for(let i=0;i<80;i++)simulateFrame(f);
    assert.equal(f.controller.lesson.step,'complete'); assert.equal(f.scale,0);
    f.controller.dispose(); assert.equal(f.runtime.finishDistance,0);
});

test('单人泳道和空AI阵容有效，正式生涯仍要求对手，教学补给不进入普通比赛',()=>{
    const {h,TUTORIAL_RUNTIME:runtime,TUTORIAL_AI}=harness();
    const {centeredLaneStart,aiIndexInLaneRange}=h.load('competitor/RaceLaneAllocation');
    assert.equal(centeredLaneStart(8,1),3);
    for(let lane=0;lane<8;lane++)assert.equal(aiIndexInLaneRange(lane,3,3,1),-1);
    const {setSoloAiEvent,buildRandomizedAiRoster}=h.load('competitor/CompetitorConfig');
    assert.equal(TUTORIAL_AI.opponentCount,0); setSoloAiEvent(TUTORIAL_AI);
    assert.equal(buildRandomizedAiRoster(0).length,0);
    const {PlayerConditionModel}=h.load('condition/PlayerConditionModel');
    const {UltimateEnergyModel}=h.load('condition/UltimateEnergyModel');
    const {body}=h.create(); const condition=new PlayerConditionModel(),ultimate=new UltimateEnergyModel();
    const initial=condition.energy; runtime.active=false;
    condition.setTutorialEnergyRatio(0); ultimate.grantTutorialCharge(); body.motor.setTutorialHeartRate(170);
    assert.equal(condition.energy,initial); assert.equal(ultimate.energy,0); assert.equal(body.heartRate,80);
    runtime.active=true; condition.setTutorialEnergyRatio(0);ultimate.grantTutorialCharge();body.motor.setTutorialHeartRate(170);
    assert.equal(condition.energy,0);assert.ok(ultimate.energy>0);assert.equal(body.heartRate,170);
});

test('零对手创建不加载AI模型，单人倒计时、起跳和正常触壁结算不依赖AI',()=>{
    const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
    const module={exports:{}};
    const source=fs.readFileSync(path.join(__dirname,'../assets/scripts/competitor/CompetitorManager.ts'),'utf8');
    const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
    vm.runInNewContext(code,{module,exports:module.exports,require:id=>id==='./CompetitorConfig'?{getFixedSoloAiCount:()=>0}:{} });
    const manager=Object.create(module.exports.CompetitorManager.prototype);
    manager._options={laneLayout:{laneCount:8},playerLaneIndex:3};
    manager._factory={create(){throw Error('单人比赛不应创建AI');}};
    const roster=manager.buildAi({});
    assert.equal(roster.primaryAiController,null);assert.equal(roster.aiSwimmers.length,0);assert.equal(roster.aiControllers.length,0);
    const {h,GameState:S}=harness(); const {RaceManager}=h.load('core/RaceManager');
    const {getRaceDistance}=h.load('core/GameBalance');const race=new RaceManager(), callbacks=[];
    let prepared=0,touched=0;
    const swimmer={node:{active:true,position:{z:0}},swimmerName:'玩家',distance:0,
        prepareDive(){prepared++;},performDive(){return .5;},playFinishTouch(){touched++;},stopRace(){}};
    race.playerSwimmer=swimmer;race.aiSwimmer=null;race.aiSwimmers=[];
    race.unscheduleAllCallbacks=()=>{};race.scheduleOnce=fn=>callbacks.push(fn);
    race.startRace();race.update(4);assert.equal(race.state,S.DIVING);assert.equal(prepared,1);
    race.startFromDive({});callbacks.shift()();callbacks.shift()();assert.equal(race.state,S.RACING);
    swimmer.distance=getRaceDistance();race.update(.1);assert.equal(touched,1);assert.equal(race.state,S.FINISHED);
});


test('已经完成首次折返不重复要求游一趟，满气可直接操作海豚跳',()=>{
    const f=controllerFixture(),c=f.controller,b=f.swimmer;
    c.lesson.observeCourse(49,50,true,false);
    c.lesson.observeCourse(54,50,false,false);
    c.lesson.step='rest'; for(let i=0;i<4;i++)c.lesson.kick(i%2?f.StrokeType.RIGHT:f.StrokeType.LEFT); c.lesson.tick(4,f.GameState.RACING,false,90);
    assert.equal(c.lesson.step,'heartRecovery');
    for(let i=0;i<4;i++)c.lesson.stroke(i%2?f.StrokeType.RIGHT:f.StrokeType.LEFT,f.Rating.GOOD);
    c.lesson.tick(.8,f.GameState.RACING,false,90);assert.equal(c.lesson.step,'dolphinApproach');
    c.lesson.observeCourse(106,50,false,false);assert.equal(c.lesson.step,'dolphinInfo');
    while(!b.ultimate.canAffordDolphin)b.ultimate.grantTutorialCharge();
    c.update(0,f.GameState.RACING);
    c.continueLesson(); assert.equal(c.lesson.step,'dolphin');assert.equal(c.allowsDolphin,true);
    c.dispose();
    const {TutorialLesson}=harness();const lesson=new TutorialLesson();lesson.step='dolphinCharge';
    lesson.observeDolphin(true,false,false,false);assert.equal(lesson.step,'dolphinCharge','首次折返之前即使满气也不能进入海豚跳');
});


test('心率每档需亲手交替划四次，等待、短按和重复同侧不能跳课，失误也计体验',()=>{
    const {TutorialLesson,StrokeType:T,Rating:R,GameState:S}=harness();
    for(const [step,next] of [['heartLow','heartWork'],['heartWork','heartHigh'],['heartHigh','heartMax'],['heartMax','rest'],['heartRecovery','dolphinApproach']]) {
        const lesson=new TutorialLesson();lesson.step=step;
        for(let i=0;i<4;i++) {
            const side=i%2?T.RIGHT:T.LEFT;
            lesson.kick(side);assert.equal(lesson.count,i);
            assert.equal(lesson.stroke(side,R.BAD),true);
            assert.equal(lesson.count,i+1);
            assert.equal(lesson.stroke(side,R.PERFECT),false);
            if(i<3) { lesson.tick(30,S.RACING,false);assert.equal(lesson.step,step); }
        }
        lesson.tick(.8,S.RACING,false);assert.equal(lesson.step,next);
    }
});


test('完整200米课程：三次真实折返、海豚倒数第二课、185米耗尽后体验并保持耗尽游完',()=>{
    const f=controllerFixture(), c=f.controller, b=f.swimmer;
    enterLesson(f,'leftInfo');
    const visited=[], scales=new Map(); let kicks=0, turns=0, wasTurning=false;
    let depletedAt=null;
    for(let frame=0;frame<90000&&c.lesson.step!=='complete';frame++) {
        const step=c.lesson.step;
        if(visited.at(-1)!==step)visited.push(step);
        if(visited.includes('heart')&&step!=='complete') {
            assert.equal(c.view.cue,'','后半段不再出现中央逐划口令');
            assert.equal(f.frames.at(-1)[7],true,'后半段统一使用 HUD 旁的小提示');
            if(!c.lesson.paused&&c.lesson.freeSwim&&step!=='dolphin'&&step!=='staminaRun') {
                assert.equal(f.frames.at(-1)[1],'','自由游不重复显示说明或剩余距离');
            }
        }
        assert.equal(f.h.load('core/GameBalance').getRaceDistance(),200);
        if(step==='staminaEmpty'&&depletedAt===null) {
            depletedAt=b.distance;
            assert.equal(f.condition.energy,0);
            assert.ok(f.condition.efficiencyModifier<1 && f.condition.strokeCadenceScale<1);
            assert.equal(c.lesson.paused,false);
            assert.doesNotMatch(f.frames.at(-1)[1],/\d+\/\d+/,'耗尽体验不显示任务计数');
        }
        if(step==='staminaEmptyInfo') {
            assert.equal(b.motor.isArmStrokeActive,false,'解释时不能冻结在划水动作途中');
            assert.equal(f.frames.at(-1)[3],'游到终点');
        }
        if(depletedAt!==null)assert.equal(f.condition.energy,0,'耗尽后不能再凭空补满体力');
        if(c.awaitingStrokeInput) { performStroke(f,f.StrokeType.LEFT);simulateFrame(f); }
        else if(c.lesson.paused)c.continueLesson();
        else if(c.lesson.showingSuccess)simulateFrame(f);
        else if(c.lesson.targetCount>0&&c.lesson.allowsArmStroke || step==='dolphinCharge') {
            const side=c.lesson.expectedSide??(c.lesson.count%2?f.StrokeType.RIGHT:f.StrokeType.LEFT);
            const observed=scales.get(step)??new Set(); scales.set(step,observed);
            performStroke(f,side,observed); simulateFrame(f);
        } else if(step==='dolphin') {
            assert.ok(b.tryDolphinJump());simulateFrame(f);
        } else if(step==='staminaRun'&&b.distance>=185&&f.condition.energyDepleted) {
            simulateFrame(f);
        } else if(step==='staminaRun'&&b.distance>=185) {
            performStroke(f,f.StrokeType.LEFT);simulateFrame(f);
        } else {
            if(c.allowsStroke(f.StrokeType.LEFT)&&frame%8===0) {
                const side=kicks++%2?f.StrokeType.RIGHT:f.StrokeType.LEFT;
                b.handleKickStroke(side);c.kick(side);
            }
            simulateFrame(f);
        }
        if(b.isFlipTurning&&!wasTurning)turns++;
        wasTurning=b.isFlipTurning;
    }
    assert.equal(c.lesson.step,'complete',JSON.stringify({step:c.lesson.step,distance:b.distance}));
    assert.equal(b.distance,200);assert.equal(turns,3);
    assert.ok(depletedAt>=185&&depletedAt<195,'185米附近真实划水耗尽，动作完成前仍能前进');
    assert.ok(visited.indexOf('heartRecovery')<visited.indexOf('dolphinInfo'));
    assert.ok(visited.indexOf('dolphinFlight')<visited.indexOf('staminaEmptyInfo'));
    assert.ok(visited.indexOf('staminaEmpty')<visited.indexOf('staminaEmptyInfo'));
    assert.ok(visited.indexOf('staminaEmptyInfo')<visited.indexOf('finish'));
    const {TutorialLesson}=f.h.load('tutorial/TutorialLesson'), probe=new TutorialLesson();
    const lateModals=visited.slice(visited.indexOf('heart'),visited.indexOf('complete')).filter(step=>{probe.step=step;return probe.paused;});
    assert.deepEqual(lateModals,['heart','dolphinInfo','staminaEmptyInfo'],'后半程只保留首次新机制说明');
    for(const [step,values] of scales) {
        if(step==='left'||step==='right')assert.ok(values.has(.25)&&values.has(.12),step+'跟练保留子弹时间');
        else assert.deepEqual([...values],[1],step+'体验阶段必须保持正常速度');
    }
    assert.equal(f.writes,0,'必须完成触壁后由玩家确认保存');
    c.dispose();
});

test('反复失误不会耗光前课体力或越过课程边界，练完才能继续前进',()=>{
    const f=controllerFixture(),c=f.controller,b=f.swimmer;
    enterLesson(f,'leftInfo');
    for(let i=0;i<24000;i++) {
        if(i%8===0)b.handleKickStroke(i%16?f.StrokeType.RIGHT:f.StrokeType.LEFT);
        c.lesson.stroke(f.StrokeType.LEFT,f.Rating.BAD);simulateFrame(f);
    }
    assert.equal(c.lesson.step,'left');assert.equal(b.distance,45);
    assert.equal(b.motor.isRacing,true);assert.ok(f.condition.energy>0);
    performStroke(f,f.StrokeType.LEFT);
    for(let i=0;i<50;i++)simulateFrame(f);
    assert.equal(c.lesson.step,'rightInfo');
    c.lesson.step='turn';simulateFrame(f,0);
    for(let i=0;i<120;i++){b.handleKickStroke(f.StrokeType.RIGHT);simulateFrame(f);}
    assert.ok(b.distance>45,'完成练习后不能停在旧边界');
    c.dispose();
});

test('教学体力预算按实际距离见底，养成、重复操作和普通模式互不影响',()=>{
    const {h,TUTORIAL_RUNTIME:runtime}=harness();
    const {PlayerConditionModel}=h.load('condition/PlayerConditionModel');
    for(const total of [50,100,300]) {
        const condition=new PlayerConditionModel();
        condition.setProgressionOverrides({energyTotal:total});condition.reset();
        runtime.active=true;condition.setTutorialEnergyCourse(185);
        condition.reset(); // GameManager 在起跳时会再次重置体力，不能清掉教学预算。
        condition.advanceTutorialEnergyCourse(180);
        const full=condition.energy;
        assert.equal(condition.energy,full,'游进距离不能自己扣体力');
        condition.consumeEnergy(1);
        assert.ok(Math.abs(condition.energyRatio-5/185)<1e-10);
        for(let i=0;i<1000;i++)condition.consumeEnergy(20);
        assert.ok(condition.energy>0);condition.advanceTutorialEnergyCourse(185);condition.consumeEnergy(1);
        assert.equal(condition.energy,0);
        condition.setTutorialEnergyCourse(null);condition.setTutorialEnergyRatio(1);
        runtime.active=false;condition.consumeEnergy(1);
        assert.equal(condition.energy,total-1);
        condition.setTutorialEnergyCourse(185);condition.advanceTutorialEnergyCourse(185);
        assert.equal(condition.energy,total-1,'普通比赛不能开启教学消耗');
    }
});

// 输入分流必须使用真实 InputRouter，长按不能误计为降心率的短按。
test('心率过高时亲手踢水降下来，长按不产生划水或通过次数',()=>{
    const f=controllerFixture(),c=f.controller,b=f.swimmer;
    const {InputRouter}=f.h.load('core/InputRouter');
    enterLesson(f,'heartMax');b.motor.setTutorialHeartRate(170);
    enterLesson(f,'rest');
    assert.equal(c.lesson.step,'rest');assert.equal(c.allowsArmStroke(f.StrokeType.LEFT),false);
    let now=1000, armStarts=0;const originalNow=Date.now;Date.now=()=>now;
    const router=new InputRouter(new f.h.cc.Node(),{
        allowStroke:side=>c.requestStroke(side),onStroke:()=>armStarts++,
        onStrokePressChanged:(side,held)=>c.pressChanged(side,held),
        onStrokeHeld:(side,held,pre)=>c.allowsArmStroke(side)&&!!b.handleStrokeHeld(side,held,pre),
        onKickStroke:side=>b.handleKickStroke(side,false),onKickConfirmed:side=>{b.confirmKickStroke();c.kick(side);},
    });
    try {
        const energy=f.condition.energy;
        router.handleScreenStroke(f.StrokeType.LEFT);now+=500;router.tick();router.handleScreenStrokeEnd(f.StrokeType.LEFT);
        assert.equal(armStarts,0);assert.equal(c.lesson.count,0);assert.equal(f.time.TIME_SCALE.value,1);
        for(let i=0;i<4;i++) {
            const side=i%2?f.StrokeType.RIGHT:f.StrokeType.LEFT;now+=500;
            router.handleScreenStroke(side);now+=10;router.handleScreenStrokeEnd(side);simulateFrame(f);
        }
        assert.equal(c.lesson.count,4);
        for(let i=0;i<1200&&c.lesson.step==='rest';i++)simulateFrame(f);
        assert.equal(c.lesson.step,'heartRecovery');assert.ok(b.heartRate<=100);
        assert.equal(f.condition.energy,energy,'踢水不能消耗或补回体力');
    } finally {Date.now=originalNow;c.dispose();}
});

test('真实失误分别教松早和松晚，按错侧即时指向应操作的一边',()=>{
    const f=controllerFixture(),c=f.controller,b=f.swimmer,T=f.StrokeType;
    enterLesson(f,'leftInfo');
    assert.equal(c.requestStroke(T.RIGHT),false);assert.match(c.view.cue,/左/);
    const observed=[],notify=b.onObservedRhythmResult;
    b.onObservedRhythmResult=result=>{observed.push(result);notify(result);};
    for(let i=0;b.motor._motionClock<.2&&i<30;i++)simulateFrame(f);
    for(const [ratio,expected] of [[.05,/松早/],[.75,/松晚/]]) {
        for(let i=0;!b.canAcceptStroke(T.LEFT)&&i<600;i++)simulateFrame(f);
        const before=observed.length;
        c.pressChanged(T.LEFT,true);b.handleStrokeHeld(T.LEFT,true,.2);b.handleStroke(T.LEFT);
        for(let i=0;i<1200&&observed.length===before&&b.strokeTimingGuideForSide(T.LEFT).currentRatio<ratio;i++)simulateFrame(f);
        c.pressChanged(T.LEFT,false);b.handleStrokeHeld(T.LEFT,false);
        assert.equal(observed.at(-1).rating,f.Rating.BAD);simulateFrame(f,0);
        assert.match(c.view.cue,expected);assert.equal(c.lesson.guidedStrokeCount,0);
        assert.equal(f.time.TIME_SCALE.value,1);
        for(let i=0;i<120;i++)simulateFrame(f);
    }
    c.dispose();
});

test('左右跟练中间划短反馈即可换边，整课完成才保留完整反馈',()=>{
    const {TutorialLesson,StrokeType:T,Rating:R,GameState:S}=harness();const lesson=new TutorialLesson();
    lesson.step='left';lesson.stroke(T.LEFT,R.GOOD);lesson.tick(.8,S.RACING,false);lesson.advance();
    lesson.stroke(T.RIGHT,R.GOOD);lesson.tick(.24,S.RACING,false);assert.equal(lesson.step,'right');
    lesson.tick(.02,S.RACING,false);assert.equal(lesson.step,'left');
    for(let i=2;i<6;i++){lesson.stroke(i%2?T.RIGHT:T.LEFT,R.GOOD);lesson.tick(i===5?.25:.26,S.RACING,false);}
    assert.equal(lesson.step,'right');lesson.tick(.55,S.RACING,false);assert.equal(lesson.step,'alternateInfo');
});


test('跟练结束后的体验与自由游长按、进入完美区和松手均保持正常速度',()=>{
    const f=controllerFixture(),c=f.controller,b=f.swimmer;
    for(const step of ['alternate','heartLow','heartWork','heartHigh','heartMax','heartRecovery',
        'dolphinCharge','practice','staminaEmpty','turn','dolphinApproach','finalApproach','staminaRun','dolphin','finish']) {
        c.lesson.step=step;c.lesson.count=0;simulateFrame(f,0);
        const scales=new Set();performStroke(f,f.StrokeType.LEFT,scales);
        assert.deepEqual([...scales],[1],step+'按住和进入完美区不能减速');
        assert.equal(f.scale,1,step+'松手后调度器不能遗留子弹时间');
        assert.equal(f.time.TIME_SCALE.value,1);
    }
    c.dispose();
});

test('耗尽后延续左右节奏，失误也能体验，两划完整收手后只解释一次并直接自由游',()=>{
    const {TutorialLesson,StrokeType:T,Rating:R,GameState:S}=harness();
    const lesson=new TutorialLesson();lesson.step='staminaRun';lesson.beginStaminaExperience(T.LEFT);
    assert.equal(lesson.expectedSide,T.RIGHT);assert.equal(lesson.paused,false);
    assert.equal(lesson.stroke(T.LEFT,R.GOOD),false);
    lesson.kick(T.RIGHT);assert.equal(lesson.count,0,'踢水不替代真实的耗尽划水体验');
    assert.equal(lesson.stroke(T.RIGHT,R.BAD),true);
    lesson.tick(10,S.RACING,false,170,true);assert.equal(lesson.step,'staminaEmpty');
    assert.equal(lesson.expectedSide,T.LEFT);
    assert.equal(lesson.stroke(T.LEFT,R.BAD),true);
    lesson.tick(10,S.RACING,false,170,false);
    assert.equal(lesson.step,'staminaEmpty','动作未做完时不能冻结比赛');
    lesson.tick(0,S.RACING,false,170,true);
    assert.equal(lesson.step,'staminaEmptyInfo');assert.equal(lesson.paused,true);
    lesson.advance();assert.equal(lesson.step,'finish');assert.equal(lesson.paused,false);
    assert.equal(lesson.progressLimit,200);assert.equal(lesson.targetCount,0);
    assert.equal(lesson.allowsStroke(T.LEFT),true);assert.equal(lesson.allowsStroke(T.RIGHT),true);
});

// 使用真实 GameManager 输入门控与暂停入口；后续编排交给实体/赛事回归，不创建渲染场景。
function tutorialInputOwner(f) {
    const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
    const source=fs.readFileSync(path.join(__dirname,'../assets/scripts/core/GameManager.ts'),'utf8');
    const ast=ts.createSourceFile('GameManager.ts',source,ts.ScriptTarget.Latest,true);
    const cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='GameManager');
    const names=['update','createInputRouter','handlePlayerStroke','handlePlayerStrokeHeld','handlePlayerKickStroke'];
    const methods=names.map(name=>cls.members.find(n=>n.name?.getText(ast)===name).getText(ast)).join('\n');
    const code=ts.transpileModule(`class Owner { ${methods} }; module.exports=Owner`,
        {compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
    const module={exports:{}};
    vm.runInNewContext(code,{module,InputRouter:f.h.load('core/InputRouter').InputRouter,GameState:f.GameState});
    const owner=new module.exports();
    owner.node=new f.h.cc.Node();owner._tutorial=f.controller;owner._tutorialMode=true;
    owner._raceSceneReady=true;owner._playerSwimmer=f.swimmer;owner._state=f.GameState.RACING;
    owner.observedAiForHud=()=>null;
    const {GameFlowController}=f.h.load('app/GameFlowController');
    f.h.load('app/StrokeSfxManager').StrokeSfxManager.setVolume(0);
    owner._gameFlow=new GameFlowController({playerSwimmer:f.swimmer,getState:()=>owner._state,
        handleModelDebugStroke:()=>false,handleModelDebugStrokeHeld:()=>false,handleModelDebugKickStroke:()=>false,
        uiFlow:{showRating(){}},raceCameraDirector:{notifyStrokeSettled(){}}});
    owner._inputRouter=owner.createInputRouter();
    f.controller.resetInput=()=>owner._inputRouter.resetStrokeInput();
    const mainSimulation=Symbol('已恢复主模拟');
    owner.driveNetAiFixedStep=()=>{throw mainSimulation;};
    return {owner,router:owner._inputRouter,mainSimulation};
}

test('体力课跨过185/190米仍正常前进，讲解真正冻结动作、位移和计时，恢复后耗尽游完',()=>{
    const f=controllerFixture(),c=f.controller,b=f.swimmer;
    enterLesson(f,'staminaRun');for(let i=0;i<20;i++)simulateFrame(f);
    b.motor.setFlipTurnDistance(185.1);b.motor.setFlipTurnSpeed(1);
    simulateFrame(f,0);
    performStroke(f,f.StrokeType.LEFT);
    for(let i=0;i<600&&c.lesson.step==='staminaRun';i++)simulateFrame(f);
    assert.equal(c.lesson.step,'staminaEmpty');assert.equal(f.condition.energy,0);
    assert.ok(b.distance>185.1,'耗尽的真实动作期间也要前进');
    b.motor.setFlipTurnDistance(189.9);b.motor.setFlipTurnSpeed(1);
    const clock=b.motor._motionClock;
    for(let i=0;i<30;i++)simulateFrame(f);
    assert.ok(b.distance>190,'耗尽后不能锁在190米原地游');
    assert.ok(b.motor._motionClock>clock);assert.equal(f.scale,1);
    performStroke(f,c.lesson.expectedSide);
    performStroke(f,c.lesson.expectedSide);
    for(let i=0;i<600&&!c.paused;i++)simulateFrame(f);
    assert.equal(c.lesson.step,'staminaEmptyInfo');assert.ok(b.distance<200);
    const {owner,router}=tutorialInputOwner(f);
    const {RaceManager}=f.h.load('core/RaceManager');const race=new RaceManager();
    race.tutorialMode=true;race.playerSwimmer=b;race._state=f.GameState.RACING;race._raceTimer=14;
    const frozen=[b.distance,b.node.position.x,b.motor._motionClock,b.motor.leftArmCycle,b.motor.rightArmCycle,
        b.heartRate,f.condition.energy,race._raceTimer];
    for(let i=0;i<120;i++) {
        router.handleScreenStroke(i%2?f.StrokeType.RIGHT:f.StrokeType.LEFT);router.tick();
        owner.update(1/60);b.update(1/60);race.update(1/60);
    }
    assert.deepEqual([b.distance,b.node.position.x,b.motor._motionClock,b.motor.leftArmCycle,b.motor.rightArmCycle,
        b.heartRate,f.condition.energy,race._raceTimer],frozen);
    assert.equal(b.motor.isArmStrokeActive,false);assert.equal(f.runtime.paused,true);assert.equal(f.scale,0);
    c.continueLesson();assert.equal(f.runtime.paused,false);assert.equal(f.scale,1);
    for(let i=0;i<30000&&c.lesson.step!=='complete';i++) {
        if(i%8===0) {const side=i%16?f.StrokeType.RIGHT:f.StrokeType.LEFT;router.handleScreenStroke(side);router.handleScreenStrokeEnd(side);}
        simulateFrame(f);race.update(1/60);
    }
    assert.equal(c.lesson.step,'complete');assert.equal(b.distance,200);assert.equal(f.condition.energy,0);
    c.dispose();
});

test('只踢水到末段时整场暂停，短按不产生原地踢水，真实长按才恢复推进和体力结算',()=>{
    const f=controllerFixture(),c=f.controller,b=f.swimmer;
    enterLesson(f,'staminaRun');for(let i=0;i<20;i++)simulateFrame(f);
    b.motor.setFlipTurnDistance(184.9);b.motor.setFlipTurnSpeed(1);
    const {owner,router,mainSimulation}=tutorialInputOwner(f);
    const {RaceManager}=f.h.load('core/RaceManager');const race=new RaceManager();
    race.tutorialMode=true;race.playerSwimmer=b;race._state=f.GameState.RACING;race._raceTimer=10;
    for(let i=0;i<120&&!c.awaitingStrokeInput;i++)simulateFrame(f);
    assert.equal(c.awaitingStrokeInput,true);assert.ok(b.distance>=185);assert.equal(f.scale,0);
    const frozen=[b.distance,b.motor._motionClock,b.motor._kickAction,b.motor.leftKickCycle,b.motor.rightKickCycle,
        b.heartRate,f.condition.energy,race._raceTimer];
    let now=1000;const originalNow=Date.now;Date.now=()=>now;
    try {
        for(let i=0;i<20;i++) {
            now+=500;router.handleScreenStroke(f.StrokeType.LEFT);
            now+=10;owner.update(1/60);router.handleScreenStrokeEnd(f.StrokeType.LEFT);
            b.update(1/60);race.update(1/60);
        }
        assert.deepEqual([b.distance,b.motor._motionClock,b.motor._kickAction,b.motor.leftKickCycle,b.motor.rightKickCycle,
            b.heartRate,f.condition.energy,race._raceTimer],frozen);
        assert.equal(c.paused,true);assert.equal(f.runtime.paused,true);assert.equal(f.scale,0);
        now+=500;router.handleScreenStroke(f.StrokeType.LEFT);
        now+=Math.ceil(f.h.load('core/InputTuning').STROKE_QUALITY_TUNING.minHoldSeconds*1000)+1;
        assert.throws(()=>owner.update(1/60),error=>error===mainSimulation,'暂停入口中的长按分类必须能恢复主模拟');
        assert.equal(c.paused,false);assert.equal(f.runtime.paused,false);assert.equal(f.scale,1);
        const start=b.distance;
        for(let i=0;i<900&&!b.motor.isActiveStrokeInPerfectZone(f.StrokeType.LEFT);i++)simulateFrame(f);
        assert.ok(b.distance>start,'恢复后不能只播放动作却不移动');
        router.handleScreenStrokeEnd(f.StrokeType.LEFT);simulateFrame(f);
        assert.equal(f.condition.energy,0,'由真实划水松手结算耗尽，短按或暂停不扣体力');
        for(let i=0;i<600&&c.lesson.step==='staminaRun';i++)simulateFrame(f);
        assert.equal(c.lesson.step,'staminaEmpty');assert.equal(c.awaitingStrokeInput,false);
    } finally {Date.now=originalNow;c.dispose();}
});

test('耗尽后未完成交替体验也在195米真正暂停说明，不原地划水或错过终点',()=>{
    const f=controllerFixture(),c=f.controller,b=f.swimmer;
    enterLesson(f,'staminaEmpty');f.condition.setTutorialEnergyRatio(0);f.refreshHud();
    for(let i=0;i<20;i++)simulateFrame(f);
    b.motor.setFlipTurnDistance(194.9);b.motor.setFlipTurnSpeed(1);
    c.pressChanged(f.StrokeType.LEFT,true);
    b.handleStrokeHeld(f.StrokeType.LEFT,true,f.h.load('core/InputTuning').STROKE_QUALITY_TUNING.minHoldSeconds);
    b.handleStroke(f.StrokeType.LEFT);
    assert.equal(b.motor.isArmStrokeActive,true,'最后五米的兜底也要处理玩家一直按住的情况');
    for(let i=0;i<120&&!c.paused;i++)simulateFrame(f);
    assert.equal(c.lesson.step,'staminaEmptyInfo');assert.ok(b.distance>=195&&b.distance<196);
    assert.equal(f.runtime.paused,true);assert.equal(f.scale,0);
    assert.equal(c.requestStroke(f.StrokeType.LEFT),false);assert.equal(b.motor.isArmStrokeActive,false);
    const distance=b.distance,clock=b.motor._motionClock;
    for(let i=0;i<120;i++) {c.update(1/60,f.GameState.RACING);b.update(1/60);}
    assert.equal(b.distance,distance);assert.equal(b.motor._motionClock,clock);
    c.continueLesson();assert.equal(c.lesson.step,'finish');
    simulateFrame(f);assert.ok(b.distance>distance);assert.equal(f.condition.energy,0);
    c.dispose();
});

test('体力已耗尽但一直按住划水，最后五米也必须显示说明并触壁完成',()=>{
    const f=controllerFixture(),c=f.controller,b=f.swimmer,T=f.StrokeType;
    enterLesson(f,'staminaRun');for(let i=0;i<20;i++)simulateFrame(f);
    b.motor.setFlipTurnDistance(194.9);b.motor.setFlipTurnSpeed(2);
    f.condition.setTutorialEnergyRatio(0);f.refreshHud();
    c.pressChanged(T.LEFT,true);
    b.handleStrokeHeld(T.LEFT,true,f.h.load('core/InputTuning').STROKE_QUALITY_TUNING.minHoldSeconds);
    b.handleStroke(T.LEFT);
    assert.equal(b.motor.isArmStrokeActive,true);
    for(let i=0;i<1200&&!c.paused;i++) {
        if(i%8===0)b.handleKickStroke(i%16?T.RIGHT:T.LEFT);
        simulateFrame(f);
    }
    assert.equal(c.lesson.step,'staminaEmptyInfo',JSON.stringify({step:c.lesson.step,distance:b.distance,active:b.motor.isArmStrokeActive}));
    assert.ok(b.distance<200,'提示必须在触壁前暂停，给最后冲线留出距离');
    assert.equal(f.frames.at(-1)[3],'游到终点');assert.equal(f.scale,0);
    c.continueLesson();
    for(let i=0;i<30000&&c.lesson.step!=='complete';i++) {
        if(i%8===0)b.handleKickStroke(i%16?T.RIGHT:T.LEFT);
        simulateFrame(f);
    }
    assert.equal(c.lesson.step,'complete');assert.equal(b.distance,200);
    assert.equal(f.frames.at(-1)[0],'200 米，完成！');assert.equal(f.frames.at(-1)[3],'回大厅，开游！');
    assert.equal(f.condition.energy,0);assert.equal(f.writes,0);c.dispose();
});

test('真实耗尽时下一只手已经按住，耗尽体验不能清掉当前手势或动作',()=>{
    const f=controllerFixture(),c=f.controller,b=f.swimmer,T=f.StrokeType;
    enterLesson(f,'staminaRun');for(let i=0;i<20;i++)simulateFrame(f);
    b.motor.setFlipTurnDistance(185.1);b.motor.setFlipTurnSpeed(1);
    performStroke(f,T.LEFT);f.refreshHud();
    assert.equal(f.condition.energyDepleted,true);assert.equal(c.lesson.step,'staminaRun');
    assert.equal(b.motor.isArmStrokeActive,true,'左手松开后仍在收手');
    c.pressChanged(T.RIGHT,true);
    b.handleStrokeHeld(T.RIGHT,true,f.h.load('core/InputTuning').STROKE_QUALITY_TUNING.minHoldSeconds);
    b.handleStroke(T.RIGHT);
    const action=b.motor._rightActions[0],resets=f.resets;
    assert.ok(action);simulateFrame(f,0);
    assert.equal(c.lesson.step,'staminaEmpty');assert.equal(c.paused,false);
    assert.equal(f.resets,resets);assert.equal(c.pressed,T.RIGHT);
    assert.equal(b.motor._rightStrokeHeld,true);assert.equal(b.motor._rightActions[0],action);
    assert.equal(c.lesson.expectedSide,T.RIGHT,'衔接应沿用已完成的左划，当前右划仍可计入体验');
    for(let i=0;i<900&&!b.motor.isActiveStrokeInPerfectZone(T.RIGHT);i++)simulateFrame(f);
    c.pressChanged(T.RIGHT,false);const result=b.handleStrokeHeld(T.RIGHT,false);simulateFrame(f);
    assert.ok(result);assert.equal(c.lesson.count,1);assert.equal(c.lesson.expectedSide,T.LEFT);
    assert.equal(f.scale,1);assert.equal(f.condition.energy,0);c.dispose();
});

test('尚未耗尽但一直划水越过195米时，整场暂停等待真实划水，不漏掉体力课',()=>{
    const f=controllerFixture(),c=f.controller,b=f.swimmer,T=f.StrokeType;
    enterLesson(f,'staminaRun');for(let i=0;i<20;i++)simulateFrame(f);
    b.motor.setFlipTurnDistance(194.9);b.motor.setFlipTurnSpeed(2);
    c.pressChanged(T.LEFT,true);
    b.handleStrokeHeld(T.LEFT,true,f.h.load('core/InputTuning').STROKE_QUALITY_TUNING.minHoldSeconds);
    b.handleStroke(T.LEFT);
    for(let i=0;i<120&&!c.paused;i++)simulateFrame(f);
    assert.equal(c.awaitingStrokeInput,true);assert.ok(b.distance>=195&&b.distance<196);
    assert.equal(f.scale,0);assert.equal(f.condition.energyDepleted,false,'暂停或距离本身不能扣体力');
    assert.equal(b.motor.isArmStrokeActive,false);assert.equal(c.pressed,null);
    const distance=b.distance;for(let i=0;i<60;i++)simulateFrame(f);
    assert.equal(b.distance,distance);
    performStroke(f,T.RIGHT);f.refreshHud();simulateFrame(f);
    assert.equal(f.condition.energyDepleted,true);assert.equal(c.lesson.step,'staminaEmptyInfo');
    assert.equal(f.frames.at(-1)[3],'游到终点');assert.ok(b.distance<200);c.dispose();
});

test('触壁时体力课尚未切完也能显示一次说明，确认后完成、保存并返回大厅',async()=>{
    for(const step of ['finalApproach','staminaRun','staminaEmpty'])for(const depleted of [false,true]) {
        const f=controllerFixture(),c=f.controller,b=f.swimmer;
        enterLesson(f,step);f.condition.setTutorialEnergyRatio(depleted?0:.25);f.refreshHud();
        // 模拟一次长帧跨过检查点，Motor 已按真实终点规则停止，不再能完成收手。
        b.motor.setFlipTurnDistance(200);b.motor.stopRace();
        let touches=0;const touch=b.playFinishTouch.bind(b);b.playFinishTouch=()=>{touches++;touch();};
        simulateFrame(f,0);
        assert.equal(c.lesson.step,'staminaEmptyInfo',step);assert.equal(f.scale,0);
        assert.equal(f.frames.at(-1)[3],'完成教学');assert.equal(f.writes,0);
        const noticeFrames=f.frames.length;
        for(let i=0;i<20;i++)simulateFrame(f,1);
        assert.equal(f.frames.length,noticeFrames,'等待确认不能重复弹窗');assert.equal(touches,0);
        if(!depleted)assert.doesNotMatch(f.frames.at(-1)[0],/用光|变慢/,'不能声称玩家已经实际耗尽');
        c.continueLesson();simulateFrame(f,0);
        assert.equal(c.lesson.step,'finishTouch');assert.equal(touches,1);
        for(let i=0;i<100;i++)simulateFrame(f);
        assert.equal(c.lesson.step,'complete');assert.equal(touches,1);assert.equal(f.scale,0);
        assert.equal(f.frames.at(-1)[3],'回大厅，开游！');assert.equal(f.writes,0);
        f.frames.at(-1)[4]();assert.equal(f.writes,1);f.resolve();
        await new Promise(resolve=>setImmediate(resolve));assert.equal(f.leaves,1);
        c.dispose();assert.equal(f.scale,1);assert.equal(f.runtime.active,false);
    }
});
