import { buildEntertainmentLightPlan } from '../entertainment/EntertainmentLightPlan';
import { buildCannonDebugPlan, ENTERTAINMENT_DEBUG_CHOICES, entertainmentGeyserIntensity, entertainmentGiantWaveIntensity, normalizeEntertainmentDebugMode } from '../entertainment/EntertainmentDebugPlan';
import { geyserSpec } from '../entertainment/GeyserBrawlRules';
import { giantWaveSpec } from '../entertainment/GiantWaveRules';
import { BlockInputEvents, Label, Node, UITransform, view } from 'cc';
import { getAiDebugSetup, setAiDebugSetup } from '../core/GameLaunchOptions';
import { getRaceDistance, getRaceModeTitle, RaceDifficulty } from '../core/GameBalance';
import { PLAYER_CHARACTER_DEFINITIONS } from '../app/PlayerCharacterConfig';
import { AI_DEBUG_DIFFICULTY_TIERS } from '../competitor/CompetitorConfig';
import { makeButton, makeLabel, makeRect, makeUiNode, uiColor } from './RuntimeUiFactory';
import { styleProjectUiLabel } from './ProjectUiFonts';
import { BOSS_AI_PRESETS, findBossPreset } from '../competitor/BossAiConfig';

const PANEL_WIDTH = 880;
const PANEL_HEIGHT = 700;

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
    let bossIndex = Math.max(0, BOSS_AI_PRESETS.findIndex(p => p.id === setup.bossId));
    let bossMode = !!findBossPreset(setup.bossId);
    makeRect('Back', root, PANEL_WIDTH, PANEL_HEIGHT, uiColor(13, 35, 61, 250));
    makeLabel('Title', root, '角色 AI 测试', 28, uiColor(240, 250, 255)).setPosition(0, 310, 0);
    const subtitle = makeLabel('Subtitle', root, '先设置阵容，再点击右侧智力档开始比赛', 18, uiColor(190, 210, 220)).getComponent(Label);
    subtitle.node.setPosition(0, 276, 0);
    const button = (name: string, text: string, x: number, y: number, width: number, action: () => void) => {
        const node = makeButton(name, root, width, 48, uiColor(40, 96, 168, 240), text);
        node.setPosition(x, y, 0);
        node.on(Node.EventType.TOUCH_END, action);
        const label = node.getChildByName('Label')?.getComponent(Label);
        if (label) { label.overflow = Label.Overflow.SHRINK; label.enableWrapText = false; }
        return label;
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
        updateHint();
    });
    const seed = button('Seed', `种子 ${setup.seed}`, -195, -146, 360, () => {
        setup.seed = setup.seed === 20260913 ? 42 : setup.seed === 42 ? 12345 : setup.seed === 12345 && setup.entertainment === 'light-mix' ? 6 : 20260913;
        write(seed, `种子 ${setup.seed}`); updateHint();
    });
    let entertainmentIndex = ENTERTAINMENT_DEBUG_CHOICES.findIndex(choice => choice.id === normalizeEntertainmentDebugMode(setup.entertainment));
    const entertainmentText = () => `娱乐：${ENTERTAINMENT_DEBUG_CHOICES[entertainmentIndex].label}`;
    const entertainment = button('Entertainment', entertainmentText(), 210, 232, 290, () => {
        entertainmentIndex = (entertainmentIndex + 1) % ENTERTAINMENT_DEBUG_CHOICES.length;
        setup.entertainment = ENTERTAINMENT_DEBUG_CHOICES[entertainmentIndex].id;
        write(entertainment, entertainmentText()); updateHint();
    });
    const hint = makeLabel('Hint', root, '等级与智力应用于全部 AI，玩家使用自己的角色属性', 18, uiColor(190, 210, 220)).getComponent(Label);
    hint.node.setPosition(0, -210, 0);
    const updateHint = () => {
        if (!bossMode && setup.entertainment === 'water-balloon') {
            write(hint, '肩背携带水球，贴近对手转交；最后0.8秒锁定，时间到后爆开'); return;
        }
        const cannonPlan = !bossMode ? buildCannonDebugPlan(setup.entertainment, getRaceDistance(setup.mode)) : null;
        if (cannonPlan) {
            write(hint, `最多 ${cannonPlan.triggers.length} 发，同一时间最多 ${cannonPlan.maxConcurrentLaunches} 颗水球${cannonPlan.minimumLaunchIntervalSeconds > 0 ? `，间隔至少 ${cannonPlan.minimumLaunchIntervalSeconds} 秒` : ''}；落点提前提醒`);
            return;
        }
        const geyserLevel = !bossMode ? entertainmentGeyserIntensity(setup.entertainment) : null;
        if (geyserLevel) {
            const spec = geyserSpec(geyserLevel);
            write(hint, `每组 ${spec.ventCount} 个喷口，各喷 ${spec.pulseCount} 次；最多 ${spec.largeCount} 个大口`);
            return;
        }
        const waveLevel = !bossMode ? entertainmentGiantWaveIntensity(setup.entertainment) : null;
        if (waveLevel) {
            const spec = giantWaveSpec(waveLevel);
            write(hint, `${waveLevel}档：覆盖泳池 ${Math.round(spec.widthFraction * 100)}%，迎浪最多减速 ${Math.round(spec.oppositionSlowdown * 100)}%；顺浪加速不变`);
            return;
        }
        const kind = !bossMode && setup.entertainment === 'light-mix'
            ? buildEntertainmentLightPlan(setup.seed, getRaceDistance()).waterEvent : null;
        const text = !bossMode && setup.entertainment === 'spray-buoy' ? '直接撞浮标会扶圈恢复 3.5 秒，随后保护 2 秒；附近选手仅受冲击' : bossMode ? '仅调试体验；生涯杯赛与联赛不加入这些关卡' : kind ? `组合：补给＋杂物＋${kind === 'whirlpool' ? '普通漩涡' : kind === 'geyser' ? '普通喷泉' : '普通巨浪'}（水面事件一局一次）`
            : '等级与智力应用于全部 AI，玩家使用自己的角色属性';
        if (hint.string !== text) hint.string = text;
    };
    updateHint();
    let launched = false;
    AI_DEBUG_DIFFICULTY_TIERS.forEach((tier, i) => button(`Tier${i}`, tier.label, 210, 174 - i * 60, 290, () => {
        if (launched || bossMode) return;
        launched = true;
        setup.bossId = null;
        setAiDebugSetup(setup);
        start(tier.value);
    }));
    const normalNames = ['Entertainment', 'Character', 'Level', 'LevelDown', 'LevelUp', 'OpponentCount', 'Roster', 'Mode',
        ...AI_DEBUG_DIFFICULTY_TIERS.map((_, i) => `Tier${i}`)];
    const normalNodes = normalNames.map(name => root.getChildByName(name));
    const bossName = button('BossPreset', BOSS_AI_PRESETS[bossIndex].name, -195, 174, 360, () => changeBoss(1));
    if (bossName) bossName.fontSize = 21;
    button('BossPrevious', '上一关', -305, 112, 130, () => changeBoss(-1));
    button('BossNext', '下一关', -85, 112, 130, () => changeBoss(1));
    const bossInfo = makeLabel('BossInfo', root, '', 20, uiColor(240, 250, 255)).getComponent(Label);
    bossInfo.node.setPosition(-195, 16, 0);
    bossInfo.node.getComponent(UITransform).setContentSize(360, 128);
    bossInfo.overflow = Label.Overflow.CLAMP; bossInfo.enableWrapText = true; bossInfo.lineHeight = 29;
    const bossFacts = makeLabel('BossFacts', root, '', 19, uiColor(190, 210, 220)).getComponent(Label);
    bossFacts.node.setPosition(-195, -88, 0);
    bossFacts.node.getComponent(UITransform).setContentSize(370, 56);
    bossFacts.overflow = Label.Overflow.CLAMP; bossFacts.enableWrapText = true;
    button('BossStart', '开始 Boss 体验', 210, 174, 290, () => {
        if (launched || !bossMode) return;
        launched = true; setup.bossId = BOSS_AI_PRESETS[bossIndex].id;
        setAiDebugSetup(setup); start(0.5);
    });
    const bossNote = makeLabel('BossNote', root, '每关有固定阵容与专属战术\n使用当前出场角色和养成\n可切换镜头观察队友配合\n不发奖励，不推进生涯', 19, uiColor(190, 210, 220)).getComponent(Label);
    bossNote.node.setPosition(210, 18, 0);
    bossNote.node.getComponent(UITransform).setContentSize(300, 170);
    bossNote.overflow = Label.Overflow.CLAMP; bossNote.enableWrapText = true; bossNote.lineHeight = 32;
    const bossNodes = ['BossPreset', 'BossPrevious', 'BossNext', 'BossInfo', 'BossFacts', 'BossStart', 'BossNote']
        .map(name => root.getChildByName(name));
    const active = (node: Node, value: boolean) => { if (node.active !== value) node.active = value; };
    const updateBoss = () => {
        const p = BOSS_AI_PRESETS[bossIndex];
        write(bossName, `${bossIndex + 1}/${BOSS_AI_PRESETS.length} · ${p.name}`);
        write(bossInfo, p.hint);
        const min = Math.min(...p.roster.map(s => s.level)), max = Math.max(...p.roster.map(s => s.level));
        write(bossFacts, `${p.roster.length + 1}人 · ${getRaceModeTitle(p.mode)} · ${p.distance}米\nAI ${min === max ? min : `${min}～${max}`}级 · ${p.qualifyPlace === 1 ? '冠军达标' : `前${p.qualifyPlace}达标`}`);
    };
    function changeBoss(delta: number) {
        bossIndex = (bossIndex + delta + BOSS_AI_PRESETS.length) % BOSS_AI_PRESETS.length; updateBoss();
    }
    const category = button('DebugCategory', '测试类型', -195, 232, 360, () => { bossMode = !bossMode; updateCategory(); });
    const updateCategory = () => {
        for (const node of normalNodes) active(node, !bossMode);
        for (const node of bossNodes) active(node, bossMode);
        write(category, bossMode ? '测试类型：Boss 关卡' : '测试类型：普通 AI');
        write(subtitle, bossMode ? '选择关卡，体验固定阵容与独立 AI 战术' : '先设置阵容，再点击右侧智力档开始比赛');
        updateHint();
        updateBoss();
    };
    updateCategory();
    button('Cancel', '返回', -195, -266, 220, close);
    button('DebugCoins', '调试领取金币', 210, -266, 290, grantCoins);
    // 静态调试文案同样使用随包字体；只在挂载时应用，不在切换或比赛帧重复遍历。
    for (const child of root.children) {
        const label = child.getComponent(Label) ?? child.getChildByName('Label')?.getComponent(Label);
        if (label) styleProjectUiLabel(label, child.name === 'Subtitle' || child.name === 'Hint' ? 'regular' : 'semibold', label.fontSize + 6);
    }
}
