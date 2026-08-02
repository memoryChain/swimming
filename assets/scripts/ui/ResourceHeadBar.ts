// Unified top resource bar for non-race screens (login, prepare-race, etc.). Shows
// the player's in-game resources — phase 1 has one: 游泳卡 (swim cards) — and offers a
// "+" button that triggers the watch-ad reward flow. Parent it directly to the
// screen Canvas so it persists across non-race sub-screens on that canvas.
//
// It subscribes to PlayerData and refreshes automatically whenever the balance
// changes. Do NOT add it to the race HUD.

import { Button, Graphics, Label, Node, UITransform } from 'cc';
import { makeButton, makeLabel, makeRect, makeRoundedRect, makeUiNode, uiColor } from './RuntimeUiFactory';
import { CURRENCY, PlayerProfile } from '../backend/PlayerProfile';
import { avatarColorOf } from '../backend/IdentityConfig';
import { PlayerData } from '../backend/PlayerData';
import { UI_STYLE } from './UIStyle';

const PILL_FILL = UI_STYLE.panel;
const PILL_OUTLINE = UI_STYLE.cyanOutline;

export interface ResourceHeadBarOptions {
    // Called when the player taps "+" to gain resources by watching an ad.
    onAddSwimCards?: () => void;
    // Called when the player taps their identity (avatar + name) to edit it.
    onEditIdentity?: () => void;
    // Called when the player taps the settings gear (shown only when provided).
    onOpenSettings?: () => void;
}

const BAR_WIDTH = 236;
const BAR_HEIGHT = 60;
const BACK_WIDTH = 84;
const BACK_HEIGHT = 52;
const IDENTITY_WIDTH = 200;
const AVATAR_SIZE = 40;
const EDGE_PADDING = 24;
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
    private _avatarGfx: Graphics | null = null;
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

        const topY = designHeight / 2 - EDGE_PADDING - BAR_HEIGHT / 2;

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
        identity.getComponent(UITransform)!.setContentSize(IDENTITY_WIDTH, BAR_HEIGHT);
        identity.setPosition(this._identityXDefault, topY, 0);
        makeRoundedRect('Bg', identity, IDENTITY_WIDTH, BAR_HEIGHT, PILL_FILL, 10, PILL_OUTLINE, 1.5);
        identity.on(Node.EventType.TOUCH_END, () => options.onEditIdentity?.());
        // Circular avatar; color comes from the chosen avatarId (redrawn on refresh).
        const avatarBg = makeUiNode('Avatar', identity);
        avatarBg.getComponent(UITransform)!.setContentSize(AVATAR_SIZE, AVATAR_SIZE);
        avatarBg.setPosition(-IDENTITY_WIDTH / 2 + 30, 0, 1);
        this._avatarGfx = avatarBg.addComponent(Graphics);
        const nameNode = makeLabel('Name', identity, '', 20, uiColor(240, 250, 255, 255));
        const nameLabel = nameNode.getComponent(Label)!;
        nameLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        nameLabel.overflow = Label.Overflow.SHRINK;
        nameNode.getComponent(UITransform)!.setContentSize(IDENTITY_WIDTH - 74, BAR_HEIGHT);
        nameNode.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
        nameNode.setPosition(-IDENTITY_WIDTH / 2 + 56, 0, 1);
        this._nameLabel = nameLabel;
        this._identity = identity;

        // Resource pill, top-right (keeps the top-left free for navigation).
        const pill = makeRoundedRect('ResourcePill', root, BAR_WIDTH, BAR_HEIGHT, PILL_FILL, 10, PILL_OUTLINE, 1.5);
        pill.setPosition(designWidth / 2 - EDGE_PADDING - BAR_WIDTH / 2, topY, 0);

        // Swim-card icon (simple colored square placeholder; swap for a sprite later).
        const icon = makeRect('Icon', pill, 34, 34, UI_STYLE.cyan);
        icon.setPosition(-BAR_WIDTH / 2 + 30, 0, 0);

        // "游泳卡 N" count text.
        const countNode = makeLabel('Count', pill, '', 22, uiColor(240, 250, 255, 255));
        const countLabel = countNode.getComponent(Label)!;
        countLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        countNode.getComponent(UITransform)!.setContentSize(120, BAR_HEIGHT);
        countNode.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
        countNode.setPosition(-BAR_WIDTH / 2 + 54, 0, 0);
        this._countLabel = countLabel;

        // "+" button: watch an ad to gain swim cards.
        const addButton = makeButton('Add', pill, 44, 44, UI_STYLE.accent, '+');
        addButton.setPosition(BAR_WIDTH / 2 - 32, 0, 0);
        addButton.on(Node.EventType.TOUCH_END, () => options.onAddSwimCards?.());

        // Settings entry, left of the resource pill. Matches the headbar panels:
        // same dark rounded plate + faint cyan outline (only when a handler is given).
        if (options.onOpenSettings) {
            const settingsButton = makeRoundedRect('SettingsButton', root, 96, BAR_HEIGHT, PILL_FILL, 10, PILL_OUTLINE, 1.5);
            settingsButton.setPosition(designWidth / 2 - EDGE_PADDING - BAR_WIDTH - 12 - 48, topY, 0);
            const labelNode = makeLabel('Label', settingsButton, '设置', 20, uiColor(240, 250, 255));
            labelNode.getComponent(UITransform)!.setContentSize(96, BAR_HEIGHT);
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
        if (this._nameLabel?.isValid) {
            this._nameLabel.string = profile.nickName;
        }
        if (this._avatarGfx?.isValid) {
            const [r, g, b] = avatarColorOf(profile.avatarId);
            this._avatarGfx.clear();
            this._avatarGfx.fillColor = uiColor(r, g, b, 255);
            this._avatarGfx.circle(0, 0, AVATAR_SIZE / 2);
            this._avatarGfx.fill();
        }
    }

    refresh(profile: PlayerProfile): void {
        if (this._countLabel) {
            this._countLabel.string = `${CURRENCY.swimCard.label} ${profile.swimCards}`;
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
        this._avatarGfx = null;
    }
}

