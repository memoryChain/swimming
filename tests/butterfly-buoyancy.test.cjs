const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRig, load, root, Vec3, Quat, SWIMMER_MODEL_FILES } = require('./helpers/character-contact-harness.cjs');
const { shoulderVolumeSampler, elbowStrainSampler } = require('./helpers/skinned-arm-strain.cjs');
const { ButterflyStroke } = load(path.join(root, 'assets/scripts/swimmer/ButterflyStroke.ts'));
const { SwimmerMotor } = load(path.join(root, 'assets/scripts/swimmer/SwimmerMotor.ts'));
const { StrokeType } = load(path.join(root, 'assets/scripts/core/GameConstants.ts'));
const { BUTTERFLY_TUNING } = load(path.join(root, 'assets/scripts/core/ButterflyTuning.ts'));
const state = b => [b.buoyancy.offsetY,b.buoyancy.chestPitch,b.buoyancy.hipPitch,b.buoyancy.waveScale];

function advanceTo(b, p, fps=120) {
    while(b.active && b.progress < p - 1e-9) b.advance(Math.min(1/fps,(p-b.progress)*b.duration));
}
function sample(release, at, fps=120, kick=false) {
    const b=new ButterflyStroke();b.start();
    advanceTo(b,release,fps);b.release();
    if(kick) b.buoyancy.kick();
    advanceTo(b,at,fps);return b;
}

test('按住越久逐渐压低，松手不瞬移；未来松手不会改变已经播放的姿态',()=>{
    const early=new ButterflyStroke(),late=new ButterflyStroke();early.start();late.start();
    advanceTo(early,.22);advanceTo(late,.22);assert.deepEqual(state(early),state(late));
    const before=state(early);early.release();assert.deepEqual(state(early),before);
    advanceTo(early,.5);advanceTo(late,.5);
    assert.ok(early.buoyancy.offsetY-late.buoyancy.offsetY>.08,'同相位的浅压与深压应有可见差异');
    assert.ok(late.buoyancy.offsetY<-.1,'持续按住要实际压低身体');
    const natural=sample(.39,.7),deep=sample(.56,.7);
    assert.ok(natural.buoyancy.offsetY>deep.buoyancy.offsetY+.025,'准确松手回浮充分，晚松手回浮较沉');
});

test('回臂踢腿有平滑且有上限的回浮辅助，超时不持续下潜，拍尾和重开无残留',()=>{
    const b=sample(.4,.5),base=sample(.4,.5),before=state(b);
    for(let i=0;i<100;i++)b.buoyancy.kick();assert.deepEqual(state(b),before);
    advanceTo(b,.7);advanceTo(base,.7);
    assert.ok(b.buoyancy.offsetY>base.buoyancy.offsetY+.005);
    assert.ok(b.buoyancy.offsetY-base.buoyancy.offsetY<=BUTTERFLY_TUNING.kickLiftMeters);
    advanceTo(b,1);assert.deepEqual(state(b),[0,0,0,1]);
    b.start();assert.deepEqual(state(b),[0,0,0,1]);
    advanceTo(b,.75);assert.ok(b.timedOut);assert.ok(b.buoyancy.offsetY>=-BUTTERFLY_TUNING.holdDepthMeters);
    b.reset();assert.deepEqual(state(b),[0,0,0,1]);assert.equal(b.active,false);
});

test('不同帧率与大步长保持浮潜响应，参数按拍快照',()=>{
    for(const release of [.22,.39,.56,.65])for(const at of [.7,.85]) {
        const reference=sample(release,at,120,true);
        for(const fps of [15,30,60]) {
            const b=sample(release,at,fps,true);
            assert.ok(Math.abs(b.buoyancy.offsetY-reference.buoyancy.offsetY)<.004,`${release} ${fps}FPS`);
        }
    }
    const b=new ButterflyStroke();b.start();b.advance(10);assert.deepEqual(state(b),[0,0,0,1]);
    const old=BUTTERFLY_TUNING.holdDepthMeters;
    try {
        const first=new ButterflyStroke(),same=new ButterflyStroke();first.start();same.start();
        BUTTERFLY_TUNING.holdDepthMeters=0;advanceTo(first,.5);advanceTo(same,.5);
        assert.deepEqual(state(first),state(same));
        const next=new ButterflyStroke();next.start();advanceTo(next,.5);
        assert.ok(next.buoyancy.offsetY>first.buoyancy.offsetY+.1);
    } finally {BUTTERFLY_TUNING.holdDepthMeters=old;}
});

test('真实输入后的踢腿接入回浮，浮潜参数不改变比赛推进、判定和航向',()=>{
    const first=new SwimmerMotor(),same=new SwimmerMotor();
    first.enableButterflyTest(true);same.enableButterflyTest(true);first.startRace();same.startRace();
    first.beginButterfly();
    const old=[BUTTERFLY_TUNING.holdDepthMeters,BUTTERFLY_TUNING.releaseLiftMeters,BUTTERFLY_TUNING.kickLiftMeters];
    try {
        BUTTERFLY_TUNING.holdDepthMeters=BUTTERFLY_TUNING.releaseLiftMeters=BUTTERFLY_TUNING.kickLiftMeters=0;
        same.beginButterfly();
    } finally {[BUTTERFLY_TUNING.holdDepthMeters,BUTTERFLY_TUNING.releaseLiftMeters,BUTTERFLY_TUNING.kickLiftMeters]=old;}
    for(let i=0;i<60;i++) {
        if(i===24){first.releaseButterfly();same.releaseButterfly();}
        if(i===30){first.recordKickTap(StrokeType.LEFT);same.recordKickTap(StrokeType.LEFT);}
        first.update(1/60,{isAI:false});same.update(1/60,{isAI:false});
        assert.equal(first.currentSpeed,same.currentSpeed);assert.equal(first.heading,same.heading);
        assert.equal(first.distance,same.distance);
    }
    assert.deepEqual(first.consumeStrokeQualityResults(),same.consumeStrokeQualityResults());
    assert.ok(first.butterflyKickCycle>0);
});

test('11角色深浅、完美和超时整圈姿态连续，身体有分节变化且不移动赛程根节点',()=>{
    for(const file of SWIMMER_MODEL_FILES) for(const release of [.22,.4,.56,2]) {
        const r=createRig(file);r.wrapper.setRotationFromEuler(90,90,0);r.wrapper.setPosition(7,0,3);
        const inspectSkin=['CartonSwimmer5.glb','CartonSwimmer13.glb','CartonSwimmer14.glb','MuscleMan.glb'].includes(file);
        const shoulder=inspectSkin?shoulderVolumeSampler(r):null,elbow=inspectSkin?elbowStrainSampler(r,file):null;
        const b=new ButterflyStroke();b.start();let previous=null,oldY=null;
        for(let i=0;i<=120;i++) {
            if(b.held&&b.progress>=release-1e-9)b.release();
            r.pose.applyButterflyPose(b.progress,1,0,b.buoyancy);
            if(shoulder&&b.progress>=.52&&b.progress<=.85)assert.ok(shoulder.sample().percentile05>.55,`${file}：深浅变化不能重新拧细肩部`);
            if(elbow)elbow.sample();
            const rotations=r.pose._manualBones.map(n=>n.rotation.clone());
            const y=r.pose.root.getWorldPosition(new Vec3()).y;
            if(oldY!==null)assert.ok(Math.abs(y-oldY)<.025,`${file}：身体高度不能突然跳变`);
            for(let j=0;j<rotations.length;j++) {
                const q=rotations[j];assert.ok([q.x,q.y,q.z,q.w].every(Number.isFinite));
                if(previous)assert.ok(Math.abs(Quat.dot(q,previous[j]))>Math.cos(25*Math.PI/360));
            }
            assert.equal(r.wrapper.position.x,7);assert.equal(r.wrapper.position.y,0);assert.equal(r.wrapper.position.z,3);
            previous=rotations;oldY=y;b.advance(b.duration/120);
        }
        assert.deepEqual(state(b),[0,0,0,1]);
        if(elbow)assert.ok(elbow.percentile95()<1.6,`${file}：浮潜变化不能拉坏肘部`);
    }
});
