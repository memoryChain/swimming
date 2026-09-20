import { BlockInputEvents, Color, Graphics, Label, LabelOutline, Node, Sprite, SpriteFrame, Texture2D, Tween, tween, UIOpacity, UITransform, Vec3, view } from 'cc';
import { ENTERTAINMENT_RECOVERY_TUNING, EntertainmentRecoveryPhase } from '../core/EntertainmentRecoveryController';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { makeLabel, makeRoundedRect, makeUiNode, uiColor } from './RuntimeUiFactory';
import { styleProjectUiLabel } from './ProjectUiFonts';

const SAMPLE_SECONDS = 0.1;
const EMERGENCY_DOT_SECONDS = 0.35;
const EMERGENCY_DOT_TEXTS = ['.', '..', '...'] as const;
const EMERGENCY_CARD_WIDTH = 980;
const EMERGENCY_CARD_HEIGHT = 276;
const EMERGENCY_CARD_SAFE_MARGIN = 36;
const EMERGENCY_CARD_Y = 42;
const EMERGENCY_IMPACT_HOLD_SECONDS = 0.45;
const EMERGENCY_DIM_DELAY_SECONDS = EMERGENCY_IMPACT_HOLD_SECONDS;
const EMERGENCY_DIM_FADE_SECONDS = 0.24;
const EMERGENCY_CARD_FADE_SECONDS = 0.12;
const EMERGENCY_CARD_APPROACH_SECONDS = 0.18;
const EMERGENCY_CARD_SETTLE_SECONDS = 0.1;
const EMERGENCY_CARD_ENTRY_X = -160;
const EMERGENCY_CARD_OVERSHOOT_X = 12;
const EMERGENCY_CARD_EXIT_SECONDS = 0.17;
const EMERGENCY_CARD_EXIT_X = 140;
const EMERGENCY_PROGRESS_WIDTH = 420;
const EMERGENCY_PROGRESS_X = 88;
const EMERGENCY_PROGRESS_Y = -112;
const EMERGENCY_PROGRESS_STEPS = 100;
const INVULNERABLE_ENTER_SECONDS = 0.16;
const INVULNERABLE_SETTLE_SECONDS = 0.08;
const INVULNERABLE_TEXT = new Color(116, 236, 255, 255);
const DIM_COLOR = new Color(0, 7, 16, 205);

/** 玩家击倒／无敌提示；击倒阶段独占压暗层，倒计时仍只以 10Hz 刷新。 */
export class EntertainmentRecoveryHud {
    readonly root: Node;
    private readonly overlay: Node;
    private readonly inputBlocker: BlockInputEvents;
    private readonly dimRoot: Node;
    private readonly dimOpacity: UIOpacity;
    private readonly dimGraphics: Graphics;
    private readonly emergencyLayoutRoot: Node;
    private readonly emergencyMotionRoot: Node;
    private readonly emergencyCardOpacity: UIOpacity;
    private readonly emergencyLabelNode: Node;
    private readonly emergencyDotsLabel: Label;
    private readonly emergencyProgressFill: Node;
    private readonly statusRoot: Node;
    private readonly statusOpacity: UIOpacity;
    private readonly statusLabel: Label;
    private elapsed = SAMPLE_SECONDS;
    private emergencyElapsed = 0;
    private emergencyDotIndex = 0;
    private lastEmergencyDots = '';
    private emergencyProgressElapsed = SAMPLE_SECONDS;
    private lastEmergencyProgressStep = -1;
    private lastText = '';
    private lastPhase = EntertainmentRecoveryPhase.ACTIVE;
    private layoutWidth = 0;
    private layoutHeight = 0;
    private emergencyCardFrame: SpriteFrame | null = null;

    constructor(parent: Node) {
        this.root = makeUiNode('EntertainmentRecoveryHud', parent);

        this.overlay = makeUiNode('EmergencyOverlay', this.root);
        this.inputBlocker = this.overlay.addComponent(BlockInputEvents);
        this.dimRoot = makeUiNode('EmergencyDim', this.overlay);
        this.dimGraphics = this.dimRoot.addComponent(Graphics);
        this.dimOpacity = this.dimRoot.addComponent(UIOpacity);

        this.emergencyLayoutRoot = makeUiNode('EmergencyCardLayout', this.overlay);
        this.emergencyLayoutRoot.getComponent(UITransform)!.setContentSize(EMERGENCY_CARD_WIDTH, EMERGENCY_CARD_HEIGHT);
        this.emergencyMotionRoot = makeUiNode('EmergencyCardMotion', this.emergencyLayoutRoot);
        this.emergencyMotionRoot.getComponent(UITransform)!.setContentSize(EMERGENCY_CARD_WIDTH, EMERGENCY_CARD_HEIGHT);
        this.emergencyCardOpacity = this.emergencyMotionRoot.addComponent(UIOpacity);
        const cardNode = makeUiNode('EmergencyCardArt', this.emergencyMotionRoot);
        cardNode.getComponent(UITransform)!.setContentSize(EMERGENCY_CARD_WIDTH, EMERGENCY_CARD_HEIGHT);
        const cardSprite = cardNode.addComponent(Sprite);
        cardSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        cardSprite.trim = false;
        cardNode.once(Node.EventType.NODE_DESTROYED, () => {
            this.emergencyCardFrame?.destroy();
            this.emergencyCardFrame = null;
        });
        loadRaceAsset(RESOURCE_PATHS.entertainmentRecoveryUi.rescueCard, Texture2D, (error, texture) => {
            if (error || !texture || !cardNode.isValid || !cardSprite.isValid) return;
            const frame = new SpriteFrame();
            frame.texture = texture;
            this.emergencyCardFrame?.destroy();
            this.emergencyCardFrame = frame;
            cardSprite.spriteFrame = frame;
        });

        const emergencyStatusNode = makeLabel(
            'EmergencyStatusLabel', this.emergencyMotionRoot, '紧急救援', 34, uiColor(255, 251, 246, 255),
        );
        emergencyStatusNode.getComponent(UITransform)!.setContentSize(230, 58);
        emergencyStatusNode.setPosition(-170, 42, 1);
        const emergencyStatusLabel = emergencyStatusNode.getComponent(Label)!;
        emergencyStatusLabel.enableWrapText = false;
        emergencyStatusLabel.overflow = Label.Overflow.SHRINK;
        styleProjectUiLabel(emergencyStatusLabel, 'semibold', 42);
        const emergencyStatusOutline = emergencyStatusNode.addComponent(LabelOutline);
        emergencyStatusOutline.color = uiColor(80, 18, 14, 180);
        emergencyStatusOutline.width = 2;

        this.emergencyLabelNode = makeLabel('EmergencyLabel', this.emergencyMotionRoot, '急救中', 74, uiColor(244, 251, 255, 255));
        this.emergencyLabelNode.getComponent(UITransform)!.setContentSize(400, 112);
        this.emergencyLabelNode.setPosition(0, -48, 1);
        const emergencyLabel = this.emergencyLabelNode.getComponent(Label)!;
        emergencyLabel.enableWrapText = false;
        emergencyLabel.overflow = Label.Overflow.SHRINK;
        styleProjectUiLabel(emergencyLabel, 'semibold', 88);
        const emergencyOutline = this.emergencyLabelNode.addComponent(LabelOutline);
        emergencyOutline.color = uiColor(0, 6, 14, 235);
        emergencyOutline.width = 4;

        const emergencyDotsNode = makeLabel('EmergencyDots', this.emergencyMotionRoot, EMERGENCY_DOT_TEXTS[0], 74, uiColor(244, 251, 255, 255));
        emergencyDotsNode.getComponent(UITransform)!.setContentSize(120, 112);
        emergencyDotsNode.setPosition(160, -48, 1);
        this.emergencyDotsLabel = emergencyDotsNode.getComponent(Label)!;
        this.emergencyDotsLabel.enableWrapText = false;
        this.emergencyDotsLabel.overflow = Label.Overflow.SHRINK;
        this.emergencyDotsLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        styleProjectUiLabel(this.emergencyDotsLabel, 'semibold', 88);
        const emergencyDotsOutline = emergencyDotsNode.addComponent(LabelOutline);
        emergencyDotsOutline.color = uiColor(0, 6, 14, 235);
        emergencyDotsOutline.width = 4;

        const progressTrack = makeRoundedRect(
            'EmergencyProgressTrack', this.emergencyMotionRoot,
            EMERGENCY_PROGRESS_WIDTH + 8, 14,
            uiColor(2, 14, 29, 220), 7,
            uiColor(255, 112, 54, 190), 1,
        );
        progressTrack.setPosition(EMERGENCY_PROGRESS_X, EMERGENCY_PROGRESS_Y, 1);
        this.emergencyProgressFill = makeRoundedRect(
            'EmergencyProgressFill', progressTrack,
            EMERGENCY_PROGRESS_WIDTH, 8,
            uiColor(255, 116, 52, 255), 4,
        );
        this.setEmergencyProgressStep(0);

        this.statusRoot = makeRoundedRect(
            'InvulnerabilityStatus', this.root, 560, 42,
            uiColor(7, 24, 36, 220), 18,
            uiColor(105, 222, 255, 230), 2,
        );
        this.statusOpacity = this.statusRoot.addComponent(UIOpacity);
        this.layout();
        view.on('canvas-resize', this.layout, this);
        view.on('design-resolution-changed', this.layout, this);
        const labelNode = makeLabel('Status', this.statusRoot, '', 19, INVULNERABLE_TEXT);
        labelNode.getComponent(UITransform)?.setContentSize(530, 38);
        this.statusLabel = labelNode.getComponent(Label)!;
        this.statusLabel.enableWrapText = false;
        this.statusLabel.overflow = Label.Overflow.SHRINK;
        styleProjectUiLabel(this.statusLabel, 'semibold', 34);
        const outline = labelNode.addComponent(LabelOutline);
        outline.color = uiColor(0, 0, 0, 100);
        outline.width = 1;
        this.overlay.active = false;
        this.statusRoot.active = false;
        this.inputBlocker.enabled = false;
        this.root.active = false;
    }

    reset(): void {
        Tween.stopAllByTarget(this.dimOpacity);
        Tween.stopAllByTarget(this.emergencyCardOpacity);
        Tween.stopAllByTarget(this.emergencyMotionRoot);
        Tween.stopAllByTarget(this.emergencyLabelNode);
        Tween.stopAllByTarget(this.statusOpacity);
        Tween.stopAllByTarget(this.statusRoot);
        this.elapsed = SAMPLE_SECONDS;
        this.emergencyElapsed = 0;
        this.emergencyDotIndex = 0;
        this.lastEmergencyDots = '';
        this.emergencyProgressElapsed = SAMPLE_SECONDS;
        this.lastEmergencyProgressStep = -1;
        this.lastText = '';
        this.lastPhase = EntertainmentRecoveryPhase.ACTIVE;
        this.emergencyMotionRoot.setPosition(0, 0, 0);
        this.emergencyMotionRoot.setScale(1, 1, 1);
        this.emergencyLabelNode.setScale(1, 1, 1);
        this.statusRoot.setScale(1, 1, 1);
        this.dimOpacity.opacity = 0;
        this.emergencyCardOpacity.opacity = 0;
        this.statusOpacity.opacity = 0;
        this.inputBlocker.enabled = false;
        this.setEmergencyProgressStep(0);
        if (this.overlay.active) this.overlay.active = false;
        if (this.statusRoot.active) this.statusRoot.active = false;
        if (this.root.active) this.root.active = false;
    }

    update(dt: number, phase: EntertainmentRecoveryPhase, remainingSeconds: number): void {
        const visible = phase !== EntertainmentRecoveryPhase.ACTIVE;
        if (this.root.active !== visible) this.root.active = visible;
        if (!visible) {
            if (phase !== this.lastPhase) this.transitionTo(phase);
            return;
        }
        if (phase !== this.lastPhase) this.transitionTo(phase);
        if (phase === EntertainmentRecoveryPhase.KNOCKED) {
            this.updateEmergencyText(dt);
            this.updateEmergencyProgress(dt, remainingSeconds);
            return;
        }
        this.elapsed += Math.max(0, Number.isFinite(dt) ? dt : 0);
        if (this.elapsed < SAMPLE_SECONDS) return;
        this.elapsed %= SAMPLE_SECONDS;
        const seconds = Math.max(0, Math.ceil(remainingSeconds * 10) / 10).toFixed(1);
        const text = `无敌保护 · ${seconds}秒`;
        if (text !== this.lastText) {
            this.lastText = text;
            this.statusLabel.string = text;
        }
    }

    dispose(): void {
        view.off('canvas-resize', this.layout, this);
        view.off('design-resolution-changed', this.layout, this);
        Tween.stopAllByTarget(this.dimOpacity);
        Tween.stopAllByTarget(this.emergencyCardOpacity);
        Tween.stopAllByTarget(this.emergencyMotionRoot);
        Tween.stopAllByTarget(this.emergencyLabelNode);
        Tween.stopAllByTarget(this.statusOpacity);
        Tween.stopAllByTarget(this.statusRoot);
        this.emergencyCardFrame?.destroy();
        this.emergencyCardFrame = null;
        if (this.root?.isValid) this.root.destroy();
    }

    private transitionTo(phase: EntertainmentRecoveryPhase): void {
        this.lastPhase = phase;
        this.elapsed = SAMPLE_SECONDS;
        Tween.stopAllByTarget(this.dimOpacity);
        Tween.stopAllByTarget(this.emergencyCardOpacity);
        Tween.stopAllByTarget(this.emergencyMotionRoot);
        Tween.stopAllByTarget(this.emergencyLabelNode);
        Tween.stopAllByTarget(this.statusOpacity);
        Tween.stopAllByTarget(this.statusRoot);
        this.emergencyMotionRoot.setPosition(0, 0, 0);
        this.emergencyMotionRoot.setScale(1, 1, 1);
        this.emergencyLabelNode.setScale(1, 1, 1);
        if (phase === EntertainmentRecoveryPhase.KNOCKED) {
            if (this.root.parent) this.root.setSiblingIndex(this.root.parent.children.length - 1);
            if (this.statusRoot.active) this.statusRoot.active = false;
            if (!this.overlay.active) this.overlay.active = true;
            this.inputBlocker.enabled = true;
            this.emergencyElapsed = -EMERGENCY_IMPACT_HOLD_SECONDS;
            this.emergencyDotIndex = 0;
            this.writeEmergencyDots(EMERGENCY_DOT_TEXTS[0]);
            this.emergencyProgressElapsed = SAMPLE_SECONDS;
            this.lastEmergencyProgressStep = -1;
            this.setEmergencyProgressStep(0);
            this.dimOpacity.opacity = 0;
            this.emergencyCardOpacity.opacity = 0;
            tween(this.dimOpacity)
                .delay(EMERGENCY_DIM_DELAY_SECONDS)
                .to(EMERGENCY_DIM_FADE_SECONDS, { opacity: 255 }, { easing: 'quadOut' })
                .start();
            tween(this.emergencyCardOpacity)
                .delay(EMERGENCY_IMPACT_HOLD_SECONDS)
                .to(EMERGENCY_CARD_FADE_SECONDS, { opacity: 255 }, { easing: 'quadOut' })
                .start();
            this.emergencyMotionRoot.setPosition(EMERGENCY_CARD_ENTRY_X, 0, 0);
            this.emergencyMotionRoot.setScale(0.9, 0.96, 1);
            tween(this.emergencyMotionRoot)
                .delay(EMERGENCY_IMPACT_HOLD_SECONDS)
                .to(EMERGENCY_CARD_APPROACH_SECONDS, {
                    position: new Vec3(EMERGENCY_CARD_OVERSHOOT_X, 0, 0),
                    scale: new Vec3(1.025, 1.01, 1),
                }, { easing: 'cubicOut' })
                .to(EMERGENCY_CARD_SETTLE_SECONDS, {
                    position: new Vec3(0, 0, 0),
                    scale: new Vec3(1, 1, 1),
                }, { easing: 'quadInOut' })
                .start();
            this.emergencyLabelNode.setScale(0.9, 0.9, 1);
            tween(this.emergencyLabelNode)
                .delay(EMERGENCY_IMPACT_HOLD_SECONDS + 0.08)
                .to(0.12, { scale: new Vec3(1.06, 1.06, 1) }, { easing: 'backOut' })
                .to(0.08, { scale: new Vec3(1, 1, 1) }, { easing: 'quadInOut' })
                .start();
            return;
        }
        if (phase === EntertainmentRecoveryPhase.INVULNERABLE) {
            // 权威恢复边沿立即释放输入；急救卡和压暗层可继续完成视觉退场。
            this.inputBlocker.enabled = false;
            this.playInvulnerabilityEntry();
            if (this.overlay.active) {
                tween(this.emergencyCardOpacity).to(0.14, { opacity: 0 }, { easing: 'quadIn' }).start();
                tween(this.emergencyMotionRoot).to(EMERGENCY_CARD_EXIT_SECONDS, {
                    position: new Vec3(EMERGENCY_CARD_EXIT_X, 18, 0),
                    scale: new Vec3(0.94, 0.98, 1),
                }, { easing: 'cubicIn' }).start();
                tween(this.dimOpacity).to(0.2, { opacity: 0 }, { easing: 'quadIn' }).call(() => {
                    if (this.overlay.isValid) this.overlay.active = false;
                }).start();
            }
            return;
        }
        this.inputBlocker.enabled = false;
        if (this.statusRoot.active) this.statusRoot.active = false;
        this.dimOpacity.opacity = 0;
        this.emergencyCardOpacity.opacity = 0;
        if (this.overlay.active) this.overlay.active = false;
    }

    private updateEmergencyText(dt: number): void {
        this.emergencyElapsed += Math.max(0, Number.isFinite(dt) ? dt : 0);
        if (this.emergencyElapsed < EMERGENCY_DOT_SECONDS) return;
        const steps = Math.floor(this.emergencyElapsed / EMERGENCY_DOT_SECONDS);
        this.emergencyElapsed %= EMERGENCY_DOT_SECONDS;
        this.emergencyDotIndex = (this.emergencyDotIndex + steps) % EMERGENCY_DOT_TEXTS.length;
        this.writeEmergencyDots(EMERGENCY_DOT_TEXTS[this.emergencyDotIndex]);
    }

    private updateEmergencyProgress(dt: number, remainingSeconds: number): void {
        this.emergencyProgressElapsed += Math.max(0, Number.isFinite(dt) ? dt : 0);
        if (this.emergencyProgressElapsed < SAMPLE_SECONDS) return;
        this.emergencyProgressElapsed %= SAMPLE_SECONDS;
        const duration = Math.max(0.001, ENTERTAINMENT_RECOVERY_TUNING.knockedSeconds);
        const progress = 1 - Math.min(1, Math.max(0, remainingSeconds / duration));
        this.setEmergencyProgressStep(Math.round(progress * EMERGENCY_PROGRESS_STEPS));
    }

    private setEmergencyProgressStep(step: number): void {
        const safeStep = Math.min(EMERGENCY_PROGRESS_STEPS, Math.max(0, Math.round(step)));
        if (safeStep === this.lastEmergencyProgressStep) return;
        this.lastEmergencyProgressStep = safeStep;
        const ratio = safeStep / EMERGENCY_PROGRESS_STEPS;
        const x = -EMERGENCY_PROGRESS_WIDTH * 0.5 + EMERGENCY_PROGRESS_WIDTH * ratio * 0.5;
        this.emergencyProgressFill.setPosition(x, 0, 1);
        this.emergencyProgressFill.setScale(ratio, 1, 1);
    }

    private playInvulnerabilityEntry(): void {
        if (!this.statusRoot.active) this.statusRoot.active = true;
        this.statusOpacity.opacity = 0;
        this.statusRoot.setScale(0.9, 0.9, 1);
        tween(this.statusOpacity)
            .to(0.12, { opacity: 255 }, { easing: 'quadOut' })
            .start();
        tween(this.statusRoot)
            .to(INVULNERABLE_ENTER_SECONDS, { scale: new Vec3(1.04, 1.04, 1) }, { easing: 'backOut' })
            .to(INVULNERABLE_SETTLE_SECONDS, { scale: new Vec3(1, 1, 1) }, { easing: 'quadInOut' })
            .start();
    }

    private writeEmergencyDots(text: string): void {
        if (text === this.lastEmergencyDots) return;
        this.lastEmergencyDots = text;
        this.emergencyDotsLabel.string = text;
    }

    private layout(): void {
        if (!this.root?.isValid) return;
        const size = view.getVisibleSize();
        const width = Math.max(1, size.width);
        const height = Math.max(1, size.height);
        this.root.getComponent(UITransform)!.setContentSize(width, height);
        this.overlay.getComponent(UITransform)!.setContentSize(width, height);
        this.dimRoot.getComponent(UITransform)!.setContentSize(width, height);
        if (width !== this.layoutWidth || height !== this.layoutHeight) {
            this.layoutWidth = width;
            this.layoutHeight = height;
            this.dimGraphics.clear();
            this.dimGraphics.fillColor = DIM_COLOR;
            this.dimGraphics.rect(-width * 0.5, -height * 0.5, width, height);
            this.dimGraphics.fill();
        }
        const emergencyScale = Math.min(1, Math.max(0.55, (width - EMERGENCY_CARD_SAFE_MARGIN * 2) / EMERGENCY_CARD_WIDTH));
        if (this.emergencyLayoutRoot.scale.x !== emergencyScale || this.emergencyLayoutRoot.scale.y !== emergencyScale) {
            this.emergencyLayoutRoot.setScale(emergencyScale, emergencyScale, 1);
        }
        if (this.emergencyLayoutRoot.position.x !== 0 || this.emergencyLayoutRoot.position.y !== EMERGENCY_CARD_Y) {
            this.emergencyLayoutRoot.setPosition(0, EMERGENCY_CARD_Y, 0);
        }
        const y = height * 0.5 - 172;
        if (this.statusRoot.position.x !== 0 || this.statusRoot.position.y !== y) {
            this.statusRoot.setPosition(0, y, 0);
        }
    }
}
