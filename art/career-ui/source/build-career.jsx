#target photoshop
// Photoshop 原生矢量面板、渐变填充与可编辑文字；插画以嵌入智能对象保留。
var ROOT=File($.fileName).parent.parent;
var PROJECT=ROOT.parent.parent;
var D=app.activeDocument;
if(D.width.as('px')!==1280||D.height.as('px')!==720)throw Error('画布必须为1280×720');
var S=stringIDToTypeID,C=charIDToTypeID;
var NAVY=[9,25,67],MUTED=[74,106,151],WHITE=[248,252,255],CYAN=[0,192,211];
function rgb(v){var a=new ActionDescriptor();a.putDouble(C('Rd  '),v[0]);a.putDouble(C('Grn '),v[1]);a.putDouble(C('Bl  '),v[2]);return a;}
function color(v){var a=new SolidColor();a.rgb.red=v[0];a.rgb.green=v[1];a.rgb.blue=v[2];return a;}
function group(n){var g=D.layerSets.add();g.name=n;return g;}
function shape(g,n,x,y,w,h,r,v,ellipse){
 var a=new ActionDescriptor(),ref=new ActionReference();ref.putClass(S('contentLayer'));a.putReference(C('null'),ref);
 var use=new ActionDescriptor(),type=new ActionDescriptor();type.putObject(C('Clr '),S('RGBColor'),rgb(v));use.putObject(C('Type'),S('solidColorLayer'),type);
 var sh=new ActionDescriptor();sh.putUnitDouble(C('Top '),C('#Pxl'),y);sh.putUnitDouble(C('Left'),C('#Pxl'),x);sh.putUnitDouble(C('Btom'),C('#Pxl'),y+h);sh.putUnitDouble(C('Rght'),C('#Pxl'),x+w);
 if(r)sh.putUnitDouble(C('Rds '),C('#Pxl'),r);
 use.putObject(C('Shp '),ellipse?C('Elps'):C('Rctn'),sh);a.putObject(C('Usng'),S('contentLayer'),use);executeAction(C('Mk  '),a,DialogModes.NO);
 var l=D.activeLayer;l.name=n;l.move(g,ElementPlacement.INSIDE);return l;
}
function text(g,n,str,x,y,size,v,font,align){
 var l=g.artLayers.add();l.name=n;l.kind=LayerKind.TEXT;var t=l.textItem;t.contents=str;t.font=font||'ShuiMasterUI-SemiBold';t.size=size;t.color=color(v);t.antiAliasMethod=AntiAlias.SMOOTH;t.justification=align==='center'?Justification.CENTER:Justification.LEFT;
 t.position=[x,y+size];return l;
}
function gradient(g,n,a,b,angle,kind){
 var d=new ActionDescriptor(),ref=new ActionReference();ref.putClass(S('contentLayer'));d.putReference(C('null'),ref);
 var u=new ActionDescriptor(),v=new ActionDescriptor();v.putUnitDouble(C('Angl'),C('#Ang'),angle);v.putEnumerated(C('Type'),C('GrdT'),kind?C('Rdl '):C('Lnr '));v.putUnitDouble(C('Scl '),C('#Prc'),100);v.putBoolean(C('Algn'),true);
 var gr=new ActionDescriptor();gr.putString(C('Nm  '),n);gr.putEnumerated(C('GrdF'),C('GrdF'),C('CstS'));gr.putDouble(C('Intr'),4096);
 var cs=new ActionList();for(var i=0;i<2;i++){var st=new ActionDescriptor();st.putObject(C('Clr '),C('RGBC'),rgb(i?b:a));st.putEnumerated(C('Type'),C('Clry'),C('UsrS'));st.putInteger(C('Lctn'),i*4096);st.putInteger(C('Mdpn'),50);cs.putObject(C('Clrt'),st);}gr.putList(C('Clrs'),cs);
 var tr=new ActionList();for(var j=0;j<2;j++){var q=new ActionDescriptor();q.putUnitDouble(C('Opct'),C('#Prc'),100);q.putInteger(C('Lctn'),j*4096);q.putInteger(C('Mdpn'),50);tr.putObject(C('TrnS'),q);}gr.putList(C('Trns'),tr);v.putObject(C('Grad'),C('Grdn'),gr);
 u.putObject(C('Type'),S('gradientLayer'),v);d.putObject(C('Usng'),S('contentLayer'),u);executeAction(C('Mk  '),d,DialogModes.NO);var l=D.activeLayer;l.name=n;l.move(g,ElementPlacement.INSIDE);return l;
}
function place(g,n,path,x,y,w,h){
 var a=new ActionDescriptor();a.putPath(C('null'),new File(path));a.putEnumerated(C('FTcs'),C('QCSt'),C('Qcsa'));executeAction(C('Plc '),a,DialogModes.NO);var l=D.activeLayer;l.name=n;
 var b=l.bounds,ow=b[2].as('px')-b[0].as('px'),oh=b[3].as('px')-b[1].as('px');var scale=Math.min(w/ow,h/oh)*100;l.resize(scale,scale,AnchorPosition.MIDDLECENTER);b=l.bounds;l.translate(x+(w-(b[2].as('px')-b[0].as('px')))/2-b[0].as('px'),y+(h-(b[3].as('px')-b[1].as('px')))/2-b[1].as('px'));l.move(g,ElementPlacement.INSIDE);return l;
}
function line(g,n,points,width,v){
 // 自定义闭合矢量路径，保留箭头等图标的可编辑轮廓。
 var sub=new SubPathInfo();sub.closed=true;sub.operation=ShapeOperation.SHAPEADD;var ar=[];
 for(var i=0;i<points.length;i++){var p=new PathPointInfo();p.kind=PointKind.CORNERPOINT;p.anchor=points[i];p.leftDirection=points[i];p.rightDirection=points[i];ar.push(p);}sub.entireSubPath=ar;var path=D.pathItems.add(n,[sub]);
 var d=new ActionDescriptor(),ref=new ActionReference();ref.putClass(S('contentLayer'));d.putReference(C('null'),ref);var use=new ActionDescriptor(),fill=new ActionDescriptor();fill.putObject(C('Clr '),S('RGBColor'),rgb(v));use.putObject(C('Type'),S('solidColorLayer'),fill);d.putObject(C('Usng'),S('contentLayer'),use);executeAction(C('Mk  '),d,DialogModes.NO);var l=D.activeLayer;l.name=n;l.move(g,ElementPlacement.INSIDE);path.remove();return l;
}
function arrow(g,n,cx,cy,v,left){var p=[[-12,-2],[4,-2],[-1,-7],[2,-10],[13,0],[2,10],[-1,7],[4,2],[-12,2]];for(var i=0;i<p.length;i++){p[i]=[cx+p[i][0]*(left?-1:1),cy+p[i][1]];}return line(g,n,p,0,v);}
function lock(g,x,y,v){shape(g,'锁环',x+4,y,14,18,7,v);shape(g,'锁环内孔',x+7,y+3,8,12,4,[180,195,217]);shape(g,'锁体',x,y+12,22,19,3,v);shape(g,'锁孔',x+9,y+18,4,8,2,[180,195,217]);}
function button(g,n,x,y,w,h,enabled){
 var q=g.layerSets.add();q.name=n;
 shape(q,'底部厚度',x,y+4,w,h-4,18,enabled?[213,163,16]:[133,156,188]);
 shape(q,'浅色上缘',x,y,w,h-4,18,enabled?[255,246,163]:[206,218,233]);
 shape(q,'按钮面',x+2,y+3,w-4,h-9,16,enabled?[255,218,37]:[180,195,217]);
 if(enabled){var dots=q.layerSets.add();dots.name='渐隐波点';for(var side=0;side<2;side++)for(var row=0;row<5;row++)for(var col=0;col<6;col++){var xx=x+12+col*10,yy=y+12+row*10+(col%2)*3;if(side){xx=x+w-12-col*10;yy=y+h-13-row*10-(col%2)*3;}if(yy>y+h-13||yy<y+10)continue;var rad=Math.max(1.3,4.5-col*.65);var dot=shape(dots,'波点',xx-rad,yy-rad,rad*2,rad*2,0,[233,176,20],true);dot.opacity=42-col*5;}}
 return q;
}
// 本脚本仅在新建的空白主文档运行。
while(D.layers.length>1)D.layers[0].remove();
var bg=group('01 背景 · 干净微立体');
gradient(bg,'深海蓝基础渐变',[8,63,128],[4,26,65],90,false);
gradient(bg,'中心柔光渐变',[14,74,142],[4,26,65],0,true).opacity=38;
var arc=shape(bg,'上方大弧面',-350,-650,1850,1050,0,[12,64,126],true);arc.opacity=12;
var arc2=shape(bg,'弧面柔和亮边',-350,-652,1850,1050,0,[29,87,150],true);arc2.opacity=4;
var floor=shape(bg,'底部弧面',-390,590,2060,650,0,[11,62,121],true);floor.opacity=22;
var edge=shape(bg,'底部弧面细边',-390,589,2060,650,0,[40,96,153],true);edge.opacity=7;floor.move(edge,ElementPlacement.PLACEBEFORE);
D.layers[D.layers.length-1].visible=false;
var hd=group('02 页眉 · 返回与货币复用');
shape(hd,'返回底',24,24,80,48,16,[249,253,255]);arrow(hd,'返回箭头',62,48,NAVY,true);
text(hd,'页面标题','生涯之路',122,17,43,WHITE);
place(hd,'货币栏 · 原项目素材',PROJECT+'/assets/race/ui/lobby-v1/top-currency.png',935,24,181,51);
text(hd,'金币数值','2461',1018,31,25,WHITE,'Arial-Black','center');
var route=group('03 六阶晋升路线');
shape(route,'连线路径',146,132,990,3,1,[0,153,223]);shape(route,'当前段连接',146,132,100,3,1,[0,229,232]);
var centers=[148,350,546,742,938,1137],names=['泳馆新秀','俱乐部选手','城市精英','区域强者','全国大师','冠军级'];
for(var i=0;i<6;i++){
 var g=route.layerSets.add();g.name=('0'+(i+1))+' '+names[i]+(i?' · 未解锁':' · 当前');
 if(i<5){shape(g,'间隔节点',centers[i]+94,128,10,10,0,[0,209,229],true);shape(g,'节点内面',centers[i]+96,130,6,6,0,i?[10,91,159]:[94,233,239],true);}
 place(g,'徽章插画',ROOT+'/assets/tier-'+(i+1)+'.png',centers[i]-55,80,110,91);
 text(g,'段位名称',names[i],centers[i],174,18,i?WHITE:[255,222,59],null,'center');
 if(!i)shape(g,'当前选中下划线',90,201,117,6,3,[255,222,59]);
}
var honor=group('04 当前荣誉 · 独立插画与可编辑名称');
place(honor,'荣誉展台 · 嵌入智能对象',ROOT+'/assets/honor-display.png',26,260,329,337);
text(honor,'展台段位名称','泳馆新秀',191,518,29,NAVY,null,'center');
text(honor,'赛事规则入口','赛事规则',198,622,23,WHITE,null,'center');shape(honor,'文字下划线',152,652,92,1.5,0,WHITE);
var player=group('05 当前出场 · 两赛事共用');
shape(player,'角色栏',392,218,862,74,17,[207,235,251]);
place(player,'角色头像',ROOT+'/assets/character-avatar.png',409,226,58,58);
shape(player,'出场状态底',482,239,105,31,14,[164,218,244]);text(player,'出场状态','当前出场',535,241,18,NAVY,null,'center');
text(player,'角色名称','铁臂狂鲨',604,237,24,NAVY,'PingFangSC-Semibold');text(player,'角色等级','Lv.1',720,239,23,NAVY,'Arial-Black');
text(player,'更换入口','更换',1163,239,22,NAVY);arrow(player,'更换箭头',1221,255,NAVY,false);
var league=group('06 联赛挑战 · 账号共享');
shape(league,'联赛主面板',392,306,416,368,18,[249,252,255]);
shape(league,'账号标签底',418,326,103,36,11,[255,239,186]);text(league,'账号标签','账号共享',469.5,332,18,NAVY,null,'center');
text(league,'联赛标题','联赛挑战',419,365,38,NAVY);text(league,'距离与模式','200米 · 狂野模式',421,422,21,MUTED);
shape(league,'积分区',408,463,384,115,14,[229,244,253]);
text(league,'积分名称','联赛积分',427,477,20,NAVY);text(league,'当前积分','80',663,473,34,CYAN,'Arial-Black');text(league,'积分上限','/ 100',718,485,22,MUTED,'Arial-Black');
shape(league,'进度底槽',426,515,350,16,8,[204,222,239]);shape(league,'当前进度 80%',426,515,280,16,8,CYAN);
text(league,'晋级杯解锁提示','再获20积分，解锁晋级杯',426,541,18,MUTED,'ShuiMasterUI-Regular');
var lb=button(league,'开始联赛 · 正常',407,590,384,70,true);text(lb,'按钮文案','开始联赛',591,601,32,NAVY,null,'center');arrow(lb,'右箭头',677,625,NAVY,false);
var cup=group('07 晋级杯 · 角色专属');
shape(cup,'杯赛主面板',822,306,432,368,18,[249,252,255]);
shape(cup,'角色标签底',848,326,106,36,11,[255,239,186]);text(cup,'角色标签','角色专属',901,332,18,NAVY,null,'center');
text(cup,'杯赛标题','晋级杯',848,369,40,NAVY);place(cup,'金杯插画',ROOT+'/assets/cup.png',1085,327,145,118);
shape(cup,'预赛区',847,450,159,102,13,[232,245,253]);shape(cup,'决赛区',1068,450,163,102,13,[232,245,253]);
text(cup,'预赛标题','预赛',866,458,23,NAVY);text(cup,'预赛距离','200米',866,493,18,MUTED);text(cup,'预赛晋级条件','前四晋级',866,518,18,MUTED);
text(cup,'决赛标题','决赛',1088,458,23,NAVY);text(cup,'决赛距离','200米',1088,493,18,MUTED);text(cup,'决赛夺冠条件','第一名夺冠',1088,518,18,MUTED);
arrow(cup,'赛程箭头',1037,500,[106,142,186],false);text(cup,'晋级说明','夺冠晋级下一联赛。',850,560,18,MUTED);
var cb=button(cup,'晋级杯 · 积分不足禁用',839,598,393,62,false);lock(cb,931,610,[87,116,153]);text(cb,'按钮文案','还差20积分',980,608,27,[87,116,153]);
var guide=group('99 参考与安全区 · 默认隐藏');
shape(guide,'微信胶囊预留区',1128,0,152,80,0,[255,90,90]);guide.visible=false;
var opt=new PhotoshopSaveOptions();opt.layers=true;opt.embedColorProfile=true;
D.saveAs(new File(ROOT+'/生涯之路.psd'),opt,false,Extension.LOWERCASE);
D.saveAs(new File(ROOT+'/生涯之路-预览.png'),new PNGSaveOptions(),true,Extension.LOWERCASE);
({ok:true,path:ROOT+'/生涯之路.psd',groups:D.layerSets.length});
