const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../scripts/analyze-stroke-efficiency.cjs');
const R = load('core/GiantWaveRules');
const { SwimmerMotor } = load('swimmer/SwimmerMotor');
const B = load('core/GameBalance');
const make = (preset = 'three', min = 0, max = 50, seed = 712) => new R.GiantWaveSimulation(50, min, max, 20, seed, preset);
const sample = (distance = 10, x = 10, direction = 1) => ({ distance, x, z: 0, direction, speed: 3, eligible: true });
function spawn(sim, samples = [sample()]) {
    sim.update(.01, samples, false);
    for (let i = 0; i < 620 && sim.state.phase === 'preview'; i++) sim.update(.01, samples, false);
    assert.equal(sim.state.phase, 'active'); return sim.state;
}
function motor(speed = 2) {
    const m = new SwimmerMotor(); m.startRace(0, speed); m._physics.step = s => s; return m;
}
function face(dir, scale = 1) {
    for (let seed = 1; seed < 100; seed++) {
        const sim = make('single', 0, 50 * scale, seed);
        sim.update(.01, [sample()], false);
        if (sim.state.direction === dir) { spawn(sim); return sim; }
    }
    throw new Error('缺少随机方向覆盖');
}

test('独立模式隐藏于公开入口，正式事件池仍为七项', () => {
    assert.equal(B.getRaceModeConfig('giant-wave-brawl').publicEntry, false);
    assert.equal(B.getRaceDistance('giant-wave-brawl'), 200);
    assert.equal(B.PUBLIC_RACE_MODE_OPTIONS.some(x => x.id === 'giant-wave-brawl'), false);
    const D = load('core/EntertainmentModeDirector');
    for (let seed = 0; seed < 100; seed++) for (const distance of [200, 400])
        assert.ok(D.buildEntertainmentEventOrder(seed, distance).every(id => id <= 6));
});

test('同种子换人群位置、人数、朝向、游速与资格，预告和实际浪的方向范围速度完全相同', () => {
    for (let seed = 1; seed <= 200; seed++) {
        const a = make('single', 0, 50, seed), b = make('single', 0, 50, seed);
        const first = [sample()];
        const other = Array.from({ length: 8 }, (_, i) => ({ ...sample(10, 48 - i, -1), z: i - 4, speed: .2 + i, eligible: false }));
        a.update(.01, first, false); b.update(.01, other, false);
        assert.equal(a.state.phase, 'preview'); assert.deepEqual(a.snapshot(), b.snapshot());
        const announced = { direction: a.state.direction, z: a.state.z, speed: a.state.speed };
        spawn(a, first); spawn(b, other);
        assert.deepEqual(a.snapshot(), b.snapshot());
        assert.deepEqual({ direction: a.state.direction, z: a.state.z, speed: a.state.speed }, announced);
    }
});

test('多种子双端各约一半、横向覆盖无方向偏置，允许连续同向且不消费共享随机流', () => {
    let positive = 0, left = 0, same = 0, positiveLeft = 0;
    const random = load('core/SharedRNG');
    random.reseedSharedRandom(222); const expected = random.randomFloat(); random.reseedSharedRandom(222);
    for (let seed = 1; seed <= 4000; seed++) {
        const sim = make('three', 0, 50, seed); sim.update(.01, [sample()], false);
        const d = sim.state.direction;
        positive += d === 1; left += sim.state.z < 0; positiveLeft += d === 1 && sim.state.z < 0;
        sim.state.phase = 'waiting'; sim.state.wave = 1; sim.update(.01, [sample(60)], false);
        same += d === sim.state.direction;
        assert.ok(Math.abs(sim.state.z) + sim.state.width / 2 <= sim.poolWidth / 2 - .29);
    }
    for (const n of [positive, left, same]) assert.ok(n > 1800 && n < 2200, String(n));
    assert.ok(positiveLeft > 850 && positiveLeft < 1150);
    assert.equal(random.randomFloat(), expected);
});

test('三波仍按泳段排期，单波只发一次；跳过旧泳段不改变下一波随机结果', () => {
    for (const preset of ['three', 'single']) {
        const sim = make(preset), seen = new Set();
        for (let i = 0; i < 8000; i++) {
            const d = i / 100 * 2.5, lap = Math.floor(d / 50), offset = d % 50;
            sim.update(.01, [sample(d, lap % 2 ? 50 - offset : offset, lap % 2 ? -1 : 1)], d >= 200);
            if (sim.state.phase === 'active') seen.add(sim.state.wave);
        }
        assert.deepEqual([...seen], preset === 'single' ? [0] : [0, 1, 2]);
        assert.equal(sim.state.phase, 'complete');
    }
    const skipped = make(), normal = make();
    skipped.update(.01, [sample(60)], false); skipped.update(.01, [sample(60)], false);
    spawn(normal); normal.update(R.waveDuration(normal.state), [sample()], false);
    normal.update(10, [sample()], false); normal.update(.01, [sample(60)], false);
    assert.equal(skipped.cancelled, 1);
    assert.deepEqual(skipped.state, normal.state);
});

test('同一浪面顺向助推、逆向阻力，侧边更弱；起浪保护、离浪和拍岸没有作用', () => {
    const s = spawn(make());
    assert.equal(R.waveWeight(s, s.x, s.z, s.direction), 0);
    s.age = s.growthTime; s.x = s.startX + s.direction * R.waveTravel(s, s.age);
    assert.equal(R.waveWeight(s, s.x, s.z, s.direction), 1);
    assert.equal(R.waveWeight(s, s.x, s.z, -s.direction), -1);
    const side = R.waveWeight(s, s.x, s.z + s.width * .4, -s.direction);
    assert.ok(side < 0 && side > -.15);
    assert.equal(R.waveWeight(s, s.x, s.z + s.width, s.direction), 0);
    assert.equal(R.sweptWaveWeight(s, s.x + 10, s.z, s.x - 10, s.z, 1, .1), 0);
    s.age = R.waveArrivalTime(s);
    assert.equal(R.waveWeight(s, s.x, s.z, 1), 0); assert.equal(R.waveWeight(s, s.x, s.z, -1), 0);
});

test('两种方向与场景缩放均从端头行进到对岸拍散，统一速度不追人、不提前消失', () => {
    for (const scale of [.6, 1, 1.4]) for (const dir of [-1, 1]) {
        const sim = face(dir, scale), s = sim.state;
        assert.ok(Math.abs(s.startX - dir * s.length / 2 - (dir > 0 ? sim.minX : sim.maxX)) < 1e-8);
        const arrival = R.waveArrivalTime(s); let previous = s.x, hit = false;
        for (let i = 0; i < 5000 && s.phase === 'active'; i++) {
            sim.update(.01, [sample(10, i * .1, i % 2 ? 1 : -1)], false);
            assert.ok(s.x + s.length / 2 <= sim.maxX + 1e-8);
            assert.ok(s.x - s.length / 2 >= sim.minX - 1e-8);
            assert.ok((s.x - previous) * dir >= -1e-8); previous = s.x;
            if (s.age >= arrival) { hit = true; assert.equal(s.x, s.endX); }
            else assert.equal(s.phase, 'active');
        }
        assert.equal(hit, true);
        assert.ok(Math.abs(s.endX + dir * s.length / 2 - (dir > 0 ? sim.maxX : sim.minX)) < 1e-8);
        assert.ok(Math.abs(R.waveTravel(s, arrival - 1e-5) - s.travelDistance) < 1e-3);
    }
});

test('无人符合搭乘条件也照常起浪；完赛取消预告，已起浪自然结束', () => {
    const sim = make(); spawn(sim, [{ ...sample(), eligible: false, speed: 0 }]);
    assert.equal(sim.cancelled, 0);
    sim.reset(); sim.update(.01, [sample()], false); sim.update(.01, [sample()], true);
    assert.equal(sim.state.phase, 'complete');
    sim.reset(); spawn(sim); sim.update(.1, [sample()], true); assert.equal(sim.state.phase, 'active');
    sim.update(20, [sample()], true); assert.equal(sim.state.phase, 'complete');
});

test('预告和行进都能恢复已锁定方向，坏数据及旧版本不污染状态', () => {
    const a = make(), b = make(); a.update(.01, [sample()], false);
    assert.equal(b.restore(a.snapshot()), true); spawn(a); spawn(b, [sample(10, 48, -1)]);
    assert.deepEqual(a.snapshot(), b.snapshot()); a.update(2, [sample()], false);
    assert.equal(b.restore(a.snapshot()), true);
    a.update(.2, [], false); b.update(.2, [], false); assert.deepEqual(a.snapshot(), b.snapshot());
    for (const modify of [v => v.version = 1, v => v.state.x = NaN, v => v.state.slowdown = 1]) {
        const invalid = a.snapshot(); modify(invalid); assert.equal(b.restore(invalid), false);
    }
    b.reset(); assert.equal(b.state.phase, 'waiting');
    const idle = make('single', -25, 25); assert.equal(make('single', -25, 25).restore(idle.snapshot()), true);
});

test('真实 Motor 顺浪增加推进、迎浪中央减速30%，原游速与碰撞反冲不变', () => {
    B.setRaceMode('giant-wave-brawl');
    try {
        for (const self of [0, .1, 2, 4]) {
            const m = motor(self); m.setGiantWaveTarget(-1, 1, .3); m.update(.3, { isAI: false });
            const before = m.distance;
            for (let i = 0; i < 60; i++) m.update(1 / 60, { isAI: false });
            assert.ok(Math.abs(m.distance - before - self * .7) < 1e-8);
            assert.equal(m.currentSpeed, self); assert.ok(m.distance >= before);
            m._knockbackDistance = .8; m.clearGiantWave(); assert.equal(m._knockbackDistance, .8);
        }
        const m = motor(); m.setGiantWaveTarget(1, 1); m.update(.4, { isAI: false });
        const before = m.distance; m.update(1, { isAI: false }); assert.ok(Math.abs(m.distance - before - 3) < 1e-8);
        assert.equal(m.currentSpeed, 2);
    } finally { B.setRaceMode('competitive'); }
});

test('顺逆切换只有一个作用槽，30/60/120Hz一致，逆浪离开0.2秒恢复', () => {
    const totals = [];
    for (const fps of [30, 60, 120]) {
        const out = { speed: 0, average: 0 }; let distance = 0;
        for (let i = 0; i < fps * 4; i++) {
            const target = i < fps ? 1 : i < fps * 2 ? -1 : i < fps * 3 ? 0 : 1;
            R.advanceWaveBoost(out.speed, target, 1, 1 / fps, out);
            distance += (3 * (1 - out.negativeAverage * .3) + out.positiveAverage) / fps;
            assert.ok(out.speed >= -1 && out.speed <= 1);
            if (i === Math.ceil(fps * 2.3)) assert.equal(out.speed, 0);
        }
        totals.push(distance);
    }
    assert.ok(Math.max(...totals) - Math.min(...totals) < 1e-8, JSON.stringify(totals));
});

test('折返、停赛和重开清除正负作用，返回泳段不携带旧加速或阻力', () => {
    for (const sign of [-1, 1]) {
        const m = motor(); m.setGiantWaveTarget(sign, 1); m.update(.5, { isAI: false });
        m.beginFlipTurnPhase(); assert.equal(m.giantWaveSpeed, 0);
        m.setGiantWaveTarget(sign, 1); m.update(.5, { isAI: false }); m.stopRace(); assert.equal(m.giantWaveSpeed, 0);
        m.startRace(); assert.equal(m.giantWaveSpeed, 0); assert.equal(m._giantWaveTarget, 0);
        assert.equal(m._giantWaveSlowdown, 0);
    }
});

test('AI 使用同一份预告：顺浪并入，迎浪选最近安全侧，已离开范围不乱转向', () => {
    for (const dir of [-1, 1]) {
        const sim = face(dir), s = sim.state; s.phase = 'preview'; s.z = 0;
        const racer = { ...sample(10, 25, dir), z: 1 };
        const follow = R.giantWaveTargetZ(s, racer, 1, 20, 1);
        assert.ok(follow !== null && Math.abs(follow) < s.width / 2);
        racer.direction = -dir;
        const avoid = R.giantWaveTargetZ(s, racer, 1, 20, 1);
        assert.ok(avoid > s.width / 2 && avoid <= 9.45);
        racer.z = 9; assert.equal(R.giantWaveTargetZ(s, racer, 1, 20, 1), null);
        s.z = 4.2; racer.z = 3;
        assert.ok(R.giantWaveTargetZ(s, racer, 1, 20, 1) < s.z - s.width / 2, '窄侧空间不足时走另一侧');
        s.phase = 'active'; s.age = R.waveArrivalTime(s);
        assert.equal(R.giantWaveTargetZ(s, racer, 1, 20, 1), null);
    }
});

function trajectory(fps, dir, opposing = false, leave = false) {
    const sim = face(dir), s = sim.state, courseDir = opposing ? -dir : dir;
    let x = opposing ? (dir > 0 ? 36 : 14) : (dir > 0 ? 8 : 42);
    let z = s.z, oldX = x, oldZ = z, affected = 0, delta = 0;
    const out = { speed: 0, average: 0 }, self = 3;
    for (let i = 0; i < fps * 13; i++) {
        sim.update(1 / fps, [], false);
        if (leave && i >= fps * 3) z = s.z + s.width;
        const weight = R.sweptWaveWeight(s, x, z, oldX, oldZ, courseDir, 1 / fps);
        R.advanceWaveBoost(out.speed, s.boost * weight, s.boost, 1 / fps, out);
        const extra = out.positiveAverage - self * s.slowdown * out.negativeAverage / s.boost;
        oldX = x; oldZ = z; x += courseDir * (self + extra) / fps; delta += extra / fps;
        if (Math.abs(weight) > .1) affected += 1 / fps;
    }
    return { affected, delta, speed: out.speed };
}
test('完整移动轨迹可顺浪受益、迎浪短暂受阻、侧移退出，双方向与帧率接近', () => {
    for (const dir of [-1, 1]) {
        const following = trajectory(60, dir), headOn = trajectory(60, dir, true), left = trajectory(60, dir, false, true);
        assert.ok(following.affected > 2 && following.delta > 1, JSON.stringify(following));
        assert.ok(headOn.affected > .2 && headOn.delta < -.1 && headOn.delta > -2, JSON.stringify(headOn));
        assert.ok(left.delta < following.delta); assert.equal(left.speed, 0);
        assert.ok(Math.abs(trajectory(30, dir, true).delta - trajectory(120, dir, true).delta) < .04);
    }
});
