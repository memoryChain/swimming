import { BlockInputEvents, Label, Node, UITransform, view } from 'cc';
import { getAiDebugSetup, setAiDebugSetup } from '../core/GameLaunchOptions';
import { getRaceDistance, getRaceModeTitle, RaceDifficulty, RaceModeId } from '../core/GameBalance';
import { PLAYER_CHARACTER_DEFINITIONS } from '../app/PlayerCharacterConfig';
import { AI_DEBUG_DIFFICULTY_TIERS } from '../competitor/CompetitorConfig';
import type { DebugCurrencyId } from '../backend/IBackend';
import { makeButton, makeLabel, makeRect, makeUiNode, uiColor } from './RuntimeUiFactory';
import { styleProjectUiLabel } from './ProjectUiFonts';

const PANEL_WIDTH = 880;
const PANEL_HEIGHT = 620;
const MODE_TEST_MODES: readonly RaceModeId[] = [
    'stimulant-brawl',
    'shark-brawl',
    'whirlpool-brawl',
    'last-place-brawl',
    'timed-bomb-brawl',
    'minefield-brawl',
    'litter-brawl',
];
const MODE_TEST_DIFFICULTY = AI_DEBUG_DIFFICULTY_TIERS[2].value;

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
};

const EMPTY_CURRENCY_DEBUG: DebugCurrencyPanelOptions = {
    read: () => ({ coins: 0, breakthroughGems: 0 }),
    adjust: async () => ({ coins: 0, breakthroughGems: 0 }),
};

const CURRENCY_AMOUNT_STEPS: Readonly<Record<DebugCurrencyId, readonly number[]>> = {
    coins: [100, 1000, 10000],
    breakthroughGems: [1, 5, 10],
};

/** 保留 Popup 相机坐标系；全屏遮挡独立于面板缩放，窗口变化时才更新布局。 */
export function mountAiDebugSetupPicker(
    parent: Node,
    start: (difficulty: number) => void,
    currencyDebug: DebugCurrencyPanelOptions,
): Node {
    const overlay = makeUiNode('AiDebugPicker', parent);
    overlay.addComponent(BlockInputEvents);
    const dim = makeRect('Dim', overlay, 1, 1, uiColor(2, 8, 14, 210));
    const panel = makeUiNode('Panel', overlay);
    panel.getComponent(UITransform).setContentSize(PANEL_WIDTH, PANEL_HEIGHT);
    buildAiDebugSetupPicker(panel, start, currencyDebug, () => overlay.destroy());
    const layout = () => {
        const size = view.getVisibleSize();
        const transform = overlay.getComponent(UITransform);
        if (transform.contentSize.width !== size.width || transform.contentSize.height !== size.height) {
            transform.setContentSize(size.width, size.height);
        }
        if (dim.scale.x !== size.width || dim.scale.y !== size.height) dim.setScale(size.width, size.height, 1);
        const scale = Math.min(1, Math.max(1, size.width - 48) / PANEL_WIDTH, Math.max(1, size.height - 48) / PANEL_HEIGHT);
        if (panel.scale.x !== scale || panel.scale.y !== scale) panel.setScale(scale, scale, 1);
    };
    layout();
    view.on('canvas-resize', layout);
    view.on('design-resolution-changed', layout);
    overlay.once(Node.EventType.NODE_DESTROYED, () => {
        view.off('canvas-resize', layout);
        view.off('design-resolution-changed', layout);
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
        node.on(Node.EventType.TOUCH_END, action);
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

    makeLabel('Subtitle', modeContent, '选择一个单项娱乐模式，使用固定阵容和种子开始测试', 18, uiColor(190, 210, 220)).setPosition(0, 218, 0);
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
    setActive(whirlpoolOptions, modeTestMode === 'whirlpool-brawl');
    const updateModeSelection = (previous: RaceModeId | null, current: RaceModeId) => {
        if (previous === current) return;
        if (previous) setActive(modeViews.get(previous)?.selected ?? null, false);
        setActive(modeViews.get(current)?.selected ?? null, true);
        setActive(whirlpoolOptions, current === 'whirlpool-brawl');
        write(modeStart.label, `开始测试：${getRaceModeTitle(current)}`);
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
    modeSeed = button(modeContent, 'ModeSeed', seedText(), 0, -108, 340, cycleSeed);
    makeLabel('Hint', modeContent, '固定为玩家 + 7 个高手 AI · 混合角色 · 等级沿用角色页设置', 18, uiColor(190, 210, 220)).setPosition(0, -152, 0);
    const modeStart = button(modeContent, 'ModeStart', `开始测试：${getRaceModeTitle(modeTestMode)}`, 0, -202, 420, () => {
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
