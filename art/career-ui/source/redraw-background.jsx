#target photoshop
// 仅替换背景；不重建或修改其他 UI 图层。
var ROOT=File($.fileName).parent.parent;
var f=new File(ROOT+'/source/build-career.jsx');f.open('r');var helpers=f.read();f.close();
eval(helpers.substring(helpers.indexOf('var ROOT='),helpers.indexOf('// 本脚本仅在新建的空白主文档运行。')));
if(D.fullName.fsName!==new File(ROOT+'/生涯之路.psd').fsName)throw Error('请激活生涯主稿');
var prior=D.layerSets.getByName('01 背景 · 干净微立体');
var backup=new PhotoshopSaveOptions();backup.layers=true;D.saveAs(new File(ROOT+'/source/背景重绘前备份.psd'),backup,true);
function glow(g,n,v,opacity,x,y,scale){
 var d=new ActionDescriptor(),ref=new ActionReference();ref.putClass(S('contentLayer'));d.putReference(C('null'),ref);
 var u=new ActionDescriptor(),p=new ActionDescriptor();p.putUnitDouble(C('Angl'),C('#Ang'),0);p.putEnumerated(C('Type'),C('GrdT'),C('Rdl '));p.putUnitDouble(C('Scl '),C('#Prc'),scale);p.putBoolean(C('Algn'),true);p.putBoolean(C('Dthr'),true);
 var offset=new ActionDescriptor();offset.putUnitDouble(C('Hrzn'),C('#Prc'),x);offset.putUnitDouble(C('Vrtc'),C('#Prc'),y);p.putObject(C('Ofst'),C('Pnt '),offset);
 var gr=new ActionDescriptor();gr.putString(C('Nm  '),n);gr.putEnumerated(C('GrdF'),C('GrdF'),C('CstS'));gr.putDouble(C('Intr'),4096);
 var cs=new ActionList(),ts=new ActionList();
 for(var i=0;i<2;i++){var st=new ActionDescriptor();st.putObject(C('Clr '),C('RGBC'),rgb(v));st.putEnumerated(C('Type'),C('Clry'),C('UsrS'));st.putInteger(C('Lctn'),i*4096);st.putInteger(C('Mdpn'),50);cs.putObject(C('Clrt'),st);var t=new ActionDescriptor();t.putUnitDouble(C('Opct'),C('#Prc'),i?0:opacity);t.putInteger(C('Lctn'),i*4096);t.putInteger(C('Mdpn'),38);ts.putObject(C('TrnS'),t);}
 gr.putList(C('Clrs'),cs);gr.putList(C('Trns'),ts);p.putObject(C('Grad'),C('Grdn'),gr);u.putObject(C('Type'),S('gradientLayer'),p);d.putObject(C('Usng'),S('contentLayer'),u);executeAction(C('Mk  '),d,DialogModes.NO);var l=D.activeLayer;l.name=n;l.move(g,ElementPlacement.INSIDE);return l;
}
function ribbon(g,n,a,b,c,e,width,v,opacity,blur){
 function addY(p,k){return [p[0],p[1]+k];}
 var pts=[[a,a,b],[e,c,e],[addY(e,width),addY(e,width),addY(c,width)],[addY(a,width),addY(b,width),addY(a,width)]];
 var sub=new SubPathInfo();sub.closed=true;sub.operation=ShapeOperation.SHAPEADD;var out=[];
 for(var i=0;i<pts.length;i++){var q=new PathPointInfo();q.kind=PointKind.CORNERPOINT;q.anchor=pts[i][0];q.leftDirection=pts[i][1];q.rightDirection=pts[i][2];out.push(q);}sub.entireSubPath=out;var path=D.pathItems.add(n,[sub]);
 var d=new ActionDescriptor(),ref=new ActionReference();ref.putClass(S('contentLayer'));d.putReference(C('null'),ref);var u=new ActionDescriptor(),fill=new ActionDescriptor();fill.putObject(C('Clr '),S('RGBColor'),rgb(v));u.putObject(C('Type'),S('solidColorLayer'),fill);d.putObject(C('Usng'),S('contentLayer'),u);executeAction(C('Mk  '),d,DialogModes.NO);var l=D.activeLayer;l.name=n;l.opacity=opacity;l.move(g,ElementPlacement.INSIDE);path.remove();
 if(blur){var soft=l.duplicate(g,ElementPlacement.PLACEATBEGINNING);soft.name=n+' · 景深柔化';D.activeLayer=soft;soft.rasterize(RasterizeType.ENTIRELAYER);soft.applyGaussianBlur(blur);soft.opacity=Math.min(55,opacity*1.8);l.opacity=opacity*.35;}
 return l;
}
var g=group('01 背景 · 光感与景深');g.move(prior,ElementPlacement.PLACEBEFORE);
gradient(g,'深海蓝空间基底',[7,59,118],[3,20,51],90,false);
glow(g,'左侧荣誉冷蓝漫射光',[17,117,186],73,-31,4,75);
glow(g,'顶部远景蓝色天光',[24,85,174],49,3,-45,91);
glow(g,'底部地面柔和反光',[18,100,172],44,6,64,90);
// 大尺度模糊光带建立远景，避免碎小光斑与脏纹理。
ribbon(g,'远景上弧光带',[-130,137],[260,-77],[814,-54],[1420,152],20,[83,147,214],15,20);
ribbon(g,'远景下弧轮廓',[-110,377],[300,206],[696,239],[1390,347],13,[48,139,198],14,16);
glow(g,'左上柔光入口',[96,164,213],25,-57,-28,46);
// 前景流线比远景更清晰，数量克制；保留中央阅读区。
ribbon(g,'前景主流线',[-90,652],[275,573],[771,703],[1370,589],2.0,[78,165,218],26,0);
ribbon(g,'前景副流线',[-100,674],[282,600],[790,726],[1370,617],1.1,[64,142,206],17,0);
ribbon(g,'地面纵深导线',[-60,734],[215,591],[520,499],[1050,443],1.3,[48,139,203],16,0);
ribbon(g,'远景顶缘细线',[-80,115],[290,-52],[801,-35],[1370,136],1.4,[86,150,206],11,4);
glow(g,'右上安全区柔和压暗',[2,20,51],52,48,-47,44);
prior.visible=false;prior.name='00 旧背景 · 待核对';
D.activeLayer=g;
({ok:true,background:g.name,layers:g.layers.length});
