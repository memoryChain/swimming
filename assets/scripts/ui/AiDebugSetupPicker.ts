import { BlockInputEvents, Label, Node, UITransform, view } from 'cc';
import { getAiDebugSetup, setAiDebugSetup } from '../core/GameLaunchOptions';
import { getRaceDistance, getRaceModeTitle, RaceDifficulty } from '../core/GameBalance';
import { PLAYER_CHARACTER_DEFINITIONS } from '../app/PlayerCharacterConfig';
import { AI_DEBUG_DIFFICULTY_TIERS } from '../competitor/CompetitorConfig';
import { makeButton, makeLabel, makeRect, makeUiNode, uiColor } from './RuntimeUiFactory';
import { styleProjectUiLabel } from './ProjectUiFonts';

const PANEL_WIDTH = 880;
const PANEL_HEIGHT = 620;

/** 保留 Popup 相机坐标系；全屏遮挡独立于面板缩放，窗口变化时才更新布局。 */
export function mountAiDebugSetupPicker(parent: Node, start: (difficulty: number) => void, grantCoins: () => void): Node {
    const overlay = makeUiNode('AiDebugPicker', parent);
    overlay.addComponent(BlockInputEvents);
    const dim = makeRect('Dim', overlay, 1, 1, uiColor(2, 8, 14, 210));
    const panel = makeUiNode('Panel', overlay);
    panel.getComponent(UITransform).setContentSize(PANEL_WIDTH, PANEL_HEIGHT);
    buildAiDebugSetupPicker(panel, start, grantCoins, () => overlay.destroy());
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

// 仅调试入口。节点和监听一次建立，切换只改对应 Label，不加载或重建角色模型。
export function buildAiDebugSetupPicker(root: Node, start: (difficulty: number) => void, grantCoins: () => void, close = () => root.destroy()) {
    const setup = { ...getAiDebugSetup() };
    const modes: RaceDifficulty[] = ['beginner', 'competitive', 'championship'];
    let characterIndex = Math.max(0, PLAYER_CHARACTER_DEFINITIONS.findIndex(c => c.id === setup.characterId));
    makeRect('Back', root, PANEL_WIDTH, PANEL_HEIGHT, uiColor(13, 35, 61, 250));
    makeLabel('Title', root, '角色 AI 测试', 28, uiColor(240, 250, 255)).setPosition(0, 266, 0);
    makeLabel('Subtitle', root, '先设置阵容，再点击右侧智力档开始比赛', 18, uiColor(190, 210, 220)).setPosition(0, 225, 0);
    const button = (name: string, text: string, x: number, y: number, width: number, action: () => void) => {
        const node = makeButton(name, root, width, 48, uiColor(40, 96, 168, 240), text);
        node.setPosition(x, y, 0);
        node.on(Node.EventType.TOUCH_END, action);
        return node.getChildByName('Label')?.getComponent(Label);
    };
    const write = (label: Label | null, text: string) => { if (label && label.string !== text) label.string = text; };
    const mixed = () => setup.opponentCount === 7 && setup.mixedCharacters;
    const characterText = () => mixed() ? '角色：多角色混合' : `角色：${PLAYER_CHARACTER_DEFINITIONS[characterIndex].name}`;
    const character = button('Character', characterText(), -195, 174, 360, () => {
        if (mixed()) setup.mixedCharacters = false;
        else characterIndex = (characterIndex + 1) % PLAYER_CHARACTER_DEFINITIONS.length;
        setup.characterId = PLAYER_CHARACTER_DEFINITIONS[characterIndex].id;
        write(character, characterText());
        write(roster, rosterText());
    });
    const level = makeLabel('Level', root, `等级 ${setup.level}`, 22, uiColor(240, 250, 255)).getComponent(Label);
    level.node.getComponent(UITransform).setContentSize(210, 42);
    level.node.setPosition(-195, 110, 0);
    button('LevelDown', '−', -335, 110, 56, () => { setup.level = Math.max(1, setup.level - 1); write(level, `等级 ${setup.level}`); });
    button('LevelUp', '+', -55, 110, 56, () => { setup.level = Math.min(30, setup.level + 1); write(level, `等级 ${setup.level}`); });
    const countText = () => setup.opponentCount === 7 ? '7 个 AI 对手 · 8 人比赛' : '1 个 AI 对手 · 2 人比赛';
    const count = button('OpponentCount', countText(), -195, 46, 360, () => {
        setup.opponentCount = setup.opponentCount === 7 ? 1 : 7;
        write(count, countText());
        write(character, characterText());
        write(roster, rosterText());
    });
    const rosterText = () => setup.opponentCount === 1 ? '阵容：单个指定角色' : mixed() ? '阵容：多角色混合' : '阵容：全部同角色';
    const roster = button('Roster', rosterText(), -195, -18, 360, () => {
        if (setup.opponentCount === 1) return;
        setup.mixedCharacters = !setup.mixedCharacters;
        write(roster, rosterText());
        write(character, characterText());
    });
    const modeText = () => `${getRaceModeTitle(setup.mode)} ${getRaceDistance(setup.mode)}米`;
    const mode = button('Mode', modeText(), -195, -82, 360, () => {
        setup.mode = modes[(modes.indexOf(setup.mode) + 1) % modes.length]; write(mode, modeText());
    });
    const seed = button('Seed', `种子 ${setup.seed}`, -195, -146, 360, () => {
        setup.seed = setup.seed === 20260913 ? 42 : setup.seed === 42 ? 12345 : 20260913;
        write(seed, `种子 ${setup.seed}`);
    });
    makeLabel('Hint', root, '等级与智力应用于全部 AI，玩家使用自己的角色属性', 18, uiColor(190, 210, 220)).setPosition(0, -210, 0);
    let launched = false;
    AI_DEBUG_DIFFICULTY_TIERS.forEach((tier, i) => button(`Tier${i}`, tier.label, 210, 174 - i * 72, 290, () => {
        if (launched) return;
        launched = true;
        setAiDebugSetup(setup);
        start(tier.value);
    }));
    button('Cancel', '返回', -195, -266, 220, close);
    button('DebugCoins', '调试领取金币', 210, -266, 290, grantCoins);
    // 静态调试文案同样使用随包字体；只在挂载时应用，不在切换或比赛帧重复遍历。
    for (const child of root.children) {
        const label = child.getComponent(Label) ?? child.getChildByName('Label')?.getComponent(Label);
        if (label) styleProjectUiLabel(label, child.name === 'Subtitle' || child.name === 'Hint' ? 'regular' : 'semibold', label.fontSize + 6);
    }
}
