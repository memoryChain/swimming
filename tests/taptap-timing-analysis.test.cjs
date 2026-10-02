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

test('英文云测导出使用宿主显式时区，不依赖本机或日志前缀语言', () => {
    const line = '10/2/2026, 6:29:43 PM [info] Webglhost Git CommitId: 7372e37 Fri Oct 02 2026 18:29:43 GMT+0800 (China Standard Time)';
    const start = Date.UTC(2026, 9, 2, 10, 29, 43);
    assert.equal(timestampOf(line), start);
    assert.equal(timestampOf('Fri Oct 02 2026 03:29:43 GMT-0700'), start);
    const result = analyze(line + '\n[TapTiming] ' + JSON.stringify({ name: 'entry', timestamp_ms: start + 198 }));
    assert.equal(result.container_to_entry_ms_approx, 198);
});

test('矛盾的宿主与入口时间不得报告零等待', () => {
    const line = '2026/10/2 下午6:29:43 [info] Webglhost Git CommitId: 7372e37';
    const result = analyze(line + '\n[TapTiming] ' + JSON.stringify({ name: 'entry', timestamp_ms: timestampOf(line) - 5000 }));
    assert.equal(result.container_to_entry_ms_approx, null);
    assert.ok(result.notes.some(x => x.includes('时间顺序不一致')));
});
