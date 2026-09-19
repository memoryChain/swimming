#target photoshop
// 从已确认概念中拆分独立插画，保留蒙版源稿；不导出游戏运行时资产。
var root=File($.fileName).parent.parent;
var source=new File(root+'/source/已确认概念.png');
var items=[
 ['tier-1',[136,108,250,226]],['tier-2',[394,115,519,228]],
 ['tier-3',[645,108,785,229]],['tier-4',[891,108,1048,228]],
 ['tier-5',[1148,103,1314,230]],['tier-6',[1404,88,1580,231]],
 ['cup',[1404,420,1617,593]]
];
var begin=typeof EXTRACT_BEGIN==='number'?EXTRACT_BEGIN:0;
var end=typeof EXTRACT_END==='number'?EXTRACT_END:items.length;
var result=[];
for(var i=begin;i<end;i++){
 var item=items[i],d=app.open(source);d.crop(item[1]);
 d.activeLayer.isBackgroundLayer=false;d.activeLayer.name=item[0]+' 原画';
 if(i<6){
  var w=d.width.as('px'),h=d.height.as('px'),sy=176-item[1][1];
  var pts=[[1,1],[1,h-2],[w-2,1],[w-2,h-2],[1,sy],[w-2,sy]];
  for(var k=0;k<pts.length;k++){
   var a=new ActionDescriptor(),rr=new ActionReference();rr.putProperty(charIDToTypeID('Chnl'),charIDToTypeID('fsel'));a.putReference(charIDToTypeID('null'),rr);
   var p=new ActionDescriptor();p.putUnitDouble(charIDToTypeID('Hrzn'),charIDToTypeID('#Pxl'),pts[k][0]);p.putUnitDouble(charIDToTypeID('Vrtc'),charIDToTypeID('#Pxl'),pts[k][1]);a.putObject(charIDToTypeID('T   '),charIDToTypeID('Pnt '),p);
   a.putInteger(charIDToTypeID('Tlrn'),35);a.putBoolean(charIDToTypeID('AntA'),true);a.putBoolean(charIDToTypeID('Cntg'),true);a.putBoolean(charIDToTypeID('Mrgd'),false);
   executeAction(charIDToTypeID('setd'),a,DialogModes.NO);
   d.selection.clear();d.selection.deselect();
  }
 }else{
  var a=new ActionDescriptor();a.putBoolean(stringIDToTypeID('sampleAllLayers'),false);
  executeAction(stringIDToTypeID('autoCutout'),a,DialogModes.NO);
 }
 if(i>=6){var m=new ActionDescriptor();m.putClass(charIDToTypeID('Nw  '),charIDToTypeID('Chnl'));
 var r=new ActionReference();r.putEnumerated(charIDToTypeID('Chnl'),charIDToTypeID('Chnl'),charIDToTypeID('Msk '));
 m.putReference(charIDToTypeID('At  '),r);m.putEnumerated(charIDToTypeID('Usng'),charIDToTypeID('UsrM'),charIDToTypeID('RvlS'));
 executeAction(charIDToTypeID('Mk  '),m,DialogModes.NO);d.selection.deselect();}
 if(i===5){
  // 冠军月桂左外侧的孤立深蓝残片，使用明确轮廓清理。
  d.selection.select([[84,10],[97,26],[114,23],[109,44],[124,47],[132,34],[142,43],[145,57],[154,53],[158,77],[149,91],[154,86],[154,104],[140,116],[125,127],[108,133],[84,139],[60,133],[40,133],[26,126],[13,116],[9,100],[14,94],[11,77],[13,56],[22,69],[20,48],[28,36],[37,51],[46,47],[45,29],[55,33],[57,23],[74,28]],SelectionType.REPLACE,0.4,true);
  d.selection.invert();d.selection.clear();d.selection.deselect();
 }
 d.saveAs(new File(root+'/source/'+item[0]+'-蒙版.psd'),new PhotoshopSaveOptions(),true);
 d.saveAs(new File(root+'/assets/'+item[0]+'.png'),new PNGSaveOptions(),true);
 result.push(item[0]);d.close(SaveOptions.DONOTSAVECHANGES);
}
result;
