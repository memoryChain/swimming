// 执行真实赛事、起跳控制器和输入入口，渲染、音效与动作时间线使用外壳。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');

function fixture(tutorial = true) {
    const calls = [], scheduled = [], sent = [];
    const noop = () => {};
    const h = createHarness({
        'cc/env': { DEV: false, EDITOR: false, WECHAT: false },
        '../entity/Swimmer': { Swimmer: class {} },
        './StrokeSfxManager': { StrokeSfxManager: { preload: noop } },
        '../net/NetInputCapture': { captureNetInput: event => sent.push(event) },
        './UIController': {}, './SettlementView': {}, './RuntimeUiFactory': {},
        './RaceStartView': {}, './RaceHudStatusView': {}, './ProjectUiFonts': {},
    });
    Object.assign(h.cc, {
        Component: class {}, Vec2: class {},
        _decorator: { ccclass: () => C => C, property: (...args) => args.length > 1 ? undefined : noop },
        KeyCode: { KEY_A: 65, KEY_D: 68, ARROW_LEFT: 37, ARROW_RIGHT: 39 },
    });
    const load = name => h.load(path.join(h.root, 'assets/scripts', name + '.ts'));
    const { GameState: S } = load('core/GameConstants');
    const { RaceManager } = load('core/RaceManager');
    const { GameFlowController } = load('app/GameFlowController');
    const { SpeedStarsUiPrefabBuilder } = load('ui/SpeedStarsUiPrefabBuilder');
    const { InputManager } = load('core/InputManager');
    const { DIVE_BALANCE } = load('core/GameBalance');
    const player = {
        node: new h.Node(), distance: 0, swimmerName: '玩家',
        reset() { calls.push(['reset']); }, prepareDive() { calls.push(['prepare']); },
        setShowcaseAction() {}, prepareShowcaseStanding() { calls.push(['showcase']); },
        setDiveChargeEffect: noop, clearDiveChargeBurstBeforeTakeoff: noop, finishDiveChargeEffect: noop,
        getCameraUpperBodyWorldPosition: out => out,
        performDive(result) { calls.push(['dive', result]); return 0.7; },
    };
    const race = new RaceManager();
    race.playerSwimmer = player; race.tutorialMode = tutorial;
    race.unscheduleAllCallbacks = () => { scheduled.length = 0; };
    race.scheduleOnce = (callback, seconds) => scheduled.push({ callback, seconds });
    let state = S.READY;
    const camera = {
        setPlayerLaneZ: noop, resetCountdownTimers: noop, resetRaceTimers: noop, update: noop,
        prepareDiveView() { calls.push(['platform']); },
        resetToBroadcast: noop, startPreRacePresentation() { calls.push(['presentation']); },
        skipPreRacePresentation: () => true, startDiveShot() { calls.push(['dive-shot']); },
    };
    const ui = {
        showRaceHud: noop, updateProgress: noop, hideCountdown: noop, showDiveCharging: noop,
        showCountdown: value => calls.push(['countdown', value]),
        showGo: () => calls.push(['go']), showDivePrompt: mode => calls.push(['prompt', mode]),
        showDiveRelease: (power, late) => calls.push(['release', power, late]),
        updateDiveCharge: (power, visible) => calls.push(['charge', power, visible]), showGliding: noop,
    };
    const flow = new GameFlowController({ raceManager: race, playerSwimmer: player,
        aiSwimmers: [], aiControllers: [], uiFlow: ui, raceCameraDirector: camera,
        debug: noop, clearFinishRanks: noop, exitModelDebug: noop, isLiveRanksEnabled: () => false,
        setState: value => { state = value; calls.push(['state', value]); }, getState: () => state,
        beginCountdown: () => race.startRace(), applyPlayerDive: noop, playerDiveSpeedScale: () => 1,
    });
    flow.bindRaceManagerCallbacks();
    const pointer = new SpeedStarsUiPrefabBuilder({
        onDiveHoldStart: () => flow.handleDiveChargeStart(),
        onDiveHoldEnd: seconds => flow.handleDiveRelease(seconds),
    });
    const keyboard = new InputManager();
    keyboard.strokeTarget = { emit(event, seconds) {
        if (event === 'dive-charge-start') flow.handleDiveChargeStart();
        else if (event === 'dive-release') flow.handleDiveRelease(seconds);
    } };
    const advance = seconds => {
        for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += 1 / 60) {
            const dt = Math.min(1 / 60, seconds - elapsed);
            flow.updateRaceCamera(dt); race.stepSimulation(dt);
        }
    };
    return { flow, race, pointer, keyboard, calls, scheduled, sent, advance, DIVE_BALANCE, S };
}

test('教学加载后直接站上出发台，等待不代跳，不经过展示、倒计时或GO', () => {
    const s = fixture(); s.flow.startGame();
    assert.equal(s.race.state, s.S.DIVING);
    assert.deepEqual(s.calls.filter(c => c[0] === 'state').map(c => c[1]), [s.S.DIVING]);
    assert.equal(s.calls.filter(c => c[0] === 'prepare').length, 1);
    assert.equal(s.calls.filter(c => c[0] === 'platform').length, 1);
    assert.deepEqual(s.calls.find(c => c[0] === 'prompt'), ['prompt', true]);
    assert.equal(s.calls.some(c => ['presentation', 'showcase', 'countdown', 'go'].includes(c[0])), false);
    s.advance(10); s.race.onDiveReady();
    s.flow.handleDiveRelease(0);
    assert.equal(s.calls.some(c => c[0] === 'dive'), false, '确认说明的松手不能触发空跳');
    assert.equal(s.scheduled.length, 0);
});

for (const mode of ['mouse', 'touch', 'A', 'D']) {
    test(`${mode}：等待后长按至峰值，松手当帧真实起跳，不显示超时且重复松手无效`, () => {
        const s = fixture(); s.flow.startGame(); s.advance(5);
        const event = { getID: () => 12 };
        const key = { keyCode: mode === 'A' ? 65 : 68 };
        const press = () => mode === 'mouse' ? s.pointer.beginDiveMouse()
            : mode === 'touch' ? s.pointer.beginDiveTouch(event) : s.keyboard.onKeyDown(key);
        const release = () => mode === 'mouse' ? s.pointer.endDiveMouse()
            : mode === 'touch' ? s.pointer.endDiveTouch(event) : s.keyboard.onKeyUp(key);
        press(); s.race.onDiveReady();
        s.advance(s.DIVE_BALANCE.chargeCycleSeconds / 2);
        assert.equal(s.calls.some(c => c[0] === 'dive'), false, '长按期间不自动提交');
        assert.ok(s.calls.filter(c => c[0] === 'charge').at(-1)[1] > .99, '蓄力采用真实时钟');
        release();
        const dives = s.calls.filter(c => c[0] === 'dive');
        assert.equal(dives.length, 1, '无需等待下一帧或计时器');
        assert.ok(dives[0][1].power > .99);
        assert.equal(s.calls.find(c => c[0] === 'release')[2], false);
        assert.equal(s.scheduled.length, 1); assert.equal(s.scheduled[0].seconds, .7);
        release(); s.flow.handleDiveRelease(20); press(); release();
        assert.equal(s.calls.filter(c => c[0] === 'dive').length, 1);
        assert.equal(s.sent.filter(e => e.launchSpeed !== undefined).length, 1);
        s.scheduled.shift().callback(); assert.equal(s.race.state, s.S.GLIDING);
        s.scheduled.shift().callback(); assert.equal(s.race.state, s.S.RACING);
    });
}

test('普通比赛保留展示、倒计时、发令自动起跳及晚起跳评价', () => {
    for (const heldAtGo of [false, true]) {
        const s = fixture(false); s.flow.startGame();
        assert.ok(s.calls.some(c => c[0] === 'presentation'));
        assert.ok(s.calls.some(c => c[0] === 'state' && c[1] === s.S.PRECOUNTDOWN));
        s.flow.handlePrimaryAction(); assert.equal(s.race.state, s.S.COUNTDOWN);
        assert.ok(s.calls.some(c => c[0] === 'countdown' && c[1] > 0));
        if (heldAtGo) s.flow.handleDiveChargeStart();
        s.advance(s.race.countdownSeconds + .1);
        assert.ok(s.calls.some(c => c[0] === 'go'));
        if (heldAtGo) assert.equal(s.calls.filter(c => c[0] === 'dive').length, 1);
        else {
            s.advance(2); s.flow.handleDiveRelease(0);
            assert.equal(s.calls.find(c => c[0] === 'release')[2], true);
        }
        assert.equal(s.calls.some(c => c[0] === 'platform'), false);
    }
});
