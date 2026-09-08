// 执行真实显示类，覆盖同帧发令与评价、退出取消、斜槽几何及隐藏帧开销。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function compiler() {
    if (process.env.TYPESCRIPT_PATH) return require(process.env.TYPESCRIPT_PATH);
    try { return require('typescript'); } catch {}
    for (const dir of process.env.PATH.split(path.delimiter)) {
        const file = path.resolve(dir, '../typescript/lib/typescript.js');
        if (fs.existsSync(file)) return require(file);
    }
    throw Error('请使用 TypeScript 5.4.5 执行测试');
}
const ts = compiler();
class UITransform { setContentSize(w,h){ this.contentSize={width:w,height:h}; } }
class Sprite { static SizeMode={CUSTOM:0}; static Type={FILLED:1}; static FillType={VERTICAL:1}; }
class Label { static Overflow={SHRINK:1}; static HorizontalAlign={CENTER:1}; static VerticalAlign={CENTER:1}; }
class LabelOutline {}
class Color { constructor(...rgba){this.rgba=rgba;} }
class UIOpacity {}
class Node {
    children=[]; components=new Map(); active=true; isValid=true; layer=1;
    constructor(name){this.name=name;}
    setParent(p){this.parent=p;p.children.push(this);}
    addComponent(C){const c=new C();c.node=this;this.components.set(C,c);return c;}
    getComponent(C){return this.components.get(C);}
    setPosition(x,y,z){this.position={x,y,z};}
    setScale(x,y,z){this.scale={x,y,z};}
    get activeInHierarchy(){return this.active && (!this.parent || this.parent.activeInHierarchy);}
    destroy(){this.isValid=false;}
}
function setup(fail=false) {
    const tweens=[], callbacks=[], events=new Map();
    let size={width:1290,height:720}; let right=0;
    const keys=['ready','go','late','good','great','perfect','charge-track','charge-fill-low','charge-fill-mid','charge-fill-high','charge-cap'];
    const cc={Node,UITransform,Sprite,Label,LabelOutline,Color,UIOpacity,
        view:{getVisibleSize:()=>size,on:(e,f,t)=>events.set(e,()=>f.call(t)),off:e=>events.delete(e)},
        sys:{getSafeAreaRect:()=>({x:0,y:0,width:size.width-right,height:size.height})},
        Tween:{stopAllByTarget:o=>tweens.forEach(t=>{if(t.o===o)t.stopped=true;})},
        tween:o=>{const t={o,delay(){return t;},to(){return t;},call(f){t.cb=f;return t;},start(){tweens.push(t);return t;}};return t;}};
    const imports={cc,'../core/ResourcePaths':{RESOURCE_PATHS:{raceStartUi:Object.fromEntries(keys.map(k=>[k,k]))}},
        './AvatarUiAssets':{loadAvatarUiSpriteFrame:(p,cb)=>callbacks.push(()=>cb(fail?null:{path:p}))},
        './ProjectUiFonts':{styleProjectUiLabel:l=>assert.equal(l.overflow,Label.Overflow.SHRINK)}};
    const m={exports:{}};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync('assets/scripts/ui/RaceStartView.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,
        {require:p=>imports[p],module:m,exports:m.exports});
    let loaded=false,error;
    m.exports.preloadRaceStartUi(e=>{loaded=true;error=e;});
    assert.equal(loaded,false);callbacks.forEach(f=>f());assert.equal(loaded,true);
    const parent=new Node('HUD');const art=error?null:new m.exports.RaceStartView(parent);
    return {art,parent,tweens,events,error,finish(){for(const t of tweens.splice(0))if(!t.stopped)t.cb();},
        resize(width,height,inset=0){size={width,height};right=inset;events.get('canvas-resize')();}};
}
function count(n){return 1+n.children.reduce((s,c)=>s+count(c),0);}
test('READY 保留中文；GO 同帧评价排队；重复指令不重建或重启动画',()=>{
    const s=setup(),a=s.art,total=count(s.parent);
    a.showReady();assert.equal(a.hint.active,true);assert.equal(a.chargeRoot.active,true);
    a.showGo();a.showRelease(.9,false);assert.equal(a.cue.spriteFrame.path,'go');
    for(let i=0;i<50;i++)a.showGo();assert.equal(s.tweens.length,1);
    s.finish();assert.equal(a.cue.spriteFrame.path,'perfect');assert.equal(a.hint.active,false);
    s.finish();assert.equal(a.cueRoot.active,false);assert.equal(count(s.parent),total);
});
test('三档评价阈值和偏晚优先保持原判定',()=>{
    const {art:a}=setup();
    for(const [power,late,key] of [[.54,false,'good'],[.55,false,'great'],[.85,false,'perfect'],[1,true,'late']]) {
        a.reset();a.showRelease(power,late);assert.equal(a.cue.spriteFrame.path,key);
    }
});
test('斜槽固定尺寸、30Hz 刷新、往返颜色与标记在同一中心线',()=>{
    const {art:a}=setup();a.showReady();const transform=a.fill.node.getComponent(UITransform);
    const original=transform.contentSize;
    a.setCharge(.95,true);a.update(.01);assert.equal(a.fill.fillRange,0);
    a.update(.024);assert.equal(a.fill.spriteFrame.path,'charge-fill-high');
    for(const [ratio,key] of [[.3,'low'],[.65,'mid'],[1,'high'],[0,'low']]) {
        a.setCharge(ratio,true);a.update(1/30);
        assert.equal(a.fill.spriteFrame.path,`charge-fill-${key}`);
        assert.equal(transform.contentSize,original);
        const y=502-Math.round(ratio*233);
        assert.equal(a.cap.position.x,1234-(y-226)*.2-645);
        assert.equal(a.cap.position.y,361-y);
    }
    assert.equal(a.cap.active,false);
});
test('隐藏与离开无绘制；取消排队评价；尺寸适配后层级稳定',()=>{
    const s=setup(),a=s.art,total=count(s.parent);a.showGo();a.showRelease(.9,false);a.reset();s.finish();
    assert.equal(a.cueRoot.active,false);assert.equal(a.pending,null);
    a.renderCharge=()=>assert.fail('隐藏时不应刷新');a.update(1);
    for(const [w,h,inset] of [[1290,720,0],[1600,720,60],[960,720,0]]) {
        s.resize(w,h,inset);assert.equal(a.cueRoot.scale.x,a.cueRoot.scale.y);
        assert.equal(a.chargeRoot.scale.x,a.chargeRoot.scale.y);assert.equal(count(s.parent),total);
    }
    a.destroy();assert.equal(s.events.size,0);
});
test('资源全部就绪才交付；加载失败明确阻止无图进入',()=>{assert.ok(setup(true).error);});
test('导出清单尺寸与运行时 PNG、资源路径一致；不包含未选标题',()=>{
    const manifest=JSON.parse(fs.readFileSync('docs/race-start-ui/runtime-export-layout.json','utf8'));
    const paths=fs.readFileSync('assets/scripts/core/ResourcePaths.ts','utf8');
    assert.equal(manifest.assets.length,11);
    for(const asset of manifest.assets) {
        const file=`assets/race/ui/race-start-v1/${asset.name}.png`;
        const png=fs.readFileSync(file);
        assert.equal(png.readUInt32BE(16),asset.width,file);
        assert.equal(png.readUInt32BE(20),asset.height,file);
        assert.ok(paths.includes(`ui/race-start-v1/${asset.name}/texture`),file);
    }
    assert.equal(fs.existsSync('assets/race/ui/race-start-v1/ready-on-block.png'),false);
});
