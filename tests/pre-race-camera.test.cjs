// 执行实际相机导演，验证开场轨迹、成员覆盖、倒计时衔接与跳过行为。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
const { load, Vec3, root } = createHarness();
const { RaceCameraDirector } = load(path.join(root, 'assets/scripts/camera/RaceCameraDirector.ts'));

function setup(direction = 1, lane = 0) {
    const layout = {
        direction, waterY: 0, poolStartX: 0, poolFinishX: direction * 50,
        platformX: -direction, poolWidth: 24, laneWidth: 3, laneCount: 8,
        directionAtDistance: () => direction,
        platformStandingPosition: z => new Vec3(-direction, 0.7, z),
    };
    const lens = {};
    const camera = {
        setPosition(v) { this.position = Vec3.clone(v); },
        lookAt(v) { this.target = Vec3.clone(v); },
        getComponent() { return lens; },
    };
    const director = new RaceCameraDirector(lane, layout);
    director.bindCamera(camera);
    const snapshot = {
        playerX: -direction, playerY: 0.7, playerDistance: 0,
        playerUnderwater: false, closestAiDistanceGap: 0, playerPlacement: 1,
        racerCount: 8, raceActive: false, countdownActive: false, sprintActive: false,
    };
    return { director, camera, lens, snapshot };
}

for (const direction of [1, -1]) {
    test(`方向 ${direction}：高位全场、顺序覆盖八泳道、贴水侧视且全程连续`, () => {
        const { director } = setup(direction);
        const opening = director.preRaceOpeningShot(0);
        assert.ok(opening.position.y >= 7);
        assert.equal(opening.target.z, 0);
        assert.ok(opening.position.x * direction > 10);
        let previous = opening;
        for (let t = 0.005; t <= 9.49; t += 0.005) {
            const shot = director.preRaceOpeningShot(t);
            assert.ok(Vec3.distance(previous.position, shot.position) < 0.15, '机位没有瞬移');
            assert.ok(Vec3.distance(previous.target, shot.target) < 0.15, '取景中心没有跳变');
            assert.ok(shot.position.y >= 0.39, '全程保持水上');
            previous = shot;
        }
        const covered = new Set();
        let previousZ = -Infinity;
        for (let t = 3.1; t <= 7.3; t += 0.005) {
            const shot = director.preRaceOpeningShot(t);
            assert.ok(shot.target.z >= previousZ, '沿泳道编号单向扫过');
            previousZ = shot.target.z;
            for (let lane = 0; lane < 8; lane++) {
                if (Math.abs(shot.target.z - (-10.5 + lane * 3)) < 0.05) covered.add(lane);
            }
        }
        assert.equal(covered.size, 8);
        const water = director.preRaceOpeningShot(8.7);
        assert.ok(water.position.y > 1 && water.position.y < 3, '保留低位侧视并抬高水面可见范围');
        assert.ok(water.target.x * direction > 0, '看向池内');
        assert.ok(water.target.y < water.position.y - 1, '视线向下露出更多水面');
        assert.ok(water.position.z > 12 && Math.abs(water.target.z) < 0.001);
        assert.deepEqual(director.preRaceOpeningShot(9.4), water, '贴水机位停留可见');
    });
}

test('完成信号一次触发，接回玩家蓄力；跳过开场可直接倒计时', () => {
    for (const lane of [-10.5, 1.5, 10.5]) {
        const { director, camera, snapshot, lens } = setup(1, lane);
        director.startPreRacePresentation();
        assert.ok(camera.position.y >= 7, '开场首帧立即进入全景');
        director.update(9.49, snapshot);
        assert.equal(director.preRacePhase, 'roster');
        assert.equal(director.consumePreCountdownReady(), false);
        director.update(0.02, snapshot);
        assert.equal(director.preRacePhase, 'athlete');
        assert.equal(camera.target.z, lane);
        director.update(1.61, snapshot);
        assert.equal(director.consumePreCountdownReady(), true);
        assert.equal(director.consumePreCountdownReady(), false);
        const ready = JSON.stringify([camera.position, camera.target, lens.fov]);
        director.update(5, snapshot);
        assert.equal(director.consumePreCountdownReady(), false, '等待同步发令不重复完成');
        director.resetCountdownTimers();
        snapshot.countdownActive = true;
        director.update(1 / 60, snapshot);
        assert.equal(JSON.stringify([camera.position, camera.target, lens.fov]), ready);
        director.startPreRacePresentation();
        assert.equal(director.skipPreRacePresentation(), true);
        director.update(1 / 60, snapshot);
        assert.equal(JSON.stringify([camera.position, camera.target, lens.fov]), ready);
    }
});
