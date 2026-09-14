// 验证独立圆环的闭合、有限几何和固定预算，避免退化为圆周散点。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
test('圆环独立于光点，闭合且共用固定网格',()=>{
    const source=fs.readFileSync('assets/scripts/character/DiveChargeGatherEffect.ts','utf8');
    const module={exports:{}};
    const cc={Color:class {},Vec3:{RIGHT:{x:1,y:0,z:0},UP:{x:0,y:1,z:0}}};
    const js=ts.transpileModule(source+'\nexport const inspectGeometry = buildGatherGeometry;',
        {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
    vm.runInNewContext(js,{module,exports:module.exports,require:p=>p==='cc'?cc:{}});
    const mesh=module.exports.inspectGeometry();
    assert.equal(mesh.positions.length/3,920);
    assert.equal(mesh.indices.length/3,460);
    assert.ok(mesh.positions.every(Number.isFinite));
    assert.ok(mesh.indices.every(i=>i>=0&&i<920));
    const first=152*3,last=(152+63*4+2)*3;
    for(let i=0;i<6;i++)assert.ok(Math.abs(mesh.positions[first+i]-mesh.positions[last+i])<1e-12);
    for(let i=152;i<920;i++)assert.equal(mesh.colors[i*4+2],1);
    for(let i=0;i<152;i++)assert.equal(mesh.colors[i*4+2],0);
    for(let i=152;i<408;i++)assert.equal(mesh.colors[i*4+3],0);
    for(let i=408;i<664;i++)assert.equal(mesh.colors[i*4+3],0.5);
    for(let i=664;i<920;i++)assert.equal(mesh.colors[i*4+3],0.75);
    const secondStart=408*3,secondEnd=(408+63*4+2)*3;
    for(let i=0;i<6;i++)assert.ok(Math.abs(mesh.positions[secondStart+i]-mesh.positions[secondEnd+i])<1e-12);
});

test('圆环计时仅在新蓄力开始时重置，重复激活不重播',()=>{
    const module={exports:{}};
    const clock={cumulativeTime:10};
    const cc={Color:class {},director:{root:clock}};
    const js=ts.transpileModule(fs.readFileSync('assets/scripts/character/DiveChargeGatherEffect.ts','utf8'),
        {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
    vm.runInNewContext(js,{module,exports:module.exports,require:p=>p==='cc'?cc:{}});
    const effect=Object.create(module.exports.DiveChargeGatherEffect.prototype);
    effect._requestedActive=false;effect._params={y:0};effect.syncVisibility=()=>{};
    effect.setActive(true);assert.equal(effect._params.y,10);
    clock.cumulativeTime=15;effect.setActive(true);assert.equal(effect._params.y,10);
    effect.setActive(false);effect.setActive(true);assert.equal(effect._params.y,15);
});
