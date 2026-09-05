// 从真实显示层的节点、坐标和资源引用生成离线排版预览；不是 Creator / 真机截图。
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { OnlineRoomView, Node, Label, Sprite, state, host, guest } = require('../tests/online-room-runtime.test.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output', 'online-room-runtime');
fs.mkdirSync(output, { recursive: true });
function resource(p) {
    if (p.startsWith('avatar/')) {
        const names = { coral: 'avatar-02-future-girl', lime: 'avatar-03-courier-boy', rose: 'avatar-10-lifeguard-girl' };
        p = `ui/avatar-picker-v1/${names[p.slice(7)] || 'avatar-01-female-diver'}/texture`;
    }
    let file = path.join(root, 'assets/race', p.replace('/texture', '.png'));
    if (!fs.existsSync(file)) file = file.replace(/\.png$/, '.jpg');
    return pathToFileURL(file).href;
}
function escaped(s) { return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'); }
function render(node, x = 640, y = 360) {
    if (!node.active) return '';
    x += node.position.x; y -= node.position.y;
    let html = '';
    const tr = node.components.find(c => c.contentSize)?.contentSize;
    if (tr) {
        const common = `position:absolute;left:${x - tr.width / 2}px;top:${y - tr.height / 2}px;width:${tr.width}px;height:${tr.height}px;`;
        const sprite = node.getComponent(Sprite), label = node.getComponent(Label);
        if (sprite?.spriteFrame) html += `<img style="${common}" src="${resource(sprite.spriteFrame.path)}">`;
        if (label) {
            const c = label.color;
            const align = label.horizontalAlign === 1 ? 'flex-start' : label.horizontalAlign === 2 ? 'flex-end' : 'center';
            const family = label.weight ? (label.weight === 'regular' ? 'ShuiRegular' : 'Shui') : `'${label.fontFamily}',Arial,sans-serif`;
            html += `<div data-fit style="${common}display:flex;align-items:center;justify-content:${align};font-family:${family};font-weight:${label.weight === 'regular' ? '400' : label.isBold ? '700' : '600'};font-size:${label.fontSize}px;line-height:${label.lineHeight}px;color:rgba(${c.r},${c.g},${c.b},${c.a / 255});white-space:nowrap"><span>${escaped(label.string)}</span></div>`;
        }
    }
    return html + node.children.map(c => render(c, x, y)).join('');
}
for (const mode of ['host', 'member-ready', 'member-idle', 'host-popup', 'host-drawer']) {
    const v = new OnlineRoomView(new Node('root'), { exit() {}, primary() {}, invite() {}, mode() {}, kick() {} });
    const isHost = mode.startsWith('host');
    const members = [{ ...host, self: isHost }, { ...guest, pos: 1, self: !isHost, ready: mode !== 'member-idle' }, { ...guest, pos: 2, self: false, nickName: '浪花33', avatarId: 'rose', character: '跃浪少女' }];
    v.update(state({ members, isHost, ready: mode === 'member-ready', canStart: true, hint: mode === 'member-ready' ? '已准备 · 等待房主开始' : '' }));
    if (mode === 'host-popup') { v.popupPos = 1; v.popup.setPosition(667, -252); v.popup.active = true; v.update(v.state); }
    if (mode === 'host-drawer') v.drawer.active = true;
    const font = pathToFileURL(path.join(root, 'assets/race/fonts/ShuiMasterUI-SemiBold.ttf')).href;
    const regularFont = pathToFileURL(path.join(root, 'assets/race/fonts/ShuiMasterUI-Regular.ttf')).href;
    const html = `<!doctype html><meta charset="utf-8"><style>@font-face{font-family:Shui;src:url('${font}')}body{margin:0;background:#092033}.screen{position:relative;width:1280px;height:720px;overflow:hidden}</style><div class="screen">${render(v.root)}</div><script>document.fonts.ready.then(()=>{for(const e of document.querySelectorAll('[data-fit]')){const s=e.firstElementChild;if(s.scrollWidth>e.clientWidth)s.style.fontSize=parseFloat(getComputedStyle(e).fontSize)*e.clientWidth/s.scrollWidth+'px'}window.ready=true})</script>`;
    fs.writeFileSync(path.join(output, mode + '.html'), html.replace('<style>', `<style>@font-face{font-family:ShuiRegular;font-weight:400;src:url('${regularFont}')}`));
}
console.log('离线排版预览输出到 output/online-room-runtime；不代表引擎或真机验收。');
