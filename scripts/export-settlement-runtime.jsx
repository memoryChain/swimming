#target photoshop
// 从当前定稿导出透明切图；不保存或改写源 PSD，不导出概念场景背景。
var project = File($.fileName).parent.parent.fsName;
var dest = new Folder(project + '/assets/race/ui/settlement-v1'); dest.create();
var source = app.activeDocument;
if (source.width.as('px') !== 1672 || !source.layerSets.getByName('01_个人成绩与荣誉')) throw Error('请先激活结算最终 PSD');
function find(p,n){for(var i=0;i<p.layers.length;i++){var l=p.layers[i];if(l.name===n)return l;if(l.typename==='LayerSet'){var f=find(l,n);if(f)return f;}}return null;}
function clean(p,hide){for(var i=0;i<p.layers.length;i++){var l=p.layers[i];if(l.typename==='LayerSet')clean(l,hide);if(l.typename==='ArtLayer'&&l.kind===LayerKind.TEXT)l.visible=false;for(var j=0;j<hide.length;j++)if(hide[j]===l.name)l.visible=false;}}
function out(name,branch,hide,box){
 app.activeDocument=source;var d=source.duplicate('临时切图-'+name);
 try{for(var i=0;i<d.layers.length;i++)d.layers[i].visible=false;
 var g=d;for(var j=0;j<branch.length;j++){g=find(g,branch[j]);if(!g)throw Error('缺少图层 '+branch[j]);}
 g.visible=true;var p=g;while(p.parent.typename!=='Document'){var par=p.parent;par.visible=true;for(var j=0;j<par.layers.length;j++)if(par.layers[j]!==p)par.layers[j].visible=false;p=par;}
 if(g.typename==='LayerSet')clean(g,hide);
 // 保留源形状的填充不透明度，否则矢量实色描边会一并消失，只剩外发光。
 if(name==='row-self'){d.activeLayer=g;g.rasterize(RasterizeType.ENTIRELAYER);}
 d.crop(box);d.saveAs(new File(dest.fsName+'/'+name+'.png'),new PNGSaveOptions(),true,Extension.LOWERCASE);
 }finally{d.close(SaveOptions.DONOTSAVECHANGES);app.activeDocument=source;}
}
var titles=['冠军','亚军','季军','其他名次'], ids=['gold','silver','bronze','normal'];
for(var i=0;i<4;i++){
 var state='状态0'+(i+1)+'_'+titles[i]+'（底图·称号·徽章）';
 var badge=i<3?'徽章 / '+titles[i]+' / 主体120px':'徽章 / 普通名次（共用绶带·可编辑数字）';
 out('honor-'+ids[i],['01_个人成绩与荣誉',state],[badge],[104,47,742,177]);
 out('medal-'+ids[i],['01_个人成绩与荣誉',state,badge],[],[42,8,170,200]);
}
var rows=['01_王志刚_专属底色','02_小鲸3949（我）_专属底色','03_浪花33_专属底色','04_海风07_普通底色'];
for(var i=0;i<4;i++){
 var y=134+i*70;
 out('row-'+ids[i],['02_排行榜',rows[i]],['0'+(i+1)+'_名次头像','徽章 / '+(i+1)+' / 统一绶带','本人标记 / 醒目蓝色描边'],[1000,y,1615,y+68]);
}
out('row-self',['02_排行榜',rows[1],'本人标记 / 醒目蓝色描边'],[],[975,179,1641,296]);
out('table-header',['02_排行榜','00_深色表头'],[],[1000,78,1615,122]);
out('wave',['01_个人成绩与荣誉','共用文字与指标（名次状态之外）','图标 / 水波纹'],[],[335,203,363,226]);
app.activeDocument=source;
