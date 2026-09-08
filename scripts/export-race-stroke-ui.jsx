#target photoshop
// 仅在源稿临时副本导出；文字保留运行时 Label，左右复用左侧切图镜像。
var root=File($.fileName).parent.parent.fsName;
var dest=new Folder(root+'/assets/race/ui/race-stroke-v1');dest.create();
var source=app.documents.getByName('比赛HUD-1280x720.psd');
function find(p,n){for(var i=0;i<p.layers.length;i++){var l=p.layers[i];if(l.name===n)return l;if(l.typename==='LayerSet'){var q=find(l,n);if(q)return q;}}return null;}
function hide(p){for(var i=0;i<p.layers.length;i++){var l=p.layers[i];l.visible=false;if(l.typename==='LayerSet')hide(l);}}
function out(name,group,names,box,band){
 var d=source.duplicate('划水切图临时副本');
 try{hide(d);var g=find(d,group),target;
  for(var j=0;j<names.length;j++){target=find(g,names[j]);if(!target)throw Error(names[j]);var p=target;while(p.typename!=='Document'){p.visible=true;p=p.parent;}}
  if(band){
   d.activeLayer=target;target.opacity=100;
   var r=new ActionReference();r.putIdentifier(charIDToTypeID('Lyr '),target.id);var desc=executeActionGet(r);
   if(desc.hasKey(stringIDToTypeID('hasUserMask'))&&desc.getBoolean(stringIDToTypeID('hasUserMask'))){var set=new ActionDescriptor(),to=new ActionDescriptor();set.putReference(charIDToTypeID('null'),r);to.putBoolean(stringIDToTypeID('userMaskEnabled'),false);set.putObject(charIDToTypeID('T   '),charIDToTypeID('Lyr '),to);executeAction(charIDToTypeID('setd'),set,DialogModes.NO);}
   var fx=new ActionDescriptor(),stroke=new ActionDescriptor(),color=new ActionDescriptor();color.putDouble(charIDToTypeID('Rd  '),204);color.putDouble(charIDToTypeID('Grn '),238);color.putDouble(charIDToTypeID('Bl  '),83);
   stroke.putBoolean(charIDToTypeID('enab'),true);stroke.putEnumerated(charIDToTypeID('Styl'),charIDToTypeID('FStl'),charIDToTypeID('OutF'));stroke.putEnumerated(charIDToTypeID('PntT'),charIDToTypeID('FrFl'),charIDToTypeID('SClr'));stroke.putEnumerated(charIDToTypeID('Md  '),charIDToTypeID('BlnM'),charIDToTypeID('Nrml'));stroke.putUnitDouble(charIDToTypeID('Opct'),charIDToTypeID('#Prc'),100);stroke.putUnitDouble(charIDToTypeID('Sz  '),charIDToTypeID('#Pxl'),1.5);stroke.putObject(charIDToTypeID('Clr '),charIDToTypeID('RGBC'),color);fx.putObject(charIDToTypeID('FrFX'),charIDToTypeID('FrFX'),stroke);
   var overlay=new ActionDescriptor();overlay.putBoolean(charIDToTypeID('enab'),true);overlay.putEnumerated(charIDToTypeID('Md  '),charIDToTypeID('BlnM'),charIDToTypeID('Nrml'));overlay.putUnitDouble(charIDToTypeID('Opct'),charIDToTypeID('#Prc'),100);overlay.putObject(charIDToTypeID('Clr '),charIDToTypeID('RGBC'),color);fx.putObject(charIDToTypeID('SoFi'),charIDToTypeID('SoFi'),overlay);
   var action=new ActionDescriptor(),ref=new ActionReference();ref.putProperty(charIDToTypeID('Prpr'),charIDToTypeID('Lefx'));ref.putIdentifier(charIDToTypeID('Lyr '),target.id);action.putReference(charIDToTypeID('null'),ref);action.putObject(charIDToTypeID('T   '),charIDToTypeID('Lefx'),fx);executeAction(charIDToTypeID('setd'),action,DialogModes.NO);
  }
  d.crop(box);d.saveAs(new File(dest.fsName+'/'+name+'.png'),new PNGSaveOptions(),true,Extension.LOWERCASE);
 }finally{d.close(SaveOptions.DONOTSAVECHANGES);app.activeDocument=source;}
}
out('hand','07 左划按钮',['手掌剪影'],[152,538,203,593],false);
out('button','07 左划按钮',['半透明按钮底','弱化外圈'],[117,513,237,633],false);
out('arc','09 左侧划水节奏',['划水弧线'],[210,397,338,583],false);
out('perfect-band','09 左侧划水节奏',['划水弧线'],[210,397,338,583],true);
out('marker','09 左侧划水节奏',['移动点','移动点底'],[279,444,297,462],false);
