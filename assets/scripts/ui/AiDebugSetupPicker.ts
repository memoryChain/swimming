import { BlockInputEvents, Button, Label, Node, UITransform, view } from 'cc';
import { getAiDebugSetup, setAiDebugSetup } from '../core/GameLaunchOptions';
import { getRaceDistance, getRaceModeTitle, RaceDifficulty, RaceModeId } from '../core/GameBalance';
import { PLAYER_CHARACTER_DEFINITIONS } from '../app/PlayerCharacterConfig';
import { AI_DEBUG_DIFFICULTY_TIERS } from '../competitor/CompetitorConfig';
import type { DebugCurrencyId } from '../backend/IBackend';
import {
    fitFullScreenSolidCover,
    makeButton,
    makeLabel,
    makeRect,
    makeUiNode,
    UI_DESIGN_HEIGHT,
    UI_DESIGN_WIDTH,
    uiColor,
} from './RuntimeUiFactory';
import { styleProjectUiLabel } from './ProjectUiFonts';
import { ENTERTAINMENT_INTENSITY_LABELS, ENTERTAINMENT_TEST_COMBINATIONS,
    EntertainmentIntensity, normalizeEntertainmentIntensity } from '../core/EntertainmentIntensity';
import { EntertainmentEventId } from '../core/EntertainmentModeDirector';

const PANEL_WIDTH = 880;
const PANEL_HEIGHT = 620;
const MODE_TEST_MODES: readonly RaceModeId[] = [
    'entertainment-brawl',
    'stimulant-brawl',
    'shark-brawl',
    'whirlpool-brawl',
    'last-place-brawl',
    'timed-bomb-brawl',
    'obstacle-brawl',
    'giant-wave-brawl',
];
const MODE_TEST_DIFFICULTY = AI_DEBUG_DIFFICULTY_TIERS[2].value;
const ENTERTAINMENT_TEST_EVENTS = [
    { id: EntertainmentEventId.STIMULANT, title: '苏打' },
    { id: EntertainmentEventId.TIMED_BOMB, title: '定时水球' },
    { id: EntertainmentEventId.WHIRLPOOL, title: '漩涡' },
    { id: EntertainmentEventId.OBSTACLE, title: '水上障碍场' },
    { id: EntertainmentEventId.SHARK, title: '玩具鲨' },
    { id: EntertainmentEventId.CANNON, title: '水炮' },
] as const;

type DebugButtonView = {
    node: Node;
    label: Label | null;
};

export type DebugCurrencyBalances = Readonly<{
    coins: number;
    breakthroughGems: number;
}>;

export type DebugCurrencyPanelOptions = {
    read: () => DebugCurrencyBalances;
    adjust: (currency: DebugCurrencyId, delta: number) => Promise<DebugCurrencyBalances>;
    onPresentedChanged?: (presented: boolean) => void;
};

const EMPTY_CURRENCY_DEBUG: DebugCurrencyPanelOptions = {
    read: () => ({ coins: 0, breakthroughGems: 0 }),
    adjust: async () => ({ coins: 0, breakthroughGems: 0 }),
};

const CURRENCY_AMOUNT_STEPS: Readonly<Record<DebugCurrencyId, readonly number[]>> = {
    coins: [100, 1000, 10000],
    breakthroughGems: [1, 5, 10],
};

/** 使用主 HUD 坐标系；全屏遮挡独立于面板缩放，窗口变化时才更新布局。 */
export function mountAiDebugSetupPicker(
    parent: Node,
    start: (difficulty: number) => void,
    currencyDebug: DebugCurrencyPanelOptions,
): Node {
    const overlay = makeUiNode('AiDebugPicker', parent);
    overlay.addComponent(BlockInputEvents);
    const dim = makeRect('Dim', overlay, UI_DESIGN_WIDTH, UI_DESIGN_HEIGHT, uiColor(2, 8, 14, 210));
    fitFullScreenSolidCover(dim, UI_DESIGN_WIDTH, UI_DESIGN_HEIGHT);
    const panel = makeUiNode('Panel', overlay);
    panel.getComponent(UITransform).setContentSize(PANEL_WIDTH, PANEL_HEIGHT);
    buildAiDebugSetupPicker(panel, start, currencyDebug, () => overlay.destroy());
    const layout = () => {
        const size = view.getVisibleSize();
        const transform = overlay.getComponent(UITransform);
        if (transform.contentSize.width !== size.width || transform.contentSize.height !== size.height) {
            transform.setContentSize(size.width, size.height);
        }
        const scale = Math.min(1, Math.max(1, size.width - 48) / PANEL_WIDTH, Math.max(1, size.height - 48) / PANEL_HEIGHT);
        if (panel.scale.x !== scale || panel.scale.y !== scale) panel.setScale(scale, scale, 1);
    };
    layout();
    view.on('canvas-resize', layout);
    view.on('design-resolution-changed', layout);
    let presented = true;
    currencyDebug.onPresentedChanged?.(true);
    overlay.once(Node.EventType.NODE_DESTROYED, () => {
        view.off('canvas-resize', layout);
        view.off('design-resolution-changed', layout);
        if (presented) {
            presented = false;
            currencyDebug.onPresentedChanged?.(false);
        }
    });
    return overlay;
}

// 仅调试入口。节点和监听一次建立，页签切换只改 active/选中态，不加载或重建角色模型。
export function buildAiDebugSetupPicker(
    root: Node,
    start: (difficulty: number) => void,
    currencyDebug: DebugCurrencyPanelOptions = EMPTY_CURRENCY_DEBUG,
    close = () => root.destroy(),
) {
    const setup = { ...getAiDebugSetup() };
    setup.entertainmentEventIntensities = [...(setup.entertainmentEventIntensities ?? [3, 3, 3, 3, 3, 3, 3])];
    setup.entertainmentIntensity = normalizeEntertainmentIntensity(setup.entertainmentIntensity);
    setup.entertainmentRaceGrade = setup.entertainmentRaceGrade ?? 3;
    let entertainmentTestRoute: 'graded' | 'legacy' = setup.entertainmentIntensity === null ? 'graded' : 'legacy';
    let legacyEntertainmentIntensity: EntertainmentIntensity = setup.entertainmentIntensity ?? 3;
    let soloIntensity: EntertainmentIntensity | null = setup.entertainmentIntensity;
    setup.raceDistance = setup.raceDistance === 400 ? 400 : 200;
    const raceModes: RaceDifficulty[] = ['beginner', 'competitive', 'championship'];
    let raceMode: RaceDifficulty = raceModes.indexOf(setup.mode as RaceDifficulty) >= 0
        ? setup.mode as RaceDifficulty
        : 'beginner';
    let modeTestMode: RaceModeId = MODE_TEST_MODES.indexOf(setup.mode) >= 0
        ? setup.mode
        : MODE_TEST_MODES[0];
    let characterIndex = Math.max(0, PLAYER_CHARACTER_DEFINITIONS.findIndex(c => c.id === setup.characterId));
    makeRect('Back', root, PANEL_WIDTH, PANEL_HEIGHT, uiColor(13, 35, 61, 250));
    const button = (parent: Node, name: string, text: string, x: number, y: number, width: number, action: () => void, height = 48): DebugButtonView => {
        const node = makeButton(name, parent, width, height, uiColor(40, 96, 168, 240), text);
        node.setPosition(x, y, 0);
        node.on(Button.EventType.CLICK, action);
        return { node, label: node.getChildByName('Label')?.getComponent(Label) ?? null };
    };
    const write = (label: Label | null, text: string) => { if (label && label.string !== text) label.string = text; };
    const setActive = (node: Node | null | undefined, active: boolean) => {
        if (node && node.active !== active) node.active = active;
    };

    const aiContent = makeUiNode('AiTestContent', root);
    const modeContent = makeUiNode('ModeTestContent', root);
    const currencyContent = makeUiNode('CurrencyDebugContent', root);
    setActive(modeContent, false);
    setActive(currencyContent, false);

    const makeTab = (name: string, text: string, x: number, content: Node) => {
        const tab = button(root, name, text, x, 266, 210, () => selectTab(content), 44);
        const selected = makeRect('Selected', tab.node, 194, 4, uiColor(66, 222, 255, 255));
        selected.setPosition(0, -20, 0);
        setActive(selected, content === aiContent);
        return { ...tab, selected };
    };
    let activeContent = aiContent;
    let aiTab: ReturnType<typeof makeTab>;
    let modeTab: ReturnType<typeof makeTab>;
    let currencyTab: ReturnType<typeof makeTab>;
    const selectTab = (content: Node) => {
        if (activeContent === content) return;
        setActive(activeContent, false);
        activeContent = content;
        setActive(activeContent, true);
        setActive(aiTab.selected, content === aiContent);
        setActive(modeTab.selected, content === modeContent);
        setActive(currencyTab.selected, content === currencyContent);
    };
    aiTab = makeTab('AiTestTab', '角色 AI 测试', -230, aiContent);
    modeTab = makeTab('ModeTestTab', '模式测试', 0, modeContent);
    currencyTab = makeTab('CurrencyDebugTab', '货币调试', 230, currencyContent);

    makeLabel('Subtitle', aiContent, '先设置阵容，再点击右侧智力档开始比赛', 18, uiColor(190, 210, 220)).setPosition(0, 218, 0);
    const mixed = () => setup.opponentCount === 7 && setup.mixedCharacters;
    const characterText = () => mixed() ? '角色：多角色混合' : `角色：${PLAYER_CHARACTER_DEFINITIONS[characterIndex].name}`;
    const character = button(aiContent, 'Character', characterText(), -195, 166, 360, () => {
        if (mixed()) setup.mixedCharacters = false;
        else characterIndex = (characterIndex + 1) % PLAYER_CHARACTER_DEFINITIONS.length;
        setup.characterId = PLAYER_CHARACTER_DEFINITIONS[characterIndex].id;
        write(character.label, characterText());
        write(roster.label, rosterText());
    });
    const level = makeLabel('Level', aiContent, `等级 ${setup.level}`, 22, uiColor(240, 250, 255)).getComponent(Label);
    level.node.getComponent(UITransform).setContentSize(210, 42);
    level.node.setPosition(-195, 102, 0);
    button(aiContent, 'LevelDown', '−', -335, 102, 56, () => { setup.level = Math.max(1, setup.level - 1); write(level, `等级 ${setup.level}`); });
    button(aiContent, 'LevelUp', '+', -55, 102, 56, () => { setup.level = Math.min(30, setup.level + 1); write(level, `等级 ${setup.level}`); });
    const countText = () => setup.opponentCount === 7 ? '7 个 AI 对手 · 8 人比赛' : '1 个 AI 对手 · 2 人比赛';
    const count = button(aiContent, 'OpponentCount', countText(), -195, 38, 360, () => {
        setup.opponentCount = setup.opponentCount === 7 ? 1 : 7;
        write(count.label, countText());
        write(character.label, characterText());
        write(roster.label, rosterText());
    });
    const rosterText = () => setup.opponentCount === 1 ? '阵容：单个指定角色' : mixed() ? '阵容：多角色混合' : '阵容：全部同角色';
    const roster = button(aiContent, 'Roster', rosterText(), -195, -26, 360, () => {
        if (setup.opponentCount === 1) return;
        setup.mixedCharacters = !setup.mixedCharacters;
        write(roster.label, rosterText());
        write(character.label, characterText());
    });
    const modeText = () => `${getRaceModeTitle(raceMode)} ${getRaceDistance(raceMode)}米`;
    const mode = button(aiContent, 'Mode', modeText(), -195, -90, 360, () => {
        raceMode = raceModes[(raceModes.indexOf(raceMode) + 1) % raceModes.length];
        write(mode.label, modeText());
    });
    const seedText = () => `种子 ${setup.seed}`;
    let modeSeed: DebugButtonView;
    const cycleSeed = () => {
        setup.seed = setup.seed === 20260913 ? 42 : setup.seed === 42 ? 12345 : 20260913;
        write(seed.label, seedText());
        write(modeSeed.label, seedText());
    };
    const seed = button(aiContent, 'Seed', seedText(), -195, -154, 360, cycleSeed);
    makeLabel('Hint', aiContent, '等级与智力应用于全部 AI，玩家使用自己的角色属性', 18, uiColor(190, 210, 220)).setPosition(0, -210, 0);
    let launched = false;
    const launch = (selectedMode: RaceModeId, difficulty: number, forceFullRoster: boolean) => {
        if (launched) return;
        launched = true;
        setup.mode = selectedMode;
        if (forceFullRoster) {
            setup.opponentCount = 7;
            setup.mixedCharacters = true;
        }
        setAiDebugSetup(setup);
        start(difficulty);
    };
    AI_DEBUG_DIFFICULTY_TIERS.forEach((tier, i) => button(aiContent, `Tier${i}`, tier.label, 210, 166 - i * 72, 290, () => {
        launch(raceMode, tier.value, false);
    }));

    makeLabel('Subtitle', modeContent, '选择娱乐事件与强度，固定阵容和种子重测', 18, uiColor(190, 210, 220)).setPosition(0, 218, 0);
    const modeViews = new Map<RaceModeId, { selected: Node; label: Label | null }>();
    const whirlpoolSelectionViews = new Map<typeof setup.whirlpoolSelection, Node>();
    const whirlpoolOptions = makeUiNode('WhirlpoolOptions', modeContent);
    const whirlpoolTitle = makeLabel('WhirlpoolTitle', whirlpoolOptions, '漩涡规格', 17, uiColor(190, 210, 220));
    whirlpoolTitle.getComponent(UITransform).setContentSize(110, 40);
    whirlpoolTitle.setPosition(-350, -50, 0);
    const whirlpoolSelections = [
        { id: 'random', label: '纯随机' },
        { id: 'normal', label: '小漩涡' },
        { id: 'super', label: '大漩涡' },
    ] as const;
    const updateWhirlpoolSelection = (
        previous: typeof setup.whirlpoolSelection | null,
        current: typeof setup.whirlpoolSelection,
    ) => {
        if (previous === current) return;
        if (previous) setActive(whirlpoolSelectionViews.get(previous), false);
        setActive(whirlpoolSelectionViews.get(current), true);
    };
    whirlpoolSelections.forEach((option, index) => {
        const choice = button(
            whirlpoolOptions,
            `WhirlpoolSelection${index}`,
            option.label,
            -160 + index * 200,
            -50,
            170,
            () => {
                const previous = setup.whirlpoolSelection;
                setup.whirlpoolSelection = option.id;
                updateWhirlpoolSelection(previous, setup.whirlpoolSelection);
            },
            40,
        );
        const selected = makeRect('Selected', choice.node, 154, 4, uiColor(66, 222, 255, 255));
        selected.setPosition(0, -18, 0);
        setActive(selected, option.id === setup.whirlpoolSelection);
        whirlpoolSelectionViews.set(option.id, selected);
    });
    setActive(whirlpoolOptions, modeTestMode === 'whirlpool-brawl' && setup.entertainmentIntensity === null);
    const waveOptions = makeUiNode('GiantWaveOptions', modeContent);
    const waveViews: Node[] = [];
    setup.giantWavePreset = setup.giantWavePreset === 'single' ? 'single' : 'three';
    (['three', 'single'] as const).forEach((preset, index) => {
        const choice = button(waveOptions, `WavePreset${index}`, index === 0 ? '常规三波' : '单波定位',
            -120 + index * 240, -50, 210, () => {
                if (setup.giantWavePreset === preset) return;
                setup.giantWavePreset = preset;
                setActive(waveViews[0], preset === 'three');
                setActive(waveViews[1], preset === 'single');
            }, 40);
        const selected = makeRect('Selected', choice.node, 194, 4, uiColor(66, 222, 255, 255));
        selected.setPosition(0, -18, 0);
        setActive(selected, setup.giantWavePreset === preset);
        waveViews.push(selected);
    });
    setActive(waveOptions, modeTestMode === 'giant-wave-brawl');
    const obstacleOptions = makeUiNode('ObstacleLayoutOptions', modeContent);
    const obstacleLayoutViews = new Map<'debris' | 'buoy' | 'mixed', Node>();
    setup.obstacleLayout = setup.obstacleLayout === 'debris' || setup.obstacleLayout === 'buoy'
        ? setup.obstacleLayout : 'mixed';
    ([
        { id: 'debris', label: '杂物为主' },
        { id: 'buoy', label: '浮标为主' },
        { id: 'mixed', label: '混合布局' },
    ] as const).forEach((option, index) => {
        const choice = button(obstacleOptions, `ObstacleLayout${index}`, option.label,
            -280 + index * 280, -108, 250, () => {
                if (setup.obstacleLayout === option.id) return;
                const previous = setup.obstacleLayout;
                setup.obstacleLayout = option.id;
                setActive(obstacleLayoutViews.get(previous) ?? null, false);
                setActive(obstacleLayoutViews.get(option.id) ?? null, true);
            }, 40);
        const selected = makeRect('Selected', choice.node, 8, 34, uiColor(66, 222, 255, 255));
        selected.setPosition(-119, 0, 0);
        setActive(selected, option.id === setup.obstacleLayout);
        obstacleLayoutViews.set(option.id, selected);
    });
    setActive(obstacleOptions, modeTestMode === 'obstacle-brawl');
    let eventChoice: DebugButtonView;
    let eventLevelChoice: DebugButtonView;
    let combinationChoice: DebugButtonView;
    const modeStartText = () => modeTestMode === 'entertainment-brawl'
        ? entertainmentTestRoute === 'graded'
            ? `开始测试：娱乐模式 · 整局 ${setup.entertainmentRaceGrade} 档`
            : '开始测试：娱乐模式 · 单项强度'
        : `开始测试：${getRaceModeTitle(modeTestMode)}`;
    const raceRouteChoice = button(modeContent, 'EntertainmentTestRoute',
        entertainmentTestRoute === 'graded' ? '方案：整局分级' : '方案：单项强度测试', -270, -50, 250, () => {
            if (entertainmentTestRoute === 'graded') {
                entertainmentTestRoute = 'legacy';
                setup.entertainmentIntensity = legacyEntertainmentIntensity;
            } else {
                legacyEntertainmentIntensity = setup.entertainmentIntensity ?? legacyEntertainmentIntensity;
                entertainmentTestRoute = 'graded';
                setup.entertainmentIntensity = null;
            }
            write(raceRouteChoice.label, entertainmentTestRoute === 'graded'
                ? '方案：整局分级' : '方案：单项强度测试');
            setActive(raceGradeChoice.node, entertainmentTestRoute === 'graded');
            setActive(intensityChoice.node, entertainmentTestRoute === 'legacy');
            setActive(eventChoice.node, entertainmentTestRoute === 'legacy');
            setActive(eventLevelChoice.node, entertainmentTestRoute === 'legacy');
            setActive(combinationChoice.node, entertainmentTestRoute === 'legacy');
            write(intensityChoice.label, intensityText());
            write(modeStart.label, modeStartText());
        }, 40);
    setActive(raceRouteChoice.node, modeTestMode === 'entertainment-brawl');
    const raceGradeChoice = button(modeContent, 'EntertainmentRaceGrade',
        `整局强度 ${setup.entertainmentRaceGrade} 档`, 0, -50, 250, () => {
            const grade = setup.entertainmentRaceGrade ?? 3;
            setup.entertainmentRaceGrade = grade === 5 ? 1 : (grade + 1) as 1 | 2 | 3 | 4 | 5;
            write(raceGradeChoice.label, `整局强度 ${setup.entertainmentRaceGrade} 档`);
            write(modeStart.label, modeStartText());
        }, 40);
    setActive(raceGradeChoice.node, modeTestMode === 'entertainment-brawl' && entertainmentTestRoute === 'graded');
    let selectedEventIndex = 0;
    const updateModeSelection = (previous: RaceModeId | null, current: RaceModeId) => {
        if (previous === current) return;
        if (previous === 'entertainment-brawl') {
            if (entertainmentTestRoute === 'legacy') legacyEntertainmentIntensity = setup.entertainmentIntensity ?? legacyEntertainmentIntensity;
            setup.entertainmentIntensity = soloIntensity;
        } else if (current === 'entertainment-brawl') {
            soloIntensity = setup.entertainmentIntensity;
            setup.entertainmentIntensity = entertainmentTestRoute === 'graded' ? null : legacyEntertainmentIntensity;
        }
        if (previous) setActive(modeViews.get(previous)?.selected ?? null, false);
        setActive(modeViews.get(current)?.selected ?? null, true);
        setActive(whirlpoolOptions, current === 'whirlpool-brawl' && setup.entertainmentIntensity === null);
        setActive(waveOptions, current === 'giant-wave-brawl');
        setActive(obstacleOptions, current === 'obstacle-brawl');
        setActive(raceRouteChoice.node, current === 'entertainment-brawl');
        setActive(raceGradeChoice.node, current === 'entertainment-brawl' && entertainmentTestRoute === 'graded');
        setActive(intensityChoice.node, current === 'entertainment-brawl'
            ? entertainmentTestRoute === 'legacy' : current !== 'giant-wave-brawl');
        setActive(eventChoice.node, current === 'entertainment-brawl' && entertainmentTestRoute === 'legacy');
        setActive(eventLevelChoice.node, current === 'entertainment-brawl' && entertainmentTestRoute === 'legacy');
        setActive(combinationChoice.node, current === 'entertainment-brawl' && entertainmentTestRoute === 'legacy');
        setActive(modeHint, current !== 'entertainment-brawl' && current !== 'obstacle-brawl');
        modeSeed.node.setPosition(current === 'entertainment-brawl' ? 150 : -100,
            current === 'entertainment-brawl' || current === 'obstacle-brawl' ? -154 : -108, 0);
        write(intensityChoice.label, intensityText());
        write(modeStart.label, modeStartText());
    };
    for (let index = 0; index < MODE_TEST_MODES.length; index++) {
        const testMode = MODE_TEST_MODES[index];
        const x = -280 + (index % 3) * 280;
        const y = 154 - Math.floor(index / 3) * 62;
        const card = button(modeContent, `ModeChoice${index}`, getRaceModeTitle(testMode), x, y, 250, () => {
            const previous = modeTestMode;
            modeTestMode = testMode;
            updateModeSelection(previous, modeTestMode);
        }, 48);
        const selected = makeRect('Selected', card.node, 8, 42, uiColor(66, 222, 255, 255));
        selected.setPosition(-119, 0, 0);
        setActive(selected, testMode === modeTestMode);
        modeViews.set(testMode, { selected, label: card.label });
    }
    const intensityText = () => setup.entertainmentIntensity === null
        ? '原规格'
        : modeTestMode === 'entertainment-brawl'
            ? setup.entertainmentEventIntensities?.every(value => value === setup.entertainmentIntensity)
                ? `统一强度 ${setup.entertainmentIntensity}` : '逐项强度配置'
            : `强度 ${setup.entertainmentIntensity} · ${ENTERTAINMENT_INTENSITY_LABELS[setup.entertainmentIntensity - 1]}`;
    const intensityChoice = button(modeContent, 'IntensityChoice', intensityText(), 0, -50, 250, () => {
        const next = setup.entertainmentIntensity === null ? 1 : setup.entertainmentIntensity === 5
            ? modeTestMode === 'entertainment-brawl' ? 1 : null
            : (setup.entertainmentIntensity + 1) as EntertainmentIntensity;
        setup.entertainmentIntensity = next;
        if (modeTestMode === 'entertainment-brawl') legacyEntertainmentIntensity = next ?? 3;
        else soloIntensity = next;
        setActive(whirlpoolOptions, modeTestMode === 'whirlpool-brawl' && next === null);
        setActive(eventChoice.node, modeTestMode === 'entertainment-brawl' && next !== null);
        setActive(eventLevelChoice.node, modeTestMode === 'entertainment-brawl' && next !== null);
        setActive(combinationChoice.node, modeTestMode === 'entertainment-brawl' && next !== null);
        if (next !== null) {
            if (modeTestMode === 'entertainment-brawl') {
                setup.entertainmentEventIntensities = [next, next, next, next, next, next, next];
            } else {
                const event = modeTestMode === 'stimulant-brawl' ? EntertainmentEventId.STIMULANT
                    : modeTestMode === 'timed-bomb-brawl' ? EntertainmentEventId.TIMED_BOMB
                    : modeTestMode === 'whirlpool-brawl' ? EntertainmentEventId.WHIRLPOOL
                    : modeTestMode === 'obstacle-brawl' ? EntertainmentEventId.OBSTACLE
                    : modeTestMode === 'shark-brawl' ? EntertainmentEventId.SHARK
                    : modeTestMode === 'last-place-brawl' ? EntertainmentEventId.CANNON
                    : -1;
                if (event >= 0) {
                    const levels = [...(setup.entertainmentEventIntensities ?? [3, 3, 3, 3, 3, 3, 3])];
                    levels[event] = next;
                    setup.entertainmentEventIntensities = levels;
                }
            }
            applyCombinationMinimums();
        }
        write(intensityChoice.label, intensityText());
        write(eventLevelChoice.label, eventLevelText());
    }, 40);
    setActive(intensityChoice.node, modeTestMode === 'entertainment-brawl'
        ? entertainmentTestRoute === 'legacy' : modeTestMode !== 'giant-wave-brawl');
    const distanceChoice = button(modeContent, 'DistanceChoice', `${setup.raceDistance} 米`, 270, -50, 145, () => {
        setup.raceDistance = setup.raceDistance === 400 ? 200 : 400;
        write(distanceChoice.label, `${setup.raceDistance} 米`);
    }, 40);
    const eventLevelText = () => {
        const event = ENTERTAINMENT_TEST_EVENTS[selectedEventIndex];
        const level = setup.entertainmentEventIntensities?.[event.id] ?? 3;
        return `${event.title}：${level} 档 · ${ENTERTAINMENT_INTENSITY_LABELS[level - 1]}`;
    };
    eventChoice = button(modeContent, 'EventChoice', '逐项设置：苏打', -145, -108, 255, () => {
        selectedEventIndex = (selectedEventIndex + 1) % ENTERTAINMENT_TEST_EVENTS.length;
        write(eventChoice.label, `逐项设置：${ENTERTAINMENT_TEST_EVENTS[selectedEventIndex].title}`);
        write(eventLevelChoice.label, eventLevelText());
    }, 40);
    eventLevelChoice = button(modeContent, 'EventLevelChoice', eventLevelText(), 150, -108, 255, () => {
        const levels = [...(setup.entertainmentEventIntensities ?? [3, 3, 3, 3, 3, 3, 3])];
        const event = ENTERTAINMENT_TEST_EVENTS[selectedEventIndex].id;
        const minimum = setup.entertainmentTestCombination === 'litter-whirlpool'
            && event === EntertainmentEventId.WHIRLPOOL
            || setup.entertainmentTestCombination === 'minefield-cannon'
            && event === EntertainmentEventId.CANNON ? 4 : 1;
        levels[event] = levels[event] === 5 ? minimum : Math.max(minimum, levels[event] + 1) as EntertainmentIntensity;
        setup.entertainmentEventIntensities = levels;
        write(eventLevelChoice.label, eventLevelText());
        write(intensityChoice.label, intensityText());
    }, 40);
    setActive(eventChoice.node, modeTestMode === 'entertainment-brawl' && entertainmentTestRoute === 'legacy');
    setActive(eventLevelChoice.node, modeTestMode === 'entertainment-brawl' && entertainmentTestRoute === 'legacy');
    const applyCombinationMinimums = () => {
        const event = setup.entertainmentTestCombination === 'litter-whirlpool'
            ? EntertainmentEventId.WHIRLPOOL
            : setup.entertainmentTestCombination === 'minefield-cannon'
                ? EntertainmentEventId.CANNON : -1;
        if (event < 0) return;
        const levels = [...(setup.entertainmentEventIntensities ?? [3, 3, 3, 3, 3, 3, 3])];
        if (levels[event] >= 4) return;
        levels[event] = 4;
        setup.entertainmentEventIntensities = levels;
    };
    const combinationText = () => `组合：${ENTERTAINMENT_TEST_COMBINATIONS.find(
        item => item.id === setup.entertainmentTestCombination)?.label ?? '随机轮换'}`;
    applyCombinationMinimums();
    write(eventLevelChoice.label, eventLevelText());
    write(intensityChoice.label, intensityText());
    combinationChoice = button(modeContent, 'CombinationChoice', combinationText(), -145, -154, 255, () => {
        const previous = ENTERTAINMENT_TEST_COMBINATIONS.findIndex(
            item => item.id === setup.entertainmentTestCombination);
        setup.entertainmentTestCombination = previous >= ENTERTAINMENT_TEST_COMBINATIONS.length - 1
            ? null : ENTERTAINMENT_TEST_COMBINATIONS[previous + 1].id;
        applyCombinationMinimums();
        write(combinationChoice.label, combinationText());
        write(eventLevelChoice.label, eventLevelText());
        write(intensityChoice.label, intensityText());
    }, 40);
    setActive(combinationChoice.node, modeTestMode === 'entertainment-brawl' && entertainmentTestRoute === 'legacy');
    modeSeed = button(modeContent, 'ModeSeed', seedText(), -100, -108, 260, cycleSeed);
    if (modeTestMode === 'entertainment-brawl') modeSeed.node.setPosition(150, -154, 0);
    else if (modeTestMode === 'obstacle-brawl') modeSeed.node.setPosition(-100, -154, 0);
    const modeHint = makeLabel('Hint', modeContent,
        '固定为玩家 + 7 个高手 AI · 混合角色 · 等级沿用角色页设置',
        18, uiColor(190, 210, 220));
    modeHint.setPosition(0, -152, 0);
    setActive(modeHint, modeTestMode !== 'entertainment-brawl' && modeTestMode !== 'obstacle-brawl');
    const modeStart = button(modeContent, 'ModeStart', modeStartText(), 0, -202, 420, () => {
        launch(modeTestMode, MODE_TEST_DIFFICULTY, true);
    });

    makeLabel('Subtitle', currencyContent, '调整本地测试存档，点击中间数额可切换档位', 18, uiColor(190, 210, 220)).setPosition(0, 205, 0);
    const balanceLabels = new Map<DebugCurrencyId, Label | null>();
    const amountIndexes: Record<DebugCurrencyId, number> = { coins: 0, breakthroughGems: 0 };
    let currencyBusy = false;
    const updateCurrencyBalances = (balances: DebugCurrencyBalances) => {
        write(balanceLabels.get('coins') ?? null, `当前：${Math.max(0, Math.floor(balances.coins))}`);
        write(balanceLabels.get('breakthroughGems') ?? null, `当前：${Math.max(0, Math.floor(balances.breakthroughGems))}`);
    };
    const adjustCurrency = async (currency: DebugCurrencyId, direction: -1 | 1) => {
        if (currencyBusy) return;
        currencyBusy = true;
        const steps = CURRENCY_AMOUNT_STEPS[currency];
        const delta = steps[amountIndexes[currency]] * direction;
        try {
            updateCurrencyBalances(await currencyDebug.adjust(currency, delta));
        } finally {
            currencyBusy = false;
        }
    };
    const makeCurrencyRow = (currency: DebugCurrencyId, title: string, y: number) => {
        const row = makeUiNode(currency === 'coins' ? 'CoinRow' : 'GemRow', currencyContent);
        row.setPosition(0, y, 0);
        makeRect('Back', row, 760, 126, uiColor(20, 51, 84, 245));
        makeLabel('Title', row, title, 24, uiColor(240, 250, 255)).setPosition(-278, 22, 0);
        const balance = makeLabel('Balance', row, '', 18, uiColor(190, 210, 220)).getComponent(Label);
        balance.node.setPosition(-278, -22, 0);
        balanceLabels.set(currency, balance);
        button(row, 'Subtract', '−', 24, 0, 70, () => adjustCurrency(currency, -1), 54);
        const amountText = () => `数额 ${CURRENCY_AMOUNT_STEPS[currency][amountIndexes[currency]]}`;
        const amount = button(row, 'Amount', amountText(), 170, 0, 190, () => {
            amountIndexes[currency] = (amountIndexes[currency] + 1) % CURRENCY_AMOUNT_STEPS[currency].length;
            write(amount.label, amountText());
        }, 54);
        button(row, 'Add', '+', 316, 0, 70, () => adjustCurrency(currency, 1), 54);
    };
    makeCurrencyRow('coins', '金币', 105);
    makeCurrencyRow('breakthroughGems', '突破宝石', -50);
    updateCurrencyBalances(currencyDebug.read());
    makeLabel('Hint', currencyContent, '余额不会低于 0；调试货币不进入比赛状态或联机同步', 18, uiColor(190, 210, 220)).setPosition(0, -158, 0);

    button(root, 'Cancel', '返回', 0, -266, 240, close);
    // 静态调试文案同样使用随包字体；只在挂载时应用，不在切换或比赛帧重复遍历。
    const styleLabels = (node: Node) => {
        const label = node.getComponent(Label);
        if (label) styleProjectUiLabel(label, node.name === 'Subtitle' || node.name === 'Hint' ? 'regular' : 'semibold', label.fontSize + 6);
        for (const child of node.children) styleLabels(child);
    };
    styleLabels(root);
}
