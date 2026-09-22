const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');

function fixture(framesPerSecond = 30) {
    const h = createHarness({
        '../venue/WaterSurfaceBinder': { SWIMMER_LAYER: 1, UNDERWATER_LAYER: 2 },
        '../venue/TopViewCeilingController': { VENUE_CEILING_LAYER: 4, setCameraVenueCeilingVisible() {} },
        '../ui/ProjectUiFonts': {}, '../ui/RuntimeUiFactory': {}, '../platform/PlatformManager': {},
        '../core/PerformanceConfig': { PERFORMANCE_CONFIG: { eventPictureInPicture: { enabled: false, framesPerSecond } } },
    });
    h.cc.Color = class { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } };
    const { RaceEventPictureInPictureCamera } = h.load(path.join(h.root, 'assets/scripts/camera/RaceEventPictureInPictureCamera.ts'));
    const rules = h.load(path.join(h.root, 'assets/scripts/core/GiantWaveRules.ts'));
    const { SharkState } = h.load(path.join(h.root, 'assets/scripts/entity/SharkTuning.ts'));
    const course = { waterY: 0, poolWidth: 20, direction: 1, distanceToWorldX: x => x,
        directionAtDistance: () => 1, swimPosition: (x, z) => ({ x, z }) };
    // 仅替换 GPU 与 HUD 节点，实际执行共享镜头的优先级、生命周期与渲染限频。
    const camera = new RaceEventPictureInPictureCamera({ course });
    let poses = 0, textWrites = 0;
    camera.camera = { isValid: true, enabled: false };
    camera.cameraNode = { isValid: true, setWorldPosition() { poses++; }, lookAt() {} };
    camera.root = { isValid: true, active: false };
    const label = () => ({ value: '', color: new h.cc.Color(0, 0, 0, 0),
        get string() { return this.value; }, set string(v) { this.value = v; textWrites++; } });
    camera.titleLabel = label(); camera.statusLabel = label();
    const state = rules.newGiantWaveState();
    Object.assign(state, { phase: 'active', age: 0, x: 0, width: 10, travelDistance: 44, speed: 4 });
    return { camera, state, rules, SharkState, poses: () => poses, textWrites: () => textWrites };
}

test('巨浪镜头持续到余沫结束，保持30Hz上限且阶段不变时不重写文案', () => {
    const f = fixture(), { camera, state, rules } = f;
    camera.showGiantWavePreview(state);
    const writes = f.textWrites();
    for (let frame = 0; frame < 600; frame++) {
        state.age = frame / 60; state.x = state.age * state.speed;
        camera.updateGiantWave(true, 1 / 60, state);
        assert.equal(camera.mode, 'giant-wave');
        assert.equal(camera.root.active, true);
    }
    assert.ok(f.poses() >= 300 && f.poses() <= 301);
    assert.equal(f.textWrites(), writes);
    state.age = rules.waveArrivalTime(state) + state.impactTime + state.fadeTime / 2;
    state.x = 44;
    camera.updateGiantWave(true, 1 / 30, state);
    assert.match(camera.statusLabel.string, /拍岸/);
    assert.equal(camera.focus.x, 44);
    state.phase = 'gap'; camera.updateGiantWave(true, 1 / 60, state);
    assert.equal(camera.active, false);
    state.phase = 'preview'; camera.showGiantWavePreview(state);
    assert.equal(camera.active, false, '预告期不展示空镜头');
});

test('五类事件均能抢占巨浪，结束后自动接回当前浪位与拍岸阶段', () => {
    for (const mode of ['shark', 'cannon', 'timed-bomb', 'whirlpool', 'litter']) {
        const f = fixture(), { camera, state, rules, SharkState } = f;
        camera.updateGiantWave(true, 1 / 30, state);
        const carrier = { isValid: true };
        if (mode === 'shark') {
            camera.updateSharkCameraPose = () => {};
            camera.updateShark({ state: SharkState.HUNT, node: { activeInHierarchy: true } }, 1 / 30);
        } else if (mode === 'cannon') {
            camera.showCannonLaunch({ targetDistance: 20, targetZ: 0, strikeId: 1 });
            camera.showCannonImpact({ knockedLane: -1, hitMask: 0 });
        } else if (mode === 'timed-bomb') camera.showTimedBombCarrier(carrier, 0, 5, true);
        else if (mode === 'whirlpool') camera.showWhirlpoolPreview(20, 0, 1);
        else camera.updateLitter([{ active: true, phase: 'falling', phaseProgress: .5, wave: 0, courseX: 20, lateral: 0 }], true, 1 / 30);
        assert.equal(camera.mode, mode);
        const hold = camera.holdSeconds, renders = f.poses(), writes = f.textWrites();
        state.age = rules.waveArrivalTime(state) + .2; state.x = 44;
        for (let i = 0; i < 60; i++) {
            camera.showGiantWavePreview(state, true);
            camera.updateGiantWave(true, 1 / 60, state);
        }
        assert.equal(camera.mode, mode, '巨浪起浪和拍岸均不能抢回镜头');
        assert.equal(camera.holdSeconds, hold);
        assert.equal(f.poses(), renders);
        assert.equal(f.textWrites(), writes);
        if (mode === 'shark') camera.updateShark(null, 2);
        else if (mode === 'cannon') camera.updateCannon(null, 0, true, 2);
        else if (mode === 'timed-bomb') camera.updateTimedBomb(carrier, 0, 4, false, true, true, 2);
        else if (mode === 'whirlpool') camera.updateWhirlpool(true, 2);
        else camera.updateLitter([], true, 2);
        camera.updateGiantWave(true, 1 / 30, state);
        assert.equal(camera.mode, 'giant-wave'); assert.equal(camera.focus.x, 44);
        assert.match(camera.statusLabel.string, /拍岸/);
    }
});

test('巨浪结束或停止不会关闭其他镜头，重开清理后不恢复旧浪', () => {
    const { camera, state } = fixture();
    camera.updateGiantWave(true, 1 / 30, state);
    camera.showWhirlpoolPreview(20, 0, 1);
    state.phase = 'gap';
    camera.updateGiantWave(false, 0, state);
    assert.equal(camera.mode, 'whirlpool'); assert.equal(camera.active, true);
    camera.updateWhirlpool(true, 2); camera.updateGiantWave(true, 1 / 30, state);
    assert.equal(camera.mode, 'none');
    state.phase = 'active'; camera.updateGiantWave(true, 1 / 30, state);
    camera.updateGiantWave(false, 0, state);
    assert.equal(camera.mode, 'none'); assert.equal(camera.camera.enabled, false);
    camera.reset(); state.phase = 'waiting'; camera.updateGiantWave(true, 1 / 30, state);
    assert.equal(camera.mode, 'none');
});

test('持续镜头在不同帧率和低性能档真正关闭间歇帧，暂停后不持续重绘', () => {
    for (const [renderRate, frameRate] of [[30, 120], [30, 60], [30, 30], [20, 60]]) {
        const { camera, state } = fixture(renderRate);
        let renders = 0;
        for (let frame = 0; frame < frameRate * 10; frame++) {
            camera.updateGiantWave(true, 1 / frameRate, state);
            renders += Number(camera.camera.enabled);
        }
        assert.ok(renders >= renderRate * 10 && renders <= renderRate * 10 + 1,
            `${renderRate}/${frameRate}: ${renders}`);
        for (let i = 0; i < 120; i++) {
            camera.updateGiantWave(true, 0, state);
            assert.equal(camera.camera.enabled, false);
        }
        assert.equal(camera.root.active, true, '暂停保留已渲染画面');
    }
});
