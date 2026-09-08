#target photoshop
// 用户确认评价字样直接切图；主PSD可编辑文字与隐藏状态均保留。
var root=File($.fileName).parent.parent.fsName;
var source=app.documents.getByName('比赛HUD-1280x720.psd');
var dest=new Folder(root+'/assets/race/ui/race-stroke-v1');dest.create();
var words=['Good','Great','Excellent','Perfect','Amazing','Crazy','Unbelievable'];
function find(p,n){for(var i=0;i<p.layers.length;i++){var l=p.layers[i];if(l.name===n)return l;if(l.typename==='LayerSet'){var r=find(l,n);if(r)return r;}}return null;}
var output=[];
for(var i=0;i<words.length;i++){
 var doc=source.duplicate('评价切图临时副本');
 try{
  var layer=find(doc,(i+1)+' '+words[i]+'｜可编辑');if(!layer)throw Error(words[i]);
  var p=layer;while(p.typename!=='Document'){p.visible=true;for(var j=0;j<p.parent.layers.length;j++)if(p.parent.layers[j]!==p)p.parent.layers[j].visible=false;p=p.parent;}
  var b=layer.bounds,box=[Math.floor(b[0].as('px'))-4,Math.floor(b[1].as('px'))-4,Math.ceil(b[2].as('px'))+4,Math.ceil(b[3].as('px'))+4];
  doc.crop(box);doc.saveAs(new File(dest.fsName+'/praise-'+words[i].toLowerCase()+'.png'),new PNGSaveOptions(),true,Extension.LOWERCASE);
  output.push(words[i]+': '+box.join(',')+' / '+(box[2]-box[0])+'x'+(box[3]-box[1]));
 }finally{doc.close(SaveOptions.DONOTSAVECHANGES);app.activeDocument=source;}
}
output.join('\n');
