#target photoshop
// 从当前已打开的最终主稿导出固定美术提示与蓄力部件；中文提示在运行时使用 Label。
var project = File($.fileName).parent.parent;
var dest = new Folder(project.fsName + '/assets/race/ui/race-start-v1'); dest.create();
var notes = new Folder(project.fsName + '/docs/race-start-ui'); notes.create();
var source = app.documents.getByName('划水大师-比赛HUD-起跑提示与蓄力.psd');
if (source.width.as('px') !== 1290 || source.height.as('px') !== 720) throw Error('起跳主稿尺寸必须为 1290×720');
var c=charIDToTypeID,s=stringIDToTypeID,manifest=[];
function find(p,n){for(var i=0;i<p.layers.length;i++){var l=p.layers[i];if(l.name===n)return l;if(l.typename==='LayerSet'){var f=find(l,n);if(f)return f;}}return null;}
function show(p,v){if(p.typename==='LayerSet')for(var i=0;i<p.layers.length;i++)show(p.layers[i],v);p.visible=v;}
function isolate(d,g){for(var i=0;i<d.layers.length;i++)show(d.layers[i],false);show(g,true);var p=g;while(p.typename!=='Document'){p.visible=true;p=p.parent;}}
function color(v){var z=new ActionDescriptor();z.putDouble(c('Rd  '),v[0]);z.putDouble(c('Grn '),v[1]);z.putDouble(c('Bl  '),v[2]);return z;}
function poly(d,parent,name,pts,v){var a=[];for(var i=0;i<pts.length;i++){var p=new PathPointInfo();p.kind=PointKind.CORNERPOINT;p.anchor=pts[i];p.leftDirection=pts[i];p.rightDirection=pts[i];a.push(p);}var sub=new SubPathInfo();sub.closed=true;sub.operation=ShapeOperation.SHAPEADD;sub.entireSubPath=a;var path=d.pathItems.add('导出临时路径',[sub]);var mk=new ActionDescriptor(),r=new ActionReference();r.putClass(s('contentLayer'));mk.putReference(c('null'),r);var b=new ActionDescriptor(),f=new ActionDescriptor();f.putObject(c('Clr '),c('RGBC'),color(v));b.putObject(c('Type'),s('solidColorLayer'),f);mk.putObject(c('Usng'),s('contentLayer'),b);executeAction(c('Mk  '),mk,DialogModes.NO);var l=d.activeLayer;l.name=name;l.move(parent,ElementPlacement.INSIDE);path.remove();return l;}
function quad(d,g,n,y1,y2,a,b,v){function x(y){return 1234-(y-226)*.2;}return poly(d,g,n,[[x(y1)+a,y1],[x(y1)+b,y1],[x(y2)+b,y2],[x(y2)+a,y2]],v);}
function out(name,target,edit,fixedBox){app.activeDocument=source;var d=source.duplicate('起跳切图临时副本');try{var g=find(d,target);if(!g)throw Error('缺少图层：'+target);isolate(d,g);if(edit)edit(d,g);d.activeLayer=g;app.refresh();d.mergeVisibleLayers();var b=d.activeLayer.bounds;var box=fixedBox||[Math.max(0,Math.floor(b[0].as('px'))-4),Math.max(0,Math.floor(b[1].as('px'))-4),Math.min(1290,Math.ceil(b[2].as('px'))+4),Math.min(720,Math.ceil(b[3].as('px'))+4)];d.crop(box);app.refresh();d.saveAs(new File(dest.fsName+'/'+name+'.png'),new PNGSaveOptions(),true,Extension.LOWERCASE);manifest.push({name:name,x:box[0],y:box[1],width:box[2]-box[0],height:box[3]-box[1]});}finally{d.close(SaveOptions.DONOTSAVECHANGES);app.activeDocument=source;}}
function noHint(d,g){var l=find(g,'提示_可编辑文字');if(l)l.visible=false;}
out('ready','READY_蓝色',noHint);
out('go','GO_黄色');out('late','LATE_START_起跳偏晚');
out('good','GOOD_START_普通起跳');out('great','GREAT_START_优秀起跳');out('perfect','PERFECT_START_完美起跳');
out('charge-track','底槽与图标_共用',function(d,g){for(var i=0;i<g.artLayers.length;i++)if(g.artLayers[i].kind===LayerKind.TEXT)g.artLayers[i].visible=false;});
var states=[['low','低蓄力_橙红',[255,94,54]],['mid','中蓄力_绿色',[133,214,29]],['high','高蓄力_金黄',[255,211,49]]];
for(var i=0;i<states.length;i++){var sp=states[i];out('charge-fill-'+sp[0],sp[1],function(d,g){while(g.artLayers.length)g.artLayers[0].remove();quad(d,g,'完整高度填充',269,502,-11,11,sp[2]);quad(d,g,'完整高度左缘亮面',269,501,-11,-9,[Math.min(255,sp[2][0]+30),Math.min(255,sp[2][1]+24),Math.min(255,sp[2][2]+25)]);},[1166,269,1238,502]);}
out('charge-cap','高蓄力_金黄',function(d,g){for(var i=0;i<g.artLayers.length;i++)g.artLayers[i].visible=g.artLayers[i].name==='当前位置白色标记';},[1209,276,1237,284]);
var file=new File(notes.fsName+'/runtime-export-layout.json');file.encoding='UTF8';file.open('w');file.write('{"canvas":{"width":1290,"height":720},"assets":[');for(var i=0;i<manifest.length;i++){var a=manifest[i];if(i)file.write(',');file.write('{"name":"'+a.name+'","x":'+a.x+',"y":'+a.y+',"width":'+a.width+',"height":'+a.height+'}');}file.write(']}');file.close();
'已导出 '+manifest.length+' 个独立透明部件';
