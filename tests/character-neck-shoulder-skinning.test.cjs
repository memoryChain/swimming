// 局部蒙皮修复的资产保护：共享动作不依赖角色专属转角。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRig, load, root } = require('./helpers/character-contact-harness.cjs');
const { SWIMMER_MODEL_VARIANTS } = load(path.join(root, 'assets/scripts/core/ResourcePaths.ts'));

test('全部角色使用共享胸肩转体，不提供角色专属角度入口', () => {
    for (const variant of SWIMMER_MODEL_VARIANTS) {
        assert.equal(Object.hasOwn(variant, 'freestyleChestRollDegrees'), false);
    }
    assert.equal(createRig('CartonSwimmer16.glb').pose.setFreestyleChestRollDegrees, undefined);
});

test('肩衣袖修正保留模型全部非权重字节及有效的归一化权重', () => {
    const data = fs.readFileSync(path.join(root, 'assets/race/models/CartonSwimmer16.glb'));
    assert.equal(data.length, 923452);
    const size = data.readUInt32LE(12), doc = JSON.parse(data.subarray(20, 20 + size));
    const primitive = doc.meshes[0].primitives[0];
    const acc = doc.accessors[primitive.attributes.WEIGHTS_0], view = doc.bufferViews[acc.bufferView];
    const start = 28 + size + (view.byteOffset || 0) + (acc.byteOffset || 0);
    assert.equal(acc.componentType, 5126);
    assert.equal(acc.type, 'VEC4');
    const preserved = Buffer.from(data);
    for (let v = 0; v < acc.count; v++) {
        const offset = start + v * (view.byteStride || 16);
        let sum = 0;
        for (let k = 0; k < 4; k++) {
            const w = data.readFloatLE(offset + k * 4);
            assert.ok(Number.isFinite(w) && w >= 0 && w <= 1);
            sum += w;
        }
        assert.ok(Math.abs(sum - 1) < 1e-6);
        preserved.fill(0, offset, offset + 16);
    }
    // 基线把权重区清零后的哈希：保护骨架/绑定矩阵/关节索引/几何/UV/纹理。
    assert.equal(createHash('sha256').update(preserved).digest('hex'),
        'f372d6a01fc16fbc6944db5521229ce3570ae9ba9204a93ef169239dd6914eec');
});
