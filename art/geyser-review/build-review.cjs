// 从真实表现层采样网格和节点变换；仅生成独立审查页，不启动 Creator。
const fs = require('node:fs'), path = require('node:path');
const { createGeyserPresentationHarness } = require('../../tests/helpers/geyser-presentation-harness.cjs');
const root = path.resolve(__dirname, '../..');
const h = createGeyserPresentationHarness(10);
const single = [{ id: 0, x: 0, z: 0, offsetSeconds: 0 }];
const { selectGeyserLargeMask } = h.load(path.join(root, 'assets/scripts/core/GeyserBrawlSafety.ts'));
const base = h.rules.planGeyserVents(42, 1, 5, 0, 0, 25, 10.5);
const mask = selectGeyserLargeMask(42, 1, 5, base, 10.5, [], [], h.rules.GEYSER_TUNING).mask;
const dense = h.rules.applyGeyserSizes(base, mask, true);
const comparison = h.rules.applyGeyserSizes([
    { id: 0, x: -2.6, z: 0, offsetSeconds: 0 },
    { id: 1, x: 2.6, z: 0, offsetSeconds: 0 }], 2, true);
const data = { meshes: h.meshes.map(m => m.geometry), sequences: {}, budget: h.budget() };
for (const [key, vents, length] of [['single', single, 3.5], ['comparison', comparison, 3.8], ['dense', dense, 15.3]]) {
    h.visual.hide();
    const frames = [];
    for (let step = 0; step <= length * 30; step++) {
        h.visual.update(vents, step / 30, key === 'dense' ? 3 : 1);
        frames.push(h.snapshot());
    }
    data.sequences[key] = frames;
}
data.peakRenderers = Math.max(...data.sequences.dense.map(frame => frame.length));
// 简化身体只用于受力方向审查；曲线直接采样正式实现，不冒充角色实机画面。
const { createGeyserReaction, sampleGeyserReaction } = h.load(path.join(root, 'assets/scripts/swimmer/GeyserReactionModel.ts'));
const { sampleForcedLaunch } = h.load(path.join(root, 'assets/scripts/swimmer/ForcedLaunchModel.ts'));
function box(x0,x1,y0,y1,z0,z1,color) {
    const positions=[x0,y0,z0,x1,y0,z0,x1,y1,z0,x0,y1,z0,x0,y0,z1,x1,y0,z1,x1,y1,z1,x0,y1,z1];
    return {positions,colors:Array.from({length:8},()=>color).flat(),indices:[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5]};
}
const bodyMeshes=[box(.35,.78,-.12,.12,-.17,.17,[.95,.68,.4,1]),
    box(-.25,.35,-.12,.12,-.2,.2,[.95,.86,.2,1]),box(-1.05,-.25,-.1,.1,-.15,.15,[.16,.35,.68,1])];
const bodyOffset=data.meshes.length;data.meshes.push(...bodyMeshes);
data.reactions={};
for(const [key,along,side,strength] of [['head',.75,0,2],['middle',0,0,2],['legs',-.85,0,2],['left',0,-.2,2],['right',0,.2,2],['graze',.8,.2,1]]) {
    const contact={strength,along,side,up:0,coverage:.5,time:1.72,region:0};
    const reaction=createGeyserReaction(1001,strength,strength===1?.25:1,0,0,0,0,contact);
    const launch={distance:-along,lateral:-side,y:0,surfaceY:0,speed:.35,heading:0,duration:1,peakHeight:1.05,entryScale:.75,exitScale:.6};
    const frames=[],samples=[], pose={pitch:0,roll:0,weight:0,forward:0,side:0}, flight={};
    h.visual.hide();
    for(let frame=0;frame<=105;frame++) {
        const time=frame/30, age=Math.max(0,time-contact.time);
        h.visual.update(single,time,1);
        sampleGeyserReaction(reaction,age,pose);
        sampleForcedLaunch(launch,age,flight);
        const pitch=time>=contact.time?pose.pitch*pose.weight:0, roll=time>=contact.time?pose.roll*pose.weight:0;
        const cp=Math.cos(pitch),sp=Math.sin(pitch),cr=Math.cos(roll),sr=Math.sin(roll);
        const matrix=[cp,sp,0,0,-sp*cr,cp*cr,sr,0,sp*sr,-cp*sr,cr,0,
            strength===2?flight.distance:-along,strength===2?flight.y:0,-side,1];
        frames.push([...h.snapshot(),...bodyMeshes.map((_,i)=>({name:'BodyProxy',mesh:bodyOffset+i,matrix}))]);
        samples.push({time,pitchDegrees:pitch*180/Math.PI,rollDegrees:roll*180/Math.PI,height:matrix[13]});
    }
    data.sequences[key]=frames;data.reactions[key]=samples;
}
// 复用项目现有独立 WebGL 审查器，避免另写一套与引擎几何无关的效果。
const reference = fs.readFileSync(path.join(root, 'art/water-splash-b2/review-template.html'), 'utf8');
const renderer = reference.slice(reference.indexOf('const $=id=>'), reference.indexOf('const drawMain='))
    .replaceAll('DATA[version].meshes', 'DATA.meshes');
const output = path.join(root, '.cache/geyser-review');
fs.mkdirSync(output, { recursive: true });
// 将已提交版本作为同机位对照；仅读取 Git，不替换工作区源码。
const { execFileSync } = require('node:child_process');
const baselinePath=path.join(output,'BaselineGeyser.ts');
fs.writeFileSync(baselinePath,execFileSync('git',['show','HEAD:assets/scripts/core/GeyserBrawlPresentation.ts'],{cwd:root}));
const baseline=createGeyserPresentationHarness(1,.055,baselinePath), baselineOffset=data.meshes.length;
data.meshes.push(...baseline.meshes.map(m=>m.geometry));data.sequences.baseline=[];
for(let step=0;step<=105;step++){
    baseline.visual.update(single,step/30,1);
    data.sequences.baseline.push(baseline.snapshot().map(n=>({...n,mesh:n.mesh+baselineOffset})));
}
const html = fs.readFileSync(path.join(__dirname, 'review-template.html'), 'utf8')
    .replace('/*__DATA__*/', JSON.stringify(data)).replace('/*__RENDERER__*/', renderer);
fs.writeFileSync(path.join(output, 'review.html'), html);
fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify({ ...data.budget, peakRenderers: data.peakRenderers }, null, 2));
fs.writeFileSync(path.join(output, 'reaction-samples.json'), JSON.stringify(data.reactions,null,2));
console.log(JSON.stringify({ output, ...data.budget, peakRenderers: data.peakRenderers }));
