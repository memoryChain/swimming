const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../scripts/analyze-stroke-efficiency.cjs');
const { SwimmerMotor } = load('swimmer/SwimmerMotor');
const { ButterflyStroke } = load('swimmer/ButterflyStroke');
const { StrokeType } = load('core/GameConstants');
const { InputRouter } = load('core/InputRouter');
const { Rating } = load('core/GameConstants');
const { HEART_RATE_TUNING } = load('core/ConditionBalance');
const { BUTTERFLY_TUNING } = load('core/ButterflyTuning');

function motor() { const m = new SwimmerMotor(); m.enableButterflyTest(true); m.startRace(); return m; }

function recoveryInput(m, counts) {
    return new InputRouter({}, {
        butterfly: { admission: () => m.butterflyAdmission, interruptionVersion: () => m.butterflyInterruptionVersion,
            preview: enabled => { counts.previews?.push(enabled); m.setButterflyPreview(enabled); },
            begin: () => { counts.attempts++; return m.beginButterfly(); }, release: () => { counts.releases++; m.releaseButterfly(); }, cancel: () => m.cancelButterfly() },
        onKickStroke: side => { counts.kicks++; m.recordKickTap(side, false); },
        onStrokeHeld: (side, held, seconds) => {
            if (held && (m.butterfly.active || m.isButterflyRecoveryLocked)) return false;
            const result = m.setStrokeHeld(side, held, seconds);
            if (result) counts.results.push(result);
            return true;
        },
        onStroke: side => { if (m.recordStroke(side)) counts.arms++; },
    });
}

test('候选显示收束起点，预览无结算，起划连续接入且目标边界在收束后锁定', () => {
    const old = Date.now; let now = 1000; Date.now = () => now;
    try {
        for (const heartRate of [80, 120, 140, 160, 180]) {
            const m = motor(), c = { attempts: 0, releases: 0, kicks: 0, arms: 0, results: [], previews: [] };
            m.applyAuthoritativeHeartRate(heartRate, true);
            const r = recoveryInput(m, c);
            r.handlePadStroke(StrokeType.LEFT); now += 30; r.handlePadStroke(StrokeType.RIGHT);
            const preview = m.strokeTimingGuideForSide(StrokeType.LEFT);
            const zone = preview.intervals.find(i => i.rating === Rating.PERFECT);
            const expectedWidth = .25 * require('../scripts/analyze-stroke-efficiency.cjs').load('core/ConditionBalance').perfectWidthScale(heartRate);
            assert.ok(Math.abs(zone.endRatio - zone.startRatio - expectedWidth) < 1e-9);
            assert.equal(preview.active, false); assert.equal(preview.currentRatio, 0);
            assert.equal(m.butterfly.sequence, 0); assert.equal(m.butterfly.active, false);
            assert.equal(c.kicks + c.arms + c.attempts, 0); assert.equal(m.consumeStrokeQualityResults().length, 0);
            const right = m.strokeTimingGuideForSide(StrokeType.RIGHT);
            assert.deepEqual(right.intervals, preview.intervals);
            const cache = m._butterflyPreview;
            m.strokeTimingGuideForSide(StrokeType.LEFT, preview);
            assert.equal(m._butterflyPreview, cache); assert.deepEqual(c.previews, [true]);
            now += 220; r.tick();
            assert.ok(m.butterfly.active);
            assert.equal(m.butterfly.perfectStart, zone.startRatio);
            assert.equal(m.butterfly.perfectEnd, zone.endRatio);
            assert.deepEqual(c.previews, [true, false]);
            const targetStart = m.butterfly.targetPerfectStart, targetEnd = m.butterfly.targetPerfectEnd;
            m.applyAuthoritativeHeartRate(180, true); m.butterfly.prepareWindow(1, 180, 3);
            assert.equal(m.butterfly.perfectStart, zone.startRatio);
            assert.equal(m.butterfly.perfectEnd, zone.endRatio);
            m.butterfly.advance(m.butterfly.duration * .12);
            assert.equal(m.butterfly.perfectStart, targetStart); assert.equal(m.butterfly.perfectEnd, targetEnd);
            assert.ok(Math.abs(targetEnd - targetStart - expectedWidth * .22 / .25) < 1e-9);
            r.resetStrokeInput(); now += 500;
        }
    } finally { Date.now = old; }
});

test('候选短按、翻转回退和重置撤回蝶泳预览，实际自由泳与正在回臂的提示保留', () => {
    const old = Date.now; let now = 1000; Date.now = () => now;
    try {
        const m = motor(), c = { attempts: 0, releases: 0, kicks: 0, arms: 0, results: [], previews: [] };
        const r = recoveryInput(m, c);
        const freeZone = () => m.strokeTimingGuideForSide(StrokeType.LEFT).intervals.find(i => i.rating === Rating.PERFECT);
        const original = { ...freeZone() };
        r.handlePadStroke(StrokeType.LEFT); r.handlePadStroke(StrokeType.RIGHT);
        now += 50; r.handlePadStrokeEnd(StrokeType.LEFT); r.handlePadStrokeEnd(StrokeType.RIGHT);
        assert.deepEqual(c.previews, [true, false]); assert.deepEqual(freeZone(), original); assert.equal(c.kicks, 2);
        now += 500; r.handlePadStroke(StrokeType.LEFT); r.handlePadStroke(StrokeType.RIGHT);
        m.restoreAxialBalance(Math.PI); r.tick();
        assert.deepEqual(freeZone(), original); assert.deepEqual(c.previews, [true, false, true, false]);
        r.resetStrokeInput(); m.startRace(); now += 500;
        m.beginButterfly(); m.butterfly.advance(.3); m.releaseButterfly();
        r.handlePadStroke(StrokeType.LEFT); r.handlePadStroke(StrokeType.RIGHT);
        const prior = m.strokeTimingGuideForSide(StrokeType.LEFT);
        assert.equal(prior.currentRatio, m.butterfly.progress, '回臂中继续显示上一拍实际进度');
        r.resetStrokeInput(); m.startRace();
        assert.deepEqual(freeZone(), original);
    } finally { Date.now = old; }
});

test('侧翻与仰面双手长按回退真实自由泳，同次按压恢复姿态不重配对', () => {
    const old = Date.now; let now = 1000; Date.now = () => now;
    try {
        for (const angle of [Math.PI / 2, Math.PI, -Math.PI]) {
            const m = motor(), c = { attempts: 0, releases: 0, kicks: 0, arms: 0, results: [] };
            m.restoreAxialBalance(angle);
            const r = recoveryInput(m, c);
            r.handlePadStroke(StrokeType.LEFT); now += 30; r.handlePadStroke(StrokeType.RIGHT);
            now += 250; r.tick(); r.tick();
            assert.equal(c.attempts, 0); assert.equal(c.kicks, 2); assert.equal(c.arms, 2);
            m.restoreAxialBalance(0); now += 300; r.tick();
            assert.equal(m.butterfly.active, false); assert.equal(c.arms, 2);
            m.update(.3, { isAI: false });
            r.handlePadStrokeEnd(StrokeType.LEFT); r.handlePadStrokeEnd(StrokeType.RIGHT);
            assert.equal(c.releases, 0); assert.equal(c.results.length, 2);
            now += 500;
        }
    } finally { Date.now = old; }
});

test('等待回臂可接蝶泳；等待途中翻转回退，松手也不会吞掉长按', () => {
    const old = Date.now; let now = 1000; Date.now = () => now;
    try {
        const m = motor(), c = { attempts: 0, releases: 0, kicks: 0, arms: 0, results: [] };
        m.beginButterfly(); m.butterfly.advance(.3); m.releaseButterfly();
        const r = recoveryInput(m, c);
        r.handlePadStroke(StrokeType.LEFT); r.handlePadStroke(StrokeType.RIGHT);
        now += 250; r.tick(); assert.equal(c.attempts + c.kicks + c.arms, 0);
        m.update(1, { isAI: false }); r.tick();
        assert.equal(c.attempts, 1); assert.equal(c.kicks + c.arms, 0);
        r.resetStrokeInput(); m.startRace();
        m.restoreAxialBalance(Math.PI);
        now += 500; r.handlePadStroke(StrokeType.LEFT); r.handlePadStroke(StrokeType.RIGHT);
        now += 250; r.handlePadStrokeEnd(StrokeType.LEFT); r.handlePadStrokeEnd(StrokeType.RIGHT);
        assert.equal(c.arms, 2); assert.equal(c.kicks, 2);
    } finally { Date.now = old; }
});

test('蝶泳受撞中断后保留按压，恢复锁期间可踢腿且不会假接受划臂', () => {
    const old = Date.now; let now = 1000; Date.now = () => now;
    try {
        const m = motor(), c = { attempts: 0, releases: 0, kicks: 0, arms: 0, results: [] };
        const r = recoveryInput(m, c);
        r.handlePadStroke(StrokeType.LEFT); r.handlePadStroke(StrokeType.RIGHT);
        now += 250; r.tick(); m.update(.15, { isAI: false });
        m.restoreAxialBalance(Math.PI); m.cancelButterfly();
        now += 20; r.tick(); r.tick();
        assert.equal(c.kicks, 2); assert.equal(c.arms, 0);
        assert.equal(m.consumeStrokeQualityResults().length, 0);
        m.update(1, { isAI: false }); now += 1000; r.tick(); r.tick();
        assert.equal(c.arms, 2); assert.equal(c.attempts, 1);
        m.update(.3, { isAI: false });
        r.handlePadStrokeEnd(StrokeType.LEFT); r.handlePadStrokeEnd(StrokeType.RIGHT);
        assert.equal(c.releases, 0); assert.equal(c.results.length, 2);
    } finally { Date.now = old; }
});

test('正常超时结束不当作碰撞中断，双手持续按住不自动重复或赠送自由泳', () => {
    const old = Date.now; let now = 1000; Date.now = () => now;
    try {
        const m = motor(), c = { attempts: 0, releases: 0, kicks: 0, arms: 0, results: [] };
        const r = recoveryInput(m, c);
        r.handlePadStroke(StrokeType.LEFT); r.handlePadStroke(StrokeType.RIGHT);
        now += 250; r.tick(); m.update(2, { isAI: false }); now += 2000; r.tick();
        assert.equal(c.attempts, 1); assert.equal(c.kicks + c.arms, 0);
        assert.equal(m.consumeStrokeQualityResults().length, 1);
        r.handlePadStrokeEnd(StrokeType.LEFT); r.handlePadStrokeEnd(StrokeType.RIGHT);
        assert.equal(m.consumeStrokeQualityResults().length, 0);
    } finally { Date.now = old; }
});

test('实体准入按阶段和翻转回退，恢复锁不被误报为自由泳已接受', () => {
    const { createBody } = require('./helpers/butterfly-race-harness.cjs');
    const { body } = createBody();
    assert.equal(body.butterflyAdmission, 'ready');
    body.motor.restoreAxialBalance(Math.PI);
    assert.equal(body.butterflyAdmission, 'fallback');
    assert.equal(body.canUseArmStroke, true, '仰面仍能使用原自由泳');
    body.motor.restoreAxialBalance(0); body.beginButterfly(); body.cancelButterfly();
    assert.equal(body.canUseArmStroke, false);
    assert.equal(body.butterflyAdmission, 'wait');
    body.motor.update(2, { isAI: false });
    assert.equal(body.canUseArmStroke, true);
    for (const phase of ['isUnderwater', 'isFlipTurnActive', 'isDolphinJumpActive']) {
        const original = body._phases;
        body._phases = { canUseArmStroke: true, [phase]: true };
        assert.equal(body.butterflyAdmission, 'fallback');
        body._phases = original;
    }
});

test('回臂等待中翻转立即退出候选，已结算的蝶泳不因回退重复扣费', () => {
    const old = Date.now; let now = 1000; Date.now = () => now;
    try {
        const m = motor(), c = { attempts: 0, releases: 0, kicks: 0, arms: 0, results: [] };
        m.beginButterfly(); m.butterfly.advance(m.butterfly.duration * .39); m.releaseButterfly();
        const paid = m.consumeStrokeQualityResults();
        assert.equal(paid.length, 1); assert.equal(paid[0].energyCost, 2);
        const r = recoveryInput(m, c);
        r.handlePadStroke(StrokeType.LEFT); r.handlePadStroke(StrokeType.RIGHT);
        now += 220; r.tick(); assert.equal(c.kicks + c.arms, 0);
        m.restoreAxialBalance(Math.PI); m.cancelButterfly(); r.tick();
        assert.equal(c.kicks, 2); assert.equal(c.arms, 0);
        assert.equal(m.consumeStrokeQualityResults().length, 0);
        m.update(1, { isAI: false }); r.tick(); assert.equal(c.arms, 2);
        r.resetStrokeInput();
        assert.equal(r.isStrokePressed(StrokeType.LEFT), false);
        assert.equal(r.isStrokePressed(StrokeType.RIGHT), false);
    } finally { Date.now = old; }
});

test('一手已松开后受撞，剩余手在不同帧率与卡顿帧恢复，不能补发已松开的手', () => {
    const old = Date.now; let now = 1000; Date.now = () => now;
    try {
        for (const dt of [1 / 30, 1 / 60, 1 / 120, .25]) {
            const m = motor(), c = { attempts: 0, releases: 0, kicks: 0, arms: 0, results: [] };
            const r = recoveryInput(m, c);
            r.handlePadStroke(StrokeType.LEFT); r.handlePadStroke(StrokeType.RIGHT);
            now += 250; r.tick(); m.update(m.butterfly.duration * .39, { isAI: false });
            r.handlePadStrokeEnd(StrokeType.LEFT);
            assert.equal(m.consumeStrokeQualityResults().length, 1);
            m.restoreAxialBalance(Math.PI); m.cancelButterfly();
            for (let t = 0; t < 1.5; t += dt) { now += dt * 1000; m.update(dt, { isAI: false }); r.tick(); }
            assert.equal(c.kicks, 1); assert.equal(c.arms, 1);
            assert.equal(c.attempts, 1); assert.equal(c.releases, 1);
            assert.equal(r.isStrokePressed(StrokeType.LEFT), false);
            r.handlePadStrokeEnd(StrokeType.RIGHT); r.tick();
            assert.equal(c.releases, 1);
            now += 500;
        }
    } finally { Date.now = old; }
});

test('蝶泳与自由泳采用相同心率收窄比例，双侧提示和真实松手边界一致', () => {
    const near = (a,b) => assert.ok(Math.abs(a-b)<1e-9, `${a} != ${b}`);
    const base = new ButterflyStroke(); base.start();
    base.advance(base.duration * base.windowTransitionEndProgress);
    const baseWidth = base.perfectEnd-base.perfectStart, center = (base.perfectEnd+base.perfectStart)/2;
    for (const hr of [80,100,110,120,130,140,150,160,170,180]) {
        const free = new SwimmerMotor(); free.startRace(); free.applyAuthoritativeHeartRate(hr,true);
        free.setStrokeHeld(StrokeType.LEFT,true,.2); assert.ok(free.recordStroke(StrokeType.LEFT));
        const freeGuide=free.strokeTimingGuideForSide(StrokeType.LEFT);
        for (const sample of ['before','start','center','end','after']) {
            const m=motor();m.applyAuthoritativeHeartRate(hr,true);assert.ok(m.beginButterfly());
            const b=m.butterfly;
            b.advance(b.duration * b.windowTransitionEndProgress);
            near((b.perfectEnd-b.perfectStart)/baseWidth,freeGuide.perfectWidthScale);
            near((b.perfectEnd+b.perfectStart)/2,center);
            m.applyAuthoritativeHeartRate(hr===80?180:80,true);
            // 确定边界本身也可命中，避免推进步长的末位舍入混入边界检验。
            b.progress=sample==='before'?b.perfectStart-.0001:sample==='after'?b.perfectEnd+.0001
                :sample==='start'?b.perfectStart:sample==='end'?b.perfectEnd:center;
            const cached={active:false,currentRatio:0,holdSeconds:0,actionSeconds:0,minHoldRatio:0,intervals:[]};
            for (const side of [StrokeType.LEFT,StrokeType.RIGHT]) {
                assert.equal(m.strokeTimingGuideForSide(side,cached),cached);
                const interval=cached.intervals.find(i=>i.rating===Rating.PERFECT);
                near(interval.startRatio,b.perfectStart);near(interval.endRatio,b.perfectEnd);
                near(cached.heartRate,hr);near(cached.perfectWidthScale,freeGuide.perfectWidthScale);
            }
            m.releaseButterfly();m.releaseButterfly();
            const results=m.consumeStrokeQualityResults();assert.equal(results.length,1);
            assert.equal(results[0].strokeQuality,sample==='before'||sample==='after'?.5:1);
        }
    }
});

test('蝶泳心率和调参只影响新一拍，重开刷新，超时仍单次失误', () => {
    const m=motor();m.applyAuthoritativeHeartRate(140,true);m.beginButterfly();
    const b=m.butterfly, before=[b.targetPerfectStart,b.targetPerfectEnd,b.heartRate,b.perfectWidthScale,b.windowTransitionEndProgress];
    const oldWidth=HEART_RATE_TUNING.widthAt140,oldStart=BUTTERFLY_TUNING.perfectStart;
    try {
        HEART_RATE_TUNING.widthAt140=.45;BUTTERFLY_TUNING.perfectStart=.3;
        m.applyAuthoritativeHeartRate(180,true);m.update(.1,{isAI:false});
        assert.deepEqual([b.targetPerfectStart,b.targetPerfectEnd,b.heartRate,b.perfectWidthScale,b.windowTransitionEndProgress],before);
        m.update(.05,{isAI:false});
        assert.deepEqual([b.perfectStart,b.perfectEnd],before.slice(0,2));
        m.update(2,{isAI:false});m.releaseButterfly();
        const results=m.consumeStrokeQualityResults();assert.equal(results.length,1);
        assert.equal(results[0].strokeQuality,0);assert.equal(results[0].badReason,'timeout');
        assert.ok(m.beginButterfly());assert.equal(b.heartRate,180);
        assert.ok(b.targetPerfectEnd-b.targetPerfectStart<before[1]-before[0]);
        m.startRace();assert.ok(m.beginButterfly());assert.equal(b.heartRate,80);assert.equal(b.perfectWidthScale,1);
    } finally { HEART_RATE_TUNING.widthAt140=oldWidth;BUTTERFLY_TUNING.perfectStart=oldStart; }
});

test('蝶泳单人居中、8人占满泳道，切换重开不影响普通赛事人数', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const vm = require('node:vm');
    const { centeredLaneStart, aiIndexInLaneRange } = load('competitor/RaceLaneAllocation');
    const source = fs.readFileSync(path.join(__dirname, '../assets/scripts/core/GameManager.ts'), 'utf8');
    const body = source.match(/private assignRaceLanes\(\) \{([\s\S]*?)\n    \}/)?.[1];
    assert.ok(body);
    let configuredAiCount = 7;
    let butterflyOpponentCount = 0;
    let cameraZ;
    const assign = vm.runInNewContext(`(function() {${body}\n})`, {
        centeredLaneStart,
        LANE_LAYOUT: { laneCount: 8, centerZ: lane => lane * 2.5 },
        PRIMARY_AI_LANE_INDEX: 6,
        getFixedSoloAiCount: () => configuredAiCount,
        getAiDebugSetup: () => ({ butterflyOpponentCount }),
        randomInt: count => count - 1,
    });
    const manager = {
        _netSession: null, _butterflyTestMode: true,
        _raceCameraDirector: { setPlayerLaneZ: z => { cameraZ = z; } },
        _cameraTarget: {}, debug() {},
    };
    for (let restart = 0; restart < 2; restart++) {
        assign.call(manager);
        assert.equal(manager._raceLaneCount, 1);
        assert.equal(manager._raceLaneStart, 3);
        assert.equal(manager._playerLaneIndex, 3);
        assert.equal(cameraZ, 7.5);
        assert.equal(manager._cameraTarget.z, cameraZ);
        for (let lane = 0; lane < 8; lane++) {
            assert.equal(aiIndexInLaneRange(lane, 3, 3, 1), -1);
        }
    }
    butterflyOpponentCount = 7;
    for (let restart = 0; restart < 2; restart++) {
        assign.call(manager);
        assert.equal(manager._raceLaneCount, 8);
        assert.equal(manager._raceLaneStart, 0);
        const aiLanes = Array.from({ length: 8 }, (_, lane) => aiIndexInLaneRange(lane, manager._playerLaneIndex, 0, 8));
        assert.equal(aiLanes.filter(index => index >= 0).length, 7);
        assert.equal(aiLanes[manager._playerLaneIndex], -1);
    }
    butterflyOpponentCount = 0;
    assign.call(manager);
    assert.equal(manager._raceLaneCount, 1);
    manager._butterflyTestMode = false;
    for (configuredAiCount of [1, 3, 7, undefined]) {
        assign.call(manager);
        const racers = configuredAiCount === undefined ? 8 : configuredAiCount + 1;
        assert.equal(manager._raceLaneCount, racers);
        assert.equal(manager._raceLaneStart, Math.floor((8 - racers) / 2));
        assert.equal(manager._playerLaneIndex, manager._raceLaneStart + racers - 1);
    }
    for (const invalid of [0, -1, 1.5, 9, NaN]) {
        assert.throws(() => centeredLaneStart(8, invalid), /参赛人数超出泳道容量/);
    }
});

test('蝶泳一次松手只结算一次，整拍结束后才恢复自由泳', () => {
    const m = motor(); let starts = 0; m.onArmStrokeStarted = () => starts++;
    assert.equal(m.beginButterfly(), true);
    const b = m.butterfly;
    for (let i = 0; i < 24; i++) m.update(b.duration * .4 / 24, { isAI: false });
    m.releaseButterfly(); m.releaseButterfly();
    const results = m.consumeStrokeQualityResults();
    assert.equal(results.length, 1); assert.equal(results[0].strokeQuality, 1);
    assert.equal(results[0].type, StrokeType.BOTH); assert.ok(results[0].energyCost > 0);
    assert.equal(starts, 1);
    assert.equal(m.recordStroke(StrokeType.LEFT), false);
    assert.equal(m.recordKickTap(StrokeType.RIGHT), true);
    assert.equal(m.beginButterfly(), false);
    for (let i = 0; i < 80; i++) m.update(1/60, { isAI: false });
    assert.equal(b.active, false); assert.equal(m.consumeStrokeQualityResults().length, 0);
    assert.equal(m.recordStroke(StrokeType.LEFT), true);
});

test('长按超时不自动续拍，大步长跨越周期也只结算一次', () => {
    for (const dt of [1/30, 1/60, .9, 2]) {
        const m = motor(); m.beginButterfly();
        for (let t = 0; t < 4; t += dt) m.update(dt, { isAI: false });
        m.releaseButterfly(); const results = m.consumeStrokeQualityResults();
        assert.equal(results.length, 1); assert.equal(results[0].strokeQuality, 0);
        assert.equal(results[0].badReason, 'timeout'); assert.equal(m.butterfly.sequence, 1);
    }
});

test('普通比赛不启用蝶泳；转身和停止清除动作，重开可重新起划', () => {
    const regular = new SwimmerMotor(); regular.startRace();
    assert.equal(regular.beginButterfly(), false); assert.equal(regular.butterfly, null);
    const m = motor(); m.beginButterfly(); m.beginFlipTurnPhase();
    assert.equal(m.butterfly.active, false);
    m.startRace(); assert.equal(m.beginButterfly(), true); m.stopRace();
    assert.equal(m.butterfly.active, false); m.startRace(); assert.equal(m.beginButterfly(), true);
});

test('不从双臂自由泳中途抢走骨骼，蝶泳单侧输入不能改变航向', () => {
    const m = motor();
    m.setStrokeHeld(StrokeType.LEFT, true, .2); m.recordStroke(StrokeType.LEFT);
    assert.equal(m.beginButterfly(), false);
    m.startRace(); m.beginButterfly(); const heading = m.heading;
    m.setStrokeHeld(StrokeType.RIGHT, true); m.recordStroke(StrokeType.RIGHT); m.setStrokeHeld(StrokeType.RIGHT, false);
    m.update(.3, { isAI: false }); assert.equal(m.heading, heading);
});

test('松手窗口在不同帧率保持同一整拍进度，起划后参数快照稳定', () => {
    for (const steps of [12, 24, 48]) {
        const beat = new ButterflyStroke(); beat.start();
        for (let i = 0; i < steps; i++) beat.advance(beat.duration * .4 / steps);
        assert.equal(beat.release(), true); assert.equal(beat.quality, 1);
    }
});

test('输入配对不产生两次踢腿，先松一手只结算一次，持续按住不自动重开', () => {
    const oldNow = Date.now; let now = 1000; Date.now = () => now;
    try {
        let starts = 0, releases = 0, kicks = 0, strokes = 0, held = 0;
        const router = new InputRouter({}, {
            butterfly: { begin: () => { starts++; return true; }, release: () => releases++, cancel() {} },
            onKickStroke: () => kicks++, onStroke: () => strokes++, onStrokeHeld: () => { held++; return true; },
        });
        router.handlePadStroke(StrokeType.LEFT); now += 45; router.handlePadStroke(StrokeType.RIGHT);
        now += 205; router.tick(); router.tick();
        assert.equal(starts, 1); assert.equal(kicks + strokes + held, 0);
        router.handlePadStrokeEnd(StrokeType.LEFT); now += 2000; router.tick();
        router.handlePadStrokeEnd(StrokeType.RIGHT);
        assert.equal(starts, 1);
        // 回调也必须单次，不依赖下层幂等掩盖重复松手。
        assert.equal(releases, 1);
        now += 100; router.handlePadStroke(StrokeType.LEFT); now += 250; router.tick();
        assert.equal(strokes, 1); assert.equal(kicks, 1);
    } finally { Date.now = oldNow; }
});

test('短双点各踢腿一次但不划臂，取消配对不结算，旧长按加另一只手不误切换', () => {
    const oldNow=Date.now;let now=1000;Date.now=()=>now;
    try {
        let starts=0,releases=0,kicks=0,strokes=0,cancels=0;
        const router=new InputRouter({}, {
            butterfly:{begin:()=>{starts++;return true;},release:()=>releases++,cancel:()=>cancels++},
            onKickStroke:()=>kicks++,onStroke:()=>strokes++,onStrokeHeld:()=>true,
        });
        router.handlePadStroke(StrokeType.LEFT);now+=30;router.handlePadStroke(StrokeType.RIGHT);
        now+=70;router.handlePadStrokeEnd(StrokeType.LEFT);router.handlePadStrokeEnd(StrokeType.RIGHT);
        assert.equal(starts+releases+strokes,0);assert.equal(kicks,2);
        now+=500;router.handlePadStroke(StrokeType.LEFT);router.handlePadStroke(StrokeType.RIGHT);
        now+=250;router.tick();router.resetStrokeInput();
        router.handlePadStrokeEnd(StrokeType.LEFT);router.handlePadStrokeEnd(StrokeType.RIGHT);
        assert.equal(starts,1);assert.equal(releases,0);assert.equal(cancels,1);
        now+=500;router.handlePadStroke(StrokeType.LEFT);now+=300;router.tick();
        router.handlePadStroke(StrokeType.RIGHT);now+=300;router.tick();
        assert.equal(starts,1);assert.equal(strokes,2);
    } finally {Date.now=oldNow;}
});

test('有重叠的连续短按保留每次踢腿，剩余旧按压不能被下一次短按重新配对', () => {
    const oldNow = Date.now; let now = 1000; Date.now = () => now;
    try {
        const kicks = [], confirmed = []; let starts = 0, strokes = 0;
        const router = new InputRouter({}, {
            butterfly: { begin: () => { starts++; return true; }, release() {}, cancel() {} },
            onKickStroke: s => kicks.push(s), onKickConfirmed: s => confirmed.push(s),
            onStroke: () => strokes++, onStrokeHeld: () => true,
        });
        router.handlePadStroke(StrokeType.LEFT);
        now += 25; router.handlePadStroke(StrokeType.RIGHT);
        now += 25; router.handlePadStrokeEnd(StrokeType.LEFT);
        now += 20; router.handlePadStroke(StrokeType.LEFT);
        now += 20; router.handlePadStrokeEnd(StrokeType.RIGHT);
        now += 20; router.handlePadStrokeEnd(StrokeType.LEFT); router.tick();
        assert.deepEqual(kicks, [StrokeType.LEFT, StrokeType.RIGHT, StrokeType.LEFT]);
        assert.deepEqual(confirmed, kicks); assert.equal(starts + strokes, 0);
        now += 500; router.handlePadStroke(StrokeType.LEFT); router.handlePadStroke(StrokeType.RIGHT);
        now += 250; router.tick(); assert.equal(starts, 1, '全部抬起后仍可正常开始蝶泳');
        assert.equal(kicks.length, 3, '长按配对不能夹带额外踢腿');
    } finally { Date.now = oldNow; }
});

test('蝶泳回臂期间的真实短按同时推进双腿，不改变方向、不重复结算划臂', () => {
    const oldNow = Date.now; let now = 1000; Date.now = () => now;
    try {
        const m = motor(), control = motor(); let kicks = 0;
        const router = new InputRouter({}, {
            butterfly: { begin: () => m.beginButterfly(), release: () => m.releaseButterfly(), cancel: () => m.cancelButterfly() },
            onKickStroke: s => { if (m.recordKickTap(s, false)) kicks++; },
            onKickConfirmed: () => m.confirmKickAbility(),
            onStroke: s => m.recordStroke(s), onStrokeHeld: (s,h,t) => { m.setStrokeHeld(s,h,t); return !m.butterfly.active; },
        });
        router.handlePadStroke(StrokeType.LEFT); router.handlePadStroke(StrokeType.RIGHT);
        now += 210; router.tick(); control.beginButterfly();
        const step = dt => { now += dt*1000; m.update(dt,{isAI:false}); control.update(dt,{isAI:false}); router.tick(); };
        for (let i=0;i<20;i++) step(.02);
        router.handlePadStrokeEnd(StrokeType.LEFT); router.handlePadStrokeEnd(StrokeType.RIGHT); control.releaseButterfly();
        assert.equal(m.consumeStrokeQualityResults().length, 1);
        const heading = m.heading, left = m.leftKickCycle, right = m.rightKickCycle;
        for (let i=0;i<3;i++) {
            router.handlePadStroke(StrokeType.LEFT); step(.02);
            router.handlePadStroke(StrokeType.RIGHT); step(.02);
            router.handlePadStrokeEnd(StrokeType.LEFT); step(.02);
            router.handlePadStrokeEnd(StrokeType.RIGHT); step(.02);
        }
        assert.equal(kicks,6); assert.ok(m.butterfly.active);
        assert.ok(m.butterflyKickCycle > 1, '踢腿相位实际推进，不能被蝶泳固定腿周期覆盖');
        assert.ok(m.leftKickCycle > left && m.rightKickCycle > right);
        assert.equal(m.heading,heading); assert.equal(m.butterfly.sequence,1);
        assert.equal(m.consumeStrokeQualityResults().length,0);
        assert.ok(m.currentSpeed > control.currentSpeed, '原踢腿推进仍有效');
        for(let i=0;i<65;i++) step(.02);
        const kickPhase=m.butterflyKickCycle;
        assert.equal(m.beginButterfly(),true); assert.equal(m.butterflyKickCycle,kickPhase,'连续拍保留腿相位，不能突然复位');
        m.cancelButterfly();assert.equal(m.butterflyKickCycle,0);
    } finally { Date.now=oldNow; }
});
