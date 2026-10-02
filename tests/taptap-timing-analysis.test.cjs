'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyze, timestampOf } = require('../scripts/analyze-taptap-timing.cjs');
test('缺少游戏记录时不把四行容器日志误判为卡死或资源太大', () => {
    const result = analyze('2026/10/2 上午10:19:37 [info] Webglhost Git CommitId: 7372e37');
    assert.equal(result.timing_records, 0); assert.equal(result.entry_to_lobby_ms, null);
    assert.equal(result.container_to_entry_ms_approx, null); assert.ok(result.notes[0].includes('未发现游戏入口'));
});
test('分离入口之前与入口之后等待，日志限额后仍用摘要恢复慢阶段，不累加嵌套耗时', () => {
    const start = timestampOf('2026/10/2 上午10:19:37');
    const events = [
        { name: 'entry', timestamp_ms: start + 120000, properties: { version: '0.0.7' } },
        { name: 'lobby_ready', timestamp_ms: start + 125000, properties: {} },
        { name: 'summary', timestamp_ms: start + 125000, properties: {
            slowest: [{ id: 'op-1', operation: 'bundle_load', label: 'race', elapsed_ms: 3000 }],
            boot_stages: [{ phase: 'engine-import', elapsed_ms: 1000 }] } }
    ];
    const log = '2026/10/2 上午10:19:37 [info] Webglhost Git CommitId: 7372e37\n'
        + events.map(e => '[TapTiming] ' + JSON.stringify(e)).join('\n');
    const result = analyze(log);
    assert.equal(result.container_to_entry_ms_approx, 120000); assert.equal(result.entry_to_lobby_ms, 5000);
    assert.equal(result.slowest[0].stage, 'bundle_load'); assert.equal(result.slowest[1].elapsed_ms, 1000);
    assert.ok(result.notes.some(n => n.includes('宿主调试')));
});
test('截断日志保留未知，上午/下午时间转换正确', () => {
    assert.equal(timestampOf('2026/10/2 下午12:00:00') - timestampOf('2026/10/2 上午12:00:00'), 43200000);
    assert.ok(analyze('[TapTiming] {').notes.some(n => n.includes('截断')));
});
