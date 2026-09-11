#target photoshop
// 导出当前 PS 结算稿的顶层本人描边，保留源填充和图层样式，不保存源稿。
(function(){
 var source=app.activeDocument;
 if(source.width.as('px')!==1672||source.height.as('px')!==941)throw Error('请激活1672×941结算定稿');
 var project=File($.fileName).parent.parent.fsName;
 var d=source.duplicate('临时导出本人绿色框');
 try{
  for(var i=0;i<d.layers.length;i++)d.layers[i].visible=false;
  var group=null;
  for(var i=0;i<d.layerSets.length;i++)if(d.layerSets[i].name.indexOf('02_排行榜')===0)group=d.layerSets[i];
  if(!group)throw Error('缺少排行榜图层组');
  group.visible=true;var target=null;
  for(var i=0;i<group.layers.length;i++){var l=group.layers[i];l.visible=false;if(l.name==='本人标记 / 醒目蓝色描边')target=l;}
  if(!target)throw Error('缺少排行榜顶层本人描边');
  target.visible=true;d.activeLayer=target;
  // 当前源稿填充为0，描边由样式产生；不能沿用旧稿假设改写填充值。
  target.rasterize(RasterizeType.ENTIRELAYER);
  d.crop([975,179,1641,296]);
  d.saveAs(new File(project+'/assets/race/ui/settlement-v1/row-self.png'),new PNGSaveOptions(),true,Extension.LOWERCASE);
 }finally{d.close(SaveOptions.DONOTSAVECHANGES);app.activeDocument=source;}
})();
