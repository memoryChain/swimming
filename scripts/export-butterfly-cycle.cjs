// 导出运行时真实骨骼的连续周期，保留模型网格/材质，输出只在 .cache。
const fs = require('node:fs');
const path = require('node:path');
const { createRig, root, load } = require('../tests/helpers/character-contact-harness.cjs');
const interactive = process.argv.includes('--buoyancy');
const { SwimmerMotor } = load(path.join(root, 'assets/scripts/swimmer/SwimmerMotor.ts'));
const { StrokeType } = load(path.join(root, 'assets/scripts/core/GameConstants.ts'));
const out = path.join(root, interactive ? '.cache/butterfly-buoyancy' : '.cache/butterfly-cycle');
fs.mkdirSync(out, { recursive: true });
const frames = 64;
const scenarios = interactive ? [ ['early',.22], ['perfect',.39], ['late',.56], ['kick',.39], ['timeout',2] ] : [['cycle',2]];
for (const file of (interactive ? ['CartonSwimmer5.glb','CartonSwimmer13.glb'] : ['MuscleMan.glb', 'CartonSwimmer13.glb'])) for (const [scenario, release] of scenarios) {
    const rig = createRig(file); rig.wrapper.setRotationFromEuler(90, 90, 0);
    const motor = new SwimmerMotor();motor.enableButterflyTest(true);motor.startRace();motor.beginButterfly();
    const seconds = motor.butterfly.duration;
    const raw = fs.readFileSync(path.join(root, 'assets/race/models', file));
    const size = raw.readUInt32LE(12);
    const gltf = JSON.parse(raw.subarray(20, 20 + size));
    const parts = [raw.subarray(28 + size)];
    let length = parts[0].length;
    const access = (values, type, extrema) => {
        const data = Buffer.alloc(values.length * 4);
        values.forEach((v, i) => data.writeFloatLE(v, i * 4));
        const view = gltf.bufferViews.length;
        gltf.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: data.length });
        parts.push(data); length += data.length;
        const index = gltf.accessors.length;
        gltf.accessors.push({ bufferView: view, componentType: 5126, count: values.length / ({SCALAR:1,VEC3:3,VEC4:4}[type]), type, ...extrema });
        return index;
    };
    const nodes = new Map();
    const visit = n => { nodes.set(n.name, n); n.children.forEach(visit); }; visit(rig.wrapper);
    const tracks = gltf.nodes.map((n, index) => ({ node: nodes.get(n.name), index, rotations: [], positions: [] })).filter(t => t.node);
    for (let f = 0; f < frames; f++) {
        if (f > 0) motor.update(seconds/(frames-1), {isAI:false});
        if (motor.butterfly.held && motor.butterfly.progress >= release) motor.releaseButterfly();
        if (scenario === 'kick' && [32,39,46].includes(f)) motor.recordKickTap(StrokeType.LEFT);
        rig.pose.restoreBasePose();
        rig.pose.applyButterflyPose(f / (frames - 1),1,interactive ? motor.butterflyKickCycle : 0,
            interactive ? motor.butterfly.buoyancy : undefined);
        for (const t of tracks) {
            const q = t.node.rotation, a = t.rotations, k = a.length;
            const sign = k && a[k-4]*q.x+a[k-3]*q.y+a[k-2]*q.z+a[k-1]*q.w < 0 ? -1 : 1;
            a.push(q.x*sign,q.y*sign,q.z*sign,q.w*sign);
            const p = t.node.position; t.positions.push(p.x,p.y,p.z);
        }
    }
    const animation = { name: 'ButterflyCycle', samplers: [], channels: [] };
    const input = access(Array.from({length:frames}, (_, i) => i * seconds / (frames - 1)), 'SCALAR', {min:[0],max:[seconds]});
    for (const t of tracks) {
        for (const [key, type, values] of [['rotation','VEC4',t.rotations],['translation','VEC3',t.positions]]) {
            animation.channels.push({sampler:animation.samplers.length,target:{node:t.index,path:key}});
            animation.samplers.push({input,output:access(values,type),interpolation:'LINEAR'});
        }
    }
    gltf.animations = [animation]; gltf.buffers[0].byteLength = length;
    const scene = gltf.scenes[gltf.scene || 0], w = rig.wrapper;
    const index = gltf.nodes.length;
    gltf.nodes.push({name:'ButterflyPreview',children:scene.nodes,rotation:[w.rotation.x,w.rotation.y,w.rotation.z,w.rotation.w],scale:[w.scale.x,w.scale.y,w.scale.z]});
    scene.nodes = [index];
    const json = Buffer.from(JSON.stringify(gltf)), padded = Buffer.alloc(Math.ceil(json.length/4)*4,0x20);json.copy(padded);
    const h = Buffer.alloc(20);h.writeUInt32LE(0x46546c67,0);h.writeUInt32LE(2,4);h.writeUInt32LE(28+padded.length+length,8);h.writeUInt32LE(padded.length,12);h.writeUInt32LE(0x4e4f534a,16);
    const b = Buffer.alloc(8);b.writeUInt32LE(length,0);b.writeUInt32LE(0x004e4942,4);
    const name = interactive ? file.replace('.glb',`-${scenario}.glb`) : file;
    fs.writeFileSync(path.join(out,name),Buffer.concat([h,padded,b,...parts]));
    console.log(`${name}：${frames}帧，${seconds}秒，连续骨骼和升沉轨迹已导出`);
}
