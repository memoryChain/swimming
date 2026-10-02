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
    const camera = new RaceEventPictureInPictureCamera({ course: { direction: 1, poolWidth: 21, waterY: 0, distanceToWorldX: x => x } });
    const poses = [];
    camera.camera = { isValid: true, enabled: false };
    camera.cameraNode = { isValid: true, setWorldPosition(p) { poses.push({ ...p }); }, lookAt() {} };
    camera.root = { isValid: true, active: false };
    return { camera, poses };
}

function wave(id, x) {
    return Array.from({ length: 6 }, (_, i) => ({ active: true, wave: id, phase: 'falling',
        phaseProgress: i < 2 ? 0 : -1, courseX: x, lateral: i - 2.5 }));
}

function land(slots) {
    for (const slot of slots) { slot.phase = 'floating'; slot.phaseProgress = 0; }
}

test('背景垃圾让位期间仍存在世界槽位，恢复空闲不补拍旧波，巨浪立即抢占', () => {
    const { camera } = fixture(), first = wave(0, 10), second = wave(1, 20);
    camera.updateLitter(first, true, .1);
    assert.equal(camera.mode, 'litter');
    camera.showGiantWavePreview({ phase: 'active' });
    assert.equal(camera.mode, 'giant-wave');
    camera.updateLitter(first, true, .1, true, true);
    assert.equal(camera.mode, 'giant-wave');
    assert.ok(first.every(slot => slot.active), '放弃镜头不能删除世界垃圾');
    camera.hide();
    camera.updateLitter(first, true, .1, true, false);
    assert.equal(camera.mode, 'none', '空闲时不补拍旧波');
    camera.updateLitter(second, true, .1, true, false);
    assert.equal(camera.mode, 'litter', '之后的新波仍可使用空闲镜头');
    camera.updateLitter(second, true, .1, true, true);
    assert.equal(camera.mode, 'none', '主事件预告预约即可让位，不必等新镜头出现');
    camera.reset();
    camera.updateLitter(first, true, .1);
    assert.equal(camera.mode, 'litter', '下一局不能保留旧波丢弃记录');
});

test('同波三组入场、漂浮和受推都不牵动已建立的构图', () => {
    const { camera } = fixture(), slots = wave(0, 10);
    camera.updateLitter(slots, true, 1 / 30);
    const initial = { ...camera.focus };
    for (let i = 0; i < 2; i++) {
        slots[i].phase = 'floating'; slots[i].courseX += 4; slots[i].lateral += 3;
    }
    // 分组间隔可调，后两组尚未入场时仍保留当前整波取景。
    for (let i = 0; i < 30; i++) camera.updateLitter(slots, true, 1 / 30);
    assert.equal(camera.mode, 'litter');
    assert.deepEqual({ ...camera.focus }, initial);
    slots[2].phaseProgress = .1;
    camera.updateLitter(slots, true, 1 / 30);
    assert.deepEqual({ ...camera.focus }, initial);
});

test('连续波次先看完到位水花，再平移到新中心且不中途关闭画面', () => {
    const { camera, poses } = fixture(), first = wave(0, 10), second = wave(1, 16), slots = [...first, ...second];
    camera.updateLitter(first, true, 1 / 30);
    camera.updateLitter(slots, true, 1 / 30);
    assert.equal(camera.focus.x, 10, '新波出现不能抢走仍在入场的当前波');
    land(first);
    for (let i = 0; i < 14; i++) {
        camera.updateLitter(slots, true, 1 / 30);
        assert.equal(camera.focus.x, 10, '保留到位水花');
    }
    for (let i = 0; i < 2; i++) camera.updateLitter(slots, true, 1 / 30);
    assert.equal(camera.litterWave, 1);
    assert.ok(camera.focus.x < 10.1, '切换时不能跳到新落点');
    for (let i = 0; i < 20; i++) {
        camera.updateLitter(slots, true, 1 / 30);
        assert.equal(camera.root.active, true);
    }
    assert.equal(camera.focus.x, 16);
    for (let i = 1; i < poses.length; i++) {
        const step = poses[i].x - poses[i - 1].x;
        assert.ok(step >= -1e-9 && step < .47, `相邻镜头位移 ${step} 应平滑且不回摆`);
    }
    land(second);
    for (let i = 0; i < 16; i++) camera.updateLitter(slots, true, 1 / 30);
    assert.equal(camera.root.active, false);
});

test('平移时长不随比赛帧率或画中画限频改变', () => {
    function run(simulationFps, renderFps) {
        const { camera, poses } = fixture(renderFps), first = wave(0, 10), second = wave(1, 16);
        camera.updateLitter(first, true, 0);
        land(first);
        camera.updateLitter([...first, ...second], true, .6);
        const start = poses.length;
        for (let i = 0; i < simulationFps / 2; i++) camera.updateLitter(second, true, 1 / simulationFps);
        assert.ok(poses.length - start <= renderFps / 2 + 1);
        return camera.litterFocusWorldX;
    }
    const reference = run(30, 30);
    assert.ok(reference > 15 && reference < 16);
    assert.ok(Math.abs(run(60, 30) - reference) < 1e-9);
    assert.ok(Math.abs(run(120, 15) - reference) < 1e-9);
});

test('重开、事件抢占和独立波次重新出现不沿用旧镜头插值', () => {
    const { camera } = fixture();
    camera.updateLitter(wave(0, 10), true, 1 / 30);
    camera.reset();
    camera.updateLitter(wave(0, 40), true, 1 / 30);
    assert.equal(camera.focus.x, 40);
    camera.mode = 'cannon';
    const unreadable = new Proxy([], { get() { throw new Error('被抢占时不应读取垃圾槽位'); } });
    camera.updateLitter(unreadable, true, 1 / 30);
    camera.hide();
    camera.updateLitter(wave(1, 20), true, 1 / 30);
    assert.equal(camera.focus.x, 20);
    camera.updateLitter(unreadable, false, 1 / 30);
    assert.equal(camera.root.active, false);
    camera.updateLitter(wave(2, 30), true, 1 / 30);
    assert.equal(camera.focus.x, 30);
});

test('当前镜头不会因晚到旧波状态向后切回', () => {
    const { camera } = fixture(), old = wave(0, 10), latest = wave(2, 30);
    camera.updateLitter(latest, true, 1 / 30);
    land(latest);
    camera.updateLitter([...old, ...latest], true, .6);
    assert.equal(camera.mode, 'none');
    assert.equal(camera.focus.x, 30);
});

test('杂物近景聚焦首组高抛，浮标采用更低更近的上浮镜头', () => {
    const { camera } = fixture();
    const slots = wave(0, 25);
    slots.forEach((slot, index) => { slot.lateral = index * 3 - 7.5; slot.spawnOrder = index + 1; });
    slots[1].spawnOrder = 0;
    camera.updateLitter(slots, true, 1 / 30);
    assert.equal(camera.focus.z, slots[1].lateral);
    assert.equal(camera.cameraPosition.x, 12);
    assert.equal(camera.lastFov, 52);
    camera.hide();
    camera.updateBuoys([{ active: true, courseX: 30, lateral: 3 }], true, 1 / 30);
    assert.equal(camera.focus.x, 30);
    assert.equal(camera.cameraPosition.x, 19.5);
    assert.equal(camera.cameraPosition.y, 1.6);
    assert.equal(camera.lastFov, 48);
});

test('浮标画面被杂物抢占后只恢复剩余时间，过期或重开不补播旧入场', () => {
    const { camera } = fixture();
    const buoys = [{ active: true, courseX: 25, lateral: 3 }];
    camera.updateBuoys(buoys, true, .1);
    assert.equal(camera.mode, 'buoy');
    camera.updateLitter(wave(0, 10), true, .1);
    assert.equal(camera.mode, 'litter');
    camera.hide();
    camera.updateBuoys(buoys, true, .1);
    assert.equal(camera.mode, 'buoy');
    assert.equal(camera.focus.x, 25);
    camera.mode = 'cannon';
    camera.updateBuoys(buoys, true, 3);
    camera.hide();
    camera.updateBuoys(buoys, true, .1);
    assert.equal(camera.mode, 'none');
    camera.reset();
    camera.updateBuoys(buoys, true, .1);
    assert.equal(camera.mode, 'buoy');
});
