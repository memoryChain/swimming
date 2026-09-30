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

test('蝶泳与自由泳采用相同心率收窄比例，双侧提示和真实松手边界一致', () => {
    const near = (a,b) => assert.ok(Math.abs(a-b)<1e-9, `${a} != ${b}`);
    const base = new ButterflyStroke(); base.start();
    const baseWidth = base.perfectEnd-base.perfectStart, center = (base.perfectEnd+base.perfectStart)/2;
    for (const hr of [80,100,110,120,130,140,150,160,170,180]) {
        const free = new SwimmerMotor(); free.startRace(); free.applyAuthoritativeHeartRate(hr,true);
        free.setStrokeHeld(StrokeType.LEFT,true,.2); assert.ok(free.recordStroke(StrokeType.LEFT));
        const freeGuide=free.strokeTimingGuideForSide(StrokeType.LEFT);
        for (const sample of ['before','start','center','end','after']) {
            const m=motor();m.applyAuthoritativeHeartRate(hr,true);assert.ok(m.beginButterfly());
            const b=m.butterfly;
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
    const b=m.butterfly, before=[b.perfectStart,b.perfectEnd,b.heartRate,b.perfectWidthScale];
    const oldWidth=HEART_RATE_TUNING.widthAt140,oldStart=BUTTERFLY_TUNING.perfectStart;
    try {
        HEART_RATE_TUNING.widthAt140=.45;BUTTERFLY_TUNING.perfectStart=.3;
        m.applyAuthoritativeHeartRate(180,true);m.update(.1,{isAI:false});
        assert.deepEqual([b.perfectStart,b.perfectEnd,b.heartRate,b.perfectWidthScale],before);
        m.update(2,{isAI:false});m.releaseButterfly();
        const results=m.consumeStrokeQualityResults();assert.equal(results.length,1);
        assert.equal(results[0].strokeQuality,0);assert.equal(results[0].badReason,'timeout');
        assert.ok(m.beginButterfly());assert.equal(b.heartRate,180);
        assert.ok(b.perfectEnd-b.perfectStart<before[1]-before[0]);
        m.startRace();assert.ok(m.beginButterfly());assert.equal(b.heartRate,80);assert.equal(b.perfectWidthScale,1);
    } finally { HEART_RATE_TUNING.widthAt140=oldWidth;BUTTERFLY_TUNING.perfectStart=oldStart; }
});

test('蝶泳测试启动及重开分配单人居中泳道，普通赛事仍按原人数分配', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const vm = require('node:vm');
    const { centeredLaneStart, aiIndexInLaneRange } = load('competitor/RaceLaneAllocation');
    const source = fs.readFileSync(path.join(__dirname, '../assets/scripts/core/GameManager.ts'), 'utf8');
    const body = source.match(/private assignRaceLanes\(\) \{([\s\S]*?)\n    \}/)?.[1];
    assert.ok(body);
    let configuredAiCount = 7;
    let cameraZ;
    const assign = vm.runInNewContext(`(function() {${body}\n})`, {
        centeredLaneStart,
        LANE_LAYOUT: { laneCount: 8, centerZ: lane => lane * 2.5 },
        PRIMARY_AI_LANE_INDEX: 6,
        getFixedSoloAiCount: () => configuredAiCount,
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
