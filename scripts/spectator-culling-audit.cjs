// 离线预测：与 Creator 3.8.8 的 aabbPlane/aabbFrustum 同样用六平面排除 AABB。
// 统计单相机、单 pass 的候选批次和三角形，不预测 GPU 时间或 FPS。
const assert = require('node:assert/strict');
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const add = (a, b) => a.map((x, i) => x + b[i]);
const scale = (a, k) => a.map(x => x * k);
const sub = (a, b) => add(a, scale(b, -1));
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const normalize = a => scale(a, 1 / Math.hypot(...a));
function planes(camera) {
    const f = normalize(sub(camera.target, camera.eye));
    const r = normalize(cross(f, Math.abs(f[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0]));
    const up = cross(r, f);
    const y = Math.tan(camera.fov * Math.PI / 360), x = y * camera.aspect;
    return [add(scale(f,x),r), sub(scale(f,x),r), add(scale(f,y),up), sub(scale(f,y),up)]
        .map(n => ({n, d: dot(n, camera.eye)}))
        .concat([{n:f, d:dot(f,camera.eye)+0.1}, {n:scale(f,-1), d:-dot(f,camera.eye)-200}]);
}
function visible(g, frustum) {
    // 覆盖两个动作父节点的整段振幅；因此这里比任一真实动画时刻更保守。
    const center = ['x','y','z'].map(k => (g.minPos[k]+g.maxPos[k])/2);
    const half = ['x','y','z'].map((k,i) => (g.maxPos[k]-g.minPos[k])/2+[0.003,0.016,0][i]);
    return frustum.every(p => dot(p.n,center)+dot(p.n.map(Math.abs),half) >= p.d);
}
module.exports = function auditCulling(current, buckets) {
    const colors = current.SPECTATOR_COLORS;
    const legacy = buckets.map((b,i) => current.buildSpectatorGeometry(b,colors[i%5]));
    const configs = [{name:'颜色动作15组', groups:buckets.map(spectators=>({spectators})), geometry:legacy}];
    for (const count of [4,6,8]) {
        const groups = current.partitionSpectators(buckets,count);
        const flattened = groups.flatMap(g=>g.spectators);
        assert.equal(flattened.length,buckets.flat().length);
        assert.equal(new Set(flattened).size,flattened.length,'分区不能重复或遗漏观众');
        for (const s of buckets.flat()) assert(flattened.includes(s));
        const geometry = groups.map(g=>current.buildSpectatorGeometry(g.spectators,colors[0]));
        assert.equal(geometry.reduce((n,g)=>n+g.indices.length,0),legacy.reduce((n,g)=>n+g.indices.length,0));
        configs.push({name:`${count}区`,groups,geometry});
    }
    assert.deepEqual(current.partitionSpectators([]),[]);
    const views = [
        ['起点正向',[8,1.2,-2],[28,1.4,1]],
        ['中段正向',[25,1.2,-2],[45,1.4,1]],
        ['远端反向',[42,1.2,-2],[22,1.4,1]],
        ['中段反向',[25,1.2,-2],[5,1.4,1]],
        ['看台侧视',[25,1.2,0],[25,2,20]],
        ['俯视全馆',[25,60,0],[25,0,0]],
    ].map(([name,eye,target])=>({name,eye,target,fov:64,aspect:16/9}));
    const rows = [];
    for (const camera of views) {
        const frustum = planes(camera);
        const row = {view:camera.name,eye:camera.eye,target:camera.target,verticalFov:camera.fov,aspect:camera.aspect};
        for (const config of configs) {
            const submitted = config.geometry.filter(g=>visible(g,frustum));
            row[config.name] = {draws:submitted.length,triangles:submitted.reduce((sum,g)=>sum+g.indices.length/3,0)};
        }
        rows.push(row);
    }
    // 相机横向环绕和边界视角：任一单人 AABB 可见时，所属区域不得被排除。
    const selected = configs.find(c=>c.name==='6区');
    const groups = selected.groups, geometry = selected.geometry;
    const individuals = groups.map(g=>g.spectators.map(s=>current.buildSpectatorGeometry([s],colors[0])));
    for (let angle = 0; angle < 360; angle += 10) {
        const rad=angle*Math.PI/180;
        for (const aspect of [16/9,9/16]) {
            const frustum=planes({eye:[25,1.2,0],target:[25+Math.cos(rad)*20,1.4,Math.sin(rad)*20],fov:64,aspect});
            for (let i=0;i<groups.length;i++) if (!visible(geometry[i],frustum)) {
                assert(individuals[i].every(g=>!visible(g,frustum)),'区域包围盒漏掉可见观众');
            }
        }
    }
    return {assumption:'六平面 AABB 保守预测，单相机单 pass；未计入遮挡、渲染层或真机耗时',
        totalGroups:configs.map(c=>({name:c.name,groups:c.geometry.length})),views:rows,boundaryChecks:72};
};
