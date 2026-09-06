// 用真实结算节点生成离线排版，纯色背景仅便于验字，不是引擎领奖台截图。
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { make, Label, Sprite, UITransform, data } = require('../tests/settlement-runtime.test.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output/settlement-runtime');
fs.mkdirSync(output, { recursive: true });
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
function resource(p) {
    if (p.startsWith('avatar/')) {
        const names = { aqua: 'avatar-01-female-diver', coral: 'avatar-02-future-girl', lime: 'avatar-03-courier-boy' };
        p = 'ui/avatar-picker-v1/' + names[p.slice(7)] + '/texture';
    }
    return pathToFileURL(path.join(root, 'assets/race', p.replace('/texture', '.png'))).href;
}
function render(node, x = 836, y = 470.5) {
    if (!node.active) return '';
    x += node.position.x; y -= node.position.y;
    let result = '';
    const size = node.getComponent(UITransform)?.contentSize;
    if (size) {
        const common = `position:absolute;left:${x - size.width / 2}px;top:${y - size.height / 2}px;width:${size.width}px;height:${size.height}px;`;
        const sprite = node.getComponent(Sprite), label = node.getComponent(Label);
        if (sprite?.spriteFrame) result += `<img style="${common}" src="${resource(sprite.spriteFrame.path)}">`;
        if (label) {
            const c = label.color;
            const align = label.horizontalAlign === 1 ? 'flex-start' : label.horizontalAlign === 2 ? 'flex-end' : 'center';
            result += `<div data-fit style="${common}display:flex;align-items:center;justify-content:${align};font-family:${label.weight ? 'Shui' : "'Arial Black',Arial,sans-serif"};font-weight:${label.isBold ? '700' : '600'};font-size:${label.fontSize}px;line-height:${label.lineHeight}px;color:rgba(${c.r},${c.g},${c.b},${c.a / 255});white-space:nowrap"><span>${esc(label.string)}</span></div>`;
        }
    }
    return result + node.children.map(c => render(c, x, y)).join('');
}
const font = pathToFileURL(path.join(root, 'assets/race/fonts/ShuiMasterUI-SemiBold.ttf')).href;
for (const [name, rank, finished, room] of [
    ['gold', 1, true, false], ['silver', 2, true, false], ['bronze', 3, true, false],
    ['normal', 4, true, false], ['unfinished', 8, false, false], ['room', 2, true, true],
]) {
    const v = make();
    v.setRoomMode(room); v.show(109.45, data(rank, finished)); v.setReward(642);
    const html = `<!doctype html><meta charset="utf-8"><style>@font-face{font-family:Shui;src:url('${font}')}body{margin:0;background:#12395b}.screen{position:relative;width:1672px;height:941px;overflow:hidden;background:linear-gradient(140deg,#0564b9,#134977)}</style><div class="screen">${render(v.root)}<div style="position:absolute;left:100px;top:480px;color:#ffffff88;font:24px sans-serif">UI 离线排版校验<br>此处保留游戏内实时领奖台与角色</div></div><script>document.fonts.ready.then(()=>{for(const e of document.querySelectorAll('[data-fit]')){const s=e.firstElementChild;if(s.scrollWidth>e.clientWidth)s.style.fontSize=parseFloat(getComputedStyle(e).fontSize)*e.clientWidth/s.scrollWidth+'px'}window.ready=true})</script>`;
    fs.writeFileSync(path.join(output, name + '.html'), html);
}
console.log('已生成 output/settlement-runtime 的六种状态排版；不是引擎/真机截图。');
