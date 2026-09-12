const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
const { load, Vec3, root } = createHarness();
const { RaceCameraDirector, RaceCameraMode } = load(root + '/assets/scripts/camera/RaceCameraDirector.ts');
const { CharacterAbilityState } = load(root + '/assets/scripts/swimmer/CharacterAbilityState.ts');
const { InputRouter } = load(root + '/assets/scripts/core/InputRouter.ts');
const { SwimmerMotor } = load(root + '/assets/scripts/swimmer/SwimmerMotor.ts');
const { StrokeType } = load(root + '/assets/scripts/core/GameConstants.ts');
const { STROKE_QUALITY_TUNING } = load(root + '/assets/scripts/core/InputTuning.ts');

function setup(mode = RaceCameraMode.Sprint, direction = 1, lane = 0, waterY = 0.055) {
    const layout = { waterY, poolStartX: -25, poolFinishX: 25, poolWidth: 24,
        directionAtDistance: () => direction };
    const lens = {};
    const camera = { setPosition(v) { this.position = Vec3.clone(v); },
        lookAt(v) { this.target = Vec3.clone(v); }, getComponent() { return lens; } };
    const director = new RaceCameraDirector(lane, layout);
    director.bindCamera(camera);
    director.selectMode(mode);
    const snapshot = { playerX: 0, playerY: waterY, playerDistance: 10,
        playerUpperBodyWorldPosition: new Vec3(0, waterY + 0.3, lane),
        playerFinished: false, playerUnderwater: false, playerKickDiveDepth: 0,
        raceActive: true, countdownActive: false, sprintActive: false,
        playerPlacement: 2, racerCount: 8, closestAiDistanceGap: 3 };
    function tick(seconds, hz = 60) {
        for (let i = 0; i < Math.round(seconds * hz); i++) director.update(1 / hz, snapshot);
    }
    function depth(value) {
        snapshot.playerKickDiveDepth = value;
        snapshot.playerY = waterY - value;
        snapshot.playerUpperBodyWorldPosition.y = waterY + 0.3 - value;
    }
    tick(2);
    return { director, camera, snapshot, lens, tick, depth, layout };
}

test('未到碰撞免疫深度也能进入潜航镜头，松手后的上浮全过程保持跟随', () => {
    const s = setup();
    s.depth(0.3);
    s.tick(0.8);
    assert.equal(s.snapshot.playerUnderwater, false);
    assert.equal(s.director.underwaterViewActive, true);
    assert.ok(s.camera.position.y <= s.layout.waterY - 0.2);
    s.snapshot.playerArmStrokeActive = true;
    s.depth(0.1); s.tick(0.2);
    assert.equal(s.director.underwaterViewActive, true, '划水上浮途中不提前硬切');
    const before = s.camera.position.y;
    s.depth(0); s.tick(1 / 60);
    assert.ok(s.camera.position.y - before < 0.65, '回到水面时不能跳到完整水面机位');
    s.tick(1);
    assert.equal(s.director.underwaterViewActive, false);
    assert.ok(s.camera.position.y >= s.layout.waterY + 0.25);
});

test('三种常规模式均可潜航并恢复，重复进出不残留水下状态', () => {
    for (const mode of [RaceCameraMode.Broadcast, RaceCameraMode.Top, RaceCameraMode.Sprint]) {
        const s = setup(mode);
        for (let i = 0; i < 3; i++) {
            s.depth(0.8); s.tick(1.2);
            assert.equal(s.director.underwaterViewActive, true);
            assert.equal(s.director.topViewActive, false);
            assert.ok(Math.abs(s.lens.fov - 58) < 0.1);
            s.depth(0); s.tick(2);
            assert.equal(s.director.mode, mode);
            assert.equal(s.director.underwaterViewActive, false);
            assert.equal(s.director.topViewActive, mode === RaceCameraMode.Top);
        }
    }
});

test('双向、偏航、边缘泳道与不同水位下，水下相机保持在池内且跟在身后', () => {
    for (const direction of [-1, 1]) for (const lane of [-11, 11]) {
        const s = setup(RaceCameraMode.Sprint, direction, lane, 2);
        s.snapshot.playerHeading = lane > 0 ? -0.5 : 0.5;
        s.depth(0.8); s.tick(2);
        assert.ok(s.camera.position.x * direction < -1);
        assert.ok(Math.abs(s.camera.position.z) <= 11.55);
        assert.ok(s.camera.position.y >= s.layout.waterY - 1.35);
        assert.ok(s.camera.position.y <= s.layout.waterY - 0.2);
        s.snapshot.playerX = -24 * direction;
        s.snapshot.playerUpperBodyWorldPosition.x = s.snapshot.playerX;
        s.tick(1);
        assert.ok(Math.abs(s.camera.position.x) <= 24.55);
    }
});

test('相同权威深度在不同渲染帧率下得到一致水下取景，无效深度不触发', () => {
    const positions = [];
    for (const hz of [30, 60, 120]) {
        const s = setup();
        s.depth(0.8); s.tick(1, hz);
        positions.push(s.camera.position);
    }
    assert.ok(Vec3.distance(positions[0], positions[1]) < 0.001);
    assert.ok(Vec3.distance(positions[1], positions[2]) < 0.001);
    for (const value of [undefined, NaN, Infinity, -1]) {
        const s = setup(); s.snapshot.playerKickDiveDepth = value; s.tick(1);
        assert.equal(s.director.underwaterViewActive, false);
    }
});

test('终点、调试俯视、大屏转播与重开不会被潜航镜头抢占', () => {
    const s = setup(); s.depth(0.8); s.tick(1);
    s.director.toggleFieldOverview(); s.tick(1);
    assert.equal(s.director.topViewActive, true);
    assert.equal(s.director.underwaterViewActive, false);
    s.director.toggleFieldOverview();
    s.director.setFeedMode(true); s.tick(1);
    assert.equal(s.director._kickDiveViewActive, false);
    s.director.setFeedMode(false); s.tick(1);
    s.director.resetCountdownTimers(); s.depth(0); s.tick(1);
    assert.equal(s.director._kickDiveViewActive, false);
    assert.equal(s.director.underwaterViewActive, false);
    s.depth(0.8); s.tick(1);
    s.snapshot.playerFinished = true;
    s.layout.currentCourseEndDistance = () => 200;
    s.layout.finishDirectionAtDistance = () => 1;
    s.layout.distanceToWorldX = () => 25;
    s.tick(1);
    assert.equal(s.director.underwaterViewActive, false);
    assert.equal(s.lens.fov, 46);
});

test('潜航过程中海豚跳、翻滚转身、领奖与自由观战仍保持原有优先级', () => {
    for (const kind of ['dolphin', 'flip', 'awards', 'spectator']) {
        const s = setup(); s.depth(0.8); s.tick(1);
        let called = false;
        if (kind === 'dolphin') {
            s.snapshot.playerDolphinCameraActive = true;
            s.director.updateDolphinCamera = () => { called = true; };
        } else if (kind === 'flip') {
            s.snapshot.playerFlipTurnCameraActive = true;
            s.director.updateFlipTurnCamera = () => { called = true; };
        } else if (kind === 'awards') {
            s.director._awardsCenter = new Vec3();
            s.director.updateBroadcastCamera = () => { called = true; };
        } else {
            s.director._spectatorFreeLookActive = true;
            s.director._spectatorCenter = new Vec3();
            s.director.updateSpectatorCamera = () => { called = true; };
        }
        s.tick(1 / 60);
        assert.equal(called, true, kind);
        assert.equal(s.director._kickDiveViewActive, false, kind);
        assert.equal(s.director._kickDiveSurfaceRestore, false, kind);
    }
});

test('真实踢腿改划水时逐帧穿过水面，不从水下安全高度跳到水面安全高度', () => {
    for (const hz of [30, 60, 120]) {
        const s = setup();
        const ability = new CharacterAbilityState(); ability.configure('kickDive');
        ability.depth = 0.8;
        s.depth(ability.depth); s.tick(1, hz);
        s.snapshot.playerArmStrokeActive = true;
        let previousY = s.camera.position.y;
        let crossed = false;
        for (let frame = 0; frame < 2 * hz; frame++) {
            ability.tick(1 / hz, true);
            s.depth(ability.depth); s.tick(1 / hz, hz);
            const y = s.camera.position.y;
            if (previousY < s.layout.waterY && y >= s.layout.waterY) {
                crossed = true;
                assert.ok(y - previousY <= 4 / hz,
                    `${hz}Hz 出水帧跳变 ${(y - previousY).toFixed(3)}m`);
            }
            assert.equal(s.director.underwaterViewActive, y < s.layout.waterY);
            previousY = y;
        }
        assert.ok(crossed);
        assert.equal(s.director.underwaterViewActive, false);
    }
});

test('上浮中再次踢腿、浅潜反复划水及快照深度归零，都从实际机位接续', () => {
    for (const hz of [30, 60, 120]) for (const mode of [RaceCameraMode.Sprint, RaceCameraMode.Broadcast]) {
        const s = setup(mode);
        const ability = new CharacterAbilityState(); ability.configure('kickDive');
        s.depth(0.8); ability.depth = 0.8; s.tick(1, hz);
        let previousY = s.camera.position.y;
        let maxCrossingStep = 0;
        for (let frame = 0; frame < 5 * hz; frame++) {
            const time = frame / hz;
            const kicks = time < 2.8 && Math.floor(time / 0.22) % 2 === 1;
            s.snapshot.playerArmStrokeActive = !kicks;
            if (kicks) ability.kick();
            ability.tick(1 / hz, !kicks);
            // 模拟权威深度提前归零，画面仍应从原位置开始上浮。
            if (frame === Math.round(1.6 * hz)) ability.depth = 0;
            s.depth(ability.depth); s.tick(1 / hz, hz);
            const y = s.camera.position.y;
            if (Math.abs(previousY - s.layout.waterY) <= 0.35) {
                maxCrossingStep = Math.max(maxCrossingStep, Math.abs(y - previousY));
                assert.ok(Math.abs(y - previousY) <= 4 / hz,
                    `${hz}Hz 模式${mode} 在${time.toFixed(2)}s跳变${Math.abs(y - previousY).toFixed(3)}m`);
            }
            assert.equal(s.director.underwaterViewActive, y < s.layout.waterY);
            previousY = y;
        }
        assert.ok(maxCrossingStep > 0, '确实覆盖水面交界处的运动');
        assert.equal(s.director._kickDiveSurfaceRestore, false);
        assert.equal(s.director.underwaterViewActive, false);
    }
});

test('真实输入分类：长按划水的起手踢腿不切水下，短按踢腿仍可进入潜航', () => {
    const originalNow = Date.now;
    const originalHold = STROKE_QUALITY_TUNING.minHoldSeconds;
    try {
        for (const hz of [30, 60, 120]) for (const threshold of [0.1, 0.2, 0.4]) {
            STROKE_QUALITY_TUNING.minHoldSeconds = threshold;
            const s = setup();
            const motor = new SwimmerMotor(); motor.setCharacterAbility('kickDive'); motor.startRace(10, 2);
            let now = 1000, strokes = 0;
            Date.now = () => now;
            const router = new InputRouter(null, {
                onStrokeHeld: (side, held, preHeld) => { motor.setStrokeHeld(side, held, preHeld); return true; },
                onStroke: side => { if (motor.recordStroke(side)) strokes++; },
                onKickStroke: side => motor.recordKickTap(side, false),
                onKickConfirmed: () => motor.confirmKickAbility(),
            });
            function frame() {
                now += 1000 / hz;
                router.tick(); motor.update(1 / hz, { isAI: false });
                s.depth(motor.ability.depth);
                s.snapshot.playerArmStrokeActive = motor.isArmStrokeActive;
                s.snapshot.playerUnderwater = motor.ability.ignoresSwimmers;
                s.tick(1 / hz, hz);
            }
            for (let repeat = 0; repeat < 4; repeat++) {
                const side = repeat % 2 ? StrokeType.RIGHT : StrokeType.LEFT;
                router.handleScreenStroke(side);
                for (let i = 0; i < Math.ceil((threshold + 0.5) * hz); i++) {
                    frame();
                    assert.equal(motor.ability.depth, 0, '普通划水全程不得触发能力下沉');
                    assert.equal(s.director._kickDiveViewActive, false,
                        `${hz}Hz 长按阈值${threshold}秒，第${repeat + 1}划误触发潜航`);
                    assert.equal(s.director.underwaterViewActive, false);
                }
                router.handleScreenStrokeEnd(side);
                for (let i = 0; i < hz * 2; i++) frame();
            }
            assert.ok(strokes >= 4, '确实经过输入分类并开始手臂划水');
            for (let i = 0; i < hz * 2; i++) {
                if (i % Math.max(1, Math.round(hz * 0.1)) === 0) {
                    router.handleScreenStroke(StrokeType.LEFT);
                    router.handleScreenStrokeEnd(StrokeType.LEFT);
                }
                frame();
            }
            assert.equal(s.director.underwaterViewActive, true, '短按踢腿仍进入水下镜头');
            router.handleScreenStroke(StrokeType.RIGHT);
            for (let i = 0; i < hz * 2; i++) frame();
            assert.equal(s.director.underwaterViewActive, false, '潜航改长按划水后正常恢复水面');
            assert.equal(s.director._kickDiveViewActive, false);
            router.handleScreenStrokeEnd(StrokeType.RIGHT);
        }
    } finally { Date.now = originalNow; STROKE_QUALITY_TUNING.minHoldSeconds = originalHold; }
});

test('输入边界：漏过分类帧的长按仍是划水，短按只确认一次，重置不触发潜航', () => {
    const originalNow = Date.now;
    let now = 1000, kicks = 0, confirmed = 0, strokes = 0;
    Date.now = () => now;
    const router = new InputRouter(null, {
        onKickStroke: () => kicks++, onKickConfirmed: () => confirmed++,
        onStrokeHeld: () => true, onStroke: () => strokes++,
    });
    try {
        router.handleScreenStroke(StrokeType.LEFT);
        now += (STROKE_QUALITY_TUNING.minHoldSeconds + .01) * 1000;
        router.handleScreenStrokeEnd(StrokeType.LEFT);
        assert.equal(strokes,1);assert.equal(confirmed,0);
        now += 1000;router.handleScreenStroke(StrokeType.LEFT);
        now += 100;router.handleScreenStroke(StrokeType.LEFT);
        router.handleScreenStrokeEnd(StrokeType.LEFT);router.handleScreenStrokeEnd(StrokeType.LEFT);
        assert.equal(kicks,2);assert.equal(confirmed,1);
        now += 1000;router.handleScreenStroke(StrokeType.RIGHT);
        router.resetStrokeInput();router.handleScreenStrokeEnd(StrokeType.RIGHT);
        assert.equal(confirmed,1);
    } finally {Date.now=originalNow;}
});
