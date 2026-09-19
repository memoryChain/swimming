#target photoshop
// 中文统一为苹方-简·中粗体（Semibold），保留数字与英文原字体和用户最新布局。
var D=app.documents.getByName('生涯之路.psd'),S=stringIDToTypeID,C=charIDToTypeID;
if(D.fullName.fsName.indexOf('/art/career-ui/')<0)throw Error('文档路径不符');
app.activeDocument=D;
var backup=new File('/Users/abao/Documents/GitHub/swimming/art/career-ui/source/中文统一苹方前备份.psd'),save=new PhotoshopSaveOptions();save.layers=true;D.saveAs(backup,save,true,Extension.LOWERCASE);
function bounds(l){var a=[];for(var i=0;i<4;i++)a.push(l.bounds[i].as('px'));return a;}
function collect(o){var a=[];for(var i=0;i<o.layers.length;i++){var l=o.layers[i];if(l.typename==='LayerSet')a=a.concat(collect(l));else if(l.kind===LayerKind.TEXT&&/[\u3400-\u9fff]/.test(l.textItem.contents))a.push(l);}return a;}
var list=collect(D),audit=[];
for(var k=0;k<list.length;k++){
 var l=list[k],bb=bounds(l),str=l.textItem.contents,center=l.textItem.justification===Justification.CENTER;
 var ref=new ActionReference();ref.putProperty(S('property'),S('textKey'));ref.putIdentifier(S('layer'),l.id);var td=executeActionGet(ref).getObjectValue(S('textKey')),old=td.getList(S('textStyleRange')),out=new ActionList();
 for(var i=0;i<old.count;i++){
  var rr=old.getObjectValue(i),start=rr.getInteger(S('from')),end=rr.getInteger(S('to'));
  for(var j=start;j<end;j++){
   var r=new ActionDescriptor(),st=rr.getObjectValue(S('textStyle'));r.putInteger(S('from'),j);r.putInteger(S('to'),j+1);
   if(j<str.length&&/[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/.test(str.charAt(j))){st.putString(S('fontPostScriptName'),'PingFangSC-Semibold');st.putString(S('fontName'),'PingFang SC');st.putString(S('fontStyleName'),'Semibold');st.putBoolean(S('syntheticBold'),false);st.putBoolean(S('syntheticItalic'),false);}
   // 保留先前明确指定的数字 Arial Black，包括禁用按钮中间的数字。
   if(l.id===646&&j<str.length&&/[0-9]/.test(str.charAt(j))){st.putString(S('fontPostScriptName'),'Arial-Black');st.putString(S('fontName'),'Arial');st.putString(S('fontStyleName'),'Black');st.putBoolean(S('syntheticBold'),false);}
   r.putObject(S('textStyle'),S('textStyle'),st);out.putObject(S('textStyleRange'),r);
  }
 }
 td.putList(S('textStyleRange'),out);var a=new ActionDescriptor(),r=new ActionReference();r.putIdentifier(S('textLayer'),l.id);a.putReference(C('null'),r);a.putObject(C('T   '),S('textLayer'),td);executeAction(C('setd'),a,DialogModes.NO);
 var nb=bounds(l);l.translate(center?(bb[0]+bb[2]-nb[0]-nb[2])/2:bb[0]-nb[0],(bb[1]+bb[3]-nb[1]-nb[3])/2);
 audit.push({id:l.id,text:str});
}
D.save();
