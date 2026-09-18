const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('快速比赛玩法选择页隐藏整条顶栏并在离开时恢复', () => {
    const manager = read('assets/scripts/app/LoginManager.ts');
    assert.match(manager,
        /onQuickRacePageChanged: \(active\)[\s\S]*?setIdentityVisible\(!active\)[\s\S]*?setRightControlsVisible\(!active\)/);

    const headBar = read('assets/scripts/ui/ResourceHeadBar.ts');
    assert.match(headBar,
        /setRightControlsVisible\(visible: boolean\)[\s\S]*?_rightControls\.active = visible/);

    const flow = read('assets/scripts/ui/PrepareRaceFlow.ts');
    assert.match(flow, /onQuickRacePageChanged\?\.\(visible && screen === 'quick'\)/);
    assert.doesNotMatch(flow, /onCharacterManagementChanged\?\.\(visible\)/);
});

test('赛事页面保留快速比赛与生涯类型直到关闭通知', () => {
    const panel = read('assets/scripts/ui/CareerPrototypePanel.ts');
    assert.match(panel, /private pageScreen: 'quick' \| 'career'/);
    assert.match(panel, /if \(visible\) this\.pageScreen = this\.screen === 'quick' \? 'quick' : 'career'/);
    assert.match(panel, /visibility\(false, this\.pageScreen\)/);
});
