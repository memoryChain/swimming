#target photoshop
// 从当前大厅定稿的临时副本导出，不保存或修改源文档。
var project = File($.fileName).parent.parent.fsName;
var dest = new Folder(project + '/assets/race/ui/lobby-b'); dest.create();
var source = app.activeDocument;
if (source.width.as('px') !== 1280 || source.name.indexOf('大厅-B版') < 0) throw Error('请激活大厅 B 版 1280×720 PSD');
function find(p,id){for(var i=0;i<p.layers.length;i++){var l=p.layers[i];if(l.id===id)return l;if(l.typename==='LayerSet'){var f=find(l,id);if(f)return f;}}return null;}
function clean(p,hide){for(var i=0;i<p.layers.length;i++){var l=p.layers[i];if(l.typename==='LayerSet')clean(l,hide);if(l.typename==='ArtLayer'&&l.kind===LayerKind.TEXT)l.visible=false;for(var j=0;j<hide.length;j++)if(hide[j]===l.id)l.visible=false;}}
function out(name,id,hide,box){
 if(typeof LOBBY_EXPORT_ONLY!=='undefined' && LOBBY_EXPORT_ONLY && name!==LOBBY_EXPORT_ONLY)return;
 app.activeDocument=source;var d=source.duplicate('临时导出-'+name);
 try {for(var i=0;i<d.layers.length;i++)d.layers[i].visible=false;
 var g=find(d,id);if(!g)throw Error('缺少图层 '+id);g.visible=true;var p=g;
 while(p.parent.typename!=='Document'){var par=p.parent;par.visible=true;for(var j=0;j<par.layers.length;j++)if(par.layers[j]!==p)par.layers[j].visible=false;p=par;}
 if(g.typename==='LayerSet')clean(g,hide);
 // 箭头原层无描边。复制到独立透明文档，避免继承按钮父组的白色外框样式。
 if(name==='arrow'){
  var isolated=app.documents.add(1280,720,72,'临时无父组箭头',NewDocumentMode.RGB,DocumentFill.TRANSPARENT);
  app.activeDocument=d;g.duplicate(isolated,ElementPlacement.PLACEATBEGINNING);
  d.close(SaveOptions.DONOTSAVECHANGES);d=isolated;app.activeDocument=d;
 }
 d.crop(box);d.saveAs(new File(dest.fsName+'/'+name+'.png'),new PNGSaveOptions(),true,Extension.LOWERCASE);
 }finally{d.close(SaveOptions.DONOTSAVECHANGES);app.activeDocument=source;}
}
out('background',3,[],[0,0,1280,720]);
out('career-card',377,[360,357,392,399,387],[809,160,1258,410]);
out('career-badge',357,[],[1028,117,1234,309]);
out('career-button',392,[389],[809,409,1250,500]);
out('arrow',389,[],[1199,439,1223,469]);
out('progress-track',387,[],[842,354,1212,364]);
out('progress-fill',399,[],[842,354,1107,364]);
out('quick-button',293,[],[902,516,1254,618]);
out('quick-icon',418,[],[947,542,985,585]);
out('character-button',55,[],[318,600,581,670]);
out('character-info',12,[],[17,199,250,473]);
out('skill-base',523,[],[64,452,138,526]);
out('skill-breath',520,[],[78,466,124,510]);
app.activeDocument=source;
