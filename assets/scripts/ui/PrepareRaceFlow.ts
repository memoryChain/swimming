import {
    Button,
    CacheMode,
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
} from 'cc';
import { RaceDifficulty, RACE_DIFFICULTY_OPTIONS, setRaceDifficulty } from '../core/GameBalance';
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
import { fitFullScreenBackgroundCover, makeLabel, makeRect, makeRoundedRect, makeUiNode, uiColor } from './RuntimeUiFactory';
import { UI_STYLE } from './UIStyle';
import { PlayerData } from '../backend/PlayerData';
import type { PlayerProfile } from '../backend/PlayerProfile';
import { showToast } from './Toast';

export type PrepareRaceFlowCallbacks = {
    onStartRace: () => void;
    onOpenRoom: () => void;
    onCharacterManagementChanged?: (active: boolean) => void;
};

type PrepareRaceView = 'ready' | 'characters';
type CharacterInspectorTab = 'attributes' | 'appearance';

type RaceModeCardView = {
    id: RaceDifficulty;
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
const CHARACTER_CARD_WIDTH = 171;
const CHARACTER_CARD_HEIGHT = 202;
const CHARACTER_CARD_X_PITCH = 170;
const CHARACTER_CARD_Y_PITCH = 200;
const CHARACTER_LIST_VIEW_WIDTH = 342;
const CHARACTER_LIST_VIEW_HEIGHT = 562;
const CHARACTER_LIST_CONTENT_HEIGHT = 602;
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
    private _preview: PrepareRaceCharacterPreview | null = null;
    private _view: PrepareRaceView = 'ready';
    private _draftCharacterId: PlayerCharacterId | null = null;
    private _activeInspectorTab: CharacterInspectorTab = 'attributes';
    private _previewRotateTouchId: number | null = null;
    private _upgradePending = false;

    private readonly _raceModeCards: RaceModeCardView[] = [];
    private readonly _characterCards: CharacterCardView[] = [];
    private readonly _tabs: TabView[] = [];
    private readonly _swatches: SwatchView[] = [];

    private _readyName: Label | null = null;
    private _readyLevel: Label | null = null;
    private _readyStats: Label[] = [];
    private _readySkillName: Label | null = null;
    private _readySkillDescription: Label | null = null;
    private _inspectorName: Label | null = null;
    private _inspectorLevel: Label | null = null;
    private _inspectorCurrentStats: Label[] = [];
    private _inspectorNextStats: Label[] = [];
    private _inspectorSkillName: Label | null = null;
    private _inspectorSkillDescription: Label | null = null;
    private _upgradeButton: Button | null = null;
    private _upgradeCost: Label | null = null;
    private _upgradeAction: Label | null = null;
    private _attributeContent: Node | null = null;
    private _appearanceContent: Node | null = null;
    private _skinRow: Node | null = null;
    private _attributeTabArtwork: Node | null = null;
    private _appearanceTabArtwork: Node | null = null;
    private _confirmCharacterButton: Node | null = null;
    private _activeCharacterNotice: Node | null = null;

    private readonly _onProfileChange = (_profile: PlayerProfile): void => {
        if (!this._root?.isValid || !this._content?.isValid) return;
        if (this._view === 'ready') {
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
        this.ensureRoot();
        this._view = 'ready';
        this._draftCharacterId = null;
        setNodeActive(this._lobbyBackgroundImage, true);
        this.replaceContent('PrepareRaceReadyContent');
        this.buildReadyScreen(this._content!);
        this.presentCharacter(getPlayerCharacterSelection().characterId);
        this._callbacks.onCharacterManagementChanged?.(false);
    }

    showCharacterManagement(): void {
        this.ensureRoot();
        this._view = 'characters';
        this._draftCharacterId = getPlayerCharacterSelection().characterId;
        this._activeInspectorTab = 'attributes';
        setNodeActive(this._lobbyBackgroundImage, false);
        this.replaceContent('PrepareRaceCharacterManagementContent');
        this.buildCharacterManagement(this._content!);
        this.presentCharacter(this._draftCharacterId);
        this._callbacks.onCharacterManagementChanged?.(true);
    }

    dispose(): void {
        PlayerData.offChange(this._onProfileChange);
        this._previewRoot?.destroy();
        this._previewRoot = null;
        this._preview = null;
        this._root?.destroy();
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
    }

    private replaceContent(name: string): void {
        this._content?.destroy();
        this.resetViewReferences();
        this._content = makeUiNode(name, this._root!);
        this._content.getComponent(UITransform)!.setContentSize(this._width, this._height);
    }

    private resetViewReferences(): void {
        this._previewRotateTouchId = null;
        this._raceModeCards.length = 0;
        this._characterCards.length = 0;
        this._tabs.length = 0;
        this._swatches.length = 0;
        this._readyName = null;
        this._readyLevel = null;
        this._readyStats = [];
        this._readySkillName = null;
        this._readySkillDescription = null;
        this._inspectorName = null;
        this._inspectorLevel = null;
        this._inspectorCurrentStats = [];
        this._inspectorNextStats = [];
        this._inspectorSkillName = null;
        this._inspectorSkillDescription = null;
        this._upgradeButton = null;
        this._upgradeCost = null;
        this._upgradeAction = null;
        this._attributeContent = null;
        this._appearanceContent = null;
        this._skinRow = null;
        this._attributeTabArtwork = null;
        this._appearanceTabArtwork = null;
        this._confirmCharacterButton = null;
        this._activeCharacterNotice = null;
    }

    private buildBackground(root: Node): void {
        const fallback = makeRect('PrepareRaceBackdrop', root, this._width, this._height, uiColor(4, 20, 42));
        fitFullScreenBackgroundCover(fallback);
        const image = makeUiNode('PrepareRaceBackgroundImage', root);
        image.setPosition(0, 0, 1);
        fitFullScreenBackgroundCover(image);
        this._lobbyBackgroundImage = image;
        loadRaceAsset(RESOURCE_PATHS.lobbyUi.background, Texture2D, (error, texture) => {
            if (error || !texture || !image.isValid) {
                console.warn('[SpeedSwimming] prepare-race background texture failed to load', error);
                return;
            }
            const frame = new SpriteFrame();
            frame.texture = texture;
            const sprite = image.addComponent(Sprite);
            sprite.spriteFrame = frame;
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            fallback.destroy();
        });
    }

    private buildReadyScreen(parent: Node): void {
        this.buildReadyCharacterPanel(parent);
        this.buildPreviewPresentation(parent);
        this.buildRaceModeList(parent);
        this.buildReadyActions(parent);
        this.refreshReadyCharacterInfo();
    }

    private buildReadyCharacterPanel(parent: Node): void {
        makeRaceTextureSprite('ReadyCharacterPanel', parent, RESOURCE_PATHS.lobbyUi.characterPanel, 338, 244, -454, 95, 2);
        this._readyName = makeBoundLabel('CharacterName', parent, '', 28, DARK_TEXT, 188, 38, -484, 162, Label.HorizontalAlign.LEFT);
        stylePsdTitleLabel(this._readyName, 36);
        this._readyLevel = makeBoundLabel('CharacterLevel', parent, '', 16, WHITE, 64, 28, -335, 165);
        stylePsdRuntimeLabel(this._readyLevel, 'Arial Black', true, 22);

        const statNames = ['体力', '技巧', '爆发'];
        const statY = [107, 62, 17];
        for (let index = 0; index < statNames.length; index++) {
            const statName = makeBoundLabel(`StatName${index}`, parent, statNames[index], 18, uiColor(31, 43, 62), 92, 28, -488, statY[index], Label.HorizontalAlign.LEFT);
            stylePsdTitleLabel(statName, 24);
            const statValue = makeBoundLabel(`StatValue${index}`, parent, '', 19, uiColor(31, 43, 62), 82, 28, -357, statY[index], Label.HorizontalAlign.RIGHT);
            stylePsdRuntimeLabel(statValue, 'Arial Black', true, 24);
            this._readyStats.push(statValue);
        }

        makeRaceTextureSprite('ReadySkillCard', parent, RESOURCE_PATHS.lobbyUi.skillCard, 320, 145, -445, -98.5, 2);
        const skillHeading = makeBoundLabel('SkillHeading', parent, 'SKILL', 16, DARK_TEXT, 70, 24, -545, -42);
        stylePsdRuntimeLabel(skillHeading, 'Arial Black', true, 21);
        this._readySkillName = makeBoundLabel('SkillName', parent, '', 20, DARK_TEXT, 190, 28, -405, -90, Label.HorizontalAlign.LEFT);
        stylePsdTitleLabel(this._readySkillName, 27);
        this._readySkillDescription = makeBoundLabel('SkillDescription', parent, '', 14, uiColor(72, 82, 98), 190, 42, -405, -126, Label.HorizontalAlign.LEFT);
        stylePsdRuntimeLabel(this._readySkillDescription, 'PingFang SC', false, 20);
        this._readySkillDescription.overflow = Label.Overflow.CLAMP;
        this._readySkillDescription.enableWrapText = true;

        const manage = makeRaceTextureButton('MyCharactersButton', parent, RESOURCE_PATHS.lobbyUi.characterButton, 312, 70, -446, -220, 3);
        const manageLabel = makeBoundLabel('Label', manage, '角色养成', 24, DARK_TEXT, 150, 36, -8, 0);
        stylePsdTitleLabel(manageLabel, 32);
        manage.on(Button.EventType.CLICK, () => this.showCharacterManagement());
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
        setLabelString(this._readySkillName, character.skillName);
        setLabelString(this._readySkillDescription, character.skillDescription);
    }

    private buildRaceModeList(parent: Node): void {
        const selected = getSelectedRaceDifficulty();
        for (let index = 0; index < RACE_DIFFICULTY_OPTIONS.length; index++) {
            const option = RACE_DIFFICULTY_OPTIONS[index];
            const card = makeUiNode(`RaceMode_${option.id}`, parent);
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
            const view: RaceModeCardView = { id: option.id, root: card, selectedFrame, selected: option.id === selected };
            this._raceModeCards.push(view);
            this.applyRaceModeCardSelection(view);
            card.on(Button.EventType.CLICK, () => this.selectRaceDifficulty(option.id));
        }
        this.layoutRaceModeCards();
    }

    private selectRaceDifficulty(difficulty: RaceDifficulty): void {
        if (getSelectedRaceDifficulty() === difficulty) return;
        setSelectedRaceDifficulty(difficulty);
        for (const card of this._raceModeCards) {
            const selected = card.id === difficulty;
            if (card.selected === selected) continue;
            card.selected = selected;
            this.applyRaceModeCardSelection(card);
        }
        this.layoutRaceModeCards();
    }

    private applyRaceModeCardSelection(card: RaceModeCardView): void {
        const scale = card.selected ? 1 : RACE_MODE_CARD_UNSELECTED_SCALE;
        const x = card.selected ? 408 : 447;
        if (card.root.scale.x !== scale || card.root.scale.y !== scale) card.root.setScale(scale, scale, card.root.scale.z);
        if (card.root.position.x !== x) card.root.setPosition(x, card.root.position.y, card.root.position.z);
        setNodeActive(card.selectedFrame, card.selected);
    }

    private layoutRaceModeCards(): void {
        let topY = RACE_MODE_STACK_TOP_Y;
        for (const card of this._raceModeCards) {
            const scale = card.selected ? 1 : RACE_MODE_CARD_UNSELECTED_SCALE;
            const visibleHeight = RACE_MODE_CARD_VISIBLE_HEIGHT * scale;
            const y = topY - visibleHeight / 2;
            if (card.root.position.y !== y) card.root.setPosition(card.root.position.x, y, card.root.position.z);
            topY = y - visibleHeight / 2 - RACE_MODE_CARD_GAP;
        }
    }

    private buildReadyActions(parent: Node): void {
        const room = makeRaceTextureButton('FriendRoomButton', parent, RESOURCE_PATHS.lobbyUi.onlineButton, 102, 102, 236, -287, 3);
        const roomLabel = makeBoundLabel('Label', room, '联机', 18, DARK_TEXT, 64, 26, 0, -9);
        stylePsdRuntimeLabel(roomLabel, 'PingFang SC', true, 24);
        room.on(Button.EventType.CLICK, () => this._callbacks.onOpenRoom());

        const start = makeRaceTextureButton('StartRaceButton', parent, RESOURCE_PATHS.characterUi.confirmButton, 332, 102, 448, -287, 3);
        const startLabel = makeBoundLabel('Label', start, '开始比赛', 38, DARK_TEXT, 220, 54, -4, 0);
        stylePsdTitleLabel(startLabel, 48);
        start.on(Button.EventType.CLICK, () => {
            setRaceDifficulty(getSelectedRaceDifficulty());
            this._callbacks.onStartRace();
        });
    }

    private buildCharacterManagement(parent: Node): void {
        makeRaceTextureSprite('CharacterScreenBackground', parent, RESOURCE_PATHS.characterUi.background, this._width, this._height, 0, 0, 0);
        this.buildCharacterHeader(parent);
        this.buildCharacterRoster(parent);
        this.buildPreviewPresentation(parent);
        this.buildCharacterInspector(parent);
        this.refreshCharacterCards();
        this.refreshCharacterInspector();
        this.selectInspectorTab('attributes', true);
    }

    private buildCharacterHeader(parent: Node): void {
        makeRaceTextureSprite('CharacterHeaderBackground', parent, RESOURCE_PATHS.characterUi.headerBackground, 497, 111, -391.5, 304.5, 1);

        // Keep the larger touch target separate from the PSD-sized artwork. Changing
        // the parent's UITransform previously scaled the icon from 61×40 to 76×60.
        const backHit = makeUiNode('CharacterBackButton', parent);
        backHit.getComponent(UITransform)!.setContentSize(76, 60);
        backHit.setPosition(-582.5, 321, 3);
        makeRaceTextureSprite('Artwork', backHit, RESOURCE_PATHS.characterUi.backIcon, 61, 40, 0, 0, 1);
        const backButton = backHit.addComponent(Button);
        backButton.target = backHit;
        backButton.transition = Button.Transition.SCALE;
        backButton.zoomScale = 0.97;
        backButton.duration = 0.08;
        backHit.on(Button.EventType.CLICK, () => this.showReadyScreen());

        // The label position is its bounding-box centre. Keep the visible title at
        // the PSD x=105 edge instead of centring that box on the glyph midpoint.
        const title = makeBoundLabel('CharacterScreenTitle', parent, '角色', 36, DARK_TEXT, 120, 48, -475, 323.5, Label.HorizontalAlign.LEFT);
        stylePsdTitleLabel(title, 44);
    }

    private buildCharacterRoster(parent: Node): void {
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
        content.getComponent(UITransform)!.setContentSize(CHARACTER_LIST_VIEW_WIDTH, CHARACTER_LIST_CONTENT_HEIGHT);
        content.setPosition(0, -20, 0);
        scrollView.content = content;

        const slotCount = Math.max(PROTOTYPE_CHARACTER_SLOT_COUNT, PLAYER_CHARACTER_DEFINITIONS.length);
        for (let index = 0; index < slotCount; index++) {
            this.buildCharacterCard(content, PLAYER_CHARACTER_DEFINITIONS[index] ?? null, index);
        }
    }

    private buildCharacterCard(parent: Node, character: PlayerCharacterDefinition | null, index: number): void {
        const column = index % 2;
        const row = Math.floor(index / 2);
        const card = makeUiNode(`CharacterSlot${index}`, parent);
        card.getComponent(UITransform)!.setContentSize(CHARACTER_CARD_WIDTH, CHARACTER_CARD_HEIGHT);
        card.setPosition(-84.5 + column * CHARACTER_CARD_X_PITCH, 200 - row * CHARACTER_CARD_Y_PITCH, 1);

        const portraitPath = index % 2 === 0 ? RESOURCE_PATHS.characterUi.portraitBlue : RESOURCE_PATHS.characterUi.portraitRed;
        makeRaceTextureSprite('Portrait', card, portraitPath, 160, 190, 0.5, 0, 1);

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
        this._appearanceContent.setPosition(0, 0, 2);
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
        const names = ['体力', '技巧', '爆发'];
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
        makeRaceTextureSprite('SkillHeader', parent, RESOURCE_PATHS.characterUi.skillHeader, 316, 28, -14.5, -53, 1);
        const skillHeading = makeBoundLabel('SkillHeading', parent, 'SKILL', 16, DARK_TEXT, 76, 24, -119.5, -53, Label.HorizontalAlign.LEFT);
        stylePsdRuntimeLabel(skillHeading, 'Arial Black', true, 20);
        // Reuse the lobby skill-card texture region so both screens always show
        // the identical icon and dark circular frame without a duplicate asset.
        makeRaceTextureRegionSprite('SkillIcon', parent, RESOURCE_PATHS.lobbyUi.skillCard, new Rect(20, 49, 71, 71), 70, 70, -118.5, -122, 2);
        this._inspectorSkillName = makeBoundLabel('SkillName', parent, '', 20, DARK_TEXT, 190, 28, 25.5, -102, Label.HorizontalAlign.LEFT);
        stylePsdTitleLabel(this._inspectorSkillName, 27);
        this._inspectorSkillDescription = makeBoundLabel('SkillDescription', parent, '', 16, uiColor(72, 82, 98), 190, 34, 25.5, -135, Label.HorizontalAlign.LEFT);
        stylePsdRuntimeLabel(this._inspectorSkillDescription, 'PingFang SC', false, 20);
        this._inspectorSkillDescription.enableWrapText = true;

        const upgrade = makeRaceTextureButton('UpgradeButton', parent, RESOURCE_PATHS.characterUi.upgradeButton, 313, 70, -16, -195, 2);
        this._upgradeButton = upgrade.getComponent(Button)!;
        makeRaceTextureSprite('CurrencyIcon', upgrade, RESOURCE_PATHS.characterUi.upgradeCurrency, 36, 36, -106.5, 0, 2);
        this._upgradeCost = makeBoundLabel('Cost', upgrade, '', 22, DARK_TEXT, 78, 30, -30.5, 0, Label.HorizontalAlign.LEFT);
        stylePsdRuntimeLabel(this._upgradeCost, 'Arial Black', true, 28);
        this._upgradeAction = makeBoundLabel('Action', upgrade, '升级', 24, DARK_TEXT, 90, 34, 68, 0);
        stylePsdTitleLabel(this._upgradeAction, 31);
        upgrade.on(Button.EventType.CLICK, () => void this.upgradeDraftCharacter());
    }

    private refreshCharacterInspector(): void {
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
        const atMax = level >= PROGRESSION_BALANCE.maxLevel;
        const cost = atMax ? 0 : progression.coinCostForNextLevel(character.id);
        const affordable = !atMax && PlayerData.coins >= cost;
        setLabelString(this._upgradeCost, atMax ? '—' : `${cost}`);
        setLabelString(this._upgradeAction, atMax ? '已满级' : '升级');
        setLabelColor(this._upgradeCost, affordable || atMax ? DARK_TEXT : uiColor(214, 52, 52));
        setButtonInteractable(this._upgradeButton, !atMax && !this._upgradePending);
    }

    private async upgradeDraftCharacter(): Promise<void> {
        if (this._upgradePending || !this._draftCharacterId) return;
        const characterId = this._draftCharacterId;
        const progression = getProgressionManager();
        const level = progression.getCharacterLevel(characterId);
        if (level >= PROGRESSION_BALANCE.maxLevel) return;
        const cost = progression.coinCostForNextLevel(characterId);
        if (PlayerData.coins < cost) {
            showToast(this._canvasNode, '金币不足');
            return;
        }
        this._upgradePending = true;
        setButtonInteractable(this._upgradeButton, false);
        const result = await progression.spendForLevel(characterId);
        this._upgradePending = false;
        if (!this._root?.isValid) return;
        showToast(this._canvasNode, result.levelsGained > 0 ? `升级成功 · Lv.${progression.getCharacterLevel(characterId)}` : result.reason === 'maxed' ? '角色已满级' : '金币不足');
        this.refreshCharacterCard(characterId);
        this.refreshCharacterInspector();
    }

    private buildAppearanceContent(parent: Node): void {
        this._skinRow = makeUiNode('SkinToneRow', parent);
        this._skinRow.getComponent(UITransform)!.setContentSize(316, 105);
        this._skinRow.setPosition(-14.5, 84, 1);
        makeRaceTextureSprite('SkinSectionHeader', this._skinRow, RESOURCE_PATHS.characterUi.skillHeader, 316, 28, 0, 33, 1);
        const skinLabel = makeBoundLabel('SkinLabel', this._skinRow, '肤色', 21, DARK_TEXT, 70, 30, -92, 33, Label.HorizontalAlign.LEFT);
        stylePsdRuntimeLabel(skinLabel, 'PingFang SC', false, 27);
        for (let index = 0; index < PLAYER_SKIN_TONES.length; index++) {
            const tone = PLAYER_SKIN_TONES[index];
            this.buildSwatch(this._skinRow, tone.id, 'skin', appearanceSwatchPath('skin', tone.id), -104 + index * 70, -30);
        }
        const outfitSection = makeRaceTextureSprite('OutfitSectionHeader', parent, RESOURCE_PATHS.characterUi.skillHeader, 316, 28, -14.5, -3, 1);
        const outfitLabel = makeBoundLabel('OutfitLabel', outfitSection, '配饰', 21, DARK_TEXT, 70, 28, -92, 0, Label.HorizontalAlign.LEFT);
        stylePsdRuntimeLabel(outfitLabel, 'PingFang SC', false, 27);
        for (let index = 0; index < PLAYER_COLOR_SCHEMES.length; index++) {
            const scheme = PLAYER_COLOR_SCHEMES[index];
            const column = index % 4;
            const row = Math.floor(index / 4);
            this.buildSwatch(parent, scheme.id, 'color', appearanceSwatchPath('color', scheme.id), -118.5 + column * 70, -66 - row * 70);
        }
        this.refreshAppearanceSupport();
        this.refreshAppearanceSwatches();
    }

    private buildSwatch(parent: Node, id: string, group: 'skin' | 'color', texturePath: string, x: number, y: number): void {
        const node = makeUiNode(`Swatch_${group}_${id}`, parent);
        node.getComponent(UITransform)!.setContentSize(SWATCH_SIZE, SWATCH_SIZE);
        node.setPosition(x, y, 1);
        const selectionGraphics = node.addComponent(Graphics);
        makeRaceTextureSprite('Artwork', node, texturePath, SWATCH_ART_SIZE, SWATCH_ART_SIZE, 0, 0, 1);
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
        setNodeActive(this._skinRow, character?.supportsSkinTone !== false);
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
        if (!this._draftCharacterId) return;
        if (getPlayerCharacterSelection().characterId !== this._draftCharacterId) selectPlayerCharacter(this._draftCharacterId);
        this.showReadyScreen();
    }

    private buildPreviewPresentation(parent: Node): void {
        const previewX = -45;
        const rotateArea = makeUiNode('CharacterRotateArea', parent);
        rotateArea.getComponent(UITransform)!.setContentSize(400, 470);
        rotateArea.setPosition(previewX, -4, 2);
        rotateArea.on(Node.EventType.TOUCH_START, (event: EventTouch) => this.beginPreviewRotation(event));
        rotateArea.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => this.updatePreviewRotation(event));
        rotateArea.on(Node.EventType.TOUCH_END, (event: EventTouch) => this.endPreviewRotation(event));
        rotateArea.on(Node.EventType.TOUCH_CANCEL, (event: EventTouch) => this.endPreviewRotation(event));
    }

    private presentCharacter(characterId: PlayerCharacterId | null): void {
        if (!characterId) return;
        this.ensurePreview();
        // Both non-race views use the authored platform lighting only; the former
        // extra render-texture contact shadow is deliberately disabled.
        this._preview?.setLobbyPresentation(true, false);
        setNodeActive(this._previewRoot, true);
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
        if (this._previewRotateTouchId === null) this._previewRotateTouchId = event.getID();
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

function appearanceSwatchPath(group: 'skin' | 'color', id: string): string {
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
        default: return RESOURCE_PATHS.characterUi.swatchRed;
    }
}

function raceDifficultyTitle(difficulty: RaceDifficulty): string {
    if (difficulty === 'beginner') return '入门泳道';
    if (difficulty === 'championship') return '超级世锦赛';
    return '竞技泳道';
}

function raceDifficultyDistance(difficulty: RaceDifficulty): string {
    if (difficulty === 'beginner') return '50米';
    if (difficulty === 'championship') return '200米';
    return '100米';
}

function stylePsdRuntimeLabel(label: Label, fontFamily: string, bold: boolean, lineHeight: number): void {
    label.fontFamily = fontFamily;
    label.isBold = bold;
    label.lineHeight = lineHeight;
    label.cacheMode = CacheMode.CHAR;
}

function stylePsdTitleLabel(label: Label, lineHeight: number): void {
    // Use the same editable system-label route as the rest of the UI, but request
    // the semibold face explicitly so Chinese titles do not fall back to regular.
    label.fontFamily = 'PingFangSC-Semibold';
    label.isBold = true;
    label.lineHeight = lineHeight;
    label.cacheMode = CacheMode.CHAR;
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
    loadRaceAsset(path, Texture2D, (error, texture) => {
        if (error || !texture || !node.isValid || !sprite.isValid) {
            if (error) console.warn(`[SpeedSwimming] lobby texture failed to load: ${path}`, error);
            return;
        }
        const frame = new SpriteFrame();
        frame.texture = texture;
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

function setNodeActive(node: Node | null, active: boolean): void {
    if (node?.isValid && node.active !== active) node.active = active;
}

function setButtonInteractable(button: Button | null, interactable: boolean): void {
    if (button?.isValid && button.interactable !== interactable) button.interactable = interactable;
}

function sameColor(a: Color, b: Color): boolean {
    return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}
