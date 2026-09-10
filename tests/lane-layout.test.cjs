// 验证泳道方向同时贯穿站位、联机成员映射与缩道的提示、遮罩和碰撞边界。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
const { load, root } = createHarness();
const { LaneLayout, laneNumberForZ } = load(path.join(root, 'assets/scripts/venue/LaneLayout.ts'));
const { buildNetLanePlan } = load(path.join(root, 'assets/scripts/net/NetLanePlan.ts'));
const { LaneLockdownVisuals } = load(path.join(root, 'assets/scripts/venue/LaneLockdownVisuals.ts'));
const { LaneLockdownRaceController } = load(path.join(root, 'assets/scripts/core/LaneLockdownRaceController.ts'));
const { GameState } = load(path.join(root, 'assets/scripts/core/GameConstants.ts'));
const layout = new LaneLayout(8, 2.625);

test('起跳近侧 +Z 是 1 道，远侧 -Z 是 8 道，横移后的编号与池边截断一致', () => {
    assert.equal(layout.centerZ(0), 9.1875);
    assert.equal(layout.centerZ(7), -9.1875);
    for (let index = 0; index < 8; index++) {
        for (const offset of [-1.3, 0, 1.3]) {
            assert.equal(laneNumberForZ(layout.centerZ(index) + offset, layout), index + 1);
        }
    }
    assert.equal(laneNumberForZ(0.01, layout), 4);
    assert.equal(laneNumberForZ(-0.01, layout), 5);
    assert.equal(laneNumberForZ(100, layout), 1);
    assert.equal(laneNumberForZ(-100, layout), 8);
});

test('不同客户端和成员到达顺序仍把同一座位放在同一条泳道', () => {
    const positions = [7, 0, 4];
    for (const localPos of positions) {
        for (const order of [positions, [...positions].reverse()]) {
            const plan = buildNetLanePlan({ localPos, members: order.map(pos => ({ pos })) }, 8);
            const lanes = new Map(plan.remotes.map(remote => [remote.pos, remote.lane]));
            lanes.set(localPos, plan.playerLane);
            assert.equal(plan.humanCount, 3);
            assert.equal(layout.centerZ(lanes.get(0)), 9.1875);
            assert.equal(layout.centerZ(lanes.get(4)), 6.5625);
            assert.equal(layout.centerZ(lanes.get(7)), 3.9375);
        }
    }
});

for (const leaderLane of [1, 8]) {
    test(`领跑者在 ${leaderLane} 道：三次缩道的显示、AI 和淘汰边界一致`, () => {
        let warning, mask, status, aiTarget;
        const visuals = new LaneLockdownVisuals({
            setLaneLockdownWarning: (min, max) => { warning = [min, max]; },
            setLaneLockdownMask: (min, max) => { mask = [min, max]; },
            clearLaneLockdownMask() {},
        }, layout);
        const racers = Array.from({ length: 8 }, (_, index) => {
            const z = layout.centerZ(index);
            return {
                lane: index + 1, distance: 0, node: { active: true, position: { z } },
                swimBoundaryZRange: () => ({ min: z - 0.3, max: z + 0.3 }),
                setLaneLockdownBounds(min, max) { this.bounds = [min, max]; },
            };
        });
        const controller = new LaneLockdownRaceController(layout, visuals,
            swimmer => { swimmer.node.active = false; },
            value => { status = value; }, value => { aiTarget = value; });
        controller.reset();
        for (let stage = 0; stage < 3; stage++) {
            racers[leaderLane - 1].distance = (stage + 1) * 50;
            const first = leaderLane === 1 ? 1 : 3 + stage * 2;
            const last = leaderLane === 1 ? 6 - stage * 2 : 8;
            const bounds = leaderLane === 1 ? [-5.25 + stage * 5.25, 10.5] : [-10.5, 5.25 - stage * 5.25];
            controller.update(0.01, GameState.RACING, racers.filter(racer => racer.node.active));
            assert.deepEqual([status.firstSafeLane, status.lastSafeLane], [first, last]);
            assert.deepEqual(warning, bounds);
            assert.deepEqual([aiTarget.safeMinZ, aiTarget.safeMaxZ], bounds);
            assert.equal(aiTarget.warning, true);
            controller.update(3, GameState.RACING, racers.filter(racer => racer.node.active));
            assert.deepEqual(mask, bounds);
            assert.equal(status.locked, true);
            for (const racer of racers) {
                assert.equal(racer.node.active, racer.lane >= first && racer.lane <= last);
                if (racer.node.active) assert.deepEqual(racer.bounds, bounds);
            }
        }
    });
}
