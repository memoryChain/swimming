const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('字体诊断保留原加载/赋值/激活结果，隐藏页面不读取像素且采样总量有界', () => {
    const logs = [], timers = [];
    let loads = 0, enables = 0, fontWrites = 0, pixelReads = 0;
    class Label {
        onEnable() { enables++; return 17; }
        get font() { return this._font; }
        set font(value) { fontWrites++; this._font = value; this.useSystemFont = !value; }
    }
    class UITransform {}
    const cc = { Label, UITransform };
    const adapter = { loadFont(url) { loads++; assert.equal(url, 'native/font.ttf'); return 'test-family'; } };
    const api = {};
    vm.runInNewContext(fs.readFileSync('scripts/templates/taptap-font-diagnostic.js', 'utf8'), {
        exports: api, window: { __globalAdapter: adapter },
        console: { log: line => logs.push(line) }, setTimeout: callback => timers.push(callback)
    });
    api.install(cc); api.install(cc);
    assert.equal(adapter.loadFont('native/font.ttf'), 'test-family');
    assert.equal(loads, 1);
    const page = { name: 'CareerEventPage', isValid: true, activeInHierarchy: true, children: [], getComponent: () => null };
    const node = { name: 'PageTitle', parent: page, activeInHierarchy: true, children: [] };
    const label = new Label(); label.node = node; label.string = '单人快速比赛';
    label.fontSize = label.actualFontSize = 36;
    label.assemblerData = { canvas: { width: 2, height: 2 }, context: { getImageData() { pixelReads++; return { data: new Uint8Array([0, 0, 0, 255]) }; } } };
    node.getComponent = type => type === Label ? label : { width: 620, height: 52 };
    page.children.push(node);
    label.font = { _nativeAsset: 'test-family' };
    assert.equal(fontWrites, 1); assert.equal(label.useSystemFont, false);
    assert.equal(label.onEnable(), 17);
    assert.equal(enables, 1); assert.equal(timers.length, 3);
    timers[0](); assert.equal(pixelReads, 1);
    page.activeInHierarchy = false;
    timers[1](); assert.equal(pixelReads, 1);
    page.isValid = false;
    timers[2](); assert.equal(pixelReads, 1);
    for (let i = 0; i < 8; i++) label.onEnable();
    assert.equal(timers.length, 9); assert.equal(enables, 9);
    assert.ok(logs.some(line => line.includes('"nonTransparent":1')));
    assert.ok(logs.some(line => line.includes('"strongAlpha":1')));
    assert.ok(logs.some(line => line.includes('"system":false')));
});

test('极低透明度底色不当作可见字形，并分别输出小行避免手机日志截断', () => {
    const logs = [], timers = [];
    class Label { onEnable() {} }
    class UITransform {}
    const api = {};
    vm.runInNewContext(fs.readFileSync('scripts/templates/taptap-font-diagnostic.js','utf8'), {
        exports:api,console:{log:line=>logs.push(line)},setTimeout:fn=>timers.push(fn)
    });
    api.install({Label,UITransform});
    const page={name:'CareerEventPage',isValid:true,activeInHierarchy:true,children:[],getComponent:()=>null};
    for(let i=0;i<2;i++) {
        const label=new Label();
        const node={name:i===0?'PageTitle':'PageSubtitle',parent:page,activeInHierarchy:true,children:[],getComponent:T=>T===Label?label:{width:2,height:1}};
        label.node=node;label.string='测试';
        label.assemblerData={canvas:{width:2,height:1},context:{font:'36px ShuiMasterUISemiBold',getImageData:()=>({data:new Uint8Array([0,0,0,1,0,0,0,1])})}};
        page.children.push(node);
        if(i===0)label.onEnable();
    }
    timers[0]();
    const rows=logs.filter(line=>line.startsWith('[TapFont] label ')).map(line=>JSON.parse(line.slice('[TapFont] label '.length)));
    assert.equal(rows.length,2);
    assert.equal(rows[0].label.canvas.nonTransparent,2);
    assert.equal(rows[0].label.canvas.strongAlpha,0);
    assert.equal(rows[0].label.canvas.maxAlpha,1);
    assert.equal(rows[0].label.canvas.contextFont,'36px ShuiMasterUISemiBold');
});
