'use strict';

// 分析 vConsole 导出，不修改日志、不上传。未知阶段保持未知，不能把无错误当正常。
const fs = require('node:fs');
function timestampOf(line) {
    // 宿主日志带显式时区时优先使用它，避免云测导出语言/时区影响入口前耗时。
    const hostDate = line.match(/\b(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{4}\s+\d{2}:\d{2}:\d{2}\s+GMT[+-]\d{4}\b/);
    if (hostDate) {
        const value = Date.parse(hostDate[0]);
        if (Number.isFinite(value)) return value;
    }
    const m = line.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(上午|下午)?\s*(\d{1,2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    let hour = Number(m[5]);
    if (m[4] === '下午' && hour < 12) hour += 12;
    if (m[4] === '上午' && hour === 12) hour = 0;
    // 本项目手机导出示例为中国标准时间；秒级时间只可作为粗略参照。
    return Date.UTC(+m[1], +m[2] - 1, +m[3], hour - 8, +m[6], +m[7]);
}
function analyze(text) {
    const events = [], summaries = [], parseErrors = [];
    let containerAt = null;
    for (const line of text.split(/\r?\n/)) {
        if (containerAt === null && /Webglhost Git CommitId|run tj-proxy\.js/.test(line)) containerAt = timestampOf(line);
        const index = line.indexOf('[TapTiming] ');
        if (index < 0) continue;
        try {
            const event = JSON.parse(line.slice(index + '[TapTiming] '.length));
            if (!event || !event.name || !Number.isFinite(event.timestamp_ms)) continue;
            events.push(event);
            if (event.name === 'summary') summaries.push(event.properties || {});
        } catch (_) { parseErrors.push('存在被截断或无法解析的计时日志'); }
    }
    const entry = events.find(e => e.name === 'entry'), ready = events.find(e => e.name === 'lobby_ready' || e.name === 'boot_ready');
    const stages = new Map();
    function add(stage) {
        if (!Number.isFinite(stage.elapsed_ms)) return;
        const name = stage.phase || stage.operation || 'unknown', label = stage.label || '';
        const key = stage.id || name + ':' + label;
        if (!stages.has(key) || stages.get(key).elapsed_ms < stage.elapsed_ms) stages.set(key, {
            stage: name, label, elapsed_ms: stage.elapsed_ms, result: stage.result || 'completed'
        });
    }
    for (const event of events) {
        if (event.name === 'operation_end' || event.name === 'operation_failed' || event.name === 'boot_done') add(event.properties || {});
    }
    for (const summary of summaries) for (const value of [...(summary.slowest || []), ...(summary.boot_stages || [])]) add(value);
    const slowest = [...stages.values()].sort((a, b) => b.elapsed_ms - a.elapsed_ms).slice(0, 12);
    const warnings = events.filter(e => /waiting|failed/.test(e.name)).map(e => ({ name: e.name,
        since_entry_ms: e.since_entry_ms, properties: e.properties }));
    const rawGap = entry && containerAt !== null ? entry.timestamp_ms - containerAt : null;
    // 秒级宿主时间与毫秒级入口时间可能存在小偏差；负值不得伪装成“零等待”。
    const gap = rawGap !== null && rawGap >= 0 ? rawGap : null;
    const notes = [...new Set(parseErrors)];
    if (rawGap !== null && rawGap < 0) notes.push('容器时间晚于游戏入口，时间顺序不一致；入口前耗时保持未知，需核对时区、时钟及日志来源。');
    if (!entry) notes.push('未发现游戏入口计时标记；可能尚未执行入口，或该版本/导出没有采集到此标记。');
    if (gap !== null && gap >= 10000) notes.push('容器首条日志至游戏入口之间存在较长间隔；这段不属于已测量的游戏资源加载，具体原因仍需宿主调试。');
    if (!ready) notes.push('未观察到大厅就绪标记，不能据此认定永久卡死。');
    notes.push('各阶段是包含异步等待的墙钟耗时，可能互相包含；不能相加当作总耗时，也不能等同 CPU 开销。');
    return { schema_version: 1, version: entry?.properties?.version || null, timing_records: events.length,
        container_to_entry_ms_approx: gap, entry_to_lobby_ms: entry && ready ? Math.max(0, ready.timestamp_ms - entry.timestamp_ms) : null,
        last_stage: events.at(-1)?.name || null, slowest, warnings, notes };
}
module.exports = { analyze, timestampOf };
if (require.main === module) {
    try {
        if (!process.argv[2]) throw new Error('请提供 vConsole 导出文件路径');
        console.log(JSON.stringify(analyze(fs.readFileSync(process.argv[2], 'utf8')), null, 2));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
