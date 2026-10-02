// 输出真实运行时骨骼；源模型、材质、蒙皮与正式资源均不修改。
const fs = require('node:fs');
const path = require('node:path');
const { createRig, load, root } = require('../tests/helpers/character-contact-harness.cjs');
const { FreestyleBreathingMotion } = load(path.join(root, 'assets/scripts/character/FreestyleBreathingMotion.ts'));
const { MOTION_TUNING } = load(path.join(root, 'assets/scripts/core/InputTuning.ts'));
const { AXIAL_ROLL_TUNING } = load(path.join(root, 'assets/scripts/core/AxialRollTuning.ts'));
const saved = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/tuning.json'), 'utf8')).values;
for (const [key, value] of Object.entries(saved)) {
    if (key.startsWith('motion.') && key.slice(7) in MOTION_TUNING) MOTION_TUNING[key.slice(7)] = value;
    if (key.startsWith('axialRoll.') && key.slice(10) in AXIAL_ROLL_TUNING) AXIAL_ROLL_TUNING[key.slice(10)] = value;
}
const out = path.join(root, '.cache/freestyle-breathing-preview');
fs.mkdirSync(out, { recursive: true });
const phases = [0.50, 0.64, 0.74, 0.88, 0.98], manifest = [];
for (const [modelIndex, file] of ['MuscleMan.glb', 'CartonSwimmer13.glb'].entries()) {
    const rig = createRig(file), nodes = new Map();
    rig.wrapper.setRotationFromEuler(90, 90, 0);
    rig.pose.setSwimHeadLift(rig.variant?.swimHeadLiftDegrees);
    const visit = n => { nodes.set(n.name, n); n.children.forEach(visit); }; visit(rig.wrapper);
    const raw = fs.readFileSync(path.join(root, 'assets/race/models', file)), jsonSize = raw.readUInt32LE(12);
    const original = JSON.parse(raw.subarray(20, 20 + jsonSize)), binary = raw.subarray(28 + jsonSize);
    for (let breathing = 0; breathing <= 1; breathing++) {
        const motion = new FreestyleBreathingMotion();
        let frame = 0;
        for (const [col, phase] of phases.entries()) {
            let weight = 0;
            for (; frame <= Math.round((1 + phase) * 600); frame++) {
                const cycle = frame / 600 * Math.PI * 2;
                weight = motion.update(1 / 600, cycle, cycle, true);
            }
            rig.pose.setBreathingTestWeight(breathing ? weight : 0, breathing ? motion.headWeight : 0);
            rig.pose.applyFreestylePose((phase - 0.5) * Math.PI * 2, phase * Math.PI * 2, 0, Math.PI, 0, 1, 1, 1);
            const gltf = structuredClone(original); delete gltf.animations;
            for (const n of gltf.nodes) {
                const posed = nodes.get(n.name); if (!posed) continue;
                n.translation = [posed.position.x, posed.position.y, posed.position.z];
                n.rotation = [posed.rotation.x, posed.rotation.y, posed.rotation.z, posed.rotation.w];
                n.scale = [posed.scale.x, posed.scale.y, posed.scale.z];
            }
            const w = rig.wrapper, scene = gltf.scenes[gltf.scene || 0], index = gltf.nodes.length;
            gltf.nodes.push({ name: 'BreathingPreview', children: scene.nodes,
                rotation: [w.rotation.x, w.rotation.y, w.rotation.z, w.rotation.w], scale: [w.scale.x, w.scale.y, w.scale.z] });
            scene.nodes = [index];
            const json = Buffer.from(JSON.stringify(gltf)), padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20); json.copy(padded);
            const header = Buffer.alloc(20), bh = Buffer.alloc(8);
            header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + padded.length + binary.length, 8);
            header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
            bh.writeUInt32LE(binary.length, 0); bh.writeUInt32LE(0x004e4942, 4);
            const row = modelIndex * 2 + breathing, name = `${row}-${col}.glb`;
            fs.writeFileSync(path.join(out, name), Buffer.concat([header, padded, bh, binary]));
            manifest.push({ file: name, row, col, phase, weight: breathing ? weight : 0, model: file });
        }
    }
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('已导出 20 个真实角色姿态；每个角色的上行为普通划水，下行为换气划水。');
