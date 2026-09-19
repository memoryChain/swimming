#target photoshop
// 在1280×720生涯主稿中运行。只向临时文档复制待导出分支，不修改主稿。
// 可先设置 CAREER_EXPORT_START / CAREER_EXPORT_END 分批执行。
var project=File($.fileName).parent.parent;
var dest=new Folder(project+'/assets/race/ui/career-v1');dest.create();
var source=app.activeDocument;
if(source.name!=='生涯之路.psd'||source.width.as('px')!==1280)throw Error('请激活生涯主稿');
var entries=[
 ['background',['01 背景 · 运动展示空间'],[],[0,0,1280,720]],
 ['character-bar',['05 当前出场 · 两赛事共用','角色栏'],[],[392,218,1254,292]],
 ['panel',['06 联赛挑战 · 账号共享','联赛主面板'],[],[392,306,808,674]],
 ['button-yellow',['06 联赛挑战 · 账号共享','开始联赛 · 正常'],['按钮文案','右箭头 · 圆角矢量'],[407,590,791,660]],
 ['button-disabled',['07 晋级杯 · 角色专属','晋级杯 · 积分不足禁用'],['按钮文案','锁孔','锁体','锁环内孔','锁环'],[839,590,1236,660]],
 ['arrow',['06 联赛挑战 · 账号共享','开始联赛 · 正常','右箭头 · 圆角矢量'],[],[656,612,683,636]],
 ['lock',['07 晋级杯 · 角色专属','晋级杯 · 积分不足禁用'],['按钮文案','按钮面','浅色上缘','底部厚度','渐隐波点 · 禁用'],[930,608,953,640]],
 ['podium',['04 当前荣誉 · 独立插画与可编辑名称','玩具磨砂展台 · 对比方案'],[],[28,485,355,617]],
 ['cup',['07 晋级杯 · 角色专属','金杯插画'],[],[1086,327,1229,445]],
 ['honor-1',['图层 5'],[],[84,248,313,487]],
 ['progress-track',['06 联赛挑战 · 账号共享','进度底槽'],[],[426,515,776,531]],
 ['progress-fill',['状态 01 · 杯赛已开放','06 联赛挑战 · 账号共享','当前进度 80%'],[],[426,515,776,531]],
];
var begin=0,end=entries.length;
if(typeof CAREER_EXPORT_START!=='undefined')begin=CAREER_EXPORT_START;
if(typeof CAREER_EXPORT_END!=='undefined')end=CAREER_EXPORT_END;
for(var i=begin;i<end;i++){
 var e=entries[i],l=source;
 if(e[0]==='background'||e[0]==='cup'){var CAREER_CORRECTION_EXPORT=e[0];$.evalFile(new File(project+'/scripts/export-career-corrections.jsx'));continue;}
 for(var j=0;j<e[1].length;j++)l=l.layers.getByName(e[1][j]);
 var d=app.documents.add(1280,720,72,'生涯临时切图-'+e[0],NewDocumentMode.RGB,DocumentFill.TRANSPARENT,1,BitsPerChannelType.EIGHT,'sRGB IEC61966-2.1');
 try{
  app.activeDocument=source;
  var copied=l.duplicate(d,ElementPlacement.PLACEATBEGINNING);app.activeDocument=d;copied.visible=true;
  if(copied.typename==='LayerSet')for(var j=0;j<e[2].length;j++)copied.layers.getByName(e[2][j]).visible=false;
  if(e[0]!=='honor-1'){app.activeDocument=source;source.layers.getByName('曲线 1').duplicate(d,ElementPlacement.PLACEATBEGINNING);app.activeDocument=d;}
  d.crop(e[3]);app.refresh();
  // 大徽章需支持约2倍显示，其余按设计尺寸输出。
  if(e[0]==='honor-1')d.resizeImage(458,478,72,ResampleMethod.BICUBIC);
  d.saveAs(new File(dest+'/'+e[0]+'.png'),new PNGSaveOptions(),true,Extension.LOWERCASE);
 }finally{d.close(SaveOptions.DONOTSAVECHANGES);app.activeDocument=source;}
}
