#target photoshop
// 在临时副本导出基础 HUD；只读取当前定稿，保留主稿选择和隐藏状态。
var root=File($.fileName).parent.parent.fsName;
var dest=new Folder(root+'/assets/race/ui/race-hud-v1');dest.create();
var source=app.documents.getByName('比赛HUD-1280x720.psd');
if(source.width.as('px')!==1280||source.height.as('px')!==720)throw Error('HUD 源稿尺寸不符');
function find(p,n){for(var i=0;i<p.layers.length;i++){var l=p.layers[i];if(l.name===n)return l;if(l.typename==='LayerSet'){var r=find(l,n);if(r)return r;}}return null;}
function out(name,group,leaf,box,mono){
 app.activeDocument=source;var d=source.duplicate('HUD 切图临时副本');
 try{
  d.selection.deselect();
  var target=find(find(d,group),leaf);if(!target)throw Error('缺少图层 '+leaf);
  var p=target;
  while(p.typename!=='Document'){p.visible=true;for(var i=0;i<p.parent.layers.length;i++)if(p.parent.layers[i]!==p)p.parent.layers[i].visible=false;p=p.parent;}
  if(mono)target.opacity=100;
  d.crop(box);
  if(mono){
   d.activeLayer=target;d.artLayers.add();d.mergeVisibleLayers();d.selection.selectAll();var c=new SolidColor();c.rgb.red=255;c.rgb.green=255;c.rgb.blue=255;
   d.selection.fill(c,ColorBlendMode.NORMAL,100,true);d.selection.deselect();
  }
  d.saveAs(new File(dest.fsName+'/'+name+'.png'),new PNGSaveOptions(),true,Extension.LOWERCASE);
 }finally{d.close(SaveOptions.DONOTSAVECHANGES);app.activeDocument=source;}
}
out('status-base','02 心率','半透明底',[22,114,98,190],false);
out('status-ring','02 心率','圆环轨道',[22,114,98,190],true);
out('heart','02 心率','心形剪影',[48,130,74,152],true);
out('lightning','03 体力','闪电剪影',[151,126,172,154],true);
out('warning','02 心率','警示底',[75,110,93,128],false);
out('progress-track','04 泳程','泳程轨道',[467,39,866,51],true);
out('rank-ring','11 排名','第1名头像圈',[1233,84,1263,114],false);
out('rank-self-ring','11 排名','第6名头像圈',[1220,242,1276,298],false);
out('dolphin','起跳可点击','朝左海豚剪影',[1127,430,1170,466],true);
out('jump-ready','起跳可点击','可点击按钮面',[1099,398,1201,500],false);
