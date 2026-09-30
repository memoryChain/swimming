// 轻量换气的准入、节奏、退出与真实角色骨架隔离。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRig, Node, Quat, Vec3, load, root, SWIMMER_MODEL_FILES } = require('./helpers/character-contact-harness.cjs');
const { FreestyleBreathingMotion, permitsFreestyleBreathing, interruptsFreestyleBreathing } = load(path.join(root, 'assets/scripts/character/FreestyleBreathingMotion.ts'));
const { replayBreathingInput } = require('./helpers/freestyle-breathing-replay.cjs');
const { shoulderVolumeSampler, elbowStrainSampler } = require('./helpers/skinned-arm-strain.cjs');
const TAU = Math.PI * 2;

test('水面准入同时检查前后翻转、左右翻转和转速', () => {
    const permits = (roll, pitch, rs = 0, ps = 0) => permitsFreestyleBreathing(
        Math.cos(roll) * Math.cos(pitch), pitch, rs, ps);
    assert.ok(permits(0, 0));
    assert.ok(permits(0.3, 0.2));
    for (const [roll, pitch] of [[Math.PI, 0], [0, Math.PI], [Math.PI, Math.PI], [0, 1], [1.2, 0]]) {
        assert.equal(permits(roll, pitch), false);
    }
    assert.equal(permits(0, 0, 2), false);
    assert.equal(permits(0, 0, 0, -2), false);
    assert.equal(permits(NaN, 0), false);
    assert.equal(interruptsFreestyleBreathing(.6, .3, 1.3, 1.3), false, '普通晃动不打断');
    assert.equal(interruptsFreestyleBreathing(-1, 0, 0, 0), true);
    assert.equal(interruptsFreestyleBreathing(1, Math.PI, 0, 0), true);
    assert.equal(interruptsFreestyleBreathing(1, 0, 4, 0), true);
});

test('开始后普通晃动不中断；明显失控平滑退出且头先恢复', () => {
    const b = new FreestyleBreathingMotion();
    let cycle = 0, weight = 0;
    for (let i = 0; i <= 96; i++) { cycle = i / 60 * TAU; weight = b.update(1/60,cycle,cycle,true,false); }
    assert.ok(weight > .95);
    for (let i = 1; i <= 6; i++) {
        cycle += TAU / 60;
        weight = b.update(1/60,cycle,cycle,false,false);
        assert.ok(weight > .3, '启动条件轻微越界仍有自然收尾');
    }
    const before = weight;
    cycle += TAU / 60;
    weight = b.update(1/60,cycle,cycle,false,true);
    assert.ok(weight > 0 && weight < before, '打断从当前姿态渐退');
    for (let i = 0; i < 12; i++) { cycle += TAU/60; weight = b.update(1/60,cycle,cycle,false,true); }
    assert.equal(weight,0); assert.equal(b.headWeight,0);
});

for (const mode of ['player','ai']) for (const fps of [30,60]) test(`${mode} ${fps} 帧真实输入：换气可读，头在手臂入水前回正，降频不漏动作`, () => {
    const frames = replayBreathingInput({mode,fps,seconds:8});
    for (const stride of mode === 'ai' ? [1,2,3] : [1]) {
        const b = new FreestyleBreathingMotion();
        let elapsed=0, duration=0, visible=0, completed=0, peak=0, entryTurn=0;
        for (let i=0;i<frames.length;i++) {
            const f=frames[i]; elapsed+=f.dt; if(i%stride)continue;
            const projection=Math.cos(f.roll)*Math.cos(f.pitch);
            const start=f.surface && f.speed>.35 && permitsFreestyleBreathing(projection,f.pitch,f.rollSpeed,f.pitchSpeed);
            const interrupted=!f.surface || interruptsFreestyleBreathing(projection,f.pitch,f.rollSpeed,f.pitchSpeed);
            const w=b.update(elapsed,f.right,f.right,start,interrupted);
            if(w>0) {
                if(duration===0)entryTurn=Math.floor(f.right/TAU)+.98;
                duration+=elapsed;peak=Math.max(peak,w);
                if(b.headWeight>.8)visible+=elapsed;
                if(f.right/TAU>=entryTurn)assert.equal(b.headWeight,0,'手臂进入下一拍时头已回正');
            } else if(duration>0) {
                if(peak>.95) {
                    assert.ok(duration>=.30 && duration<=.50, `身体可读时长 ${duration}`);
                    assert.ok(visible>=.09, `头部明显侧转累计 ${visible} 秒，不能只有一帧`);
                    completed++;
                }
                duration=visible=peak=0;
            }
            elapsed=0;
        }
        assert.ok(completed>=1, '正常输入至少出现一次完整换气');
    }
});

test('真实快速松手与延后松手都有完整换气；停止输入后收尾，不重启动作', () => {
    for (const releaseProgress of [.24,.45]) {
        const frames=replayBreathingInput({fps:30,seconds:8,releaseProgress,gap:0});
        const b=new FreestyleBreathingMotion(); let peak=0, prior=0, starts=0;
        for(const f of frames) {
            const projection=Math.cos(f.roll)*Math.cos(f.pitch);
            const w=b.update(f.dt,f.right,f.right,f.surface&&f.speed>.35
                &&permitsFreestyleBreathing(projection,f.pitch,f.rollSpeed,f.pitchSpeed),
                !f.surface||interruptsFreestyleBreathing(projection,f.pitch,f.rollSpeed,f.pitchSpeed));
            if(w>0&&prior===0)starts++;
            peak=Math.max(peak,w);prior=w;
        }
        assert.ok(peak>.95&&starts>=1,`松手进度 ${releaseProgress}：峰值 ${peak}，次数 ${starts}`);
        const cycle=frames.at(-1).right;
        for(let i=0;i<20;i++)b.update(1/30,cycle,cycle,true,false);
        assert.equal(b.headWeight,0);assert.equal(b.update(1/30,cycle,cycle,true,false),0);
    }
});

for (const fps of [30, 60, 120]) test(`${fps} 帧：每两次右回臂换气一次，停划和撞翻后退出`, () => {
    const b = new FreestyleBreathingMotion(), peaks = [0, 0, 0, 0];
    for (let i = 0; i < 4 * fps; i++) {
        const cycle = i / fps * TAU;
        peaks[Math.floor(i / fps)] = Math.max(peaks[Math.floor(i / fps)], b.update(1 / fps, cycle, cycle, true));
    }
    assert.deepEqual(peaks.map(v => v > 0.95), [false, true, false, true]);
    for (let i = 0; i <= fps * 0.3; i++) b.update(1 / fps, 3.72 * TAU, 3.72 * TAU, true);
    assert.equal(b.update(1 / fps, 3.72 * TAU, 3.72 * TAU, true), 0, '停划不能卡住侧头');
    b.reset();
    let weight;
    for (let i = 0; i <= Math.ceil(1.60 * fps); i++) weight = b.update(1 / fps, i / fps * TAU, i / fps * TAU, true);
    assert.ok(weight > 0.95);
    for (let i = 0; i < fps * 0.20; i++) weight = b.update(1 / fps, (1.62 + i / fps) * TAU, (1.62 + i / fps) * TAU, false);
    assert.equal(weight, 0, '失控快速退出');
    assert.equal(b.update(1 / fps, 0, 0, true), 0, '转身后计数回零不遗留动作');
});

test('中途恢复俯泳、仰泳反向相位和特殊动作期间不补做换气', () => {
    const b = new FreestyleBreathingMotion();
    for (let i = 0; i < 240; i++) {
        const cycle = i / 60 * TAU;
        assert.equal(b.update(1 / 60, cycle, -cycle, true), 0);
    }
    b.reset();
    for (let i = 0; i < 120; i++) {
        const phase = i / 60;
        assert.equal(b.update(1 / 60, phase * TAU, phase * TAU, phase > 1.65), 0);
    }
});

test('实际模型入口仅在蝶泳测试分配状态，特殊动作阻止启动，调用后还原正式求解模式', () => {
    const ts = require(process.env.PATH.split(path.delimiter)
        .map(p => path.resolve(p, '../typescript/lib/typescript.js')).find(p => fs.existsSync(p)));
    const file = path.join(root, 'assets/scripts/entity/CartoonSwimmerRig.ts');
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const decl = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'CartoonSwimmerRig');
    const method = decl.members.find(n => n.name?.getText(source) === 'updateFreestyleFromMotor').getText(source);
    const context = { FreestyleBreathingMotion, permitsFreestyleBreathing, interruptsFreestyleBreathing, FREESTYLE_POSE_TUNING: { armForwardCycleOffset: 0 } };
    const code = ts.transpileModule(`class Rig {${method}}; globalThis.Rig = Rig;`,
        { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    vm.runInNewContext(code, context);
    const rig = new context.Rig();
    let presented = -1, mode = -1;
    Object.assign(rig, {
        _breathingTest: null, _loaded: false, _butterflyPoseWeight: 0, _treadWaterWeight: 0,
        _pose: { setMovementHeadingRadians() {}, setMovementPitchRadians() {}, setSurfaceBodyUpProjection() {},
            setBreathingTestWeight(v) { mode = v; } },
        consumeThrottledMotionDt: dt => dt,
        updateVisualArmCycles(l, r) { this._visualLeftArmCycle = l; this._visualRightArmCycle = r; },
        updateFreestyle() { presented = mode; },
    });
    const motor = { butterfly: null, rightArmCycle: 0, leftArmCycle: 0, currentSpeed: 2,
        axialRollAngularVelocity: 0, collisionPitchAngularVelocity: 0 };
    rig.updateFreestyleFromMotor(1 / 60, motor, 1, 0, 0, 1, true);
    assert.equal(rig._breathingTest, null); assert.equal(presented, -1);
    motor.butterfly = { active: false, progress: -1 };
    let peak = 0;
    for (let i = 0; i < 120; i++) {
        motor.rightArmCycle = i / 60 * TAU;
        rig.updateFreestyleFromMotor(1 / 60, motor, 1, 0, 0, 1, true, true);
        peak = Math.max(peak, presented); assert.equal(mode, -1);
    }
    assert.ok(peak > 0.95);
    for (let i = 120; i < 360; i++) {
        motor.rightArmCycle = i / 60 * TAU;
        rig.updateFreestyleFromMotor(1 / 60, motor, 1, 0, 0, 1, false, true);
        if (i >= 132) assert.equal(presented, 0);
    }
    // 八人模式 AI 只启用表现，完全不创建蝶泳玩法状态。
    motor.butterfly = null;
    rig._breathingTest.reset();
    peak = 0;
    for (let i = 0; i < 120; i++) {
        motor.rightArmCycle = i / 60 * TAU;
        rig.updateFreestyleFromMotor(1 / 60, motor, 1, 0, 0, 1, true, true);
        peak = Math.max(peak, presented); assert.equal(mode, -1);
    }
    assert.ok(peak > 0.95, '八人测试的自由泳 AI 也会换气');
    assert.equal(motor.butterfly, null, '换气不开放 AI 蝶泳输入');
});

function sample(rig, phase, weight) {
    rig.pose.setBreathingTestWeight(weight);
    rig.pose.applyFreestylePose((phase - 0.5) * TAU, phase * TAU, 0, Math.PI, 0, 1, 1, 1);
}
function snapshot(rig) {
    return JSON.stringify([rig.pose.root.position, rig.pose.root.rotation, ...rig.pose._manualBones.map(b => b.rotation)]);
}

for (const file of SWIMMER_MODEL_FILES) test(`${file}：双向胸肩带动手臂换气，关节保持且关闭后完整恢复`, () => {
    const r = createRig(file), swimmer = new Node();
    r.wrapper.parent = swimmer; swimmer.children.push(r.wrapper);
    r.wrapper.setRotationFromEuler(90, 90, 0);
    r.pose.setSwimHeadLift(r.variant?.swimHeadLiftDegrees);
    for (const direction of [1, -1]) {
        swimmer.setRotationFromEuler(0, direction > 0 ? 0 : 180, 0);
        r.pose.setMovementDirection(direction);
        sample(r, 0.72, -1); const original = snapshot(r);
        sample(r, 0.72, 0);
        const arms = [r.pose._leftArm, r.pose._leftForeArm, r.pose._leftHand,
            r.pose._rightArm, r.pose._rightForeArm, r.pose._rightHand];
        const armRotations = JSON.stringify(arms.map(b => b.rotation));
        const shoulder = r.pose._rightShoulder.getWorldRotation(new Quat());
        const chest = r.pose._torso.getWorldRotation(new Quat());
        const head = r.pose._head.getWorldRotation(new Quat());
        sample(r, 0.72, 1);
        assert.equal(JSON.stringify(arms.map(b => b.rotation)), armRotations, '肩臂整体跟随，不额外扭曲肘腕局部关节');
        const chestAngle = 2 * Math.acos(Math.min(1, Math.abs(Quat.dot(chest, r.pose._torso.getWorldRotation(new Quat()))))) * 180 / Math.PI;
        const shoulderAngle = 2 * Math.acos(Math.min(1, Math.abs(Quat.dot(shoulder, r.pose._rightShoulder.getWorldRotation(new Quat()))))) * 180 / Math.PI;
        assert.ok(Math.abs(chestAngle - shoulderAngle) < 0.01, '肩膀随整片胸廓侧转');
        assert.ok(chestAngle > 2 && chestAngle < 42, `胸肩补转 ${chestAngle.toFixed(2)}°，已有转体不重复叠加`);
        const turned = r.pose._head.getWorldRotation(new Quat());
        const angle = 2 * Math.acos(Math.min(1, Math.abs(Quat.dot(head, turned)))) * 180 / Math.PI;
        assert.ok(angle > 40 && angle < 65, `头部随胸肩侧转 ${angle.toFixed(2)}°`);
        const peak = snapshot(r);
        for (let repeat = 0; repeat < 20; repeat++) sample(r, 0.72, 1);
        assert.equal(snapshot(r), peak, '连续换气不累积骨盆或胸肩角度');
        sample(r, 0.72, -1); assert.equal(snapshot(r), original, '正式动作逐值恢复');
        sample(r, 0.72, 1);
        r.pose.setBreathingTestWeight(-1);
        r.pose.applyButterflyPose(0.6, 1, 0);
        sample(r, 0.72, -1);
        assert.equal(snapshot(r), original, '换气中切入蝶泳再回自由泳，无扭转残留');
        // 连续复合翻转中撤销权重，检查姿态无残留、无非有限数据。
        for (let i = 0; i <= 120; i++) {
            const pitch = i / 120 * TAU, roll = pitch * 0.7;
            swimmer.setRotationFromEuler(roll * 180 / Math.PI, direction > 0 ? 0 : 180, pitch * 180 / Math.PI);
            r.pose.setSurfaceBodyUpProjection(Math.cos(roll) * Math.cos(pitch));
            r.pose.setMovementPitchRadians(pitch);
            sample(r, 0.72, Math.max(0, 1 - i / 6));
            const p = r.pose._head.getWorldPosition(new Vec3());
            assert.ok(Number.isFinite(p.x + p.y + p.z));
            if (i === 120) {
                const restored = snapshot(r);
                sample(r, 0.72, 0);
                assert.equal(snapshot(r), restored, '复合翻转中取消换气后完全恢复');
            }
        }
        r.pose.setMovementPitchRadians(0); r.pose.setSurfaceBodyUpProjection(1);
    }
});

test('肩膀先侧转，头随后换气并先于胸肩回正；15 帧降频不漏拍', () => {
    for (const fps of [15, 30, 60]) {
        const motion = new FreestyleBreathingMotion();
        let entered = false, returning = false, peak = 0;
        for (let i = 0; i < fps * 2; i++) {
            const phase = i / fps;
            const body = motion.update(1 / fps, phase * TAU, phase * TAU, true);
            peak = Math.max(peak, body);
            if (phase > 1.48 && phase < 1.64 && body > motion.headWeight) entered = true;
            if (phase > 1.8 && phase < 1.94 && body > motion.headWeight) returning = true;
        }
        assert.ok(entered && returning && peak > 0.95, `${fps} 帧动作错峰成立`);
        motion.reset(); assert.equal(motion.headWeight, 0);
    }
});

let meshReplayFrames;
for (const file of SWIMMER_MODEL_FILES) test(`${file}：真实输入整周期肩腋形变受限且肘部不增加拉伸`, () => {
    const r = createRig(file);
    r.wrapper.setRotationFromEuler(90, 90, 0);
    r.pose.setSwimHeadLift(r.variant?.swimHeadLiftDegrees);
    const presentationRoot = new Node();
    r.wrapper.parent = presentationRoot; presentationRoot.children.push(r.wrapper);
    const volume = shoulderVolumeSampler(r);
    const baseStrain = elbowStrainSampler(r, file), breathingStrain = elbowStrainSampler(r, file);
    const motion = new FreestyleBreathingMotion();
    meshReplayFrames ??= replayBreathingInput({mode:'player',fps:30,seconds:8});
    for (let i = 0; i < meshReplayFrames.length; i++) {
        const f=meshReplayFrames[i], projection=Math.cos(f.roll)*Math.cos(f.pitch);
        const eligible=f.surface && f.speed>.35 && permitsFreestyleBreathing(projection,f.pitch,f.rollSpeed,f.pitchSpeed);
        const weight=motion.update(f.dt,f.right,f.right,eligible,!f.surface || interruptsFreestyleBreathing(projection,f.pitch,f.rollSpeed,f.pitchSpeed));
        if(i%3)continue;
        presentationRoot.rotation.set(...f.rotation);
        r.pose.setMovementHeadingRadians(f.heading); r.pose.setMovementPitchRadians(f.pitch);
        r.pose.setSurfaceBodyUpProjection(projection);
        const drive=Math.max(.85,Math.min(1.45,.9+f.speed*.16));
        const present=()=>r.pose.applyFreestylePose(f.left,f.right,f.leftKick,f.rightKick,f.bodyPhase,drive,drive,drive);
        r.pose.setBreathingTestWeight(0); present();
        const base = volume.sample(); baseStrain.sample();
        r.pose.setBreathingTestWeight(weight, motion.headWeight);
        present();
        const changed = volume.sample(); breathingStrain.sample();
        assert.equal(changed.count, base.count);
        // 分段躯干转动允许微小权重形变，体积下降限制在 3 个百分点内。
        assert.ok(changed.percentile05 >= base.percentile05 - 0.03,
            `时间 ${f.time.toFixed(3)} 肩腋体积 ${base.percentile05} → ${changed.percentile05}`);
    }
    assert.ok(breathingStrain.percentile95() <= baseStrain.percentile95() + 0.001, '真实肘部三角形边长未增加拉伸');
});
