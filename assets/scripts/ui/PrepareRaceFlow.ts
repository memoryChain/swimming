import { Button, EventTouch, Graphics, Label, LabelOutline, Mask, Node, resources, ScrollView, Sprite, SpriteFrame, Texture2D, UITransform } from 'cc';
import { RaceDifficulty, RACE_DIFFICULTY_OPTIONS, setRaceDifficulty } from '../core/GameBalance';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import {
    findPlayerCharacter,
    getPlayerCharacterSelection,
    getSelectedRaceDifficulty,
    PLAYER_CHARACTER_DEFINITIONS,
    PLAYER_CHARACTER_SLOT_COUNT,
    selectPlayerCharacter,
    selectedPlayerColorScheme,
    setSelectedRaceDifficulty,
} from '../app/PlayerCharacterConfig';
import { PrepareRaceCharacterPreview } from '../app/PrepareRaceCharacterPreview';
import { openAppearancePanel } from './AppearancePanel';
import { getProgressionManager } from '../progression/ProgressionManager';
import { PROGRESSION_BALANCE, xpForLevel } from '../progression/ProgressionBalance';
import { makeButton, makeLabel, makeRect, makeRoundedRect, makeUiNode, uiColor } from './RuntimeUiFactory';
import { HEADBAR_TOP_SAFE_AREA } from './ResourceHeadBar';
import { UI_STYLE } from './UIStyle';

export type PrepareRaceFlowCallbacks = {
    onBack: () => void;
    onStartRace: () => void;
};

const PANEL = UI_STYLE.panel;
const PANEL_ALT = UI_STYLE.panelAlt;
const CYAN = UI_STYLE.cyan;
const ACCENT = UI_STYLE.accent;
const MUTED = UI_STYLE.muted;
const WHITE = UI_STYLE.white;
// Bottom horizontal roster strip geometry.
const ROSTER_HEIGHT = 96;
const ROSTER_CARD_WIDTH = 150;
const ROSTER_CARD_HEIGHT = 68;
const ROSTER_CARD_PITCH = 162;

// Screen-space lift applied to the central character preview (px). The 3D model
// lift lives in PrepareRaceCharacterPreview (PREVIEW_CHARACTER_LIFT); these UI
// elements track the same shift so the floor shadow and rotate surface follow.
const PREPARE_RACE_MODEL_LIFT = 40;

export class PrepareRaceFlow {
    private _root: Node | null = null;
    private _content: Node | null = null;
    private _previewRoot: Node | null = null;
    private _preview: PrepareRaceCharacterPreview | null = null;
    // The preview component owns the RenderTexture.  This UI SpriteFrame only
    // presents that live texture as the flattened shadow under its feet.
    private _shadowSprite: Sprite | null = null;
    private _previewTouchX = 0;
    // Appearance is edited through the 外观 popup (see openAppearance).

    constructor(
        private readonly _parent: Node,
        private readonly _canvasNode: Node,
        private readonly _width: number,
        private readonly _height: number,
        private readonly _callbacks: PrepareRaceFlowCallbacks,
    ) {}

    showCharacterSelect() {
        this.ensureRoot();
        this._content?.destroy();
        this._content = makeUiNode('PrepareRaceCharacterContent', this._root!);
        this.buildCharacterSelect(this._content);
        this.ensurePreview();
        this._previewRoot!.active = true;
        this._preview?.refresh();
        const shadowTexture = this._preview?.shadowTexture;
        if (this._shadowSprite?.isValid && shadowTexture) {
            // SpriteFrame must never be assigned before it has a texture:
            // Web's UI batcher asks it for getHash() on the same frame.
            const spriteFrame = new SpriteFrame();
            spriteFrame.texture = shadowTexture;
            this._shadowSprite.spriteFrame = spriteFrame;
        }
    }

    dispose() {
        this._previewRoot?.destroy();
        this._previewRoot = null;
        this._preview = null;
        this._root?.destroy();
        this._root = null;
        this._content = null;
    }

    private ensureRoot() {
        if (this._root) return;
        const root = makeUiNode('PrepareRaceUI', this._parent);
        root.getComponent(UITransform)!.setContentSize(this._width, this._height);
        this._root = root;
        this.buildBackground(root);
    }

    private buildBackground(root: Node) {
        const fallback = makeRect('PrepareRaceBackdrop', root, this._width, this._height, uiColor(4, 20, 42, 255));
        fallback.setPosition(0, 0, 0);
        const image = makeUiNode('PrepareRaceBackgroundImage', root);
        image.getComponent(UITransform)!.setContentSize(this._width, this._height);
        image.setPosition(0, 0, 1);
        // The locker-room artwork is only needed after the player opens character
        // selection, so keep it out of the WeChat main package with the race assets.
        loadRaceAsset(RESOURCE_PATHS.prepareRaceBackground, Texture2D, (error, texture) => {
            if (error || !texture || !image.isValid) {
                console.warn('[SpeedSwimming] prepare-race background texture failed to load', error);
                return;
            }
            const spriteFrame = new SpriteFrame();
            spriteFrame.texture = texture;
            const sprite = image.addComponent(Sprite);
            sprite.spriteFrame = spriteFrame;
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            // Graphics uses a separate UI render path and can otherwise cover a
            // dynamically-created Sprite even though the image node is later in
            // the hierarchy. Once the texture is ready, the image is the base.
            fallback.destroy();
        });
    }

    private buildCharacterSelect(parent: Node) {
        makeScreenTitle(parent, '准备比赛', this._height / 2 - 56);
        // Back navigation lives in the unified resource headbar (top-left) now, so
        // this screen no longer draws its own back button.
        this.buildRealtimeCharacterShadow(parent);
        this.buildRoster(parent);
        this.buildCharacterDetail(parent);
        this.buildCharacterControls(parent);
        // Character info on the left; race-mode selection and the appearance
        // button on the right; the central column stays clear for the preview.
        this.buildRaceModeList(parent);
        const rotateArea = makeUiNode('CharacterRotateArea', parent);
        // Keep the drag surface strictly inside the central character area so
        // it cannot intercept the roster strip or the skin/palette swatches.
        rotateArea.getComponent(UITransform)!.setContentSize(240, 380);
        rotateArea.setPosition(0, 52 + PREPARE_RACE_MODEL_LIFT, 2);
        rotateArea.on(Node.EventType.TOUCH_START, (event: EventTouch) => { this._previewTouchX = event.getUILocation().x; });
        rotateArea.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => {
            const x = event.getUILocation().x;
            this._preview?.rotateBy((x - this._previewTouchX) * 0.55);
            this._previewTouchX = x;
        });
        // All actual UI controls are later siblings and therefore win hit
        // testing wherever their rectangles overlap this drag surface.
        rotateArea.setSiblingIndex(0);
    }

    private buildRealtimeCharacterShadow(parent: Node) {
        // RenderTexture contains a top-down black silhouette of the live
        // skinned model.  Compressing it vertically makes it read as the
        // overhead locker-room light's floor shadow, while keeping the exact
        // current pose (including the randomly selected showcase action).
        // A soft contact shadow guarantees a visible grounding cue under the
        // overhead changing-room light. The RenderTexture silhouette below is
        // layered over it when the target platform supports that capture.
        const contact = makeUiNode('CharacterContactShadow', parent);
        contact.getComponent(UITransform)!.setContentSize(170, 40);
        // Matches the selected swimmer's projected foot level in the
        // locker-room framing, rather than the centre of the bright floor area.
        contact.setPosition(0, -248 + PREPARE_RACE_MODEL_LIFT, 1);
        const contactGraphics = contact.addComponent(Graphics);
        contactGraphics.fillColor = uiColor(4, 13, 26, 78);
        contactGraphics.ellipse(0, 0, 82, 17);
        contactGraphics.fill();
        contactGraphics.fillColor = uiColor(2, 8, 16, 104);
        contactGraphics.ellipse(0, 0, 54, 10);
        contactGraphics.fill();

        const shadow = makeUiNode('CharacterRealtimeShadow', parent);
        shadow.getComponent(UITransform)!.setContentSize(166, 46);
        shadow.setPosition(0, -248 + PREPARE_RACE_MODEL_LIFT, 2);
        const sprite = shadow.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this._shadowSprite = sprite;
    }

    private buildRoster(parent: Node) {
        // Bottom-left horizontal character strip. Cards slide sideways so the
        // left edge of the screen stays free for a larger 3D preview; the start
        // button owns the bottom-right corner, so the strip stops before it.
        const stripLeft = -this._width / 2 + 24;
        const stripWidth = this._width - 24 - 280;
        const stripY = -this._height / 2 + ROSTER_HEIGHT / 2 + 12;
        const panel = makeRect('CharacterRosterPanel', parent, stripWidth, ROSTER_HEIGHT, PANEL);
        panel.setPosition(stripLeft + stripWidth / 2, stripY, 2);

        // Standard Cocos hierarchy: View (ScrollView + Mask) -> Content. The
        // View's transform is the only visible/interactive scrolling area.
        const viewportWidth = stripWidth - 24;
        const viewportHeight = ROSTER_CARD_HEIGHT + 12;
        const viewNode = makeUiNode('RosterScrollView', panel);
        viewNode.getComponent(UITransform)!.setContentSize(viewportWidth, viewportHeight);
        viewNode.setPosition(0, 0, 1);
        const scrollView = viewNode.addComponent(ScrollView);
        scrollView.horizontal = true;
        scrollView.vertical = false;
        scrollView.inertia = true;
        scrollView.elastic = false;
        scrollView.brake = 0.5;
        scrollView.cancelInnerEvents = true;

        // Mask is a required engine module for this screen. Do not silently
        // continue without it: without stencil clipping, changing Content's
        // position can never define a ScrollView visible range.
        const mask = viewNode.addComponent(Mask);
        mask.type = Mask.Type.GRAPHICS_RECT;
        mask.inverted = false;
        const content = makeUiNode('RosterContent', viewNode);
        const contentWidth = PLAYER_CHARACTER_SLOT_COUNT * ROSTER_CARD_PITCH + 8;
        content.getComponent(UITransform)!.setContentSize(contentWidth, viewportHeight);
        scrollView.content = content;
        this.renderRoster(content, contentWidth);
        scrollView.scrollToLeft(0);
    }

    private renderRoster(content: Node, contentWidth: number) {
        content.removeAllChildren();
        const selected = getPlayerCharacterSelection().characterId;
        const progression = getProgressionManager();
        for (let index = 0; index < PLAYER_CHARACTER_SLOT_COUNT; index++) {
            const character = PLAYER_CHARACTER_DEFINITIONS[index];
            if (!character) continue;
            const unlocked = !!character?.unlocked;
            const active = character?.id === selected;
            const fill = active ? CYAN : unlocked ? PANEL_ALT : MUTED;
            const card = makeButton(`CharacterSlot${index}`, content, ROSTER_CARD_WIDTH, ROSTER_CARD_HEIGHT, fill, '');
            card.setPosition(
                -contentWidth / 2 + ROSTER_CARD_WIDTH / 2 + 8 + index * ROSTER_CARD_PITCH,
                0,
                1,
            );
            if (unlocked) {
                const nameNode = makeLabel('Name', card, character.name, 20, active ? uiColor(6, 35, 54) : WHITE);
                nameNode.getComponent(UITransform)!.setContentSize(ROSTER_CARD_WIDTH - 12, 28);
                nameNode.setPosition(0, 11, 1);
                const levelText = 'Lv.' + progression.getCharacterLevel(character.id);
                const levelNode = makeLabel('Level', card, levelText, 15, active ? uiColor(6, 35, 54, 200) : ACCENT);
                levelNode.getComponent(UITransform)!.setContentSize(ROSTER_CARD_WIDTH - 12, 22);
                levelNode.setPosition(0, -14, 1);
                card.on(Button.EventType.CLICK, () => {
                    selectPlayerCharacter(character.id);
                    this.showCharacterSelect();
                });
            } else {
                const lockNode = makeLabel('Lock', card, '🔒', 24, WHITE);
                lockNode.setPosition(0, 0, 1);
            }
        }
    }

    private buildCharacterControls(parent: Node) {
        // A single 外观 button on the right opens a modal color picker, so the
        // prepare-race screen stays clean and the full skin-tone / outfit grid
        // lives in the popup. The color dot shows the current outfit color.
        const centerX = this._width / 2 - 165 - 32; // matches buildRaceModeList
        const button = makeRoundedRect('AppearanceButton', parent, 200, 56, PANEL, 12, UI_STYLE.cyanOutline, 1.5);
        button.setPosition(centerX, -160, 3);
        const hit = button.addComponent(Button);
        hit.target = button;
        hit.transition = Button.Transition.NONE;
        const dot = makeUiNode('ColorDot', button);
        dot.getComponent(UITransform)!.setContentSize(28, 28);
        dot.setPosition(-58, 0, 1);
        dot.addComponent(Graphics);
        makeLabel('Label', button, '外观', 22, WHITE).setPosition(16, 0, 1);
        button.on(Button.EventType.CLICK, () => this.openAppearance());
        this.refreshAppearanceControls();
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
        const dot = this._content?.getChildByName('AppearanceButton')?.getChildByName('ColorDot');
        const gfx = dot?.getComponent(Graphics);
        if (!gfx) return;
        gfx.clear();
        gfx.fillColor = uiColor(palette.suit[0], palette.suit[1], palette.suit[2], 255);
        gfx.roundRect(-14, -14, 28, 28, 6);
        gfx.fill();
    }

    private buildCharacterDetail(parent: Node) {
        const character = findPlayerCharacter();
        if (!character) return;
        const panelWidth = 330;
        // Shorten this panel to leave a dedicated lower-right button area.
        const panelHeight = this._height - 220;
        const panel = makeRect('CharacterDetailPanel', parent, panelWidth, panelHeight, PANEL);
        // Panel now lives on the LEFT; its top stays at the headbar's reserved
        // band (top-left back/identity) so nothing hides behind it. Height is
        // preserved; the right side is left for the race-mode list.
        const detailTopY = this._height / 2 - HEADBAR_TOP_SAFE_AREA;
        panel.setPosition(-(this._width / 2 - panelWidth / 2 - 32), detailTopY - panelHeight / 2, 2);
        makeLabel('CharacterName', panel, character.name, 32, WHITE).setPosition(0, panelHeight / 2 - 42, 1);
        // Progression: show current level and XP progress for this character.
        const progression = getProgressionManager();
        const level = progression.getCharacterLevel(character.id);
        const xp = progression.getCharacterXp(character.id);
        const xpNeeded = level >= PROGRESSION_BALANCE.maxLevel ? 0 : xpForLevel(level);
        makeLabel('LevelLabel', panel, 'Lv.' + level + (level >= PROGRESSION_BALANCE.maxLevel ? ' (满级)' : ''), 18, uiColor(150, 200, 255)).setPosition(0, panelHeight / 2 - 70, 1);
        if (xpNeeded > 0) {
            const xpLabel = makeLabel('XpLabel', panel, 'XP', 20, WHITE);
            xpLabel.getComponent(UITransform)!.setContentSize(72, 28);
            xpLabel.setPosition(-118, panelHeight / 2 - 92, 1);
            const xpBarWidth = 188;
            const xpTrack = makeRect('XpTrack', panel, xpBarWidth, 16, uiColor(24, 55, 90, 255));
            xpTrack.setPosition(18, panelHeight / 2 - 92, 1);
            const xpRatio = Math.max(0, Math.min(1, xp / xpNeeded));
            const xpFill = makeRect('XpFill', xpTrack, 184 * xpRatio, 10, uiColor(120, 220, 130, 255));
            xpFill.setPosition(-92 + (184 * xpRatio) / 2, 0, 2);
            const xpValueLabel = makeLabel('XpValue', panel, xp + '/' + xpNeeded, 16, WHITE);
            xpValueLabel.getComponent(UITransform)!.setContentSize(72, 24);
            xpValueLabel.setPosition(132, panelHeight / 2 - 92, 1);
        }
        // Pull the compact three-row attribute block up below the name. This
        // removes the old empty band at the top of the panel and reserves its
        // lower-right area for the race-selection button.
        this.makeStat(panel, '体力', character.stamina, 130);
        this.makeStat(panel, '技巧', character.technique, 90);
        this.makeStat(panel, '爆发力', character.burst, 50);
        makeLabel('DescriptionHeading', panel, '角色介绍', 22, CYAN).setPosition(-106, 0, 1);
        const description = makeLabel('Description', panel, character.description, 17, WHITE);
        description.getComponent(UITransform)!.setContentSize(278, 76);
        description.getComponent(Label)!.overflow = Label.Overflow.SHRINK;
        description.setPosition(0, -50, 1);
        makeLabel('SkillHeading', panel, '技能', 22, CYAN).setPosition(-128, -112, 1);
        const skill = makeRect('SkillCard', panel, 278, 72, PANEL_ALT);
        skill.setPosition(0, -168, 1);
        makeLabel('SkillName', skill, character.skillName, 19, WHITE).setPosition(-44, 14, 1);
        const skillDesc = makeLabel('SkillDescription', skill, character.skillDescription, 14, uiColor(214, 234, 246));
        skillDesc.getComponent(UITransform)!.setContentSize(246, 30);
        skillDesc.getComponent(Label)!.overflow = Label.Overflow.SHRINK;
        skillDesc.setPosition(0, -17, 1);
    }

    private makeStat(panel: Node, name: string, value: number, y: number) {
        const label = makeLabel(`${name}Label`, panel, name, 20, WHITE);
        label.getComponent(UITransform)!.setContentSize(72, 28);
        label.setPosition(-118, y, 1);
        const track = makeRect(`${name}Track`, panel, 188, 16, uiColor(24, 55, 90, 255));
        track.setPosition(18, y, 1);
        const fill = makeRect(`${name}Fill`, track, 184 * Math.max(0, Math.min(100, value)) / 100, 10, CYAN);
        fill.setPosition(-92 + (184 * value / 100) / 2, 0, 2);
        const valueLabel = makeLabel(`${name}Value`, panel, `${value}`, 16, WHITE);
        valueLabel.getComponent(UITransform)!.setContentSize(44, 24);
        valueLabel.setPosition(132, y, 2);
    }

    private buildRaceModeList(parent: Node) {
        // Right-hand vertical list of race modes. A visible list (rather than a
        // prev/next switcher) scales naturally as more modes are added later.
        const selected = getSelectedRaceDifficulty();
        const centerX = this._width / 2 - 165 - 32; // mirrors the left info panel offset
        const headingY = this._height / 2 - HEADBAR_TOP_SAFE_AREA - 6;
        makeLabel('RaceModeHeading', parent, '比赛模式', 24, CYAN).setPosition(centerX, headingY, 3);
        const listTopY = headingY - 70;
        const cardPitch = 84;
        RACE_DIFFICULTY_OPTIONS.forEach((option, index) => {
            const isSel = option.id === selected;
            const card = makeButton(`RaceMode${option.id}`, parent, 300, 72, isSel ? CYAN : PANEL, option.label);
            card.setPosition(centerX, listTopY - index * cardPitch, 3);
            const label = card.getChildByName('Label')?.getComponent(Label);
            if (label) {
                label.fontSize = 22;
                label.color = isSel ? uiColor(6, 35, 54) : WHITE;
                label.getComponent(UITransform)!.setContentSize(280, 28);
                label.node.setPosition(0, 16, 1);
           }
            const desc = makeLabel('Description', card, raceDifficultyDescription(option.id), 14, isSel ? uiColor(6, 35, 54, 220) : uiColor(215, 238, 248));
            desc.getComponent(UITransform)!.setContentSize(280, 28);
            desc.getComponent(Label)!.overflow = Label.Overflow.SHRINK;
            desc.setPosition(0, -16, 1);
            card.on(Button.EventType.CLICK, () => { setSelectedRaceDifficulty(option.id); this.showCharacterSelect(); });
        });

        // Primary start button: bottom-right corner, same family as the start
        // menu's main action so the two screens read as one flow.
        const start = makeButton('StartRaceButton', parent, 240, 96, CYAN, '开始比赛');
        start.setPosition(this._width / 2 - 32 - 120, -this._height / 2 + 12 + 48, 3);
        const startLabel = start.getChildByName('Label')?.getComponent(Label);
        if (startLabel) {
            startLabel.fontSize = 28;
            startLabel.color = uiColor(6, 35, 54);
        }
        start.on(Button.EventType.CLICK, () => {
            const chosen = getSelectedRaceDifficulty();
            setRaceDifficulty(chosen);
            this._callbacks.onStartRace();
        });
    }

    private showRaceSelect() {
        this._content?.destroy();
        this._content = makeUiNode('PrepareRaceSelectionContent', this._root!);
        this._previewRoot!.active = false;
        makeLabel('RaceSelectTitle', this._content, '选择比赛', 42, WHITE).setPosition(0, this._height / 2 - 74, 2);
        makeLabel('RaceSelectHint', this._content, '选择赛事难度后即可开始比赛', 20, uiColor(210, 234, 246)).setPosition(0, this._height / 2 - 120, 2);
        const difficulty = getSelectedRaceDifficulty();
        const cardY = 48;
        RACE_DIFFICULTY_OPTIONS.forEach((option, index) => {
            const selected = option.id === difficulty;
            const card = makeButton(`RaceDifficulty${option.id}`, this._content!, 250, 166, selected ? CYAN : PANEL, option.label);
            card.setPosition((index - 1) * 290, cardY, 2);
            const label = card.getChildByName('Label')?.getComponent(Label);
            if (label) label.fontSize = 28;
            card.on(Button.EventType.CLICK, () => { setSelectedRaceDifficulty(option.id); this.showRaceSelect(); });
            const desc = makeLabel('Description', card, raceDifficultyDescription(option.id), 15, selected ? uiColor(6, 35, 54) : uiColor(215, 238, 248));
            desc.getComponent(UITransform)!.setContentSize(210, 58);
            desc.getComponent(Label)!.overflow = Label.Overflow.SHRINK;
            desc.setPosition(0, -36, 2);
        });
        const back = makeButton('BackToCharacterButton', this._content, 180, 56, PANEL_ALT, '返回角色');
        back.setPosition(-106, -this._height / 2 + 70, 2);
        back.on(Button.EventType.CLICK, () => this.showCharacterSelect());
        const start = makeButton('StartRaceButton', this._content, 300, 64, CYAN, '开始比赛');
        start.setPosition(160, -this._height / 2 + 70, 2);
        start.on(Button.EventType.CLICK, () => {
            const chosen = getSelectedRaceDifficulty();
            setRaceDifficulty(chosen);
            this._callbacks.onStartRace();
        });
    }

    private ensurePreview() {
        if (this._previewRoot) return;
        const root = new Node('PrepareRacePreviewWorld');
        root.setParent(this._parent.scene!);
        this._previewRoot = root;
        this._preview = root.addComponent(PrepareRaceCharacterPreview);
    }
}

function raceDifficultyDescription(difficulty: RaceDifficulty): string {
    if (difficulty === 'beginner') return '节奏宽松，适合熟悉操作。';
    if (difficulty === 'championship') return '高压对抗，挑战极限表现。';
    return '平衡对抗，考验节奏与判断。';
}

// Shared screen title: bold italic-ish white text with a dark drop shadow and
// an orange speed slash, matching the logo's slanted style.
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
    slash.getComponent(UITransform)!.setContentSize(12, 40);
    const labelWidth = label.string.length * 40;
    slash.setPosition(labelWidth / 2 + 26, y, 2);
    const gfx = slash.addComponent(Graphics);
    gfx.fillColor = ACCENT;
    gfx.moveTo(-6, -20);
    gfx.lineTo(2, -20);
    gfx.lineTo(6, 20);
    gfx.lineTo(-2, 20);
    gfx.close();
    gfx.fill();
    return title;
}
