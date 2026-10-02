'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create, install } = require('../scripts/templates/taptap-lifecycle-diagnostic.js');
function fixture() {
    let time = 1000, serial = 0, paused = false;
    const timers = new Map(), frames = new Map(), hostEvents = new Map(), gameEvents = new Map(), draws = new Set();
    const add = (map, key, fn) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(fn); };
    const del = (map, key, fn) => map.get(key)?.delete(fn);
    const host = { onShow(fn) { add(hostEvents, 'show', fn); }, offShow(fn) { del(hostEvents, 'show', fn); },
        onHide(fn) { add(hostEvents, 'hide', fn); }, offHide(fn) { del(hostEvents, 'hide', fn); } };
    const cc = { Game: { EVENT_SHOW: 'show', EVENT_HIDE: 'hide', EVENT_PAUSE: 'pause', EVENT_RESUME: 'resume' },
        Director: { EVENT_AFTER_DRAW: 'draw' },
        game: { isPaused() { return paused; }, on(k,f) { add(gameEvents,k,f); }, off(k,f) { del(gameEvents,k,f); },
            pause() { throw new Error('诊断不得暂停游戏'); }, resume() { throw new Error('诊断不得强制恢复'); } },
        director: { isPaused() { return false; }, getScene() { return { name: 'Login' }; },
            on(k,f) { draws.add(f); }, off(k,f) { draws.delete(f); }, root: { device: { gl: { isContextLost() { return false; } } } } } };
    const observer = create({ version: '0.0.9', now: () => time, log() {},
        schedule(fn) { timers.set(++serial,fn); return serial; }, cancel(id) { timers.delete(id); },
        requestFrame(fn) { frames.set(++serial,fn); return serial; }, cancelFrame(id) { frames.delete(id); },
        canvas: () => ({ width: 2340, height: 1080 }) });
    observer.attachHost(host); observer.attachEngine(cc);
    return { observer, host, cc, timers, frames, draws, hostEvents, gameEvents,
        paused(v) { paused=v; }, advance(ms) { time+=ms; },
        hostEmit(k) { for(const f of hostEvents.get(k)||[])f({ query: { secret: '不应采集' } }); },
        engineEmit(k) { for(const f of gameEvents.get(k)||[])f(); },
        tick() { for(const [id,f] of [...timers]) { timers.delete(id); f(); } },
        frame() { for(const [id,f] of [...frames]) { frames.delete(id); f(); } },
        draw() { for(const f of [...draws])f(); } };
}
test('后台取消全部观察，前台能区分暂停与宿主帧缺失，诊断不擅自恢复', () => {
    const f=fixture(); f.hostEmit('hide');
    assert.equal(f.timers.size,0); assert.equal(f.frames.size,0); assert.equal(f.draws.size,0);
    f.advance(60000); f.paused(true); f.hostEmit('show'); f.advance(2000); f.tick();
    const rows=f.observer.dump().records, result=rows.findLast(x=>x.name==='probe_result');
    assert.equal(rows.findLast(x=>x.name==='host_show').data.background_ms,60000);
    assert.equal(result.data.state.game_paused,true); assert.equal(result.data.host_frame_seen,false);
    assert.equal(result.data.engine_draw_seen,false); assert.equal(f.draws.size,0);
    assert.ok(!JSON.stringify(rows).includes('不应采集'));
});
test('宿主帧和引擎绘制分别观察，恢复后只有一次绘制监听', () => {
    const f=fixture(); f.hostEmit('hide'); f.hostEmit('show'); f.engineEmit('show'); f.engineEmit('resume');
    f.frame(); f.draw(); assert.equal(f.draws.size,0);
    f.advance(2000); f.tick();
    const r=f.observer.dump().records.findLast(x=>x.name==='probe_result');
    assert.equal(r.data.host_frame_seen,true); assert.equal(r.data.engine_draw_seen,true);
    assert.equal(r.data.state.game_paused,false); assert.equal(f.frames.size,0); assert.equal(f.timers.size,0);
});
test('重复挂接不叠监听，旧回调失效，采样次数有上限，销毁彻底解绑', () => {
    const f=fixture(), stale=[...f.frames.values()][0];
    f.observer.attachHost(f.host); f.observer.attachEngine(f.cc);
    assert.equal(f.hostEvents.get('show').size,1); assert.equal(f.gameEvents.get('resume').size,1);
    f.hostEmit('hide'); stale(); assert.equal(f.observer.dump().records.filter(x=>x.name==='host_frame').length,0);
    for(let i=0;i<15;i++){f.hostEmit('show');f.tick();f.hostEmit('hide');}
    assert.equal(f.observer.dump().records.filter(x=>x.name==='probe_begin').length,8);
    f.observer.dispose(); assert.equal(f.hostEvents.get('show').size,0); assert.equal(f.gameEvents.get('resume').size,0);
    assert.equal(f.timers.size,0); assert.equal(f.frames.size,0); assert.equal(f.draws.size,0);
});
test('重复执行入口复用观察器，不丢失上一轮生命周期记录', () => {
    const root={}; const first=install(root,{version:'0.0.9'});
    const second=install(root,{version:'0.0.9'}); assert.equal(first,second);
    assert.equal(first.dump().records.filter(x=>x.name==='entry_reused').length,1);
    first.dispose();
});
