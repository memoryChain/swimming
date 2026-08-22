// Unified top resource bar for non-race screens (login, prepare-race, etc.). Shows
// the player's in-game resources — phase 1 has one: 游泳卡 (swim cards) — and offers a
// "+" button that triggers the watch-ad reward flow. Parent it directly to the
// screen Canvas so it persists across non-race sub-screens on that canvas.
//
// It subscribes to PlayerData and refreshes automatically whenever the balance
// changes. Do NOT add it to the race HUD.

import { Button, Label, Node, resources, Sprite, SpriteFrame, Texture2D, UITransform } from 'cc';
import { makeButton, makeLabel, makeUiNode, uiColor } from './RuntimeUiFactory';
import { PlayerProfile } from '../backend/PlayerProfile';
import { PlayerData } from '../backend/PlayerData';
import { UI_STYLE } from './UIStyle';
import { RESOURCE_PATHS } from '../core/ResourcePaths';

export interface ResourceHeadBarOptions {
    // Called when the player taps "+" to gain resources by watching an ad.
    onAddCoins?: () => void;
    // Called when the player taps their identity (avatar + name) to edit it.
    onEditIdentity?: () => void;
    // Called when the player taps the settings gear (shown only when provided).
    onOpenSettings?: () => void;
}

const BAR_WIDTH = 190;
const BAR_HEIGHT = 52;
const BACK_WIDTH = 84;
const BACK_HEIGHT = 52;
const IDENTITY_WIDTH = 253;
const IDENTITY_HEIGHT = 80;
const EDGE_PADDING = 35;
const RIGHT_PADDING = 31;
const BACK_GAP = 12;

// Vertical band (px from the top of the design-resolution canvas) reserved by the
// headbar. Non-race screens should keep their top-most UI at or below
// `designHeight/2 - HEADBAR_TOP_SAFE_AREA` so nothing hides behind the headbar.
export const HEADBAR_TOP_SAFE_AREA = EDGE_PADDING + BAR_HEIGHT + 8;

export class ResourceHeadBar {
    private _root: Node | null = null;
    private _countLabel: Label | null = null;
    private _backButton: Node | null = null;
    private _backHandler: (() => void) | null = null;
    private _identity: Node | null = null;
    private _nameLabel: Label | null = null;
    // Identity X when the back button is hidden vs shown (it shifts right to make
    // room for the back button, and is NEVER hidden).
    private _identityXDefault = 0;
    private _identityXWithBack = 0;
    private _identityY = 0;
    private _onChange = (profile: PlayerProfile) => this.refresh(profile);

    build(parent: Node, designWidth: number, designHeight: number, options: ResourceHeadBarOptions = {}): Node {
        this.dispose();
        const root = makeUiNode('ResourceHeadBar', parent);
        root.getComponent(UITransform)!.setContentSize(designWidth, designHeight);
        this._root = root;

        const topY = designHeight / 2 - 12 - IDENTITY_HEIGHT / 2;

        // Back button, top-left corner. Compact; hidden until a screen provides a back
        // target via setBack(). It sits to the LEFT of the identity (which shifts right
        // to make room) so the avatar + nickname stay visible on every non-race screen.
        const back = makeButton('BackButton', root, BACK_WIDTH, BACK_HEIGHT, UI_STYLE.panelAlt, '返回');
        back.setPosition(-designWidth / 2 + EDGE_PADDING + BACK_WIDTH / 2, topY, 0);
        back.active = false;
        back.on(Node.EventType.TOUCH_END, () => this._backHandler?.());
        this._backButton = back;

        // Player identity (avatar + in-game nickname), top-left. Tappable to edit.
        // Always visible; shifts right when the back button appears.
        this._identityXDefault = -designWidth / 2 + EDGE_PADDING + IDENTITY_WIDTH / 2;
        this._identityXWithBack = -designWidth / 2 + EDGE_PADDING + BACK_WIDTH + BACK_GAP + IDENTITY_WIDTH / 2;
        this._identityY = topY;
        const identity = makeUiNode('Identity', root);
        identity.getComponent(UITransform)!.setContentSize(IDENTITY_WIDTH, IDENTITY_HEIGHT);
        identity.setPosition(this._identityXDefault, topY, 0);
        makeLoginSprite('Plate', identity, RESOURCE_PATHS.loginUi.playerPlate, IDENTITY_WIDTH, IDENTITY_HEIGHT, 0, 0);
        identity.on(Node.EventType.TOUCH_END, () => options.onEditIdentity?.());
        makeLoginSprite('Avatar', identity, RESOURCE_PATHS.loginUi.avatar, 75, 75, -89, 0);
        const nameNode = makeLabel('Name', identity, '', 20, uiColor(240, 250, 255, 255));
        const nameLabel = nameNode.getComponent(Label)!;
        nameLabel.fontFamily = 'PingFang SC';
        nameLabel.lineHeight = 26;
        nameLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        nameLabel.verticalAlign = Label.VerticalAlign.CENTER;
        nameLabel.overflow = Label.Overflow.SHRINK;
        nameNode.getComponent(UITransform)!.setContentSize(150, 36);
        nameNode.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
        nameNode.setPosition(-38.5, 0, 1);
        this._nameLabel = nameLabel;
        this._identity = identity;

        const pill = makeUiNode('ResourcePill', root);
        pill.getComponent(UITransform)!.setContentSize(BAR_WIDTH, BAR_HEIGHT);
        pill.setPosition(designWidth / 2 - RIGHT_PADDING - BAR_WIDTH / 2, topY, 0);
        makeLoginSprite('Plate', pill, RESOURCE_PATHS.loginUi.currencyPlate, BAR_WIDTH, BAR_HEIGHT, 0, 0);
        makeLoginSprite('CurrencyIcon', pill, RESOURCE_PATHS.loginUi.currencyIcon, 36, 36, -65, 0);

        // "游泳卡 N" count text.
        const countNode = makeLabel('Count', pill, '', 22, uiColor(240, 250, 255, 255));
        const countLabel = countNode.getComponent(Label)!;
        countLabel.fontFamily = 'PingFang SC';
        countLabel.lineHeight = 30;
        countLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        countLabel.verticalAlign = Label.VerticalAlign.CENTER;
        countLabel.overflow = Label.Overflow.SHRINK;
        countNode.getComponent(UITransform)!.setContentSize(82, 36);
        countNode.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
        countNode.setPosition(-34, 0, 1);
        this._countLabel = countLabel;

        const addButton = makeUiNode('Add', pill);
        addButton.getComponent(UITransform)!.setContentSize(48, 48);
        addButton.setPosition(68, 0, 1);
        makeLoginSprite('Icon', addButton, RESOURCE_PATHS.loginUi.plusIcon, 37, 37, 0, 0);
        addButton.addComponent(Button).transition = Button.Transition.NONE;
        addButton.on(Node.EventType.TOUCH_END, () => options.onAddCoins?.());

        // Settings entry, left of the resource pill. Matches the headbar panels:
        // same dark rounded plate + faint cyan outline (only when a handler is given).
        if (options.onOpenSettings) {
            const settingsButton = makeUiNode('SettingsButton', root);
            settingsButton.getComponent(UITransform)!.setContentSize(52, 52);
            settingsButton.setPosition(designWidth / 2 - RIGHT_PADDING - BAR_WIDTH - 8 - 26, topY, 0);
            makeLoginSprite('Plate', settingsButton, RESOURCE_PATHS.loginUi.settingsPlate, 52, 52, 0, 0);
            makeLoginSprite('Icon', settingsButton, RESOURCE_PATHS.loginUi.settingsIcon, 28, 28, 0, 0);
            const settingsBtn = settingsButton.addComponent(Button);
            settingsBtn.target = settingsButton;
            settingsBtn.interactable = true;
            settingsBtn.transition = Button.Transition.NONE;
            settingsButton.on(Node.EventType.TOUCH_END, () => options.onOpenSettings?.());
        }

        PlayerData.onChange(this._onChange);
        this.refresh(PlayerData.profile);
        return root;
    }

    // Show/hide and wire the integrated back button. Pass a handler to show it, or
    // null to hide it (top-level screens with no back target). The identity stays
    // visible either way — it just shifts right to make room for the back button.
    setBack(handler: (() => void) | null): void {
        this._backHandler = handler;
        const showBack = !!handler;
        if (this._backButton?.isValid) {
            this._backButton.active = showBack;
        }
        if (this._identity?.isValid) {
            this._identity.setPosition(showBack ? this._identityXWithBack : this._identityXDefault, this._identityY, 0);
        }
    }

    // Update the displayed identity from the in-game profile.
    private refreshIdentity(profile: PlayerProfile): void {
        if (this._nameLabel?.isValid && this._nameLabel.string !== profile.nickName) {
            this._nameLabel.string = profile.nickName;
        }
    }

    refresh(profile: PlayerProfile): void {
        const count = `${profile.coins}`;
        if (this._countLabel && this._countLabel.string !== count) {
            this._countLabel.string = count;
        }
        this.refreshIdentity(profile);
    }

    setVisible(visible: boolean): void {
        if (this._root?.isValid) {
            this._root.active = visible;
        }
    }

    dispose(): void {
        PlayerData.offChange(this._onChange);
        if (this._root?.isValid) {
            this._root.destroy();
        }
        this._root = null;
        this._countLabel = null;
        this._backButton = null;
        this._backHandler = null;
        this._identity = null;
        this._nameLabel = null;
    }
}

function makeLoginSprite(name: string, parent: Node, path: string, width: number, height: number, x: number, y: number) {
    const node = makeUiNode(name, parent);
    node.getComponent(UITransform)!.setContentSize(width, height);
    node.setPosition(x, y, 0);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.trim = false;
    resources.load(path, Texture2D, (error, texture) => {
        if (!error && texture && node.isValid && sprite.isValid) {
            const frame = new SpriteFrame();
            frame.texture = texture;
            sprite.spriteFrame = frame;
        }
    });
    return node;
}

