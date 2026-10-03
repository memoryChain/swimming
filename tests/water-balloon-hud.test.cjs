const test=require('node:test'),assert=require('node:assert/strict');
const {createFixedMeshHarness}=require('./helpers/fixed-mesh-harness.cjs');
function fixture(){
    const h=createFixedMeshHarness({'./ProjectUiFonts':{styleProjectUiLabel(){}}});let writes=0;
    class Label {static Overflow={SHRINK:1};static HorizontalAlign={CENTER:1};static VerticalAlign={CENTER:1};get string(){return this._string;}set string(value){writes++;this._string=value;}}
    class Widget {static AlignMode={ON_WINDOW_RESIZE:1};}
    class UITransform {contentSize={width:0,height:0};setContentSize(width,height){Object.assign(this.contentSize,{width,height});}}
    Object.assign(h.cc,{Label,UITransform,Widget,LabelOutline:class{}});
    const hud=new(h.loadModule('ui/MineRelayBrawlHud').MineRelayBrawlHud)(h.root);
    return {...h,hud,label:hud.root.getComponent(Label),writes:()=>writes};
}
test('水球HUD量化到0.1秒、最多10Hz，重复值不写文字，隐藏和父层隐藏零工作',()=>{
    const h=fixture(),{hud,label}=h;let count=h.writes();for(let i=0;i<120;i++)hud.update(1/60,0,8,false,false,6);assert.equal(h.writes(),count);
    hud.setRacing(true);hud.update(.1,0,8,false,false,6);assert.equal(label.string,'1号泳道携带水球 · 8.0秒 · 贴近对手转交');count=h.writes();
    for(let i=0;i<120;i++)hud.update(1/60,0,7.99999,false,false,6);assert.equal(h.writes(),count);
    hud.update(.1,1,.8,true,false,5);assert.equal(label.string,'2号泳道携带水球 · 0.8秒 · 无法转交');
    hud.update(.1,1,.8,true,true,5);assert.equal(label.string,'2号泳道携带水球 · 计时暂停');
    hud.update(.1,-1,0,false,false,5);assert.equal(label.string,'下一轮水球待命 · 剩余5轮');
    const nodes=h.nodes.length;for(let i=0;i<20;i++){hud.setRacing(false);hud.setRacing(true);hud.update(.1,-1,0,false,false,0);}assert.equal(h.nodes.length,nodes);
    h.root.active=false;count=h.writes();const elapsed=hud.elapsed;for(let i=0;i<120;i++)hud.update(1/60,2,4,false,false,3);assert.equal(h.writes(),count);assert.equal(hud.elapsed,elapsed);hud.dispose();
});
test('更新中的倒计时只以10Hz写最终文字，不建立新节点或重新定位',()=>{
    const h=fixture();h.hud.setRacing(true);const nodes=h.nodes.length,transform=h.hud.root.writes,start=h.writes();
    for(let i=0;i<600;i++)h.hud.update(1/60,0,20-i/60,false,false,6);
    assert.ok(h.writes()-start<=102);assert.equal(h.nodes.length,nodes);assert.equal(h.hud.root.writes,transform);h.hud.dispose();
});
