const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');

const h = createHarness({ './GeyserBrawlPresentation': {
    GeyserBrawlPresentation: class { update() {} dispose() {} },
} });
const rules = h.load(path.join(h.root, 'assets/scripts/core/GeyserBrawlRules.ts'));
const { GeyserBrawlController } = h.load(path.join(h.root, 'assets/scripts/core/GeyserBrawlController.ts'));
const tsPath = process.env.TYPESCRIPT_PATH || process.env.PATH.split(path.delimiter)
    .map(p => path.resolve(p, '../typescript/lib/typescript.js')).find(p => fs.existsSync(p));
const ts = require(tsPath);
const source = ts.createSourceFile('Swimmer.ts', fs.readFileSync(path.join(h.root,
    'assets/scripts/entity/Swimmer.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'Swimmer');
// 执行真正的泳者资格、命中和清理方法，避免替身把“擦边吞腾空”错误隐藏掉。
const methods = ['geyserHitEligible', 'applyGeyserHit', 'clearForcedLaunch', 'snapshotGeyserLane', 'restoreGeyserLane']
    .map(name => cls.members.find(n => n.name?.getText(source) === name).getText(source)).join('\n');
const Subject = vm.runInNewContext(ts.transpileModule(`class Subject { ${methods} }; Subject`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText, { GEYSER_TUNING: rules.GEYSER_TUNING, getRaceDistance: () => 200,
    StrokeType: { LEFT: 0, RIGHT: 1 } });

function fixture(direction = 1, intensity = 1, networked = false) {
    const course = { startX: direction > 0 ? 0 : 50, finishX: direction > 0 ? 50 : 0,
        swimY: 0, poolWidth: 21, direction,
        distanceToWorldX(d) { return this.startX + direction * d; },
        distanceToCurrentCourseEnd(d) { return 50 - d; } };
    const s = new Subject();
    Object.assign(s, { distance: 0, startPosition: { z: 0 }, node: { active: true, position: { y: 0, z: 0 } },
        _geyserHits: new rules.GeyserHitLedger(), _forcedLaunch: null,
        _forcedLaunchGrace: 0, _forcedLaunchEdge: 0, _phases: {}, _courseLayout: course,
        clearGiantWave() {},
        _motor: { isRacing: true, lateralOffset: 0, currentSpeed: 3, heading: 0, starts: 0, slows: 0,
            setForcedLaunchPosition(_d, _l, speed) { this.currentSpeed = speed; this.slows++; },
            applyCollisionPitchImpulse() {}, beginForcedLaunch() { this.starts++; } },
    });
    s.motor = s._motor;
    s.node.setPosition = (x, y, z) => Object.assign(s.node.position, { x, y, z });
    const hits = [];
    const controller = new GeyserBrawlController({}, course, [s], 1927, 1, intensity, 0,
        (_lane, id, strength) => hits.push({ id, strength }), rules.geyserTuningForRace(networked));
    return { s, hits, controller, course };
}

test('联机喷泉隔离私人调参，判定、表现时序及擦边惩罚使用同一固定规格', () => {
    const defaults = { ...rules.GEYSER_TUNING };
    const fixed = rules.geyserTuningForRace(true);
    try {
        rules.GEYSER_TUNING.burstSeconds = .35;
        rules.GEYSER_TUNING.coreRadius = .3;
        rules.GEYSER_TUNING.edgeSlowdownScale = .5;
        rules.GEYSER_TUNING.flightSeconds = 1.6;
        const host = fixture(1, 1, true), solo = fixture();
        for (const f of [host, solo]) {
            f.s.distance = f.controller.vents[0].x;
            f.s.motor.lateralOffset = f.controller.vents[0].z;
            f.controller.setAuthority(false);
            f.controller.update(2.1);
            f.controller.setAuthority(true);
            f.controller.update(.01);
        }
        assert.equal(host.hits[0]?.strength, 2, '联机此刻仍在喷发');
        assert.equal(solo.hits.length, 0, '单机沿用调短后的喷发时间');
        assert.equal(host.s._forcedLaunch.duration, fixed.flightSeconds);
        assert.equal(rules.geyserPhaseAt(host.controller.vents[0], 2.1, 2, fixed), 'burst');
        assert.equal(rules.geyserPhaseAt(host.controller.vents[0], 2.1, 2), 'falling');
        const remote = fixture(1, 1, true).s;
        assert.equal(remote.applyGeyserHit(1001, 1, 0, null, true), true);
        assert.equal(remote.motor.currentSpeed, 3 * fixed.edgeSlowdownScale);
        assert.equal(fixture().s.geyserTuning, rules.GEYSER_TUNING);
    } finally { Object.assign(rules.GEYSER_TUNING, defaults); }
});

test('正常游速从外圈连续游入中心，正反向和不同帧率都能打断腾空', () => {
    for (const direction of [1, -1]) for (const fps of [15, 30, 60, 120]) for (const speed of [2.5, 3, 3.4]) {
        const { s, hits, controller } = fixture(direction);
        s.motor.lateralOffset = controller.vents[0].z;
        for (let step = 0; step < fps * 3; step++) {
            s.distance = speed * (step + 1) / fps;
            s._forcedLaunchEdge = Math.max(0, s._forcedLaunchEdge - 1 / fps);
            controller.update(1 / fps);
        }
        assert.equal(hits.at(-1)?.strength, 2, `${direction}/${fps}/${speed}`);
        if (speed <= 3) assert.deepEqual(hits.map(hit => hit.strength), [1, 2]);
        if (hits.length === 2) assert.equal(hits[0].id, hits[1].id);
        assert.equal(s.motor.starts, 1);
        assert.equal(s.motor.slows, hits.length - 1);
        assert.ok(s._forcedLaunch);
    }
});

test('擦边不腾空，安全通道及预警阶段没有伤害', () => {
    for (const lateral of [1, 2]) {
        const { s, hits, controller } = fixture();
        s.motor.lateralOffset = controller.vents[0].z + lateral;
        for (let step = 0; step < 180; step++) {
            s.distance = (step + 1) * 3 / 60;
            s._forcedLaunchEdge = Math.max(0, s._forcedLaunchEdge - 1 / 60);
            controller.update(1 / 60);
            if (step < 89) assert.equal(hits.length, 0);
        }
        assert.deepEqual(hits.map(hit => hit.strength), lateral === 1 ? [1] : []);
        assert.equal(s.motor.starts, 0);
    }
});

test('核心可以升级擦边，旧包、重复包、跨喷口乱序不会吞新命中或重复施加', () => {
    const { s } = fixture();
    assert.equal(s.applyGeyserHit(1081, 1), true);
    assert.equal(s.geyserHitEligible, true);
    assert.equal(s.applyGeyserHit(1081, 1), false);
    assert.equal(s.applyGeyserHit(1081, 2), true);
    s.clearForcedLaunch();
    assert.equal(s.applyGeyserHit(1081, 2), false);
    assert.equal(s.applyGeyserHit(1081, 1), false);
    assert.equal(s.applyGeyserHit(1001, 2), true);
    s.clearForcedLaunch();
    assert.equal(s.applyGeyserHit(2001, 2, 2), false);
    assert.equal(s.applyGeyserHit(2001, 2), false);
    assert.equal(s.applyGeyserHit(1009, 2), false);
    assert.equal(s.applyGeyserHit(2009, 1, 1), false);
    assert.equal(s.applyGeyserHit(2009, 2), true);
    s.clearForcedLaunch(true);
    assert.equal(s.applyGeyserHit(1001, 2), true);
});

test('落水保护仍会拒绝新喷口，访客只消费权威命中', () => {
    const { s, controller, hits } = fixture();
    s._forcedLaunchGrace = 0.8;
    assert.equal(s.applyGeyserHit(1001, 2), false);
    s._forcedLaunchGrace = 0;
    controller.setAuthority(false);
    s.distance = 6;
    s.motor.lateralOffset = controller.vents[0].z;
    controller.update(2);
    assert.equal(hits.length, 0);
    assert.equal(s.motor.starts, 0);
    assert.equal(s.applyGeyserHit(1001, 2, 0.1, null, true), true);
});

test('五档覆盖所有泳道且保留每排空道，十个喷口的各轮命中编号不碰撞', () => {
    const { controller } = fixture(1, 5);
    assert.equal(controller.vents.length, 10);
    const lanes = new Set(controller.vents.map(v => Math.floor((10.5 - v.z) / 2.625)));
    assert.equal(lanes.size, 8);
    assert.ok(controller.vents.every(v => Math.abs(v.z) <= 9.3 && v.x >= 5 && v.x <= 45));
    for (let row = 0; row < 3; row++) {
        const vents = controller.vents.slice(row * 4, row * 4 + 4);
        const zs = vents.map(v => v.z).sort((a, b) => a - b);
        assert.ok(zs.every((z, i) => i === 0 || z - zs[i - 1] > rules.GEYSER_TUNING.edgeRadius * 2));
    }
    const ids = new Set();
    for (let pulse = 0; pulse < 3; pulse++) for (let vent = 0; vent < 10; vent++) for (let lane = 0; lane < 8; lane++) {
        const id = rules.geyserHitId(7, pulse, vent, lane);
        assert.equal(Math.floor(id / 1000), 7);
        assert.equal(ids.has(id), false);
        ids.add(id);
    }
});

test('漏收核心命中可由快照接入剩余腾空，重复恢复不重启、不后退年龄', () => {
    const host = fixture().s, guest = fixture().s;
    host.applyGeyserHit(1001, 2);
    host._forcedLaunchAge = 0.3;
    const state = host.snapshotGeyserLane(1, 0);
    guest.restoreGeyserLane(1, state, 0.2);
    assert.equal(guest.motor.starts, 1);
    assert.equal(guest._forcedLaunchAge, 0.5);
    guest._forcedLaunchAge = 0.7;
    guest.restoreGeyserLane(1, state, 0.2);
    assert.equal(guest.motor.starts, 1);
    assert.equal(guest._forcedLaunchAge, 0.7);
    assert.equal(guest.applyGeyserHit(1001, 2, 0, state.start, true), false);
});

test('已落水 owner 拒绝旧活动快照，结束快照清掉残余飞行但不回拨水平位置', () => {
    const host = fixture().s, guest = fixture().s;
    host.applyGeyserHit(1001, 2);
    const active = host.snapshotGeyserLane(1, 0);
    guest.restoreGeyserLane(1, active, 0.2);
    host.clearForcedLaunch();
    host._forcedLaunchGrace = 0.6;
    guest.distance = 12;
    guest.restoreGeyserLane(1, host.snapshotGeyserLane(1, 0), 0.1);
    assert.equal(guest._forcedLaunch, null);
    assert.equal(guest.distance, 12);
    assert.equal(guest._forcedLaunchGrace, 0.5);
    guest.restoreGeyserLane(1, active, 0.3);
    assert.equal(guest._forcedLaunch, null);
    assert.equal(guest.motor.starts, 1);
});

test('长断流快照只补账本和剩余保护，旧结束快照不截断后来另一口命中', () => {
    const host = fixture().s, guest = fixture().s;
    host.applyGeyserHit(1001, 2);
    const active = host.snapshotGeyserLane(1, 0);
    guest.restoreGeyserLane(1, active, 1.2);
    assert.equal(guest.motor.starts, 0);
    assert.ok(Math.abs(guest._forcedLaunchGrace - 0.6) < 1e-8);
    assert.equal(guest.applyGeyserHit(1001, 2), false);
    guest._forcedLaunchGrace = 0;
    assert.equal(guest.applyGeyserHit(1009, 2), true);
    host.clearForcedLaunch();
    guest.restoreGeyserLane(1, host.snapshotGeyserLane(1, 0), 0);
    assert.ok(guest._forcedLaunch);
    assert.equal(guest._forcedLaunchHitId, 1009);
});

test('八泳道三轮账本压缩恢复，保留边缘升级与乱序去重', () => {
    for (let lane = 0; lane < 8; lane++) {
        const a = new rules.GeyserHitLedger(), b = new rules.GeyserHitLedger();
        for (let p = 0; p < 3; p++) for (let v = 0; v < 10; v++)
            a.record(rules.geyserHitId(4, p, v, lane), v % 2 ? 1 : 2);
        const state = a.snapshot(4, lane);
        b.merge(4, lane, state.edges, state.cores);
        for (let p = 0; p < 3; p++) for (let v = 0; v < 10; v++) {
            const id = rules.geyserHitId(4, p, v, lane);
            assert.equal(b.accepts(id, 1), false);
            assert.equal(b.accepts(id, 2), !!(v % 2));
        }
    }
});

test('接管恢复停排时刻不补历史命中，后续轮次保持取消', () => {
    const { controller, hits, s } = fixture();
    controller.setAuthority(false);
    s.distance = 6;
    s.motor.lateralOffset = controller.vents[0].z;
    controller.restoreWorld({ ...controller.snapshotWorld(), age: 2, stoppedAt: 0.5 }, 1);
    assert.equal(hits.length, 0);
    assert.equal(controller.snapshotWorld().stoppedAt, 0.5);
    controller.setAuthority(true);
    controller.update(4);
    assert.equal(hits.length, 0);
    assert.ok(controller.elapsedSeconds >= 6);
});

test('权威进入下一口腾空时替换落后阶段，未知的新本地命中不被旧快照替换', () => {
    const host = fixture().s, guest = fixture().s;
    host.applyGeyserHit(1001, 2);
    guest.restoreGeyserLane(1, host.snapshotGeyserLane(1, 0), 0);
    const old = host.snapshotGeyserLane(1, 0);
    host.clearForcedLaunch();
    host.applyGeyserHit(1009, 2);
    host._forcedLaunchAge = 0.2;
    guest.restoreGeyserLane(1, host.snapshotGeyserLane(1, 0), 0.1);
    assert.equal(guest._forcedLaunchHitId, 1009);
    assert.ok(Math.abs(guest._forcedLaunchAge - 0.3) < 1e-8);
    assert.equal(guest.motor.starts, 2);
    guest.restoreGeyserLane(1, old, 0);
    assert.equal(guest._forcedLaunchHitId, 1009);
    assert.equal(guest.motor.starts, 2);
});
