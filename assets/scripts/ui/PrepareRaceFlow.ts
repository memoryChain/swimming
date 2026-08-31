import {
    Button,
    Color,
    EventTouch,
    Graphics,
    Label,
    Mask,
    Node,
    ScrollView,
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
import { resolvePlayerBalance } from '../progression/PlayerBalanceOverrides';
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
    background: Graphics;
    name: Label;
    level: Label;
    state: Label;
    draftSelected: boolean;
    committed: boolean;
};

type TabView = {
    id: CharacterInspectorTab;
    background: Graphics;
    label: Label;
    selected: boolean;
};

type SwatchView = {
    id: string;
    group: 'skin' | 'color';
    graphics: Graphics;
    color: readonly [number, number, number];
    selected: boolean;
};

const PANEL = UI_STYLE.panel;
const PANEL_ALT = UI_STYLE.panelAlt;
const CYAN = UI_STYLE.cyan;
const ACCENT = UI_STYLE.accent;
const MUTED = UI_STYLE.muted;
const WHITE = UI_STYLE.white;
const DARK_TEXT = uiColor(6, 35, 54);
const READY_MODEL_SHADOW_Y = -208;
const PROTOTYPE_CHARACTER_SLOT_COUNT = 12;
const CHARACTER_CARD_WIDTH = 132;
const CHARACTER_CARD_HEIGHT = 142;
const CHARACTER_CARD_X_PITCH = 144;
const CHARACTER_CARD_Y_PITCH = 154;
const SWATCH_SIZE = 42;
const RACE_MODE_CARD_VISIBLE_HEIGHT = 164;
const RACE_MODE_CARD_UNSELECTED_SCALE = 0.8;
const RACE_MODE_CARD_GAP = 7;
const RACE_MODE_STACK_TOP_Y = 240;

export class PrepareRaceFlow {
    private _root: Node | null = null;
    private _content: Node | null = null;
    private _previewRoot: Node | null = null;
    private _preview: PrepareRaceCharacterPreview | null = null;
    private _shadowSprite: Sprite | null = null;
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

    private readonly _onProfileChange = (_profile: PlayerProfile): void => {
        if (!this._root?.isValid || !this._content?.isValid) return;
        if (this._view === 'ready') {
            this.refreshReadyCharacterInfo();
        } else {
            this.refreshCharacterCards();
            this.refreshCharacterInspector();
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
        this._shadowSprite = null;
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
    }

    private buildBackground(root: Node): void {
        const fallback = makeRect('PrepareRaceBackdrop', root, this._width, this._height, uiColor(4, 20, 42));
        fitFullScreenBackgroundCover(fallback);
        const image = makeUiNode('PrepareRaceBackgroundImage', root);
        image.setPosition(0, 0, 1);
        fitFullScreenBackgroundCover(image);
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
        stylePsdRuntimeLabel(this._readyName, 'PingFang SC', true, 36);
        this._readyLevel = makeBoundLabel('CharacterLevel', parent, '', 16, WHITE, 64, 28, -335, 165);
        stylePsdRuntimeLabel(this._readyLevel, 'Arial Black', true, 22);

        const statNames = ['体力', '技巧', '爆发'];
        const statY = [107, 62, 17];
        for (let index = 0; index < statNames.length; index++) {
            const statName = makeBoundLabel(`StatName${index}`, parent, statNames[index], 18, uiColor(31, 43, 62), 92, 28, -488, statY[index], Label.HorizontalAlign.LEFT);
            stylePsdRuntimeLabel(statName, 'PingFang SC', true, 24);
            const statValue = makeBoundLabel(`StatValue${index}`, parent, '', 19, uiColor(31, 43, 62), 82, 28, -357, statY[index], Label.HorizontalAlign.RIGHT);
            stylePsdRuntimeLabel(statValue, 'Arial Black', true, 24);
            this._readyStats.push(statValue);
        }

        makeRaceTextureSprite('ReadySkillCard', parent, RESOURCE_PATHS.lobbyUi.skillCard, 320, 145, -445, -98.5, 2);
        const skillHeading = makeBoundLabel('SkillHeading', parent, 'SKILL', 16, DARK_TEXT, 70, 24, -545, -42);
        stylePsdRuntimeLabel(skillHeading, 'Arial Black', true, 21);
        this._readySkillName = makeBoundLabel('SkillName', parent, '', 20, DARK_TEXT, 190, 28, -405, -90, Label.HorizontalAlign.LEFT);
        stylePsdRuntimeLabel(this._readySkillName, 'PingFang SC', true, 27);
        this._readySkillDescription = makeBoundLabel('SkillDescription', parent, '', 14, uiColor(72, 82, 98), 190, 42, -405, -126, Label.HorizontalAlign.LEFT);
        stylePsdRuntimeLabel(this._readySkillDescription, 'PingFang SC', false, 20);
        this._readySkillDescription.overflow = Label.Overflow.CLAMP;
        this._readySkillDescription.enableWrapText = true;

        const manage = makeRaceTextureButton('MyCharactersButton', parent, RESOURCE_PATHS.lobbyUi.characterButton, 312, 70, -446, -220, 3);
        const manageLabel = makeBoundLabel('Label', manage, '角色养成', 24, DARK_TEXT, 150, 36, -8, 0);
        stylePsdRuntimeLabel(manageLabel, 'PingFang SC', true, 32);
        manage.on(Button.EventType.CLICK, () => this.showCharacterManagement());
    }

    private refreshReadyCharacterInfo(): void {
        const character = findPlayerCharacter();
        if (!character) return;
        const level = getProgressionManager().getCharacterLevel(character.id);
        setLabelString(this._readyName, character.name);
        setLabelString(this._readyLevel, `LV.${level}`);
        const values = [character.stamina, character.technique, character.burst];
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

        const start = makeRaceTextureButton('StartRaceButton', parent, RESOURCE_PATHS.lobbyUi.startButton, 332, 102, 448, -287, 3);
        const startLabel = makeBoundLabel('Label', start, '开始比赛', 38, DARK_TEXT, 220, 54, -4, 0);
        stylePsdRuntimeLabel(startLabel, 'PingFang SC', true, 48);
        start.on(Button.EventType.CLICK, () => {
            setRaceDifficulty(getSelectedRaceDifficulty());
            this._callbacks.onStartRace();
        });
    }

    private buildCharacterManagement(parent: Node): void {
        makeBoundLabel('CharacterScreenTitle', parent, '我的角色', 30, WHITE, 260, 42, -430, 230);
        this.buildCharacterRoster(parent);
        this.buildPreviewPresentation(parent);
        this.buildCharacterInspector(parent);
        this.refreshCharacterCards();
        this.refreshCharacterInspector();
        this.selectInspectorTab('attributes', true);
    }

    private buildCharacterRoster(parent: Node): void {
        const panel = makeRoundedRect('CharacterRosterPanel', parent, 326, 520, PANEL, 16, UI_STYLE.cyanOutline, 1.5);
        panel.setPosition(-465, -30, 2);
        const viewport = makeUiNode('CharacterRosterViewport', panel);
        viewport.getComponent(UITransform)!.setContentSize(302, 494);
        const scroll = viewport.addComponent(ScrollView);
        scroll.horizontal = false;
        scroll.vertical = true;
        scroll.inertia = true;
        scroll.elastic = false;
        scroll.brake = 0.5;
        scroll.cancelInnerEvents = true;
        const mask = viewport.addComponent(Mask);
        mask.type = Mask.Type.GRAPHICS_RECT;
        mask.inverted = false;

        const slotCount = Math.max(PROTOTYPE_CHARACTER_SLOT_COUNT, PLAYER_CHARACTER_DEFINITIONS.length);
        const rows = Math.ceil(slotCount / 2);
        const contentHeight = rows * CHARACTER_CARD_Y_PITCH + 10;
        const content = makeUiNode('CharacterRosterContent', viewport);
        content.getComponent(UITransform)!.setContentSize(302, contentHeight);
        scroll.content = content;
        for (let index = 0; index < slotCount; index++) {
            this.buildCharacterCard(content, PLAYER_CHARACTER_DEFINITIONS[index] ?? null, index, contentHeight);
        }
        scroll.scrollToTop(0);
    }

    private buildCharacterCard(parent: Node, character: PlayerCharacterDefinition | null, index: number, contentHeight: number): void {
        const column = index % 2;
        const row = Math.floor(index / 2);
        const card = makeRoundedRect(`CharacterSlot${index}`, parent, CHARACTER_CARD_WIDTH, CHARACTER_CARD_HEIGHT, PANEL_ALT, 14, UI_STYLE.cyanOutline, 1.5);
        card.setPosition((column - 0.5) * CHARACTER_CARD_X_PITCH, contentHeight / 2 - CHARACTER_CARD_HEIGHT / 2 - 8 - row * CHARACTER_CARD_Y_PITCH, 1);
        const name = makeBoundLabel('Name', card, character?.name ?? '未获得', 17, WHITE, 116, 26, 0, 52);
        makePrototypePortrait(card, character !== null);
        const level = makeBoundLabel('Level', card, '', 15, ACCENT, 78, 22, -20, -50, Label.HorizontalAlign.LEFT);
        const state = makeBoundLabel('State', card, '', 14, uiColor(90, 230, 120), 72, 22, 28, -50, Label.HorizontalAlign.RIGHT);
        const view: CharacterCardView = {
            characterId: character?.id ?? null,
            background: card.getComponent(Graphics)!,
            name,
            level,
            state,
            draftSelected: false,
            committed: false,
        };
        this._characterCards.push(view);
        if (character?.unlocked) {
            const button = card.addComponent(Button);
            button.target = card;
            button.transition = Button.Transition.NONE;
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
        setLabelString(card.level, character ? `Lv.${getProgressionManager().getCharacterLevel(character.id)}` : '敬请期待');
        setLabelString(card.state, committed ? '使用中' : draftSelected ? '待确认' : '');
        if (card.draftSelected === draftSelected && card.committed === committed) return;
        card.draftSelected = draftSelected;
        card.committed = committed;
        this.drawCharacterCard(card);
    }

    private drawCharacterCard(card: CharacterCardView): void {
        const gfx = card.background;
        if (!gfx?.isValid) return;
        const locked = card.characterId === null;
        gfx.clear();
        gfx.fillColor = locked ? uiColor(60, 70, 82, 225) : card.draftSelected ? uiColor(255, 190, 24, 245) : PANEL_ALT;
        gfx.roundRect(-66, -71, 132, 142, 14);
        gfx.fill();
        gfx.strokeColor = card.draftSelected ? uiColor(255, 240, 145) : card.committed ? CYAN : UI_STYLE.cyanOutline;
        gfx.lineWidth = card.draftSelected ? 3 : card.committed ? 2.5 : 1.5;
        gfx.roundRect(-64.5, -69.5, 129, 139, 12.5);
        gfx.stroke();
        setLabelColor(card.name, card.draftSelected ? DARK_TEXT : WHITE);
        setLabelColor(card.level, card.draftSelected ? uiColor(6, 35, 54, 200) : ACCENT);
    }

    private buildCharacterInspector(parent: Node): void {
        const panel = makeRoundedRect('CharacterInspector', parent, 332, 520, PANEL, 16, UI_STYLE.cyanOutline, 1.5);
        panel.setPosition(458, -30, 2);
        this.buildInspectorTab(panel, 'attributes', '属性', -83);
        this.buildInspectorTab(panel, 'appearance', '外观', 83);

        this._attributeContent = makeUiNode('AttributeContent', panel);
        this._attributeContent.getComponent(UITransform)!.setContentSize(308, 420);
        this._attributeContent.setPosition(0, -34, 1);
        this.buildAttributeContent(this._attributeContent);

        this._appearanceContent = makeUiNode('AppearanceContent', panel);
        this._appearanceContent.getComponent(UITransform)!.setContentSize(308, 420);
        this._appearanceContent.setPosition(0, -34, 1);
        this.buildAppearanceContent(this._appearanceContent);

        const confirm = makeRoundedButton('ConfirmCharacterButton', parent, 250, 58, uiColor(255, 190, 24), '确认选择');
        confirm.setPosition(458, -326, 3);
        styleButtonLabel(confirm, 23, DARK_TEXT);
        confirm.on(Button.EventType.CLICK, () => this.confirmDraftCharacter());
    }

    private buildInspectorTab(parent: Node, id: CharacterInspectorTab, text: string, x: number): void {
        const tab = makeRect(`Tab_${id}`, parent, 166, 54, PANEL_ALT);
        tab.setPosition(x, 233, 2);
        const button = tab.addComponent(Button);
        button.target = tab;
        button.transition = Button.Transition.NONE;
        const label = makeBoundLabel('Label', tab, text, 22, WHITE, 150, 40, 0, 0);
        this._tabs.push({ id, background: tab.getComponent(Graphics)!, label, selected: false });
        tab.on(Button.EventType.CLICK, () => this.selectInspectorTab(id, false));
    }

    private selectInspectorTab(tab: CharacterInspectorTab, force: boolean): void {
        if (!force && this._activeInspectorTab === tab) return;
        this._activeInspectorTab = tab;
        setNodeActive(this._attributeContent, tab === 'attributes');
        setNodeActive(this._appearanceContent, tab === 'appearance');
        for (const view of this._tabs) {
            const selected = view.id === tab;
            if (!force && view.selected === selected) continue;
            view.selected = selected;
            view.background.clear();
            view.background.fillColor = selected ? uiColor(255, 190, 24) : PANEL_ALT;
            view.background.rect(-83, -27, 166, 54);
            view.background.fill();
            setLabelColor(view.label, selected ? DARK_TEXT : WHITE);
        }
    }

    private buildAttributeContent(parent: Node): void {
        this._inspectorName = makeBoundLabel('CharacterName', parent, '', 28, WHITE, 230, 38, -22, 172, Label.HorizontalAlign.LEFT);
        this._inspectorLevel = makeBoundLabel('CharacterLevel', parent, '', 18, ACCENT, 74, 28, 108, 172, Label.HorizontalAlign.RIGHT);
        const names = ['体力', '技巧', '爆发'];
        for (let index = 0; index < names.length; index++) {
            const y = 110 - index * 48;
            makeStatIcon(`StatIcon${index}`, parent, -126, y, index);
            makeBoundLabel(`StatName${index}`, parent, names[index], 18, WHITE, 70, 28, -80, y, Label.HorizontalAlign.LEFT);
            this._inspectorCurrentStats.push(makeBoundLabel(`Current${index}`, parent, '', 18, WHITE, 62, 28, 5, y, Label.HorizontalAlign.RIGHT));
            makeBoundLabel(`Arrow${index}`, parent, '→', 18, MUTED, 30, 28, 51, y);
            this._inspectorNextStats.push(makeBoundLabel(`Next${index}`, parent, '', 18, uiColor(130, 230, 160), 62, 28, 105, y, Label.HorizontalAlign.RIGHT));
        }
        const skill = makeRoundedRect('SkillCard', parent, 284, 86, PANEL_ALT, 12);
        skill.setPosition(0, -72, 1);
        makePrototypeSkillIcon(skill, -108, 0);
        this._inspectorSkillName = makeBoundLabel('SkillName', skill, '', 18, WHITE, 180, 26, 32, 17, Label.HorizontalAlign.LEFT);
        this._inspectorSkillDescription = makeBoundLabel('SkillDescription', skill, '', 13, uiColor(214, 232, 246), 180, 38, 32, -16, Label.HorizontalAlign.LEFT);

        const upgrade = makeRoundedButton('UpgradeButton', parent, 284, 54, PANEL_ALT, '');
        upgrade.setPosition(0, -156, 2);
        this._upgradeButton = upgrade.getComponent(Button)!;
        makeBoundLabel('CoinPrefix', upgrade, '金币', 16, MUTED, 48, 26, -104, 0, Label.HorizontalAlign.LEFT);
        this._upgradeCost = makeBoundLabel('Cost', upgrade, '', 18, WHITE, 74, 28, -46, 0, Label.HorizontalAlign.LEFT);
        this._upgradeAction = makeBoundLabel('Action', upgrade, '升级', 22, WHITE, 90, 32, 76, 0);
        upgrade.on(Button.EventType.CLICK, () => void this.upgradeDraftCharacter());
    }

    private refreshCharacterInspector(): void {
        const character = this._draftCharacterId ? findPlayerCharacter(this._draftCharacterId) : null;
        if (!character) return;
        const progression = getProgressionManager();
        const level = progression.getCharacterLevel(character.id);
        const nextLevel = Math.min(PROGRESSION_BALANCE.maxLevel, level + 1);
        const current = progression.resolveBalance(character.id);
        const next = resolvePlayerBalance(
            { stamina: character.stamina, technique: character.technique, burst: character.burst, kick: character.kick },
            nextLevel,
            PROGRESSION_BALANCE.maxLevel,
            character.weight,
            character.energyGain,
            character.kick,
        );
        setLabelString(this._inspectorName, character.name);
        setLabelString(this._inspectorLevel, `Lv.${level}`);
        if (current) {
            const currentValues = [current.energyTotal.toFixed(1), current.strokeQualityAccel.toFixed(2), current.maxSpeed.toFixed(2)];
            const nextValues = [next.energyTotal.toFixed(1), next.strokeQualityAccel.toFixed(2), next.maxSpeed.toFixed(2)];
            for (let index = 0; index < this._inspectorCurrentStats.length; index++) {
                setLabelString(this._inspectorCurrentStats[index], currentValues[index]);
                setLabelString(this._inspectorNextStats[index], nextValues[index]);
            }
        }
        setLabelString(this._inspectorSkillName, character.skillName);
        setLabelString(this._inspectorSkillDescription, character.skillDescription);
        const atMax = level >= PROGRESSION_BALANCE.maxLevel;
        const cost = atMax ? 0 : progression.coinCostForNextLevel(character.id);
        const affordable = !atMax && PlayerData.coins >= cost;
        setLabelString(this._upgradeCost, atMax ? '—' : `${cost}`);
        setLabelString(this._upgradeAction, atMax ? '已满级' : '升级');
        setLabelColor(this._upgradeCost, affordable || atMax ? WHITE : uiColor(255, 92, 92));
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
        this._skinRow.getComponent(UITransform)!.setContentSize(284, 96);
        this._skinRow.setPosition(0, 106, 1);
        makeBoundLabel('SkinLabel', this._skinRow, '肤色', 20, WHITE, 62, 30, -108, 16, Label.HorizontalAlign.LEFT);
        for (let index = 0; index < PLAYER_SKIN_TONES.length; index++) {
            const tone = PLAYER_SKIN_TONES[index];
            this.buildSwatch(this._skinRow, tone.id, 'skin', tone.color, -26 + index * 58, 16);
        }
        makeBoundLabel('OutfitLabel', parent, '配饰', 20, WHITE, 62, 30, -108, 20, Label.HorizontalAlign.LEFT);
        for (let index = 0; index < PLAYER_COLOR_SCHEMES.length; index++) {
            const scheme = PLAYER_COLOR_SCHEMES[index];
            const column = index % 4;
            const row = Math.floor(index / 4);
            this.buildSwatch(parent, scheme.id, 'color', scheme.suit, -38 + column * 58, 20 - row * 58);
        }
        makeBoundLabel('AppearanceHint', parent, '外观调整会即时预览；角色需点击“确认选择”后才会用于比赛。', 14, MUTED, 270, 50, 0, -132);
        this.refreshAppearanceSupport();
        this.refreshAppearanceSwatches();
    }

    private buildSwatch(parent: Node, id: string, group: 'skin' | 'color', color: readonly [number, number, number], x: number, y: number): void {
        const node = makeUiNode(`Swatch_${group}_${id}`, parent);
        node.getComponent(UITransform)!.setContentSize(SWATCH_SIZE, SWATCH_SIZE);
        node.setPosition(x, y, 1);
        const graphics = node.addComponent(Graphics);
        const button = node.addComponent(Button);
        button.target = node;
        button.transition = Button.Transition.NONE;
        const view: SwatchView = { id, group, graphics, color, selected: false };
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
        const previewX = this._view === 'ready' ? -45 : 0;
        if (this._view !== 'ready') {
            const contact = makeUiNode('CharacterContactShadow', parent);
            contact.getComponent(UITransform)!.setContentSize(178, 42);
            contact.setPosition(previewX, READY_MODEL_SHADOW_Y, 1);
            const contactGraphics = contact.addComponent(Graphics);
            contactGraphics.fillColor = uiColor(4, 13, 26, 78);
            contactGraphics.ellipse(0, 0, 86, 18);
            contactGraphics.fill();
            contactGraphics.fillColor = uiColor(2, 8, 16, 104);
            contactGraphics.ellipse(0, 0, 55, 10);
            contactGraphics.fill();

            const shadow = makeUiNode('CharacterRealtimeShadow', parent);
            shadow.getComponent(UITransform)!.setContentSize(170, 48);
            shadow.setPosition(previewX, READY_MODEL_SHADOW_Y, 2);
            this._shadowSprite = shadow.addComponent(Sprite);
            this._shadowSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        }

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
        this._preview?.setLobbyPresentation(this._view === 'ready');
        setNodeActive(this._previewRoot, true);
        this._preview?.refresh(characterId);
        const shadowTexture = this._preview?.shadowTexture;
        if (this._shadowSprite?.isValid && shadowTexture) {
            const frame = new SpriteFrame();
            frame.texture = shadowTexture;
            this._shadowSprite.spriteFrame = frame;
        }
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

function makeRoundedButton(name: string, parent: Node, width: number, height: number, color: Color, text: string): Node {
    const node = makeRoundedRect(name, parent, width, height, color, 14, uiColor(255, 255, 255, 120), 2);
    const button = node.addComponent(Button);
    button.target = node;
    button.transition = Button.Transition.NONE;
    const label = makeBoundLabel('Label', node, text, 20, WHITE, width - 16, height - 8, 0, 0);
    label.lineHeight = 23;
    return node;
}

function styleButtonLabel(buttonNode: Node, fontSize: number, color: Color): void {
    const label = buttonNode.getChildByName('Label')?.getComponent(Label);
    if (!label) return;
    label.fontSize = fontSize;
    label.lineHeight = fontSize + 4;
    label.color = color;
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
    label.overflow = Label.Overflow.SHRINK;
    return label;
}

function makeStatIcon(name: string, parent: Node, x: number, y: number, index: number): void {
    const node = makeUiNode(name, parent);
    node.getComponent(UITransform)!.setContentSize(34, 34);
    node.setPosition(x, y, 1);
    const gfx = node.addComponent(Graphics);
    gfx.fillColor = index === 0 ? uiColor(255, 86, 125) : index === 1 ? uiColor(255, 137, 54) : uiColor(43, 207, 232);
    gfx.circle(0, 0, 16);
    gfx.fill();
}

function makePrototypeSkillIcon(parent: Node, x: number, y: number): void {
    const node = makeUiNode('SkillIconPrototype', parent);
    node.getComponent(UITransform)!.setContentSize(56, 56);
    node.setPosition(x, y, 1);
    const gfx = node.addComponent(Graphics);
    gfx.fillColor = uiColor(42, 55, 70);
    gfx.circle(0, 0, 27);
    gfx.fill();
    gfx.strokeColor = ACCENT;
    gfx.lineWidth = 4;
    gfx.moveTo(-14, 8);
    gfx.lineTo(-2, -6);
    gfx.lineTo(4, 5);
    gfx.lineTo(15, -10);
    gfx.stroke();
}

function makePrototypePortrait(parent: Node, available: boolean): void {
    const node = makeUiNode('PortraitPrototype', parent);
    node.getComponent(UITransform)!.setContentSize(80, 64);
    node.setPosition(0, 0, 1);
    const gfx = node.addComponent(Graphics);
    gfx.fillColor = available ? uiColor(120, 196, 228, 210) : uiColor(95, 101, 112, 180);
    gfx.circle(0, 15, 15);
    gfx.fill();
    gfx.roundRect(-24, -28, 48, 34, 12);
    gfx.fill();
}

function drawSwatch(view: SwatchView): void {
    const gfx = view.graphics;
    if (!gfx?.isValid) return;
    gfx.clear();
    gfx.fillColor = uiColor(view.color[0], view.color[1], view.color[2]);
    gfx.roundRect(-21, -21, SWATCH_SIZE, SWATCH_SIZE, 8);
    gfx.fill();
    gfx.strokeColor = view.selected ? CYAN : uiColor(255, 255, 255, 45);
    gfx.lineWidth = view.selected ? 4 : 1.5;
    gfx.roundRect(-19, -19, 38, 38, 6);
    gfx.stroke();
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
