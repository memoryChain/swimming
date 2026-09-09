// npx --yes --package typescript@5.4.5 -c "node --test tests/spectator-underwater-visibility.test.cjs"
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const test=require('node:test'), assert=require('node:assert/strict');
let ts;
for(const dir of process.env.PATH.split(path.delimiter)) {
    const p=path.resolve(dir,'../typescript/lib/typescript.js');
    if(fs.existsSync(p)) {ts=require(p);break;}
}
if(!ts) throw Error('请使用固定 TypeScript 5.4.5 命令');
const root=path.resolve(__dirname,'..');
function evaluate(source,globals={}) {
    const m={exports:{}};
    const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
    vm.runInNewContext(js,{module:m,exports:m.exports,...globals});
    return m.exports;
}
const visibility=evaluate(fs.readFileSync(path.join(root,'assets/scripts/venue/SpectatorVisibility.ts'),'utf8'));
const {SPECTATOR_LAYER,setSpectatorCameraUnderwater}=visibility;
function camera() {
    let mask=(1<<30)|(1<<8)|(1<<9)|SPECTATOR_LAYER;
    return {isValid:true,writes:0,get visibility(){return mask;},set visibility(v){mask=v;this.writes++;}};
}
function actualMethod(file,className,methodName) {
    const source=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true);
    const cls=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text===className);
    return cls.members.find(n=>n.name?.getText(source)===methodName).getText(source);
}
test('入水剔除观众层、出水恢复；重复状态不写属性，其他相机和手动开关不受影响',()=>{
    const main=camera(),feed=camera(),otherBits=main.visibility&~SPECTATOR_LAYER;
    const rootNode={active:false};
    for(let i=0;i<100;i++) setSpectatorCameraUnderwater(main,true);
    assert.equal(main.writes,1); assert.equal(main.visibility,otherBits);
    assert(feed.visibility&SPECTATOR_LAYER);
    for(let i=0;i<100;i++) setSpectatorCameraUnderwater(main,false);
    assert.equal(main.writes,2); assert(main.visibility&SPECTATOR_LAYER);
    assert.equal(main.visibility&~SPECTATOR_LAYER,otherBits); assert.equal(rootNode.active,false);
    assert.equal(((1<<9)|(1<<10))&SPECTATOR_LAYER,0,'水下反射层不包含观众');
});
test('实际水下模式入口同帧切换观众层，连续切换可恢复',()=>{
    const method=actualMethod('assets/scripts/venue/WaterRefractionController.ts','WaterRefractionController','setUnderwaterViewActive');
    const {Harness}=evaluate(`export class Harness { ${method} }`,{setSpectatorCameraUnderwater,REBIND_WARMUP_FRAMES:30});
    const h=new Harness();
    Object.assign(h,{_underwaterViewActive:false,_mainCamera:camera(),applyFloorTint:()=>{},
        _poolsideWaterline:{setUnderwaterViewActive:()=>{}},tagLaneFloats:()=>{}});
    for(let i=0;i<50;i++) {
        h.setUnderwaterViewActive(true); assert.equal(h._mainCamera.visibility&SPECTATOR_LAYER,0);
        const writes=h._mainCamera.writes; h.setUnderwaterViewActive(true); assert.equal(h._mainCamera.writes,writes);
        h.setUnderwaterViewActive(false); assert(h._mainCamera.visibility&SPECTATOR_LAYER);
    }
});
test('实际闪光更新在水下立即返回，不读取粒子系统或筛选位置',()=>{
    const method=actualMethod('assets/scripts/venue/SpectatorCameraFlashEmitter.ts','SpectatorCameraFlashEmitter','update');
    const {Harness}=evaluate(`export class Harness { ${method} }`,{SPECTATOR_LAYER});
    const h=new Harness();h._visibilityCamera=camera();let reads=0;
    Object.defineProperty(h,'_system',{get(){reads++;return null;}});
    setSpectatorCameraUnderwater(h._visibilityCamera,true);h.update(1/60);assert.equal(reads,0);
    setSpectatorCameraUnderwater(h._visibilityCamera,false);h.update(1/60);assert.equal(reads,1);
});
