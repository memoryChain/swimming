// 使用真实角色骨架与 Creator 数学库验证仰泳抬头方向，不启动编辑器。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRig, Node, Vec3, load, root } = require('./helpers/character-contact-harness.cjs');
const { MOTION_TUNING } = load(path.join(root, 'assets/scripts/core/InputTuning.ts'));
const saved = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/tuning.json'), 'utf8')).values;
MOTION_TUNING.swimBodyPitchDegrees = saved['motion.swimBodyPitchDegrees'];

for (const file of fs.readdirSync(path.join(root, 'assets/race/models')).filter(f => f.endsWith('.glb'))) {
    test(`${file}：仰泳头部抬升、俯泳不变、翻身连续`, () => {
        const r = createRig(file);
        const swimmer = new Node();
        swimmer.position.set(0, 0.24, 0);
        r.wrapper.parent = swimmer;
        swimmer.children.push(r.wrapper);
        r.wrapper.position.set(0, 0.18 + (r.variant?.raceModelYOffset || 0) + saved['motion.swimBodyYOffset'], 0);
        r.wrapper.setRotationFromEuler(90, 90, 0);
        r.pose.setSwimHeadLift(r.variant?.swimHeadLiftDegrees);
        const head = () => r.pose._head.getWorldPosition(new Vec3());
        const hip = () => r.pose._rootBone.getWorldPosition(new Vec3());
        const pose = phase => r.pose.applyFreestylePose(phase, phase + Math.PI, phase * 2, phase * 2 + Math.PI, phase, 1, 1, 1);

        for (const direction of [0, 180]) {
            swimmer.setRotationFromEuler(180, direction, 0);
            for (let sample = 0; sample < 24; sample++) {
                const phase = sample * Math.PI / 12;
                r.pose.setSurfaceBodyUpProjection(1);
                pose(phase);
                const oldY = head().y;
                r.pose.setSurfaceBodyUpProjection(-1);
                pose(phase);
                assert.ok(head().y > oldY + 0.18, '仰泳头部至少抬回 18 厘米');
                assert.ok(head().y > hip().y + 0.04, '整个动作周期头部不再低于髋部');
            }
        }

        swimmer.setRotationFromEuler(0, 0, 0);
        r.pose.setSurfaceBodyUpProjection(1);
        pose(0.7);
        const prone = head();
        for (const projection of [0.8, 0.5, 0, 1]) {
            r.pose.setSurfaceBodyUpProjection(projection);
            pose(0.7);
            assert.deepEqual(head(), prone, '俯面半周保留原有基础动作');
        }
        let previous;
        for (let roll = 0; roll <= 720; roll += 2) {
            swimmer.setRotationFromEuler(roll, 0, 0);
            r.pose.setSurfaceBodyUpProjection(Math.cos(roll * Math.PI / 180));
            pose(0.7);
            const current = head();
            assert.ok(Number.isFinite(current.x + current.y + current.z));
            if (previous) assert.ok(Vec3.distance(previous, current) < 0.04, '连续翻滚无抬头跳变');
            previous = current;
        }
        swimmer.setRotationFromEuler(0, 0, 0);
        r.pose.setSurfaceBodyUpProjection(1);
        pose(0.7);
        assert.deepEqual(head(), prone, '复位后没有残留补偿');
    });
}
