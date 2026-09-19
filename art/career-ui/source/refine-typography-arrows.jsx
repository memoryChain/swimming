#target photoshop
// 在当前主稿中校正文字与箭头；仅运行一次，保留用户页眉组件。
var D=app.activeDocument,S=stringIDToTypeID,C=charIDToTypeID;
if(D.fullName.fsName.indexOf('/art/career-ui/生涯之路.psd')<0)throw Error('当前文档不是主稿');
function find(o,id){for(var i=0;i<o.layers.length;i++){var l=o.layers[i];if(l.id===id)return l;if(l.typename==='LayerSet'){var q=find(l,id);if(q)return q;}}return null;}
function b(l){var a=[];for(var j=0;j<4;j++)a.push(l.bounds[j].as('px'));return a;}
function align(l,x,y,center){var a=b(l);l.translate(x===null?0:x-(center?(a[0]+a[2])/2:a[0]),y-(a[1]+a[3])/2);}
function font(id,name,size,x,y,center){var l=find(D,id),t=l.textItem;t.font=name;t.fauxBold=false;t.fauxItalic=false;if(size)t.size=size;align(l,x,y,center);return l;}
var bold='ShuiMasterUI-SemiBold',regular='ShuiMasterUI-Regular';
font(681,bold,35,105,38,false).name='TEXT / 页面标题 · 生涯';
font(692,bold,30,1111,53,true);
font(515,bold,23,720,255,false);
font(533,bold,34,664,493,false);
font(535,bold,22,718,497,false);
font(511,bold,18,534.5,254.5,true);
align(find(D,513),604,255,false);
font(517,bold,22,1152,255,false);
font(524,bold,18,469.5,344,true);
font(615,bold,18,901,344,true);
font(526,bold,38,420,392,false);
font(617,bold,38,850,392,false);
font(528,regular,21,421,436,false);
font(531,bold,20,427,493,false);
font(539,regular,18,426,553,false);
font(622,bold,23,866,477,false);
font(628,bold,23,1088,477,false);
font(624,regular,18,866,506,false);
font(630,regular,18,1088,506,false);
font(626,regular,18,866,532,false);
font(632,regular,18,1088,532,false);
font(635,regular,18,850,574,false);
var main=font(608,bold,32,0,624,false),mb=b(main),mw=mb[2]-mb[0],mainStart=599-(mw+16+28)/2;align(main,mainStart,624,false);
var disabled=font(646,bold,27,0,628,false),db=b(disabled),dw=db[2]-db[0],start=1035.5-(22+18+dw)/2;align(disabled,start+40,628,false);
var dx=start-931,dy=628-625.5;var locks=[641,642,643,644];for(var i=0;i<locks.length;i++)find(D,locks[i]).translate(dx,dy);
function rgb(v){var r=new ActionDescriptor();r.putDouble(C('Rd  '),v[0]);r.putDouble(C('Grn '),v[1]);r.putDouble(C('Bl  '),v[2]);return r;}
function arrow(oldId,cx,cy,w,h,v){
 var old=find(D,oldId),parent=old.parent,n=old.name+' · 圆角矢量';
 var t=5.5,pts=[[-w/2,-t/2],[w/2-h/2-1,-t/2],[w/2-h/2-3,-h/2+3],[w/2-h/2,-h/2],[w/2,0],[w/2-h/2,h/2],[w/2-h/2-3,h/2-3],[w/2-h/2-1,t/2],[-w/2,t/2]];
 var ar=[],r=1.5;
 for(var i=0;i<pts.length;i++){
  var p=pts[i],prev=pts[(i+pts.length-1)%pts.length],next=pts[(i+1)%pts.length];
  var u=[prev[0]-p[0],prev[1]-p[1]],v2=[next[0]-p[0],next[1]-p[1]],a=Math.sqrt(u[0]*u[0]+u[1]*u[1]),bb=Math.sqrt(v2[0]*v2[0]+v2[1]*v2[1]),rr=Math.min(r,a/3,bb/3);
  var pa=[cx+p[0]+u[0]/a*rr,cy+p[1]+u[1]/a*rr],pb=[cx+p[0]+v2[0]/bb*rr,cy+p[1]+v2[1]/bb*rr],q=[cx+p[0],cy+p[1]];
  var A=new PathPointInfo();A.kind=PointKind.CORNERPOINT;A.anchor=pa;A.leftDirection=pa;A.rightDirection=[pa[0]+(q[0]-pa[0])*2/3,pa[1]+(q[1]-pa[1])*2/3];ar.push(A);
  var B=new PathPointInfo();B.kind=PointKind.CORNERPOINT;B.anchor=pb;B.leftDirection=[pb[0]+(q[0]-pb[0])*2/3,pb[1]+(q[1]-pb[1])*2/3];B.rightDirection=pb;ar.push(B);
 }
 var sub=new SubPathInfo();sub.closed=true;sub.operation=ShapeOperation.SHAPEADD;sub.entireSubPath=ar;
 var path=D.pathItems.add(n,[sub]);var desc=new ActionDescriptor(),ref=new ActionReference();ref.putClass(S('contentLayer'));desc.putReference(C('null'),ref);var use=new ActionDescriptor(),fill=new ActionDescriptor();fill.putObject(C('Clr '),S('RGBColor'),rgb(v));use.putObject(C('Type'),S('solidColorLayer'),fill);desc.putObject(C('Usng'),S('contentLayer'),use);executeAction(C('Mk  '),desc,DialogModes.NO);var l=D.activeLayer;l.name=n;l.move(old,ElementPlacement.PLACEBEFORE);path.remove();old.remove();return l;
}
arrow(609,mainStart+mw+16+14,624,28,24,[9,25,67]);
arrow(518,1223,255,28,24,[9,25,67]);
arrow(633,1037,501,28,24,[106,142,186]);
D.save();
