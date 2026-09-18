const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createHarness}=require('./helpers/cocos-math-harness.cjs');
function fixture(){
    const sent=[],calls=[];
    const h=createHarness({'../net/NetInputCapture':{captureNetInput:e=>sent.push(e)}});
    const load=p=>h.load(path.join(h.root,'assets/scripts',p+'.ts'));
    const {GameFlowController}=load('app/GameFlowController');
    const {GameState}=load('core/GameConstants');
    let state=GameState.COUNTDOWN;
    const swimmers=Array.from({length:4},(_,i)=>({node:{active:i!==3},swimmerName:'AI'+i,
        prepareDive(){calls.push(['prepare',i]);},performDive(r){calls.push(['dive',i,r.power,r.launchSpeed]);}}));
    const controllers=swimmers.map((_,i)=>({remoteDriven:i===2,divePower:[.4,.9,.7,.6][i],
        startSwimming(){calls.push(['swim',i]);},stopSwimming(){}}));
    const raceManager={startFromDive:r=>calls.push(['player',r.power,r.launchSpeed])};
    const refs={raceManager,aiSwimmers:swimmers,aiControllers:controllers,debug(){},
        getState:()=>state,setState:s=>state=s,
        playerSwimmer:{prepareDive(){},setDiveChargeEffect(){},finishDiveChargeEffect(){}},
        uiFlow:{showGo(){},showCountdown(){},hideCountdown(){},updateDiveCharge(){},showDiveRelease(){}},
        raceCameraDirector:{resetCountdownTimers(){},startDiveShot(){}},
        playerDiveSpeedScale:()=>1.3,applyPlayerDive(){}};
    const flow=new GameFlowController(refs);flow.bindRaceManagerCallbacks();
    return {...h,load,flow,raceManager,GameState,calls,sent};
}
test('发令同帧启动全部真正 AI，长按玩家同帧提交；远端和隐藏选手不被代跳',()=>{
    const s=fixture();s.flow.handleDiveChargeStart();s.flow._diveChargePower=.6;
    s.raceManager.onStateChange(s.GameState.DIVING);s.raceManager.onDiveReady();
    const dives=s.calls.filter(c=>c[0]==='dive');
    assert.deepEqual(dives.map(c=>c[1]),[0,1],'无需等待任何计时器');
    assert.notEqual(dives[0][2],dives[1][2],'仍保留不同蓄力结果');
    assert.equal(s.calls.filter(c=>c[0]==='player').length,1);
    assert.equal(s.sent.filter(e=>e.launchSpeed!==undefined).length,1);
    const count=s.calls.length;
    s.raceManager.onStateChange(s.GameState.DIVING);s.raceManager.onDiveReady();
    s.flow.handleDiveRelease(3);assert.equal(s.calls.length,count,'重复发令与松手不再次起跳');
    s.flow.stopAllAi();s.flow.clearRaceManagerCallbacks();assert.equal(s.raceManager.onDiveReady,null);
});
test('同种子重开得到同一 AI 蓄力结果，未按住的玩家仍可在发令后手动跳水',()=>{
    const s=fixture();const {reseedSharedRandom}=s.load('core/SharedRNG');
    const run=()=>{reseedSharedRandom(2468);s.raceManager.onStateChange(s.GameState.DIVING);return s.calls.filter(c=>c[0]==='dive').map(c=>c.slice(1));};
    const first=run();assert.equal(s.calls.some(c=>c[0]==='player'),false);
    s.flow.handleDiveRelease(0);assert.equal(s.calls.filter(c=>c[0]==='player').length,1);
    s.flow.stopAllAi();s.flow.resetDiveCharge();s.calls.length=0;
    s.raceManager.onStateChange(s.GameState.COUNTDOWN);assert.deepEqual(run(),first);
});
test('玩家托管在发令边缘按 AI 蓄力起跳，进入游泳后接管且不会重复提交',()=>{
    const s=fixture();let starts=0,stops=0;
    const controller={sampleDivePower:()=>.9,startSwimming(){starts++;},stopSwimming(){stops++;}};
    s.flow._refs.playerAutopilotController=()=>controller;
    s.raceManager.onStateChange(s.GameState.DIVING);
    const player=s.calls.filter(c=>c[0]==='player');
    assert.equal(player.length,1);assert.ok(Math.abs(player[0][1]-.9)<1e-10,'托管起跳保留 AI 采样功率');
    assert.equal(s.sent.filter(e=>e.launchSpeed!==undefined).length,1);
    s.flow.startPlayerAutopilotDive();assert.equal(s.calls.filter(c=>c[0]==='player').length,1,'重复调用不再次起跳');
    s.raceManager.onStateChange(s.GameState.RACING);assert.equal(starts,1);
    s.flow.stopAllAi();assert.equal(stops,1);
});
function compiler(){
    if(process.env.TYPESCRIPT_PATH)return require(process.env.TYPESCRIPT_PATH);
    try{return require('typescript');}catch{}
    return require(process.env.PATH.split(path.delimiter).map(d=>path.resolve(d,'../typescript/lib/typescript.js')).find(p=>fs.existsSync(p)));
}
test('真实跳水序列的离台准备固定，蓄力与爆发只改变飞行段，准备参数可调整',()=>{
    const h=createHarness(),ts=compiler(),steps=[];
    const load=p=>h.load(path.join(h.root,'assets/scripts',p+'.ts'));
    const {DIVE_BALANCE}=load('core/GameBalance');
    const {SWIMMER_ACTION_TUNING}=load('character/CharacterMotionTuning');
    const {resolveDiveResult}=load('core/DiveResolver');
    const source=ts.createSourceFile('Swimmer.ts',fs.readFileSync(path.join(h.root,'assets/scripts/entity/Swimmer.ts'),'utf8'),ts.ScriptTarget.Latest,true);
    const cls=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='Swimmer');
    const method=cls.members.find(n=>n.name?.getText(source)==='performDive');
    const helpers=source.statements.filter(n=>ts.isFunctionDeclaration(n)&&['degreesToRadians','projectileTimeToY'].includes(n.name.text));
    const js=ts.transpileModule(`${helpers.map(n=>n.getText(source)).join('\n')} class Body {${method.getText(source)}}`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
    const tween=()=>({to(seconds,props,opts){steps.push({seconds,props,opts});return this;},delay(seconds){steps.push({seconds});return this;},call(callback){steps.push({seconds:0,callback});return this;},start(){}});
    const Body=vm.runInNewContext(js+';Body',{DIVE_BALANCE,SWIMMER_ACTION_TUNING,Vec3:h.Vec3,Tween:{stopAllByTarget(){}},tween});
    const body=new Body();body.node=new h.cc.Node();body.captureStartPosition=()=>{};
    body.divePlatformPosition=()=>new h.Vec3(0,.397,0);body._startPosition={z:0};
    body._courseLayout={direction:1,swimY:0,entryPosition:(d,z)=>new h.Vec3(d,0,z)};
    let bursts=0,entries=0;body.applyDiveProjectile=()=>{};
    body.cartoonRig={triggerDiveEntrySplash(point){entries++;assert.equal(point.y,0);assert.ok(point.x*body._courseLayout.direction>0);},setDiveReady(){},startDiveStreamlineTransition(){},releaseDiveChargeEffect(duration,direction){bursts++;assert.equal(duration,.32);assert.equal(direction,body._courseLayout.direction);}};
    for(const anticipation of [.32,.5,0]){
        DIVE_BALANCE.takeoffAnticipationSeconds=anticipation;
        const flightTimes=[];
        for(const power of [.3,.6,1])for(const scale of [.97,1,1.3,1.474]){
            steps.length=0;bursts=0;entries=0;const total=body.performDive(resolveDiveResult(power,scale));
            const air=steps.findIndex(s=>s.opts?.onUpdate);
            const preparation=steps.slice(0,air).reduce((sum,s)=>sum+s.seconds,0);
            assert.ok(Math.abs(preparation-anticipation)<1e-10);
            assert.ok(Math.abs(total-preparation-steps[air].seconds)<1e-10);
            assert.equal(bursts,0);
            let elapsed=0;
            for(const step of steps.slice(0,air)) {
                elapsed+=step.seconds;
                const previous=bursts;step.callback?.();
                if(bursts>previous)assert.ok(Math.abs(elapsed-anticipation*.625)<1e-10,'爆发绑定蹬台伸展开始');
            }
            assert.equal(bursts,1,'蹬台伸展只释放一次');
            steps[air].opts.onUpdate(null,0);assert.equal(entries,0);
            steps[air].opts.onUpdate(null,1);steps[air].opts.onUpdate(null,1);
            assert.equal(entries,1,'下降穿水只爆发一次');
            flightTimes.push(steps[air].seconds);
        }
        assert.ok(Math.max(...flightTimes)>Math.min(...flightTimes),'飞行时间保留数值差异');
    }
});
