import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const gameManager = readFileSync(new URL('../assets/scripts/core/GameManager.ts', import.meta.url), 'utf8');
const banner = readFileSync(new URL('../assets/scripts/ui/SharkEventBanner.ts', import.meta.url), 'utf8');
const cannonHud = readFileSync(new URL('../assets/scripts/ui/CannonBrawlHud.ts', import.meta.url), 'utf8');
const bombHud = readFileSync(new URL('../assets/scripts/ui/MineRelayBrawlHud.ts', import.meta.url), 'utf8');

test('六种娱乐玩法共用赛事广播与个人反馈，不再从比赛编排调用通用 Toast', () => {
    assert.match(gameManager, /new EntertainmentEventBanner\(\)/);
    assert.match(gameManager, /isStimulantBrawlMode[\s\S]*?showPersonal/);
    assert.match(gameManager, /updateWhirlpoolBrawl[\s\S]*?showEvent/);
    assert.match(gameManager, /handleCannonLaunch[\s\S]*?showEvent/);
    assert.match(gameManager, /handleMineRelayArm[\s\S]*?showPersonal/);
    assert.match(gameManager, /handleMinefieldImpact[\s\S]*?showPersonal/);
    assert.match(gameManager, /handleSharkStateChange[\s\S]*?showEvent/);
    assert.doesNotMatch(gameManager, /showToast\(/);
});

test('共用横幅保留鲨鱼大字描边，同时以稳定节点分离个人反馈', () => {
    assert.match(banner, /class EntertainmentEventBanner/);
    assert.match(banner, /EntertainmentEventBanner/);
    assert.match(banner, /EntertainmentPersonalFeedback/);
    assert.match(banner, /LabelOutline/);
    assert.match(banner, /showEvent\(/);
    assert.match(banner, /showPersonal\(/);
    assert.doesNotMatch(banner, /destroy\(\)/);
});

test('炮火与定时炸弹持续状态条使用同一尺寸和位置', () => {
    for (const source of [cannonHud, bombHud]) {
        assert.match(source, /560, 42/);
        assert.match(source, /size\.height \* 0\.5 - 118/);
        assert.match(source, /SAMPLE_SECONDS = 0\.1/);
    }
});
