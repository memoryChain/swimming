// 导出实际运行时骨骼求解后的离线样片，不修改模型源文件或运行时资源。
// npx --yes --package typescript@5.4.5 -c "node scripts/export-butterfly-preview.cjs"
const fs = require('node:fs');
const path = require('node:path');
const { createRig, root } = require('../tests/helpers/character-contact-harness.cjs');
const out = path.join(root, '.cache/butterfly-preview');
fs.mkdirSync(out, { recursive: true });
const phases = [0, .25, .45, .73, .92];
const files = ['MuscleMan.glb', 'CartonSwimmer13.glb'];
const manifest = [];
for (let row = 0; row < files.length; row++) {
    const file = files[row], rig = createRig(file);
    rig.wrapper.setRotationFromEuler(90,90,0);
    const raw = fs.readFileSync(path.join(root, 'assets/race/models', file));
    const jsonSize = raw.readUInt32LE(12);
    const original = JSON.parse(raw.subarray(20,20+jsonSize).toString('utf8'));
    const binary = raw.subarray(28+jsonSize);
    const nodes = new Map();
    const visit = n => { nodes.set(n.name,n); n.children.forEach(visit); };
    visit(rig.wrapper);
    for(let col=0;col<phases.length;col++) {
        rig.pose.restoreBasePose();
        rig.pose.applyButterflyPose(phases[col]);
        const gltf = structuredClone(original);
        delete gltf.animations;
        for(const n of gltf.nodes) {
            const posed=nodes.get(n.name); if(!posed) continue;
            n.translation=[posed.position.x,posed.position.y,posed.position.z];
            n.rotation=[posed.rotation.x,posed.rotation.y,posed.rotation.z,posed.rotation.w];
            n.scale=[posed.scale.x,posed.scale.y,posed.scale.z];
        }
        const wrapper=rig.wrapper;
        const scene=gltf.scenes[gltf.scene||0];
        const index=gltf.nodes.length;
        gltf.nodes.push({name:'ButterflyPreview',children:scene.nodes,
            rotation:[wrapper.rotation.x,wrapper.rotation.y,wrapper.rotation.z,wrapper.rotation.w],
            scale:[wrapper.scale.x,wrapper.scale.y,wrapper.scale.z]});
        scene.nodes=[index];
        const json=Buffer.from(JSON.stringify(gltf));
        const padded=Buffer.alloc(Math.ceil(json.length/4)*4,0x20); json.copy(padded);
        const header=Buffer.alloc(20); header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);
        header.writeUInt32LE(28+padded.length+binary.length,8);header.writeUInt32LE(padded.length,12);header.writeUInt32LE(0x4e4f534a,16);
        const bh=Buffer.alloc(8);bh.writeUInt32LE(binary.length,0);bh.writeUInt32LE(0x004e4942,4);
        const name=`${row}-${col}.glb`;
        fs.writeFileSync(path.join(out,name),Buffer.concat([header,padded,bh,binary]));
        manifest.push({file:name,row,col,phase:phases[col],model:file});
    }
}
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
console.log('已导出 '+manifest.length+' 个实际骨骼姿态到 .cache/butterfly-preview');
