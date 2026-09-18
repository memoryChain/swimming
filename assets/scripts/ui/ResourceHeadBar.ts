// Unified top resource bar for non-race screens (login, prepare-race, etc.). Shows
// the player's shared coins and breakthrough gems. A dedicated supply icon sits
// to their left, while both resource pills remain shortcuts to the same station.
// Parent it directly to the
// screen Canvas so it persists across non-race sub-screens on that canvas.
//
// It subscribes to PlayerData and refreshes automatically whenever the balance
// changes. Do NOT add it to the race HUD.

import { Button, Label, LabelOutline, Node, Sprite, SpriteFrame, Texture2D, UITransform, view } from 'cc';
import { makeButton, makeLabel, makeScreenEdgeGroup, makeUiNode, uiColor } from './RuntimeUiFactory';
import { dailyShopCycleKey, PlayerProfile } from '../backend/PlayerProfile';
import { PlayerData } from '../backend/PlayerData';
import { UI_STYLE } from './UIStyle';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { platform } from '../platform/PlatformManager';
import { loadAvatarSpriteFrame, loadAvatarUiSpriteFrame } from './AvatarUiAssets';
import { styleCurrencyNumberLabel, styleProjectUiLabel } from './ProjectUiFonts';

export interface ResourceHeadBarOptions {
    // 补给箱与两种资源胶囊都进入每日补给站。
    onOpenShop?: () => void;
    // Called when the player taps their identity (avatar + name) to edit it.
    onEditIdentity?: () => void;
    // Called when the player taps the settings gear (shown only when provided).
    onOpenSettings?: () => void;
}

const BAR_WIDTH = 176;
const BAR_HEIGHT = 56;
const BAR_GAP = 10;
const TOP_ENTRY_WIDTH = 82;
const TOP_ENTRY_HEIGHT = 90;
const TOP_ENTRY_ICON_SIZE = 56;
const TOP_ENTRY_GAP = 12;
const BACK_WIDTH = 84;
const BACK_HEIGHT = 52;
const IDENTITY_WIDTH = 227;
const IDENTITY_HEIGHT = 86;
const EDGE_PADDING = 33;
const RIGHT_PADDING = 27;
const RIGHT_PLATFORM_CONTROL_RESERVE = 92;
const BACK_GAP = 12;
// The authored 227x86 top-player artwork places the avatar ring at source x=42.5,
// which is -71px from the plate center. Keep every overlay on that exact center.
const IDENTITY_AVATAR_X = -71;

// Vertical band (px from the top of the design-resolution canvas) reserved by the
// headbar. Non-race screens should keep their top-most UI at or below
// `designHeight/2 - HEADBAR_TOP_SAFE_AREA` so nothing hides behind the headbar.
export const HEADBAR_TOP_SAFE_AREA = 112;

export class ResourceHeadBar {
    private _root: Node | null = null;
    private _countLabel: Label | null = null;
    private _gemCountLabel: Label | null = null;
    private _shopBadge: Node | null = null;
    private _supplyEntry: Node | null = null;
    private _backButton: Node | null = null;
    private _backHandler: (() => void) | null = null;
    private _identity: Node | null = null;
    private _nameLabel: Label | null = null;
    private _avatarSprite: Sprite | null = null;
    private _avatarId = '';
    private _cycleTimer: ReturnType<typeof setInterval> | null = null;
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
        const left = makeScreenEdgeGroup('HeadBarLeft', root, 'left', designWidth, designHeight, 8, false);
        const right = makeScreenEdgeGroup('HeadBarRight', root, 'right', designWidth, designHeight, 0, false);

        const topY = designHeight / 2 - 10 - IDENTITY_HEIGHT / 2;
        const nativeRightReserve = Math.ceil(platform().getTopRightReservedRatio() * view.getVisibleSize().width);
        const rightPadding = Math.max(RIGHT_PADDING, RIGHT_PLATFORM_CONTROL_RESERVE, nativeRightReserve + 12);

        // Back button, top-left corner. Compact; hidden until a screen provides a back
        // target via setBack(). It sits to the LEFT of the identity (which shifts right
        // to make room) so the avatar + nickname stay visible on every non-race screen.
        const back = makeButton('BackButton', left, BACK_WIDTH, BACK_HEIGHT, UI_STYLE.panelAlt, '返回');
        back.setPosition(-designWidth / 2 + EDGE_PADDING + BACK_WIDTH / 2, topY, 0);
        back.active = false;
        back.on(Node.EventType.TOUCH_END, () => this._backHandler?.());
        this._backButton = back;

        // Player identity (avatar + in-game nickname), top-left. Tappable to edit.
        // Always visible; shifts right when the back button appears.
        this._identityXDefault = -designWidth / 2 + EDGE_PADDING + IDENTITY_WIDTH / 2;
        this._identityXWithBack = -designWidth / 2 + EDGE_PADDING + BACK_WIDTH + BACK_GAP + IDENTITY_WIDTH / 2;
        this._identityY = topY;
        const identity = makeUiNode('Identity', left);
        identity.getComponent(UITransform)!.setContentSize(IDENTITY_WIDTH, IDENTITY_HEIGHT);
        identity.setPosition(this._identityXDefault, topY, 0);
        makeLoginSprite('Artwork', identity, RESOURCE_PATHS.lobbyUi.topPlayer, IDENTITY_WIDTH, IDENTITY_HEIGHT, 0, 0);
        makeCachedSprite('AvatarBase', identity, RESOURCE_PATHS.avatarPickerUi.avatarBase, 68, 68, IDENTITY_AVATAR_X, 0);
        const avatarNode = makeUiNode('Avatar', identity);
        avatarNode.getComponent(UITransform)!.setContentSize(58, 58);
        avatarNode.setPosition(IDENTITY_AVATAR_X, 0, 2);
        const avatarSprite = avatarNode.addComponent(Sprite);
        avatarSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        avatarSprite.trim = false;
        this._avatarSprite = avatarSprite;
        identity.on(Node.EventType.TOUCH_END, () => options.onEditIdentity?.());
        const nameNode = makeLabel('Name', identity, '', 20, uiColor(240, 250, 255, 255));
        const nameLabel = nameNode.getComponent(Label)!;
        nameLabel.fontFamily = 'PingFang SC';
        nameLabel.isBold = true;
        nameLabel.lineHeight = 26;
        nameLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        nameLabel.verticalAlign = Label.VerticalAlign.CENTER;
        nameLabel.overflow = Label.Overflow.SHRINK;
        nameNode.getComponent(UITransform)!.setContentSize(96, 38);
        nameNode.setPosition(24.5, 0, 1);
        makeLoginSprite('CareerBadge', identity, RESOURCE_PATHS.lobbyB.careerBadge, 42, 39, 99.5, 0);
        this._nameLabel = nameLabel;
        this._identity = identity;

        // Keep the platform-native capsule clear. From left to right the authored
        // group is: supply station, coins, gems, settings, native safe area.
        const rightEdge = designWidth / 2 - rightPadding;
        const settingsX = rightEdge - TOP_ENTRY_WIDTH / 2;
        const gemPillX = settingsX - TOP_ENTRY_WIDTH / 2 - TOP_ENTRY_GAP - BAR_WIDTH / 2;
        const coinPillX = gemPillX - BAR_WIDTH - BAR_GAP;
        const supplyX = coinPillX - BAR_WIDTH / 2 - TOP_ENTRY_GAP - TOP_ENTRY_WIDTH / 2;

        const supply = makeTopEntryButton('SupplyStationButton', right, supplyX, topY,
            '每日补给', RESOURCE_PATHS.shopUi.topEntrySupply, () => options.onOpenShop?.());
        this._supplyEntry = supply;
        const badge = makeLoginSprite('FreeRewardBadge', supply, RESOURCE_PATHS.shopUi.notificationBadge, 24, 24, 27, 32);
        badge.setPosition(27, 32, 4);
        this._shopBadge = badge;

        const pill = makeUiNode('CoinResourcePill', right);
        pill.getComponent(UITransform)!.setContentSize(BAR_WIDTH, BAR_HEIGHT);
        pill.setPosition(coinPillX, topY, 0);
        makeLoginSprite('Artwork', pill, RESOURCE_PATHS.shopUi.resourcePillClean, BAR_WIDTH, BAR_HEIGHT, 0, 0);
        makeLoginSprite('CoinIcon', pill, RESOURCE_PATHS.characterUi.upgradeCurrency, 44, 44, -60, 0);
        pill.addComponent(Button).transition = Button.Transition.NONE;
        pill.on(Node.EventType.TOUCH_END, () => options.onOpenShop?.());

        // "游泳卡 N" count text.
        const countNode = makeLabel('Count', pill, '', 22, uiColor(240, 250, 255, 255));
        const countLabel = countNode.getComponent(Label)!;
        styleCurrencyNumberLabel(countLabel, 28);
        countLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        countLabel.verticalAlign = Label.VerticalAlign.CENTER;
        countLabel.overflow = Label.Overflow.SHRINK;
        countNode.getComponent(UITransform)!.setContentSize(88, 38);
        countNode.setPosition(12, 0, 1);
        this._countLabel = countLabel;

        const gemPill = makeUiNode('GemResourcePill', right);
        gemPill.getComponent(UITransform)!.setContentSize(BAR_WIDTH, BAR_HEIGHT);
        gemPill.setPosition(gemPillX, topY, 0);
        makeLoginSprite('Artwork', gemPill, RESOURCE_PATHS.shopUi.resourcePillClean, BAR_WIDTH, BAR_HEIGHT, 0, 0);
        makeLoginSprite('GemIcon', gemPill, RESOURCE_PATHS.shopUi.gemIcon, 43, 43, -60, 0);
        gemPill.addComponent(Button).transition = Button.Transition.NONE;
        gemPill.on(Node.EventType.TOUCH_END, () => options.onOpenShop?.());
        const gemCountNode = makeLabel('Count', gemPill, '', 22, uiColor(240, 250, 255, 255));
        const gemCountLabel = gemCountNode.getComponent(Label)!;
        styleCurrencyNumberLabel(gemCountLabel, 28);
        gemCountLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        gemCountLabel.verticalAlign = Label.VerticalAlign.CENTER;
        gemCountLabel.overflow = Label.Overflow.SHRINK;
        gemCountNode.getComponent(UITransform)!.setContentSize(88, 38);
        gemCountNode.setPosition(12, 0, 1);
        this._gemCountLabel = gemCountLabel;

        // Settings reuses the exact floating-icon and label treatment so both
        // functional entries read as one authored set without another card layer.
        if (options.onOpenSettings) {
            makeTopEntryButton('SettingsButton', right, settingsX, topY,
                '设置', RESOURCE_PATHS.shopUi.topEntrySettings, () => options.onOpenSettings?.());
        }

        PlayerData.onChange(this._onChange);
        this._cycleTimer = setInterval(() => {
            if (PlayerData.profile.dailyShop.cycleKey !== dailyShopCycleKey()) {
                void PlayerData.refreshProfile();
            }
        }, 30000);
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
            if (this._backButton.active !== showBack) this._backButton.active = showBack;
        }
        if (this._identity?.isValid) {
            const x = showBack ? this._identityXWithBack : this._identityXDefault;
            if (this._identity.position.x !== x || this._identity.position.y !== this._identityY) {
                this._identity.setPosition(x, this._identityY, 0);
            }
        }
    }

    // Character management supplies its own branded page header, so only that
    // screen hides the global identity plate. Currency and settings remain fixed.
    setIdentityVisible(visible: boolean): void {
        if (this._identity?.isValid && this._identity.active !== visible) {
            this._identity.active = visible;
        }
    }

    isIdentityVisible(): boolean {
        return !!this._identity?.isValid && this._identity.active;
    }

    setSupplyEntryVisible(visible: boolean): void {
        if (this._supplyEntry?.isValid && this._supplyEntry.active !== visible) {
            this._supplyEntry.active = visible;
        }
    }

    // Update the displayed identity from the in-game profile.
    private refreshIdentity(profile: PlayerProfile): void {
        if (this._nameLabel?.isValid && this._nameLabel.string !== profile.nickName) {
            this._nameLabel.string = profile.nickName;
        }
        if (this._avatarId !== profile.avatarId) {
            this._avatarId = profile.avatarId;
            const requestedId = profile.avatarId;
            loadAvatarSpriteFrame(requestedId, (frame) => {
                if (frame && this._avatarId === requestedId && this._avatarSprite?.isValid
                    && this._avatarSprite.spriteFrame !== frame) {
                    this._avatarSprite.spriteFrame = frame;
                }
            });
        }
    }

    refresh(profile: PlayerProfile): void {
        const count = `${profile.coins}`;
        if (this._countLabel && this._countLabel.string !== count) {
            this._countLabel.string = count;
        }
        const gems = `${profile.breakthroughGems}`;
        if (this._gemCountLabel && this._gemCountLabel.string !== gems) {
            this._gemCountLabel.string = gems;
        }
        if (this._shopBadge?.isValid) {
            const visible = !profile.dailyShop.freeCoinsClaimed;
            if (this._shopBadge.active !== visible) this._shopBadge.active = visible;
        }
        this.refreshIdentity(profile);
    }

    setVisible(visible: boolean): void {
        if (this._root?.isValid && this._root.active !== visible) {
            this._root.active = visible;
        }
    }

    dispose(): void {
        PlayerData.offChange(this._onChange);
        if (this._cycleTimer) {
            clearInterval(this._cycleTimer);
            this._cycleTimer = null;
        }
        if (this._root?.isValid) {
            this._root.destroy();
        }
        this._root = null;
        this._countLabel = null;
        this._gemCountLabel = null;
        this._shopBadge = null;
        this._supplyEntry = null;
        this._backButton = null;
        this._backHandler = null;
        this._identity = null;
        this._nameLabel = null;
        this._avatarSprite = null;
        this._avatarId = '';
    }
}

function makeTopEntryButton(
    name: string,
    parent: Node,
    x: number,
    y: number,
    text: string,
    iconPath: string,
    onTap: () => void,
): Node {
    const root = makeUiNode(name, parent);
    root.getComponent(UITransform)!.setContentSize(TOP_ENTRY_WIDTH, TOP_ENTRY_HEIGHT);
    root.setPosition(x, y, 0);
    makeLoginSprite('Icon', root, iconPath, TOP_ENTRY_ICON_SIZE, TOP_ENTRY_ICON_SIZE, 0, 9);

    const labelNode = makeLabel('Label', root, text, 20, uiColor(20, 31, 53, 255));
    const label = labelNode.getComponent(Label)!;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    label.enableWrapText = false;
    styleProjectUiLabel(label, 'semibold', 26);
    const outline = labelNode.addComponent(LabelOutline);
    outline.color = uiColor(244, 250, 255, 255);
    outline.width = 1.5;
    labelNode.getComponent(UITransform)!.setContentSize(78, 26);
    labelNode.setPosition(0, -31, 3);

    const button = root.addComponent(Button);
    button.target = root;
    button.interactable = true;
    button.transition = Button.Transition.NONE;
    root.on(Node.EventType.TOUCH_END, onTap);
    return root;
}

function makeLoginSprite(name: string, parent: Node, path: string, width: number, height: number, x: number, y: number) {
    const node = makeUiNode(name, parent);
    node.getComponent(UITransform)!.setContentSize(width, height);
    node.setPosition(x, y, 0);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.trim = false;
    loadRaceAsset(path, Texture2D, (error, texture) => {
        if (!error && texture && node.isValid && sprite.isValid) {
            const frame = new SpriteFrame();
            frame.texture = texture;
            sprite.spriteFrame = frame;
        }
    });
    return node;
}

function makeCachedSprite(name: string, parent: Node, path: string, width: number, height: number, x: number, y: number) {
    const node = makeUiNode(name, parent);
    node.getComponent(UITransform)!.setContentSize(width, height);
    node.setPosition(x, y, 1);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.trim = false;
    loadAvatarUiSpriteFrame(path, (frame) => {
        if (frame && node.isValid && sprite.isValid && sprite.spriteFrame !== frame) {
            sprite.spriteFrame = frame;
        }
    });
    return node;
}

