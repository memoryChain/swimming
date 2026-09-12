import { HEART_TIERS, heartRateTier } from './HeartRatePresentation';
import { RaceStrokeView } from './RaceStrokeView';
import { RaceHudEntrance } from './RaceHudEntrance';
import { StrokeType } from '../core/GameConstants';
import type { StrokeTimingGuide } from '../swimmer/SwimmerMotor';
import { BlockInputEvents, Button, Color, Font, Label, Node, Sprite, SpriteFrame, UIOpacity, UITransform, Vec2, view, sys } from 'cc';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import type { RaceFinishResult } from '../core/RaceManager';
import type { Swimmer } from '../entity/Swimmer';
import { loadAvatarUiSpriteFrame, avatarTexturePath } from './AvatarUiAssets';
import { styleProjectUiLabel } from './ProjectUiFonts';
import { makeUiNode } from './RuntimeUiFactory';
import { platform } from '../platform/PlatformManager';

const ART = RESOURCE_PATHS.raceHudUi;
type ArtKey = Exclude<keyof typeof ART, 'speedFont'>;
const FRAMES = new Map<ArtKey, SpriteFrame>();
let speedFont: Font | null = null;
let countdownFont: Font | null = null;
export function getRaceCountdownFont(): Font | null { return countdownFont; }
const WHITE = new Color(245, 250, 252);
const CYAN = new Color(0, 215, 201);
const RED = new Color(255, 73, 76);
const GOLD = new Color(255, 201, 58);
const TEXT_OUTLINE = new Color(0, 0, 0, 51);
const TRACK = new Color(39, 60, 73, 204);
const DEPLETED_TRACK = new Color(255, 73, 76, 120);
// 源稿蓄气中海豚为浅白 52.16%，不能再次乘灰蓝色。
const DOLPHIN_WHITE = new Color(245, 250, 252, 133);
const COURSE_TRACK = new Color(39, 60, 73, 184);

export function preloadRaceHudStatus(done: (error: Error | null) => void): void {
    const keys = Object.keys(ART).filter(key => key !== 'speedFont') as ArtKey[];
    let pending = keys.length + 2;
    let failure: Error | null = null;
    const finish = () => { if (--pending === 0) done(failure); };
    for (const key of keys) loadAvatarUiSpriteFrame(ART[key], frame => {
        if (frame) FRAMES.set(key, frame);
        else failure = new Error(`HUD 素材加载失败：${key}`);
        finish();
    });
    loadRaceAsset(RESOURCE_PATHS.raceHudCountdownFont, Font, (error, font) => {
        if (font) countdownFont = font;
        else failure = error ?? new Error('倒计时字体加载失败');
        finish();
    });
    loadRaceAsset(ART.speedFont, Font, (error, font) => {
        if (font) speedFont = font;
        else failure = error ?? new Error('速度字体加载失败');
        finish();
    });
}

type RankSlot = { root: Node; normal: Node; self: Node; portrait: Sprite; number: Label; identity: Swimmer | null; path: string; emphasized: boolean | null };
export type HudRosterEntry = { swimmer: Swimmer; avatarId: string };

/** 按原 1280×720 PSD 制作。美术圆环为纹理，动态部分只更新 Sprite 填充参数。 */
export class RaceHudStatusView {
    readonly root: Node;
    readonly stroke: RaceStrokeView;
    private readonly entrance = new RaceHudEntrance();
    private readonly left: Node;
    private readonly right: Node;
    private readonly ranking: Node;
    private readonly top: Node;
    private readonly speed: Label;
    private readonly heartValue: Label;
    private readonly energyValue: Label;
    private readonly energyState: Label;
    private readonly energyIcon: Sprite;
    private readonly energyIconOpacity: UIOpacity;
    private readonly energyTrack: Sprite;
    private energyDepleted = false;
    private energyPulsePhase = 0;
    private readonly heartTierLabel: Label;
    private pulseElapsed = 0;
    private pulsePhase = 0;
    private displayedHeart = 80;
    private displayedHeartTier = 0;
    private heartScale = 1;
    private readonly distance: Label;
    private readonly percent: Label;
    private readonly heartRing: Sprite;
    private readonly energyRing: Sprite;
    private readonly progress: Sprite;
    private readonly heartIcon: Sprite;
    private readonly warning: Node;
    private readonly jump: Node;
    private readonly jumpButton: Button;
    private readonly jumpRing: Sprite;
    private readonly jumpFace: Node;
    private readonly jumpCharge: Node;
    private readonly dolphin: Sprite;
    private readonly ranks: RankSlot[] = [];
    private readonly identities = new Map<Swimmer, string>();
    private elapsed = 0.1;
    private ready = false;
    private observedSwimmer: Swimmer | null = null;
    private scale = 1;

    constructor(parent: Node, onJump: () => void) {
        this.root = makeUiNode('RaceHudStatus', parent);
        this.left = makeUiNode('LeftStatus', this.root);
        this.right = makeUiNode('RightStatus', this.root);
        this.ranking = makeUiNode('Ranking', this.right);
        this.top = makeUiNode('CourseProgress', this.root);
        const readouts = makeUiNode('StatusReadouts', this.left);
        this.label(readouts, 'SpeedTitle', '速度', 28, 19, 70, 25, 18, true, 'left');
        this.speed = this.label(readouts, 'SpeedValue', '0.00', 27, 41, 126, 65, 72, true, 'left');
        this.speed.font = speedFont;
        const unit = this.label(readouts, 'SpeedUnit', 'm/s', 149, 73, 48, 31, 30.6, true, 'left');
        unit.font = speedFont;
        // 专用字体回调由预加载完成；不要再让通用字库异步覆盖它。
        this.sprite(readouts, 'HeartBase', 'base', 22, 114, 76, 76);
        this.sprite(readouts, 'HeartTrack', 'ring', 22, 114, 76, 76, TRACK);
        this.heartRing = this.ring(readouts, 'HeartFill', 22, 114, 76, RED);
        this.heartIcon = this.sprite(readouts, 'Heart', 'heart', 48, 130, 26, 22, RED);
        this.heartValue = this.label(readouts, 'HeartValue', '80', 30, 152, 60, 25, 18.4);
        this.label(readouts, 'HeartCaption', '心率', 30, 180, 60, 24, 15.3);
        this.heartTierLabel = this.label(readouts, 'HeartTier', '轻松', 30, 203, 60, 22, 15.3);
        this.warning = makeUiNode('HeartWarning', readouts);
        this.sprite(this.warning, 'WarningBase', 'warning', 75, 110, 18, 18);
        this.label(this.warning, 'WarningMark', '!', 75, 109, 18, 20, 14);
        this.warning.active = false;
        this.sprite(readouts, 'EnergyBase', 'base', 122, 114, 76, 76);
        this.energyTrack = this.sprite(readouts, 'EnergyTrack', 'ring', 122, 114, 76, 76, TRACK);
        this.energyRing = this.ring(readouts, 'EnergyFill', 122, 114, 76, CYAN);
        this.energyIcon = this.sprite(readouts, 'Lightning', 'lightning', 151, 126, 21, 28, CYAN);
        this.energyIconOpacity = this.energyIcon.node.addComponent(UIOpacity);
        this.energyValue = this.label(readouts, 'EnergyValue', '100%', 128, 152, 64, 25, 18.4);
        this.label(readouts, 'EnergyCaption', '体力', 128, 180, 64, 24, 15.3);
        this.energyState = this.label(readouts, 'EnergyState', '体力耗尽', 118, 203, 84, 22, 15.3);
        this.energyState.color = RED;
        this.energyState.node.active = false;
        this.distance = this.label(this.top, 'Distance', '200 m', -232, 32, 53, 25, 14.5, true, 'right');
        this.sprite(this.top, 'ProgressTrack', 'progress', -173, 39, 399, 12, COURSE_TRACK);
        this.progress = this.sprite(this.top, 'ProgressFill', 'progress', -173, 39, 399, 12, CYAN);
        this.progress.type = Sprite.Type.FILLED;
        this.progress.fillType = Sprite.FillType.HORIZONTAL;
        this.progress.fillStart = 0;
        this.progress.fillRange = 0;
        this.percent = this.label(this.top, 'Percent', '0%', 235, 32, 54, 25, 14.5, true, 'left');
        this.label(this.ranking, 'RankingTitle', '排名', -53, 62, 40, 24, 13.8);
        for (let i = 0; i < 8; i++) {
            const root = makeUiNode(`Rank${i + 1}`, this.ranking);
            const normal = this.sprite(root, 'NormalRing', 'rankRing', -47, -15, 30, 30).node;
            const self = this.sprite(root, 'SelfRing', 'rankSelfRing', -60, -28, 56, 56).node;
            self.active = false;
            const portrait = this.sprite(root, 'Avatar', null, -45, -13, 26, 26);
            const number = this.label(root, 'RankNumber', String(i + 1), -76, -16, 27, 32, 18.4, true, 'right');
            root.active = false;
            this.ranks.push({ root, normal, self, portrait, number, identity: null, path: '', emphasized: null });
        }
        this.jump = makeUiNode('DolphinJumpButton', this.right);
        // 源稿圆心为(1149,449)，三个状态共用同一锚点。
        this.place(this.jump, -181, 399, 100, 100);
        this.jumpCharge = makeUiNode('JumpChargingVisual', this.jump);
        this.sprite(this.jumpCharge, 'JumpBase', 'base', -42, -42, 84, 84);
        this.sprite(this.jumpCharge, 'JumpTrack', 'ring', -44, -44, 88, 88, TRACK);
        this.jumpRing = this.ring(this.jumpCharge, 'JumpFill', -44, -44, 88, GOLD);
        this.jumpFace = this.sprite(this.jump, 'ReadyFace', 'jumpReady', -50, -51, 102, 102).node;
        this.jumpFace.active = false;
        this.dolphin = this.sprite(this.jump, 'Dolphin', 'dolphin', -22, -19, 43, 36, DOLPHIN_WHITE);
        this.label(this.jump, 'JumpCaption', '起跳', -36, 31, 72, 28, 17.6);
        this.jumpButton = this.jump.addComponent(Button);
        this.jumpButton.transition = Button.Transition.SCALE;
        this.jumpButton.zoomScale = 0.94;
        this.jumpButton.interactable = false;
        this.jump.addComponent(BlockInputEvents);
        this.jump.on(Button.EventType.CLICK, () => {
            if (!this.jump.activeInHierarchy || !this.ready || this.observedSwimmer) return;
            this.setReady(false);
            onJump();
        });
        this.stroke = new RaceStrokeView(this.left, this.right, key => FRAMES.get(key)!,
            this.entrance, () => this.entrance.finishControls());
        this.entrance.wrap(readouts, -12, 0, 0.22);
        this.entrance.wrap(this.top, 0, 8, 0.2, 0.04);
        this.entrance.wrap(this.ranking, 12, 0, 0.22, 0.08);
        this.entrance.wrap(this.jump, 0, 0, 0.16, 0.04, true);
        this.layout();
        view.on('canvas-resize', this.layout, this);
        view.on('design-resolution-changed', this.layout, this);
        this.root.once(Node.EventType.NODE_DESTROYED, () => {
            this.entrance.dispose();
            view.off('canvas-resize', this.layout, this);
            view.off('design-resolution-changed', this.layout, this);
            this.identities.clear();
        });
        this.root.active = false;
    }

    private layout() {
        if (!this.root.isValid) return;
        const size = view.getVisibleSize();
        const safe = sys.getSafeAreaRect(false);
        const left = Math.max(0, safe.x), right = Math.max(0, size.width - safe.x - safe.width);
        this.scale = Math.min(1, (size.width - left - right) / 1280, safe.height / 720);
        this.root.setScale(this.scale, this.scale, 1);
        this.left.setPosition((-size.width / 2 + left) / this.scale, (size.height / 2 - Math.max(0, size.height - safe.y - safe.height)) / this.scale);
        this.right.setPosition((size.width / 2 - right) / this.scale, this.left.position.y);
        this.top.setPosition((left - right) / 2 / this.scale, this.left.position.y);
        // 安全区不包含微信胶囊；排行保持靠右，仅将标题和头像整体下移到胶囊底边以下。
        // 62 是标题在组内的顶边；扣除已生效的顶部安全区和设计留白，避免重复下移。
        const reservedBottom = size.height * platform().getTopRightReservedBottomRatio();
        const safeTop = Math.max(0, size.height - safe.y - safe.height);
        const rankingY = reservedBottom > 0
            ? -Math.max(0, (reservedBottom - safeTop) / this.scale + 12 - 62) : 0;
        if (this.ranking.position.y !== rankingY) this.ranking.setPosition(0, rankingY, 0);
    }

    setDolphinSupported(supported: boolean) {
        if (this.jump.active === supported) return;
        this.entrance.setPartVisible(this.jump, supported);
        if (!supported) this.setReady(false);
    }

    setObservedSwimmer(swimmer: Swimmer | null) {
        if (this.observedSwimmer === swimmer) return;
        this.observedSwimmer = swimmer;
        this.elapsed = 0.1;
        this.stroke.resetFeedback(!!swimmer);
        const interactable = this.ready && !swimmer;
        if (this.jumpButton.interactable !== interactable) this.jumpButton.interactable = interactable;
    }

    setVisible(visible: boolean) {
        if (this.root.active === visible) return;
        this.root.active = visible;
        if (visible) this.layout();
        this.stroke.setVisible(visible);
        if (visible) this.entrance.play();
        else this.entrance.reset();
        this.elapsed = 0.1;
        if (!visible) { this.setReady(false); }
    }
    /** 先门控再读取/格式化数据，UI 节流不影响玩法和网络。 */
    consumeSample(dt: number): boolean {
        if (!this.root.activeInHierarchy) return false;
        const elapsed = Math.max(0, dt);
        if (this.energyDepleted) this.energyPulsePhase = (this.energyPulsePhase + elapsed / 1.6) % 1;
        this.pulsePhase = (this.pulsePhase + elapsed * this.displayedHeart / 60) % 1;
        this.pulseElapsed += elapsed;
        if (this.pulseElapsed >= 1 / 30) {
            this.pulseElapsed %= 1 / 30;
            // 只缩放心形；数值、文字、完美区边界保持稳定。
            const beat = Math.max(0, Math.sin(this.pulsePhase * Math.PI * 2));
            const scale = Math.round((1 + HEART_TIERS[this.displayedHeartTier].amplitude * beat * beat) * 1000) / 1000;
            if (scale !== this.heartScale) { this.heartScale = scale; this.heartIcon.node.setScale(scale, scale, 1); }
            // 体力耗尽只让闪电缓慢呼吸，提示文字及空槽保持稳定；复用 30Hz 采样。
            if (this.energyDepleted) {
                const opacity = Math.round(207 + 48 * Math.cos(this.energyPulsePhase * Math.PI * 2));
                if (this.energyIconOpacity.opacity !== opacity) this.energyIconOpacity.opacity = opacity;
            }
        }
        this.elapsed += elapsed;
        if (this.elapsed < 0.1) return false;
        this.elapsed %= 0.1;
        return true;
    }
    updateValues(speed: number, heart: number, _overload: boolean, energyRatio: number, distance: number, total: number, ultimateRatio: number, canJump: boolean, infiniteStamina = false) {
        if (!this.root.activeInHierarchy) return;
        this.text(this.speed, Math.max(0, speed).toFixed(2));
        this.displayedHeart = Math.max(80, Math.min(180, heart));
        this.displayedHeartTier = heartRateTier(this.displayedHeart);
        const tier = HEART_TIERS[this.displayedHeartTier];
        this.text(this.heartValue, String(Math.round(this.displayedHeart)));
        this.text(this.heartTierLabel, tier.label);
        if (!this.heartTierLabel.color.equals(tier.color)) this.heartTierLabel.color = tier.color;
        this.text(this.energyValue, infiniteStamina ? '无限' : `${Math.round(clamp(energyRatio) * 100)}%`);
        // 使用实际资源判断，不能把尚有体力但取整显示 0% 的情况当作耗尽。
        this.setEnergyDepleted(energyRatio <= 0);
        this.text(this.distance, `${total} m`);
        const progress = clamp(distance / Math.max(1, total));
        this.text(this.percent, `${Math.round(progress * 100)}%`);
        this.fill(this.progress, Math.round(progress * 399) / 399);
        this.fill(this.heartRing, -0.75 * Math.round(clamp(this.displayedHeart / 180) * 100) / 100);
        this.fill(this.energyRing, -0.75 * Math.round(clamp(energyRatio) * 100) / 100);
        if (this.jump.active) {
            this.fill(this.jumpRing, -0.75 * Math.round(clamp(ultimateRatio) * 100) / 100);
            this.setReady(canJump && ultimateRatio >= 1);
        }
        this.tint(this.heartIcon, tier.color);
        this.tint(this.heartRing, tier.color);
        this.active(this.warning, this.displayedHeartTier === 3);
    }
    showStrokePraise(side: StrokeType | undefined, text: string, color: Color | undefined, combo: number) {
        this.stroke.showPraise(side, text, color, combo);
    }
    setRoster(entries: readonly HudRosterEntry[]) {
        this.identities.clear();
        for (const entry of entries) this.identities.set(entry.swimmer, avatarTexturePath(entry.avatarId));
        for (const slot of this.ranks) { slot.identity = null; slot.path = ''; this.active(slot.root, false); }
    }
    updateRanks(results: readonly RaceFinishResult[]) {
        if (!this.root.activeInHierarchy) return;
        let y = 84;
        for (let i = 0; i < this.ranks.length; i++) {
            const slot = this.ranks[i], result = results[i];
            this.active(slot.root, Boolean(result));
            if (!result) { slot.identity = null; slot.path = ''; continue; }
            const self = this.observedSwimmer ? result.swimmer === this.observedSwimmer : result.isPlayer;
            const height = self ? 62 : 32;
            const center = -(y + height / 2);
            if (slot.root.position.y !== center) slot.root.setPosition(0, center, 0);
            y += height;
            if (slot.emphasized !== self) {
                slot.emphasized = self;
                this.active(slot.normal, !self); this.active(slot.self, self);
                this.place(slot.portrait.node, self ? -55 : -45, self ? -23 : -13, self ? 46 : 26, self ? 46 : 26);
                this.place(slot.number.node, self ? -101 : -76, self ? -31 : -16, self ? 43 : 27, self ? 62 : 32);
                slot.number.fontSize = self ? 39.8 : 18.4;
                slot.number.lineHeight = self ? 60 : 32;
            }
            this.text(slot.number, String(result.placement));
            const path = this.identities.get(result.swimmer) ?? '';
            if (slot.path === path && slot.identity === result.swimmer) continue;
            slot.path = path; slot.identity = result.swimmer;
            slot.portrait.spriteFrame = null;
            if (path) loadAvatarUiSpriteFrame(path, frame => {
                if (slot.portrait.isValid && slot.path === path && slot.identity === result.swimmer) slot.portrait.spriteFrame = frame;
            });
        }
    }
    private setEnergyDepleted(depleted: boolean) {
        if (this.energyDepleted === depleted) return;
        this.energyDepleted = depleted;
        this.energyPulsePhase = 0;
        if (this.energyIconOpacity.opacity !== 255) this.energyIconOpacity.opacity = 255;
        this.active(this.energyState.node, depleted);
        const color = depleted ? RED : WHITE;
        if (!this.energyValue.color.equals(color)) this.energyValue.color = color;
        this.tint(this.energyIcon, depleted ? RED : CYAN);
        this.tint(this.energyTrack, depleted ? DEPLETED_TRACK : TRACK);
    }
    private setReady(ready: boolean) {
        if (this.ready === ready) return;
        this.ready = ready;
        this.jumpButton.interactable = ready && !this.observedSwimmer;
        this.active(this.jumpFace, ready);
        this.active(this.jumpCharge, !ready);
        this.tint(this.dolphin, ready ? WHITE : DOLPHIN_WHITE);
    }
    private text(label: Label, value: string) { if (label.string !== value) label.string = value; }
    private active(node: Node, value: boolean) { if (node.active !== value) node.active = value; }
    private fill(sprite: Sprite, value: number) { if (sprite.fillRange !== value) sprite.fillRange = value; }
    private tint(sprite: Sprite, color: Color) { if (!sprite.color.equals(color)) sprite.color = color; }
    private place(node: Node, x: number, y: number, w: number, h: number) {
        node.getComponent(UITransform)!.setContentSize(w, h);
        node.setPosition(x + w / 2, -y - h / 2, 0);
    }
    private sprite(parent: Node, name: string, key: ArtKey | null, x: number, y: number, w: number, h: number, tint = Color.WHITE): Sprite {
        const node = makeUiNode(name, parent);
        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.trim = false;
        sprite.spriteFrame = key ? FRAMES.get(key)! : null;
        sprite.color = tint;
        this.place(node, x, y, w, h);
        return sprite;
    }
    private ring(parent: Node, name: string, x: number, y: number, size: number, color: Color): Sprite {
        const sprite = this.sprite(parent, name, 'ring', x, y, size, size, color);
        sprite.type = Sprite.Type.FILLED;
        sprite.fillType = Sprite.FillType.RADIAL;
        sprite.fillCenter = new Vec2(0.5, 0.5);
        sprite.fillStart = 0.625;
        sprite.fillRange = 0;
        return sprite;
    }
    private label(parent: Node, name: string, text: string, x: number, y: number, w: number, h: number, size: number, bold = true, align: 'left' | 'right' | 'center' = 'center'): Label {
        const node = makeUiNode(name, parent);
        const label = node.addComponent(Label);
        label.overflow = Label.Overflow.SHRINK;
        label.enableWrapText = false;
        label.fontSize = size;
        label.string = text;
        // 按源稿轻黑描边提高水面上的可读性，仅创建时设置。
        label.color = WHITE;
        label.enableOutline = true;
        label.outlineColor = TEXT_OUTLINE;
        label.outlineWidth = 1.5;
        label.horizontalAlign = align === 'left' ? Label.HorizontalAlign.LEFT : align === 'right' ? Label.HorizontalAlign.RIGHT : Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        if (name !== 'SpeedValue' && name !== 'SpeedUnit') styleProjectUiLabel(label, bold ? 'semibold' : 'regular', size + 7);
        else label.lineHeight = size;
        this.place(node, x, y, w, h);
        return label;
    }
}
function clamp(value: number) { return Math.max(0, Math.min(1, value)); }
