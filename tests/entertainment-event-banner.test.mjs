import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const gameManager = readFileSync(new URL('../assets/scripts/core/GameManager.ts', import.meta.url), 'utf8');
const director = readFileSync(new URL('../assets/scripts/core/EntertainmentModeDirector.ts', import.meta.url), 'utf8');
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
    assert.doesNotMatch(banner, /showEventWithAction\(/);
    assert.doesNotMatch(banner, /makeLabel\('Action'/);
    assert.match(banner, /showPersonal\(/);
    assert.doesNotMatch(banner, /destroy\(\)/);
});

test('画中画出现时广播复用原节点并收窄到镜头左侧', () => {
    assert.match(banner, /setPictureInPictureLeft\(leftEdge: number \| null\)/);
    assert.match(banner, /this\.pictureInPictureLeft - PICTURE_IN_PICTURE_GAP/);
    assert.match(banner, /layoutChannel\(this\.eventRoot, this\.eventLabel/);
    assert.doesNotMatch(banner, /setPictureInPictureLeft[\s\S]*?makeUiNode/);
});

test('六合一激活时用原广播位置显示三秒红色行动提示', () => {
    assert.match(gameManager, /showDirectorEvent\([\s\S]*?entertainmentActionCopy\([\s\S]*?transition\.activatedEvent[\s\S]*?'danger'[\s\S]*?3000/);
    assert.match(banner, /const EVENT_WIDTH = 840/);
    assert.match(banner, /const EVENT_HEIGHT = 86/);
    assert.match(banner, /const EVENT_Y = 180/);
    assert.match(banner, /makeLabel\('Label', eventRoot, '', 40, TONE_COLORS\.warning\)/);
    assert.match(gameManager, /isEntertainmentBrawlMode\(\) && wave === 1/);
    assert.match(gameManager, /launch\.strikeId === 0 && !isEntertainmentBrawlMode\(\)/);
    assert.match(gameManager, /onRevealed: \(\) => \{[\s\S]*?if \(isEntertainmentBrawlMode\(\)\) return/);
});

test('三事件与长局预告六秒，四事件局预告五秒', () => {
    assert.match(director, /const THREE_EVENT_PREVIEW_SECONDS = 6/);
    assert.match(director, /const FOUR_EVENT_PREVIEW_SECONDS = 5/);
    assert.match(director, /const LONG_RACE_PREVIEW_SECONDS = 6/);
    assert.match(director, /this\.events\.length === 4 \? FOUR_EVENT_PREVIEW_SECONDS : THREE_EVENT_PREVIEW_SECONDS/);
    assert.match(gameManager, /previewDurationSeconds\(\)[\s\S]*?\* 1000/);
    assert.match(gameManager, /entertainmentPreviewCopy\([\s\S]*?transition\.previewEvent[\s\S]*?previewDurationMs/);
});

test('导演预告和激活广播不会被子玩法短提示覆盖', () => {
    assert.match(banner, /private directorUntil = 0/);
    assert.match(banner, /showDirectorEvent\([\s\S]*?this\.directorUntil = Date\.now\(\) \+ safeDuration/);
    assert.match(banner, /showEvent\([\s\S]*?Date\.now\(\) < this\.directorUntil\) return/);
    assert.match(banner, /enqueueEvent\([\s\S]*?Date\.now\(\) < this\.directorUntil\) return/);
});

test('首位选手完赛后由房主停止新事件，并单独关闭尚未激活的预告', () => {
    assert.match(gameManager, /_raceManager\?\.hasAnyFinisher\(\)[\s\S]*?director\.lockAfterFirstFinish\(\)/);
    assert.match(gameManager, /director\.lockAfterFirstFinish\(\)[\s\S]*?closingTransition = director\.update\(/);
    assert.match(gameManager, /transition\.cancelledPreview[\s\S]*?_entertainmentEventBanner\.hideEvent\(\)/);
    assert.match(banner, /hide\(\): void \{[\s\S]*?this\.hideEvent\(\)/);
    assert.match(banner, /hideEvent\(\): void \{[\s\S]*?this\.eventQueue\.length = 0/);
});

test('炮火与定时炸弹持续状态条使用同一尺寸和位置', () => {
    for (const source of [cannonHud, bombHud]) {
        assert.match(source, /560, 42/);
        assert.match(source, /size\.height \* 0\.5 - 118/);
        assert.match(source, /SAMPLE_SECONDS = 0\.1/);
    }
});

test('六合一事件静默收尾，只关闭持续状态条并保留独立玩法结束反馈', () => {
    for (const source of [cannonHud, bombHud]) {
        assert.match(source, /COMPLETION_SECONDS = 2/);
        assert.match(source, /completionRemainingSeconds/);
        assert.match(source, /showCompletion = true/);
        assert.match(source, /hide\(\): void/);
        assert.doesNotMatch(source, /this\.root\.active !== visible/);
    }
    assert.match(gameManager, /transition\.finishedEvent === EntertainmentEventId\.CANNON[\s\S]*?_cannonBrawlHud\?\.hide\(\)/);
    assert.match(gameManager, /transition\.finishedEvent === EntertainmentEventId\.TIMED_BOMB[\s\S]*?_mineRelayHud\?\.hide\(\)/);
    assert.match(gameManager, /isEntertainmentEventBurstActive\(EntertainmentEventId\.CANNON\)[\s\S]*?_cannonBrawlHud\?\.hide\(\)/);
    assert.doesNotMatch(gameManager, /本轮炮击结束 · 下一事件准备中/);
    assert.doesNotMatch(gameManager, /本轮炸弹结束 · 下一事件准备中/);
    assert.match(gameManager, /state === SharkState\.WANDER[\s\S]*?if \(!isEntertainmentBrawlMode\(\)\)[\s\S]*?pickSharkBannerLine\('retreat'\)/);
    assert.match(gameManager, /state === SharkState\.SATIATED[\s\S]*?if \(!isEntertainmentBrawlMode\(\)\)[\s\S]*?鲨鱼已经吃饱/);
});
