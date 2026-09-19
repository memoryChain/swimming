#target photoshop
// 状态补齐制作记录。导出后仍必须逐张验图；实际制作另外修正了决赛条件与当前轮次底色，并重新捕获对应图层复合。仅适用于记录时的源稿层树，禁止在手工更新后的主稿盲目重跑。
var D=app.activeDocument;
if(D.name!=='生涯之路.psd')throw Error('请先激活生涯主稿');
var ROOT=D.path, S=stringIDToTypeID,C=charIDToTypeID;
var NAVY=[9,25,67],MUTED=[74,106,151],CYAN=[0,192,211],GOLD=[255,222,59],WHITE=[248,252,255],GREEN=[29,108,60];
function find(p,id){for(var i=0;i<p.layers.length;i++){var l=p.layers[i];if(l.id===id)return l;if(l.typename==='LayerSet'){var q=find(l,id);if(q)return q;}}return null;}
function named(p,n){for(var i=0;i<p.layers.length;i++){var l=p.layers[i];if(l.name===n)return l;if(l.typename==='LayerSet'){var q=named(l,n);if(q)return q;}}return null;}
function b(l){var a=[];for(var i=0;i<4;i++)a.push(l.bounds[i].as('px'));return a;}
function color(v){var c=new SolidColor();c.rgb.red=v[0];c.rgb.green=v[1];c.rgb.blue=v[2];return c;}
function pos(l,x,y,center){var a=b(l);l.translate(x-(center?(a[0]+a[2])/2:a[0]),y-(a[1]+a[3])/2);return l;}
function size(l,x,y,w,h){var a=b(l);l.resize(w/(a[2]-a[0])*100,h/(a[3]-a[1])*100,AnchorPosition.TOPLEFT);a=b(l);l.translate(x-a[0],y-a[1]);return l;}
function change(l,str,x,y,fs,v,center,font){l.textItem.contents=str;if(font)l.textItem.font=font;else l.textItem.font='PingFangSC-Semibold';if(fs)l.textItem.size=fs;if(v)l.textItem.color=color(v);return pos(l,x,y,center);}
function text(g,n,str,x,y,fs,v,center,font){var l=g.artLayers.add();l.name=n;l.kind=LayerKind.TEXT;l.textItem.antiAliasMethod=AntiAlias.SMOOTH;return change(l,str,x,y,fs,v,center,font);}
function rgb(v){var a=new ActionDescriptor();a.putDouble(C('Rd  '),v[0]);a.putDouble(C('Grn '),v[1]);a.putDouble(C('Bl  '),v[2]);return a;}
function fill(l,v){D.activeLayer=l;var a=new ActionDescriptor(),r=new ActionReference();r.putEnumerated(S('contentLayer'),C('Ordn'),C('Trgt'));a.putReference(C('null'),r);var q=new ActionDescriptor();q.putObject(C('Clr '),S('RGBColor'),rgb(v));a.putObject(C('T   '),S('solidColorLayer'),q);executeAction(C('setd'),a,DialogModes.NO);}
function copyNames(src,dst){dst.name=src.name;dst.visible=src.visible;if(src.typename==='LayerSet')for(var k=0;k<src.layers.length;k++)copyNames(src.layers[k],dst.layers[k]);}
function duplicate(l,g,n){var q=l.duplicate();var placeholder=g.artLayers.add();placeholder.name='临时定位';q.move(placeholder,ElementPlacement.PLACEBEFORE);placeholder.remove();copyNames(l,q);if(n)q.name=n;return q;}
var baseIds=[452,497,519,610,788],base=[];
for(var i=0;i<baseIds.length;i++)base.push(find(D,baseIds[i]));
if(named(D,'状态 01 · 杯赛已开放'))throw Error('已存在补齐状态');
var states=[],centers=[148,350,546,742,938,1137],tierNames=['泳馆新秀','俱乐部选手','城市精英','区域强者','全国大师','冠军级'];
function makeState(n,tier){
 var g=D.layerSets.add();g.name=n;g.move(find(D,694),ElementPlacement.PLACEBEFORE);
 var route=duplicate(base[0],g),honor=duplicate(base[1],g),league=duplicate(base[2],g),cup=duplicate(base[3],g);
 var badge=duplicate(base[4],g,'当前荣誉徽章');
 var q={root:g,route:route,honor:honor,league:league,cup:cup,badge:badge};states.push(q);
 for(var i=0;i<6;i++){
   var prefix='新版徽章 0'+(i+1),full=named(route,prefix+' · 全彩预览'),lock=named(route,prefix+' · 未开启');
   full.visible=i<=tier;lock.visible=i>tier;
   var label=named(full.parent,'段位名称');label.textItem.color=color(i===tier?GOLD:WHITE);
 }
 var line=named(route,'当前选中下划线');pos(line,centers[tier],216,true);
 size(named(route,'当前段连接'),146,144,Math.max(100,centers[tier]-146),3);
 change(named(honor,'展台段位名称'),tierNames[tier],191,546,29,NAVY,true);
 if(tier>0){badge.visible=false;var f=named(route,'新版徽章 0'+(tier+1)+' · 全彩预览');badge=duplicate(f,g,'当前荣誉徽章 · '+tierNames[tier]);badge.visible=true;var a=b(badge),scale=Math.min(294/(a[2]-a[0]),230/(a[3]-a[1]))*100;badge.resize(scale,scale,AnchorPosition.MIDDLECENTER);pos(badge,191,370,true);q.badge=badge;}
 return q;
}
function points(q,value,hint){
 change(named(q.league,'当前积分'),''+value,707,493,34,CYAN,false,'Arial-Black');
 var val=named(q.league,'当前积分'),a=b(val);val.translate(707-a[2],0);
 var p=named(q.league,'当前进度 80%');p.visible=value>0;if(value>0)size(p,426,515,350*value/100,16);
 change(named(q.league,'晋级杯解锁提示'),hint,426,553,17,MUTED,false);
}
function primary(q,label){
 named(q.cup,'晋级杯 · 积分不足禁用').visible=false;
 var btn=duplicate(named(q.league,'开始联赛 · 正常'),q.cup,'杯赛主按钮 · '+label);
 btn.translate(432,0);
 var faceNames=['按钮面','浅色上缘','底部厚度'];
 for(var i=0;i<faceNames.length;i++){var l=named(btn,faceNames[i]),a=b(l);size(l,a[0],a[1],a[2]-a[0]+13,a[3]-a[1]);}
 var tx=named(btn,'按钮文案'),arrow=named(btn,'右箭头 · 圆角矢量');
 change(tx,label,0,624,31,NAVY,false);var bb=b(tx),w=bb[2]-bb[0],start=1037.5-(w+16+27)/2;
 pos(tx,start,624,false);pos(arrow,start+w+16+13.5,624,true);
}
function rounds(q,three,statuses,active){
 var hide=['赛程箭头 · 圆角矢量','决赛夺冠条件','决赛距离','决赛标题','预赛晋级条件','预赛距离','预赛标题','决赛区','预赛区'];
 for(var i=0;i<hide.length;i++)named(q.cup,hide[i]).visible=false;
 var cards=q.cup.layerSets.add();cards.name=three?'三轮赛程 · 可编辑':'两轮赛程 · 可编辑';
 var xs=three?[847,983,1119]:[847,1068],ws=three?[112,112,112]:[159,163];
 var titles=three?['预赛','半决赛','决赛']:['预赛','决赛'];
 for(var i=0;i<xs.length;i++){
   var g=cards.layerSets.add();g.name=titles[i]+' · '+statuses[i];
   var f=duplicate(named(q.cup,'预赛区'),g,'赛程底板');f.visible=true;size(f,xs[i],450,ws[i],102);
   var done=statuses[i]==='已晋级'||statuses[i]==='已夺冠';var faceColor=[232,245,253];if(done)faceColor=[222,245,231];if(i===active)faceColor=[255,241,183];fill(f,faceColor);
   var cx=xs[i]+ws[i]/2;
   text(g,'轮次状态',statuses[i],cx,465,13,i===active?[144,94,14]:done?GREEN:MUTED,true);
   text(g,'轮次名称',titles[i],cx,486,21,NAVY,true);
   text(g,'比赛距离',three&&i===2?'400米':'200米',cx,510,18,MUTED,true);
   var condition='前四晋级';if(i===1)condition='前三晋级';if(i===xs.length-1)condition='第一名夺冠';text(g,'晋级条件',condition,cx,535,15,MUTED,true);
   if(i<xs.length-1){var arrow=duplicate(named(q.cup,'赛程箭头 · 圆角矢量'),cards,'赛程连接 '+i);arrow.visible=true;if(three)size(arrow,xs[i]+ws[i]+5,494,14,14);}
 }
}
function cupTitle(q,title,note){change(named(q.cup,'杯赛标题'),title,850,392,36,NAVY,false);change(named(q.cup,'晋级说明'),note,850,574,17,MUTED,false);}
var a=makeState('状态 01 · 杯赛已开放',0);points(a,100,'积分已满，挑战晋级杯');primary(a,'开始杯赛');rounds(a,false,['当前轮次','未开始'],0);cupTitle(a,'晋级杯','预赛前四晋级，决赛夺冠升段。');
var bstate=makeState('状态 02 · 三轮赛程进行中',3);points(bstate,100,'积分已满，继续角色专属大师杯');primary(bstate,'继续半决赛');rounds(bstate,true,['已晋级','当前轮次','未开始'],1);cupTitle(bstate,'大师杯','轮间可培养角色，杯赛进度自动保存。');
text(bstate.cup,'当前赛程摘要','第2/3轮',850,428,16,MUTED,false);
var abandon=text(bstate.cup,'放弃本届入口','放弃本届',950,428,16,MUTED,false);abandon.textItem.underline=UnderlineType.UNDERLINERIGHT;
var c=makeState('状态 03 · 夺冠晋级',1);points(c,0,'新联赛已开启，积分从0开始');primary(c,'查看新联赛');rounds(c,false,['已晋级','已夺冠'],-1);cupTitle(c,'新秀晋级杯','夺冠成功，已晋级俱乐部选手！');
text(c.cup,'冠军结果标记','本角色已夺冠',850,430,18,GREEN,false);
var e=makeState('状态 04 · 最高级夺冠',5);points(e,100,'已达最高级，联赛仍可挑战');primary(e,'再次挑战');rounds(e,true,['已晋级','已晋级','已夺冠'],-1);cupTitle(e,'冠军大师杯','已达最高级，可再次挑战大师杯。');
text(e.cup,'冠军结果标记','本角色已夺冠',850,430,18,GREEN,false);
for(var j=0;j<states.length;j++)states[j].root.visible=false;
var original=D.layerComps.add('00 默认 · 积分不足','保留用户原始显示；切换状态请使用图层复合。',true,true,true);
for(var j=0;j<base.length;j++)base[j].visible=false;
var comps=[];
for(var j=0;j<states.length;j++){states[j].root.visible=true;comps.push(D.layerComps.add(states[j].root.name,'状态预览，实际数值读取游戏存档；文字、按钮、图标独立。',true,true,true));states[j].root.visible=false;}
original.apply();D.save();
var out=new Folder(ROOT+'/states');out.create();
var names=['01-杯赛已开放','02-三轮赛程进行中','03-夺冠晋级','04-最高级夺冠'];
for(var j=0;j<comps.length;j++){
 comps[j].apply();app.refresh();var temp=D.duplicate('状态预览临时副本',false);temp.flatten();var po=new PNGSaveOptions();temp.saveAs(new File(out+'/'+names[j]+'.png'),po,true,Extension.LOWERCASE);temp.close(SaveOptions.DONOTSAVECHANGES);app.activeDocument=D;
}
original.apply();D.save();
