import {
    Button,
    Color,
    Label,
    Node,
    Sprite,
    SpriteFrame,
    Texture2D,
    UITransform,
} from 'cc';
import { PlayerData } from '../backend/PlayerData';
import {
    dailyShopCycleKey,
    PlayerProfile,
    PROGRESSION_CONFIG,
} from '../backend/PlayerProfile';
import type { DailyShopRewardSlot } from '../backend/IBackend';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { rewardedAdUnitId } from '../platform/AdConfig';
import { platform } from '../platform/PlatformManager';
import {
    fitFullScreenBackgroundCover,
    makeLabel,
    makeScreenEdgeGroup,
    makeUiNode,
    uiColor,
} from './RuntimeUiFactory';
import { styleProjectUiLabel } from './ProjectUiFonts';
import { buildSecondaryPageHeader } from './PrepareRaceFlow';
import { LobbyUiMotion } from './LobbyUiMotion';

type CardView = {
    slot: DailyShopRewardSlot;
    button: Button;
    buttonArtwork: Sprite;
    action: Label;
    videoIcon: Sprite | null;
    pendingTransactionId: string | null;
    adVerified: boolean;
};

const CARD_X = [-320, 0, 320] as const;
const MUTED = uiColor(162, 194, 214);
const DARK = uiColor(16, 38, 61);
const CLAIMED_BUTTON_TINT = uiColor(132, 143, 151);
const CLAIMED_ICON_TINT = uiColor(185, 192, 197);
const CLAIMED_TEXT = uiColor(79, 91, 99);
const NORMAL_TINT = uiColor(255, 255, 255);

/** 非比赛页面的每日补给站。层级只创建一次，刷新只修改文本与按钮状态。 */
export class ShopDailySupplyPanel {
    private _root: Node | null = null;
    private _countdown: Label | null = null;
    private _cards: CardView[] = [];
    private _busySlot: DailyShopRewardSlot | null = null;
    private _timer: ReturnType<typeof setInterval> | null = null;
    private _lastCycleKey = '';
    private _transactionSerial = 0;
    private _backButton: Button | null = null;
    private _motion = new LobbyUiMotion();
    private _closing = false;
    private readonly _onChange = (profile: PlayerProfile) => this.refresh(profile);
    private readonly _toast: (message: string) => void;
    private readonly _onBack: () => void;

    constructor(toast: (message: string) => void, onBack: () => void) {
        this._toast = toast;
        this._onBack = onBack;
    }

    build(parent: Node, designWidth: number, designHeight: number): Node {
        this.dispose();
        this._motion = new LobbyUiMotion();
        const root = makeUiNode('ShopDailySupplyPanel', parent);
        root.getComponent(UITransform)!.setContentSize(designWidth, designHeight);
        this._root = root;

        const background = makeSprite('Background', root, RESOURCE_PATHS.characterUi.background, 1280, 720, 0, 0);
        fitFullScreenBackgroundCover(background, 1280, 720);

        const headerRoot = makeScreenEdgeGroup('SupplyPageHeader', root, 'left', designWidth, designHeight, 0, false);
        const headerMotion = this._motion.group(headerRoot, 'SupplyHeaderMotion', -16);
        const header = buildSecondaryPageHeader(headerMotion, 'Supply', '补给站', () => {
            if (!this._busySlot) this.beginClose();
        });
        this._backButton = header.backButton;
        this._motion.bindButton(header.backNode);

        const sectionRoot = this._motion.group(root, 'SupplySectionMotion', -24);
        makeSprite('SectionDots', sectionRoot, RESOURCE_PATHS.characterUi.headerDots, 132, 97, -438, 191);
        const section = makeLabel('SectionTitle', sectionRoot, '每日补给', 34, DARK);
        const sectionLabel = section.getComponent(Label)!;
        sectionLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        sectionLabel.verticalAlign = Label.VerticalAlign.CENTER;
        sectionLabel.overflow = Label.Overflow.CLAMP;
        styleProjectUiLabel(sectionLabel, 'semibold', 44);
        section.getComponent(UITransform)!.setContentSize(240, 48);
        section.setPosition(-343, 200, 2);

        const cardsRoot = this._motion.group(root, 'SupplyCardsMotion', 24);
        this._countdown = makeStyledLabel('ResetCountdown', cardsRoot, '', 18, MUTED, 440, 28, 0, -254, false);

        this._cards = [
            this.buildCard(cardsRoot, 'free_coins', 0, '每日免费金币', RESOURCE_PATHS.characterUi.upgradeCurrency,
                `金币 +${PROGRESSION_CONFIG.dailyFreeCoins}`, '每日直接领取', '免费领取'),
            this.buildCard(cardsRoot, 'ad_gems', 1, '突破宝石补给', RESOURCE_PATHS.shopUi.gemIcon,
                `突破宝石 +${PROGRESSION_CONFIG.dailyAdGems}`, '完成一次激励广告', '看广告领取', true),
            this.buildCard(cardsRoot, 'ad_coins', 2, '金币加餐', RESOURCE_PATHS.characterUi.upgradeCurrency,
                `金币 +${PROGRESSION_CONFIG.dailyAdCoins}`, '完成一次激励广告', '看广告领取'),
        ];

        root.active = false;
        PlayerData.onChange(this._onChange);
        this.refresh(PlayerData.profile);
        return root;
    }

    show(): void {
        if (!this._root?.isValid) return;
        if (this._root.active && !this._closing) return;
        this._closing = false;
        if (!this._root.active) this._root.active = true;
        this._lastCycleKey = dailyShopCycleKey();
        if (PlayerData.profile.dailyShop.cycleKey !== this._lastCycleKey) {
            void PlayerData.refreshProfile();
        } else {
            this.refresh(PlayerData.profile);
        }
        this.updateCountdown();
        this._motion.enter(true);
        if (!this._timer) this._timer = setInterval(() => this.tick(), 1000);
    }

    isVisible(): boolean {
        return !!this._root?.isValid && this._root.active;
    }

    hide(): void {
        if (this._root?.isValid && this._root.active) this._root.active = false;
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    dispose(): void {
        this._motion.dispose();
        this.hide();
        PlayerData.offChange(this._onChange);
        if (this._root?.isValid) this._root.destroy();
        this._root = null;
        this._countdown = null;
        this._cards = [];
        this._busySlot = null;
        this._backButton = null;
        this._closing = false;
    }

    private beginClose(): void {
        if (this._closing || this._busySlot || !this._root?.isValid || !this._root.active) return;
        this._closing = true;
        this.refresh(PlayerData.profile);
        this._motion.exit(() => {
            if (!this._root?.isValid) return;
            this.hide();
            this._closing = false;
            this._onBack();
        });
    }

    private buildCard(
        parent: Node,
        slot: DailyShopRewardSlot,
        index: number,
        titleText: string,
        iconPath: string,
        rewardText: string,
        description: string,
        actionText: string,
        emphasized = false,
    ): CardView {
        const card = makeUiNode(`SupplyCard-${slot}`, parent);
        card.getComponent(UITransform)!.setContentSize(292, 330);
        card.setPosition(CARD_X[index], -29, 2);
        makeSprite('Artwork', card, emphasized ? RESOURCE_PATHS.shopUi.supplyCardGem : RESOURCE_PATHS.shopUi.supplyCard,
            292, 330, 0, 0);
        makeStyledLabel('Title', card, titleText, 23, DARK, 250, 36, 0, 120, true);
        makeSprite('RewardIcon', card, iconPath, 82, 82, 0, 48);
        makeStyledLabel('Reward', card, rewardText, 28, emphasized ? uiColor(12, 120, 156) : DARK,
            250, 42, 0, -18, true);
        makeStyledLabel('Description', card, description, 17, MUTED, 250, 30, 0, -58, false);

        const buttonNode = makeUiNode('ClaimButton', card);
        buttonNode.getComponent(UITransform)!.setContentSize(252, 64);
        buttonNode.setPosition(0, -119, 3);
        const buttonArtwork = makeSprite('Artwork', buttonNode, RESOURCE_PATHS.characterUi.confirmButton, 252, 56, 0, 0)
            .getComponent(Sprite)!;
        const button = buttonNode.addComponent(Button);
        button.target = buttonNode;
        button.transition = Button.Transition.SCALE;
        button.zoomScale = 0.97;
        const action = makeStyledLabel('Action', buttonNode, actionText, 22, DARK, 200, 34, 0, 0, true);
        let videoIcon: Sprite | null = null;
        if (slot !== 'free_coins') {
            videoIcon = makeSprite('VideoIcon', buttonNode, RESOURCE_PATHS.shopUi.videoIcon, 34, 27, -70, 0)
                .getComponent(Sprite)!;
            action.node.setPosition(20, 0, 1);
        }
        const view: CardView = { slot, button, buttonArtwork, action, videoIcon, pendingTransactionId: null, adVerified: false };
        buttonNode.on(Button.EventType.CLICK, () => void this.claim(view));
        return view;
    }

    private async claim(card: CardView): Promise<void> {
        if (this._busySlot || this.isClaimed(PlayerData.profile, card.slot)) return;
        this._busySlot = card.slot;
        this.refresh(PlayerData.profile);
        try {
            if (card.slot !== 'free_coins' && !card.adVerified) {
                setLabel(card.action, '广告播放中');
                const outcome = await platform().showRewardedAd(rewardedAdUnitId(platform().name));
                if (outcome !== 'completed') {
                    if (outcome === 'unavailable') this._toast('暂无可用广告，请稍后再试');
                    if (outcome === 'error') this._toast('广告加载失败，请稍后再试');
                    return;
                }
                card.adVerified = true;
            }
            if (!card.pendingTransactionId) {
                card.pendingTransactionId = `${dailyShopCycleKey()}-${card.slot}-${Date.now()}-${++this._transactionSerial}`;
            }
            setLabel(card.action, '奖励到账中');
            const result = await PlayerData.claimDailyShopReward(card.slot, card.adVerified, card.pendingTransactionId);
            if (result.ok || result.reason === 'claimed') {
                card.pendingTransactionId = null;
                card.adVerified = false;
                if (result.ok) {
                    const reward = result.grantedGems > 0 ? `突破宝石 +${result.grantedGems}` : `金币 +${result.grantedCoins}`;
                    this._toast(reward);
                }
            } else if (result.reason === 'ad_incomplete') {
                card.pendingTransactionId = null;
                card.adVerified = false;
            } else {
                this._toast('奖励发放失败，可点击重试到账');
            }
        } catch (error) {
            console.warn('[Shop] daily reward claim failed', error);
            this._toast(card.adVerified ? '奖励发放失败，可点击重试到账' : '领取失败，请稍后再试');
        } finally {
            this._busySlot = null;
            this.refresh(PlayerData.profile);
        }
    }

    private refresh(profile: PlayerProfile): void {
        if (this._backButton) setButton(this._backButton, !this._busySlot && !this._closing);
        for (const card of this._cards) {
            const claimed = this.isClaimed(profile, card.slot);
            const busy = this._busySlot === card.slot;
            const retry = !!card.pendingTransactionId && card.adVerified;
            setButton(card.button, !claimed && !this._busySlot && !this._closing);
            setSpriteColor(card.buttonArtwork, claimed ? CLAIMED_BUTTON_TINT : NORMAL_TINT);
            setSpriteColor(card.videoIcon, claimed ? CLAIMED_ICON_TINT : NORMAL_TINT);
            setLabelColor(card.action, claimed ? CLAIMED_TEXT : DARK);
            setLabel(card.action, claimed ? '今日已领取' : busy ? (retry ? '奖励到账中' : '处理中')
                : retry ? '重试到账' : card.slot === 'free_coins' ? '免费领取' : '看广告领取');
        }
    }

    private isClaimed(profile: PlayerProfile, slot: DailyShopRewardSlot): boolean {
        return slot === 'free_coins' ? profile.dailyShop.freeCoinsClaimed
            : slot === 'ad_gems' ? profile.dailyShop.adGemsClaimed
                : profile.dailyShop.adCoinsClaimed;
    }

    private tick(): void {
        if (!this._root?.active) return;
        const cycle = dailyShopCycleKey();
        if (cycle !== this._lastCycleKey) {
            this._lastCycleKey = cycle;
            for (const card of this._cards) {
                card.pendingTransactionId = null;
                card.adVerified = false;
            }
            void PlayerData.refreshProfile();
        }
        this.updateCountdown();
    }

    private updateCountdown(): void {
        if (!this._countdown) return;
        const left = millisecondsToNextBeijingFive(Date.now());
        const hours = Math.floor(left / 3600000);
        const minutes = Math.floor((left % 3600000) / 60000);
        const seconds = Math.floor((left % 60000) / 1000);
        setLabel(this._countdown, `每日 05:00 刷新 · ${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`);
    }
}

export function millisecondsToNextBeijingFive(nowMs: number): number {
    const beijing = new Date(nowMs + 8 * 60 * 60 * 1000);
    const afterBoundary = beijing.getUTCHours() >= 5;
    const nextUtc = Date.UTC(
        beijing.getUTCFullYear(),
        beijing.getUTCMonth(),
        beijing.getUTCDate() + (afterBoundary ? 1 : 0),
        5,
    ) - 8 * 60 * 60 * 1000;
    return Math.max(0, nextUtc - nowMs);
}

function makeSprite(name: string, parent: Node, path: string, width: number, height: number, x: number, y: number): Node {
    const node = makeUiNode(name, parent);
    node.getComponent(UITransform)!.setContentSize(width, height);
    node.setPosition(x, y, 1);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.trim = false;
    loadRaceAsset(path, Texture2D, (error, texture) => {
        if (error || !texture || !node.isValid || !sprite.isValid) return;
        const frame = new SpriteFrame();
        frame.texture = texture;
        sprite.spriteFrame = frame;
    });
    return node;
}

function makeStyledLabel(
    name: string,
    parent: Node,
    text: string,
    fontSize: number,
    color: ReturnType<typeof uiColor>,
    width: number,
    height: number,
    x: number,
    y: number,
    semibold: boolean,
): Label {
    const node = makeLabel(name, parent, text, fontSize, color);
    node.getComponent(UITransform)!.setContentSize(width, height);
    node.setPosition(x, y, 2);
    const label = node.getComponent(Label)!;
    label.overflow = Label.Overflow.SHRINK;
    styleProjectUiLabel(label, semibold ? 'semibold' : 'regular', height);
    return label;
}

function setLabel(label: Label, value: string): void {
    if (label.string !== value) label.string = value;
}

function setButton(button: Button, interactable: boolean): void {
    if (button.interactable !== interactable) button.interactable = interactable;
}

function setSpriteColor(sprite: Sprite | null, color: Color): void {
    if (sprite?.isValid && !sameColor(sprite.color, color)) sprite.color = color;
}

function setLabelColor(label: Label, color: Color): void {
    if (!sameColor(label.color, color)) label.color = color;
}

function sameColor(a: Color, b: Color): boolean {
    return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

function pad2(value: number): string {
    return value < 10 ? `0${value}` : `${value}`;
}
