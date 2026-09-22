const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function compiler(){
    if(process.env.TYPESCRIPT_PATH)return require(process.env.TYPESCRIPT_PATH);
    try{return require('typescript');}catch{}
    for(const dir of process.env.PATH.split(path.delimiter)){
        const file=path.resolve(dir,'../typescript/lib/typescript.js');if(fs.existsSync(file))return require(file);
    }
    throw new Error('需要TypeScript 5.4.5');
}
const ts=compiler();
const source=ts.createSourceFile('PrepareRaceCharacterPreview.ts',fs.readFileSync('assets/scripts/app/PrepareRaceCharacterPreview.ts','utf8'),ts.ScriptTarget.Latest,true);
const cls=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='PrepareRaceCharacterPreview');
const methods=cls.members.filter(n=>['setHallOffset','setScreenOffset'].includes(n.name?.getText(source)));
const base={x:3.5,y:1.5,z:4.6},lobby={x:.28,y:1.04,z:0},detail={x:0,y:.88,z:0};

test('大厅角色用取景平移维持位置，相机始终使用完整视口，不污染后续弹窗',()=>{
    let size={width:1280,height:720},writes=0;
    class Rect{constructor(x,y,width,height){Object.assign(this,{x,y,width,height});}}
    const Preview=vm.runInNewContext(ts.transpileModule(`class Preview { ${methods.map(n=>n.getText(source)).join('\n')} };Preview`,
        {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,{
        PREVIEW_CAMERA_POSITION:base,LOBBY_CAMERA_TARGET:lobby,PREVIEW_CAMERA_TARGET:detail,
        CHARACTER_PREVIEW_RIGHT_SHIFT:30,Camera:class{},Rect,view:{getVisibleSize:()=>size},Math,
    });
    const camera={fov:34,rect:new Rect(-129/1280,0,1,1)};
    const node={position:{...base},getComponent:()=>camera,setPosition(x,y,z){writes++;this.position={x,y,z};}};
    const preview=new Preview();preview._cameraNode=node;
    for(const width of [960,1280,1600,1920])for(const enabled of [true,false]){
        size={width,height:720};preview._lobbyPresentation=enabled;
        preview.setHallOffset(enabled);
        assert.deepEqual({...camera.rect},{x:0,y:0,width:1,height:1});
        const target=enabled?lobby:detail;
        const dx=base.x-target.x,dy=base.y-target.y,dz=base.z-target.z;
        const depth=Math.hypot(dx,dy,dz),horizontal=Math.hypot(dx,dz);
        const right=(base.x-node.position.x)*dz/horizontal-(base.z-node.position.z)*dx/horizontal;
        const projected=right/depth/Math.tan(34*Math.PI/360)*size.height/2;
        const expected=enabled?45-174*Math.max(width/1280,1):30;
        assert.ok(Math.abs(projected-expected)<1e-8,`${width}下角色投影偏移保持一致`);
        const before=writes;preview.setHallOffset(enabled);assert.equal(writes,before,'重复布局不写变换');
        for(const pixels of [-240,-129,-75,0,30]){
            preview.setScreenOffset(pixels,size.height);
            const delta=(base.x-node.position.x)*dz/horizontal-(base.z-node.position.z)*dx/horizontal;
            const projected=delta/depth/Math.tan(34*Math.PI/360)*size.height/2;
            assert.ok(Math.abs(projected-pixels)<1e-8,'连续像素偏移准确投影到完整视口');
            assert.deepEqual({...camera.rect},{x:0,y:0,width:1,height:1});
        }
    }
});
