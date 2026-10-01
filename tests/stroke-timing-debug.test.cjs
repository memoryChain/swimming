const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
const h = createHarness();
let colors = 0;
class Color { constructor(...channels) { colors++; this.channels = channels; } }
class Sprite {}
class UITransform {}
Object.assign(h.cc, { Color, Sprite, UITransform });
const { StrokeTimingDebugView } = h.load(path.join(h.root, 'assets/scripts/ui/StrokeTimingDebugView.ts'));
const { Rating } = h.load(path.join(h.root, 'assets/scripts/core/GameConstants.ts'));

function fixture() {
    const counts = { reads: 0, active: 0, positions: 0, colors: 0, sizes: 0 };
    const parent = { active: true };
    let active = true;
    const marker = { position: { x: 2, y: 0 },
        get active() { return active; }, set active(v) { counts.active++; active = v; },
        setPosition(x, y) { counts.positions++; this.position = { x, y }; },
    };
    const sprite = { set color(v) { counts.colors++; this.value = v; } };
    const transform = { contentSize: { width: 90, height: 180 }, setContentSize(w, height) { counts.sizes++; this.contentSize = { width: w, height }; } };
    const fill = { position: { x: 0, y: 0, z: 0 },
        get activeInHierarchy() { return parent.active; },
        getComponent(C) { return C === Sprite ? sprite : transform; },
        setPosition(x, y, z) { counts.positions++; this.position = { x, y, z }; },
    };
    const view = new StrokeTimingDebugView(fill, marker);
    const state = { active: true, progress: .4, rating: Rating.PERFECT };
    let buffer;
    const source = { fillStrokeTimingGuide(target) {
        counts.reads++;
        if (buffer) assert.equal(target, buffer); buffer = target;
        target.active = state.active; target.currentRatio = state.progress;
        if (!target.intervals.length) target.intervals.push({ startRatio: .2, endRatio: .5, rating: state.rating });
        target.intervals[0].rating = state.rating;
        return target;
    } };
    return { counts, parent, marker, sprite, state, view, source };
}

test('调试条隐藏或父层隐藏时不读取选手，稳定隐藏不重复写 active', () => {
    const f = fixture();
    for (let i = 0; i < 120; i++) f.view.update(1 / 60, false, f.source);
    assert.equal(f.counts.reads, 0); assert.equal(f.counts.active, 1);
    f.parent.active = false;
    for (let i = 0; i < 120; i++) f.view.update(1 / 60, true, f.source);
    assert.equal(f.counts.reads, 0); assert.equal(f.counts.active, 1);
    f.parent.active = true; f.view.update(0, true, f.source);
    assert.equal(f.counts.reads, 1); assert.equal(f.marker.active, true);
});

test('调试条按 30Hz 复用读数，稳定颜色／像素／尺寸不写入或创建颜色', () => {
    const f = fixture(), before = colors;
    f.view.update(0, true, f.source);
    const writes = { ...f.counts };
    for (let i = 0; i < 120; i++) f.view.update(1 / 120, true, f.source);
    assert.ok(f.counts.reads >= 29 && f.counts.reads <= 31);
    for (const key of ['colors', 'sizes', 'positions', 'active']) assert.equal(f.counts[key], writes[key]);
    assert.equal(colors, before);
    f.state.progress += .00001; f.view.update(1 / 30, true, f.source);
    assert.equal(f.counts.positions, writes.positions);
    f.state.progress = .6; f.view.update(1 / 30, true, f.source);
    assert.equal(f.counts.positions, writes.positions + 1);
    f.state.rating = Rating.GOOD; f.view.update(1 / 30, true, f.source);
    assert.equal(f.counts.colors, writes.colors + 1);
});

test('松手隐藏标记且重开立即显示当前状态，不重建组件', () => {
    const f = fixture(); f.view.update(0, true, f.source);
    f.state.active = false; f.view.update(1 / 30, true, f.source);
    assert.equal(f.marker.active, false);
    f.view.update(0, false, f.source); f.state.active = true; f.state.progress = .8;
    f.view.update(0, true, f.source);
    assert.equal(f.marker.active, true); assert.equal(f.marker.position.y, 65);
    assert.equal(f.counts.sizes, 1);
});
