const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRig, Quat, load, root, SWIMMER_MODEL_FILES } = require('./helpers/character-contact-harness.cjs');
const { BUTTERFLY_TUNING: tuning } = load(path.join(root, 'assets/scripts/core/ButterflyTuning.ts'));
const angle = (a,b) => 2*Math.acos(Math.min(1,Math.abs(Quat.dot(a,b))/Math.sqrt(Quat.dot(a,a)*Quat.dot(b,b))))*180/Math.PI;

for(const file of SWIMMER_MODEL_FILES) test(`${file}：细节不改变胸髋起伏、肩肘方向或赛程，腕部增量有界且首尾闭合`,()=>{
    const a=createRig(file),b=createRig(file),saved=tuning.finishDetail;
    a.wrapper.setRotationFromEuler(90,90,0);b.wrapper.setRotationFromEuler(90,90,0);
    let wristPeak=0,legDifference=0;
    try {
        for(let i=0;i<=120;i++) {
            tuning.finishDetail=0;a.pose.applyButterflyPose(i/120);
            tuning.finishDetail=1;b.pose.applyButterflyPose(i/120);
            assert.deepEqual(a.pose.root.position,b.pose.root.position);
            assert.deepEqual(a.pose.root.rotation,b.pose.root.rotation);
            for(const bone of ['_hips','_spine','_spine1','_torso','_neck','_head','_leftShoulder','_rightShoulder','_leftArm','_rightArm','_leftForeArm','_rightForeArm']) {
                assert.deepEqual(a.pose[bone].rotation,b.pose[bone].rotation,`${bone}不能被细节扭转`);
            }
            for(const side of ['left','right']) {
                const delta=angle(a.pose[`_${side}Hand`].rotation,b.pose[`_${side}Hand`].rotation);
                wristPeak=Math.max(wristPeak,delta);assert.ok(delta<11,`手腕增量 ${delta}`);
                if(i===0||i===120)assert.ok(delta<.001,'前伸端点保持原姿态');
                legDifference=Math.max(legDifference,angle(a.pose[`_${side}Leg`].rotation,b.pose[`_${side}Leg`].rotation));
            }
        }
        assert.ok(wristPeak>6 && legDifference>1,'手腕与腿部精修确实作用到模型');
        b.pose.applyButterflyPose(0);const start=b.pose._manualBones.map(n=>n.rotation.clone());
        b.pose.applyButterflyPose(1);
        b.pose._manualBones.forEach((n,i)=>assert.ok(angle(n.rotation,start[i])<.001,'连拍首尾闭合'));
    } finally {tuning.finishDetail=saved;}
});

test('双手结算只播放一次蝶泳声，资源未就绪回退且静音有效',()=>{
    const {StrokeSfxManager: s}=load(path.join(root,'assets/scripts/app/StrokeSfxManager.ts'));
    const free={},butterfly={},calls=[];
    s._node={isValid:true};s._source={isValid:true,playOneShot:(clip,volume)=>calls.push([clip,volume])};
    s._clips[0]=free;s._butterflyPush=butterfly;s.setVolume(1);
    s.playStroke(false,true);assert.equal(calls.length,1);assert.equal(calls[0][0],butterfly);
    s.playStroke(true,true);assert.equal(calls.length,2);assert.ok(calls[1][1]>calls[0][1]);
    s.playStroke(false);assert.equal(calls.at(-1)[0],free);
    s._butterflyPush=null;s.playStroke(true,true);assert.equal(calls.at(-1)[0],free);
    s.setVolume(0);const before=calls.length;s.playStroke(true,true);assert.equal(calls.length,before);
    s.setVolume(1);
});

test('蝶泳音频保持小包体、无削波且首尾无突变',()=>{
    const wav=fs.readFileSync(path.join(root,'assets/music/sfx/butterfly_push.wav'));
    assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt16LE(22),1);
    assert.equal(wav.readUInt32LE(24),24000);assert.equal(wav.readUInt16LE(34),16);
    assert.ok(wav.length<24000);assert.equal(wav.readInt16LE(44),0);assert.ok(Math.abs(wav.readInt16LE(wav.length-2))<32);
    let peak=0,energy=0;
    for(let i=44;i<wav.length;i+=2){const v=wav.readInt16LE(i);peak=Math.max(peak,Math.abs(v));energy+=v*v;}
    assert.ok(peak>24000&&peak<30000);assert.ok(energy>1e8);
});
