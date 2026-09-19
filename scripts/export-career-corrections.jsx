#target photoshop
// 保留原稿色彩空间、混合关系与调色层；不要复制到使用工作色彩空间的新空白文档。
(function(){
var src=app.activeDocument;
if(src.name!=='生涯之路.psd')throw Error('请激活生涯之路.psd');
var dest=File($.fileName).parent.parent+'/assets/race/ui/career-v1/';
var kind=typeof CAREER_CORRECTION_EXPORT==='undefined'?'background':CAREER_CORRECTION_EXPORT;
if(kind==='panel-white'){
 var panel=app.open(new File(dest+'panel.png'));
 try{panel.selection.selectAll();var white=new SolidColor();white.rgb.red=white.rgb.green=white.rgb.blue=255;panel.selection.fill(white,ColorBlendMode.NORMAL,100,true);panel.selection.deselect();panel.saveAs(new File(dest+'panel-white.png'),new PNGSaveOptions(),true,Extension.LOWERCASE);}
 finally{panel.close(SaveOptions.DONOTSAVECHANGES);app.activeDocument=src;}return;
}
if(kind==='cup'){
 var trophy=app.open(new File(File($.fileName).parent.parent+'/art/career-ui/assets/cup-redrawn.png'));
 try{trophy.trim(TrimType.TRANSPARENT,true,true,true,true);var w=trophy.width.as('px'),h=trophy.height.as('px'),scale=320/Math.max(w,h);trophy.resizeImage(UnitValue(Math.round(w*scale),'px'),UnitValue(Math.round(h*scale),'px'),72,ResampleMethod.BICUBICSHARPER);trophy.saveAs(new File(dest+'cup.png'),new PNGSaveOptions(),true,Extension.LOWERCASE);}
 finally{trophy.close(SaveOptions.DONOTSAVECHANGES);app.activeDocument=src;}
 return;
}
var tags={
 'tag-active':['05 当前出场 · 两赛事共用','出场状态底',[484,239,572,269]],
 'tag-account':['06 联赛挑战 · 账号共享','账号标签底',[418,326,521,362]],
 'tag-character':['07 晋级杯 · 角色专属','角色标签底',[848,326,954,362]]
};
if(tags[kind]){
 var spec=tags[kind],tmp=src.duplicate('标签原稿切图-'+kind,false);
 try{
  for(var k=0;k<tmp.layers.length;k++)tmp.layers[k].visible=tmp.layers[k].name===spec[0]||tmp.layers[k].name==='曲线 1';
  var group=tmp.layers.getByName(spec[0]);
  for(var k=0;k<group.layers.length;k++)group.layers[k].visible=group.layers[k].name===spec[1];
  tmp.crop(spec[2]);tmp.convertProfile('sRGB IEC61966-2.1',Intent.RELATIVECOLORIMETRIC,true,false);
  tmp.resizeImage(UnitValue((spec[2][2]-spec[2][0])*2,'px'),UnitValue((spec[2][3]-spec[2][1])*2,'px'),72,ResampleMethod.BICUBIC);
  tmp.saveAs(new File(dest+kind+'.png'),new PNGSaveOptions(),true,Extension.LOWERCASE);
 }finally{tmp.close(SaveOptions.DONOTSAVECHANGES);app.activeDocument=src;}
 return;
}
var d=src.duplicate('生涯校正导出-'+kind,false);
try{
 for(var i=0;i<d.layers.length;i++)d.layers[i].visible=d.layers[i].name==='曲线 1'||d.layers[i].name===(kind==='background'?'01 背景 · 运动展示空间':'03 六阶晋升路线');
 if(kind==='route'){
  function filter(p){for(var j=0;j<p.layers.length;j++){var l=p.layers[j];if(l.typename==='LayerSet'){l.visible=true;filter(l);}else l.visible=l.name==='连线路径'||l.name==='当前段连接'||l.name==='节点内面'||l.name==='间隔节点';}}
  filter(d.layers.getByName('03 六阶晋升路线'));d.crop([146,140,1136,150]);
 }
 d.convertProfile('sRGB IEC61966-2.1',Intent.RELATIVECOLORIMETRIC,true,false);
 d.saveAs(new File(dest+(kind==='background'?'background':'route')+'.png'),new PNGSaveOptions(),true,Extension.LOWERCASE);
}finally{d.close(SaveOptions.DONOTSAVECHANGES);app.activeDocument=src;}

})();
