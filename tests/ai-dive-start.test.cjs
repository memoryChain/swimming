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
        playerSwimmer:{prepareDive(){},setDiveChargeEffect(){}},
        uiFlow:{showGo(){},showCountdown(){},updateDiveCharge(){},showDiveRelease(){}},
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
function compiler(){
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
    const tween=()=>({to(seconds,props,opts){steps.push({seconds,props,opts});return this;},delay(seconds){steps.push({seconds});return this;},call(){return this;},start(){}});
    const Body=vm.runInNewContext(js+';Body',{DIVE_BALANCE,SWIMMER_ACTION_TUNING,Vec3:h.Vec3,Tween:{stopAllByTarget(){}},tween});
    const body=new Body();body.node=new h.cc.Node();body.captureStartPosition=()=>{};
    body.divePlatformPosition=()=>new h.Vec3(0,.397,0);body._startPosition={z:0};
    body._courseLayout={direction:1,swimY:0,entryPosition:(d,z)=>new h.Vec3(d,0,z)};
    body.cartoonRig={setDiveReady(){},releaseDiveChargeEffect(){}};
    for(const anticipation of [.32,.5,0]){
        DIVE_BALANCE.takeoffAnticipationSeconds=anticipation;
        const flightTimes=[];
        for(const power of [.3,.6,1])for(const scale of [.97,1,1.3,1.474]){
            steps.length=0;const total=body.performDive(resolveDiveResult(power,scale));
            const air=steps.findIndex(s=>s.opts?.onUpdate);
            const preparation=steps.slice(0,air).reduce((sum,s)=>sum+s.seconds,0);
            assert.ok(Math.abs(preparation-anticipation)<1e-10);
            assert.ok(Math.abs(total-preparation-steps[air].seconds)<1e-10);
            flightTimes.push(steps[air].seconds);
        }
        assert.ok(Math.max(...flightTimes)>Math.min(...flightTimes),'飞行时间保留数值差异');
    }
});
