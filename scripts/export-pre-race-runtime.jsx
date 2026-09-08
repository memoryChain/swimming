#target photoshop
// 从当前已打开的定稿导出；原 PSD 保持可编辑且不被改写。
var root = File($.fileName).parent.parent.fsName;
var dest = new Folder(root + '/assets/race/ui/pre-race-v1');
dest.create();
var source = app.documents.getByName('划水大师-比赛开场-1290x720.psd');
if (source.width.as('px') !== 1290 || source.height.as('px') !== 720) throw Error('开场源稿尺寸不匹配');
function find(parent, name) {
    for (var i = 0; i < parent.layers.length; i++) {
        var l = parent.layers[i];
        if (l.name === name) return l;
        if (l.typename === 'LayerSet') { var f = find(l, name); if (f) return f; }
    }
    return null;
}
function strip(parent, keep) {
    for (var i = 0; i < parent.layers.length; i++) {
        var l = parent.layers[i];
        if (l.typename === 'LayerSet') strip(l, keep);
        else { var allowed = false; for (var j = 0; j < keep.length; j++) if (keep[j] === l.name) allowed = true; l.visible = l.kind !== LayerKind.TEXT && allowed; }
    }
}
function out(name, target, keep, box) {
    app.activeDocument = source;
    var d = source.duplicate('开场切图临时副本');
    try {
        for (var i = 0; i < d.layers.length; i++) d.layers[i].visible = false;
        var g = find(d, target);
        if (!g) throw Error('缺少图层：' + target);
        var p = g;
        while (p.typename !== 'Document') {
            p.visible = true;
            for (var k = 0; k < p.parent.layers.length; k++) if (p.parent.layers[k] !== p) p.parent.layers[k].visible = false;
            p = p.parent;
        }
        strip(g, keep);
        d.crop(box);
        d.saveAs(new File(dest.fsName + '/' + name + '.png'), new PNGSaveOptions(), true, Extension.LOWERCASE);
    } finally {
        d.close(SaveOptions.DONOTSAVECHANGES);
        app.activeDocument = source;
    }
}
out('event-strip', '02_赛制长条｜入场阶段A', ['分隔｜赛制与规则','装饰｜左侧青色强调','底｜右侧深灰规则区','底｜浅灰白赛制长条'], [43,353,600,423]);
out('card-normal', '泳道1｜水中蛟龙', ['底｜昵称区','底｜成员卡'], [43,435,183,672]);
out('card-self', '泳道5｜小鸭2153｜本人', ['底｜昵称区','底｜本人卡内层','本人｜金色底边','底｜成员卡'], [649,433,793,674]);
out('lane-normal', '泳道号码牌｜1', ['装饰｜顶部识别色','底｜斜切号码牌'], [49,431,92,484]);
out('lane-self', '泳道号码牌｜5', ['装饰｜顶部识别色','底｜斜切号码牌'], [657,431,700,484]);
out('self-tag', '泳道5｜小鸭2153｜本人', ['本人标识底'], [656,615,681,637]);
