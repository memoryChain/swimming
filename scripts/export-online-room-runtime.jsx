#target photoshop
// 只读源稿；每张切图在工作副本上隐藏所有文字后导出。
var root=File($.fileName).parent.parent.fsName;
var dest=new Folder(root+'/assets/race/ui/online-room-v1');dest.create();
var source=app.documents.getByName('划水大师-联机-1280x720-v6-成员已准备.psd');
function find(parent,name){for(var i=0;i<parent.layers.length;i++){var l=parent.layers[i];if(l.name===name)return l;if(l.typename==='LayerSet'){var f=find(l,name);if(f)return f;}}return null;}
function clean(group,hide){for(var i=0;i<group.layers.length;i++){var l=group.layers[i];if(l.typename==='ArtLayer'&&l.kind===LayerKind.TEXT)l.visible=false;for(var j=0;j<hide.length;j++)if(hide[j]===l.name)l.visible=false;if(l.typename==='LayerSet')clean(l,hide);}}
function out(name,target,hide,box){
    app.activeDocument=source;var d=source.duplicate('切图临时工作副本');
    for(var i=0;i<d.layers.length;i++)d.layers[i].visible=false;
    var g=target instanceof Array?find(find(d,target[0]),target[1]):find(d,target);g.visible=true;var p=g.parent;while(p.typename!=='Document'){p.visible=true;p=p.parent;}
    // 父组只保留目标分支。
    p=g;while(p.parent.typename!=='Document'){var par=p.parent;for(var k=0;k<par.layers.length;k++)if(par.layers[k]!==p)par.layers[k].visible=false;p=par;}
    if(g.typename==='LayerSet')clean(g,hide);
    d.crop([box[0],box[1],box[2],box[3]]);
    d.saveAs(new File(dest.fsName+'/'+name+'.png'),new PNGSaveOptions(),true,Extension.LOWERCASE);
    d.close(SaveOptions.DONOTSAVECHANGES);
}
out('host-panel','03 房主信息卡',['赛制选择／收起态','房主头像／高清智能对象'],[64,84,468,606]);
out('members-panel','成员区底板／顶边102 底边592',[],[468,98,1228,606]);
var strip=['玩家头像／可替换高清智能对象','头像浅色背景','头像白色圆框','头像轻阴影','状态底板／无文字'];
out('member-host','01号成员位／房主',strip,[493,158,671,374]);
out('member-ready','02号成员位／已加入',strip,[675,158,853,374]);
out('member-idle','03号成员位／已加入',strip,[857,158,1035,374]);
out('member-empty','04号成员位／空位',[],[1039,158,1217,374]);
out('badge-host',['01号成员位／房主','状态底板／无文字'],[],[524,333,640,358]);
out('badge-ready',['02号成员位／已加入','状态底板／无文字'],[],[706,333,822,358]);
out('badge-idle',['03号成员位／已加入','状态底板／无文字'],[],[888,333,1004,358]);
out('avatar-ring',['01号成员位／房主','头像白色圆框'],[],[543,190,621,268]);
out('exit-button','05B 退出房间／大厅联机按钮加宽',[],[696,608,906,710]);
out('cancel-ready','05A 成员主按钮／原斜切造型',[],[922,608,1254,710]);
out('mode-panel','赛制选择／收起态',['上拉箭头'],[102,514,430,580]);
out('popup','08 玩家操作弹窗（深色／当前展示，可隐藏）',['踢出操作暗红底／无文字'],[678,252,886,384]);
out('danger-button','踢出操作暗红底／无文字',[],[698,328,866,360]);
out('drawer','06 赛制抽屉展开态（默认隐藏）',['选中对勾','当前赛制高亮'],[90,319,441,525]);
app.activeDocument=source;
