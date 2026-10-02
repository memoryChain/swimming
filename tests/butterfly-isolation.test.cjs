const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
const { load } = require('../scripts/analyze-stroke-efficiency.cjs');
const { createBody } = require('./helpers/butterfly-race-harness.cjs');
const { StrokeType, GameState } = load('core/GameConstants');
const { InputRouter } = load('core/InputRouter');
const { SwimmerMotor } = load('swimmer/SwimmerMotor');
const ts = require(process.env.PATH.split(path.delimiter)
    .map(dir => path.resolve(dir, '../typescript/lib/typescript.js')).find(p => fs.existsSync(p)));
const root = path.resolve(__dirname, '..');

function source(relative) {
    const file = path.join(root, 'assets/scripts', relative + '.ts');
    return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}
function extractedClass(src, className, names, context, prefix = '') {
    const declaration = src.statements.find(n => ts.isClassDeclaration(n) && n.name.text === className);
    const members = declaration.members.filter(n => names.includes(n.name?.getText(src)));
    assert.equal(members.length, names.length, '源代码测试入口必须完整');
    const js = ts.transpileModule(`${prefix}\nclass Extracted {${members.map(n => n.getText(src)).join('\n')}}`,
        { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    return vm.runInNewContext(js + ';Extracted', context);
}
function managerFixture(ai, net, room, debugButterfly, mode = 'competitive', launch = ai ? 'ai-debug' : 'race') {
    const src = source('core/GameManager');
    let gate, capability;
    function visit(n) {
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken
            && n.left.getText(src) === 'this._butterflyTestMode') gate = n.right.getText(src);
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken
            && n.left.getText(src) === 'this._butterflyEnabled') capability = n.right.getText(src);
        ts.forEachChild(n, visit);
    }
    visit(src); assert.ok(gate, '实际启动门控必须存在');
    const Manager = extractedClass(src, 'GameManager', ['createInputRouter'], { InputRouter, GameState });
    const manager = new Manager();
    Object.assign(manager, { node: {}, _aiDebugMode: ai, _launchMode: launch, _netSession: net, _roomMode: room,
        _state: GameState.RACING, observedAiForHud: () => null });
    manager._butterflyTestMode = vm.runInNewContext(`(function(){return ${gate};}).call(manager)`,
        { manager, getAiDebugSetup: () => ({ butterflyTest: debugButterfly }) });
    assert.ok(capability, '能力开关必须独立初始化');
    manager._butterflyEnabled = vm.runInNewContext(`(function(){return ${capability};}).call(manager)`, {
        manager, ...load('core/ButterflyAvailability'), getRaceDifficultyConfig: () => load('core/GameBalance').getRaceModeConfig(mode) });
    return manager;
}

test('实际启动门控及输入工厂隔离联机、房间和残留蝶泳设置', () => {
    for (const ai of [false, true]) for (const net of [null, {}])
        for (const room of [false, true]) for (const debug of [false, true]) {
            const manager = managerFixture(ai, net, room, debug);
            const expected = ai && !net && !room && debug;
            assert.equal(manager._butterflyTestMode, expected);
            const capability = !net && !room;
            assert.equal(manager._butterflyEnabled, capability);
            assert.equal(!!manager.createInputRouter()._callbacks.butterfly, capability);
        }
});

test('全部模式的本地正式和比赛调试共用蝶泳，联机与房间及模型预览仍隔离', () => {
    const { RACE_MODE_OPTIONS } = load('core/GameBalance');
    for (const mode of RACE_MODE_OPTIONS) for (const launch of ['race','model-debug','underwater-debug','ai-debug'])
        for (const net of [null, {}]) for (const room of [false, true]) {
            const manager = managerFixture(launch === 'ai-debug', net, room, false, mode.id, launch);
            const expected = (launch === 'race' || launch === 'ai-debug') && !net && !room;
            assert.equal(manager._butterflyEnabled, expected, `${mode.id}/${launch}/${!!net}/${room}`);
            assert.equal(!!manager.createInputRouter()._callbacks.butterfly, expected);
            assert.equal(manager._butterflyTestMode, false, '正式入口不继承残留调试人数');
        }
});

test('能力开关可以独立创建输入，但不切换测试场人数、读数或镜头', () => {
    const manager = managerFixture(false, null, false, false);
    manager._butterflyEnabled = true;
    assert.ok(manager.createInputRouter()._callbacks.butterfly);
    assert.equal(manager._butterflyTestMode, false);
    const src = source('core/GameManager');
    const declaration = src.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'GameManager');
    const text = name => declaration.members.find(n => n.name?.getText(src) === name).getText(src);
    assert.match(text('assignRaceLanes'), /this\._butterflyTestMode\s*\?/);
    assert.match(text('buildDeferredAiSwimmers'), /this\._butterflyTestMode/);
    assert.doesNotMatch(text('assignRaceLanes') + text('buildDeferredAiSwimmers'), /_butterflyEnabled/);
});

test('全部比赛创建入口为玩家与AI启用自由泳表现，模型预览及蝶泳能力独立保留', () => {
    const src=source('core/GameManager'),calls=[];
    const declaration=src.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='GameManager');
    function collect(n) {
        if(ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)
            &&/\.enable(?:Butterfly|FreestylePresentation)$/.test(n.expression.expression.getText(src))) calls.push(n.getText(src));
        ts.forEachChild(n,collect);
    }
    for(const member of declaration.members) if(['buildPlayerSwimmer3D','buildDeferredAiSwimmers'].includes(member.name?.getText(src))) collect(member);
    assert.equal(calls.length,3,'玩家的两个独立开关以及AI的表现开关均须接入');
    const js=ts.transpileModule(`(function(){${calls.join('\n')}}).call(manager);`,
        {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
    const {RACE_MODE_OPTIONS}=load('core/GameBalance');
    for(const mode of RACE_MODE_OPTIONS) for(const launch of ['race','ai-debug','model-debug','underwater-debug'])
      for(const [net,room] of [[null,false],[{},false],[null,true]]) {
        const manager=managerFixture(launch==='ai-debug',net,room,true,mode.id,launch);
        const player=createBody().body,ai=createBody().body;
        player.enableButterfly(false);ai.enableButterfly(false);
        Object.assign(manager,{_playerSwimmer:player,_aiSwimmers:[ai]});
        vm.runInNewContext(js,{manager,i:0});
        const expected=launch==='race'||launch==='ai-debug';
        assert.equal(player._freestylePresentationEnabled,expected,`${mode.id}/${launch}/玩家`);
        assert.equal(ai._freestylePresentationEnabled,expected,`${mode.id}/${launch}/AI或远程真人`);
        assert.equal(player.beginButterfly(),expected&&!net&&!room,'自由泳表现不改变蝶泳玩法门控');
        assert.equal(ai.beginButterfly(),false,'转体不开放AI蝶泳玩法');
    }
});

test('正式比赛和联机不创建或更新下方动作诊断小字，比赛调试保留', () => {
    const src=source('core/GameManager'),statements=[];
    function visit(n) {
        if(ts.isIfStatement(n)) {
            const condition=n.expression.getText(src),body=n.thenStatement.getText(src);
            if((condition.includes('_aiDebugMode') && /(?:enable|update)ButterflyStatus/.test(body))
                || (condition==='this._butterflyTestMode' && body.includes('new ButterflyDebugHud')))
                statements.push(n.getText(src));
        }
        ts.forEachChild(n,visit);
    }
    visit(src);assert.equal(statements.length,3,'须覆盖底部状态文字创建、更新及测试读数创建');
    const js=ts.transpileModule(`(function(){${statements.join('\n')}}).call(manager);`,
        {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
    for(const [debug,net,room] of [[false,null,false],[false,{},false],[false,null,true],[true,null,false]]) {
        const manager=managerFixture(debug,net,room,true);let created=0,updated=0,readouts=0;
        Object.assign(manager,{_uiController:{raceHudStatus:{enableButterflyStatus(){created++;},updateButterflyStatus(){updated++;}}},
            _playerSwimmer:{node:{active:true}},_playerAutopilotEnabled:false,_raceHud:{}});
        vm.runInNewContext(js,{manager,dt:.1,raceActive:true,visibleSize:{width:1280,height:720},
            ButterflyDebugHud:class {constructor(){readouts++;}}});
        assert.equal(created,debug?1:0);assert.equal(updated,debug?1:0);assert.equal(readouts,debug?1:0);
    }
});

test('自由泳表现消费实际同步倾角和角速度，翻面退出且特殊动作不启用', () => {
    const motion=load('character/FreestyleBodyRollMotion');
    const Entity=extractedClass(source('entity/Swimmer'),'Swimmer',
        ['enableFreestylePresentation','_freestylePresentationEnabled','updateBodyMotion','applyNetAxialRoll','applyNetCollisionPitch'],
        {...load('swimmer/GeyserReactionModel'),StrokeType});
    const entity=new Entity(),motor=new SwimmerMotor();motor.startRace(0,2);
    let args,kicks=0;
    Object.assign(entity,{_motor:motor,raceDirection:1,_forcedLaunch:null,_entertainmentKnocked:false,
        _geyserPose:{pitch:0,roll:0,weight:0,forward:0,side:0},
        _phases:{diveRecoveryLean:()=>0,dolphinRollResidualRadians:()=>0,canUseArmStroke:true,
            isUnderwater:false,isDiveGlidePoseActive:false,isFlipTurnActive:false,isFlipTurnCameraActive:false,isDolphinJumpActive:false},
        cartoonRig:{axialRollVisualWeight:1,setLegSplashSuppressed(){},
            updateFreestyleFromMotor(...values){args=values;},updateUnderwaterKickFromMotor(){kicks++;}}});
    entity.enableFreestylePresentation(true);
    const m=new motion.FreestyleBodyRollMotion();let time=0;
    const present=()=>{
        time+=1/60;entity.updateBodyMotion(1/60);assert.equal(args[7],true);
        m.update(args[0],time*2*Math.PI,(time+.5)*2*Math.PI,args[6],args[5],args[3],
            args[1].axialRollAngularVelocity,args[1].collisionPitchAngularVelocity);
    };
    for(let i=0;i<120;i++)present();assert.ok(m.leftRecovery>.95&&m.rightRecovery>.95);
    entity.applyNetAxialRoll(Math.PI,4,1);entity.applyNetCollisionPitch(0,0,1);
    entity.updateBodyMotion(1/60);assert.ok(args[5]<-.99);assert.equal(args[1].axialRollAngularVelocity,4);
    for(let i=0;i<60;i++)present();assert.equal(m.leftRecovery,0);assert.equal(m.rightRecovery,0);
    entity.applyNetAxialRoll(0,0,1);entity.applyNetCollisionPitch(Math.PI,4,1);
    entity.updateBodyMotion(1/60);assert.ok(args[5]<-.99);assert.equal(args[3],Math.PI);
    entity.applyNetCollisionPitch(0,0,1);
    for(const flag of ['isUnderwater','isFlipTurnActive','isDolphinJumpActive','isDiveGlidePoseActive']) {
        entity._phases[flag]=true;entity.updateBodyMotion(1/60);assert.equal(args[6],false,flag);entity._phases[flag]=false;
    }
    for(const key of ['_forcedLaunch','_entertainmentKnocked']) {
        entity[key]=true;entity.updateBodyMotion(1/60);assert.equal(args[6],false,key);entity[key]=key==='_forcedLaunch'?null:false;
    }
    entity._phases.isDiveGlidePoseActive=true;entity._phases.canUseArmStroke=false;
    entity.updateBodyMotion(1/60);assert.equal(kicks,1,'水下滑行仍由水下踢腿动作接管');
});

test('娱乐单项及综合娱乐调试经实际输入工厂起划、松手结算和重开，不依赖蝶泳页标记', () => {
    const balance=load('core/GameBalance'),oldMode=balance.getRaceMode();
    const oldNow=Date.now;let now=1000;Date.now=()=>now;
    try{
        for(const mode of balance.RACE_MODE_OPTIONS){
            balance.setRaceMode(mode.id);
            const manager=managerFixture(true,null,false,false,mode.id);
            const f=createBody(),m=f.body.motor,starts=[];
            m.enableButterfly(manager._butterflyEnabled);
            m.onArmStrokeStarted=side=>starts.push(side);
            f.body.setButterflyPreview=enabled=>m.setButterflyPreview(enabled);
            manager._playerSwimmer=f.body;
            manager.handlePlayerStroke=side=>m.recordStroke(side);
            manager.handlePlayerStrokeHeld=(side,held,pre)=>{
                if(held&&!f.body.canUseArmStroke)return false;
                f.settle(m.setStrokeHeld(side,held,pre));return true;
            };
            manager.handlePlayerKickStroke=side=>m.recordKickTap(side,false);
            manager._gameFlow={handlePlayerKickConfirmed:()=>m.confirmKickAbility()};
            const router=manager.createInputRouter();
            assert.equal(manager._butterflyTestMode,false);
            const press=()=>{
                router.handleScreenStroke(StrokeType.LEFT);router.handleScreenStroke(StrokeType.RIGHT);
                now+=220;router.tick();assert.equal(m.butterfly.held,true,mode.id);
            };
            press();f.body.stepSimulation(m.butterfly.duration*.42);
            router.handleScreenStrokeEnd(StrokeType.LEFT);router.handleScreenStrokeEnd(StrokeType.RIGHT);f.flush();
            assert.deepEqual(starts,[StrokeType.BOTH],mode.id);
            assert.equal(f.body.settledStrokeEnergy,2);assert.equal(f.body.rhythmStats.perfectCount,1);
            assert.ok(f.body._ultimate.energy>0);
            router.resetStrokeInput();m.startRace();press();
            assert.deepEqual(starts,[StrokeType.BOTH,StrokeType.BOTH],`重开/${mode.id}`);
        }
    }finally{Date.now=oldNow;balance.setRaceMode(oldMode);}
});

test('旧巨浪入口先回退正式规则再解析泳姿，独立巨浪调试保持原规则', () => {
    const src=source('core/GameManager');
    const declaration=src.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='GameManager');
    const build=declaration.members.find(n=>n.name?.getText(src)==='buildScene');
    const statements=[];
    for(const statement of build.body.statements){
        statements.push(statement.getText(src));
        if(ts.isExpressionStatement(statement)&&ts.isBinaryExpression(statement.expression)
            &&statement.expression.left.getText(src)==='this._butterflyEnabled')break;
    }
    const js=ts.transpileModule(`(function(){${statements.join('\n')}}).call(manager)`,
        {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
    for(const launch of ['race','ai-debug'])for(const net of [null,{}]){
        let mode='giant-wave-brawl';
        const manager={_launchMode:launch,_aiDebugMode:launch==='ai-debug'};
        vm.runInNewContext(js,{manager,...load('core/ButterflyAvailability'),
            consumeRoomMode:()=>false,consumeRoomRaceDistance:()=>200,consumeNetRaceSession:()=>net,
            getAiDebugSetup:()=>({butterflyTest:false}),setRaceMode:value=>{mode=value;},
            getRaceDifficultyConfig:()=>load('core/GameBalance').getRaceModeConfig(mode)});
        assert.equal(mode,launch==='race'||net?'competitive':'giant-wave-brawl');
        assert.equal(manager._butterflyEnabled,!net);
        assert.equal(manager._butterflyTestMode,false);
    }
});

test('联机双手长按和短按经真实捕获、编码及远端回放仍分别结算自由泳', () => {
    const h = createHarness({ './Swimmer': { Swimmer: class {} } });
    Object.assign(h.cc, { Component: class {}, _decorator: { ccclass: () => target => target, property: () => () => undefined } });
    const net = h.load(path.join(root, 'assets/scripts/net/NetRaceInput.ts'));
    const capture = h.load(path.join(root, 'assets/scripts/net/NetInputCapture.ts'));
    const { RemoteSwimmerController } = h.load(path.join(root, 'assets/scripts/entity/RemoteSwimmerController.ts'));
    const src = source('app/GameFlowController');
    const netSide = src.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === 'netSide').getText(src);
    const Flow = extractedClass(src, 'GameFlowController', ['handlePlayerStroke', 'handlePlayerStrokeHeld',
        'handlePlayerKickStroke', 'handlePlayerKickConfirmed', 'isStrokeInputActive'],
        { StrokeType, GameState, ...net, ...capture }, netSide);
    const oldNow = Date.now; let now = 1000; Date.now = () => now;
    capture.setNetInputCaptureActive(true);
    try {
        for (const pitch of [0, Math.PI]) {
            const local = new SwimmerMotor(), remoteMotor = new SwimmerMotor();
            for (const m of [local, remoteMotor]) { m.startRace(); m.update(.3, { isAI: false }); m.correctCollisionPitch(pitch, 0, 1); }
            const results = [[], []];
            const adapter = (m, index) => ({ node: { active: true }, get heartRate() { return m.heartRate; },
                get canUseArmStroke() { return true; },
                handleStroke: side => { m.recordStroke(side); },
                handleStrokeHeld: (side, held, pre) => { const r = m.setStrokeHeld(side, held, pre); if (r) results[index].push(r); },
                handleKickStroke: side => m.recordKickTap(side, false), confirmKickStroke: () => m.confirmKickAbility(),
                applyAuthoritativeHeartRate: (hr, reset) => m.applyAuthoritativeHeartRate(hr, reset) });
            const flow = new Flow(); flow._refs = { playerSwimmer: adapter(local, 0), getState: () => GameState.RACING,
                handleModelDebugStroke: () => false, handleModelDebugStrokeHeld: () => false,
                handleModelDebugKickStroke: () => false }; flow.presentStrokeResult = () => {};
            const remote = new RemoteSwimmerController(); remote.swimmer = adapter(remoteMotor, 1);
            const manager = managerFixture(true, {}, false, true);
            for (const name of ['handlePlayerStroke', 'handlePlayerStrokeHeld', 'handlePlayerKickStroke'])
                manager[name] = flow[name].bind(flow);
            manager._gameFlow = flow;
            const router = manager.createInputRouter(), events = [];
            const transmit = () => {
                const pending = capture.drainNetInput();
                const decoded = net.decodeInputFrame(net.encodeInputFrame(2, pending, null, -1, 7));
                assert.equal(decoded.inputSeq, 7); events.push(...decoded.events); remote.applyEvents(decoded.events);
            };
            router.handleScreenStroke(StrokeType.LEFT); router.handleScreenStroke(StrokeType.RIGHT); transmit();
            now += 220; router.tick(); transmit();
            for (let frame = 0; frame < 18; frame++) {
                now += 1000 / 60; router.tick(); transmit();
                for (let i = 0; i < 2; i++) { const m = i ? remoteMotor : local; m.update(1 / 60, { isAI: false }); results[i].push(...m.consumeStrokeQualityResults()); }
            }
            router.handleScreenStrokeEnd(StrokeType.LEFT); router.handleScreenStrokeEnd(StrokeType.RIGHT); transmit();
            for (const side of [StrokeType.RIGHT, StrokeType.LEFT]) {
                now += 100; router.handleScreenStroke(side); transmit(); now += 40; router.handleScreenStrokeEnd(side); transmit();
            }
            assert.deepEqual(events.map(e => [e.kind, e.side]), [
                ['k', 0], ['k', 1], ['h', 0], ['s', 0], ['h', 1], ['s', 1], ['H', 0], ['H', 1], ['k', 1], ['k', 0],
            ]);
            assert.equal(local.butterfly, null); assert.equal(remoteMotor.butterfly, null);
            assert.equal(router.butterflyRepressMask, 0);
            assert.equal(results[0].length, 2); assert.equal(results[1].length, 2);
            assert.deepEqual(results[0], results[1], '两侧松手只分别结算一次');
            assert.equal(local.distance, remoteMotor.distance); assert.equal(local.currentSpeed, remoteMotor.currentSpeed);
        }
    } finally { Date.now = oldNow; capture.setNetInputCaptureActive(false); }
});

test('未启用蝶泳的八名选手不采样姿态，仅启用能力的选手计算', () => {
    const tuning = load('core/ButterflyTuning'), original = tuning.butterflyPoseAllowsStroke;
    let checks = 0; tuning.butterflyPoseAllowsStroke = (...args) => { checks++; return original(...args); };
    try {
        const motors = Array.from({ length: 8 }, () => { const m = new SwimmerMotor(); m.startRace(); return m; });
        for (let frame = 0; frame < 1800; frame++) for (const m of motors) {
            m.update(1 / 30, { isAI: true }); assert.equal(m.butterflyAdmission, 'fallback');
        }
        assert.equal(checks, 0, '一分钟八人模拟不得触发蝶泳角度运算');
        motors[0].enableButterflyTest(true); assert.equal(motors[0].beginButterfly(), true);
        const before = checks;
        for (let i = 0; i < 6; i++) for (const m of motors) m.update(1 / 30, { isAI: false });
        assert.equal(checks - before, 6, '追帧仍只有玩家每模拟步检查一次');
    } finally { tuning.butterflyPoseAllowsStroke = original; }
});
