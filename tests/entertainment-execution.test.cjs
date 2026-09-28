const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// 运行真实导演、控制器与 GameManager 门控的组合回放，不用计划配额冒充实际投放。
test('娱乐执行回放：代表段完成、障碍不在尾段追补、海龟受击牵引归零', () => {
    const report = JSON.parse(execFileSync(process.execPath,
        [path.join(__dirname, '../scripts/audit-entertainment-execution.cjs')], { encoding: 'utf8' }));
    for (const row of report.schedules) {
        assert.equal(row.missingRequired, 0, JSON.stringify(row));
        assert.equal(row.incompleteRequired, 0, JSON.stringify(row));
    }
    for (const row of report.exampleFrameRates) {
        assert.deepEqual(row.missingRequired, []);
        assert.deepEqual(row.incompleteRequired, []);
        assert.equal(row.cancelledPreview, false);
    }
    for (const row of report.obstacleResults.filter(row => row.gated)) {
        assert.ok(row.actual > 0, JSON.stringify(row));
        assert.equal(row.pendingAtFinish, 0);
        assert.equal(row.actual + row.cancelled, row.planned);
        for (const wave of row.waves) {
            assert.ok(wave.distance < row.distance * .88);
            assert.ok(row.distance - wave.distance >= Math.max(18, row.speed * 8));
        }
    }
    for (const row of report.turtleResults) {
        assert.equal(row.hands, 0, JSON.stringify(row));
        assert.equal(row.towReapplied, false, JSON.stringify(row));
    }
});
