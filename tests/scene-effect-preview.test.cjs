const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let ts;
for (const directory of process.env.PATH.split(path.delimiter)) {
    const file = path.resolve(directory, '../typescript/lib/typescript.js');
    if (fs.existsSync(file)) { ts = require(file); break; }
}
if (!ts) throw Error('请通过 TypeScript 5.4.5 执行测试');
function load(file, imports = {}) {
    const m = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    vm.runInNewContext(code, { exports: m.exports, module: m, require: p => { if (!(p in imports)) throw Error(p); return imports[p]; } });
    return m.exports;
}
class Node {
    children = []; components = new Map(); events = new Map(); isValid = true; _active = true; writes = 0;
    constructor(name, parent) { this.name = name; this.parent = parent; parent?.children.push(this); }
    get active() { return this._active; }
    set active(v) { this.writes++; this._active = v; }
    get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
    addComponent(C) { const c = new C(); c.node = this; this.components.set(C, c); return c; }
    getComponent(C) { return this.components.get(C); }
    getChildByName(n) { return this.children.find(c => c.name === n); }
    setPosition(x, y) { this.x = x; this.y = y; }
    on(key, cb) { const list = this.events.get(key) || []; list.push(cb); this.events.set(key, list); }
    off() {}
    emit(key) { for (const cb of this.events.get(key) || []) cb(); }
    destroy() { this.isValid = false; for (const c of this.children) c.destroy(); }
}
class Vec3 { set(x, y, z) { Object.assign(this, { x, y, z }); } }
class Vec2 { set(x, y) { Object.assign(this, { x, y }); } static distance(a,b) { return Math.hypot(a.x-b.x,a.y-b.y); } }
class Color { constructor(...values) { this.values = values; } equals(c) { return this.values.every((v,i) => v === c.values[i]); } }
class Label { string = ''; color = new Color(255,255,255); }
class Button { static EventType = { CLICK: 'click' }; }
class BlockInputEvents {}
class UITransform {
    getBoundingBoxToWorld() {
        let x = 0, y = 0;
        for (let n = this.node; n; n = n.parent) { x += n.x || 0; y += n.y || 0; }
        return { contains: p => Math.abs(p.x-x) <= this.width/2 && Math.abs(p.y-y) <= this.height/2 };
    }
}
const stateModule = load('assets/scripts/venue/SceneEffectPreviewState.ts');
const { SceneEffectPreviewState } = stateModule;
function world() {
    const root = new Node('world'), pool = new Node('pool', root);
    const crowd = new Node('SpectatorCrowd', root), animation = new Node('Motion', crowd), flash = new Node('Flash', crowd);
    const floats = new Node('lane_float_rope_batch', pool), ceiling = new Node('ceiling_lighting_rig', pool);
    const hidden = new Node('ceiling_hidden', pool); hidden.active = false;
    const player = new Node('Player', root), bubbles = new Node('PlayerBubbles', player);
    return { root, crowd, animation, flash, floats, ceiling, hidden, player, bubbles };
}
test('开关局部生效，重复写无操作，保留原隐藏状态并支持延迟观众和退出恢复', () => {
    const w = world(), s = new SceneEffectPreviewState(); s.refreshTargets(w.root);
    assert.equal(w.crowd.writes, 0);
    s.setEnabled('crowd', false);
    assert.equal(w.animation.activeInHierarchy, false); assert.equal(w.flash.activeInHierarchy, false);
    assert.equal(w.player.active, true); assert.equal(w.floats.writes, 0);
    assert.equal(s.setEnabled('crowd', false), false); assert.equal(w.crowd.writes, 1);
    w.crowd.destroy(); const late = new Node('SpectatorCrowd', w.root); s.refreshTargets(w.root);
    assert.equal(late.active, false); assert.equal(s._entries.has(w.crowd), false);
    for (const key of stateModule.PREVIEW_EFFECTS) s.setEnabled(key, false);
    assert.equal(w.bubbles.active, false); assert.equal(w.player.active, true);
    s.reset(); assert.equal(late.active, true); assert.equal(w.hidden.active, false);
    s.setEnabled('floats', false); s.dispose(); assert.equal(w.floats.active, true);
});

test('反复点击不重建节点或监听，收起保持效果且只拦截可见按钮区域', () => {
    function rect(name,parent,width,height) { const n = new Node(name,parent), t = n.addComponent(UITransform); Object.assign(t,{width,height}); return n; }
    function button(name,parent,width,height,color,text) { const n = rect(name,parent,width,height); n.addComponent(Button); const l = new Node('Label',n).addComponent(Label); l.string=text; return n; }
    const { SceneEffectPreviewPanel } = load('assets/scripts/ui/SceneEffectPreviewPanel.ts', {
        cc: { Node, Vec2, Vec3, Color, Label, Button, BlockInputEvents, UITransform },
        '../venue/SceneEffectPreviewState': stateModule,
        './RuntimeUiFactory': { makeRect: rect, makeButton: button, makeScreenEdgeGroup: (name,parent) => rect(name,parent,220,348) },
        './ProjectUiFonts': { styleProjectUiLabel() {} },
    });
    const w = world(), s = new SceneEffectPreviewState(); s.refreshTargets(w.root);
    const hud = new Node('hud'), panel = new SceneEffectPreviewPanel(hud,s,{ isValid: true, screenToWorld: (a,b) => b.set(a.x,a.y,0) });
    const count = n => 1+n.children.reduce((sum,c) => sum+count(c),0), before = count(hud);
    const content = panel.root.getChildByName('PreviewOptions'), toggle = content.getChildByName('Preview_crowd');
    for (let i=0;i<100;i++) toggle.emit('click');
    assert.equal(s.isEnabled('crowd'),true); assert.equal(count(hud),before); assert.equal(toggle.events.get('click').length,1);
    toggle.emit('click'); assert.equal(toggle.getChildByName('Label').getComponent(Label).string,'观众：关');
    assert.equal(panel.blocksPointer(0,0),true);
    panel.root.getChildByName('PreviewExpand').emit('click');
    assert.equal(panel.blocksPointer(0,0),false); assert.equal(panel.blocksPointer(0,140),true);
    assert.equal(s.isEnabled('crowd'),false); assert.equal(count(hud),before);
    content.getChildByName('PreviewReset').emit('click'); assert.equal(s.isEnabled('crowd'),true);
    hud.active=false; assert.equal(panel.blocksPointer(0,140),false);
    panel.dispose(); assert.equal(panel.root.isValid,false);
});

test('面板起始触摸直到松开均不驱动全局相机，空白区域继续支持旋转缩放', () => {
    const { InputRouter } = load('assets/scripts/core/InputRouter.ts', { cc: { Vec2, input: { off(){} }, Input: { EventType:{} } }, './GameConstants':{}, './InputTuning':{} });
    let orbits=0, zooms=0;
    const router = new InputRouter(new Node('input'), { isCameraTouchBlocked: e => e.blocked, onCameraOrbit: () => orbits++, onCameraZoom: () => zooms++ });
    const event = (id,blocked,points=[0]) => ({ blocked,getID:()=>id,getAllTouches:()=>points.map(x=>({getLocation:()=>({x,y:0})})),getDelta:()=>({x:10,y:5}) });
    router.onCameraTouchStart(event(1,true)); router.onCameraTouchMove(event(1,false));
    router.onCameraTouchStart(event(2,false,[0,20])); router.onCameraTouchMove(event(2,false,[0,30]));
    assert.equal(orbits+zooms,0);
    router.onCameraTouchEnd(event(1,false)); router.onCameraTouchMove(event(2,false)); assert.equal(orbits,1);
    router.onCameraTouchStart(event(3,false,[0,20])); router.onCameraTouchMove(event(3,false,[0,30])); assert.equal(zooms,1);
    router.onCameraTouchStart(event(4,true)); router.unbind(); assert.equal(router._blockedCameraTouches.size,0);
});
