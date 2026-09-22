const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');

test('尾迹固定一个网格和材质，动态上传保留UV与索引，隐藏不上传，销毁后忽略加载回调', () => {
    let callback, meshes = 0, materials = 0, uploads = 0, geometry;
    let lastUpload;
    const cachedUploads = new Map();
    class Node {
        isValid = true; active = true; layer = 1; children = [];
        addChild(node) { this.children.push(node); }
        addComponent(Type) { return new Type(); }
        destroy() { this.isValid = false; }
    }
    const h = createHarness({ '../core/RaceBundleLoader': { loadRaceAsset(_path, _type, done) { callback = done; } } });
    Object.assign(h.cc, {
        Node, Texture2D: class {}, MeshRenderer: class { setMaterial() {} },
        Color: class {}, Material: class { constructor() { materials++; } initialize() {} setProperty() {} destroy() {} },
        gfx: { CullMode: { NONE: 0 } },
        utils: { MeshUtils: { createDynamicMesh(_index, data) {
            geometry = data; meshes++;
            return { updateSubMesh(_i, next) {
                uploads++;
                for (const key of ['positions', 'colors', 'uvs', 'indices16']) {
                    assert.equal(next[key].buffer, data[key].buffer);
                    assert.equal(next[key].byteOffset, 0);
                    assert.ok(next[key].length <= data[key].length);
                }
                const quads = next.indices16.length / 6;
                assert.equal(next.positions.length, quads * 12);
                assert.equal(next.colors.length, quads * 16);
                assert.equal(next.uvs.length, quads * 8);
                if (cachedUploads.has(quads)) assert.equal(next, cachedUploads.get(quads));
                else cachedUploads.set(quads, next);
                lastUpload = next;
                for (const v of next.positions) assert.ok(Number.isFinite(v));
            }, destroy() {} };
        } } },
    });
    const load = name => h.load(path.join(h.root, 'assets/scripts', name + '.ts'));
    const { DraftingModel, DRAFTING_TUNING } = load('swimmer/DraftingRules');
    const { DraftingPresentation } = load('swimmer/DraftingPresentation');
    const parent = new Node(), model = new DraftingModel(8), view = new DraftingPresentation(parent, model, 0);
    callback(null, {});
    for (let lane = 0; lane < 8; lane++) Object.assign(model.racers[lane], { eligible: true, speed: 2.5, z: lane * 2.6 });
    for (let n = 0; n < 60; n++) {
        for (const racer of model.racers) racer.x += 1 / 6;
        model.step(1 / 15); view.update();
    }
    assert.equal(meshes, 1); assert.equal(materials, 1); assert.equal(parent.children.length, 1);
    assert.equal(parent.children[0].active, true); assert.ok(uploads > 0);
    assert.equal(geometry.positions.length, 8 * 47 * 4 * 3);
    const fullBytes = geometry.positions.byteLength + geometry.colors.byteLength + geometry.uvs.byteLength + geometry.indices16.byteLength;
    const uploadedBytes = lastUpload.positions.byteLength + lastUpload.colors.byteLength + lastUpload.uvs.byteLength + lastUpload.indices16.byteLength;
    assert.ok(uploadedBytes < fullBytes * .5, `${uploadedBytes} / ${fullBytes}`);
    console.log(JSON.stringify({ swimmers: 8, speed: 2.5, fullBytes, uploadedBytes,
        triangles: lastUpload.indices16.length / 3, bytesPerSecondAt15Hz: uploadedBytes * 15 }));
    const before = uploads; for (let n = 0; n < 60; n++) view.update(); assert.equal(uploads, before);
    DRAFTING_TUNING.visuals = false; model.step(.1); view.update(); assert.equal(uploads, before);
    assert.equal(parent.children[0].active, false);
    DRAFTING_TUNING.visuals = true; view.update(); assert.equal(parent.children[0].active, true);
    for (let lane = 1; lane < 8; lane++) model.racers[lane].eligible = false;
    model.step(1 / 15); view.update();
    let empty = false, visible = 0;
    for (let i = 0; i < lastUpload.positions.length; i += 12) {
        const zero = lastUpload.positions.subarray(i, i + 12).every(v => v === 0);
        if (zero) empty = true;
        else { assert.equal(empty, false, '有效顶点之后只能是清空的尾部'); visible++; }
    }
    assert.ok(visible > 0);
    assert.ok(lastUpload.positions.length / 12 - visible <= 7);
    assert.ok(lastUpload.positions.length < geometry.positions.length / 8);
    model.racers[0].eligible = false; model.step(1 / 15); view.update();
    assert.equal(parent.children[0].active, false);
    const hiddenUploads = uploads;
    for (let i = 0; i < 60; i++) { model.step(1 / 15); view.update(); }
    assert.equal(uploads, hiddenUploads);
    view.dispose(); assert.equal(parent.children[0].isValid, false);
    assert.doesNotThrow(() => callback(null, {}));
});
