import { Button, EventTouch, Graphics, Label, Mask, Node, resources, ScrollView, Sprite, SpriteFrame, Texture2D, UITransform } from 'cc';
import { RaceDifficulty, RACE_DIFFICULTY_OPTIONS, setRaceDifficulty } from '../core/GameBalance';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import {
    cyclePlayerColorScheme,
    cyclePlayerSkinTone,
    findPlayerCharacter,
    getPlayerCharacterSelection,
    getSelectedRaceDifficulty,
    PLAYER_CHARACTER_DEFINITIONS,
    PLAYER_CHARACTER_SLOT_COUNT,
    selectPlayerCharacter,
    selectedPlayerColorScheme,
    selectedPlayerSkinTone,
    setSelectedRaceDifficulty,
} from '../app/PlayerCharacterConfig';
import { PrepareRaceCharacterPreview } from '../app/PrepareRaceCharacterPreview';
import { getProgressionManager } from '../progression/ProgressionManager';
import { PROGRESSION_BALANCE, xpForLevel } from '../progression/ProgressionBalance';
import { makeButton, makeLabel, makeRect, makeUiNode, uiColor } from './RuntimeUiFactory';

export type PrepareRaceFlowCallbacks = {
    onBack: () => void;
    onStartRace: () => void;
};

const PANEL = uiColor(8, 31, 62, 226);
const PANEL_ALT = uiColor(18, 60, 104, 238);
const CYAN = uiColor(20, 205, 229, 255);
const MUTED = uiColor(99, 123, 150, 225);
const WHITE = uiColor(242, 250, 255, 255);

export class PrepareRaceFlow {
    private _root: Node | null = null;
    private _content: Node | null = null;
    private _previewRoot: Node | null = null;
    private _preview: PrepareRaceCharacterPreview | null = null;
    // The preview component owns the RenderTexture.  This UI SpriteFrame only
    // presents that live texture as the flattened shadow under its feet.
    private _shadowSprite: Sprite | null = null;
    private _previewTouchX = 0;
    private _skinToneButtonLabel: Label | null = null;
    private _paletteButtonLabel: Label | null = null;

    constructor(
        private readonly _parent: Node,
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
        resources.load(RESOURCE_PATHS.prepareRaceBackground, Texture2D, (error, texture) => {
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
        makeLabel('PrepareRaceTitle', parent, '准备比赛', 42, WHITE).setPosition(0, this._height / 2 - 52, 2);
        const back = makeButton('PrepareRaceBackButton', parent, 112, 42, PANEL_ALT, '返回');
        // Reserve a real top-left safe area for navigation. The roster begins
        // below this band, so these two interactive regions never overlap.
        back.setPosition(-this._width / 2 + 92, this._height / 2 - 42, 2);
        back.on(Button.EventType.CLICK, () => this._callbacks.onBack());
        this.buildRealtimeCharacterShadow(parent);
        this.buildRoster(parent);
        this.buildCharacterControls(parent);
        this.buildCharacterDetail(parent);
        // Keep the central foreground clear for the larger character preview.
        // The action belongs with the selected character's information, at the
        // lower-right edge of that panel.
        const chooseRace = makeButton('ChooseRaceButton', parent, 278, 62, CYAN, '选择比赛');
        chooseRace.setPosition(this._width / 2 - 197, -this._height / 2 + 64, 3);
        chooseRace.on(Button.EventType.CLICK, () => this.showRaceSelect());
        const rotateArea = makeUiNode('CharacterRotateArea', parent);
        // Keep the drag surface strictly inside the central character area so
        // it cannot intercept the skin/palette buttons at either edge.
        rotateArea.getComponent(UITransform)!.setContentSize(240, 440);
        rotateArea.setPosition(0, 12, 2);
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
        // current pose (including the arm-stretching action).
        // A soft contact shadow guarantees a visible grounding cue under the
        // overhead changing-room light. The RenderTexture silhouette below is
        // layered over it when the target platform supports that capture.
        const contact = makeUiNode('CharacterContactShadow', parent);
        contact.getComponent(UITransform)!.setContentSize(170, 40);
        // Matches the selected swimmer's projected foot level in the
        // locker-room framing, rather than the centre of the bright floor area.
        contact.setPosition(0, -248, 1);
        const contactGraphics = contact.addComponent(Graphics);
        contactGraphics.fillColor = uiColor(4, 13, 26, 78);
        contactGraphics.ellipse(0, 0, 82, 17);
        contactGraphics.fill();
        contactGraphics.fillColor = uiColor(2, 8, 16, 104);
        contactGraphics.ellipse(0, 0, 54, 10);
        contactGraphics.fill();

        const shadow = makeUiNode('CharacterRealtimeShadow', parent);
        shadow.getComponent(UITransform)!.setContentSize(166, 46);
        shadow.setPosition(0, -248, 2);
        const sprite = shadow.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this._shadowSprite = sprite;
    }

    private buildRoster(parent: Node) {
        const panelWidth = 276;
        // Leave a 100px navigation band above the list. The previous full
        // height panel extended into the back button's hit area.
        const panelHeight = this._height - 190;
        const panel = makeRect('CharacterRosterPanel', parent, panelWidth, panelHeight, PANEL);
        panel.setPosition(-this._width / 2 + panelWidth / 2 + 32, -15, 2);
        makeLabel('RosterTitle', panel, '角色列表', 26, WHITE).setPosition(0, panelHeight / 2 - 34, 1);
        // Standard Cocos hierarchy: View (ScrollView + Mask) -> Content. The
        // View's transform is the only visible/interactive scrolling area;
        // cards never use the entire roster panel as their scroll bounds.
        const viewportWidth = panelWidth - 28;
        // Explicit inner rectangle: 60px below the title/header and 30px
        // above the panel bottom. This is the actual visible ScrollView area.
        const viewportHeight = panelHeight - 130;
        const viewNode = makeUiNode('RosterScrollView', panel);
        viewNode.getComponent(UITransform)!.setContentSize(viewportWidth, viewportHeight);
        viewNode.setPosition(0, -30, 1);
        const scrollView = viewNode.addComponent(ScrollView);
        scrollView.horizontal = false;
        scrollView.vertical = true;
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
        const rowCount = PLAYER_CHARACTER_SLOT_COUNT / 2;
        const rowPitch = 74;
        const slotHeight = 64;
        const contentHeight = rowCount * rowPitch + 16;
        content.getComponent(UITransform)!.setContentSize(viewportWidth, contentHeight);
        content.setPosition(0, (contentHeight - viewportHeight) * 0.5, 1);
        scrollView.content = content;
        this.renderRoster(content, contentHeight, rowPitch, slotHeight);
        scrollView.scrollToTop(0);
    }

    private renderRoster(content: Node, contentHeight: number, rowPitch: number, slotHeight: number) {
        content.removeAllChildren();
        const slotWidth = 112;
        const selected = getPlayerCharacterSelection().characterId;
        for (let row = 0; row < PLAYER_CHARACTER_SLOT_COUNT / 2; row++) {
            for (let column = 0; column < 2; column++) {
                const index = row * 2 + column;
                const character = PLAYER_CHARACTER_DEFINITIONS[index];
                const unlocked = !!character?.unlocked;
                const active = character?.id === selected;
                const fill = active ? CYAN : unlocked ? PANEL_ALT : MUTED;
                const slot = makeButton(`CharacterSlot${index}`, content, slotWidth, slotHeight, fill, unlocked ? character.name : '🔒');
                slot.setPosition(
                    (column === 0 ? -1 : 1) * 61,
                    contentHeight / 2 - slotHeight / 2 - 8 - row * rowPitch,
                    1,
                );
                const label = slot.getChildByName('Label')?.getComponent(Label);
                if (label) label.fontSize = unlocked ? 17 : 24;
                if (unlocked) {
                    slot.on(Button.EventType.CLICK, () => {
                        selectPlayerCharacter(character.id);
                        this.showCharacterSelect();
                    });
                }
            }
        }
    }

    private buildCharacterControls(parent: Node) {
        const skin = selectedPlayerSkinTone();
        const palette = selectedPlayerColorScheme();
        const skinButton = makeButton('SkinToneButton', parent, 170, 50, PANEL_ALT, `肤色：${skin.label}`);
        skinButton.setPosition(-208, this._height / 2 - 140, 2);
        this._skinToneButtonLabel = skinButton.getChildByName('Label')?.getComponent(Label) ?? null;
        skinButton.on(Button.EventType.CLICK, () => {
            cyclePlayerSkinTone();
            this.refreshAppearanceControls();
            this._preview?.applyAppearance();
        });
        const colorButton = makeButton('PaletteButton', parent, 170, 50, PANEL_ALT, `配色：${palette.label}`);
        colorButton.setPosition(-208, this._height / 2 - 202, 2);
        this._paletteButtonLabel = colorButton.getChildByName('Label')?.getComponent(Label) ?? null;
        colorButton.on(Button.EventType.CLICK, () => {
            cyclePlayerColorScheme();
            this.refreshAppearanceControls();
            this._preview?.applyAppearance();
        });
    }

    private refreshAppearanceControls() {
        const skin = selectedPlayerSkinTone();
        const palette = selectedPlayerColorScheme();
        if (this._skinToneButtonLabel?.isValid) {
            this._skinToneButtonLabel.string = `肤色：${skin.label}`;
        }
        if (this._paletteButtonLabel?.isValid) {
            this._paletteButtonLabel.string = `配色：${palette.label}`;
        }
    }

    private buildCharacterDetail(parent: Node) {
        const character = findPlayerCharacter();
        if (!character) return;
        const panelWidth = 330;
        // Shorten this panel to leave a dedicated lower-right button area,
        // while shifting it upward keeps its title aligned with the roster.
        const panelHeight = this._height - 220;
        const panel = makeRect('CharacterDetailPanel', parent, panelWidth, panelHeight, PANEL);
        panel.setPosition(this._width / 2 - panelWidth / 2 - 32, 51, 2);
        makeLabel('CharacterName', panel, character.name, 32, WHITE).setPosition(0, panelHeight / 2 - 42, 1);
        // Progression: show current level and XP progress for this character.
        const progression = getProgressionManager();
        const level = progression.getCharacterLevel(character.id);
        const xp = progression.getCharacterXp(character.id);
        const xpNeeded = level >= PROGRESSION_BALANCE.maxLevel ? 0 : xpForLevel(level);
        makeLabel('LevelLabel', panel, 'Lv.' + level + (level >= PROGRESSION_BALANCE.maxLevel ? ' (满级)' : ''), 18, uiColor(150, 200, 255)).setPosition(0, panelHeight / 2 - 70, 1);
        if (xpNeeded > 0) {
            const xpBarWidth = 220;
            const xpBar = makeUiNode('XpBar', panel);
            xpBar.getComponent(UITransform)!.setContentSize(xpBarWidth, 10);
            xpBar.setPosition(18, panelHeight / 2 - 92, 1);
            const xpGfx = xpBar.addComponent(Graphics);
            const xpRatio = Math.max(0, Math.min(1, xp / xpNeeded));
            xpGfx.fillColor = uiColor(24, 55, 90, 255);
            xpGfx.rect(-xpBarWidth / 2, -5, xpBarWidth, 10);
            xpGfx.fill();
            xpGfx.fillColor = uiColor(120, 220, 130, 255);
            xpGfx.rect(-xpBarWidth / 2, -5, xpBarWidth * xpRatio, 10);
            xpGfx.fill();
            makeLabel('XpText', panel, 'XP ' + xp + '/' + xpNeeded, 13, uiColor(140, 160, 180)).setPosition(18, panelHeight / 2 - 112, 1);
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
