#target photoshop
// 将分离的徽章与空白展台分别嵌入，保留原组合插画供追溯。
var D=app.documents.getByName('生涯之路.psd'),S=stringIDToTypeID,C=charIDToTypeID;
app.activeDocument=D;
var root='/Users/abao/Documents/GitHub/swimming/art/career-ui/';
var g=D.layerSets.getByName('04 当前荣誉 · 独立插画与可编辑名称'),old=g.artLayers.getByName('荣誉展台 · 嵌入智能对象');
function place(n,path,x,y,w,h,anchor){var a=new ActionDescriptor();a.putPath(C('null'),new File(path));a.putEnumerated(C('FTcs'),C('QCSt'),C('Qcsa'));executeAction(C('Plc '),a,DialogModes.NO);var l=D.activeLayer;l.name=n;var b=l.bounds,ow=b[2].as('px')-b[0].as('px'),oh=b[3].as('px')-b[1].as('px'),scale=Math.min(w/ow,h/oh)*100;l.resize(scale,scale,AnchorPosition.MIDDLECENTER);b=l.bounds;l.translate(x+(w-(b[2].as('px')-b[0].as('px')))/2-b[0].as('px'),y+(h-(b[3].as('px')-b[1].as('px')))/2-b[1].as('px'));l.move(anchor,ElementPlacement.PLACEBEFORE);return l;}
var podium=place('空白展台 · 独立智能对象',root+'assets/honor-podium.png',27,479,328,118,old);
var badge=place('当前徽章 · 无麦穗 · 独立智能对象',root+'assets/honor-badge.png',62,263,258,258,podium);
old.visible=false;old.name='旧组合插画 · 隐藏备份';
D.save();
