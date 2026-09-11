const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
const { load, Vec3, root } = createHarness();
const { RaceCameraDirector } = load(root + '/assets/scripts/camera/RaceCameraDirector.ts');
const { GameFlowController } = load(root + '/assets/scripts/app/GameFlowController.ts');
const { GameState } = load(root + '/assets/scripts/core/GameConstants.ts');

test('真正触壁后使用池内斜侧近景，双向终点及边缘泳道取景正确', () => {
    for (const direction of [1, -1]) for (const lane of [-10.5, 1.5, 10.5]) {
        const finishX = direction > 0 ? 50 : 0;
        const layout = { waterY: 0, currentCourseEndDistance: () => 200,
            finishDirectionAtDistance: () => direction, distanceToWorldX: () => finishX };
        const lens = {};
        const camera = { setPosition(v) { this.position = Vec3.clone(v); },
            lookAt(v) { this.target = Vec3.clone(v); }, getComponent() { return lens; } };
        const d = new RaceCameraDirector(lane, layout); d.bindCamera(camera);
        const s = { playerX: finishX, playerY: 0.24, playerDistance: 200,
            playerFinished: false, playerUpperBodyWorldPosition: new Vec3(finishX, 0.6, lane) };
        assert.equal(d.shouldUseFinishCloseup(s), false, '距离到线但未收到触壁事件不提前切镜');
        s.playerFinished = true; d.update(1/60, s);
        assert.ok((finishX - camera.position.x) * direction > 3, '机位在终点池内');
        assert.equal(camera.position.y, 1.5);
        assert.ok(Math.abs(camera.position.z) < 12, '边缘泳道向池内侧取景');
        assert.deepEqual(camera.target, s.playerUpperBodyWorldPosition);
        assert.equal(d.topViewActive, false); assert.equal(d.underwaterViewActive, false);
        assert.equal(lens.fov, 46);
    }
});

function flowSetup() {
    const raceManager = {};
    let awards = 0, rewards = 0, state = GameState.FINISHED, resolve;
    const refs = { raceManager, aiControllers: [], aiSwimmers: [], playerSwimmer: null,
        debug() {}, showFinishRank() {}, clearFinishRanks() {},
        getState: () => state, setState: value => { state = value; },
        resolveNetLeaderboard: (_, done) => { resolve = done; },
        awardProgression: () => { rewards++; return null; }, showAwards: () => { awards++; },
        uiFlow: { setSprintActive() {}, showResult() {}, showProgressionResult() {} } };
    const flow = new GameFlowController(refs); flow.bindRaceManagerCallbacks();
    const row = { isPlayer: true, name: '玩家', placement: 1, time: 10, finished: true };
    const finish = () => { raceManager.onSwimmerFinished(row); raceManager.onRaceFinished(true, 10, 12, { placement: 1, racerCount: 1, leaderboard: [row] }); };
    return { flow, finish, resolve: () => resolve([row]), awards: () => awards, rewards: () => rewards };
}

test('最后到达也保留两秒近景，只展示一次领奖，等待网络结果不重复计时', () => {
    const s = flowSetup(); s.finish(); s.resolve();
    assert.equal(s.rewards(), 1, '镜头停留不延迟奖励结算');
    s.flow.updateRaceCamera(1.9); assert.equal(s.awards(), 0);
    s.flow.updateRaceCamera(0.11); assert.equal(s.awards(), 1);
    s.flow.updateRaceCamera(3); assert.equal(s.awards(), 1);
    const late = flowSetup(); late.finish(); late.flow.updateRaceCamera(3); late.resolve();
    assert.equal(late.awards(), 1);
});

test('退出取消待展示结果及尚未返回的网络回调', () => {
    for (const resolved of [true, false]) {
        const s = flowSetup(); s.finish(); if (resolved) s.resolve();
        s.flow.clearRaceManagerCallbacks(); if (!resolved) s.resolve();
        s.flow.updateRaceCamera(3); assert.equal(s.awards(), 0);
    }
});
