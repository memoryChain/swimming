import { Button, Color, EventTouch, Graphics, Label, LabelOutline, Mask, Node, ScrollView, Sprite, SpriteFrame, Texture2D, UITransform } from 'cc';
import { RaceDifficulty, RACE_DIFFICULTY_OPTIONS, setRaceDifficulty } from '../core/GameBalance';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import {
    findPlayerCharacter,
    PlayerCharacterDefinition,
    getPlayerCharacterSelection,
    getSelectedRaceDifficulty,
    PLAYER_CHARACTER_DEFINITIONS,
    selectPlayerCharacter,
    weightToPhysicalRating,
    selectedPlayerColorScheme,
    setSelectedRaceDifficulty,
} from '../app/PlayerCharacterConfig';
import { PrepareRaceCharacterPreview } from '../app/PrepareRaceCharacterPreview';
import { openAppearancePanel } from './AppearancePanel';
import { openCharacterStatsPanel } from './CharacterStatsPanel';
import { getProgressionManager } from '../progression/ProgressionManager';
import { PROGRESSION_BALANCE } from '../progression/ProgressionBalance';
import { makeButton, makeLabel, makeRect, makeRoundedRect, makeUiNode, uiColor } from './RuntimeUiFactory';
import { HEADBAR_TOP_SAFE_AREA } from './ResourceHeadBar';
import { UI_STYLE } from './UIStyle';
import { PlayerData } from '../backend/PlayerData';
import type { PlayerProfile } from '../backend/PlayerProfile';
import { getUILayer, UILayer } from './UILayers';
import { showToast } from './Toast';

export type PrepareRaceFlowCallbacks = {
    onBack: () => void;
    onStartRace: () => void;
};

type PrepareRacePage = 'lobby' | 'character' | 'mode';

type RaceModeCardView = {
    id: RaceDifficulty;
    background: Graphics;
    title: Label;
    description: Label;
    selected: boolean;
};

type CharacterCardView = {
    character: PlayerCharacterDefinition;
    background: Graphics;
    name: Label;
    level: Label;
    lock: Node;
    selected: boolean;
};

const PANEL = UI_STYLE.panel;
const PANEL_ALT = UI_STYLE.panelAlt;
const CYAN = UI_STYLE.cyan;
const ACCENT = UI_STYLE.accent;
const MUTED = UI_STYLE.muted;
const WHITE = UI_STYLE.white;
const RACE_MODE_SELECTED_TEXT = uiColor(6, 35, 54);
const RACE_MODE_SELECTED_DESCRIPTION = uiColor(6, 35, 54, 220);
const RACE_MODE_DEFAULT_DESCRIPTION = uiColor(215, 238, 248);
const ROSTER_HEIGHT = 96;
const ROSTER_CARD_WIDTH = 150;
const ROSTER_CARD_HEIGHT = 68;
const ROSTER_CARD_PITCH = 162;
const CHARACTER_ROTATE_AREA_WIDTH = 420;
const CHARACTER_ROTATE_AREA_HEIGHT = 450;
const CHARACTER_ROTATE_AREA_Y = -5;
const PREPARE_RACE_MODEL_LIFT = 40;
const MODE_CARD_WIDTH = 280;
const MODE_CARD_HEIGHT = 170;
const MODE_CARD_PITCH = 310;

export class PrepareRaceFlow {
    private _root: Node | null = null;
    private _lobbyRoot: Node | null = null;
    private _characterRoot: Node | null = null;
    private _modeRoot: Node | null = null;
    private _previewUiRoot: Node | null = null;
    private _previewRoot: Node | null = null;
    private _preview: PrepareRaceCharacterPreview | null = null;
    private _backgroundSprite: Sprite | null = null;
    private _backgroundSpriteFrame: SpriteFrame | null = null;
    private _shadowSprite: Sprite | null = null;
    private _shadowSpriteFrame: SpriteFrame | null = null;
    private _page: PrepareRacePage = 'lobby';
    private _disposed = false;
    private _previewRotateTouchId: number | null = null;

    private _lobbyCharacterSummary: Label | null = null;
    private _lobbyModeTitle: Label | null = null;
    private _lobbyModeDescription: Label | null = null;

    private readonly _characterCards: CharacterCardView[] = [];
    private _characterDetailId = '';
    private _characterName: Label | null = null;
    private _characterDescription: Label | null = null;
    private _skillName: Label | null = null;
    private _skillDescription: Label | null = null;
    private _radarGraphics: Graphics | null = null;
    private readonly _radarLabels: Label[] = [];
    private _characterLevelSummary: Label | null = null;
    private _upgradeSingleNode: Node | null = null;
    private _upgradeSingleButton: Button | null = null;
    private _upgradeSingleCost: Label | null = null;
    private _upgradeMaxNode: Node | null = null;
    private _upgradeMaxButton: Button | null = null;
    private _maxLevelMessage: Node | null = null;
    private _appearanceDotGraphics: Graphics | null = null;
    private _appearanceColorKey = '';
    private _upgradePending = false;

    private readonly _raceModeCards: RaceModeCardView[] = [];

    private _onProfileChange: (profile: PlayerProfile) => void = () => {
        if (!this._root?.isValid || !this._root.active) return;
        if (this._page === 'lobby') {
            this.syncLobby();
        } else if (this._page === 'character') {
            this.syncCharacterPage();
        }
    };

    constructor(
        private readonly _parent: Node,
        private readonly _canvasNode: Node,
        private readonly _width: number,
        private readonly _height: number,
        private readonly _callbacks: PrepareRaceFlowCallbacks,
    ) {}

    showLobby() {
        this.ensureRoot();
        this.ensureLobbyPage();
        this.ensurePreviewPresentation();
        this.setPage('lobby');
        this.syncLobby();
        this.syncPreview();
    }

    handleBack() {
        if (this._page === 'lobby') {
            this._callbacks.onBack();
            return;
        }
        this.showLobby();
    }

    dispose() {
        this._disposed = true;
        PlayerData.offChange(this._onProfileChange);
        if (this._backgroundSprite?.isValid) {
            this._backgroundSprite.spriteFrame = null;
        }
        this._backgroundSpriteFrame?.destroy();
        this._backgroundSpriteFrame = null;
        if (this._shadowSprite?.isValid) {
            this._shadowSprite.spriteFrame = null;
        }
        this._shadowSpriteFrame?.destroy();
        this._shadowSpriteFrame = null;
        this._previewRoot?.destroy();
        this._previewRoot = null;
        this._preview = null;
        this._root?.destroy();
        this._root = null;
        this._lobbyRoot = null;
        this._characterRoot = null;
        this._modeRoot = null;
        this._previewUiRoot = null;
        this._backgroundSprite = null;
        this._shadowSprite = null;
        this._characterCards.length = 0;
        this._raceModeCards.length = 0;
        this._radarLabels.length = 0;
    }

    private ensureRoot() {
        if (this._root) return;
        const root = makeUiNode('PrepareRaceUI', this._parent);
        root.getComponent(UITransform)!.setContentSize(this._width, this._height);
        this._root = root;
        PlayerData.onChange(this._onProfileChange);
        this.buildBackground(root);
    }

    private buildBackground(root: Node) {
        const fallback = makeRect('PrepareRaceBackdrop', root, this._width, this._height, uiColor(4, 20, 42, 255));
        const image = makeUiNode('PrepareRaceBackgroundImage', root);
        image.getComponent(UITransform)!.setContentSize(this._width, this._height);
        image.setPosition(0, 0, 1);
        loadRaceAsset(RESOURCE_PATHS.prepareRaceBackground, Texture2D, (error, texture) => {
            if (this._disposed || error || !texture || !image.isValid) {
                if (this._disposed) return;
                console.warn('[SpeedSwimming] prepare-race background texture failed to load', error);
                return;
            }
            const spriteFrame = new SpriteFrame();
            spriteFrame.texture = texture;
            this._backgroundSpriteFrame = spriteFrame;
            const sprite = image.addComponent(Sprite);
            sprite.spriteFrame = spriteFrame;
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            this._backgroundSprite = sprite;
            if (fallback.isValid) fallback.destroy();
        });
    }

    private makePageRoot(name: string): Node {
        const page = makeUiNode(name, this._root!);
        page.getComponent(UITransform)!.setContentSize(this._width, this._height);
        // Cocos 3.8.8 must create the render entity before a descendant Mask is
        // configured. Building a page under an inactive ancestor leaves Mask's
        // stencil stage null in Web Preview. setPage() applies the final active
        // state immediately after the one-time page build, before the next frame.
        return page;
    }

    private setPage(page: PrepareRacePage) {
        this._page = page;
        this.setNodeActive(this._lobbyRoot, page === 'lobby');
        this.setNodeActive(this._characterRoot, page === 'character');
        this.setNodeActive(this._modeRoot, page === 'mode');
        const previewVisible = page !== 'mode';
        this.setNodeActive(this._previewUiRoot, previewVisible);
        this.setNodeActive(this._previewRoot, previewVisible);
    }

    private ensureLobbyPage() {
        if (this._lobbyRoot) return;
        const page = this.makePageRoot('PrepareRaceLobby');
        this._lobbyRoot = page;
        makeScreenTitle(page, '比赛大厅', this._height / 2 - 56);

        const character = makeRoundedRect('OpenCharacterCenter', page, 240, 76, PANEL, 14, UI_STYLE.cyanOutline, 1.5);
        character.setPosition(-425, -this._height / 2 + 66, 3);
        const characterButton = character.addComponent(Button);
        characterButton.target = character;
        characterButton.transition = Button.Transition.NONE;
        makeLabel('Title', character, '角色', 19, CYAN).setPosition(0, 17, 1);
        const characterSummaryNode = makeLabel('Summary', character, '', 18, WHITE);
        characterSummaryNode.getComponent(UITransform)!.setContentSize(220, 28);
        characterSummaryNode.setPosition(0, -16, 1);
        this._lobbyCharacterSummary = characterSummaryNode.getComponent(Label)!;
        character.on(Button.EventType.CLICK, () => this.showCharacterCenter());

        const mode = makeRoundedRect('OpenRaceMode', page, 360, 76, PANEL, 14, UI_STYLE.cyanOutline, 1.5);
        mode.setPosition(0, -this._height / 2 + 66, 3);
        const modeButton = mode.addComponent(Button);
        modeButton.target = mode;
        modeButton.transition = Button.Transition.NONE;
        const modeTitleNode = makeLabel('Title', mode, '', 20, WHITE);
        modeTitleNode.getComponent(UITransform)!.setContentSize(330, 28);
        modeTitleNode.setPosition(0, 17, 1);
        this._lobbyModeTitle = modeTitleNode.getComponent(Label)!;
        const modeDescriptionNode = makeLabel('Description', mode, '', 14, RACE_MODE_DEFAULT_DESCRIPTION);
        modeDescriptionNode.getComponent(UITransform)!.setContentSize(330, 24);
        modeDescriptionNode.getComponent(Label)!.overflow = Label.Overflow.SHRINK;
        modeDescriptionNode.setPosition(0, -16, 1);
        this._lobbyModeDescription = modeDescriptionNode.getComponent(Label)!;
        mode.on(Button.EventType.CLICK, () => this.showModeSelect());

        const start = makeButton('StartRaceButton', page, 260, 96, CYAN, '开始比赛');
        start.setPosition(425, -this._height / 2 + 66, 3);
        const startLabel = start.getChildByName('Label')?.getComponent(Label);
        if (startLabel) {
            startLabel.fontSize = 28;
            startLabel.color = RACE_MODE_SELECTED_TEXT;
        }
        start.on(Button.EventType.CLICK, () => {
            setRaceDifficulty(getSelectedRaceDifficulty());
            this._callbacks.onStartRace();
        });
    }

    private syncLobby() {
        const character = findPlayerCharacter();
        if (character) {
            const level = getProgressionManager().getCharacterLevel(character.id);
            this.setLabel(this._lobbyCharacterSummary, `${character.name}  Lv.${level}`);
        }
        const difficulty = getSelectedRaceDifficulty();
        const option = RACE_DIFFICULTY_OPTIONS.find((entry) => entry.id === difficulty);
        this.setLabel(this._lobbyModeTitle, `比赛模式 · ${option?.label ?? '竞技'}`);
        this.setLabel(this._lobbyModeDescription, raceDifficultyDescription(difficulty));
    }

    private showCharacterCenter() {
        this.ensureRoot();
        this.ensureCharacterPage();
        this.ensurePreviewPresentation();
        this.setPage('character');
        this.syncCharacterPage();
        this.syncPreview();
    }

    private ensureCharacterPage() {
        if (this._characterRoot) return;
        const page = this.makePageRoot('PrepareRaceCharacterCenter');
        this._characterRoot = page;
        makeScreenTitle(page, '角色中心', this._height / 2 - 56);
        this.buildRoster(page);
        this.buildCharacterDetail(page);
        this.buildCharacterActions(page);
    }

    private buildRoster(parent: Node) {
        const stripWidth = this._width - 48;
        const stripY = -this._height / 2 + ROSTER_HEIGHT / 2 + 12;
        const panel = makeRect('CharacterRosterPanel', parent, stripWidth, ROSTER_HEIGHT, PANEL);
        panel.setPosition(0, stripY, 2);

        const viewportWidth = stripWidth - 24;
        const viewportHeight = ROSTER_CARD_HEIGHT + 12;
        const viewNode = makeUiNode('RosterScrollView', panel);
        viewNode.getComponent(UITransform)!.setContentSize(viewportWidth, viewportHeight);
        const scrollView = viewNode.addComponent(ScrollView);
        scrollView.horizontal = true;
        scrollView.vertical = false;
        scrollView.inertia = true;
        scrollView.elastic = false;
        scrollView.brake = 0.5;
        scrollView.cancelInnerEvents = true;
        const mask = viewNode.addComponent(Mask);
        mask.type = Mask.Type.GRAPHICS_RECT;
        mask.inverted = false;

        const content = makeUiNode('RosterContent', viewNode);
        const contentWidth = Math.max(viewportWidth, PLAYER_CHARACTER_DEFINITIONS.length * ROSTER_CARD_PITCH + 8);
        content.getComponent(UITransform)!.setContentSize(contentWidth, viewportHeight);
        scrollView.content = content;

        const selectedId = getPlayerCharacterSelection().characterId;
        const progression = getProgressionManager();
        PLAYER_CHARACTER_DEFINITIONS.forEach((character, index) => {
            const unlocked = !!character.unlocked;
            const selected = character.id === selectedId;
            const fill = selected ? CYAN : unlocked ? PANEL_ALT : MUTED;
            const card = makeButton(`CharacterSlot${index}`, content, ROSTER_CARD_WIDTH, ROSTER_CARD_HEIGHT, fill, '');
            card.setPosition((index - (PLAYER_CHARACTER_DEFINITIONS.length - 1) / 2) * ROSTER_CARD_PITCH, 0, 1);
            const nameNode = makeLabel('Name', card, character.name, 20, selected ? RACE_MODE_SELECTED_TEXT : WHITE);
            nameNode.getComponent(UITransform)!.setContentSize(ROSTER_CARD_WIDTH - 12, 28);
            nameNode.setPosition(0, 11, 1);
            const levelNode = makeLabel('Level', card, unlocked ? `Lv.${progression.getCharacterLevel(character.id)}` : '', 15, selected ? RACE_MODE_SELECTED_DESCRIPTION : ACCENT);
            levelNode.getComponent(UITransform)!.setContentSize(ROSTER_CARD_WIDTH - 12, 22);
            levelNode.setPosition(0, -14, 1);
            const lock = makeLabel('Lock', card, '🔒', 24, WHITE);
            lock.setPosition(0, 0, 2);
            lock.active = !unlocked;
            nameNode.active = unlocked;
            levelNode.active = unlocked;
            const button = card.getComponent(Button)!;
            button.interactable = unlocked;
            if (unlocked) {
                card.on(Button.EventType.CLICK, () => this.chooseCharacter(character.id));
            }
            this._characterCards.push({
                character,
                background: card.getComponent(Graphics)!,
                name: nameNode.getComponent(Label)!,
                level: levelNode.getComponent(Label)!,
                lock,
                selected,
            });
        });
    }

    private chooseCharacter(id: PlayerCharacterDefinition['id']) {
        if (getPlayerCharacterSelection().characterId === id) return;
        selectPlayerCharacter(id);
        this._characterDetailId = '';
        this._appearanceColorKey = '';
        this.syncCharacterPage();
        this.syncPreview();
    }

    private buildCharacterDetail(parent: Node) {
        const panelWidth = 330;
        const panelHeight = this._height - 220;
        const panel = makeRect('CharacterDetailPanel', parent, panelWidth, panelHeight, PANEL);
        const detailTopY = this._height / 2 - HEADBAR_TOP_SAFE_AREA;
        panel.setPosition(-(this._width / 2 - panelWidth / 2 - 32), detailTopY - panelHeight / 2, 2);

        const name = makeLabel('CharacterName', panel, '', 28, WHITE);
        name.getComponent(UITransform)!.setContentSize(306, 38);
        name.setPosition(0, panelHeight / 2 - 42, 1);
        this._characterName = name.getComponent(Label)!;

        const description = makeLabel('Description', panel, '', 14, uiColor(214, 232, 246));
        description.getComponent(UITransform)!.setContentSize(290, 40);
        description.getComponent(Label)!.horizontalAlign = Label.HorizontalAlign.CENTER;
        description.getComponent(Label)!.overflow = Label.Overflow.SHRINK;
        description.setPosition(0, panelHeight / 2 - 82, 1);
        this._characterDescription = description.getComponent(Label)!;

        this.buildRadarChart(panel, 22);
        makeLabel('SkillHeading', panel, '技能', 22, CYAN).setPosition(-128, -112, 1);
        const skill = makeRect('SkillCard', panel, 278, 72, PANEL_ALT);
        skill.setPosition(0, -168, 1);
        const skillName = makeLabel('SkillName', skill, '', 19, WHITE);
        skillName.getComponent(UITransform)!.setContentSize(246, 26);
        skillName.setPosition(0, 14, 1);
        this._skillName = skillName.getComponent(Label)!;
        const skillDescription = makeLabel('SkillDescription', skill, '', 14, uiColor(214, 234, 246));
        skillDescription.getComponent(UITransform)!.setContentSize(246, 30);
        skillDescription.getComponent(Label)!.overflow = Label.Overflow.SHRINK;
        skillDescription.setPosition(0, -17, 1);
        this._skillDescription = skillDescription.getComponent(Label)!;

        const statsButton = makeRoundedRect('StatsButton', panel, 200, 44, PANEL, 12, UI_STYLE.cyanOutline, 1.5);
        statsButton.setPosition(0, -226, 2);
        const statsHit = statsButton.addComponent(Button);
        statsHit.target = statsButton;
        statsHit.transition = Button.Transition.NONE;
        makeLabel('Label', statsButton, '详细属性', 20, WHITE).setPosition(0, 0, 1);
        statsButton.on(Button.EventType.CLICK, () => openCharacterStatsPanel(this._canvasNode, this._width, this._height));
    }

    private buildCharacterActions(parent: Node) {
        const panelWidth = 300;
        const panelHeight = 360;
        const panel = makeRoundedRect('CharacterActionPanel', parent, panelWidth, panelHeight, PANEL, 16, UI_STYLE.cyanOutline, 1.5);
        panel.setPosition(this._width / 2 - panelWidth / 2 - 32, 12, 2);
        makeLabel('Heading', panel, '角色培养', 26, CYAN).setPosition(0, panelHeight / 2 - 38, 1);
        const levelSummary = makeLabel('LevelSummary', panel, '', 22, WHITE);
        levelSummary.getComponent(UITransform)!.setContentSize(260, 34);
        levelSummary.setPosition(0, 104, 1);
        this._characterLevelSummary = levelSummary.getComponent(Label)!;

        const single = makeRoundedRect('UpgradeSingle', panel, 220, 58, PANEL_ALT, 10, UI_STYLE.cyanOutline, 1.5);
        single.setPosition(0, 38, 2);
        const singleButton = single.addComponent(Button);
        singleButton.target = single;
        singleButton.transition = Button.Transition.NONE;
        makeLabel('SingleLabel', single, '升级', 21, WHITE).setPosition(-42, 0, 1);
        const singleCost = makeLabel('SingleCost', single, '', 20, WHITE);
        singleCost.getComponent(UITransform)!.setContentSize(92, 30);
        singleCost.setPosition(48, 0, 1);
        single.on(Button.EventType.CLICK, () => void this.upgradeSelectedCharacter());
        this._upgradeSingleNode = single;
        this._upgradeSingleButton = singleButton;
        this._upgradeSingleCost = singleCost.getComponent(Label)!;

        const max = makeRoundedRect('UpgradeMax', panel, 220, 58, PANEL_ALT, 10, UI_STYLE.cyanOutline, 1.5);
        max.setPosition(0, -34, 2);
        const maxButton = max.addComponent(Button);
        maxButton.target = max;
        maxButton.transition = Button.Transition.NONE;
        makeLabel('Label', max, '一键升满', 21, WHITE).setPosition(0, 0, 1);
        max.on(Button.EventType.CLICK, () => {
            if (this._upgradePending) return;
            const character = findPlayerCharacter();
            if (character) this.confirmSpendToMax(character);
        });
        this._upgradeMaxNode = max;
        this._upgradeMaxButton = maxButton;

        const maxLevel = makeLabel('MaxLevelMessage', panel, '已达到满级', 22, ACCENT);
        maxLevel.setPosition(0, 0, 1);
        maxLevel.active = false;
        this._maxLevelMessage = maxLevel;

        const appearance = makeRoundedRect('AppearanceButton', panel, 220, 58, PANEL, 10, UI_STYLE.cyanOutline, 1.5);
        appearance.setPosition(0, -120, 2);
        const appearanceButton = appearance.addComponent(Button);
        appearanceButton.target = appearance;
        appearanceButton.transition = Button.Transition.NONE;
        const dot = makeUiNode('ColorDot', appearance);
        dot.getComponent(UITransform)!.setContentSize(28, 28);
        dot.setPosition(-62, 0, 1);
        this._appearanceDotGraphics = dot.addComponent(Graphics);
        makeLabel('Label', appearance, '外观', 21, WHITE).setPosition(18, 0, 1);
        appearance.on(Button.EventType.CLICK, () => this.openAppearance());
    }

    private syncCharacterPage() {
        const character = findPlayerCharacter();
        if (!character) return;
        const progression = getProgressionManager();
        const level = progression.getCharacterLevel(character.id);
        const atMax = level >= PROGRESSION_BALANCE.maxLevel;
        this.setLabel(this._characterName, `${character.name}  Lv.${level}${atMax ? '（满级）' : ''}`);

        if (this._characterDetailId !== character.id) {
            this._characterDetailId = character.id;
            this.setLabel(this._characterDescription, character.description);
            this.setLabel(this._skillName, character.skillName);
            this.setLabel(this._skillDescription, character.skillDescription);
            this.renderRadarChart(character);
        }

        const selectedId = character.id;
        for (const card of this._characterCards) {
            if (card.character.unlocked) {
                this.setLabel(card.level, `Lv.${progression.getCharacterLevel(card.character.id)}`);
            }
            this.setCharacterCardSelected(card, card.character.id === selectedId);
        }
        this.syncUpgradeControls(character, level);
        this.refreshAppearanceControls();
    }

    private setCharacterCardSelected(card: CharacterCardView, selected: boolean) {
        if (card.selected === selected || !card.background?.isValid) return;
        card.selected = selected;
        card.background.clear();
        card.background.fillColor = selected ? CYAN : card.character.unlocked ? PANEL_ALT : MUTED;
        card.background.rect(-ROSTER_CARD_WIDTH / 2, -ROSTER_CARD_HEIGHT / 2, ROSTER_CARD_WIDTH, ROSTER_CARD_HEIGHT);
        card.background.fill();
        this.setLabelColor(card.name, selected ? RACE_MODE_SELECTED_TEXT : WHITE);
        this.setLabelColor(card.level, selected ? RACE_MODE_SELECTED_DESCRIPTION : ACCENT);
    }

    private syncUpgradeControls(character: PlayerCharacterDefinition, level: number) {
        const progression = getProgressionManager();
        const atMax = level >= PROGRESSION_BALANCE.maxLevel;
        this.setLabel(this._characterLevelSummary, atMax ? `Lv.${level} · 已满级` : `当前等级  Lv.${level}`);
        this.setNodeActive(this._upgradeSingleNode, !atMax);
        this.setNodeActive(this._upgradeMaxNode, !atMax);
        this.setNodeActive(this._maxLevelMessage, atMax);
        if (atMax) return;

        const cost = progression.coinCostForNextLevel(character.id);
        const affordable = PlayerData.coins >= cost;
        this.setLabel(this._upgradeSingleCost, `${cost} 金币`);
        this.setLabelColor(this._upgradeSingleCost, affordable ? WHITE : uiColor(255, 80, 80, 255));
        this.setButtonInteractable(this._upgradeSingleButton, !this._upgradePending);
        this.setButtonInteractable(this._upgradeMaxButton, !this._upgradePending);
    }

    private async upgradeSelectedCharacter() {
        if (this._upgradePending) return;
        const character = findPlayerCharacter();
        if (!character) return;
        const progression = getProgressionManager();
        const need = progression.coinCostForNextLevel(character.id);
        if (PlayerData.coins < need) {
            this.toast('金币不足');
            return;
        }
        this._upgradePending = true;
        this.syncUpgradeControls(character, progression.getCharacterLevel(character.id));
        try {
            const result = await progression.spendForLevel(character.id);
            if (result.levelsGained > 0) {
                this.toast(`升级成功 · Lv.${progression.getCharacterLevel(character.id)}`);
            } else {
                this.toast('金币不足');
            }
        } catch (error) {
            console.warn('[SpeedSwimming] character level-up failed', error);
            this.toast('升级失败，请稍后重试');
        } finally {
            this._upgradePending = false;
            if (!this._disposed && this._page === 'character' && this._root?.isValid) this.syncCharacterPage();
        }
    }

    private confirmSpendToMax(character: PlayerCharacterDefinition) {
        const progression = getProgressionManager();
        const projection = progression.projectSpendToMax(character.id);
        if (projection.levels <= 0) {
            this.toast('金币不足');
            return;
        }
        const popup = getUILayer(this._canvasNode, UILayer.Popup);
        popup.getChildByName('UpgradeConfirm')?.destroy();
        const root = makeUiNode('UpgradeConfirm', popup);
        const dim = makeRect('Dim', root, this._width, this._height, uiColor(2, 8, 14, 200));
        dim.on(Node.EventType.TOUCH_END, () => root.destroy());
        const panelW = 460;
        const panelH = 220;
        const panel = makeRoundedRect('Panel', root, panelW, panelH, uiColor(14, 36, 58, 252), 16, uiColor(86, 196, 236, 110), 2);
        makeLabel('Title', panel, '一键升满', 28, WHITE).setPosition(0, panelH / 2 - 36, 1);
        makeLabel('Body', panel, `将花费 ${projection.coins} 金币，升级 ${projection.levels} 级`, 20, uiColor(214, 232, 246))
            .setPosition(0, 6, 1);
        const cancel = makeButton('Cancel', panel, 160, 52, uiColor(61, 81, 99, 255), '取消');
        cancel.setPosition(-90, -panelH / 2 + 40, 1);
        cancel.on(Button.EventType.CLICK, () => root.destroy());
        const confirm = makeButton('Confirm', panel, 160, 52, CYAN, '确认');
        confirm.setPosition(90, -panelH / 2 + 40, 1);
        confirm.on(Button.EventType.CLICK, () => {
            root.destroy();
            void this.spendToMax(character);
        });
    }

    private async spendToMax(character: PlayerCharacterDefinition) {
        if (this._upgradePending) return;
        this._upgradePending = true;
        const progression = getProgressionManager();
        this.syncUpgradeControls(character, progression.getCharacterLevel(character.id));
        try {
            const result = await progression.spendToMax(character.id);
            if (result.levelsGained > 0) {
                this.toast(`升级到 Lv.${progression.getCharacterLevel(character.id)}（+${result.levelsGained}级）`);
            } else {
                this.toast('金币不足');
            }
        } catch (error) {
            console.warn('[SpeedSwimming] character spend-to-max failed', error);
            this.toast('升级失败，请稍后重试');
        } finally {
            this._upgradePending = false;
            if (!this._disposed && this._page === 'character' && this._root?.isValid) this.syncCharacterPage();
        }
    }

    private buildRadarChart(panel: Node, centerY: number) {
        const radius = 96;
        const labels = ['体力', '爆发', '踢腿', '对抗', '蓄气', '技巧'];
        const gfxNode = makeUiNode('RadarChart', panel);
        gfxNode.getComponent(UITransform)!.setContentSize(300, 260);
        gfxNode.setPosition(0, centerY, 1);
        this._radarGraphics = gfxNode.addComponent(Graphics);
        labels.forEach((text, index) => {
            const angle = Math.PI / 2 - (index * Math.PI * 2) / labels.length;
            const label = makeLabel(`RadarLabel${index}`, panel, text, 14, uiColor(220, 238, 250));
            label.getComponent(UITransform)!.setContentSize(96, 22);
            label.setPosition((radius + 18) * Math.cos(angle), centerY + (radius + 18) * Math.sin(angle), 2);
            this._radarLabels.push(label.getComponent(Label)!);
        });
    }

    private renderRadarChart(character: PlayerCharacterDefinition) {
        const gfx = this._radarGraphics;
        if (!gfx?.isValid) return;
        const axes = [
            { label: '体力', value: character.stamina },
            { label: '爆发', value: character.burst },
            { label: '踢腿', value: character.kick },
            { label: '对抗', value: weightToPhysicalRating(character.weight) },
            { label: '蓄气', value: character.energyGain },
            { label: '技巧', value: character.technique },
        ];
        const radius = 96;
        const count = axes.length;
        const vertex = (index: number, scale: number) => {
            const angle = Math.PI / 2 - (index * Math.PI * 2) / count;
            return { x: radius * scale * Math.cos(angle), y: radius * scale * Math.sin(angle) };
        };
        const trace = (scale: number) => {
            for (let index = 0; index <= count; index++) {
                const point = vertex(index % count, scale);
                if (index === 0) gfx.moveTo(point.x, point.y);
                else gfx.lineTo(point.x, point.y);
            }
        };

        gfx.clear();
        gfx.fillColor = uiColor(70, 150, 200, 18);
        trace(1);
        gfx.fill();
        const rings = [0.2, 0.4, 0.6, 0.8, 1];
        rings.forEach((scale, index) => {
            const outer = index === rings.length - 1;
            gfx.strokeColor = outer ? uiColor(120, 200, 240, 150) : uiColor(80, 150, 200, 48);
            gfx.lineWidth = outer ? 1.8 : 1;
            trace(scale);
            gfx.stroke();
        });
        gfx.strokeColor = uiColor(110, 180, 220, 95);
        gfx.lineWidth = 1.4;
        for (let index = 0; index < count; index++) {
            const point = vertex(index, 1);
            gfx.moveTo(0, 0);
            gfx.lineTo(point.x, point.y);
        }
        gfx.stroke();
        gfx.fillColor = uiColor(80, 215, 255, 78);
        gfx.strokeColor = uiColor(150, 238, 255, 255);
        gfx.lineWidth = 3;
        for (let index = 0; index <= count; index++) {
            const axisIndex = index % count;
            const point = vertex(axisIndex, Math.max(0, Math.min(100, axes[axisIndex].value)) / 100);
            if (index === 0) gfx.moveTo(point.x, point.y);
            else gfx.lineTo(point.x, point.y);
        }
        gfx.fill();
        gfx.stroke();
        axes.forEach((axis, index) => {
            const point = vertex(index, Math.max(0, Math.min(100, axis.value)) / 100);
            gfx.fillColor = uiColor(10, 40, 70, 255);
            gfx.circle(point.x, point.y, 4.8);
            gfx.fill();
            gfx.fillColor = uiColor(180, 244, 255, 255);
            gfx.circle(point.x, point.y, 3);
            gfx.fill();
            this.setLabel(this._radarLabels[index], `${axis.label} ${axis.value}`);
        });
    }

    private openAppearance() {
        openAppearancePanel(this._canvasNode, this._width, this._height, {
            onChange: () => {
                this._preview?.applyAppearance();
                this.refreshAppearanceControls();
            },
        });
    }

    private refreshAppearanceControls() {
        const palette = selectedPlayerColorScheme();
        const colorKey = `${palette.suit[0]},${palette.suit[1]},${palette.suit[2]}`;
        if (this._appearanceColorKey === colorKey) return;
        this._appearanceColorKey = colorKey;
        const gfx = this._appearanceDotGraphics;
        if (!gfx?.isValid) return;
        gfx.clear();
        gfx.fillColor = uiColor(palette.suit[0], palette.suit[1], palette.suit[2], 255);
        gfx.roundRect(-14, -14, 28, 28, 6);
        gfx.fill();
    }

    private showModeSelect() {
        this.ensureRoot();
        this.ensureModePage();
        this.setPage('mode');
        this.syncModeCards();
    }

    private ensureModePage() {
        if (this._modeRoot) return;
        const page = this.makePageRoot('PrepareRaceModeSelect');
        this._modeRoot = page;
        makeScreenTitle(page, '比赛模式', this._height / 2 - 56);
        makeLabel('Hint', page, '选择比赛强度，之后可随时回来切换', 20, uiColor(210, 234, 246))
            .setPosition(0, this._height / 2 - 112, 2);

        const viewWidth = this._width - 160;
        const viewHeight = 230;
        const viewNode = makeUiNode('RaceModeScrollView', page);
        viewNode.getComponent(UITransform)!.setContentSize(viewWidth, viewHeight);
        viewNode.setPosition(0, 10, 2);
        const scrollView = viewNode.addComponent(ScrollView);
        scrollView.horizontal = true;
        scrollView.vertical = false;
        scrollView.inertia = true;
        scrollView.elastic = false;
        scrollView.brake = 0.5;
        scrollView.cancelInnerEvents = true;
        const mask = viewNode.addComponent(Mask);
        mask.type = Mask.Type.GRAPHICS_RECT;
        mask.inverted = false;
        const content = makeUiNode('RaceModeContent', viewNode);
        const contentWidth = Math.max(viewWidth, RACE_DIFFICULTY_OPTIONS.length * MODE_CARD_PITCH);
        content.getComponent(UITransform)!.setContentSize(contentWidth, viewHeight);
        scrollView.content = content;

        const selected = getSelectedRaceDifficulty();
        RACE_DIFFICULTY_OPTIONS.forEach((option, index) => {
            const isSelected = option.id === selected;
            const card = makeRoundedRect(`RaceMode${option.id}`, content, MODE_CARD_WIDTH, MODE_CARD_HEIGHT, isSelected ? CYAN : PANEL, 16, UI_STYLE.cyanOutline, 1.5);
            card.setPosition((index - (RACE_DIFFICULTY_OPTIONS.length - 1) / 2) * MODE_CARD_PITCH, 0, 1);
            const button = card.addComponent(Button);
            button.target = card;
            button.transition = Button.Transition.NONE;
            const titleNode = makeLabel('Title', card, option.label, 28, isSelected ? RACE_MODE_SELECTED_TEXT : WHITE);
            titleNode.getComponent(UITransform)!.setContentSize(MODE_CARD_WIDTH - 30, 38);
            titleNode.setPosition(0, 38, 1);
            const descriptionNode = makeLabel('Description', card, raceDifficultyDescription(option.id), 16, isSelected ? RACE_MODE_SELECTED_DESCRIPTION : RACE_MODE_DEFAULT_DESCRIPTION);
            descriptionNode.getComponent(UITransform)!.setContentSize(MODE_CARD_WIDTH - 36, 62);
            descriptionNode.getComponent(Label)!.overflow = Label.Overflow.SHRINK;
            descriptionNode.setPosition(0, -18, 1);
            this._raceModeCards.push({
                id: option.id,
                background: card.getComponent(Graphics)!,
                title: titleNode.getComponent(Label)!,
                description: descriptionNode.getComponent(Label)!,
                selected: isSelected,
            });
            card.on(Button.EventType.CLICK, () => this.selectRaceDifficulty(option.id));
        });
    }

    private selectRaceDifficulty(difficulty: RaceDifficulty) {
        if (getSelectedRaceDifficulty() === difficulty) return;
        setSelectedRaceDifficulty(difficulty);
        this.showLobby();
    }

    private syncModeCards() {
        const selected = getSelectedRaceDifficulty();
        for (const card of this._raceModeCards) {
            this.setRaceModeCardSelected(card, card.id === selected);
        }
    }

    private setRaceModeCardSelected(card: RaceModeCardView, selected: boolean) {
        if (card.selected === selected || !card.background?.isValid) return;
        card.selected = selected;
        card.background.clear();
        card.background.fillColor = selected ? CYAN : PANEL;
        card.background.roundRect(-MODE_CARD_WIDTH / 2, -MODE_CARD_HEIGHT / 2, MODE_CARD_WIDTH, MODE_CARD_HEIGHT, 16);
        card.background.fill();
        card.background.strokeColor = UI_STYLE.cyanOutline;
        card.background.lineWidth = 1.5;
        card.background.roundRect(-MODE_CARD_WIDTH / 2 + 0.75, -MODE_CARD_HEIGHT / 2 + 0.75, MODE_CARD_WIDTH - 1.5, MODE_CARD_HEIGHT - 1.5, 15);
        card.background.stroke();
        this.setLabelColor(card.title, selected ? RACE_MODE_SELECTED_TEXT : WHITE);
        this.setLabelColor(card.description, selected ? RACE_MODE_SELECTED_DESCRIPTION : RACE_MODE_DEFAULT_DESCRIPTION);
    }

    private ensurePreviewPresentation() {
        if (this._previewUiRoot) return;
        const root = makeUiNode('PrepareRacePreviewPresentation', this._root!);
        root.getComponent(UITransform)!.setContentSize(this._width, this._height);
        this._previewUiRoot = root;

        const contact = makeUiNode('CharacterContactShadow', root);
        contact.getComponent(UITransform)!.setContentSize(170, 40);
        contact.setPosition(0, -248 + PREPARE_RACE_MODEL_LIFT, 1);
        const contactGraphics = contact.addComponent(Graphics);
        contactGraphics.fillColor = uiColor(4, 13, 26, 78);
        contactGraphics.ellipse(0, 0, 82, 17);
        contactGraphics.fill();
        contactGraphics.fillColor = uiColor(2, 8, 16, 104);
        contactGraphics.ellipse(0, 0, 54, 10);
        contactGraphics.fill();

        const shadow = makeUiNode('CharacterRealtimeShadow', root);
        shadow.getComponent(UITransform)!.setContentSize(166, 46);
        shadow.setPosition(0, -248 + PREPARE_RACE_MODEL_LIFT, 2);
        const sprite = shadow.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this._shadowSprite = sprite;

        const rotateArea = makeUiNode('CharacterRotateArea', root);
        rotateArea.getComponent(UITransform)!.setContentSize(CHARACTER_ROTATE_AREA_WIDTH, CHARACTER_ROTATE_AREA_HEIGHT);
        rotateArea.setPosition(0, CHARACTER_ROTATE_AREA_Y, 3);
        rotateArea.on(Node.EventType.TOUCH_START, (event: EventTouch) => this.beginPreviewRotation(event));
        rotateArea.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => this.updatePreviewRotation(event));
        rotateArea.on(Node.EventType.TOUCH_END, (event: EventTouch) => this.endPreviewRotation(event));
        rotateArea.on(Node.EventType.TOUCH_CANCEL, (event: EventTouch) => this.endPreviewRotation(event));
    }

    private syncPreview() {
        this.ensurePreview();
        this._preview?.refresh();
        this.setNodeActive(this._previewRoot, this._page !== 'mode');
        const shadowTexture = this._preview?.shadowTexture;
        if (!this._shadowSpriteFrame && this._shadowSprite?.isValid && shadowTexture) {
            const spriteFrame = new SpriteFrame();
            spriteFrame.texture = shadowTexture;
            this._shadowSprite.spriteFrame = spriteFrame;
            this._shadowSpriteFrame = spriteFrame;
        }
    }

    private ensurePreview() {
        if (this._previewRoot) return;
        const root = new Node('PrepareRacePreviewWorld');
        root.setParent(this._parent.scene!);
        this._previewRoot = root;
        this._preview = root.addComponent(PrepareRaceCharacterPreview);
    }

    private beginPreviewRotation(event: EventTouch) {
        if (this._previewRotateTouchId !== null) return;
        this._previewRotateTouchId = event.getID();
    }

    private updatePreviewRotation(event: EventTouch) {
        if (event.getID() !== this._previewRotateTouchId) return;
        const deltaX = event.getDeltaX();
        if (Number.isFinite(deltaX) && Math.abs(deltaX) > 0.01) {
            this._preview?.rotateBy(deltaX * 0.55);
        }
    }

    private endPreviewRotation(event: EventTouch) {
        if (event.getID() === this._previewRotateTouchId) {
            this._previewRotateTouchId = null;
        }
    }

    private setLabel(label: Label | null, value: string) {
        if (label?.isValid && label.string !== value) label.string = value;
    }

    private setLabelColor(label: Label | null, value: Color) {
        if (!label?.isValid) return;
        const current = label.color;
        if (current.r !== value.r || current.g !== value.g || current.b !== value.b || current.a !== value.a) {
            label.color = value;
        }
    }

    private setNodeActive(node: Node | null, active: boolean) {
        if (node?.isValid && node.active !== active) node.active = active;
    }

    private setButtonInteractable(button: Button | null, interactable: boolean) {
        if (button?.isValid && button.interactable !== interactable) button.interactable = interactable;
    }

    private toast(message: string) {
        if (!this._disposed && this._canvasNode?.isValid) {
            showToast(this._canvasNode, message);
        }
    }
}

function raceDifficultyDescription(difficulty: RaceDifficulty): string {
    if (difficulty === 'beginner') return '节奏宽松，适合熟悉操作。';
    if (difficulty === 'championship') return '高压对抗，挑战极限表现。';
    return '平衡对抗，考验节奏与判断。';
}

function makeScreenTitle(parent: Node, text: string, y: number): Node {
    const title = makeLabel('ScreenTitle', parent, text, 40, WHITE);
    title.setPosition(0, y, 2);
    const label = title.getComponent(Label)!;
    label.enableOutline = false;
    label.isItalic = true;
    const outline = title.addComponent(LabelOutline);
    outline.color = uiColor(4, 16, 30, 255);
    outline.width = 3;

    const slash = makeUiNode('ScreenTitleSlash', parent);
    slash.getComponent(UITransform)!.setContentSize(74, 8);
    slash.setPosition(-118, y - 30, 1);
    const slashGfx = slash.addComponent(Graphics);
    slashGfx.fillColor = ACCENT;
    slashGfx.moveTo(-36, -4);
    slashGfx.lineTo(36, -4);
    slashGfx.lineTo(28, 4);
    slashGfx.lineTo(-28, 4);
    slashGfx.close();
    slashGfx.fill();
    return title;
}
