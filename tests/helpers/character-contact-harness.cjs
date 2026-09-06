const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./cocos-math-harness.cjs');
const harness = createHarness();
const { load, Node, Vec3, Quat, Mat4, root } = harness;
const { StandingSoleContact } = load(path.join(root, 'assets/scripts/character/StandingSoleContact.ts'));
const { CharacterHandContact } = load(path.join(root, 'assets/scripts/character/CharacterHandContact.ts'));
const { FreestylePoseController } = load(path.join(root, 'assets/scripts/character/FreestylePoseController.ts'));
const { SWIMMER_MODEL_VARIANTS } = load(path.join(root, 'assets/scripts/core/ResourcePaths.ts'));

function createRig(file) {
    const data = fs.readFileSync(path.join(root, 'assets/race/models', file));
    const jsonSize = data.readUInt32LE(12);
    const gltf = JSON.parse(data.subarray(20, 20 + jsonSize));
    const binary = data.subarray(28 + jsonSize);
    const accessor = index => {
        const a = gltf.accessors[index], v = gltf.bufferViews[a.bufferView];
        const size = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
        const bytes = { 5121: 1, 5123: 2, 5126: 4 }[a.componentType];
        const read = { 5121: 'readUInt8', 5123: 'readUInt16LE', 5126: 'readFloatLE' }[a.componentType];
        assert.ok(size && bytes);
        const values = [];
        for (let i = 0; i < a.count; i++) for (let j = 0; j < size; j++) {
            let value = binary[read]((v.byteOffset || 0) + (a.byteOffset || 0) + i * (v.byteStride || size * bytes) + j * bytes);
            if (a.normalized) value /= a.componentType === 5121 ? 255 : 65535;
            values.push(value);
        }
        return values;
    };
    const nodes = gltf.nodes.map(n => {
        assert.ok(!n.matrix);
        const node = new Node(); node.name = n.name || '';
        node.position.set(...(n.translation || [0, 0, 0]));
        node.rotation.set(...(n.rotation || [0, 0, 0, 1]));
        node.scale.set(...(n.scale || [1, 1, 1]));
        return node;
    });
    gltf.nodes.forEach((n, i) => (n.children || []).forEach(j => { nodes[j].parent = nodes[i]; nodes[i].children.push(nodes[j]); }));
    const wrapper = new Node(); wrapper.name = '模型';
    nodes.filter(n => !n.parent).forEach(n => { n.parent = wrapper; wrapper.children.push(n); });
    const byName = Object.fromEntries(nodes.map(n => [n.name, n]));
    const body = byName.Armature || byName.Root.parent;
    const renderers = gltf.nodes.filter(n => n.skin !== undefined).map(n => {
        const skin = gltf.skins[n.skin], matrices = accessor(skin.inverseBindMatrices);
        function relativePath(node) { return node.parent === wrapper ? node.name : relativePath(node.parent) + '/' + node.name; }
        const primitives = gltf.meshes[n.mesh].primitives;
        return { skinningRoot: wrapper, skeleton: {
            joints: skin.joints.map(i => relativePath(nodes[i])),
            bindposes: skin.joints.map((_, i) => new Mat4(...matrices.slice(i * 16, i * 16 + 16))),
        }, mesh: { struct: { primitives }, readAttribute: (p, name) => primitives[p].attributes[name] === undefined ? null : accessor(primitives[p].attributes[name]) } };
    });
    // 与运行时一致，绑定时处于游泳方向，随后切换为领奖直立方向。
    wrapper.setRotationFromEuler(90, 90, 0);
    const pose = new FreestylePoseController(); pose.bind(body); pose.captureBasePose();
    const soles = new StandingSoleContact(); soles.bind(wrapper, renderers);
    const hands = new CharacterHandContact(); hands.bind(wrapper, renderers); pose.setDiveHandContact(hands);
    wrapper.setRotationFromEuler(0, 90, 0);
    const variant = SWIMMER_MODEL_VARIANTS.find(v => v.candidates.some(p => p.toLowerCase().includes(file.slice(0, -4).toLowerCase())));
    const scale = 1.35 * (variant?.modelScaleMultiplier || 1);
    wrapper.scale.set(scale, scale, scale);
    // 独立保留全部足部顶点，验证压缩成 16 点后没有漏掉更低的真实鞋底。
    const fullFeet = [[], []];
    const fullHead = [];
    const fullHands = [[], []];
    const fullArms = [[], []];
    for (const renderer of renderers) {
        const bones = renderer.skeleton.joints.map(p => wrapper.getChildByPath(p));
        for (let p = 0; p < renderer.mesh.struct.primitives.length; p++) {
            const pos = renderer.mesh.readAttribute(p, 'POSITION');
            const joints = renderer.mesh.readAttribute(p, 'JOINTS_0');
            const weights = renderer.mesh.readAttribute(p, 'WEIGHTS_0');
            for (let v = 0; v < pos.length / 3; v++) {
                let left = 0, right = 0, head = 0, leftHand = 0, rightHand = 0, leftArm = 0, rightArm = 0;
                const influences = [];
                for (let k = 0; k < 4; k++) {
                    const j = joints[v * 4 + k], w = weights[v * 4 + k], bone = bones[j];
                    if (!w || !bone) continue;
                    if (/^L_(Foot|Toe)/.test(bone.name)) left += w;
                    if (/^R_(Foot|Toe)/.test(bone.name)) right += w;
                    if (bone.name === 'Head') head += w;
                    if (/^L_Hand/.test(bone.name)) leftHand += w;
                    if (/^R_Hand/.test(bone.name)) rightHand += w;
                    if (/^L_(Upperarm|Forearm|Hand)/.test(bone.name)) leftArm += w;
                    if (/^R_(Upperarm|Forearm|Hand)/.test(bone.name)) rightArm += w;
                    influences.push({ bone, bind: renderer.skeleton.bindposes[j], weight: w });
                }
                if (Math.max(left, right) >= 0.5) fullFeet[left >= right ? 0 : 1].push({ point: new Vec3(...pos.slice(v * 3, v * 3 + 3)), influences });
                if (head >= 0.5) fullHead.push({ point: new Vec3(...pos.slice(v * 3, v * 3 + 3)), influences });
                if (Math.max(leftHand, rightHand) >= 0.5) fullHands[leftHand >= rightHand ? 0 : 1].push({ point: new Vec3(...pos.slice(v * 3, v * 3 + 3)), influences });
                if (Math.max(leftArm, rightArm) >= 0.5) fullArms[leftArm >= rightArm ? 0 : 1].push({ point: new Vec3(...pos.slice(v * 3, v * 3 + 3)), influences });
            }
        }
    }
    function exactY(side, plane = null, contact = null, region = null) {
        const matrices = new Map(), point = new Vec3();
        let y = Infinity;
        const middleZ = region === null ? 0 : (Math.min(...fullFeet[side].map(v => v.point.z))
            + Math.max(...fullFeet[side].map(v => v.point.z))) * 0.5;
        for (const vertex of fullFeet[side]) {
            if (region === 'heel' && vertex.point.z > middleZ) continue;
            if (region === 'forefoot' && vertex.point.z <= middleZ) continue;
            let weightedY = 0, weight = 0, x = 0, wy = 0, z = 0;
            for (const influence of vertex.influences) {
                if (!matrices.has(influence.bone)) matrices.set(influence.bone, Mat4.multiply(new Mat4(), influence.bone.worldMatrix, influence.bind));
                Vec3.transformMat4(point, vertex.point, matrices.get(influence.bone));
                x += point.x * influence.weight; wy += point.y * influence.weight; z += point.z * influence.weight;
                weightedY += (plane ? (plane.nx * point.x + plane.ny * point.y + plane.nz * point.z - plane.distance) / plane.ny : point.y) * influence.weight; weight += influence.weight;
            }
            const value = weightedY / weight;
            if (value < y) {
                y = value;
                if (contact) contact.set(x / weight, wy / weight, z / weight);
            }
        }
        return y;
    }
    function exactHandBounds(side, belowY = Infinity, wholeArm = false, aboveY = -Infinity) {
        const min = new Vec3(Infinity, Infinity, Infinity), max = new Vec3(-Infinity, -Infinity, -Infinity);
        const matrices = new Map(), point = new Vec3(), world = new Vec3(), center = new Vec3();
        let count = 0;
        for (const vertex of (wholeArm ? fullArms : fullHands)[side]) {
            world.set(0, 0, 0); let weight = 0;
            for (const influence of vertex.influences) {
                if (!matrices.has(influence.bone)) matrices.set(influence.bone, Mat4.multiply(new Mat4(), influence.bone.worldMatrix, influence.bind));
                Vec3.transformMat4(point, vertex.point, matrices.get(influence.bone));
                Vec3.scaleAndAdd(world, world, point, influence.weight); weight += influence.weight;
            }
            Vec3.multiplyScalar(world, world, 1 / weight);
            if (world.y > belowY || world.y < aboveY) continue;
            Vec3.min(min, min, world); Vec3.max(max, max, world); Vec3.add(center, center, world);
            count++;
        }
        if (count) Vec3.multiplyScalar(center, center, 1 / count);
        return { min, max, center };
    }
    return { pose, soles, hands, wrapper, variant, exactY, renderers, fullHead, exactHandBounds };
}

module.exports = { ...harness, createRig };
