// 用真实玩家／AI输入驱动蒙皮，导出正常速度的基础转体对照；资源只写入 .cache。
const fs = require('node:fs');
const path = require('node:path');
const before = process.argv.includes('--before');
const baselineRef = process.argv.find(arg => arg.startsWith('--baseline-ref='))?.slice('--baseline-ref='.length);
if (baselineRef) {
    if (before) throw new Error('历史转体对照不能同时关闭转体');
    // 使用同一组输入，成对载入该提交的骨骼求解及转体时序，避免跨版本叠加。
    const sources = new Map(['FreestyleBodyRollMotion.ts','FreestylePoseController.ts'].map(name => [name,
        require('node:child_process').execFileSync('git',
            ['show', `${baselineRef}:assets/scripts/character/${name}`], {cwd:path.resolve(__dirname,'..')})]));
    const read = fs.readFileSync;
    fs.readFileSync = function(file, options) {
        const source = sources.get(path.basename(String(file)));
        if (source && String(file).replaceAll('\\','/').includes('/character/'))
            return typeof options === 'string' || options?.encoding ? source.toString(typeof options === 'string' ? options : options.encoding) : source;
        return read.call(this,file,options);
    };
}
const { createRig, Node, root, load } = require('../tests/helpers/character-contact-harness.cjs');
const { FreestyleBodyRollMotion } = load(path.join(root, 'assets/scripts/character/FreestyleBodyRollMotion.ts'));
const { MOTION_TUNING } = load(path.join(root, 'assets/scripts/core/InputTuning.ts'));
const { AXIAL_ROLL_TUNING } = load(path.join(root, 'assets/scripts/core/AxialRollTuning.ts'));
const saved = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/tuning.json'), 'utf8')).values;
for (const [key, value] of Object.entries(saved)) {
    if (key.startsWith('motion.') && key.slice(7) in MOTION_TUNING) MOTION_TUNING[key.slice(7)] = value;
    if (key.startsWith('axialRoll.') && key.slice(10) in AXIAL_ROLL_TUNING) AXIAL_ROLL_TUNING[key.slice(10)] = value;
}
const mode = process.argv.includes('--ai') ? 'ai' : 'player';
const out = path.join(root, `.cache/freestyle-body-roll-runtime-${mode}${baselineRef ? '-previous' : before ? '-before' : ''}`);
fs.mkdirSync(out, { recursive: true });
const trace = require('../tests/helpers/freestyle-breathing-replay.cjs').replayBreathingInput({mode,fps:30,seconds:7});
// 选固定窗口，前后版本采用相同输入与时间，不放慢动画来延长换气。
const seconds = 4, frames = 121, firstFrame = 60;
for (const file of ['MuscleMan.glb', 'CartonSwimmer13.glb']) {
    const rig = createRig(file); rig.wrapper.setRotationFromEuler(90, 90, 0);
    const presentationRoot = new Node();
    rig.wrapper.parent = presentationRoot; presentationRoot.children.push(rig.wrapper);
    rig.pose.setSwimHeadLift(rig.variant?.swimHeadLiftDegrees);
    const raw = fs.readFileSync(path.join(root, 'assets/race/models', file)), size = raw.readUInt32LE(12);
    const gltf = JSON.parse(raw.subarray(20, 20 + size)), parts = [raw.subarray(28 + size)];
    let length = parts[0].length;
    const nodes = new Map();
    const visit = n => { nodes.set(n.name, n); n.children.forEach(visit); }; visit(rig.wrapper);
    const tracks = gltf.nodes.map((n, index) => ({ node: nodes.get(n.name), index, rotations: [], positions: [] })).filter(t => t.node);
    tracks.push({node:presentationRoot,index:gltf.nodes.length+1,rotations:[],positions:[]});
    const motion = new FreestyleBodyRollMotion();
    for (let f = 0; f < firstFrame + frames; f++) {
        const sample = trace[Math.min(f, trace.length-1)];
        presentationRoot.rotation.set(...sample.rotation);
        const projection = Math.cos(sample.roll) * Math.cos(sample.pitch);
        motion.update(sample.dt,sample.left,sample.right,sample.surface,projection,sample.pitch,sample.rollSpeed,sample.pitchSpeed);
        rig.pose.setMovementHeadingRadians(sample.heading);
        rig.pose.setMovementPitchRadians(sample.pitch);
        rig.pose.setSurfaceBodyUpProjection(projection);
        rig.pose.setBodyRollTestPose(before ? -1 : motion.weight,motion.roll);
        const drive = Math.max(.85,Math.min(1.45,.9+sample.speed*.16));
        rig.pose.applyFreestylePose(sample.left,sample.right,sample.leftKick,sample.rightKick,sample.bodyPhase,drive,drive,drive);
        if(f < firstFrame)continue;
        for (const t of tracks) {
            const q = t.node.rotation, a = t.rotations, k = a.length;
            const sign = k && a[k-4]*q.x+a[k-3]*q.y+a[k-2]*q.z+a[k-1]*q.w < 0 ? -1 : 1;
            a.push(q.x*sign,q.y*sign,q.z*sign,q.w*sign);
            const p = t.node.position; t.positions.push(p.x,p.y,p.z);
        }
    }
    const access = (values, type, extrema = {}) => {
        const data = Buffer.alloc(values.length * 4); values.forEach((v, i) => data.writeFloatLE(v, i * 4));
        const view = gltf.bufferViews.length;
        gltf.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: data.length }); parts.push(data); length += data.length;
        const index = gltf.accessors.length;
        gltf.accessors.push({ bufferView: view, componentType: 5126, count: values.length / ({SCALAR:1,VEC3:3,VEC4:4}[type]), type, ...extrema });
        return index;
    };
    const animation = { name: 'FreestyleBodyRoll', samplers: [], channels: [] };
    const input = access(Array.from({length:frames}, (_, i) => i / 30), 'SCALAR', {min:[0],max:[seconds]});
    for (const t of tracks) for (const [key, type, values] of [['rotation','VEC4',t.rotations],['translation','VEC3',t.positions]]) {
        animation.channels.push({sampler:animation.samplers.length,target:{node:t.index,path:key}});
        animation.samplers.push({input,output:access(values,type),interpolation:'LINEAR'});
    }
    gltf.animations = [animation]; gltf.buffers[0].byteLength = length;
    const scene = gltf.scenes[gltf.scene || 0], w = rig.wrapper, index = gltf.nodes.length;
    gltf.nodes.push({name:'BodyRollPreview',children:scene.nodes,rotation:[w.rotation.x,w.rotation.y,w.rotation.z,w.rotation.w],scale:[w.scale.x,w.scale.y,w.scale.z]});
    gltf.nodes.push({name:'PresentationRoot',children:[index]}); scene.nodes = [index+1];
    const json = Buffer.from(JSON.stringify(gltf)), padded = Buffer.alloc(Math.ceil(json.length/4)*4,0x20);json.copy(padded);
    const h = Buffer.alloc(20);h.writeUInt32LE(0x46546c67,0);h.writeUInt32LE(2,4);h.writeUInt32LE(28+padded.length+length,8);h.writeUInt32LE(padded.length,12);h.writeUInt32LE(0x4e4f534a,16);
    const b = Buffer.alloc(8);b.writeUInt32LE(length,0);b.writeUInt32LE(0x004e4942,4);
    fs.writeFileSync(path.join(out,file),Buffer.concat([h,padded,b,...parts]));
    console.log(`${file}：已导出 ${mode} 真实输入、4秒正常速度${baselineRef ? `上一版转体 ${baselineRef}` : before ? '原游姿' : '转体实验'}`);
}
