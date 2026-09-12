// 用可推进时间的 Tween 替身检查中断、输入与生命周期；不代替真机视觉验收。
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
class Vec3 {
    constructor(x=0,y=0,z=0) { Object.assign(this,{x,y,z}); }
    clone() { return new Vec3(this.x,this.y,this.z); }
}
class UIOpacity { opacity=255; }
class Button { static EventType={CLICK:'click'}; static Transition={NONE:0}; interactable=true; get isValid(){return this.node.isValid;} }
class Node {
    static EventType={TOUCH_START:'start',TOUCH_END:'end',TOUCH_CANCEL:'cancel'};
    children=[]; components=[]; events=new Map(); position=new Vec3(); scale=new Vec3(1,1,1); active=true; isValid=true;
    constructor(name){this.name=name;}
    setParent(parent){this.parent=parent;parent.children.push(this);}
    getComponent(C){return this.components.find(c=>c instanceof C);}
    addComponent(C){const c=new C();c.node=this;this.components.push(c);return c;}
    getComponentsInChildren(C){return [...this.components.filter(c=>c instanceof C),...this.children.flatMap(n=>n.getComponentsInChildren(C))];}
    setPosition(x,y,z){this.position=new Vec3(x,y,z);}
    setScale(x,y,z){this.scale=typeof x==='object'?x.clone():new Vec3(x,y,z);}
    on(e,f){if(!this.events.has(e))this.events.set(e,new Set());this.events.get(e).add(f);}
    off(e,f){this.events.get(e)?.delete(f);}
    emit(e,id=1){for(const f of this.events.get(e)??[])f({getID:()=>id});}
    destroy(){this.isValid=false;this.children.forEach(c=>c.destroy());}
}
class UITransform { contentSize={width:1280,height:720}; setContentSize(width,height){this.contentSize={width,height};} }
class BlockInputEvents {}
class Label { static HorizontalAlign={LEFT:0}; static Overflow={SHRINK:0}; string=''; get isValid(){return this.node.isValid;} }
class Sprite { static SizeMode={CUSTOM:0}; }
function setup() {
    let now=0,created=0;
    const running=new Set();
    class Animation {
        steps=[];
        constructor(target){this.target=target;created++;}
        delay(seconds){this.steps.push({seconds});return this;}
        to(seconds,props){this.steps.push({seconds,props});return this;}
        call(fn){this.steps.push({seconds:0,fn});return this;}
        start(){this.time=now;this.index=0;running.add(this);return this;}
        stop(){running.delete(this);return this;}
        tick(){
            while(running.has(this)&&this.index<this.steps.length){
                const step=this.steps[this.index],fraction=step.seconds?Math.min(1,(now-this.time)/step.seconds):1;
                if(step.props){
                    if(!step.from)step.from=Object.fromEntries(Object.keys(step.props).map(k=>[k,typeof this.target[k]==='object'?{...this.target[k]}:this.target[k]]));
                    for(const [key,to] of Object.entries(step.props)){
                        const from=step.from[key];
                        this.target[key]=typeof to==='object'?new Vec3(from.x+(to.x-from.x)*fraction,from.y+(to.y-from.y)*fraction,from.z+(to.z-from.z)*fraction):from+(to-from)*fraction;
                    }
                }
                if(fraction<1)break;
                this.time+=step.seconds;this.index++;step.fn?.();
            }
            if(this.index>=this.steps.length)running.delete(this);
        }
    }
    const cc={Node,Button,UIOpacity,Vec3,UITransform,BlockInputEvents,Label,Sprite,tween:target=>new Animation(target)};
    const makeUiNode=(name,parent)=>{const n=new Node(name);n.setParent(parent);n.addComponent(UITransform);return n;};
    const sliders=new Map();
    const factory={makeUiNode,uiColor:()=>({}),fitFullScreenBackgroundCover(){},
        makeRect:makeUiNode,makeLabel:(name,parent,text)=>{const n=makeUiNode(name,parent);n.addComponent(Label).string=text;return n;},
        makeTouchArea:(name,parent)=>{const n=makeUiNode(name,parent);n.addComponent(Button);return n;},
        makeDragSlider:(name,parent,w,h,value,callback)=>{const n=makeUiNode(name,parent);sliders.set(name,callback);return {node:n,setRatio(){}};}};
    function load(file,imports){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module:m,exports:m.exports,require:key=>imports[key]??{},console:{warn(){}}});return m.exports;}
    const {PopupUiMotion}=load('assets/scripts/ui/PopupUiMotion.ts',{'cc':cc,'./RuntimeUiFactory':factory});
    let persisted=0,music=.8,sfx=.8;
    const settings={musicVolume:.8,sfxVolume:.8,previewMusicVolume:v=>music=v,previewSfxVolume:v=>sfx=v,
        setVolumes(a,b){this.musicVolume=music=a;this.sfxVolume=sfx=b;persisted++;}};
    const requests=[];
    const player={avatarId:'aqua',nickName:'选手',setIdentity:patch=>new Promise((resolve,reject)=>requests.push({resolve:()=>{Object.assign(player,patch);resolve();},reject}))};
    const imports={cc,'./PopupUiMotion':{PopupUiMotion},'./RuntimeUiFactory':factory,
        '../core/ResourcePaths':{RESOURCE_PATHS:{avatarPickerUi:{}}},
        './AvatarUiAssets':{loadAvatarUiSpriteFrame(){},loadAvatarSpriteFrame(){}},
        './ProjectUiFonts':{styleProjectUiLabel(){},styleDynamicUiLabel(){}},
        '../app/SettingsManager':{SettingsManager:settings},'../backend/PlayerData':{PlayerData:player},
        '../backend/IdentityConfig':{AVATARS:[{id:'aqua'},{id:'coral'}],generateRandomNickName:()=> '新昵称'}};
    const {SettingsPanel}=load('assets/scripts/ui/SettingsPanel.ts',imports);
    const {IdentityEditPanel}=load('assets/scripts/ui/IdentityEditPanel.ts',imports);
    const parent=new Node('弹窗层');
    return {parent,SettingsPanel,IdentityEditPanel,sliders,requests,player,settings,get music(){return music;},get persisted(){return persisted;},
        advance(seconds){now+=seconds;for(const t of [...running])t.tick();},get running(){return running.size;},get created(){return created;}};
}
function near(a,b){assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);}
function size(n){return 1+n.components.length+n.children.reduce((sum,c)=>sum+size(c),0);}


function find(n,name){if(n.name===name)return n;for(const c of n.children){const result=find(c,name);if(result)return result;}}
function listeners(n){return [...n.events.values()].reduce((sum,set)=>sum+set.size,0)+n.children.reduce((sum,c)=>sum+listeners(c),0);}
test('两个弹窗快速开关：原位续接、遮罩最后释放、重复 show 不重播、层级监听稳定',()=>{
    for(const type of ['SettingsPanel','IdentityEditPanel']){
        const s=setup(),p=new s[type](),root=p.build(s.parent,1280,720),count=size(root),events=listeners(root);
        const panel=find(root,'Panel'),block=find(root,'PopupClosingBlocker');
        p.show();s.advance(.06);assert.ok(panel.scale.x<1);
        const made=s.created;p.show();assert.equal(s.created,made);
        p.hide();assert.equal(root.active,true);assert.equal(block.active,true);s.advance(.05);
        const x=panel.scale.x,y=panel.position.y;p.show();near(panel.scale.x,x);near(panel.position.y,y);assert.equal(block.active,false);
        s.advance(1);near(panel.scale.x,1);near(panel.position.y,27);
        for(let i=0;i<20;i++){p.hide();s.advance(.2);assert.equal(root.active,false);assert.equal(s.running,0);p.show();s.advance(.3);}
        assert.equal(size(root),count);assert.equal(listeners(root),events);
        p.hide();p.dispose();s.advance(1);assert.equal(s.running,0);assert.equal(root.isValid,false);
    }
});
test('音量草稿：重复打开保留修改；取消和销毁恢复；确认一次保存且退场中拒绝滑动',()=>{
    const s=setup(),p=new s.SettingsPanel();p.build(s.parent,1280,720);p.show();
    s.sliders.get('音乐Slider')(.37);p.show();assert.equal(p._draftMusic,.37);assert.equal(s.music,.37);
    p.hide();assert.equal(s.music,.8);s.sliders.get('音乐Slider')(.1);assert.equal(s.music,.8);s.advance(.3);
    p.show();s.sliders.get('音乐Slider')(.6);p.confirm();p.confirm();p.hide();assert.equal(s.persisted,1);assert.equal(s.music,.6);s.advance(.3);
    p.show();s.sliders.get('音乐Slider')(.2);p.dispose();assert.equal(s.music,.6);assert.equal(s.running,0);
});
test('头像保存：成功后才关闭，失败可重试，保存中不可重置草稿或重复请求',async()=>{
    const s=setup(),p=new s.IdentityEditPanel(),root=p.build(s.parent,1280,720);p.show();p.selectAvatar('coral');
    const pending=p.confirm();p.show();p.hide();p.selectAvatar('aqua');await p.confirm();
    assert.equal(s.requests.length,1);assert.equal(p._draftAvatarId,'coral');assert.equal(root.active,true);
    s.requests[0].reject(Error('模拟保存失败'));await pending;
    assert.equal(root.active,true);assert.equal(p._saving,false);assert.equal(p._confirmButton.interactable,true);
    const retry=p.confirm();s.requests[1].resolve();await retry;
    assert.equal(root.active,true);assert.equal(find(root,'PopupClosingBlocker').active,true);s.advance(.3);assert.equal(root.active,false);
    p.show();assert.equal(p._draftAvatarId,'coral');p.dispose();
});
test('旧保存完成不能关闭重新创建的弹窗；按钮取消触摸和已选头像保持稳定',async()=>{
    const s=setup(),p=new s.IdentityEditPanel(),old=p.build(s.parent,1280,720);p.show();s.advance(.3);
    const cancel=find(old,'Cancel');cancel.emit('start');s.advance(.04);assert.ok(cancel.scale.x<1);cancel.emit('cancel');s.advance(.2);near(cancel.scale.x,1);
    const count=s.created;p.selectAvatar('aqua');assert.equal(s.created,count);
    p.selectAvatar('coral');const pending=p.confirm();p.dispose();const fresh=p.build(s.parent,1280,720);p.show();
    s.requests[0].resolve();await pending;s.advance(1);assert.equal(fresh.active,true);assert.equal(p._motion.interactive,true);
    p.dispose();assert.equal(s.running,0);
});
