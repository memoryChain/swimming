import {
    Button,
    Color,
    EventTouch,
    Graphics,
    Label,
    Mask,
    Node,
    Rect,
    ScrollView,
    Size,
    Sprite,
    SpriteFrame,
    Texture2D,
    UITransform,
    view,
} from 'cc';
import { RaceCategoryId, RaceModeId, RACE_MODE_OPTIONS, getRaceDistance, getRaceModeTitle, setRaceDifficulty } from '../core/GameBalance';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import {
    findPlayerCharacter,
    getPlayerCharacterSelection,
    getSelectedRaceDifficulty,
    PLAYER_CHARACTER_DEFINITIONS,
    PLAYER_COLOR_SCHEMES,
    PLAYER_SKIN_TONES,
    PlayerCharacterDefinition,
    PlayerCharacterId,
    selectPlayerCharacter,
    selectedPlayerColorScheme,
    selectedPlayerSkinTone,
    setPlayerColorScheme,
    setPlayerSkinTone,
    setSelectedRaceDifficulty,
} from '../app/PlayerCharacterConfig';
import { PrepareRaceCharacterPreview } from '../app/PrepareRaceCharacterPreview';
import { getProgressionManager } from '../progression/ProgressionManager';
import { PROGRESSION_BALANCE } from '../progression/ProgressionBalance';
import { resolveCharacterDisplayStats } from '../progression/PlayerBalanceOverrides';
import { fitFullScreenBackgroundCover, makeLabel, makeRect, makeRoundedRect, makeScreenEdgeGroup, makeTouchArea, makeUiNode, uiColor } from './RuntimeUiFactory';
import { UI_STYLE } from './UIStyle';
import { PlayerData } from '../backend/PlayerData';
import type { PlayerProfile } from '../backend/PlayerProfile';
import { showToast } from './Toast';
import { styleCurrencyNumberLabel, styleProjectUiLabel } from './ProjectUiFonts';
import { LobbyUiMotion } from './LobbyUiMotion';
import { CharacterAttributeTips } from './CharacterAttributeTips';
import { CareerPrototypePanel } from './CareerPrototypePanel';
import { setSoloRaceTicket } from '../progression/SoloRaceSession';
import { setSoloRaceDistance } from '../core/GameBalance';
import { getUILayer, UILayer } from './UILayers';

export type PrepareRaceFlowCallbacks = {
    onStartRace: () => void;
    onOpenRoom: () => void;
    onAiDebug?: () => void;
    onOpenShop?: () => void;
    onCharacterManagementChanged?: (active: boolean) => void;
};

type PrepareRaceView = 'ready' | 'characters';
type CharacterInspectorTab = 'attributes' | 'appearance';

type RaceModeCardView = {
    id: RaceModeId;
    category: RaceCategoryId;
    root: Node;
    selectedFrame: Node;
    selected: boolean;
};

type CharacterCardView = {
    characterId: PlayerCharacterId | null;
    selectedFrame: Node;
    activeStatus: Node;
    name: Label;
    level: Label;
    draftSelected: boolean;
    committed: boolean;
};

type TabView = {
    id: CharacterInspectorTab;
    label: Label;
    selected: boolean;
};

type SwatchView = {
    id: string;
    group: 'skin' | 'color';
    selectionGraphics: Graphics;
    selected: boolean;
};

const WHITE = UI_STYLE.white;
const DARK_TEXT = uiColor(6, 35, 54);
const PROTOTYPE_CHARACTER_SLOT_COUNT = 6;
const CHARACTER_LIST_COLUMN_COUNT = 2;
const CHARACTER_CARD_WIDTH = 171;
const CHARACTER_CARD_HEIGHT = 202;
const CHARACTER_CARD_X_PITCH = 170;
const CHARACTER_CARD_Y_PITCH = 200;
const CHARACTER_LIST_VIEW_WIDTH = 342;
const CHARACTER_LIST_VIEW_HEIGHT = 562;
const SWATCH_SIZE = 56;
const SWATCH_ART_SIZE = 46;
const RACE_MODE_CARD_VISIBLE_HEIGHT = 164;
const RACE_MODE_CARD_UNSELECTED_SCALE = 0.8;
const RACE_MODE_CARD_GAP = 7;
const RACE_MODE_STACK_TOP_Y = 240;

export class PrepareRaceFlow {
    private _root: Node | null = null;
    private _content: Node | null = null;
    private _lobbyBackgroundImage: Node | null = null;
    private _previewRoot: Node | null = null;
    private _readyManageButton: Node | null = null;
    private _previewRotateArea: Node | null = null;
    private readonly _onResize = (): void => this.layoutPresentation();
    private _preview: PrepareRaceCharacterPreview | null = null;
    private _visible = true;
    private _modalOverlayActive = false;
    private _view: PrepareRaceView = 'ready';
    private _draftCharacterId: PlayerCharacterId | null = null;
    private _activeInspectorTab: CharacterInspectorTab = 'attributes';
    private _previewRotateTouchId: number | null = null;
    private _upgradePending = false;
    private _motion = new LobbyUiMotion();
    private _leaving = false;
    private readonly _overlayButtonStates = new Map<Button, boolean>();
    private _attributeTips: CharacterAttributeTips | null = null;
    private _hasShownReady = false;

    private readonly _raceModeCards: RaceModeCardView[] = [];
    private readonly _raceCategoryTabs: { id: RaceCategoryId; root: Node; label: Label }[] = [];
    private _raceCategory: RaceCategoryId = 'competitive';
    private readonly _characterCards: CharacterCardView[] = [];
    private readonly _tabs: TabView[] = [];
    private readonly _swatches: SwatchView[] = [];

    private _readyName: Label | null = null;
    private _readyLevel: Label | null = null;
    private _readyStats: Label[] = [];
    private _readySkillIcon: Node | null = null;
    private _readySkillFallback: Label | null = null;
    private _inspectorName: Label | null = null;
    private _inspectorLevel: Label | null = null;
    private _inspectorCurrentStats: Label[] = [];
    private _inspectorNextStats: Label[] = [];
    private _inspectorSkillName: Label | null = null;
    private _inspectorSkillDescription: Label | null = null;
    private _mechanismMilestone: Label | null = null;
    private _upgradeButton: Button | null = null;
    private _upgradeCost: Label | null = null;
    private _upgradeCoinIcon: Node | null = null;
    private _upgradeGemIcon: Node | null = null;
    private _upgradeGemCost: Label | null = null;
    private _upgradeAction: Label | null = null;
    private _attributeContent: Node | null = null;
    private _appearanceContent: Node | null = null;
    private _skinRow: Node | null = null;
    private _skinSwatches: Node | null = null;
    private _skinUnavailableNotice: Node | null = null;
    private _attributeTabArtwork: Node | null = null;
    private _appearanceTabArtwork: Node | null = null;
    private _confirmCharacterButton: Node | null = null;
    private _activeCharacterNotice: Node | null = null;
    private _eventPageActive = false;
    private _careerPanel: CareerPrototypePanel | null = null;

    private readonly _onProfileChange = (_profile: PlayerProfile): void => {
        if (!this._visible || !this._root?.isValid || !this._root.activeInHierarchy
            || !this._content?.isValid || this._leaving) return;
        if (this._view === 'ready') {
            if (this._eventPageActive) return;
            this.presentCharacter(getPlayerCharacterSelection().characterId);
            this.refreshReadyCharacterInfo();
        } else {
            this.refreshCharacterCards();
            this.refreshCharacterInspector();
            this.refreshCharacterConfirmState();
        }
    };

    constructor(
        private readonly _parent: Node,
        private readonly _canvasNode: Node,
        private readonly _width: number,
        private readonly _height: number,
        private readonly _callbacks: PrepareRaceFlowCallbacks,
    ) {}

    showReadyScreen(): void {
        if (this._content?.isValid && this._view === 'ready') return;
        this.ensureRoot();
        this._view = 'ready';
        this.updateBackground();
        this._draftCharacterId = null;
        setNodeActive(this._lobbyBackgroundImage, true);
        this.replaceContent('PrepareRaceReadyContent');
        this.buildReadyScreen(this._content!);
        if (!this._eventPageActive) this.presentCharacter(getPlayerCharacterSelection().characterId);
        this._callbacks.onCharacterManagementChanged?.(this._eventPageActive);
        this.layoutPresentation();
        this._motion.enter(this._hasShownReady);
        this._hasShownReady = true;
    }

    showCharacterManagement(): void {
        if (this._content?.isValid && this._view === 'characters') return;
        this.ensureRoot();
        this._view = 'characters';
        this.updateBackground();
        this._draftCharacterId = getPlayerCharacterSelection().characterId;
        this._activeInspectorTab = 'attributes';
        setNodeActive(this._lobbyBackgroundImage, true);
        this.replaceContent('PrepareRaceCharacterManagementContent');
        this.buildCharacterManagement(this._content!);
        this.presentCharacter(this._draftCharacterId);
        this._callbacks.onCharacterManagementChanged?.(true);
        this.layoutPresentation();
        this._motion.enter(true);
    }

    /** 设置弹窗留在主 UI 相机时，只暂停更高优先级的 3D 预览相机。 */
    setModalOverlayActive(active: boolean): void {
        if (this._modalOverlayActive === active) return;
        this._modalOverlayActive = active;
        this._preview?.setRenderingEnabled(this._visible && !this._eventPageActive && !active);
    }

    /** 商店覆盖时只隐藏现有层级，返回后不会重建页面或 3D 角色预览。 */
    setVisible(visible: boolean): void {
        if (this._visible === visible) return;
        this._visible = visible;
        setNodeActive(this._root, visible);
        setNodeActive(this._previewRoot, visible && !this._eventPageActive);
        this._preview?.setRenderingEnabled(visible && !this._eventPageActive && !this._modalOverlayActive);
        if (visible) this._onProfileChange(PlayerData.profile);
    }

    /** 二级覆盖页打开前，复用当前页面的分组侧滑退场。 */
    transitionOutForOverlay(done: () => void): boolean {
        if (!this._visible || !this._content?.isValid) {
            done();
            return true;
        }
        if (this._leaving) return false;
        this._leaving = true;
        this._attributeTips?.hide();
        this._previewRotateTouchId = null;
        this._overlayButtonStates.clear();
        for (const button of this._content.getComponentsInChildren(Button)) {
            this._overlayButtonStates.set(button, button.interactable);
            setButtonInteractable(button, false);
        }
        const content = this._content;
        this._motion.exit(() => {
            if (!content.isValid || this._content !== content) return;
            this.setVisible(false);
            done();
        });
        return true;
    }

    /** 从二级覆盖页返回时恢复原层级，并播放同款快速入场。 */
    transitionInFromOverlay(): void {
        if (!this._root?.isValid || !this._content?.isValid) return;
        this.setVisible(true);
        for (const [button, interactable] of this._overlayButtonStates) {
            setButtonInteractable(button, interactable);
        }
        this._overlayButtonStates.clear();
        this._leaving = false;
        this._motion.enter(true);
        this._onProfileChange(PlayerData.profile);
    }

    dispose(): void {
        this._attributeTips?.dispose();
        this._attributeTips = null;
        this._motion.dispose();
        this._leaving = true;
        this._modalOverlayActive = false;
        this._overlayButtonStates.clear();
        PlayerData.offChange(this._onProfileChange);
        view.off('canvas-resize', this._onResize);
        view.off('design-resolution-changed', this._onResize);
        if (this._previewRoot?.isValid) this._previewRoot.destroy();
        this._previewRoot = null;
        this._preview = null;
        if (this._root?.isValid) this._root.destroy();
        this._root = null;
        this._content = null;
        this._lobbyBackgroundImage = null;
        this.resetViewReferences();
    }

    private ensureRoot(): void {
        if (this._root?.isValid) return;
        const root = makeUiNode('PrepareRaceUI', this._parent);
        root.getComponent(UITransform)!.setContentSize(this._width, this._height);
        this._root = root;
        this.buildBackground(root);
        PlayerData.onChange(this._onProfileChange);
        view.on('canvas-resize', this._onResize);
        view.on('design-resolution-changed', this._onResize);
    }

    private replaceContent(name: string): void {
        this._attributeTips?.hide();
        // 切换页面才替换结构；选择状态变化不进入这里，3D 预览单独保留。
        this._motion.dispose();
        this._motion = new LobbyUiMotion();
        this._leaving = false;
        this._overlayButtonStates.clear();
        this._content?.destroy();
        this.resetViewReferences();
        this._content = makeUiNode(name, this._root!);
        this._content.getComponent(UITransform)!.setContentSize(this._width, this._height);
    }

    private leaveCurrentScreen(done: () => void): void {
        if (this._leaving || !this._content?.isValid) return;
        this._leaving = true;
        this._attributeTips?.hide();
        this._previewRotateTouchId = null;
        const content = this._content;
        for (const button of content.getComponentsInChildren(Button)) {
            setButtonInteractable(button, false);
        }
        this._motion.exit(() => {
            if (content.isValid && this._content === content) done();
        });
    }

    private resetViewReferences(): void {
        this._readyManageButton = null;
        this._previewRotateArea = null;
        this._previewRotateTouchId = null;
        this._raceModeCards.length = 0;
        this._raceCategoryTabs.length = 0;
        this._characterCards.length = 0;
        this._tabs.length = 0;
        this._swatches.length = 0;
        this._readyName = null;
        this._readyLevel = null;
        this._readyStats = [];
        this._readySkillIcon = null;
        this._readySkillFallback = null;
        this._inspectorName = null;
        this._inspectorLevel = null;
        this._inspectorCurrentStats = [];
        this._inspectorNextStats = [];
        this._inspectorSkillName = null;
        this._inspectorSkillDescription = null;
        this._mechanismMilestone = null;
        this._upgradeButton = null;
        this._upgradeCost = null;
        this._upgradeCoinIcon = null;
        this._upgradeGemIcon = null;
        this._upgradeGemCost = null;
        this._upgradeAction = null;
        this._attributeContent = null;
        this._appearanceContent = null;
        this._skinRow = null;
        this._skinSwatches = null;
        this._skinUnavailableNotice = null;
        this._attributeTabArtwork = null;
        this._appearanceTabArtwork = null;
        this._confirmCharacterButton = null;
        this._activeCharacterNotice = null;
    }

    private _backgroundRequest = 0;

    private updateBackground(): void {
        const image = this._lobbyBackgroundImage;
        if (!image?.isValid) return;
        const token = ++this._backgroundRequest;
        const path = this._view === 'ready' ? RESOURCE_PATHS.lobbyB.background : RESOURCE_PATHS.characterUi.background;
        loadRaceAsset(path, Texture2D, (error, texture) => {
            if (error || !texture || !image.isValid || token !== this._backgroundRequest) return;
            const sprite = image.getComponent(Sprite) ?? image.addComponent(Sprite);
            const old = sprite.spriteFrame;
            const frame = new SpriteFrame(); frame.texture = texture;
            sprite.spriteFrame = frame; sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.trim = false;
            old?.destroy();
        });
    }

    private buildBackground(root: Node): void {
        const fallback = makeRect('PrepareRaceBackdrop', root, this._width, this._height, uiColor(4, 20, 42));
        fitFullScreenBackgroundCover(fallback);
        const image = makeUiNode('PrepareRaceBackgroundImage', root);
        image.setPosition(0, 0, 1);
        fitFullScreenBackgroundCover(image);
        this._lobbyBackgroundImage = image;
        image.once(Node.EventType.NODE_DESTROYED, () => image.getComponent(Sprite)?.spriteFrame?.destroy());
    }

    private buildReadyScreen(parent: Node): void {
        const left = makeScreenEdgeGroup('LobbyLeft', parent, 'left', this._width, this._height, 0, false);
        const right = makeScreenEdgeGroup('LobbyRight', parent, 'right', this._width, this._height, 0, false);
        this.buildReadyCharacterPanel(left);
        this.buildPreviewPresentation(parent);
        this._careerPanel = new CareerPrototypePanel(right,
            () => this.leaveCurrentScreen(this._callbacks.onStartRace),
            () => { setSoloRaceTicket(null); setSoloRaceDistance(null); this.leaveCurrentScreen(this._callbacks.onOpenRoom); },
            { parent: this._root!, visibility: visible => this.setEventPageVisible(visible) });
        this.buildReadyActions(right);
        this.refreshReadyCharacterInfo();
    }

    private setEventPageVisible(visible: boolean): void {
        this._eventPageActive = visible;
        this._previewRotateTouchId = null;
        this._attributeTips?.hide();
        setNodeActive(this._content, !visible);
        setNodeActive(this._previewRoot, !visible);
        if (!visible && this._view === 'ready' && !this._leaving && this._content?.isValid) {
            this.presentCharacter(getPlayerCharacterSelection().characterId);
        }
        this._callbacks.onCharacterManagementChanged?.(visible);
    }

    private buildReadyCharacterPanel(parent: Node): void {
        parent = this._motion.group(parent, 'LobbyLeftMotion', -24);
        makeRaceTextureSprite('ReadyCharacterPanel', parent, RESOURCE_PATHS.lobbyB.characterInfo, 233, 274, -506.5, 24, 2);
        this._readyName = makeBoundLabel('CharacterName', parent, '', 28, DARK_TEXT, 240, 40, -458, 147, Label.HorizontalAlign.LEFT);
        stylePsdTitleLabel(this._readyName, 36);
        this._readyLevel = makeBoundLabel('CharacterLevel', parent, '', 16, WHITE, 64, 28, -548, 114);
        styleCurrencyNumberLabel(this._readyLevel, 22);
        const statNames = ['体力', '技巧', '爆发'];
        const statY = [69, 17, -36];
        for (let index = 0; index < statNames.length; index++) {
            const label = makeBoundLabel(`StatName${index}`, parent, statNames[index], 16, DARK_TEXT, 80, 24, -491, statY[index], Label.HorizontalAlign.LEFT);
            stylePsdTitleLabel(label, 22);
            const value = makeBoundLabel(`StatValue${index}`, parent, '', 20, DARK_TEXT, 100, 28, -481, statY[index] - 22, Label.HorizontalAlign.LEFT);
            styleCurrencyNumberLabel(value, 26); this._readyStats.push(value);
        }
        this.bindAttributeTip(parent, -520, 12, 150, 166);
        const skill = makeRaceTextureButton('ReadySkill', parent, RESOURCE_PATHS.lobbyB.skillBase, 74, 74, -539, -129, 3);
        this._readySkillIcon = makeRaceTextureSprite('BreathIcon', skill, RESOURCE_PATHS.lobbyB.skillBreath, 46, 44, 0, 1, 1);
        this._readySkillFallback = makeBoundLabel('SkillFallback', skill, '技能', 18, WHITE, 58, 30, 0, 0);
        stylePsdTitleLabel(this._readySkillFallback, 24);
        this._motion.bindButton(skill);
        skill.on(Button.EventType.CLICK, () => {
            const character = findPlayerCharacter();
            if (!this._leaving && character) showToast(this._canvasNode, `${character.skillName}\n${character.skillDescription}`, { duration: 4 });
        });
        const manageParent = this._motion.group(this._content!, 'LobbyManageMotion', 0, -12, 0.1);
        const manage = makeRaceTextureButton('MyCharactersButton', manageParent, RESOURCE_PATHS.lobbyB.characterButton, 263, 70, -190.5, -275, 3);
        this._readyManageButton = manage;
        const manageLabel = makeBoundLabel('Label', manage, '角色与培养', 24, DARK_TEXT, 150, 36, 28, 0);
        stylePsdTitleLabel(manageLabel, 32);
        this._motion.bindButton(manage);
        manage.on(Button.EventType.CLICK, () => this.leaveCurrentScreen(() => this.showCharacterManagement()));
        if (this._callbacks.onAiDebug) {
            const ai = makeTouchArea('AiDebugButton', parent, 120, 44); ai.setPosition(-520, -290, 3);
            const label = makeBoundLabel('Label', ai, 'AI 测试', 18, DARK_TEXT, 120, 30, 0, 0);
            stylePsdTitleLabel(label, 24);
            ai.on(Button.EventType.CLICK, () => { if (!this._leaving) this._callbacks.onAiDebug?.(); });
        }
    }

    private bindAttributeTip(parent: Node, x: number, y: number, width: number, height: number): void {
        const hit = makeTouchArea('AttributeTipHit', parent, width, height);
        hit.setPosition(x, y, 4);
        hit.on(Button.EventType.CLICK, () => {
            if (this._leaving || !hit.isValid || !hit.activeInHierarchy) return;
            if (!this._attributeTips) this._attributeTips = new CharacterAttributeTips(this._canvasNode);
            this._attributeTips.show(hit);
        });
    }

    private refreshReadyCharacterInfo(): void {
        const character = findPlayerCharacter();
        if (!character) return;
        const level = getProgressionManager().getCharacterLevel(character.id);
        setLabelString(this._readyName, character.name);
        setLabelString(this._readyLevel, `LV.${level}`);
        const display = resolveCharacterDisplayStats(character, level, PROGRESSION_BALANCE.maxLevel);
        const values = [display.stamina, display.technique, display.burst];
        for (let index = 0; index < this._readyStats.length; index++) {
            setLabelString(this._readyStats[index], `${values[index]}`);
        }
        setNodeActive(this._readySkillIcon, character.abilityId === 'breathControl');
        setNodeActive(this._readySkillFallback?.node ?? null, character.abilityId !== 'breathControl');
    }

    private buildRaceModeList(parent: Node): void {
        const selected = getSelectedRaceDifficulty();
        this._raceCategory = RACE_MODE_OPTIONS.find(option => option.id === selected)?.category ?? 'competitive';
        const categories: readonly { id: RaceCategoryId; label: string }[] = [
            { id: 'competitive', label: '竞技' },
            { id: 'entertainment', label: '娱乐' },
        ];
        for (let index = 0; index < categories.length; index++) {
            const category = categories[index];
            const root = makeRoundedRect(`RaceCategory_${category.id}`, parent, 104, 42,
                category.id === this._raceCategory ? uiColor(255, 225, 52) : uiColor(224, 242, 247), 18);
            root.setPosition(356 + index * 112, 306, 4);
            const label = makeBoundLabel('Label', root, category.label, 20, DARK_TEXT, 88, 30, 0, 0);
            stylePsdRuntimeLabel(label, 'PingFang SC', true, 25);
            const button = root.addComponent(Button); button.target = root; button.transition = Button.Transition.NONE;
            root.on(Button.EventType.CLICK, () => this.selectRaceCategory(category.id));
            this._raceCategoryTabs.push({ id: category.id, root, label });
        }
        for (let index = 0; index < RACE_MODE_OPTIONS.length; index++) {
            const option = RACE_MODE_OPTIONS[index];
            const entrance = this._motion.group(parent, `ModeEntrance_${option.id}`, 24, 0, index * 0.045);
            const card = makeUiNode(`RaceMode_${option.id}`, entrance);
            card.getComponent(UITransform)!.setContentSize(410, 170);
            const artPath = option.id === 'beginner'
                ? RESOURCE_PATHS.lobbyUi.modeBeginner
                : option.id === 'championship'
                    ? RESOURCE_PATHS.lobbyUi.modeChampionship
                    : RESOURCE_PATHS.lobbyUi.modeStandard;
            makeRaceTextureSprite('Artwork', card, artPath, 410, 170, 0, 0, 1);
            const selectedFrame = makeRaceTextureSprite('SelectedFrame', card, RESOURCE_PATHS.lobbyUi.modeSelectedFrame, 410, 170, 0, 0, 2);
            const button = card.addComponent(Button);
            button.target = card;
            button.transition = Button.Transition.NONE;
            const title = makeBoundLabel('Title', card, raceDifficultyTitle(option.id), 25, DARK_TEXT, 260, 34, -61, -59, Label.HorizontalAlign.LEFT);
            stylePsdRuntimeLabel(title, 'PingFang SC', true, 32);
            const distance = makeBoundLabel('Distance', card, raceDifficultyDistance(option.id), 20, DARK_TEXT, 78, 32, 155, -59, Label.HorizontalAlign.RIGHT);
            stylePsdRuntimeLabel(distance, 'Arial Black', true, 27);
            const view: RaceModeCardView = { id: option.id, category: option.category, root: card, selectedFrame, selected: option.id === selected };
            this._raceModeCards.push(view);
            this.applyRaceModeCardSelection(view);
            card.on(Button.EventType.CLICK, () => this.selectRaceDifficulty(option.id));
        }
        this.layoutRaceModeCards();
    }

    private selectRaceCategory(category: RaceCategoryId): void {
        if (this._leaving || this._raceCategory === category) return;
        this._raceCategory = category;
        for (const tab of this._raceCategoryTabs) {
            const selected = tab.id === category;
            if (tab.root.scale.x !== (selected ? 1.05 : 1)) tab.root.setScale(selected ? 1.05 : 1, selected ? 1.05 : 1, 1);
            const graphics = tab.root.getComponent(Graphics);
            if (graphics) {
                graphics.clear();
                graphics.fillColor = selected ? uiColor(255, 225, 52) : uiColor(224, 242, 247);
                graphics.roundRect(-52, -21, 104, 42, 18);
                graphics.fill();
            }
        }
        const selectedMode = RACE_MODE_OPTIONS.find(option => option.id === getSelectedRaceDifficulty());
        if (selectedMode?.category !== category) {
            const first = RACE_MODE_OPTIONS.find(option => option.category === category);
            if (first) this.selectRaceDifficulty(first.id);
        }
        this.layoutRaceModeCards(true);
    }

    private selectRaceDifficulty(difficulty: RaceModeId): void {
        if (this._leaving || getSelectedRaceDifficulty() === difficulty) return;
        setSelectedRaceDifficulty(difficulty);
        for (const card of this._raceModeCards) {
            const selected = card.id === difficulty;
            if (card.selected === selected) continue;
            card.selected = selected;
            this.applyRaceModeCardSelection(card, true);
        }
        this.layoutRaceModeCards(true);
    }

    private applyRaceModeCardSelection(card: RaceModeCardView, animated = false): void {
        this._motion.selectFrame(card.selectedFrame, card.selected, animated);
    }

    private layoutRaceModeCards(animated = false): void {
        let topY = RACE_MODE_STACK_TOP_Y;
        let visibleCount = 0;
        for (const card of this._raceModeCards) {
            if (card.category === this._raceCategory) visibleCount++;
        }
        const compactEntertainment = this._raceCategory === 'entertainment' && visibleCount > 2;
        for (const card of this._raceModeCards) {
            const visible = card.category === this._raceCategory;
            if (card.root.active !== visible) card.root.active = visible;
            if (!visible) continue;
            const scale = compactEntertainment
                ? (card.selected ? 0.68 : 0.62)
                : (card.selected ? 1 : RACE_MODE_CARD_UNSELECTED_SCALE);
            const visibleHeight = RACE_MODE_CARD_VISIBLE_HEIGHT * scale;
            const y = topY - visibleHeight / 2;
            const x = compactEntertainment
                ? (card.selected ? 430 : 447)
                : (card.selected ? 408 : 447);
            this._motion.moveCard(card.root, x, y, scale, animated);
            topY = y - visibleHeight / 2 - (compactEntertainment ? 8 : RACE_MODE_CARD_GAP);
        }
    }

    private buildReadyActions(parent: Node): void {
        parent = this._motion.group(parent, 'LobbyActionsMotion', 0, -12, 0.15);
        const room = makeRaceTextureButton('FriendRoomButton', parent, RESOURCE_PATHS.lobbyUi.onlineButton, 102, 102, 216, -207, 3);
        const roomLabel = makeBoundLabel('Label', room, '联机', 18, DARK_TEXT, 64, 26, 0, -9);
        stylePsdRuntimeLabel(roomLabel, 'PingFang SC', true, 24);
        this._motion.bindButton(room);
        room.on(Button.EventType.CLICK, () => {
            setSoloRaceTicket(null); setSoloRaceDistance(null);
            this.leaveCurrentScreen(this._callbacks.onOpenRoom);
        });

        const start = makeRaceTextureButton('StartRaceButton', parent, RESOURCE_PATHS.lobbyB.quickButton, 352, 102, 438, -207, 3);
        makeRaceTextureSprite('QuickIcon', start, RESOURCE_PATHS.lobbyB.quickIcon, 38, 43, -112, 3.5, 1);
        const startLabel = makeBoundLabel('Label', start, '快速比赛', 38, DARK_TEXT, 188, 54, 25, 0);
        stylePsdTitleLabel(startLabel, 48);
        this._motion.bindButton(start, true);
        start.on(Button.EventType.CLICK, () => {
            if (!this._leaving) this._careerPanel?.openQuick(getSelectedRaceDifficulty());
        });
    }

    private buildCharacterManagement(parent: Node): void {
        const header = makeScreenEdgeGroup('CharacterHeader', parent, 'left', this._width, this._height, 0, false);
        const left = makeScreenEdgeGroup('CharacterLeft', parent, 'left', this._width, this._height, 48, false);
        const right = makeScreenEdgeGroup('CharacterRight', parent, 'right', this._width, this._height, 60, false);
        this.buildCharacterHeader(header);
        this.buildCharacterRoster(left);
        this.buildPreviewPresentation(parent);
        this.buildCharacterInspector(right);
        this.refreshCharacterCards();
        this.refreshCharacterInspector();
        this.selectInspectorTab('attributes', true);
    }

    private buildCharacterHeader(parent: Node): void {
        parent = this._motion.group(parent, 'CharacterHeaderMotion', -16);
        const header = buildSecondaryPageHeader(parent, 'Character', '角色',
            () => this.leaveCurrentScreen(() => this.showReadyScreen()));
        this._motion.bindButton(header.backNode);
    }

    private buildCharacterRoster(parent: Node): void {
        parent = this._motion.group(parent, 'CharacterRosterMotion', -24);
        const slotCount = Math.max(PROTOTYPE_CHARACTER_SLOT_COUNT, PLAYER_CHARACTER_DEFINITIONS.length);
        const rowCount = Math.ceil(slotCount / CHARACTER_LIST_COLUMN_COUNT);
        const contentHeight = Math.max(
            CHARACTER_LIST_VIEW_HEIGHT,
            CHARACTER_CARD_HEIGHT + (rowCount - 1) * CHARACTER_CARD_Y_PITCH,
        );
        const viewport = makeUiNode('CharacterRosterScrollView', parent);
        viewport.getComponent(UITransform)!.setContentSize(CHARACTER_LIST_VIEW_WIDTH, CHARACTER_LIST_VIEW_HEIGHT);
        viewport.setPosition(-449, -21, 2);
        const mask = viewport.addComponent(Mask);
        mask.type = Mask.Type.GRAPHICS_RECT;
        mask.inverted = false;
        const scrollView = viewport.addComponent(ScrollView);
        scrollView.horizontal = false;
        scrollView.vertical = true;
        scrollView.inertia = true;
        scrollView.elastic = true;
        scrollView.brake = 0.5;
        scrollView.cancelInnerEvents = true;

        const content = makeUiNode('CharacterRosterContent', viewport);
        content.getComponent(UITransform)!.setContentSize(CHARACTER_LIST_VIEW_WIDTH, contentHeight);
        // 内容顶边与视口顶边对齐，新增角色时同步扩大滚动范围。
        content.setPosition(0, (CHARACTER_LIST_VIEW_HEIGHT - contentHeight) / 2, 0);
        scrollView.content = content;

        for (let index = 0; index < slotCount; index++) {
            this.buildCharacterCard(content, PLAYER_CHARACTER_DEFINITIONS[index] ?? null, index);
        }
    }

    private buildCharacterCard(parent: Node, character: PlayerCharacterDefinition | null, index: number): void {
        const column = index % CHARACTER_LIST_COLUMN_COUNT;
        const row = Math.floor(index / CHARACTER_LIST_COLUMN_COUNT);
        const firstRowY = (parent.getComponent(UITransform)!.contentSize.height - CHARACTER_CARD_HEIGHT) / 2;
        const card = makeUiNode(`CharacterSlot${index}`, parent);
        card.getComponent(UITransform)!.setContentSize(CHARACTER_CARD_WIDTH, CHARACTER_CARD_HEIGHT);
        card.setPosition(-84.5 + column * CHARACTER_CARD_X_PITCH, firstRowY - row * CHARACTER_CARD_Y_PITCH, 1);

        // 固定圆角遮罩仅在挂载时绘制，覆盖新卡面和占位图；边框独立叠在外层。
        const portraitClip = makeUiNode('PortraitClip', card);
        portraitClip.getComponent(UITransform)!.setContentSize(160, 190);
        portraitClip.setPosition(0.5, 0, 1);
        const portraitMask = portraitClip.addComponent(Mask);
        portraitMask.type = Mask.Type.GRAPHICS_STENCIL;
        const clipGraphics = portraitClip.getComponent(Graphics)!;
        clipGraphics.clear();
        clipGraphics.roundRect(-80, -95, 160, 190, 12);
        clipGraphics.fill();

        if (character) {
            // 方形卡面居中裁切为 160×156，保持头胸比例，姓名栏仍独立覆盖。
            makeRaceTextureRegionSprite(
                'Portrait', portraitClip, RESOURCE_PATHS.characterUi.portraits[character.id],
                new Rect(0, 4, 320, 312), 160, 156, 0, 17, 0,
            );
        } else {
            const portraitPath = index % 2 === 0 ? RESOURCE_PATHS.characterUi.portraitBlue : RESOURCE_PATHS.characterUi.portraitRed;
            makeRaceTextureSprite('Portrait', portraitClip, portraitPath, 160, 190, 0, 0, 0);
        }

        if (!character) {
            const lockDim = makeRoundedRect('LockedDim', card, 160, 156, uiColor(8, 20, 32, 145), 10);
            lockDim.setPosition(0.5, 17, 2);
        }

        // PSD stacking contract: artwork at the bottom, transparent white frame
        // above it, and the selected yellow outline above every other card layer.
        makeRaceTextureSprite('CardFrame', card, RESOURCE_PATHS.characterUi.cardFrame, 171, 202, 0, 0, 3);

        const name = makeBoundLabel('Name', card, character?.name ?? '未获得', 18, DARK_TEXT, 116, 26, -17.5, -77.5, Label.HorizontalAlign.LEFT);
        stylePsdTitleLabel(name, 23);
        const level = makeBoundLabel('Level', card, '', 14, DARK_TEXT, 40, 22, 54.5, -77.5, Label.HorizontalAlign.RIGHT);
        stylePsdRuntimeLabel(level, 'Arial Black', true, 19);
        const activeStatus = makeRaceTextureSprite('ActiveStatus', card, RESOURCE_PATHS.characterUi.statusActive, 62, 27, 49.5, 79.5, 5);
        activeStatus.active = false;
        if (!character) {
            makeRaceTextureSprite('LockIcon', card, RESOURCE_PATHS.characterUi.lockIcon, 38, 51, 1.5, 6.5, 6);
        }
        const selectedFrame = makeRaceTextureSprite('SelectedFrame', card, RESOURCE_PATHS.characterUi.cardSelected, 172, 203, 0.5, 0, 7);
        selectedFrame.active = false;
        const view: CharacterCardView = {
            characterId: character?.id ?? null,
            selectedFrame,
            activeStatus,
            name,
            level,
            draftSelected: false,
            committed: false,
        };
        this._characterCards.push(view);
        if (character?.unlocked) {
            const button = card.addComponent(Button);
            button.target = card;
            button.transition = Button.Transition.SCALE;
            button.zoomScale = 0.98;
            button.duration = 0.06;
            card.on(Button.EventType.CLICK, () => this.selectDraftCharacter(character.id));
        }
    }

    private selectDraftCharacter(characterId: PlayerCharacterId): void {
        if (this._draftCharacterId === characterId) return;
        const previous = this._draftCharacterId;
        this._attributeTips?.hide();
        this._draftCharacterId = characterId;
        this.refreshCharacterCard(previous);
        this.refreshCharacterCard(characterId);
        this.refreshCharacterInspector();
        this.refreshAppearanceSupport();
        this.refreshCharacterConfirmState();
        this.presentCharacter(characterId);
    }

    private refreshCharacterCards(): void {
        for (const card of this._characterCards) this.refreshCharacterCard(card.characterId);
    }

    private refreshCharacterCard(characterId: PlayerCharacterId | null): void {
        const card = this._characterCards.find((entry) => entry.characterId === characterId);
        if (!card) return;
        const draftSelected = characterId !== null && characterId === this._draftCharacterId;
        const committed = characterId !== null && characterId === getPlayerCharacterSelection().characterId;
        const character = characterId ? findPlayerCharacter(characterId) : null;
        setLabelString(card.level, character ? `LV.${getProgressionManager().getCharacterLevel(character.id)}` : '');
        setNodeActive(card.activeStatus, committed);
        if (card.draftSelected === draftSelected && card.committed === committed) return;
        card.draftSelected = draftSelected;
        card.committed = committed;
        this.drawCharacterCard(card);
    }

    private drawCharacterCard(card: CharacterCardView): void {
        setNodeActive(card.selectedFrame, card.draftSelected);
        setLabelColor(card.name, DARK_TEXT);
        setLabelColor(card.level, DARK_TEXT);
    }

    private buildCharacterInspector(parent: Node): void {
        parent = this._motion.group(parent, 'CharacterInspectorMotion', 24);
        const panel = makeRaceTextureSprite('CharacterInspector', parent, RESOURCE_PATHS.characterUi.detailPanelBackground, 349, 476, 462.5, 22, 2);
        this._attributeTabArtwork = makeRaceTextureSprite('TabArtworkAttributes', panel, RESOURCE_PATHS.characterUi.tabAttributes, 299, 49, -12, 189.5, 1);
        this._appearanceTabArtwork = makeRaceTextureSprite('TabArtworkAppearance', panel, RESOURCE_PATHS.characterUi.tabAppearance, 299, 49, -12, 189.5, 1);
        this.buildInspectorTab(panel, 'attributes', '属性', -87.5);
        this.buildInspectorTab(panel, 'appearance', '外观', 60);

        this._attributeContent = makeUiNode('AttributeContent', panel);
        this._attributeContent.getComponent(UITransform)!.setContentSize(320, 360);
        this._attributeContent.setPosition(0, 0, 2);
        this.buildAttributeContent(this._attributeContent);

        this._appearanceContent = makeUiNode('AppearanceContent', panel);
        this._appearanceContent.getComponent(UITransform)!.setContentSize(320, 360);
        this._appearanceContent.setPosition(0, 20, 2);
        this.buildAppearanceContent(this._appearanceContent);

        const confirm = makeRaceTextureButton('ConfirmCharacterButton', parent, RESOURCE_PATHS.characterUi.confirmButton, 332, 102, 448, -287, 3);
        this._confirmCharacterButton = confirm;
        const confirmLabel = makeBoundLabel('Label', confirm, '确认选择', 38, DARK_TEXT, 220, 54, 0, 0);
        stylePsdTitleLabel(confirmLabel, 48);
        confirm.on(Button.EventType.CLICK, () => this.confirmDraftCharacter());

        const activeNotice = makeBoundLabel('ActiveCharacterNotice', parent, '已上场', 36, DARK_TEXT, 220, 54, 448, -287);
        stylePsdTitleLabel(activeNotice, 46);
        this._activeCharacterNotice = activeNotice.node;
        this.refreshCharacterConfirmState();
    }

    private refreshCharacterConfirmState(): void {
        const alreadyActive = this._draftCharacterId !== null
            && this._draftCharacterId === getPlayerCharacterSelection().characterId;
        setNodeActive(this._confirmCharacterButton, !alreadyActive);
        setNodeActive(this._activeCharacterNotice, alreadyActive);
    }

    private buildInspectorTab(parent: Node, id: CharacterInspectorTab, text: string, x: number): void {
        const tab = makeUiNode(`Tab_${id}`, parent);
        tab.getComponent(UITransform)!.setContentSize(149, 49);
        tab.setPosition(x, 189.5, 3);
        const button = tab.addComponent(Button);
        button.target = tab;
        button.transition = Button.Transition.NONE;
        const label = makeBoundLabel('Label', tab, text, 22, DARK_TEXT, 138, 40, 0, 0);
        stylePsdRuntimeLabel(label, 'PingFang SC', true, 28);
        this._tabs.push({ id, label, selected: false });
        tab.on(Button.EventType.CLICK, () => this.selectInspectorTab(id, false));
    }

    private selectInspectorTab(tab: CharacterInspectorTab, force: boolean): void {
        if (!force && this._activeInspectorTab === tab) return;
        this._attributeTips?.hide();
        this._activeInspectorTab = tab;
        setNodeActive(this._attributeContent, tab === 'attributes');
        setNodeActive(this._appearanceContent, tab === 'appearance');
        setNodeActive(this._attributeTabArtwork, tab === 'attributes');
        setNodeActive(this._appearanceTabArtwork, tab === 'appearance');
        for (const view of this._tabs) {
            const selected = view.id === tab;
            if (!force && view.selected === selected) continue;
            view.selected = selected;
            setLabelColor(view.label, selected ? WHITE : DARK_TEXT);
        }
    }

    private buildAttributeContent(parent: Node): void {
        this._inspectorName = makeBoundLabel('CharacterName', parent, '', 28, DARK_TEXT, 200, 38, -47.5, 140, Label.HorizontalAlign.LEFT);
        stylePsdTitleLabel(this._inspectorName, 36);
        makeRaceTextureSprite('CharacterLevelPill', parent, RESOURCE_PATHS.characterUi.levelPill, 64, 28, 95.5, 143, 1);
        this._inspectorLevel = makeBoundLabel('CharacterLevel', parent, '', 16, WHITE, 54, 24, 95.5, 143);
        stylePsdRuntimeLabel(this._inspectorLevel, 'Arial Black', true, 20);
        const names = ['体力', '技巧', '爆发力'];
        const iconPaths = [
            RESOURCE_PATHS.characterUi.statHp,
            RESOURCE_PATHS.characterUi.statTechnique,
            RESOURCE_PATHS.characterUi.statBurst,
        ];
        const statYs = [85.5, 41.5, -4];
        for (let index = 0; index < names.length; index++) {
            const y = statYs[index];
            if (index !== 1) {
                makeRaceTextureSprite(`StatRow${index}`, parent, RESOURCE_PATHS.characterUi.statRow, 284, 42, -15.5, y, 1);
            }
            makeRaceTextureSprite(`StatIcon${index}`, parent, iconPaths[index], index === 1 ? 26 : index === 0 ? 30 : 28, index === 0 ? 28 : index === 1 ? 30 : 32, -132.5, y, 2);
            const statName = makeBoundLabel(`StatName${index}`, parent, names[index], 18, DARK_TEXT, 80, 28, -63.5, y, Label.HorizontalAlign.LEFT);
            stylePsdTitleLabel(statName, 24);
            const current = makeBoundLabel(`Current${index}`, parent, '', 19, DARK_TEXT, 62, 28, 2.5, y, Label.HorizontalAlign.RIGHT);
            stylePsdRuntimeLabel(current, 'Arial Black', true, 24);
            this._inspectorCurrentStats.push(current);
            makeRaceTextureSprite(`Arrow${index}`, parent, RESOURCE_PATHS.characterUi.statArrow, 14, 13, 59.5, y, 2);
            const next = makeBoundLabel(`Next${index}`, parent, '', 19, uiColor(56, 208, 29), 62, 28, 78.5, y, Label.HorizontalAlign.RIGHT);
            stylePsdRuntimeLabel(next, 'Arial Black', true, 24);
            this._inspectorNextStats.push(next);

        }
        this.bindAttributeTip(parent, -15.5, 40.75, 284, 131.5);
        makeRaceTextureSprite('SkillHeader', parent, RESOURCE_PATHS.characterUi.skillHeader, 316, 28, -14.5, -53, 1);
        const skillHeading = makeBoundLabel('SkillHeading', parent, 'SKILL', 16, DARK_TEXT, 76, 24, -119.5, -53, Label.HorizontalAlign.LEFT);
        stylePsdRuntimeLabel(skillHeading, 'Arial Black', true, 20);
        this._mechanismMilestone = makeBoundLabel('MechanismMilestone', parent, '', 13, uiColor(60, 105, 130), 190, 22, 55, -53, Label.HorizontalAlign.RIGHT);
        stylePsdRuntimeLabel(this._mechanismMilestone, 'PingFang SC', false, 18);
        // Reuse the lobby skill-card texture region so both screens always show
        // the identical icon and dark circular frame without a duplicate asset.
        makeRaceTextureRegionSprite('SkillIcon', parent, RESOURCE_PATHS.lobbyUi.skillCard, new Rect(20, 49, 71, 71), 70, 70, -118.5, -122, 2);
        this._inspectorSkillName = makeBoundLabel('SkillName', parent, '', 20, DARK_TEXT, 190, 28, 25.5, -102, Label.HorizontalAlign.LEFT);
        stylePsdTitleLabel(this._inspectorSkillName, 27);
        // 两行 20px 行高另留 2px，顶部避开技能名，底部止于升级按钮上沿。
        this._inspectorSkillDescription = makeBoundLabel('SkillDescription', parent, '', 16, uiColor(72, 82, 98), 190, 42, 25.5, -139, Label.HorizontalAlign.LEFT);
        stylePsdRuntimeLabel(this._inspectorSkillDescription, 'PingFang SC', false, 20);
        this._inspectorSkillDescription.enableWrapText = true;

        const upgrade = makeRaceTextureButton('UpgradeButton', parent, RESOURCE_PATHS.characterUi.upgradeButton, 313, 70, -16, -195, 2);
        this._upgradeButton = upgrade.getComponent(Button)!;
        this._upgradeCoinIcon = makeRaceTextureSprite('CurrencyIcon', upgrade, RESOURCE_PATHS.characterUi.upgradeCurrency, 36, 36, -106.5, 0, 2);
        this._upgradeCost = makeBoundLabel('Cost', upgrade, '', 22, DARK_TEXT, 78, 30, -30.5, 0, Label.HorizontalAlign.LEFT);
        stylePsdRuntimeLabel(this._upgradeCost, 'Arial Black', true, 28);
        this._upgradeGemIcon = makeRaceTextureSprite('GemIcon', upgrade, RESOURCE_PATHS.shopUi.gemIcon, 32, 32, -40, 0, 2);
        this._upgradeGemCost = makeBoundLabel('GemCost', upgrade, '', 20, DARK_TEXT, 30, 30, -7, 0, Label.HorizontalAlign.LEFT);
        stylePsdRuntimeLabel(this._upgradeGemCost, 'Arial Black', true, 28);
        this._upgradeAction = makeBoundLabel('Action', upgrade, '升级', 24, DARK_TEXT, 90, 34, 68, 0);
        stylePsdTitleLabel(this._upgradeAction, 31);
        upgrade.on(Button.EventType.CLICK, () => void this.upgradeDraftCharacter());
    }

    private refreshCharacterInspector(): void {
        if (this._leaving) return;
        const character = this._draftCharacterId ? findPlayerCharacter(this._draftCharacterId) : null;
        if (!character) return;
        const progression = getProgressionManager();
        const level = progression.getCharacterLevel(character.id);
        const nextLevel = Math.min(PROGRESSION_BALANCE.maxLevel, level + 1);
        const current = resolveCharacterDisplayStats(character, level, PROGRESSION_BALANCE.maxLevel);
        const next = resolveCharacterDisplayStats(character, nextLevel, PROGRESSION_BALANCE.maxLevel);
        setLabelString(this._inspectorName, character.name);
        setLabelString(this._inspectorLevel, `LV.${level}`);
        const currentValues = [current.stamina, current.technique, current.burst];
        const nextValues = [next.stamina, next.technique, next.burst];
        for (let index = 0; index < this._inspectorCurrentStats.length; index++) {
            setLabelString(this._inspectorCurrentStats[index], `${currentValues[index]}`);
            setLabelString(this._inspectorNextStats[index], `${nextValues[index]}`);
        }
        setLabelString(this._inspectorSkillName, character.skillName);
        setLabelString(this._inspectorSkillDescription, character.skillDescription);
        setLabelString(this._mechanismMilestone, level >= 30 ? '机制强化 III'
            : level >= 20 ? '机制强化 II · 下次 Lv.30'
                : level >= 10 ? '机制强化 I · 下次 Lv.20'
                    : '机制强化 · Lv.10');
        const atMax = level >= PROGRESSION_BALANCE.maxLevel;
        const cost = atMax ? 0 : progression.coinCostForNextLevel(character.id);
        const gemCost = atMax ? 0 : progression.gemCostForNextLevel(character.id);
        const breakthrough = gemCost > 0;
        const affordable = !atMax && PlayerData.coins >= cost && PlayerData.breakthroughGems >= gemCost;
        setNodeActive(this._upgradeGemIcon, breakthrough);
        setNodeActive(this._upgradeGemCost?.node ?? null, breakthrough);
        if (this._upgradeCoinIcon?.isValid) this._upgradeCoinIcon.setPosition(breakthrough ? -132 : -106.5, 0, 2);
        setLabelLayout(this._upgradeCost, breakthrough ? -84 : -30.5, breakthrough ? 56 : 78, breakthrough ? 20 : 22);
        setLabelLayout(this._upgradeGemCost, -7, 30, 20);
        setLabelLayout(this._upgradeAction, breakthrough ? 76 : 68, breakthrough ? 110 : 90, 24);
        setLabelString(this._upgradeCost, atMax ? '—' : `${cost}`);
        setLabelString(this._upgradeGemCost, breakthrough ? `${gemCost}` : '');
        setLabelString(this._upgradeAction, atMax ? '已满级' : breakthrough
            ? PlayerData.breakthroughGems < gemCost ? '去补给站' : '突破' : '升级');
        setLabelColor(this._upgradeCost, PlayerData.coins >= cost || atMax ? DARK_TEXT : uiColor(214, 52, 52));
        setLabelColor(this._upgradeGemCost, PlayerData.breakthroughGems >= gemCost ? DARK_TEXT : uiColor(214, 52, 52));
        setButtonInteractable(this._upgradeButton, !atMax && !this._upgradePending);
    }

    private async upgradeDraftCharacter(): Promise<void> {
        if (this._leaving || this._upgradePending || !this._draftCharacterId) return;
        const characterId = this._draftCharacterId;
        const progression = getProgressionManager();
        const level = progression.getCharacterLevel(characterId);
        if (level >= PROGRESSION_BALANCE.maxLevel) return;
        const cost = progression.coinCostForNextLevel(characterId);
        const gemCost = progression.gemCostForNextLevel(characterId);
        if (gemCost > 0 && PlayerData.breakthroughGems < gemCost) {
            this._callbacks.onOpenShop?.();
            return;
        }
        if (PlayerData.coins < cost) {
            showToast(this._canvasNode, '金币不足');
            return;
        }
        this._upgradePending = true;
        setButtonInteractable(this._upgradeButton, false);
        try {
            const result = await progression.spendForLevel(characterId);
            if (this._root?.isValid) showToast(this._canvasNode, result.levelsGained > 0
                ? `${gemCost > 0 ? '突破' : '升级'}成功 · Lv.${progression.getCharacterLevel(characterId)}`
                : result.reason === 'maxed' ? '角色已满级'
                    : result.reason === 'insufficient_gems' ? '突破宝石不足'
                        : '金币不足');
        } catch { if (this._root?.isValid) showToast(this._canvasNode, '保存失败，请重试'); }
        finally {
            this._upgradePending = false;
            if (this._root?.isValid) { this.refreshCharacterCard(characterId); this.refreshCharacterInspector(); }
        }
    }

    private buildAppearanceContent(parent: Node): void {
        this._skinRow = makeUiNode('SkinToneRow', parent);
        this._skinRow.getComponent(UITransform)!.setContentSize(316, 105);
        this._skinRow.setPosition(-14.5, 84, 1);
        makeRaceTextureSprite('SkinSectionHeader', this._skinRow, RESOURCE_PATHS.characterUi.skillHeader, 316, 28, 0, 33, 1);
        const skinLabel = makeBoundLabel('SkinLabel', this._skinRow, '肤色', 21, DARK_TEXT, 70, 30, -92, 33, Label.HorizontalAlign.LEFT);
        stylePsdRuntimeLabel(skinLabel, 'PingFang SC', false, 27);
        this._skinSwatches = makeUiNode('SkinSwatches', this._skinRow);
        const unavailable = makeBoundLabel('SkinUnavailableNotice', this._skinRow, '该角色无法更换肤色', 15, uiColor(130, 139, 150), 260, 24, 3, -30, Label.HorizontalAlign.LEFT);
        stylePsdRuntimeLabel(unavailable, 'PingFang SC', false, 22);
        this._skinUnavailableNotice = unavailable.node;
        for (let index = 0; index < PLAYER_SKIN_TONES.length; index++) {
            const tone = PLAYER_SKIN_TONES[index];
            this.buildSwatch(this._skinSwatches, tone.id, 'skin', appearanceSwatchPath('skin', tone.id), -104 + index * 70, -30);
        }
        const outfitSection = makeRaceTextureSprite('OutfitSectionHeader', parent, RESOURCE_PATHS.characterUi.skillHeader, 316, 28, -14.5, -3, 1);
        const outfitLabel = makeBoundLabel('OutfitLabel', outfitSection, '配饰', 21, DARK_TEXT, 70, 28, -92, 0, Label.HorizontalAlign.LEFT);
        stylePsdRuntimeLabel(outfitLabel, 'PingFang SC', false, 27);
        // 色块只创建一次；增加配色通过滚动容纳，选择不重建面板或角色。
        const viewHeight = 210;
        const rowPitch = 70;
        const colorsPerRow = 5;
        const columnPitch = 56;
        const contentHeight = Math.max(viewHeight, Math.ceil(PLAYER_COLOR_SCHEMES.length / colorsPerRow) * rowPitch);
        const viewport = makeUiNode('OutfitColorScrollView', parent);
        viewport.getComponent(UITransform)!.setContentSize(302, viewHeight);
        viewport.setPosition(-14.5, -132, 1);
        viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        const scrollView = viewport.addComponent(ScrollView);
        scrollView.horizontal = false;
        scrollView.vertical = true;
        scrollView.cancelInnerEvents = true;
        const content = makeUiNode('OutfitColorContent', viewport);
        content.getComponent(UITransform)!.setContentSize(302, contentHeight);
        content.setPosition(0, (viewHeight - contentHeight) / 2, 0);
        scrollView.content = content;
        for (let index = 0; index < PLAYER_COLOR_SCHEMES.length; index++) {
            const scheme = PLAYER_COLOR_SCHEMES[index];
            const column = index % colorsPerRow;
            const row = Math.floor(index / colorsPerRow);
            const x = (column - (colorsPerRow - 1) / 2) * columnPitch;
            const y = contentHeight / 2 - 34 - row * rowPitch;
            this.buildSwatch(content, scheme.id, 'color', appearanceSwatchPath('color', scheme.id), x, y, scheme.suit);
        }
        this.refreshAppearanceSupport();
        this.refreshAppearanceSwatches();
    }

    private buildSwatch(parent: Node, id: string, group: 'skin' | 'color', texturePath: string | null, x: number, y: number, color?: readonly [number, number, number]): void {
        const node = makeUiNode(`Swatch_${group}_${id}`, parent);
        node.getComponent(UITransform)!.setContentSize(SWATCH_SIZE, SWATCH_SIZE);
        node.setPosition(x, y, 1);
        const selectionGraphics = node.addComponent(Graphics);
        if (texturePath) {
            makeRaceTextureSprite('Artwork', node, texturePath, SWATCH_ART_SIZE, SWATCH_ART_SIZE, 0, 0, 1);
        } else if (color) {
            // 简单色块在挂载时绘制一次；不新增贴图，也不在选择时重绘底色。
            const artwork = makeUiNode('Artwork', node);
            artwork.setPosition(0, 0, 1);
            const fill = artwork.addComponent(Graphics);
            fill.fillColor = uiColor(color[0], color[1], color[2]);
            fill.roundRect(-SWATCH_ART_SIZE / 2, -SWATCH_ART_SIZE / 2, SWATCH_ART_SIZE, SWATCH_ART_SIZE, 8);
            fill.fill();
        }
        const button = node.addComponent(Button);
        button.target = node;
        button.transition = Button.Transition.NONE;
        const view: SwatchView = { id, group, selectionGraphics, selected: false };
        this._swatches.push(view);
        drawSwatch(view);
        node.on(Button.EventType.CLICK, () => this.selectAppearance(view));
    }

    private selectAppearance(view: SwatchView): void {
        if (view.group === 'skin') {
            const character = this._draftCharacterId ? findPlayerCharacter(this._draftCharacterId) : null;
            if (character?.supportsSkinTone === false || selectedPlayerSkinTone(this._draftCharacterId ?? undefined).id === view.id) return;
            setPlayerSkinTone(view.id as (typeof PLAYER_SKIN_TONES)[number]['id'], this._draftCharacterId ?? undefined);
        } else {
            if (selectedPlayerColorScheme().id === view.id) return;
            setPlayerColorScheme(view.id);
        }
        this._preview?.applyAppearance();
        this.refreshAppearanceSwatches();
    }

    private refreshAppearanceSupport(): void {
        const character = this._draftCharacterId ? findPlayerCharacter(this._draftCharacterId) : null;
        const supported = character?.supportsSkinTone !== false;
        setNodeActive(this._skinSwatches, supported);
        setNodeActive(this._skinUnavailableNotice, !supported);
    }

    private refreshAppearanceSwatches(): void {
        const skinId = selectedPlayerSkinTone(this._draftCharacterId ?? undefined).id;
        const colorId = selectedPlayerColorScheme().id;
        for (const swatch of this._swatches) {
            const selected = swatch.group === 'skin' ? swatch.id === skinId : swatch.id === colorId;
            if (swatch.selected === selected) continue;
            swatch.selected = selected;
            drawSwatch(swatch);
        }
    }

    private confirmDraftCharacter(): void {
        if (this._leaving || !this._draftCharacterId) return;
        if (getPlayerCharacterSelection().characterId !== this._draftCharacterId) selectPlayerCharacter(this._draftCharacterId);
        void PlayerData.setCharacterSelection(getPlayerCharacterSelection()).catch((error) => {
            console.warn('[PrepareRaceFlow] character selection save failed', error);
        });
        this.leaveCurrentScreen(() => this.showReadyScreen());
    }

    private buildPreviewPresentation(parent: Node): void {
        const previewX = this._view === 'ready' ? -174 : -45;
        const rotateArea = makeUiNode('CharacterRotateArea', parent);
        this._previewRotateArea = rotateArea;
        rotateArea.getComponent(UITransform)!.setContentSize(400, 470);
        rotateArea.setPosition(previewX, -4, 2);
        rotateArea.on(Node.EventType.TOUCH_START, (event: EventTouch) => this.beginPreviewRotation(event));
        rotateArea.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => this.updatePreviewRotation(event));
        rotateArea.on(Node.EventType.TOUCH_END, (event: EventTouch) => this.endPreviewRotation(event));
        rotateArea.on(Node.EventType.TOUCH_CANCEL, (event: EventTouch) => this.endPreviewRotation(event));
    }

    private layoutPresentation(): void {
        if (!this._root?.isValid) return;
        const size = view.getVisibleSize();
        const scale = Math.max(size.width / 1280, size.height / 720);
        const lobby = this._view === 'ready';
        if (this._lobbyBackgroundImage?.isValid) {
            fitFullScreenBackgroundCover(this._lobbyBackgroundImage);
            // 宽屏裁切以展示台接触线为焦点，避免背景缩放把台面压到角色脚下方。
            const y = lobby ? 240 * (scale - 1) : 0;
            if (this._lobbyBackgroundImage.position.y !== y) this._lobbyBackgroundImage.setPosition(0, y, 1);
        }
        if (this._readyManageButton?.isValid) {
            const x = -190.5 * scale;
            if (this._readyManageButton.position.x !== x) this._readyManageButton.setPosition(x, -275, 3);
        }
        if (this._previewRotateArea?.isValid) {
            const x = lobby ? -174 * scale : -45;
            if (this._previewRotateArea.position.x !== x) this._previewRotateArea.setPosition(x, -4, 2);
        }
        this._preview?.setHallOffset(lobby);
    }

    private presentCharacter(characterId: PlayerCharacterId | null): void {
        if (!characterId || !this._visible) return;
        this.ensurePreview();
        // Both non-race views use the authored platform lighting only; the former
        // extra render-texture contact shadow is deliberately disabled.
        this._preview?.setLobbyPresentation(true, false);
        this._preview?.setHallOffset(this._view === 'ready');
        setNodeActive(this._previewRoot, !this._eventPageActive);
        this._preview?.setRenderingEnabled(!this._eventPageActive && !this._modalOverlayActive);
        this._preview?.refresh(characterId);
    }

    private ensurePreview(): void {
        if (this._previewRoot?.isValid) return;
        const root = new Node('PrepareRacePreviewWorld');
        root.setParent(this._parent.scene!);
        this._previewRoot = root;
        this._preview = root.addComponent(PrepareRaceCharacterPreview);
    }

    private beginPreviewRotation(event: EventTouch): void {
        if (!this._leaving && this._previewRotateTouchId === null) this._previewRotateTouchId = event.getID();
    }

    private updatePreviewRotation(event: EventTouch): void {
        if (event.getID() !== this._previewRotateTouchId) return;
        const deltaX = event.getDeltaX();
        if (Number.isFinite(deltaX) && Math.abs(deltaX) > 0.01) this._preview?.rotateBy(deltaX * 0.55);
    }

    private endPreviewRotation(event: EventTouch): void {
        if (event.getID() === this._previewRotateTouchId) this._previewRotateTouchId = null;
    }
}

export type SecondaryPageHeaderView = {
    backNode: Node;
    backButton: Button;
    titleLabel: Label;
};

/** Shared authored header for character management and other full-screen secondary pages. */
export function buildSecondaryPageHeader(
    parent: Node,
    prefix: string,
    titleText: string,
    onBack: () => void,
): SecondaryPageHeaderView {
    makeRaceTextureSprite(`${prefix}HeaderBackground`, parent, RESOURCE_PATHS.characterUi.headerBackground,
        497, 111, -391.5, 304.5, 1);

    const backNode = makeUiNode(`${prefix}BackButton`, parent);
    backNode.getComponent(UITransform)!.setContentSize(76, 60);
    backNode.setPosition(-582.5, 321, 3);
    makeRaceTextureSprite('Artwork', backNode, RESOURCE_PATHS.characterUi.backIcon, 61, 40, 0, 0, 1);
    const backButton = backNode.addComponent(Button);
    backButton.target = backNode;
    backButton.transition = Button.Transition.SCALE;
    backButton.zoomScale = 0.97;
    backButton.duration = 0.08;
    backNode.on(Button.EventType.CLICK, onBack);

    const titleLabel = makeBoundLabel(`${prefix}ScreenTitle`, parent, titleText,
        36, DARK_TEXT, 180, 48, -445, 323.5, Label.HorizontalAlign.LEFT);
    stylePsdTitleLabel(titleLabel, 44);
    return { backNode, backButton, titleLabel };
}

function makeBoundLabel(
    name: string,
    parent: Node,
    text: string,
    fontSize: number,
    color: Color,
    width: number,
    height: number,
    x: number,
    y: number,
    align = Label.HorizontalAlign.CENTER,
): Label {
    const node = makeLabel(name, parent, text, fontSize, color);
    node.getComponent(UITransform)!.setContentSize(width, height);
    node.setPosition(x, y, 1);
    const label = node.getComponent(Label)!;
    label.horizontalAlign = align;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.CLAMP;
    return label;
}

function drawSwatch(view: SwatchView): void {
    const gfx = view.selectionGraphics;
    if (!gfx?.isValid) return;
    const half = SWATCH_SIZE / 2;
    gfx.clear();
    if (!view.selected) return;
    gfx.fillColor = DARK_TEXT;
    gfx.roundRect(-half, -half, SWATCH_SIZE, SWATCH_SIZE, 12);
    gfx.fill();
    gfx.fillColor = WHITE;
    gfx.roundRect(-half + 4, -half + 4, SWATCH_SIZE - 8, SWATCH_SIZE - 8, 9);
    gfx.fill();
}

function appearanceSwatchPath(group: 'skin' | 'color', id: string): string | null {
    if (group === 'skin') {
        return id === 'deep' ? RESOURCE_PATHS.characterUi.skinDeep : RESOURCE_PATHS.characterUi.skinWarm;
    }
    switch (id) {
        case 'blue': return RESOURCE_PATHS.characterUi.swatchBlue;
        case 'yellow': return RESOURCE_PATHS.characterUi.swatchYellow;
        case 'purple': return RESOURCE_PATHS.characterUi.swatchPurple;
        case 'green': return RESOURCE_PATHS.characterUi.swatchGreen;
        case 'orange': return RESOURCE_PATHS.characterUi.swatchOrange;
        case 'cyan': return RESOURCE_PATHS.characterUi.swatchCyan;
        case 'black': return RESOURCE_PATHS.characterUi.swatchBlack;
        case 'red': return RESOURCE_PATHS.characterUi.swatchRed;
        case 'soft-lilac': return RESOURCE_PATHS.characterUi.swatchSoftLilac;
        case 'lime': return RESOURCE_PATHS.characterUi.swatchLime;
        case 'lake-teal': return RESOURCE_PATHS.characterUi.swatchLakeTeal;
        case 'deep-ocean': return RESOURCE_PATHS.characterUi.swatchDeepOcean;
        case 'cherry-red': return RESOURCE_PATHS.characterUi.swatchCherryRed;
        case 'strawberry-pink': return RESOURCE_PATHS.characterUi.swatchStrawberryPink;
        default: return null;
    }
}

function raceDifficultyTitle(difficulty: RaceModeId): string {
    return getRaceModeTitle(difficulty);
}

function raceDifficultyDistance(difficulty: RaceModeId): string {
    return `${getRaceDistance(difficulty)}米`;
}

function stylePsdRuntimeLabel(label: Label, fontFamily: string, bold: boolean, lineHeight: number): void {
    void fontFamily;
    styleProjectUiLabel(label, bold ? 'semibold' : 'regular', lineHeight);
}

function stylePsdTitleLabel(label: Label, lineHeight: number): void {
    styleProjectUiLabel(label, 'semibold', lineHeight);
}

function makeRaceTextureSprite(
    name: string,
    parent: Node,
    path: string,
    width: number,
    height: number,
    x: number,
    y: number,
    z: number,
): Node {
    const node = makeUiNode(name, parent);
    node.getComponent(UITransform)!.setContentSize(width, height);
    node.setPosition(x, y, z);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.trim = false;
    let ownedFrame: SpriteFrame | null = null;
    node.once(Node.EventType.NODE_DESTROYED, () => { ownedFrame?.destroy(); ownedFrame = null; });
    loadRaceAsset(path, Texture2D, (error, texture) => {
        if (error || !texture || !node.isValid || !sprite.isValid) {
            if (error) console.warn(`[SpeedSwimming] lobby texture failed to load: ${path}`, error);
            return;
        }
        const frame = new SpriteFrame();
        frame.texture = texture;
        ownedFrame = frame;
        sprite.spriteFrame = frame;
    });
    return node;
}

function makeRaceTextureRegionSprite(
    name: string,
    parent: Node,
    path: string,
    region: Rect,
    width: number,
    height: number,
    x: number,
    y: number,
    z: number,
): Node {
    const node = makeUiNode(name, parent);
    node.getComponent(UITransform)!.setContentSize(width, height);
    node.setPosition(x, y, z);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.trim = false;
    loadRaceAsset(path, Texture2D, (error, texture) => {
        if (error || !texture || !node.isValid || !sprite.isValid) {
            if (error) console.warn(`[SpeedSwimming] lobby texture region failed to load: ${path}`, error);
            return;
        }
        const frame = new SpriteFrame();
        frame.reset({
            texture,
            rect: region,
            originalSize: new Size(region.width, region.height),
        });
        sprite.spriteFrame = frame;
    });
    return node;
}

function makeRaceTextureButton(
    name: string,
    parent: Node,
    path: string,
    width: number,
    height: number,
    x: number,
    y: number,
    z: number,
): Node {
    const node = makeRaceTextureSprite(name, parent, path, width, height, x, y, z);
    const button = node.addComponent(Button);
    button.target = node;
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.97;
    button.duration = 0.08;
    return node;
}

function setLabelString(label: Label | null, value: string): void {
    if (label?.isValid && label.string !== value) label.string = value;
}

function setLabelColor(label: Label | null, color: Color): void {
    if (label?.isValid && !sameColor(label.color, color)) label.color = color;
}

function setLabelLayout(label: Label | null, x: number, width: number, fontSize: number): void {
    if (!label?.isValid) return;
    if (label.node.position.x !== x || label.node.position.y !== 0) {
        label.node.setPosition(x, 0, label.node.position.z);
    }
    const transform = label.node.getComponent(UITransform);
    if (transform && transform.contentSize.width !== width) transform.setContentSize(width, transform.contentSize.height);
    if (label.fontSize !== fontSize) label.fontSize = fontSize;
}

function setNodeActive(node: Node | null, active: boolean): void {
    if (node?.isValid && node.active !== active) node.active = active;
}

function setButtonInteractable(button: Button | null, interactable: boolean): void {
    if (button?.isValid && button.interactable !== interactable) button.interactable = interactable;
}

function sameColor(a: Color, b: Color): boolean {
    return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}
