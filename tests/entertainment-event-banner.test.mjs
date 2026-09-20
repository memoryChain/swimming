import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const gameManager = readFileSync(new URL('../assets/scripts/core/GameManager.ts', import.meta.url), 'utf8');
const director = readFileSync(new URL('../assets/scripts/core/EntertainmentModeDirector.ts', import.meta.url), 'utf8');
const banner = readFileSync(new URL('../assets/scripts/ui/SharkEventBanner.ts', import.meta.url), 'utf8');
const cannonHud = readFileSync(new URL('../assets/scripts/ui/CannonBrawlHud.ts', import.meta.url), 'utf8');
const bombHud = readFileSync(new URL('../assets/scripts/ui/MineRelayBrawlHud.ts', import.meta.url), 'utf8');
const statusStrip = readFileSync(new URL('../assets/scripts/ui/EntertainmentStatusStrip.ts', import.meta.url), 'utf8');
const resourcePaths = readFileSync(new URL('../assets/scripts/core/ResourcePaths.ts', import.meta.url), 'utf8');

test('六种娱乐玩法共用赛事广播与个人反馈，不再从比赛编排调用通用 Toast', () => {
    assert.match(gameManager, /new EntertainmentEventBanner\(\)/);
    assert.match(gameManager, /isStimulantBrawlMode[\s\S]*?showStimulantPickup/);
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
    assert.match(banner, /showStimulantPickup\(/);
    assert.match(banner, /loadRaceAsset\(/);
    assert.match(banner, /const STIMULANT_CARD_WIDTH = 640/);
    assert.match(banner, /const STIMULANT_CARD_HEIGHT = 135/);
    assert.match(banner, /const STIMULANT_CARD_Y = -68/);
    assert.match(banner, /cardSprite\.type = Sprite\.Type\.SIMPLE/);
    assert.doesNotMatch(banner, /makeLabel\('Title', stimulantRoot/);
    assert.match(banner, /makeUiNode\('StimulantTitle', stimulantRoot\)/);
    assert.match(banner, /makeUiNode\('StimulantTitleEcho', stimulantRoot\)/);
    assert.match(banner, /loadFrame\('stimulant-title', paths\.stimulantTitle\)/);
    assert.match(resourcePaths, /stimulantTitle: 'ui\/entertainment-banner-v1\/stimulant-pickup-title\/texture'/);
    assert.doesNotMatch(banner, /makeUiNode\('Heartbeat', stimulantRoot/);
    assert.doesNotMatch(banner, /loadFrame\('heartbeat'/);
    assert.match(banner, /const STIMULANT_STAT_TEXT_X = 210/);
    assert.match(banner, /const STIMULANT_STAT_TEXT_WIDTH = 104/);
    assert.match(banner, /energyNode\.getComponent\(UITransform\)!\.setContentSize\(STIMULANT_STAT_TEXT_WIDTH, STIMULANT_STAT_TEXT_HEIGHT\)/);
    assert.match(banner, /energyNode\.setPosition\(STIMULANT_STAT_TEXT_X, STIMULANT_ENERGY_TEXT_Y, 1\)/);
    assert.match(banner, /heartNode\.setPosition\(STIMULANT_STAT_TEXT_X, STIMULANT_HEART_TEXT_Y, 1\)/);
    assert.match(banner, /energyLabel\.overflow = Label\.Overflow\.SHRINK/);
    assert.match(banner, /heartLabel\.overflow = Label\.Overflow\.SHRINK/);
    assert.doesNotMatch(banner, /loadFrame\('stimulant-card',[^\n]*110, 110, 26/);
});

test('心跳超频标题使用衰减震动，体力百分比和真实心率按十赫兹跳到拾取后数值', () => {
    assert.match(gameManager, /feedback\.energyRatioBefore,[\s\S]*?feedback\.energyRatioAfter,[\s\S]*?feedback\.heartRateBefore,[\s\S]*?feedback\.heartRate,[\s\S]*?feedback\.infiniteStamina/);
    assert.match(banner, /const STIMULANT_COUNTER_STEPS = 5/);
    assert.match(banner, /const STIMULANT_COUNTER_STEP_SECONDS = 0\.1/);
    assert.match(banner, /Math\.round\(Math\.max\(0, Math\.min\(1, energyRatioBefore\)\) \* 100\)/);
    assert.match(banner, /`体力 \$\{value\}%`/);
    assert.match(banner, /playStimulantPickupMotion\(energyFrom, energyTo, heartFrom, heartTo, infiniteStamina\)/);
    assert.match(banner, /STIMULANT_TITLE_X - 7/);
    assert.match(banner, /angle: 2\.2/);
    assert.match(banner, /scale: new Vec3\(1\.055, 1\.055, 1\)/);
    assert.match(banner, /for \(let step = 1; step <= STIMULANT_COUNTER_STEPS; step\+\+\)/);
    assert.match(banner, /Tween\.stopAllByTarget\(this\.stimulantCounterTimeline\)/);
    assert.doesNotMatch(banner, /stimulantCardRoot|tween\(energyRoot\)|tween\(heartRoot\)/);
    assert.doesNotMatch(banner, /update\(\): void \{[\s\S]*?stimulantEnergyLabel\.string/);
});

test('广播从比赛初始化起使用画中画左侧的固定安全区', () => {
    assert.match(banner, /setPictureInPictureLeft\(leftEdge: number \| null\)/);
    assert.match(banner, /this\.pictureInPictureLeft - PICTURE_IN_PICTURE_GAP/);
    assert.match(banner, /this\.layoutEventChannel\(\)/);
    assert.doesNotMatch(banner, /setPictureInPictureLeft\(leftEdge: number \| null\): void \{[^}]*makeUiNode/);
});

test('事件图标和顶部栏目固定锚定横幅左端，正文在独立内容区居中', () => {
    assert.match(banner, /const EVENT_ICON_FROM_LEFT = 48/);
    assert.match(banner, /const EVENT_CATEGORY_FROM_LEFT = 120/);
    assert.match(banner, /const EVENT_CATEGORY_Y = 34/);
    assert.match(banner, /const iconX = -width \* 0\.5 \+ EVENT_ICON_FROM_LEFT/);
    assert.match(banner, /const categoryX = -width \* 0\.5 \+ EVENT_CATEGORY_FROM_LEFT/);
    assert.match(banner, /EVENT_CATEGORY_Y/);
    assert.match(banner, /'广播通知', 20, CATEGORY_TEXT/);
    assert.doesNotMatch(banner, /'娱乐突发', 20, CATEGORY_TEXT/);
    assert.match(banner, /private eventCategoryLabel: Label \| null = null/);
    assert.match(banner, /this\.setLabel\(categoryLabel, category, CATEGORY_TEXT\)/);
    assert.match(banner, /label\.horizontalAlign = Label\.HorizontalAlign\.CENTER/);
    assert.match(banner, /EVENT_TEXT_LEFT_INSET[\s\S]*?EVENT_TEXT_RIGHT_INSET/);
    assert.doesNotMatch(banner, /const artOffset = \(width - EVENT_WIDTH\)/);
});

test('广播栏目使用受控四字词库，并随排队消息一起保存', () => {
    for (const category of [
        '广播通知', '补给投放', '炸弹接力', '漩涡警报', '水雷警报', '鲨鱼警报',
        '炮火警报', '炮击命中', '炸弹爆炸', '拆弹成功', '警报解除', '赛道异物', '咬伤播报',
    ]) {
        assert.match(banner, new RegExp(`\\| '${category}'`));
    }
    assert.match(banner, /category: EntertainmentBannerCategory/);
    assert.match(banner, /this\.eventQueue\.push\(\{[\s\S]*?category,/);
    assert.match(banner, /next\.text, next\.tone, next\.durationMs, next\.icon, next\.category/);
    assert.match(gameManager, /entertainmentPreviewCopy\([\s\S]*?'广播通知'/);
    assert.match(gameManager, /entertainmentActiveBannerCategory\(transition\.activatedEvent\)/);
    assert.match(gameManager, /被鲨鱼咬伤[\s\S]*?'咬伤播报'/);
    assert.match(gameManager, /被炮弹核心命中[\s\S]*?'炮击命中'/);
    assert.match(gameManager, /被定时炸弹炸倒[\s\S]*?'炸弹爆炸'/);
});

test('六合一激活时用原广播位置显示三秒红色行动提示', () => {
    assert.match(gameManager, /showDirectorEvent\([\s\S]*?entertainmentActionCopy\([\s\S]*?transition\.activatedEvent[\s\S]*?'danger'[\s\S]*?3000/);
    assert.match(banner, /const EVENT_WIDTH = 840/);
    assert.match(banner, /const EVENT_HEIGHT = 98/);
    assert.match(banner, /const EVENT_Y = 180/);
    assert.match(banner, /makeLabel\('Label', motion, '', 34, WHITE\)/);
    assert.match(gameManager, /isEntertainmentBrawlMode\(\) && wave === 1/);
    assert.match(gameManager, /launch\.strikeId === 0 && !isEntertainmentBrawlMode\(\)/);
    assert.match(gameManager, /onRevealed: \(\) => \{[\s\S]*?if \(isEntertainmentBrawlMode\(\)\) return/);
});

test('六合一广播在阶段边沿用比赛种子和激活序号选择同组文案', () => {
    assert.match(director, /ENTERTAINMENT_BROADCAST_VARIANT_COUNT = 10/);
    assert.match(director, /entertainmentBroadcastVariantIndex\([\s\S]*?new SeededRandom\(/);
    assert.doesNotMatch(director, /entertainmentBroadcastVariantIndex\([\s\S]*?Math\.random\(/);
    assert.match(gameManager, /const previewActivationSerial = [\s\S]*?activationSerial[\s\S]*?\+ 1/);
    assert.match(gameManager, /entertainmentPreviewCopy\([\s\S]*?getSharedRandomSeed\(\)[\s\S]*?previewActivationSerial/);
    assert.match(gameManager, /entertainmentActionCopy\([\s\S]*?getSharedRandomSeed\(\)[\s\S]*?activationSerial/);
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

test('炮火与定时炸弹持续状态条复用无图标美术、程序文字与同一位置', () => {
    assert.match(statusStrip, /ENTERTAINMENT_STATUS_STRIP_WIDTH = 560/);
    assert.match(statusStrip, /ENTERTAINMENT_STATUS_STRIP_HEIGHT = 56/);
    assert.match(statusStrip, /makeLabel\('Message'/);
    assert.match(statusStrip, /makeLabel\('Value'/);
    assert.match(statusStrip, /RESOURCE_PATHS\.entertainmentStatusUi\.base/);
    assert.doesNotMatch(statusStrip, /makeUiNode\('Icon'/);
    assert.doesNotMatch(statusStrip, /Graphics/);
    for (const source of [cannonHud, bombHud]) {
        assert.match(source, /new EntertainmentStatusStrip/);
        assert.match(source, /size\.height \* 0\.5 - 118/);
        assert.match(source, /SAMPLE_SECONDS = 0\.1/);
        assert.match(source, /this\.strip\.setContent\(message, value, tone\)/);
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
