// Unified top resource bar for non-race screens (login, prepare-race, etc.). Shows
// the player's in-game resources — phase 1 has one: 游泳卡 (swim cards) — and offers a
// "+" button that triggers the watch-ad reward flow. Parent it directly to the
// screen Canvas so it persists across non-race sub-screens on that canvas.
//
// It subscribes to PlayerData and refreshes automatically whenever the balance
// changes. Do NOT add it to the race HUD.

import { Label, Node, UITransform } from 'cc';
import { makeButton, makeLabel, makeRect, makeUiNode, uiColor } from './RuntimeUiFactory';
import { CURRENCY, PlayerProfile } from '../backend/PlayerProfile';
import { PlayerData } from '../backend/PlayerData';

export interface ResourceHeadBarOptions {
    // Called when the player taps "+" to gain resources by watching an ad.
    onAddSwimCards?: () => void;
}

const BAR_WIDTH = 236;
const BAR_HEIGHT = 60;
const BACK_WIDTH = 108;
const BACK_HEIGHT = 52;
const EDGE_PADDING = 24;

// Vertical band (px from the top of the design-resolution canvas) reserved by the
// headbar. Non-race screens should keep their top-most UI at or below
// `designHeight/2 - HEADBAR_TOP_SAFE_AREA` so nothing hides behind the headbar.
export const HEADBAR_TOP_SAFE_AREA = EDGE_PADDING + BAR_HEIGHT + 8;

export class ResourceHeadBar {
    private _root: Node | null = null;
    private _countLabel: Label | null = null;
    private _backButton: Node | null = null;
    private _backHandler: (() => void) | null = null;
    private _onChange = (profile: PlayerProfile) => this.refresh(profile);

    build(parent: Node, designWidth: number, designHeight: number, options: ResourceHeadBarOptions = {}): Node {
        this.dispose();
        const root = makeUiNode('ResourceHeadBar', parent);
        root.getComponent(UITransform)!.setContentSize(designWidth, designHeight);
        this._root = root;

        const topY = designHeight / 2 - EDGE_PADDING - BAR_HEIGHT / 2;

        // Back button, top-left. Hidden until a screen provides a back target via
        // setBack() — the top-level login screen has none, so it stays hidden there.
        const back = makeButton('BackButton', root, BACK_WIDTH, BACK_HEIGHT, uiColor(18, 60, 104, 238), '返回');
        back.setPosition(-designWidth / 2 + EDGE_PADDING + BACK_WIDTH / 2, topY, 0);
        back.active = false;
        back.on(Node.EventType.TOUCH_END, () => this._backHandler?.());
        this._backButton = back;

        // Resource pill, top-right (keeps the top-left free for navigation).
        const pill = makeRect('ResourcePill', root, BAR_WIDTH, BAR_HEIGHT, uiColor(12, 28, 44, 220));
        pill.setPosition(designWidth / 2 - EDGE_PADDING - BAR_WIDTH / 2, topY, 0);

        // Swim-card icon (simple colored square placeholder; swap for a sprite later).
        const icon = makeRect('Icon', pill, 34, 34, uiColor(86, 196, 236, 255));
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
        const addButton = makeButton('Add', pill, 44, 44, uiColor(38, 150, 96, 245), '+');
        addButton.setPosition(BAR_WIDTH / 2 - 32, 0, 0);
        addButton.on(Node.EventType.TOUCH_END, () => options.onAddSwimCards?.());

        PlayerData.onChange(this._onChange);
        this.refresh(PlayerData.profile);
        return root;
    }

    // Show/hide and wire the integrated back button. Pass a handler to show it, or
    // null to hide it (top-level screens with no back target).
    setBack(handler: (() => void) | null): void {
        this._backHandler = handler;
        if (this._backButton?.isValid) {
            this._backButton.active = !!handler;
        }
    }

    refresh(profile: PlayerProfile): void {
        if (this._countLabel) {
            this._countLabel.string = `${CURRENCY.swimCard.label} ${profile.swimCards}`;
        }
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
    }
}
