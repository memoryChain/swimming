#target photoshop
// 本轮局部修订记录，仅适用于修订前图层 ID；不要重复执行。
var D=app.activeDocument,S=stringIDToTypeID,C=charIDToTypeID;
if(D.fullName.fsName.indexOf('/art/career-ui/生涯之路.psd')<0)throw Error('当前文档不是主稿');
function find(o,id){for(var i=0;i<o.layers.length;i++){var l=o.layers[i];if(l.id===id)return l;if(l.typename==='LayerSet'){var q=find(l,id);if(q)return q;}}return null;}
function b(l){var a=[];for(var j=0;j<4;j++)a.push(l.bounds[j].as('px'));return a;}
function align(l,x,y,center){var a=b(l);l.translate(x===null?0:x-(center?(a[0]+a[2])/2:a[0]),y-(a[1]+a[3])/2);}
function rgb(v){var a=new ActionDescriptor();a.putDouble(C('Rd  '),v[0]);a.putDouble(C('Grn '),v[1]);a.putDouble(C('Bl  '),v[2]);return a;}
function fill(l,v){D.activeLayer=l;var a=new ActionDescriptor(),r=new ActionReference();r.putEnumerated(S('contentLayer'),C('Ordn'),C('Trgt'));a.putReference(C('null'),r);var q=new ActionDescriptor();q.putObject(C('Clr '),S('RGBColor'),rgb(v));a.putObject(C('T   '),S('solidColorLayer'),q);executeAction(C('setd'),a,DialogModes.NO);}
function shape(g,n,x,y,w,h,r,v){var a=new ActionDescriptor(),ref=new ActionReference();ref.putClass(S('contentLayer'));a.putReference(C('null'),ref);var use=new ActionDescriptor(),type=new ActionDescriptor();type.putObject(C('Clr '),S('RGBColor'),rgb(v));use.putObject(C('Type'),S('solidColorLayer'),type);var sh=new ActionDescriptor();sh.putUnitDouble(C('Top '),C('#Pxl'),y);sh.putUnitDouble(C('Left'),C('#Pxl'),x);sh.putUnitDouble(C('Btom'),C('#Pxl'),y+h);sh.putUnitDouble(C('Rght'),C('#Pxl'),x+w);sh.putUnitDouble(C('Rds '),C('#Pxl'),r);use.putObject(C('Shp '),C('Rctn'),sh);a.putObject(C('Usng'),S('contentLayer'),use);executeAction(C('Mk  '),a,DialogModes.NO);var l=D.activeLayer;l.name=n;l.move(g,ElementPlacement.INSIDE);return l;}
function digits(id){var l=find(D,id),r=new ActionReference();r.putProperty(S('property'),S('textKey'));r.putIdentifier(S('layer'),id);var td=executeActionGet(r).getObjectValue(S('textKey')),old=td.getList(S('textStyleRange')),out=new ActionList(),str=l.textItem.contents;
for(var i=0;i<old.count;i++){var range=old.getObjectValue(i),start=range.getInteger(S('from')),end=range.getInteger(S('to'));for(var j=start;j<end;j++){var rr=new ActionDescriptor(),st=range.getObjectValue(S('textStyle'));rr.putInteger(S('from'),j);rr.putInteger(S('to'),j+1);if(j<str.length&&/[0-9]/.test(str.charAt(j))){st.putString(S('fontPostScriptName'),'Arial-Black');st.putString(S('fontName'),'Arial');st.putString(S('fontStyleName'),'Black');st.putBoolean(S('syntheticBold'),false);st.putBoolean(S('syntheticItalic'),false);}rr.putObject(S('textStyle'),S('textStyle'),st);out.putObject(S('textStyleRange'),rr);}}
td.putList(S('textStyleRange'),out);var desc=new ActionDescriptor(),ref=new ActionReference();ref.putIdentifier(S('textLayer'),id);desc.putReference(C('null'),ref);desc.putObject(C('T   '),S('textLayer'),td);executeAction(C('setd'),desc,DialogModes.NO);return l;}
var ids=[692,515,533,535];for(var i=0;i<ids.length;i++){var l=find(D,ids[i]);l.textItem.font='Arial-Black';l.textItem.fauxBold=false;}
align(find(D,692),1111,53,true);align(find(D,515),720,255,false);align(find(D,533),664,493,false);align(find(D,535),718,497,false);
align(digits(528),421,436,false);align(digits(624),866,506,false);align(digits(630),1088,506,false);
fill(find(D,509),[172,235,184]);var green=new SolidColor();green.rgb.red=29;green.rgb.green=108;green.rgb.blue=60;find(D,511).textItem.color=green;
fill(find(D,613),[202,234,252]);
// 两个按钮使用相同 70 px 总高、圆角、压边与波点；右侧保留禁用配色。
var g=find(D,636),bottomOld=find(D,638),topOld=find(D,639),faceOld=find(D,640);
var bottom=shape(g,'底部厚度',839,594,393,66,18,[133,156,188]);bottom.move(bottomOld,ElementPlacement.PLACEBEFORE);bottomOld.remove();
var rim=shape(g,'浅色上缘',839,590,393,66,18,[206,218,233]);rim.move(topOld,ElementPlacement.PLACEBEFORE);topOld.remove();
var face=shape(g,'按钮面',841,593,389,61,16,[180,195,217]);face.move(faceOld,ElementPlacement.PLACEBEFORE);faceOld.remove();
var dots=find(D,545).duplicate();dots.move(face,ElementPlacement.PLACEBEFORE);dots.name='渐隐波点 · 禁用';dots.translate(436.5,0);dots.move(face,ElementPlacement.PLACEBEFORE);for(var i=0;i<dots.artLayers.length;i++)fill(dots.artLayers[i],[132,157,189]);dots.opacity=55;
var txt=find(D,646);txt.textItem.size=32;digits(646);var bb=b(txt),w=bb[2]-bb[0],left=1035.5-(22+18+w)/2;align(txt,left+40,624,false);
var lock=find(D,643),lb=b(lock),dx=left-lb[0],dy=624-628;var li=[641,642,643,644];for(var i=0;i<li.length;i++)find(D,li[i]).translate(dx,dy);
D.save();
