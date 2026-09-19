import { BlockInputEvents, Button, Label, Mask, Node, Sprite, UITransform, sys, view } from 'cc';
import type { PlayerProfile } from '../backend/PlayerProfile';
import { LEAGUES, RaceRule, SoloSource } from '../progression/CareerRules';
import { findPlayerCharacter, PlayerCharacterId } from '../app/PlayerCharacterConfig';
import { makeRect, makeUiNode, uiColor, fitFullScreenBackgroundCover } from './RuntimeUiFactory';
import { styleCurrencyNumberLabel } from './ProjectUiFonts';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { careerPageModel, CareerRoundStyle } from './CareerPageModel';
import { CareerControl, CareerImage, careerImage, careerLabel, careerText, careerColor, showCareerNode,
    CAREER_INK, CAREER_MUTED, CAREER_WHITE, CAREER_YELLOW } from './CareerPageWidgets';

export interface EventPageState {
    screen: 'quick' | 'career'; source: 'league' | 'cup'; tier: number;
    characterId: PlayerCharacterId; distance: 200 | 400; rule: RaceRule;
    busy: boolean; confirmAbandon: boolean; status: string; profile: PlayerProfile;
    reviewCupTier?: number | null;
}
export interface EventPageActions {
    home(): void; tier(value: number): void;
    distance(value: 200 | 400): void; rule(value: RaceRule): void;
    start(source?: SoloSource): void; abandon(): void; cancelAbandon?(): void;
    characters?(): void; finishReview?(): void;
}
const ART = RESOURCE_PATHS.careerUi;
const CYAN = uiColor(0, 192, 211), GREEN = uiColor(29, 108, 60);
const ROUND_COLORS: Record<CareerRoundStyle, ReturnType<typeof uiColor>> = {
    pending: uiColor(229,244,253), current: uiColor(255,241,183),
    complete: uiColor(222,245,231), failed: uiColor(255,225,219),
};
const RED = uiColor(170,67,58);
const CENTERS = [148,350,546,742,938,1137];
type TierView = { control: CareerControl; badge: CareerImage };
type RoundView = { root: Node; bg: CareerImage; status: Label; name: Label; distance: Label; unit: Label; condition: Label };

/** 生涯主稿的稳定节点树；刷新只更新变化的文字、贴图、颜色和状态。无update。 */
export class CareerEventPage {
    readonly root: Node;
    private readonly design: Node;
    private readonly career: Node;
    private readonly quick: Node;
    private readonly background: CareerImage;
    private readonly title: Label;
    private readonly back: CareerControl;
    private readonly tiers: TierView[] = [];
    private readonly hero: CareerImage;
    private readonly heroTitle: Label;
    private readonly avatar: CareerImage;
    private readonly characterName: Label;
    private readonly characterLevel: Label;
    private readonly changeCharacter: CareerControl;
    private readonly points: Label;
    private readonly progress: CareerImage;
    private readonly hint: Label;
    private readonly leagueStart: CareerControl;
    private readonly cupStart: CareerControl;
    private readonly cupTitle: Label;
    private readonly rounds: RoundView[] = [];
    private readonly roundArrows: CareerImage[] = [];
    private readonly rulesButton: CareerControl;
    private readonly levelPill: CareerImage;
    private heroTier = -1;
    private readonly layoutCharacterLevel = () => {
        const width = this.characterName.node.getComponent(UITransform)!.contentSize.width;
        const x = 584 + width + 12 + 35 - 640;
        for (const n of [this.levelPill.node, this.characterLevel.node]) {
            if (n.position.x !== x) n.setPosition(x, n.position.y);
        }
    };
    private readonly footer: Label;
    private readonly quickControls: CareerControl[] = [];
    private readonly quickSurfaces: CareerImage[] = [];
    private readonly quickStart: CareerControl;
    private readonly rules: Node;
    private readonly rulesText: Label;
    private readonly rulesClose: CareerControl;
    private readonly confirm: Node;
    private readonly confirmYes: CareerControl;
    private readonly confirmNo: CareerControl;
    private snapshot: EventPageState | null = null;
    private cupAction: ReturnType<typeof careerPageModel> | null = null;
    private pointsValue = -1;
    private roundCount = 0;
    private readonly resize = () => {
        if (!this.root.isValid) return;
        fitFullScreenBackgroundCover(this.background.node, 1280, 720);
        const size = view.getVisibleSize(), safe = sys.getSafeAreaRect(false);
        const width = Math.min(size.width, safe.width || size.width), height = Math.min(size.height, safe.height || size.height);
        const scale = Math.min(1, width / 1280, height / 720);
        if (this.design.scale.x !== scale) this.design.setScale(scale, scale, 1);
        const x = safe.width ? safe.x + safe.width / 2 - size.width / 2 : 0;
        const y = safe.height ? safe.y + safe.height / 2 - size.height / 2 : 0;
        if (this.design.position.x !== x || this.design.position.y !== y) this.design.setPosition(x, y);
    };

    constructor(parent: Node, private readonly actions: EventPageActions) {
        this.root = makeUiNode('CareerEventPage', parent);
        this.root.getComponent(UITransform)!.setContentSize(4000, 2400);
        this.root.addComponent(BlockInputEvents); this.root.active = false;
        this.background = careerImage(this.root, 'Background', ART.background, 0, 0, 1280, 720);
        this.design = makeUiNode('CareerDesign', this.root);
        this.design.getComponent(UITransform)!.setContentSize(1280, 720);
        this.career = makeUiNode('CareerMap', this.design);
        this.quick = makeUiNode('QuickPage', this.design);
        careerImage(this.design, 'Header', RESOURCE_PATHS.characterUi.headerBackground, 0, 0, 497, 111);
        this.back = new CareerControl(this.design, 'BackToLobby', '', 16, 8, 80, 64, () => actions.home());
        new CareerImage(this.back.root, 'BackIcon', RESOURCE_PATHS.characterUi.backIcon, 61, 40, 0, 0);
        this.title = careerLabel(this.design, 'PageTitle', '生涯', 105, 13, 350, 50, 36);
        careerImage(this.career, 'RouteLine', ART.route, 146, 140, 990, 10);
        for (let i = 0; i < 6; i++) {
            const control = new CareerControl(this.career, `LeagueTier${i}`, LEAGUES[i].name, CENTERS[i] - 80, 79, 160, 141,
                () => { if (!this.snapshot?.busy) actions.tier(i); }, false, 18);
            control.label.node.setPosition(0, -47.5);
            control.label.node.getComponent(UITransform)!.setContentSize(155, 30);
            const widths = [74,114,120,130,133,144];
            const badge = new CareerImage(control.root, 'Badge', ART.lockedBadges[i], widths[i], 112, 0, 17, true);
            this.tiers.push({control, badge});
        }
        this.hero = careerImage(this.career, 'HonorBadge', ART.badges[0], 28, 238, 327, 249, true);
        careerImage(this.career, 'Podium', ART.podium, 28, 485, 327, 132);
        this.heroTitle = careerLabel(this.career, 'SelectedLeague', '', 52, 525, 280, 43, 29, CAREER_INK, true);
        this.rulesButton = new CareerControl(this.career, 'RulesButton', '赛事规则', 119, 616, 144, 43, () => this.openRules(), false, 23);
        careerColor(this.rulesButton.label, CAREER_WHITE);
        const underline = careerImage(this.career, 'RulesUnderline', ART.panel, 145, 652, 92, 2);
        careerColor(underline.sprite, CAREER_WHITE);
        careerImage(this.career, 'CharacterBar', ART.characterBar, 392, 218, 862, 74);
        const avatarClip = makeUiNode('CharacterAvatarClip', this.career);
        avatarClip.setPosition(439 - 640, 360 - 256);
        avatarClip.getComponent(UITransform)!.setContentSize(56, 56);
        avatarClip.addComponent(Mask).type = Mask.Type.GRAPHICS_ELLIPSE;
        this.avatar = new CareerImage(avatarClip, 'CharacterAvatar', '', 56, 56, 0, 0, true);
        this.tag(this.career, '出场', '当前出场', 484, 239, 88, 30, ART.tagActive, GREEN);
        this.characterName = careerLabel(this.career, 'CharacterName', '', 584, 233, 170, 44, 24);
        this.characterName.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
        this.characterName.node.setPosition(584 - 640, 360 - 255);
        this.characterName.overflow = Label.Overflow.NONE;
        this.characterName.node.on(Node.EventType.SIZE_CHANGED, this.layoutCharacterLevel);
        this.levelPill = careerImage(this.career, 'LevelPill', ART.panel, 767, 241, 70, 28, false, true);
        careerColor(this.levelPill.sprite, CAREER_INK);
        this.characterLevel = careerLabel(this.career, 'CharacterLevel', '', 767, 240, 70, 30, 16, CAREER_WHITE, true);
        this.changeCharacter = new CareerControl(this.career, 'ChangeCharacter', '更换', 1129, 230, 84, 50,
            () => actions.characters?.(), false, 23);
        careerImage(this.career, 'ChangeArrow', ART.arrow, 1209, 243, 27, 24);
        styleCurrencyNumberLabel(this.characterLevel, 23);
        const detail = makeUiNode('SelectedEventPanel', this.career);
        careerImage(detail, 'LeaguePanel', ART.panel, 392, 306, 416, 368);
        careerImage(detail, 'CupPanel', ART.panel, 822, 306, 432, 368, false, true);
        this.tag(detail, '账号', '账号共享', 418, 326, 103, 36, ART.tagAccount);
        this.tag(detail, '角色', '角色专属', 848, 326, 106, 36, ART.tagCharacter);
        careerLabel(detail, 'LeagueTitle', '联赛挑战', 420, 366, 320, 52, 38);
        const modeNumber = careerLabel(detail, 'LeagueDistance', '200', 421, 420, 50, 30, 21, CAREER_MUTED);
        styleCurrencyNumberLabel(modeNumber, 28);
        careerLabel(detail, 'LeagueMode', '米 · 狂野模式', 471, 420, 270, 30, 21, CAREER_MUTED);
        const area = careerImage(detail, 'PointsArea', ART.panelWhite, 408, 463, 384, 115, false, true);
        careerColor(area.sprite, uiColor(229,244,253));
        careerLabel(detail, 'PointsHeading', '联赛积分', 427, 477, 150, 32, 20);
        this.points = careerLabel(detail, 'LeaguePoints', '', 612, 470, 95, 44, 34, CYAN);
        styleCurrencyNumberLabel(this.points, 41);
        this.points.horizontalAlign = Label.HorizontalAlign.RIGHT;
        const limit = careerLabel(detail, 'PointsLimit', '/ 100', 718, 480, 65, 30, 22, CAREER_MUTED);
        styleCurrencyNumberLabel(limit, 29);
        careerImage(detail, 'ProgressTrack', ART.progressTrack, 426, 515, 350, 16);
        this.progress = new CareerImage(detail, 'ProgressFill', ART.progressFill, 350, 16, 0, 0, false, true, 8);
        this.progress.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
        this.progress.node.setPosition(426 - 640, 360 - 523);
        this.hint = careerLabel(detail, 'LeagueHint', '', 426, 537, 352, 32, 17, CAREER_MUTED, false, false);
        this.leagueStart = new CareerControl(detail, 'StartLeague', '开始联赛', 407, 590, 384, 70, () => actions.start('league'), true, 31);
        this.cupTitle = careerLabel(detail, 'CupName', '', 850, 366, 225, 52, 36);
        for (let i = 0; i < 3; i++) {
            const r = makeUiNode(`CupRound${i}`, detail);
            const bg = new CareerImage(r, 'RoundSurface', ART.panelWhite, 112, 94, 0, 0, false, true);
            const make = (name: string, y: number, size: number, bold = true) => careerLabel(r, name, '', 640 - 76, 360 + y - 12, 152, 24, size, CAREER_INK, false, bold);
            const distance = make('Distance', 12, 20, false);
            const unit = make('DistanceUnit', 12, 20, false); careerText(unit, '米'); careerColor(unit, CAREER_MUTED);
            this.rounds.push({ root: r, bg, status: make('Status', -47, 14), name: make('Name', -19, 24),
                distance, unit, condition: make('Condition', 39, 18, false) });
            if (i < 2) this.roundArrows.push(careerImage(detail, `RoundArrow${i}`, ART.arrow, 964 + i * 136, 474, 14, 14));
        }
        this.cupStart = new CareerControl(detail, 'StartCup', '', 839, 598, 397, 62, () => this.onCup(), true, 31);
        this.buildQuick();
        this.quickStart = new CareerControl(this.quick, 'StartEvent', '开始比赛', 820, 610, 380, 60, () => actions.start('quick'), true, 26);
        this.footer = careerLabel(this.design, 'EventStatus', '', 392, 681, 862, 30, 17, CAREER_WHITE, true);
        this.rules = this.overlay('RulesOverlay', true);
        careerLabel(this.rules, 'RulesTitle', '赛事规则', 310, 174, 660, 50, 32, CAREER_INK, true);
        this.rulesText = careerLabel(this.rules, 'RulesText', '', 318, 234, 644, 252, 21, CAREER_INK, false, false);
        this.rulesText.enableWrapText = true;
        this.rulesText.lineHeight = 42;
        this.rulesText.verticalAlign = Label.VerticalAlign.TOP;
        // 与音量设置一致：按钮中心压在面板下边缘内侧2px，底图保持258×57原始比例。
        careerImage(this.rules, 'RulesCloseSurface', RESOURCE_PATHS.avatarPickerUi.confirmButton, 511, 539.5, 258, 57, true);
        this.rulesClose = new CareerControl(this.rules, 'CloseRules', '返回赛事', 504, 533, 272, 70, () => showCareerNode(this.rules, false), false, 26);
        this.confirm = this.overlay('AbandonConfirm');
        careerLabel(this.confirm, 'ConfirmTitle', '放弃本届杯赛？', 260, 175, 760, 60, 32, CAREER_INK, true);
        const warning = careerLabel(this.confirm, 'ConfirmWarning', '本届轮次进度将结束，再次挑战从预赛开始。\n账号联赛积分与已有夺冠记录保留。', 285, 270, 710, 125, 24, CAREER_INK, true, false);
        warning.enableWrapText = true;
        this.confirmNo = new CareerControl(this.confirm, 'CancelAbandon', '保留进度', 280, 470, 330, 65, () => actions.cancelAbandon?.(), true, 27);
        this.confirmYes = new CareerControl(this.confirm, 'ConfirmAbandon', '确认放弃', 670, 470, 330, 65, () => actions.abandon(), true, 27);
        this.resize(); view.on('canvas-resize', this.resize); view.on('design-resolution-changed', this.resize);
        this.root.once(Node.EventType.NODE_DESTROYED, () => { view.off('canvas-resize', this.resize); view.off('design-resolution-changed', this.resize); });
    }
    private tag(parent: Node, name: string, value: string, x: number, y: number, w: number, h: number,
        asset: string, ink = CAREER_INK): void {
        careerImage(parent, `${name}Tag`, asset, x, y, w, h);
        careerLabel(parent, `${name}TagLabel`, value, x + 5, y, w - 10, h, 18, ink, true);
    }
    private overlay(name: string, themed = false): Node {
        const root = makeRect(name, this.design, 4000, 2400, uiColor(0, 22, 46, 190));
        root.addComponent(BlockInputEvents);
        if (themed) careerImage(root, 'Sheet', RESOURCE_PATHS.avatarPickerUi.panel, 280, 140, 720, 430);
        else careerImage(root, 'Sheet', ART.panel, 230, 110, 820, 500, false, true);
        root.active = false; return root;
    }
    private buildQuick(): void {
        careerLabel(this.quick, 'DistanceHeading', '比赛距离', 100, 175, 500, 45, 28, CAREER_WHITE, true);
        careerLabel(this.quick, 'RuleHeading', '玩法规则', 670, 175, 500, 45, 28, CAREER_WHITE, true);
        const entries: [string, string, number, number, () => void][] = [
            ['Distance200', '200米\n一分多钟', 100, 254, () => this.actions.distance(200)],
            ['Distance400', '400米\n约三分钟', 100, 389, () => this.actions.distance(400)],
            ['RuleStandard', '标准竞速\n专注划水节奏', 670, 254, () => this.actions.rule('standard')],
            ['RuleWild', '狂野模式\n自由转向与争位', 670, 389, () => this.actions.rule('wild')],
        ];
        for (const [name, value, x, y, action] of entries) {
            const bg = careerImage(this.quick, `${name}Surface`, ART.panel, x, y, 490, 112, false, true);
            const c = new CareerControl(this.quick, name, value, x, y, 490, 112, action);
            c.label.enableWrapText = true; this.quickControls.push(c); this.quickSurfaces.push(bg);
        }
        const note = careerLabel(this.quick, 'QuickNotes', 'AI按角色等级与生涯进度自动匹配\n完赛获得金币，不增加联赛积分', 90, 526, 1100, 68, 23, CAREER_WHITE, true, false);
        note.enableWrapText = true;
        const help = new CareerControl(this.quick, 'QuickRules', '玩法说明', 70, 620, 220, 50, () => this.openRules());
        careerColor(help.label, CAREER_WHITE);
    }
    private openRules(): void { if (!this.snapshot?.busy) showCareerNode(this.rules, true); }
    private onCup(): void {
        const m = this.cupAction;
        if (!m || this.snapshot?.busy) return;
        if (m.action === 'next') this.actions.finishReview?.();
        else if (m.action === 'locate') this.actions.tier(m.actionTier);
        else if (m.action === 'start') this.actions.start('cup');
    }
    refresh(s: EventPageState): void {
        this.snapshot = s;
        const isCareer = s.screen === 'career';
        showCareerNode(this.career, isCareer); showCareerNode(this.quick, !isCareer);
        this.background.set(isCareer ? ART.background : RESOURCE_PATHS.lobbyUi.background);
        careerText(this.title, isCareer ? '生涯' : '单人快速比赛');
        this.back.update('', !s.busy); this.rulesClose.update('返回赛事', !s.busy);
        this.confirmYes.update(s.busy ? '正在保存…' : '确认放弃', !s.busy);
        this.confirmNo.update('保留进度', !s.busy);
        showCareerNode(this.confirm, isCareer && s.confirmAbandon);
        if (isCareer) this.refreshCareer(s);
        else {
            for (let i = 0; i < this.quickControls.length; i++) {
                this.quickControls[i].update(this.quickControls[i].label.string, !s.busy);
                const selected = i === (s.distance === 200 ? 0 : 1) || i === (s.rule === 'standard' ? 2 : 3);
                careerColor(this.quickSurfaces[i].sprite, selected ? CAREER_YELLOW : CAREER_WHITE);
            }
            this.quickStart.update(`开始比赛 · ${s.distance}米`, !s.busy);
        }
        careerText(this.rulesText, isCareer
            ? '• 顶部徽章可切换赛事；联赛与杯赛均为狂野模式。\n• 联赛前四名获得20 / 14 / 10 / 6积分，上限100分。\n• 本级满100分开放杯赛，夺冠晋级；最高级可重复挑战。\n• 前三级两轮，后三级三轮；三轮制决赛为400米。\n• 联赛进度账号共享；杯赛按角色保存，轮间可培养。\n• 回打旧联赛可获金币，不增加当前联赛积分。'
            : '• 选择200米或400米，再选择标准竞速或狂野模式。\n• 对手根据当前角色等级与生涯表现自动匹配。\n• 完赛获得金币，不增加联赛积分。');
        careerText(this.footer, s.status || (s.busy ? '正在保存并准备比赛…' : ''));
    }
    private refreshCareer(s: EventPageState): void {
        const m = careerPageModel(s.profile.career, s.characterId, s.tier, s.reviewCupTier); this.cupAction = m;
        for (let i = 0; i < this.tiers.length; i++) {
            const v = this.tiers[i], unlocked = i <= s.profile.career.league;
            v.control.update(LEAGUES[i].name, !s.busy); careerColor(v.control.label, i === m.tier ? CAREER_YELLOW : CAREER_WHITE);
            v.badge.set(unlocked ? ART.badges[i] : ART.lockedBadges[i]);
        }
        this.hero.set(m.unlocked ? ART.badges[m.tier] : ART.lockedBadges[m.tier]);
        if (this.heroTier !== m.tier) {
            this.heroTier = m.tier;
            // 按透明主体面积标定视觉体量，各级保持原比例与展台圆心；第一档按红线额外上移25像素。
            const heights = [196, 212, 228, 244, 260, 276];
            const scale = heights[m.tier] / 249;
            this.hero.node.setScale(scale, scale, 1);
            this.hero.node.setPosition(191.5 - 640, 360 - (m.tier === 0 ? 462 : 487) + heights[m.tier] / 2);
        }
        careerText(this.heroTitle, LEAGUES[m.tier].name);
        this.rulesButton.update('赛事规则', !s.busy); careerColor(this.rulesButton.label, CAREER_WHITE);
        const character = findPlayerCharacter(s.characterId);
        careerText(this.characterName, character?.name ?? '');
        this.layoutCharacterLevel();
        careerText(this.characterLevel, `LV.${s.profile.characters[s.characterId]?.level ?? 1}`);
        this.avatar.set(RESOURCE_PATHS.characterUi.portraits[s.characterId]);
        this.changeCharacter.update('更换', !s.busy && !!this.actions.characters);
        careerText(this.points, `${m.points}`); careerText(this.hint, m.hint);
        if (this.pointsValue !== m.points) {
            this.pointsValue = m.points;
            const width = Math.round(350 * m.points / 100);
            showCareerNode(this.progress.node, width > 0);
            this.progress.node.getComponent(UITransform)!.setContentSize(width, 16);
        }
        this.leagueStart.update(m.unlocked ? '开始联赛' : '尚未解锁', !s.busy && m.unlocked, !m.unlocked);
        careerText(this.cupTitle, m.title);
        const count = m.rounds.length;
        for (let i = 0; i < 3; i++) {
            const r = this.rounds[i], state = m.rounds[i]; showCareerNode(r.root, !!state); if (!state) continue;
            if (this.roundCount !== count) {
                const x = count === 2 ? [926.5, 1149.5][i] : 903 + i * 136;
                r.root.setPosition(x - 640, 360 - 481);
                const width = count === 2 ? 159 : 112;
                const padding = count === 2 ? 18 : 10;
                r.bg.node.getComponent(UITransform)!.setContentSize(width, 94);
                // 两轮与三轮共用紧凑左对齐信息；状态放在底框外下方。
                const rows = [28, 0, -25];
                [r.name, r.distance, r.condition].forEach((label, index) => {
                    label.node.getComponent(UITransform)!.setContentSize(width - padding * 2, 26);
                    label.node.setPosition(0, rows[index]);
                });
                r.distance.node.getComponent(UITransform)!.setContentSize(46, 26);
                r.distance.node.setPosition(-width / 2 + padding + 23, rows[1]);
                r.unit.node.getComponent(UITransform)!.setContentSize(24, 26);
                r.unit.node.setPosition(-width / 2 + padding + 46 + 12, rows[1]);
                r.status.horizontalAlign = Label.HorizontalAlign.CENTER;
                r.status.node.getComponent(UITransform)!.setContentSize(width, 22);
                r.status.node.setPosition(0, -63);
            }
            careerText(r.status, state.status); careerText(r.name, state.title);
            careerText(r.distance, `${state.distance}`); careerText(r.condition, state.condition);
            careerColor(r.bg.sprite, ROUND_COLORS[state.style]);
            careerColor(r.status, state.style === 'failed' ? RED : state.style === 'complete' ? GREEN : CAREER_MUTED);
            careerColor(r.distance, CAREER_MUTED); careerColor(r.condition, CAREER_MUTED);
        }
        if (this.roundCount !== count) {
            this.roundCount = count;
            this.roundArrows[0].node.setPosition((count === 2 ? 1037 : 971) - 640, 360 - 481);
            this.roundArrows[0].node.getComponent(UITransform)!.setContentSize(count === 2 ? 27 : 14, count === 2 ? 24 : 14);
            showCareerNode(this.roundArrows[1].node, count === 3);
        }
        this.cupStart.update(s.busy ? '正在准备…' : m.button, !s.busy && m.action !== 'locked', m.action === 'locked');
    }
    hide(): void { showCareerNode(this.rules, false); showCareerNode(this.confirm, false); }
    dispose(): void { this.hide(); this.root.active = false; if (this.root.isValid) this.root.destroy(); }
}
