// 使用真实观众排布算法和 Creator 数学实现验证落位、通道与闪光挂点。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
const root = path.resolve(__dirname, '..');
const { Vec3, Quat, Node } = createHarness();
function read(file) { return fs.readFileSync(path.join(root, 'assets/scripts/venue', file), 'utf8'); }
function evaluate(source, globals = {}) {
    const module = { exports: {} };
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, ...globals });
    return module.exports;
}
const source = ts.createSourceFile('SpectatorCrowdBuilder.ts', read('SpectatorCrowdBuilder.ts'), ts.ScriptTarget.Latest, true);
const crowd = evaluate(source.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(source)).join('\n')
    + '\nexport { buildCameraFlashPositions, partitionSpectators, buildSpectatorGeometry, SPECTATOR_COLORS };', {
    ...evaluate(read('SpectatorGeometry.ts')), Vec3, Quat, Component: class {},
    Color: class { constructor(r, g, b) { Object.assign(this, { r, g, b }); } },
    _decorator: { ccclass: () => value => value, property() {} },
});
const buckets = () => Array.from({ length: 15 }, () => []);
function stand(tier, side = 'n') {
    const axis = side === 'n' || side === 's' ? 'x' : 'z';
    const bounds = axis === 'x' ? { minX: -10, maxX: 60, minZ: 20, maxZ: 23.2 }
        : { minX: 65, maxX: 68.2, minZ: -25, maxZ: 25 };
    return { name: `bleacherbatch_t${tier}_${side}`, tier, sideSign: side === 'n' || side === 'e' ? 1 : -1,
        axis, rowCount: 2, yaw: axis === 'x' ? 0 : 90, bounds: { ...bounds, minY: tier * 3, maxY: tier * 3 + 2 } };
}
function collect(value) {
    const result = buckets(); new crowd.SpectatorCrowdBuilder().collectGrandstandSpectators(result, value); return result;
}

test('各层与对侧使用独立空位和错位，重新生成稳定，不走比赛随机数', () => {
    const a = collect(stand(1)), b = collect(stand(2)), c = collect(stand(1, 's'));
    const signature = list => list.flat().map(s => `${s.row}/${s.col}/${s.pos.x}`).sort();
    assert.deepEqual(signature(a), signature(collect(stand(1))), '固定排布可复现');
    assert.notDeepEqual(signature(a), signature(b)); assert.notDeepEqual(signature(a), signature(c));
    for (const list of [a, b, c]) {
        assert(list.flat().length > 20 && list.flat().length < 60, '稀疏但不空场');
        const groups = crowd.partitionSpectators(list);
        assert(groups.length <= 18);
        assert.equal(groups.reduce((n, group) => n + group.spectators.length, 0), list.flat().length);
        const row0 = list.flat().filter(s => s.row === 0).map(s => s.pos.x);
        assert(list.flat().filter(s => s.row === 1).every(s => row0.every(x => Math.abs(x - s.pos.x) > 0.001)), '前后排不重复对齐');
    }
});

test('直线与转角观众脚底落在台阶，横向留出过道和入口净空', () => {
    for (const side of ['n', 's', 'e', 'w']) for (const tier of [1, 2, 3, 4]) {
        const value = stand(tier, side), list = collect(value).flat();
        const { bounds, axis } = value, min = axis === 'x' ? bounds.minX : bounds.minZ;
        const max = axis === 'x' ? bounds.maxX : bounds.maxZ;
        const length = max - min, center = (min + max) / 2;
        const sections = Math.max(2, Math.min(6, Math.round(length / 12)));
        const width = (length - 1.8 * (sections - 1)) / sections;
        for (const s of list) {
            const pos = s.pos[axis], section = Math.min(sections - 1, Math.floor((pos - min) / (width + 1.8)));
            const start = min + section * (width + 1.8);
            assert(pos - s.width * 0.8 >= start && pos + s.width * 0.8 <= start + width);
            assert(Math.abs(pos - center) >= (axis === 'x' ? 6.35 : 3.25) + s.width * 0.8);
            const geometry = crowd.buildSpectatorGeometry([s], crowd.SPECTATOR_COLORS[0]);
            assert(geometry.minPos[axis] >= start && geometry.maxPos[axis] <= start + width, '包括举手轮廓在内的真实网格不侵入过道');
            const access = axis === 'x' ? 6.35 : 3.25;
            assert(geometry.maxPos[axis] <= center - access || geometry.minPos[axis] >= center + access);
            assert(Math.abs(s.pos.y - s.height / 2 - (bounds.minY + 0.6 + s.row * 0.72 + 0.025)) < 1e-9);
        }
    }
    const result = buckets(), origin = new Vec3(10, 0, 20), unit = Math.SQRT1_2;
    const anchors = new Map([
        ['spectator_corner_ne_o', origin],
        ['spectator_corner_ne_u', new Vec3(10 + 10 * unit, 0, 20 + 10 * unit)],
        ['spectator_corner_ne_v', new Vec3(10 - 3.2 * unit, 0, 20 + 3.2 * unit)],
    ]);
    new crowd.SpectatorCrowdBuilder().collectCornerSpectators(result, [1, 2, 3, 4].map(t => stand(t)), anchors);
    assert(result.flat().length > 0);
    for (const s of result.flat()) {
        const along = (s.pos.x - origin.x + s.pos.z - origin.z) * unit;
        const depth = (-(s.pos.x - origin.x) + s.pos.z - origin.z) * unit;
        assert(along >= s.width * 0.8 && along <= 10 - s.width * 0.8);
        assert(depth >= s.row * 1.6 && depth <= (s.row + 1) * 1.6);
        assert(Math.abs(s.pos.y - s.height / 2 - (s.tier * 3 + 0.6 + s.row * 0.72 + 0.025)) < 1e-9);
    }
});

test('闪光只选实际观众，挂点与人物的身形、朝向和动作组对应，候选预算封顶', () => {
    const list = buckets();
    for (let i = 0; i < 2000; i++) list[i % 15].push({ pos: new Vec3(i * 2, 4, i % 3),
        width: 0.5, height: 0.8, topWidthScale: 1.1, topOffset: 0.05, row: i % 2, col: i,
        side: 1, yaw: i % 4 * 90, tier: i % 4 + 1, pose: i % 4 < 2 ? i % 3 : 0 });
    const sites = crowd.buildCameraFlashPositions(list);
    assert.equal(sites.motions.length, 320); assert.equal(sites.positions.length, 960);
    for (let i = 0; i < sites.motions.length; i++) {
        const point = new Vec3(...sites.positions.slice(i * 3, i * 3 + 3));
        const s = list.flat().find(value => Math.abs(value.pos.x - point.x) < 0.5);
        assert(s, '不会落到删掉的座位或通道上'); assert.equal(sites.motions[i], s.pose);
        const seed = Math.sin(s.col * 12.9898 + s.side * 78.233 + s.row * 37.719) * 43758.5453;
        const yaw = s.yaw + (seed - Math.floor(seed) - 0.5) * 8;
        const rotation = new Quat(); Quat.fromEuler(rotation, -90, yaw, 0);
        const expected = new Vec3(s.tier <= 2 ? s.width * s.topOffset : 0, s.width * 0.26, s.height * 0.18);
        Vec3.transformQuat(expected, expected, rotation); expected.add(s.pos);
        assert(Vec3.distance(point, expected) < 0.0003);
    }
    const empty = crowd.buildCameraFlashPositions(buckets());
    assert.equal(empty.positions.length, 0); assert.equal(empty.motions.length, 0);
});

test('闪光筛选与实际发射使用最新父节点变换；隐藏观众不继续闪光', () => {
    const flash = ts.createSourceFile('SpectatorCameraFlashEmitter.ts', read('SpectatorCameraFlashEmitter.ts'), ts.ScriptTarget.Latest, true);
    const cls = flash.statements.find(n => ts.isClassDeclaration(n));
    const names = ['resolvePosition', 'refreshVisiblePositions', 'emitOne'];
    const { Subject } = evaluate(`export class Subject { ${names.map(name => cls.members.find(n => n.name?.getText(flash) === name).getText(flash)).join('\n')} }`, {
        Vec3, VISIBILITY_HALF_EXTENT: 0.6,
        geometry: { AABB: { set() {} }, intersect: { aabbFrustum: () => 1 } },
    });
    const parent = new Node(null, 3, 5, 7); parent.activeInHierarchy = true;
    parent.setRotationFromEuler(0, 90, 0); parent.setScale(2, 2, 2);
    const h = new Subject(), emitted = []; let position;
    Object.assign(h, { _positions: new Float32Array([1, 2, 3]), _positionMotions: new Uint8Array([1]),
        _motionParents: [null, parent], _visibilityCamera: { camera: { frustum: {} } },
        _visibilityCenter: new Vec3(), _visibilityBounds: {}, _visiblePositionIndices: new Uint16Array(1),
        _emitPosition: new Vec3(), _emitterNode: { setWorldPosition: p => { position = p.clone(); } },
        _system: { isPlaying: true, emit: () => emitted.push(position) },
    });
    const expected = () => Vec3.transformMat4(new Vec3(), new Vec3(1, 2, 3), parent.worldMatrix);
    h.refreshVisiblePositions(); assert.equal(h._visiblePositionCount, 1);
    assert(Vec3.distance(h._visibilityCenter, expected()) < 1e-6);
    parent.position.y += 0.016; h.emitOne(1 / 60);
    assert(Vec3.distance(emitted[0], expected()) < 1e-6, '发射时读取当前欢呼偏移');
    parent.activeInHierarchy = false; h.emitOne(1 / 60); assert.equal(emitted.length, 1);
    h.refreshVisiblePositions(); assert.equal(h._visiblePositionCount, 0);
});
