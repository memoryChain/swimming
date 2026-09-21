import {
    BlockInputEvents,
    Button,
    Color,
    Label,
    Node,
    Sprite,
    SpriteFrame,
    Texture2D,
    Tween,
    tween,
    UIOpacity,
    UITransform,
    Vec3,
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
    fitFullScreenSolidCover,
    makeLabel,
    makeRect,
    makeScreenEdgeGroup,
    makeUiNode,
    uiColor,
} from './RuntimeUiFactory';
import { styleProjectUiLabel } from './ProjectUiFonts';
import { buildSecondaryPageHeader } from './PrepareRaceFlow';
import { LobbyUiMotion } from './LobbyUiMotion';
import { PopupUiMotion } from './PopupUiMotion';

type CardView = {
    slot: DailyShopRewardSlot;
    button: Button;
    availableButtonArtwork: Node;
    claimedButtonArtwork: Node;
    action: Label;
    videoIcon: Sprite | null;
    pendingTransactionId: string | null;
    adVerified: boolean;
};

type RewardPresentation = {
    iconPath: string;
    text: string;
};

const CARD_X = [-320, 0, 320] as const;
const MUTED = uiColor(162, 194, 214);
const DARK = uiColor(16, 38, 61);
const CLAIMED_TEXT = uiColor(79, 91, 99);
const POPUP_HINT = uiColor(92, 121, 145);

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
    private _rewardPopup: RewardClaimPopup | null = null;
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
            this.buildCard(cardsRoot, 'free_coins', 0, '免费金币', RESOURCE_PATHS.characterUi.upgradeCurrency,
                `金币 +${PROGRESSION_CONFIG.dailyFreeCoins}`, '领取'),
            this.buildCard(cardsRoot, 'ad_gems', 1, '突破宝石', RESOURCE_PATHS.shopUi.gemIcon,
                `突破宝石 +${PROGRESSION_CONFIG.dailyAdGems}`, '看广告领取', true),
            this.buildCard(cardsRoot, 'ad_coins', 2, '金币加餐', RESOURCE_PATHS.characterUi.upgradeCurrency,
                `金币 +${PROGRESSION_CONFIG.dailyAdCoins}`, '看广告领取'),
        ];

        this._rewardPopup = new RewardClaimPopup();
        this._rewardPopup.build(root, designWidth, designHeight);

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
        this._motion.cancel();
        this._rewardPopup?.hideImmediately();
        this._closing = false;
        if (this._root?.isValid && this._root.active) this._root.active = false;
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    dispose(): void {
        this._motion.dispose();
        this._rewardPopup?.dispose();
        this._rewardPopup = null;
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
            if (!this._root?.isValid || !this._root.active || !this._closing) return;
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
        makeStyledLabel('Reward', card, rewardText, 28, DARK, 250, 42, 0, -18, true);

        const buttonNode = makeUiNode('ClaimButton', card);
        buttonNode.getComponent(UITransform)!.setContentSize(252, 64);
        buttonNode.setPosition(0, -119, 3);
        const availableButtonArtwork = makeSprite(
            'AvailableArtwork', buttonNode, RESOURCE_PATHS.characterUi.confirmButton, 252, 56, 0, 0,
        );
        const claimedButtonArtwork = makeSprite(
            'ClaimedArtwork', buttonNode, RESOURCE_PATHS.shopUi.claimButtonDisabled, 252, 56, 0, 0,
        );
        claimedButtonArtwork.active = false;
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
        const view: CardView = {
            slot,
            button,
            availableButtonArtwork,
            claimedButtonArtwork,
            action,
            videoIcon,
            pendingTransactionId: null,
            adVerified: false,
        };
        buttonNode.on(Button.EventType.CLICK, () => void this.claim(view));
        return view;
    }

    private async claim(card: CardView): Promise<void> {
        const root = this._root;
        if (!root?.isValid || this._cards.indexOf(card) < 0
            || this._busySlot || this.isClaimed(PlayerData.profile, card.slot)) return;
        // 奖励请求可以完成，但旧页面的回调不能修改重建后的按钮、忙碌状态或弹窗。
        const ownsView = () => this._root === root && root.isValid;
        this._busySlot = card.slot;
        this.refresh(PlayerData.profile);
        let grantedReward: RewardPresentation | null = null;
        try {
            if (card.slot !== 'free_coins' && !card.adVerified) {
                setLabel(card.action, '广告播放中');
                const outcome = await platform().showRewardedAd(rewardedAdUnitId(platform().name));
                if (outcome !== 'completed') {
                    if (ownsView() && this.isVisible()) {
                        if (outcome === 'unavailable') this._toast('暂无可用广告，请稍后再试');
                        if (outcome === 'error') this._toast('广告加载失败，请稍后再试');
                    }
                    return;
                }
                card.adVerified = true;
            }
            if (!card.pendingTransactionId) {
                card.pendingTransactionId = `${dailyShopCycleKey()}-${card.slot}-${Date.now()}-${++this._transactionSerial}`;
            }
            if (ownsView()) setLabel(card.action, '奖励到账中');
            const result = await PlayerData.claimDailyShopReward(card.slot, card.adVerified, card.pendingTransactionId);
            if (result.ok || result.reason === 'claimed') {
                card.pendingTransactionId = null;
                card.adVerified = false;
                if (result.ok) {
                    grantedReward = result.grantedGems > 0
                        ? { iconPath: RESOURCE_PATHS.shopUi.gemIcon, text: `突破宝石 ×${result.grantedGems}` }
                        : { iconPath: RESOURCE_PATHS.characterUi.upgradeCurrency, text: `金币 ×${result.grantedCoins}` };
                }
            } else if (result.reason === 'ad_incomplete') {
                card.pendingTransactionId = null;
                card.adVerified = false;
            } else if (ownsView() && this.isVisible()) {
                this._toast('奖励发放失败，可点击重试到账');
            }
        } catch (error) {
            console.warn('[Shop] daily reward claim failed', error);
            if (ownsView() && this.isVisible()) {
                this._toast(card.adVerified ? '奖励发放失败，可点击重试到账' : '领取失败，请稍后再试');
            }
        } finally {
            if (ownsView()) {
                this._busySlot = null;
                this.refresh(PlayerData.profile);
                if (grantedReward && this.isVisible()) this._rewardPopup?.show(grantedReward);
            }
        }
    }

    private refresh(profile: PlayerProfile): void {
        if (this._backButton) setButton(this._backButton, !this._busySlot && !this._closing);
        for (const card of this._cards) {
            const claimed = this.isClaimed(profile, card.slot);
            const busy = this._busySlot === card.slot;
            const retry = !!card.pendingTransactionId && card.adVerified;
            setButton(card.button, !claimed && !this._busySlot && !this._closing);
            setNodeActive(card.availableButtonArtwork, !claimed);
            setNodeActive(card.claimedButtonArtwork, claimed);
            setNodeActive(card.videoIcon?.node ?? null, !claimed);
            setNodeX(card.action.node, claimed || card.slot === 'free_coins' ? 0 : 20);
            setLabelColor(card.action, claimed ? CLAIMED_TEXT : DARK);
            setLabel(card.action, claimed ? '已领取' : busy ? (retry ? '奖励到账中' : '处理中')
                : retry ? '重试到账' : card.slot === 'free_coins' ? '领取' : '看广告领取');
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

/** 奖励到账弹窗：节点与监听只创建一次，领取成功时只更新图标、数量和短动效。 */
class RewardClaimPopup {
    private _root: Node | null = null;
    private _motion: PopupUiMotion | null = null;
    private _rewardIcon: Sprite | null = null;
    private _rewardText: Label | null = null;
    private _burstNode: Node | null = null;
    private _iconPath = '';
    private _ownedIconFrame: SpriteFrame | null = null;
    private _iconTween: Tween<Node> | null = null;
    private _burstTween: Tween<Node> | null = null;

    build(parent: Node, designWidth: number, designHeight: number): Node {
        const root = makeUiNode('RewardClaimPopup', parent);
        root.getComponent(UITransform)!.setContentSize(designWidth, designHeight);
        this._root = root;
        root.once(Node.EventType.NODE_DESTROYED, () => {
            if (this._root !== root) return;
            this._ownedIconFrame?.destroy();
            this._ownedIconFrame = null;
        });

        const dim = makeRect('Dim', root, designWidth, designHeight, uiColor(2, 20, 38, 178));
        fitFullScreenSolidCover(dim, designWidth, designHeight);
        dim.on(Node.EventType.TOUCH_END, () => this.hide());

        const panel = makeUiNode('Panel', root);
        panel.getComponent(UITransform)!.setContentSize(560, 420);
        panel.addComponent(BlockInputEvents);
        panel.on(Node.EventType.TOUCH_END, () => this.hide());
        makeSprite('Artwork', panel, RESOURCE_PATHS.shopUi.rewardPopupPanel, 560, 420, 0, 0);

        makeStyledLabel('Title', panel, '领取成功', 38, DARK, 380, 54, 0, 109, true);

        const burst = makeSprite('RewardBurst', panel, RESOURCE_PATHS.shopUi.rewardBurst, 236, 236, 0, 12);
        burst.addComponent(UIOpacity).opacity = 148;
        this._burstNode = burst;

        const iconNode = makeUiNode('RewardIcon', panel);
        iconNode.getComponent(UITransform)!.setContentSize(96, 96);
        iconNode.setPosition(0, 12, 4);
        const icon = iconNode.addComponent(Sprite);
        icon.sizeMode = Sprite.SizeMode.CUSTOM;
        icon.trim = false;
        this._rewardIcon = icon;

        this._rewardText = makeStyledLabel('Reward', panel, '', 31, DARK, 420, 48, 0, -66, true);
        makeStyledLabel('Hint', panel, '点击任意位置继续', 18, POPUP_HINT, 360, 32, 0, -124, false);

        this._motion = new PopupUiMotion(root, dim, panel);
        root.active = false;
        return root;
    }

    show(reward: RewardPresentation): void {
        if (!this._root?.isValid || !this._rewardText) return;
        setLabel(this._rewardText, reward.text);
        this.setRewardIcon(reward.iconPath);
        this._motion?.show();
        this.playRewardPulse();
    }

    hideImmediately(): void {
        this.stopRewardPulse();
        this._motion?.hideImmediately();
    }

    dispose(): void {
        this.stopRewardPulse();
        this._motion?.dispose();
        this._motion = null;
        this._ownedIconFrame?.destroy();
        this._ownedIconFrame = null;
        if (this._root?.isValid) this._root.destroy();
        this._root = null;
        this._rewardIcon = null;
        this._rewardText = null;
        this._burstNode = null;
        this._iconPath = '';
    }

    private hide(): void {
        if (!this._motion?.interactive) return;
        this.stopRewardPulse();
        this._motion.hide();
    }

    private setRewardIcon(path: string): void {
        const sprite = this._rewardIcon;
        if (!sprite?.node.isValid || this._iconPath === path) return;
        this._iconPath = path;
        sprite.spriteFrame = null;
        this._ownedIconFrame?.destroy();
        this._ownedIconFrame = null;
        loadRaceAsset(path, Texture2D, (error, texture) => {
            if (error || !texture || !sprite.isValid || !sprite.node.isValid || this._iconPath !== path) return;
            const frame = new SpriteFrame();
            frame.texture = texture;
            this._ownedIconFrame?.destroy();
            this._ownedIconFrame = frame;
            sprite.spriteFrame = frame;
        });
    }

    private playRewardPulse(): void {
        this.stopRewardPulse();
        const iconNode = this._rewardIcon?.node;
        if (iconNode?.isValid) {
            iconNode.setScale(0.72, 0.72, 1);
            this._iconTween = tween(iconNode)
                .to(0.16, { scale: new Vec3(1.09, 1.09, 1) }, { easing: 'cubicOut' })
                .to(0.09, { scale: new Vec3(1, 1, 1) }, { easing: 'quadInOut' })
                .call(() => { this._iconTween = null; })
                .start();
        }
        if (this._burstNode?.isValid) {
            this._burstNode.setScale(0.82, 0.82, 1);
            this._burstTween = tween(this._burstNode)
                .to(0.22, { scale: new Vec3(1.04, 1.04, 1) }, { easing: 'cubicOut' })
                .to(0.1, { scale: new Vec3(1, 1, 1) }, { easing: 'quadInOut' })
                .call(() => { this._burstTween = null; })
                .start();
        }
    }

    private stopRewardPulse(): void {
        this._iconTween?.stop();
        this._burstTween?.stop();
        this._iconTween = null;
        this._burstTween = null;
        if (this._rewardIcon?.node.isValid) this._rewardIcon.node.setScale(1, 1, 1);
        if (this._burstNode?.isValid) this._burstNode.setScale(1, 1, 1);
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
    let ownedFrame: SpriteFrame | null = null;
    node.once(Node.EventType.NODE_DESTROYED, () => {
        ownedFrame?.destroy();
        ownedFrame = null;
    });
    loadRaceAsset(path, Texture2D, (error, texture) => {
        if (error || !texture || !node.isValid || !sprite.isValid) return;
        const frame = new SpriteFrame();
        frame.texture = texture;
        ownedFrame?.destroy();
        ownedFrame = frame;
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

function setNodeActive(node: Node | null, active: boolean): void {
    if (node?.isValid && node.active !== active) node.active = active;
}

function setNodeX(node: Node, x: number): void {
    if (node.isValid && node.position.x !== x) node.setPosition(x, node.position.y, node.position.z);
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
