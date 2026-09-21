const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness() {
    const timers = new Map(), queries = [], starts = [], messages = [];
    let nextTimer = 0, entered = 0;
    const file = path.join(__dirname, '../assets/scripts/net/WechatGameRoom.ts');
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText, { exports, console,
        setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
    }, { filename: file });
    const room = new exports.WechatGameRoom();
    room._accessInfo = 'room';
    room._gsm = {
        broadcastInRoom: msg => messages.push(msg),
        getRoomInfo: options => queries.push(options),
        startGame: options => starts.push(options),
        memberLeaveRoom: options => options.success(),
    };
    room.setCallbacks({ onGameStart() { entered++; } });
    const run = id => { const entry = timers.get(id); assert.ok(entry); timers.delete(id); entry.fn(); };
    return { room, timers, queries, starts, messages, run, entered: () => entered };
}

test('普通大厅广播不创建房间查询或轮询定时器', () => {
    const h = harness();
    for (const msg of ['PV|2|95', 'MOD|2|muscleMan,2', '{"t":"rules"}', '{"t":"rulesReady"}']) h.room.broadcast(msg);
    assert.equal(h.messages.length, 4);
    assert.equal(h.queries.length, 0);
    assert.equal(h.timers.size, 0);
});

test('多个开赛请求共用一条轮询，成功兜底也只有一个，确认后不再查询', async () => {
    const h = harness();
    const first = h.room.startGame(), second = h.room.startGame();
    assert.equal(h.queries.length, 1);
    h.queries[0].success({ roomState: 1, members: [] }); await Promise.resolve();
    assert.equal(h.timers.size, 1);
    h.run(h.room._startPollTimer);
    assert.equal(h.queries.length, 2);
    h.starts[0].success(); h.starts[1].success(); await Promise.all([first, second]);
    const fallback = h.room._startFallbackTimer;
    assert.ok(fallback);
    h.run(fallback);
    assert.equal(h.entered(), 1);
    h.queries[1].success({ roomState: 1, members: [] }); await Promise.resolve();
    assert.equal(h.timers.size, 0);
    assert.equal(h.room._startPollActive, false);
});

test('退出后迟到查询和平台成功不重新开赛，也不续建轮询', async () => {
    const h = harness();
    const start = h.room.startGame();
    await h.room.leaveRoom();
    h.queries[0].success({ roomState: 2, members: [] });
    h.starts[0].success(); await start;
    assert.equal(h.entered(), 0);
    assert.equal(h.room._gameStarted, false);
    assert.equal(h.timers.size, 0);
});

test('已排队的旧轮询和成功兜底不清除新等待的定时器', async () => {
    const h = harness();
    const first = h.room.startGame();
    h.queries[0].success({ roomState: 1, members: [] }); await Promise.resolve();
    const stalePoll = h.timers.get(h.room._startPollTimer).fn;
    h.starts[0].success(); await first;
    const staleFallback = h.timers.get(h.room._startFallbackTimer).fn;
    h.room.resetGameStartedLatch();
    const second = h.room.startGame();
    h.queries[1].success({ roomState: 1, members: [] }); await Promise.resolve();
    const currentTimer = h.room._startPollTimer;
    stalePoll(); staleFallback();
    assert.equal(h.room._startPollTimer, currentTimer);
    assert.equal(h.queries.length, 2);
    assert.equal(h.entered(), 0);
    h.starts[1].success(); await second;
    h.run(h.room._startFallbackTimer);
    assert.equal(h.entered(), 1);
    assert.equal(h.timers.size, 0);
});

test('一直未开赛时单条轮询最多十五次，后续广播不重启查询', async () => {
    const h = harness();
    h.room.startGame();
    for (let i = 0; i < 15; i++) {
        h.queries[i].success({ roomState: 1, members: [] }); await Promise.resolve();
        h.run(h.room._startPollTimer);
    }
    assert.equal(h.queries.length, 15);
    assert.equal(h.timers.size, 0);
    h.room.broadcast('{"t":"rules"}');
    assert.equal(h.queries.length, 15);
    assert.equal(h.room._startPollActive, false);
});
