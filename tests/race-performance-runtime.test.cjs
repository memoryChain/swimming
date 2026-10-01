// 验证正式比赛的高频分配预算和粒子休眠生命周期，不启动编辑器。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
const { createAiHarness } = require('./helpers/ai-race-harness.cjs');
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
function evaluate(code, globals = {}) {
    const module = { exports: {} };
    vm.runInNewContext(ts.transpileModule(code, { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
    } }).outputText, { module, exports: module.exports, ...globals });
    return module.exports;
}
function classSource(file, name) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    return { source, cls: source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === name) };
}

test('名次并列与隐藏对手保持原规则，镜头快照复用且实时覆盖观战对象', () => {
    const h = createHarness();
    const { source, cls } = classSource('assets/scripts/app/GameFlowController.ts', 'GameFlowController');
    const { GameState } = h.load(h.root + '/assets/scripts/core/GameConstants.ts');
    const { GameFlowController: Flow } = evaluate(cls.getText(source), {
        Vec3: h.Vec3, GameState, LIVE_RANK_REFRESH_SECONDS: .2, getRaceDistance: () => 200,
        RACE_PHASE_BALANCE: { sprintDistanceFromFinish: 20 }, STEERING_TUNING: { useSprintSwimView: false },
        RaceCameraMode: { Sprint: 2 }, isSurfaceRaceCameraRiseReady: () => false,
    });
    const swimmer = (distance, active = true) => ({ distance, currentSpeed: 2, cameraHeading: .2,
        flightPitch: .1, kickCadenceHz: 0, isArmStrokeActive: true, isUnderwater: false,
        kickDiveDepth: 0, underwaterRiseProgress: 1, isFlipTurnCameraActive: false, isDolphinCameraActive: false,
        node: { active, isValid: true, position: new h.Vec3(distance, 0, 1) },
        getCameraUpperBodyWorldPosition(out) { return out.set(this.distance, .5, 1); },
    });
    const player = swimmer(10), rivals = [swimmer(11), swimmer(10), swimmer(12, false), swimmer(9)];
    let snapshot;
    const refs = { playerSwimmer: player, aiSwimmers: rivals, getState: () => GameState.RACING,
        raceCameraDirector: { update(_dt, value) { snapshot = value; } }, debug() {}, enterSprint() {} };
    const flow = new Flow(refs); flow.updateDiveCharge = () => {};
    assert.deepEqual({ ...flow.calculatePlayerPlacement() }, { placement: 2, racerCount: 4 });
    flow.updateRaceCamera(1/60); const first = snapshot, anchor = snapshot.playerUpperBodyWorldPosition;
    assert.equal(snapshot.playerDistance, 10); assert.equal(snapshot.playerPlacement, 2);
    for (let i = 0; i < 180; i++) {
        player.distance = 10 + i / 10;
        flow.updateRaceCamera(1/60);
        assert.equal(snapshot, first); assert.equal(snapshot.playerUpperBodyWorldPosition, anchor);
        assert.equal(snapshot.playerDistance, player.distance);
    }
    flow.setCameraFollowAi(true, rivals[0]); flow.updateRaceCamera(1/60);
    assert.equal(snapshot, first); assert.equal(snapshot.playerDistance, rivals[0].distance);
    assert.equal(snapshot.playerPlacement, 1, '镜头观察AI时名次仍属于真实玩家');
    rivals[0].node.active = false; flow.updateRaceCamera(1/60);
    assert.equal(snapshot.playerDistance, player.distance);
});

test('转播、跟随、俯视、海豚跳与转身镜头连续更新不创建向量，也不修改权威输入', () => {
    const h = createHarness(); let allocations = 0;
    class CountedVec3 extends h.Vec3 {
        constructor(...args) { super(...args); allocations++; }
        clone() { return new CountedVec3(this.x, this.y, this.z); }
    }
    h.cc.Vec3 = CountedVec3;
    const { RaceCameraDirector: Director, RaceCameraMode: Mode } = h.load(h.root + '/assets/scripts/camera/RaceCameraDirector.ts');
    for (const kind of ['broadcast', 'sprint', 'top', 'dolphin', 'flip']) for (const hz of [30, 60, 120]) {
        const d = new Director(1), lens = {};
        d.bindCamera({ setPosition() {}, lookAt() {}, getComponent: () => lens });
        d.selectMode(kind === 'broadcast' ? Mode.Broadcast : kind === 'top' ? Mode.Top : Mode.Sprint);
        const body = Object.freeze(new CountedVec3(0, .5, 1));
        const snapshot = Object.freeze({ playerX: 0, playerY: .1, playerDistance: 10, playerSpeed: 2,
            playerUpperBodyWorldPosition: body, playerFinished: false, playerHeading: .3, playerFlightPitch: .2,
            playerUnderwater: false, playerArmStrokeActive: true, playerKickDiveDepth: 0,
            closestAiDistanceGap: 5, playerPlacement: 2, racerCount: 8, raceActive: true,
            countdownActive: false, sprintActive: false,
            playerDolphinCameraActive: kind === 'dolphin', playerFlipTurnCameraActive: kind === 'flip' });
        d.update(1/hz, snapshot); allocations = 0;
        for (let i = 0; i < hz * 2; i++) d.update(1/hz, snapshot);
        assert.equal(allocations, 0, `${kind} ${hz}Hz`);
        for (const v of [d._cameraPos, d._cameraTarget]) {
            assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z));
        }
    }
});

test('水下泡沫停发后保留存活粒子，归零休眠，重复开关不会丢失首发', () => {
    const { source, cls } = classSource('assets/scripts/character/UnderwaterBubbleEmitter.ts', 'UnderwaterBubbleEmitter');
    const methods = cls.members.filter(n => ['setEmitting', 'updateIdle'].includes(n.name?.getText(source)));
    const { Subject } = evaluate(`export class Subject { ${methods.map(n => n.getText(source)).join('\n')} }`, {
        setConstant(range, value) { range.constant = value; },
    });
    const emitter = new Subject(); emitter._emitting = false; emitter._draining = false;
    emitter._points = Array.from({ length: 9 }, (_, i) => ({ rate: 10 + i, system: {
        isValid: true, enabled: false, isPlaying: false, count: 0, plays: 0, pauses: 0, polls: 0,
        rateOverTime: {}, play() { this.plays++; this.isPlaying = true; },
        pause() { this.pauses++; this.isPlaying = false; },
        getParticleCount() { this.polls++; return this.count; },
    } }));
    for (let pass = 0; pass < 3; pass++) {
        emitter.setEmitting(true); emitter.setEmitting(true);
        for (const { system: s, rate } of emitter._points) {
            assert.equal(s.enabled, true); assert.equal(s.plays, pass + 1);
            assert.equal(s.rateOverTime.constant, rate); s.count = 1;
        }
        emitter.setEmitting(false); emitter.updateIdle();
        for (const { system: s } of emitter._points) {
            assert.equal(s.enabled, true, '未归零不能提前隐藏尾迹');
            assert.equal(s.rateOverTime.constant, 0);
        }
        emitter._points[0].system.count = 0; emitter.updateIdle();
        assert.equal(emitter._points[0].system.enabled, false);
        assert.equal(emitter._points[1].system.enabled, true);
        for (const { system: s } of emitter._points) s.count = 0;
        emitter.updateIdle();
        for (const { system: s } of emitter._points) assert.equal(s.enabled, false);
        const polls = emitter._points.map(p => p.system.polls);
        for (let frame = 0; frame < 180; frame++) { emitter.setEmitting(false); emitter.updateIdle(); }
        assert.deepEqual(emitter._points.map(p => p.system.polls), polls, '休眠后不再轮询');
    }
});

test('空反馈队列复用且不能被调用方污染，有事件时仍只消费一次', () => {
    const h = createAiHarness(), body = h.create().body, motor = body.motor;
    for (const [owner, method] of [[body, 'consumeConditionInputs'], [body, 'consumeRhythmResults'], [motor, 'consumeStrokeQualityResults']]) {
        const empty = owner[method]();
        assert.equal(empty.length, 0); assert.ok(Object.isFrozen(empty));
        for (let i = 0; i < 180; i++) assert.equal(owner[method](), empty);
        assert.throws(() => empty.push({}), TypeError);
    }
    const event = { rating: 'good' }; body._pendingRhythmResults.push(event);
    const results = body.consumeRhythmResults(); assert.equal(results[0], event);
    assert.equal(body.consumeRhythmResults().length, 0);
    results.length = 0; assert.equal(body.consumeRhythmResults().length, 0);
});

test('物理输出缓冲保持快照语义，连续积分复用三个对象且选手之间隔离', () => {
    const h = createAiHarness();
    const { SwimPhysicsModel } = h.load('swimmer/SwimPhysicsModel');
    const physics = new SwimPhysicsModel(), out = { currentSpeed: NaN, distance: NaN };
    for (const speed of [0, .8, 2, 20]) for (const dt of [0, 1/120, 1/60, 1/30]) {
        const state = Object.freeze({ currentSpeed: speed, distance: 27 });
        const input = Object.freeze({ dt, strokeAcceleration: 2.6, kickAcceleration: .4, speedCapBonus: .3, glideDrag: .9 });
        const fresh = physics.step(state, input);
        assert.notEqual(fresh, state);
        assert.notEqual(physics.step(state, input), fresh, '无输出参数的调用仍返回独立对象');
        assert.equal(physics.step(state, input, out), out);
        assert.deepEqual(out, fresh);
        const alias = { ...state };
        assert.equal(physics.step(alias, input, alias), alias);
        assert.deepEqual(alias, fresh);
    }
    const buffered = h.create().body.motor, reference = h.create().body.motor;
    // 对照组每次用独立结果，与原有物理 API 的返回语义相同。
    reference._physics.step = (state, input) => physics.step(state, input);
    const refs = [];
    buffered._physics.step = (state, input, target) => {
        assert.ok(target);
        if (!refs.length) refs.push(state, input, target);
        else { assert.equal(state, refs[0]); assert.equal(input, refs[1]); assert.equal(target, refs[2]); }
        return physics.step(state, input, target);
    };
    const options = { isAI: true };
    for (let frame = 0; frame < 480; frame++) {
        const dt = [0, 1/120, 1/60, 1/30][frame % 4];
        if (frame === 240) { buffered.startRace(51, 2, .4); reference.startRace(51, 2, .4); }
        for (const motor of [buffered, reference]) {
            motor.setGlidePhase(frame % 80 < 20, frame % 40 < 20 ? .9 : .4);
            motor._strokeAcceleration = frame % 3 ? 1.2 : 0;
            motor._strokeAccelerationSeconds = .1;
            motor._strokeAccelerationTotalSeconds = .1;
            motor.update(dt, options);
        }
        for (const key of ['currentSpeed', 'currentAcceleration', 'distance', 'bodyPhase', 'leftArmCycle', 'rightArmCycle']) {
            assert.equal(buffered[key], reference[key], `${key} 第${frame}步`);
        }
    }
    assert.notEqual(buffered._physicsState, reference._physicsState);
    assert.notEqual(buffered._physicsInput, reference._physicsInput);
    assert.notEqual(buffered._physicsResult, reference._physicsResult);
});

test('缩道预测复用范围，并列仍取首位，已发布的事件不会被后续帧修改', () => {
    const h = createHarness();
    const { LaneLayout, laneEdgeZ } = h.load(h.root + '/assets/scripts/venue/LaneLayout.ts');
    const { LaneLockdownRaceController: Controller } = h.load(h.root + '/assets/scripts/core/LaneLockdownRaceController.ts');
    const { GameState } = h.load(h.root + '/assets/scripts/core/GameConstants.ts');
    const layout = new LaneLayout(8, 2.625), events = [];
    const d = new Controller(layout, null, () => {}, () => {}, value => events.push(value));
    const racers = [0, 7].map(lane => ({ distance: 10, node: { position: { z: layout.centerZ(lane) } } }));
    const range = d.safeLaneRangeForLeader(racers[0], 6);
    for (let i = 0; i < 180; i++) {
        d.update(1/60, GameState.RACING, racers);
        assert.equal(d.safeLaneRangeForLeader(racers[0], 6), range);
    }
    assert.equal(events.length, 1);
    const first = events[0], saved = { ...first };
    assert.equal(first.safeMaxZ, laneEdgeZ(1, layout));
    racers[1].distance = 20;
    d.update(1/60, GameState.RACING, racers);
    assert.equal(events.length, 2); assert.notEqual(events[1], first);
    assert.deepEqual(first, saved);
    const other = new Controller(layout, null, () => {}, () => {}, () => {});
    assert.notEqual(other.safeLaneRangeForLeader(racers[0], 6), range);
    racers[0].distance = racers[1].distance = 50;
    d.update(1/60, GameState.RACING, racers);
    assert.equal(d._pendingFirstSafeLane, 1, '并列到达警戒线仍使用数组首位');
});

test('AI 条件无参更新保持真实模型结果，单机门控和联机完成门控不变', () => {
    const h = createAiHarness();
    const condition = h.create().condition, reference = h.create().condition;
    const { source, cls } = classSource('assets/scripts/core/GameManager.ts', 'GameManager');
    const methods = cls.members.filter(n => ['updateAiConditions', 'updateNetAiConditionStep'].includes(n.name?.getText(source)));
    const { Subject } = evaluate(`export class Subject { ${methods.map(n => n.getText(source)).join('\n')} }`);
    const d = new Subject(), calls = [], received = {};
    const tick = condition.tickAi.bind(condition);
    condition.tickAi = (...args) => { calls.push(args.length); tick(...args); };
    const swimmer = { distance: 20, isRacing: true, heartRate: 160, motor: { ability: { infiniteStamina: false } },
        consumeAiConditionStrokes: () => 2,
        applyConditionSpeedScale: value => { received.speed = value; },
        applyConditionQualityScale: value => { received.quality = value; },
        applyConditionCadenceScale: value => { received.cadence = value; },
    };
    d._aiSwimmers = [swimmer]; d._aiControllers = [{ difficulty: .7 }]; d._aiConditions = [condition];
    d._netSession = null;
    reference.consumeStrokes(2); reference.syncHeartRate(160);
    reference.tickAi({ difficulty: .7, progress: .1, dt: 1/60 });
    d.updateAiConditions(1/60);
    assert.deepEqual(condition.readout(), reference.readout());
    assert.deepEqual(received, { speed: reference.efficiencyModifier, quality: reference.qualityModifier, cadence: reference.strokeCadenceScale });
    assert.deepEqual(calls, [0]);
    d._netSession = {}; d.updateAiConditions(1/60);
    assert.deepEqual(calls, [0], '联机不在渲染帧重复推进AI条件');
    let phases = 0; d.advanceNetAiConditionPhase = () => { phases++; };
    d.updateNetAiConditionStep(0, .033, 200);
    assert.deepEqual(calls, [0, 0]); assert.equal(phases, 1);
    swimmer.distance = 200; d.updateNetAiConditionStep(0, .033, 200);
    swimmer.distance = 20; swimmer.isRacing = false; d.updateNetAiConditionStep(0, .033, 200);
    assert.deepEqual(calls, [0, 0], '完赛／未开游时不刷新运动倍率'); assert.equal(phases, 3);
});

test('基姿恢复覆盖采样附加骨骼、不遍历 Map，重采集和解绑不保留旧引用', () => {
    const { createRig, Node, Vec3, Quat } = require('./helpers/character-contact-harness.cjs');
    const { pose } = createRig('CartonSwimmer13.glb');
    const extra = new Node(pose.root, .1, .2, .3);
    pose._sampledActionNodes.set('验证附加骨骼', extra);
    pose.captureBasePose();
    const saved = [...pose._boneBaseRotation].map(([bone, rotation]) => ({
        bone, rotation: Quat.clone(rotation), position: Vec3.clone(pose._boneBasePosition.get(bone)),
    }));
    assert.ok(saved.some(value => value.bone === extra));
    const entries = pose._basePoseBones.slice();
    for (const map of [pose._boneBaseRotation, pose._boneBasePosition]) {
        map[Symbol.iterator] = () => { throw new Error('恢复时不能创建 Map iterator'); };
    }
    for (let frame = 0; frame < 120; frame++) {
        for (const { bone } of saved) { bone.setRotationFromEuler(frame, 35, 60); bone.setPosition(9, 8, 7); }
        pose.restoreBasePose();
        for (let i = 0; i < saved.length; i++) {
            const { bone, rotation, position } = saved[i];
            assert.deepEqual(bone.rotation, rotation); assert.deepEqual(bone.position, position);
            assert.equal(pose._basePoseBones[i], entries[i]);
        }
    }
    extra.isValid = false; extra.setPosition(9, 8, 7); pose.restoreBasePose();
    assert.equal(extra.position.x, 9, '失效节点不写变换'); extra.isValid = true;
    for (const map of [pose._boneBaseRotation, pose._boneBasePosition]) delete map[Symbol.iterator];
    extra.setPosition(1, 2, 3); pose.captureBasePose(); extra.setPosition(0, 0, 0); pose.restoreBasePose();
    assert.equal(extra.position.x, 1, '重采集替换基姿数据');
    assert.equal(pose._basePoseBones.length, saved.length, '重采集不堆积记录');
    pose.unbind(); assert.equal(pose._basePoseBones.length, 0); pose.restoreBasePose();
});

test('转身脚点保持左右脚／趾顺序、输出容量限制和缺骨兼容', () => {
    const h = createHarness();
    const { FreestylePoseController: Controller } = h.load(h.root + '/assets/scripts/character/FreestylePoseController.ts');
    const d = new Controller();
    for (const [i, key] of ['_leftFoot', '_leftToe', '_rightFoot', '_rightToe'].entries()) d[key] = new h.Node(null, i + 1, 0, 0);
    const outputs = Array.from({ length: 4 }, () => new h.Vec3());
    assert.equal(d.getFlipTurnFootContactWorldPositions(outputs), 4);
    assert.deepEqual(outputs.map(v => v.x), [1, 2, 3, 4]);
    d._leftToe = null;
    const limited = outputs.slice(0, 2);
    assert.equal(d.getFlipTurnFootContactWorldPositions(limited), 2);
    assert.deepEqual(limited.map(v => v.x), [1, 3]);
    assert.equal(d.getFlipTurnFootContactWorldPositions([]), 0);
});

test('水面借用列表保留角色／水花顺序，异步增删节点不堆积引用，实例间隔离', () => {
    const { source, cls } = classSource('assets/scripts/core/GameManager.ts', 'GameManager');
    const method = cls.members.find(n => n.name?.getText(source) === 'collectSwimmerNodes');
    const { Subject } = evaluate(`export class Subject { ${method.getText(source)} }`);
    const node = name => ({ name, isValid: true });
    const d = new Subject(), player = { node: node('玩家'), splashNode: node('玩家水花') };
    const ai = { node: node('对手'), splashNode: node('对手水花') };
    d._waterSwimmerNodes = []; d._playerSwimmer = player; d._aiSwimmers = [ai];
    const list = d.collectSwimmerNodes();
    assert.deepEqual(list, [player.node, player.splashNode, ai.node, ai.splashNode]);
    for (let i = 0; i < 180; i++) assert.equal(d.collectSwimmerNodes(), list);
    ai.splashNode.isValid = false; player.node.isValid = false;
    assert.deepEqual(d.collectSwimmerNodes(), [ai.node]);
    const second = { node: node('新对手'), splashNode: node('新水花') };
    d._aiSwimmers.push(second);
    assert.deepEqual(d.collectSwimmerNodes(), [ai.node, second.node, second.splashNode]);
    d._aiSwimmers = [];
    assert.equal(d.collectSwimmerNodes().length, 0);
    const other = new Subject(); other._waterSwimmerNodes = []; other._aiSwimmers = [];
    assert.notEqual(other.collectSwimmerNodes(), list);
});

test('浮漂周期重查复用列表，水面／水下层互换仍包含迟到子节点并清理已移除节点', () => {
    const { source, cls } = classSource('assets/scripts/venue/WaterRefractionController.ts', 'WaterRefractionController');
    const method = cls.members.find(n => n.name?.getText(source) === 'tagLaneFloats');
    const helpers = source.statements.filter(n => ts.isFunctionDeclaration(n)
        && ['collectNodesByNamePrefix', 'setLayerRecursive'].includes(n.name.text));
    const { Subject } = evaluate(`${helpers.map(n => n.getText(source)).join('\n')}
        export class Subject { ${method.getText(source)} }`, {
        Layers: { Enum: { DEFAULT: 1 } }, SWIMMER_LAYER: 1024, WATER_SURFACE_LAYER: 2048,
        LANE_FLOAT_NODE_PREFIX: 'lane_float_rope',
    });
    const node = (name, children = []) => ({ name, children, isValid: true, layer: 1 });
    const child = node('浮漂子网格'), rope = node('lane_float_rope_batch', [child]);
    const ignored = node('无关池边'), root = node('泳池', [rope, ignored]);
    const d = new Subject(); d._pool = root; d._laneFloatNodes = []; d._underwaterViewActive = false;
    const list = d._laneFloatNodes;
    for (let i = 0; i < 120; i++) {
        d._underwaterViewActive = i % 2 === 0; d.tagLaneFloats();
        assert.equal(d._laneFloatNodes, list); assert.deepEqual(list, [rope]);
        assert.equal(rope.layer, d._underwaterViewActive ? 1 : 1024);
        assert.equal(child.layer, rope.layer); assert.equal(ignored.layer, 1);
    }
    const late = node('lane_float_rope_late'); root.children.push(late);
    d.tagLaneFloats(); assert.deepEqual(list, [rope, late]); assert.equal(late.layer, rope.layer);
    root.children.splice(0, 1); d.tagLaneFloats(); assert.deepEqual(list, [late]);
    root.children = []; d.tagLaneFloats(); assert.equal(list.length, 0);
});
