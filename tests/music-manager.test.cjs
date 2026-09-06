const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
const { load, cc, root } = createHarness();
const { EventEmitter } = require('node:events');
class AudioSource {
    static EventType = { ENDED: 'ended', STARTED: 'started' };
    static AudioState = { INTERRUPTED: 'interrupted' };
    isValid = true; playing = false; clip = null; plays = 0;
    currentTime = 0; state = 'playing'; scheduled = []; once = [];
    play() { this.currentTime = 0; this.playing = true; this.plays++; this.node.emit('started'); }
    stop() { this.playing = false; this.currentTime = 0; }
    schedule(fn) { this.scheduled.push(fn); }
    scheduleOnce(fn) { if (!this.once.includes(fn)) this.once.push(fn); }
    flush() { const tasks = this.once.splice(0); for (const fn of tasks) fn(); }
    tick(dt = 0.5) { this.flush(); for (const fn of this.scheduled) fn(dt); }
}
class MusicNode extends EventEmitter {
    isValid = true;
    addComponent() { const source = new AudioSource(); source.node = this; return source; }
}
cc.AudioSource = AudioSource; cc.AudioClip = class {}; cc.Node = MusicNode;
cc.Game = { EVENT_HIDE: 'hide', EVENT_SHOW: 'show' }; cc.game = new EventEmitter(); cc.game.addPersistRootNode = () => {};
cc.director = { getScene: () => ({ addChild() {} }) };
const requests = [];
cc.assetManager = { getBundle: () => ({ load: (name, type, done) => requests.push({ name, done }) }) };
const { MusicManager: music } = load(path.join(root, 'assets/scripts/app/MusicManager.ts'));
function finish() { const request = requests.shift(); assert.ok(request); request.done(null, { name: request.name }); }

test('结算循环结束事件可连续恢复，重复请求不打断正在播放的音乐', () => {
    music.playResult(); finish();
    const source = music._source;
    assert.equal(source.loop, true);
    for (let i = 0; i < 5; i++) {
        source.playing = false; music._node.emit('ended'); source.flush();
        assert.equal(source.playing, true);
    }
    const count = source.plays;
    music.playResult(); assert.equal(source.plays, count);
    assert.equal(music._node.listenerCount('ended'), 1);
});
test('静音期间切曲再恢复必须播放新曲，旧异步加载不得覆盖', () => {
    music.playRace(); const old = requests.shift();
    music.setVolume(0); music.playResult();
    old.done(null, { name: '过期比赛音乐' });
    assert.equal(music._source.playing, false);
    music.setVolume(1); finish();
    assert.equal(music._loadedTrack, 'result');
    assert.equal(music._source.playing, true);
});
test('加载中静音不偷播，结束事件不解除静音，恢复音量重新播放', () => {
    music.playRace(); music.setVolume(0); finish();
    assert.equal(music._source.playing, false);
    music._node.emit('ended'); music._source.flush(); assert.equal(music._source.playing, false);
    music.setVolume(1); assert.equal(music._source.playing, true);
});
test('后台不启动新曲，返回前台恢复，重复前台事件不重播且监听不叠加', () => {
    cc.game.emit('hide'); music.playResult(); finish();
    assert.equal(music._source.playing, false);
    music._node.emit('ended'); music._source.flush(); assert.equal(music._source.playing, false);
    cc.game.emit('show'); assert.equal(music._source.playing, true);
    const count = music._source.plays;
    cc.game.emit('show'); assert.equal(music._source.plays, count);
    assert.equal(cc.game.listenerCount('show'), 1);
});

test('结束事件先于 playing 置 false，延迟恢复不会错过第二遍', () => {
    const source = music._source, before = source.plays;
    for (let i = 0; i < 3; i++) {
        source.playing = true; source.currentTime = 8.07;
        music._node.emit('ended');
        assert.equal(source.plays, before + i, '不能在后端结束回调栈内重入播放');
        source.playing = false;
        source.flush();
        assert.equal(source.plays, before + i + 1);
        assert.equal(source.currentTime, 0);
    }
});

test('漏发结束事件且 playing 卡在 true，停滞检查能反复恢复', () => {
    const source = music._source;
    for (let round = 0; round < 3; round++) {
        const before = source.plays;
        for (let i = 0; i < 6; i++) { source.currentTime = Math.min(8.07, 7.8 + i * 0.5); source.tick(); }
        assert.equal(source.plays, before + 1);
        assert.equal(source.currentTime, 0);
    }
});

test('健康的原生循环即使跨越多次曲尾也不被定时检查重启', () => {
    const source = music._source, before = source.plays;
    for (let i = 1; i < 90; i++) { source.currentTime = i * 0.5 % 8.07; source.tick(); }
    assert.equal(source.plays, before);
    assert.equal(source.scheduled.length, 1);
    assert.equal(source.playOnAwake, false);
});

test('静音、后台和音频焦点中断期间停滞不抢播，回前台后恢复检查', () => {
    const source = music._source;
    music.setVolume(0); let before = source.plays;
    for (let i = 0; i < 30; i++) source.tick();
    assert.equal(source.plays, before);
    music.setVolume(1); cc.game.emit('hide'); before = source.plays;
    for (let i = 0; i < 30; i++) source.tick();
    assert.equal(source.plays, before);
    cc.game.emit('show'); source.state = 'interrupted'; source.playing = false;
    for (let i = 0; i < 30; i++) source.tick();
    assert.equal(source.plays, before);
    source.state = 'stopped'; source.tick(); assert.equal(source.plays, before + 1);
});

test('解码期间重复请求和定时检查不会堆积播放，完成后正常推进', () => {
    const source = music._source, realPlay = source.play;
    source.play = function () { this.plays++; this.playing = false; };
    music.playRace(); finish(); const before = source.plays;
    for (let i = 0; i < 16; i++) { music.playRace(); source.tick(); }
    assert.equal(source.plays, before, '八秒的异步加载窗口内只有一次播放请求');
    source.playing = true; source.node.emit('started'); source.play = realPlay;
    for (let i = 1; i < 8; i++) { source.currentTime = i * 0.5; source.tick(); }
    assert.equal(source.plays, before);
});

test('上一首的延迟结束恢复不会重播新曲，静音后待执行回调也不偷播', () => {
    const source = music._source;
    source.node.emit('ended'); music.playResult(); finish(); const before = source.plays;
    source.flush(); assert.equal(source.plays, before);
    source.node.emit('ended'); music.setVolume(0); source.flush();
    assert.equal(source.plays, before); assert.equal(source.playing, false);
    music.setVolume(1);
});

test('playing 卡住时由 AudioSource 排队一次 stop→play，不能重复停止卡死小游戏操作队列', () => {
    const source = music._source, realStop = source.stop, realPlay = source.play;
    let stops = 0;
    // 模拟原生 stop 异步回调，调用后 playing 不会立刻变为 false。
    source.stop = () => { stops++; };
    source.play = function () { if (this.playing) this.stop(); realPlay.call(this); };
    source.playing = true; source.currentTime = 8.07;
    for (let i = 0; i < 5; i++) source.tick();
    assert.equal(stops, 1);
    source.stop = realStop; source.play = realPlay;
});
