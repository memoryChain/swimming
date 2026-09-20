import {
    Color,
    Label,
    LabelOutline,
    Node,
    Sprite,
    SpriteFrame,
    Texture2D,
    Tween,
    tween,
    UIOpacity,
    UITransform,
    Vec3,
    view,
} from 'cc';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { makeLabel, makeUiNode } from './RuntimeUiFactory';
import { styleProjectUiLabel } from './ProjectUiFonts';

export type EntertainmentBannerTone = 'info' | 'warning' | 'danger' | 'success';
export type EntertainmentBannerIcon =
    | 'stimulant'
    | 'timed-bomb'
    | 'whirlpool'
    | 'cannon'
    | 'mine'
    | 'shark'
    | 'broadcast';
export type EntertainmentBannerCategory =
    | '广播通知'
    | '补给投放'
    | '炸弹接力'
    | '漩涡警报'
    | '水雷警报'
    | '鲨鱼警报'
    | '炮火警报'
    | '炮击命中'
    | '炸弹爆炸'
    | '拆弹成功'
    | '警报解除'
    | '赛道异物'
    | '咬伤播报';

const EVENT_WIDTH = 840;
const EVENT_COMPACT_WIDTH = 650;
const EVENT_HEIGHT = 98;
const EVENT_Y = 180;
const EVENT_ICON_SIZE = 72;
const EVENT_ICON_FROM_LEFT = 48;
const EVENT_CATEGORY_FROM_LEFT = 120;
const EVENT_CATEGORY_Y = 34;
const EVENT_TEXT_LEFT_INSET = 112;
const EVENT_TEXT_RIGHT_INSET = 92;
const EVENT_COMPACT_TEXT_INSET = 19;
const PERSONAL_WIDTH = 700;
const PERSONAL_HEIGHT = 135;
const PERSONAL_Y = 112;
const STIMULANT_CARD_WIDTH = 640;
const STIMULANT_CARD_HEIGHT = 135;
// 心跳苏打使用个人反馈通道内的独立低位；1.04 倍入场回弹时仍与赛事广播保留约 17px 间隔。
const STIMULANT_CARD_Y = -68;
const STIMULANT_STAT_TEXT_X = 210;
const STIMULANT_STAT_TEXT_WIDTH = 104;
const STIMULANT_STAT_TEXT_HEIGHT = 34;
const STIMULANT_ENERGY_TEXT_Y = 27;
const STIMULANT_HEART_TEXT_Y = -26;
const SCREEN_MARGIN = 18;
const PICTURE_IN_PICTURE_GAP = 16;
const WHITE = new Color(248, 252, 255, 255);
const CATEGORY_TEXT = new Color(14, 22, 28, 255);
const ENERGY_CYAN = new Color(122, 244, 255, 255);
const HEART_ORANGE = new Color(255, 174, 79, 255);
const TONE_COLORS: Record<EntertainmentBannerTone, Readonly<Color>> = {
    info: new Color(116, 226, 255, 255),
    warning: new Color(255, 196, 82, 255),
    danger: new Color(255, 104, 88, 255),
    success: new Color(120, 232, 164, 255),
};

type QueuedEvent = {
    text: string;
    tone: EntertainmentBannerTone;
    durationMs: number;
    icon: EntertainmentBannerIcon;
    category: EntertainmentBannerCategory;
};

/**
 * 娱乐玩法共用广播：上层是赛事广播，下层是个人反馈。
 * 层级只在 bind 时创建，比赛中只切换贴图、文字、显隐和短 Tween。
 */
export class EntertainmentEventBanner {
    private eventRoot: Node | null = null;
    private eventMotionRoot: Node | null = null;
    private eventOpacity: UIOpacity | null = null;
    private eventArtSprite: Sprite | null = null;
    private eventIconRoot: Node | null = null;
    private eventIconSprite: Sprite | null = null;
    private eventCategoryRoot: Node | null = null;
    private eventCategoryLabel: Label | null = null;
    private eventLabel: Label | null = null;
    private eventUntil = 0;
    private directorUntil = 0;
    private currentEventTone: EntertainmentBannerTone = 'info';
    private currentEventIcon: EntertainmentBannerIcon = 'broadcast';

    private personalRoot: Node | null = null;
    private personalMotionRoot: Node | null = null;
    private personalOpacity: UIOpacity | null = null;
    private genericPersonalRoot: Node | null = null;
    private personalLabel: Label | null = null;
    private stimulantRoot: Node | null = null;
    private stimulantCardSprite: Sprite | null = null;
    private stimulantIconSprite: Sprite | null = null;
    private stimulantEnergyLabel: Label | null = null;
    private stimulantHeartLabel: Label | null = null;
    private personalUntil = 0;

    private pictureInPictureLeft: number | null = null;
    private readonly eventQueue: QueuedEvent[] = [];
    private readonly artFrames = new Map<string, SpriteFrame>();

    bind(hud: Node): void {
        if (this.eventRoot?.isValid || !hud?.isValid) return;
        this.buildEventChannel(hud);
        this.buildPersonalChannel(hud);
        this.layout();
        this.loadArtwork();
        view.on('canvas-resize', this.layout, this);
        view.on('design-resolution-changed', this.layout, this);
        this.eventRoot!.once(Node.EventType.NODE_DESTROYED, () => {
            view.off('canvas-resize', this.layout, this);
            view.off('design-resolution-changed', this.layout, this);
            this.destroyOwnedFrames();
        });
    }

    /** 画中画出现时只收窄广播通道，不移动排名，也不重建节点。 */
    setPictureInPictureLeft(leftEdge: number | null): void {
        const next = leftEdge !== null && Number.isFinite(leftEdge) ? leftEdge : null;
        if (this.pictureInPictureLeft === next) return;
        this.pictureInPictureLeft = next;
        this.layout();
    }

    showEvent(
        text: string,
        tone: EntertainmentBannerTone,
        durationMs: number,
        icon: EntertainmentBannerIcon = 'broadcast',
        category: EntertainmentBannerCategory = '广播通知',
    ): void {
        if (this.eventRoot?.active && Date.now() < this.directorUntil) return;
        this.directorUntil = 0;
        this.eventQueue.length = 0;
        this.presentEvent(text, tone, durationMs, icon, category);
    }

    /** 导演预告／激活文案在自己的展示期内不被子玩法短提示覆盖。 */
    showDirectorEvent(
        text: string,
        tone: EntertainmentBannerTone,
        durationMs: number,
        icon: EntertainmentBannerIcon = 'broadcast',
        category: EntertainmentBannerCategory = '广播通知',
    ): void {
        const safeDuration = Math.max(0, durationMs);
        this.eventQueue.length = 0;
        this.directorUntil = Date.now() + safeDuration;
        this.presentEvent(text, tone, safeDuration, icon, category);
    }

    enqueueEvent(
        text: string,
        tone: EntertainmentBannerTone,
        durationMs: number,
        icon: EntertainmentBannerIcon = 'broadcast',
        category: EntertainmentBannerCategory = '广播通知',
    ): void {
        if (!this.eventRoot?.isValid) return;
        if (this.eventRoot.active && Date.now() < this.directorUntil) return;
        if (!this.eventRoot.active) {
            this.presentEvent(text, tone, durationMs, icon, category);
            return;
        }
        this.eventQueue.push({
            text,
            tone,
            durationMs: Math.max(0, durationMs),
            icon,
            category,
        });
    }

    showPersonal(text: string, tone: EntertainmentBannerTone, durationMs: number): void {
        const root = this.personalRoot;
        const label = this.personalLabel;
        if (!root?.isValid || !label) return;
        this.setPersonalMode(false);
        this.setLabel(label, text, TONE_COLORS[tone]);
        this.showPersonalRoot(durationMs);
    }

    /** 心跳苏打使用专属结构化卡片，不再把三项信息挤成一行普通文字。 */
    showStimulantPickup(energyRestored: number, heartRate: number, durationMs = 1400): void {
        if (!this.personalRoot?.isValid || !this.stimulantEnergyLabel || !this.stimulantHeartLabel) return;
        this.setPersonalMode(true);
        const energy = Math.max(0, Math.round(energyRestored));
        const heart = Math.max(0, Math.round(heartRate));
        this.setLabel(
            this.stimulantEnergyLabel,
            energy > 0 ? `体力 +${energy}` : '体力已满',
            ENERGY_CYAN,
        );
        this.setLabel(this.stimulantHeartLabel, `心率 ${heart}`, HEART_ORANGE);
        this.showPersonalRoot(durationMs, true);
    }

    update(): void {
        if (!this.eventRoot?.active && !this.personalRoot?.active) return;
        const now = Date.now();
        const eventRoot = this.eventRoot;
        if (eventRoot?.active && now >= this.eventUntil) {
            this.directorUntil = 0;
            const next = this.eventQueue.shift();
            if (next) this.presentEvent(next.text, next.tone, next.durationMs, next.icon, next.category);
            else eventRoot.active = false;
        }
        const personalRoot = this.personalRoot;
        if (personalRoot?.active && now >= this.personalUntil) personalRoot.active = false;
    }

    hide(): void {
        this.hideEvent();
        this.stopPersonalTweens();
        if (this.personalRoot?.active) this.personalRoot.active = false;
        this.personalUntil = 0;
    }

    hideEvent(): void {
        this.stopEventTweens();
        if (this.eventRoot?.active) this.eventRoot.active = false;
        this.eventUntil = 0;
        this.directorUntil = 0;
        this.eventQueue.length = 0;
    }

    private buildEventChannel(hud: Node): void {
        const root = makeUiNode('EntertainmentEventBanner', hud);
        root.getComponent(UITransform)!.setContentSize(EVENT_WIDTH, EVENT_HEIGHT);
        root.setPosition(0, EVENT_Y, 0);
        const opacity = root.addComponent(UIOpacity);
        const motion = makeUiNode('Motion', root);
        motion.getComponent(UITransform)!.setContentSize(EVENT_WIDTH, EVENT_HEIGHT);

        const artNode = makeUiNode('Background', motion);
        artNode.getComponent(UITransform)!.setContentSize(EVENT_WIDTH, EVENT_HEIGHT);
        const artSprite = artNode.addComponent(Sprite);
        artSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        artSprite.type = Sprite.Type.SLICED;
        artSprite.trim = false;

        const iconRoot = makeUiNode('EventIcon', motion);
        iconRoot.getComponent(UITransform)!.setContentSize(EVENT_ICON_SIZE, EVENT_ICON_SIZE);
        iconRoot.setPosition(-EVENT_WIDTH * 0.5 + EVENT_ICON_FROM_LEFT, 0, 1);
        const iconSprite = iconRoot.addComponent(Sprite);
        iconSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        iconSprite.trim = false;

        const categoryRoot = makeUiNode('Category', motion);
        categoryRoot.getComponent(UITransform)!.setContentSize(128, 34);
        categoryRoot.setPosition(
            -EVENT_WIDTH * 0.5 + EVENT_CATEGORY_FROM_LEFT,
            EVENT_CATEGORY_Y,
            1,
        );
        const categoryNode = makeLabel('Label', categoryRoot, '广播通知', 20, CATEGORY_TEXT);
        categoryNode.getComponent(UITransform)!.setContentSize(128, 34);
        const categoryLabel = categoryNode.getComponent(Label)!;
        categoryLabel.enableWrapText = false;
        categoryLabel.overflow = Label.Overflow.SHRINK;
        styleProjectUiLabel(categoryLabel, 'semibold', 28);

        const labelNode = makeLabel('Label', motion, '', 34, WHITE);
        labelNode.getComponent(UITransform)!.setContentSize(
            EVENT_WIDTH - EVENT_TEXT_LEFT_INSET - EVENT_TEXT_RIGHT_INSET,
            70,
        );
        labelNode.setPosition((EVENT_TEXT_LEFT_INSET - EVENT_TEXT_RIGHT_INSET) * 0.5, 0, 1);
        const label = labelNode.getComponent(Label)!;
        label.enableWrapText = false;
        label.overflow = Label.Overflow.SHRINK;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        styleProjectUiLabel(label, 'semibold', 44);
        const outline = labelNode.addComponent(LabelOutline);
        outline.color = new Color(4, 12, 24, 220);
        outline.width = 3;

        root.active = false;
        this.eventRoot = root;
        this.eventMotionRoot = motion;
        this.eventOpacity = opacity;
        this.eventArtSprite = artSprite;
        this.eventIconRoot = iconRoot;
        this.eventIconSprite = iconSprite;
        this.eventCategoryRoot = categoryRoot;
        this.eventCategoryLabel = categoryLabel;
        this.eventLabel = label;
    }

    private buildPersonalChannel(hud: Node): void {
        const root = makeUiNode('EntertainmentPersonalFeedback', hud);
        root.getComponent(UITransform)!.setContentSize(PERSONAL_WIDTH, PERSONAL_HEIGHT);
        root.setPosition(0, PERSONAL_Y, 0);
        const opacity = root.addComponent(UIOpacity);
        const motion = makeUiNode('Motion', root);
        motion.getComponent(UITransform)!.setContentSize(PERSONAL_WIDTH, PERSONAL_HEIGHT);

        const genericRoot = makeUiNode('GenericFeedback', motion);
        genericRoot.getComponent(UITransform)!.setContentSize(PERSONAL_WIDTH, 58);
        const personalLabelNode = makeLabel('Label', genericRoot, '', 28, TONE_COLORS.info);
        personalLabelNode.getComponent(UITransform)!.setContentSize(PERSONAL_WIDTH, 54);
        const personalLabel = personalLabelNode.getComponent(Label)!;
        personalLabel.enableWrapText = false;
        personalLabel.overflow = Label.Overflow.SHRINK;
        styleProjectUiLabel(personalLabel, 'semibold', 38);
        const personalOutline = personalLabelNode.addComponent(LabelOutline);
        personalOutline.color = new Color(6, 16, 30, 225);
        personalOutline.width = 4;

        const stimulantRoot = makeUiNode('StimulantPickup', motion);
        stimulantRoot.getComponent(UITransform)!.setContentSize(STIMULANT_CARD_WIDTH, STIMULANT_CARD_HEIGHT);
        stimulantRoot.setPosition(0, STIMULANT_CARD_Y, 0);
        const cardNode = makeUiNode('Background', stimulantRoot);
        cardNode.getComponent(UITransform)!.setContentSize(STIMULANT_CARD_WIDTH, STIMULANT_CARD_HEIGHT);
        const cardSprite = cardNode.addComponent(Sprite);
        cardSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        cardSprite.type = Sprite.Type.SIMPLE;
        cardSprite.trim = false;

        const iconNode = makeUiNode('StimulantIcon', stimulantRoot);
        iconNode.getComponent(UITransform)!.setContentSize(84, 84);
        iconNode.setPosition(-214, 0, 1);
        const iconSprite = iconNode.addComponent(Sprite);
        iconSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        iconSprite.trim = false;

        const energyNode = makeLabel('Energy', stimulantRoot, '', 22, ENERGY_CYAN);
        energyNode.getComponent(UITransform)!.setContentSize(STIMULANT_STAT_TEXT_WIDTH, STIMULANT_STAT_TEXT_HEIGHT);
        energyNode.setPosition(STIMULANT_STAT_TEXT_X, STIMULANT_ENERGY_TEXT_Y, 1);
        const energyLabel = energyNode.getComponent(Label)!;
        energyLabel.enableWrapText = false;
        energyLabel.overflow = Label.Overflow.SHRINK;
        styleProjectUiLabel(energyLabel, 'semibold', 30);

        const heartNode = makeLabel('HeartRate', stimulantRoot, '', 22, HEART_ORANGE);
        heartNode.getComponent(UITransform)!.setContentSize(STIMULANT_STAT_TEXT_WIDTH, STIMULANT_STAT_TEXT_HEIGHT);
        heartNode.setPosition(STIMULANT_STAT_TEXT_X, STIMULANT_HEART_TEXT_Y, 1);
        const heartLabel = heartNode.getComponent(Label)!;
        heartLabel.enableWrapText = false;
        heartLabel.overflow = Label.Overflow.SHRINK;
        styleProjectUiLabel(heartLabel, 'semibold', 30);

        stimulantRoot.active = false;
        root.active = false;
        this.personalRoot = root;
        this.personalMotionRoot = motion;
        this.personalOpacity = opacity;
        this.genericPersonalRoot = genericRoot;
        this.personalLabel = personalLabel;
        this.stimulantRoot = stimulantRoot;
        this.stimulantCardSprite = cardSprite;
        this.stimulantIconSprite = iconSprite;
        this.stimulantEnergyLabel = energyLabel;
        this.stimulantHeartLabel = heartLabel;
    }

    private loadArtwork(): void {
        const paths = RESOURCE_PATHS.entertainmentBannerUi;
        this.loadFrame('event-info', paths.events.info, 190, 180, 22);
        this.loadFrame('event-warning', paths.events.warning, 190, 180, 22);
        this.loadFrame('event-danger', paths.events.danger, 190, 180, 22);
        this.loadFrame('event-success', paths.events.success, 190, 180, 22);
        this.loadFrame('stimulant-card', paths.stimulantCard);
        this.loadFrame('icon-stimulant', paths.icons.stimulant);
        this.loadFrame('icon-timed-bomb', paths.icons.timedBomb);
        this.loadFrame('icon-whirlpool', paths.icons.whirlpool);
        this.loadFrame('icon-cannon', paths.icons.cannon);
        this.loadFrame('icon-mine', paths.icons.mine);
        this.loadFrame('icon-shark', paths.icons.shark);
        this.loadFrame('icon-broadcast', paths.icons.broadcast);
    }

    private loadFrame(key: string, path: string, insetLeft = 0, insetRight = 0, insetVertical = 0): void {
        loadRaceAsset(path, Texture2D, (error, texture) => {
            if (error || !texture || !this.eventRoot?.isValid) return;
            const frame = new SpriteFrame();
            frame.texture = texture;
            frame.insetLeft = insetLeft;
            frame.insetRight = insetRight;
            frame.insetTop = insetVertical;
            frame.insetBottom = insetVertical;
            this.artFrames.get(key)?.destroy();
            this.artFrames.set(key, frame);
            this.applyLoadedArtwork(key, frame);
        });
    }

    private applyLoadedArtwork(key: string, frame: SpriteFrame): void {
        if (key === `event-${this.currentEventTone}` && this.eventArtSprite?.spriteFrame !== frame) {
            this.eventArtSprite!.spriteFrame = frame;
        }
        if (key === `icon-${this.currentEventIcon}` && this.eventIconSprite?.spriteFrame !== frame) {
            this.eventIconSprite!.spriteFrame = frame;
        }
        if (key === 'stimulant-card' && this.stimulantCardSprite?.spriteFrame !== frame) {
            this.stimulantCardSprite!.spriteFrame = frame;
        }
        if (key === 'icon-stimulant' && this.stimulantIconSprite?.spriteFrame !== frame) {
            this.stimulantIconSprite!.spriteFrame = frame;
        }
    }

    private presentEvent(
        text: string,
        tone: EntertainmentBannerTone,
        durationMs: number,
        icon: EntertainmentBannerIcon,
        category: EntertainmentBannerCategory,
    ): void {
        const root = this.eventRoot;
        const label = this.eventLabel;
        const categoryLabel = this.eventCategoryLabel;
        if (!root?.isValid || !label || !categoryLabel) return;
        this.currentEventTone = tone;
        this.currentEventIcon = icon;
        this.setLabel(categoryLabel, category, CATEGORY_TEXT);
        this.setLabel(label, text, WHITE);
        this.setSpriteFrame(this.eventArtSprite, this.artFrames.get(`event-${tone}`) ?? null);
        this.setSpriteFrame(this.eventIconSprite, this.artFrames.get(`icon-${icon}`) ?? null);
        this.playEventEntry();
        this.eventUntil = Date.now() + Math.max(0, durationMs);
    }

    private playEventEntry(): void {
        const root = this.eventRoot;
        const motion = this.eventMotionRoot;
        const opacity = this.eventOpacity;
        if (!root?.isValid || !motion?.isValid || !opacity) return;
        this.stopEventTweens();
        if (!root.active) root.active = true;
        opacity.opacity = 0;
        motion.setPosition(0, 14, 0);
        motion.setScale(0.96, 0.96, 1);
        tween(opacity).to(0.14, { opacity: 255 }, { easing: 'quadOut' }).start();
        tween(motion)
            .to(0.18, { position: new Vec3(0, 0, 0), scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
            .start();
    }

    private showPersonalRoot(durationMs: number, punch = false): void {
        const root = this.personalRoot;
        const motion = this.personalMotionRoot;
        const opacity = this.personalOpacity;
        if (!root?.isValid || !motion?.isValid || !opacity) return;
        this.stopPersonalTweens();
        if (!root.active) root.active = true;
        opacity.opacity = 0;
        motion.setPosition(0, -8, 0);
        motion.setScale(punch ? 0.88 : 0.96, punch ? 0.88 : 0.96, 1);
        tween(opacity).to(0.12, { opacity: 255 }, { easing: 'quadOut' }).start();
        tween(motion)
            .to(0.18, { position: new Vec3(0, 2, 0), scale: new Vec3(punch ? 1.04 : 1, punch ? 1.04 : 1, 1) }, { easing: 'backOut' })
            .to(0.08, { position: new Vec3(0, 0, 0), scale: new Vec3(1, 1, 1) }, { easing: 'quadInOut' })
            .start();
        this.personalUntil = Date.now() + Math.max(0, durationMs);
    }

    private setPersonalMode(stimulant: boolean): void {
        if (this.genericPersonalRoot?.active === stimulant) this.genericPersonalRoot.active = !stimulant;
        if (this.stimulantRoot?.active !== stimulant) this.stimulantRoot.active = stimulant;
    }

    private setLabel(label: Label, text: string, color: Readonly<Color>): void {
        if (label.string !== text) label.string = text;
        if (!label.color.equals(color)) label.color = color;
    }

    private setSpriteFrame(sprite: Sprite | null, frame: SpriteFrame | null): void {
        if (sprite?.spriteFrame !== frame) sprite!.spriteFrame = frame;
    }

    private stopEventTweens(): void {
        if (this.eventOpacity) Tween.stopAllByTarget(this.eventOpacity);
        if (this.eventMotionRoot) Tween.stopAllByTarget(this.eventMotionRoot);
    }

    private stopPersonalTweens(): void {
        if (this.personalOpacity) Tween.stopAllByTarget(this.personalOpacity);
        if (this.personalMotionRoot) Tween.stopAllByTarget(this.personalMotionRoot);
    }

    private layout(): void {
        this.layoutEventChannel();
        this.layoutPersonalChannel();
    }

    private availableChannelWidth(preferredWidth: number): { width: number; x: number } {
        const size = view.getVisibleSize();
        const naturalWidth = Math.min(preferredWidth, Math.max(1, size.width - SCREEN_MARGIN * 2));
        const left = -naturalWidth * 0.5;
        const naturalRight = naturalWidth * 0.5;
        const right = this.pictureInPictureLeft === null
            ? naturalRight
            : Math.min(naturalRight, this.pictureInPictureLeft - PICTURE_IN_PICTURE_GAP);
        const width = Math.max(1, right - left);
        return { width, x: left + width * 0.5 };
    }

    private layoutEventChannel(): void {
        const root = this.eventRoot;
        const motion = this.eventMotionRoot;
        const label = this.eventLabel;
        if (!root?.isValid || !motion?.isValid || !label) return;
        const { width, x } = this.availableChannelWidth(EVENT_WIDTH);
        this.setSize(root, width, EVENT_HEIGHT);
        this.setSize(motion, width, EVENT_HEIGHT);
        this.setSize(this.eventArtSprite?.node ?? null, width, EVENT_HEIGHT);
        if (root.position.x !== x || root.position.y !== EVENT_Y) root.setPosition(x, EVENT_Y, 0);
        const compact = width < EVENT_COMPACT_WIDTH;
        if (this.eventIconRoot?.active === compact) this.eventIconRoot.active = !compact;
        if (this.eventCategoryRoot?.active === compact) this.eventCategoryRoot.active = !compact;
        const labelLeft = -width * 0.5 + (compact ? EVENT_COMPACT_TEXT_INSET : EVENT_TEXT_LEFT_INSET);
        const labelRight = width * 0.5 - (compact ? EVENT_COMPACT_TEXT_INSET : EVENT_TEXT_RIGHT_INSET);
        const labelWidth = Math.max(1, labelRight - labelLeft);
        const labelX = (labelLeft + labelRight) * 0.5;
        this.setSize(label.node, labelWidth, 70);
        if (label.node.position.x !== labelX) label.node.setPosition(labelX, 0, 1);
        const iconX = -width * 0.5 + EVENT_ICON_FROM_LEFT;
        if (this.eventIconRoot && this.eventIconRoot.position.x !== iconX) {
            this.eventIconRoot.setPosition(iconX, 0, 1);
        }
        const categoryX = -width * 0.5 + EVENT_CATEGORY_FROM_LEFT;
        if (this.eventCategoryRoot
            && (this.eventCategoryRoot.position.x !== categoryX
                || this.eventCategoryRoot.position.y !== EVENT_CATEGORY_Y)) {
            this.eventCategoryRoot.setPosition(categoryX, EVENT_CATEGORY_Y, 1);
        }
    }

    private layoutPersonalChannel(): void {
        const root = this.personalRoot;
        const motion = this.personalMotionRoot;
        const label = this.personalLabel;
        if (!root?.isValid || !motion?.isValid || !label) return;
        const { width, x } = this.availableChannelWidth(PERSONAL_WIDTH);
        this.setSize(root, width, PERSONAL_HEIGHT);
        this.setSize(motion, width, PERSONAL_HEIGHT);
        this.setSize(this.genericPersonalRoot, width, 58);
        this.setSize(label.node, width, 54);
        if (root.position.x !== x || root.position.y !== PERSONAL_Y) root.setPosition(x, PERSONAL_Y, 0);
        if (this.stimulantRoot) {
            const scale = Math.min(1, Math.max(0.55, width / STIMULANT_CARD_WIDTH));
            if (this.stimulantRoot.scale.x !== scale || this.stimulantRoot.scale.y !== scale) {
                this.stimulantRoot.setScale(scale, scale, 1);
            }
        }
    }

    private setSize(node: Node | null, width: number, height: number): void {
        const transform = node?.getComponent(UITransform);
        if (!transform) return;
        if (transform.contentSize.width !== width || transform.contentSize.height !== height) {
            transform.setContentSize(width, height);
        }
    }

    private destroyOwnedFrames(): void {
        for (const frame of this.artFrames.values()) frame.destroy();
        this.artFrames.clear();
    }
}

// 旧类名保留为源码兼容别名；新调用统一使用 EntertainmentEventBanner。
export { EntertainmentEventBanner as SharkEventBanner };
