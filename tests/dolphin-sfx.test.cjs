const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');

function fixture() {
    const h = createHarness();
    const load = name => h.load(path.join(h.root, 'assets/scripts', name + '.ts'));
    const played = [], pending = [];
    h.cc.AudioClip = class {};
    h.cc.director = { getScene: () => ({ addChild() {} }) };
    h.cc.game = { addPersistRootNode() {} };
    h.cc.Node = class extends h.cc.Node {
        constructor() { super(); }
        addComponent() { return { isValid: true, playOneShot: (clip, volume) => played.push({ clip, volume }) }; }
    };
    h.cc.assetManager = { getBundle: () => ({ load: (name, type, done) => pending.push(() => done(null, { name })) }) };
    const { StrokeSfxManager: audio } = load('app/StrokeSfxManager');
    const { SwimmerMotor } = load('swimmer/SwimmerMotor');
    const { SwimmerRacePhases } = load('entity/SwimmerRacePhases');
    const { DEFAULT_RACE_COURSE_LAYOUT } = load('venue/RaceCourseLayout');
    const { GameFlowController } = load('app/GameFlowController');
    const { GameState } = load('core/GameConstants');
    const { DOLPHIN_JUMP } = load('core/DolphinJumpConfig');
    function swimmer() {
        const motor = new SwimmerMotor();
        motor.startRace(10, 2);
        const host = {
            motor, node: new h.cc.Node(), startPosition: new h.Vec3(),
            courseLayout: DEFAULT_RACE_COURSE_LAYOUT, onDolphinSplash: null,
            updateBodyMotion() {},
            cartoonRig: {
                setDiveStreamlinePose() {}, setLegSplashSuppressed() {}, setPerfectGlowActive() {},
                triggerSplashBurst() {}, triggerTakeoffSplash() {}, triggerBigSplash() {}, finishRaceFlipTurn() {},
            },
        };
        host.phases = new SwimmerRacePhases(host);
        return host;
    }
    const player = swimmer(), ai = swimmer(), remote = swimmer();
    ai.isAI = true; remote.isAI = true; remote.collisionRemoteHuman = true;
    let state = GameState.RACING;
    const flow = new GameFlowController({
        playerSwimmer: player, aiSwimmers: [ai, remote], raceManager: {}, getState: () => state,
    });
    flow.bindRaceManagerCallbacks();
    audio.preload();
    return { player, ai, remote, flow, audio, played, DOLPHIN_JUMP,
        ready() { pending.splice(0).forEach(done => done()); },
        finishRace() { state = GameState.FINISHED; },
    };
}

function jump(host, dt = 1 / 60) {
    assert.equal(host.phases.tryStartDolphinJump(), true);
    for (let i = 0; host.phases.isDolphinJumpActive && i < 1000; i++) host.phases.tick(dt);
    assert.equal(host.phases.isDolphinJumpActive, false);
}

test('出水、落水各响一次，按键后的下潜和空中不重复响，落水略重', () => {
    for (const dt of [1 / 30, 1 / 60, 1 / 120, 0.5]) {
        const s = fixture(); s.ready();
        const phases = s.player.phases;
        assert.equal(phases.tryStartDolphinJump(), true);
        assert.equal(phases.tryStartDolphinJump(), false);
        assert.equal(s.played.length, 0);
        phases.tick(s.DOLPHIN_JUMP.dipSeconds / 2);
        assert.equal(s.played.length, 0);
        while (!phases.isDolphinAirActive) phases.tick(dt);
        assert.equal(s.played.length, 1);
        while (phases.isDolphinJumpActive) phases.tick(dt);
        for (let i = 0; i < 10; i++) phases.tick(dt);
        assert.equal(s.played.length, 2);
        assert.ok(s.played[1].volume > s.played[0].volume);
    }
});

test('只绑定本机主角，AI、远端真人和观战对象均无声音；解绑重绑不叠加', () => {
    const s = fixture(); s.ready();
    s.flow.bindRaceManagerCallbacks();
    s.flow.setCameraFollowAi(true, s.ai);
    jump(s.ai); jump(s.remote);
    assert.equal(s.played.length, 0);
    s.flow.clearRaceManagerCallbacks();
    assert.equal(s.player.onDolphinSplash, null);
    s.flow.bindRaceManagerCallbacks();
    jump(s.player);
    assert.equal(s.played.length, 2);
});

test('失败、取消和赛后不误响', () => {
    const s = fixture(); s.ready();
    s.player.motor.stopRace();
    assert.equal(s.player.phases.tryStartDolphinJump(), false);
    s.player.motor.startRace(10, 2);
    assert.equal(s.player.phases.tryStartDolphinJump(), true);
    s.player.phases.clearFlipTurnPhase();
    s.player.phases.tick(1);
    assert.equal(s.played.length, 0);
    s.finishRace(); jump(s.player);
    assert.equal(s.played.length, 0);
});

test('沿用音效音量和静音，未加载的过期水花不补播，划水音量不变', () => {
    const s = fixture();
    s.audio.playDolphinSplash('takeoff');
    s.ready(); assert.equal(s.played.length, 0);
    s.audio.setVolume(0); jump(s.player);
    assert.equal(s.played.length, 0);
    s.audio.setVolume(0.5);
    s.audio.playDolphinSplash('takeoff'); s.audio.playDolphinSplash('landing');
    s.audio.playStroke(); s.audio.playStroke(true);
    assert.deepEqual(s.played.map(p => p.volume), [0.30, 0.39, 0.16, 0.26]);
    assert.equal(new Set(s.played.map(p => p.clip)).size, 1);
});
