import { BlockInputEvents, Color, Graphics, Label, LabelOutline, Node, Sprite, SpriteFrame, Texture2D, Tween, tween, UIOpacity, UITransform, Vec3, view } from 'cc';
import { EntertainmentRecoveryPhase } from '../core/EntertainmentRecoveryController';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { makeLabel, makeRoundedRect, makeUiNode, uiColor } from './RuntimeUiFactory';
import { styleProjectUiLabel } from './ProjectUiFonts';

const SAMPLE_SECONDS = 0.1;
const EMERGENCY_DOT_SECONDS = 0.35;
const EMERGENCY_TEXTS = ['急救中.', '急救中..', '急救中...'] as const;
const EMERGENCY_CARD_WIDTH = 640;
const EMERGENCY_CARD_HEIGHT = 282.5;
const EMERGENCY_IMPACT_HOLD_SECONDS = 0.45;
const EMERGENCY_DIM_DELAY_SECONDS = EMERGENCY_IMPACT_HOLD_SECONDS;
const EMERGENCY_DIM_FADE_SECONDS = 0.24;
const EMERGENCY_CARD_ENTER_SECONDS = 0.22;
const EMERGENCY_CARD_SETTLE_SECONDS = 0.12;
const INVULNERABLE_TEXT = new Color(116, 236, 255, 255);
const DIM_COLOR = new Color(0, 7, 16, 205);

/** 玩家击倒／无敌提示；击倒阶段独占压暗层，倒计时仍只以 10Hz 刷新。 */
export class EntertainmentRecoveryHud {
    readonly root: Node;
    private readonly overlay: Node;
    private readonly dimRoot: Node;
    private readonly dimOpacity: UIOpacity;
    private readonly dimGraphics: Graphics;
    private readonly emergencyMotionRoot: Node;
    private readonly emergencyCardOpacity: UIOpacity;
    private readonly emergencyLabelNode: Node;
    private readonly emergencyLabel: Label;
    private readonly statusRoot: Node;
    private readonly statusLabel: Label;
    private elapsed = SAMPLE_SECONDS;
    private emergencyElapsed = 0;
    private emergencyTextIndex = 0;
    private lastEmergencyText = '';
    private lastText = '';
    private lastPhase = EntertainmentRecoveryPhase.ACTIVE;
    private layoutWidth = 0;
    private layoutHeight = 0;
    private emergencyCardFrame: SpriteFrame | null = null;

    constructor(parent: Node) {
        this.root = makeUiNode('EntertainmentRecoveryHud', parent);

        this.overlay = makeUiNode('EmergencyOverlay', this.root);
        this.overlay.addComponent(BlockInputEvents);
        this.dimRoot = makeUiNode('EmergencyDim', this.overlay);
        this.dimGraphics = this.dimRoot.addComponent(Graphics);
        this.dimOpacity = this.dimRoot.addComponent(UIOpacity);

        this.emergencyMotionRoot = makeUiNode('EmergencyCardMotion', this.overlay);
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

        this.emergencyLabelNode = makeLabel('EmergencyLabel', this.emergencyMotionRoot, EMERGENCY_TEXTS[0], 54, uiColor(244, 251, 255, 255));
        this.emergencyLabelNode.getComponent(UITransform)!.setContentSize(350, 90);
        this.emergencyLabelNode.setPosition(112, -4, 1);
        this.emergencyLabel = this.emergencyLabelNode.getComponent(Label)!;
        this.emergencyLabel.enableWrapText = false;
        this.emergencyLabel.overflow = Label.Overflow.SHRINK;
        styleProjectUiLabel(this.emergencyLabel, 'semibold', 66);
        const emergencyOutline = this.emergencyLabelNode.addComponent(LabelOutline);
        emergencyOutline.color = uiColor(0, 6, 14, 235);
        emergencyOutline.width = 7;

        this.statusRoot = makeRoundedRect(
            'InvulnerabilityStatus', this.root, 560, 42,
            uiColor(7, 24, 36, 220), 18,
            uiColor(105, 222, 255, 230), 2,
        );
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
        this.root.active = false;
    }

    reset(): void {
        Tween.stopAllByTarget(this.dimOpacity);
        Tween.stopAllByTarget(this.emergencyCardOpacity);
        Tween.stopAllByTarget(this.emergencyMotionRoot);
        this.elapsed = SAMPLE_SECONDS;
        this.emergencyElapsed = 0;
        this.emergencyTextIndex = 0;
        this.lastEmergencyText = '';
        this.lastText = '';
        this.lastPhase = EntertainmentRecoveryPhase.ACTIVE;
        this.emergencyMotionRoot.setPosition(0, 0, 0);
        this.emergencyMotionRoot.setScale(1, 1, 1);
        this.dimOpacity.opacity = 0;
        this.emergencyCardOpacity.opacity = 0;
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
        this.emergencyMotionRoot.setPosition(0, 0, 0);
        this.emergencyMotionRoot.setScale(1, 1, 1);
        if (phase === EntertainmentRecoveryPhase.KNOCKED) {
            if (this.root.parent) this.root.setSiblingIndex(this.root.parent.children.length - 1);
            if (this.statusRoot.active) this.statusRoot.active = false;
            if (!this.overlay.active) this.overlay.active = true;
            this.emergencyElapsed = -EMERGENCY_IMPACT_HOLD_SECONDS;
            this.emergencyTextIndex = 0;
            this.writeEmergencyText(EMERGENCY_TEXTS[0]);
            this.dimOpacity.opacity = 0;
            this.emergencyCardOpacity.opacity = 0;
            tween(this.dimOpacity)
                .delay(EMERGENCY_DIM_DELAY_SECONDS)
                .to(EMERGENCY_DIM_FADE_SECONDS, { opacity: 255 }, { easing: 'quadOut' })
                .start();
            tween(this.emergencyCardOpacity)
                .delay(EMERGENCY_IMPACT_HOLD_SECONDS)
                .to(EMERGENCY_CARD_ENTER_SECONDS, { opacity: 255 }, { easing: 'quadOut' })
                .start();
            this.emergencyMotionRoot.setPosition(0, -32, 0);
            this.emergencyMotionRoot.setScale(0.86, 0.86, 1);
            tween(this.emergencyMotionRoot)
                .delay(EMERGENCY_IMPACT_HOLD_SECONDS)
                .to(EMERGENCY_CARD_ENTER_SECONDS, {
                    position: new Vec3(0, 5, 0),
                    scale: new Vec3(1.04, 1.04, 1),
                }, { easing: 'backOut' })
                .to(EMERGENCY_CARD_SETTLE_SECONDS, {
                    position: new Vec3(0, 0, 0),
                    scale: new Vec3(1, 1, 1),
                }, { easing: 'quadInOut' })
                .call(() => this.startEmergencyBreathing())
                .start();
            return;
        }
        if (phase === EntertainmentRecoveryPhase.INVULNERABLE) {
            if (!this.statusRoot.active) this.statusRoot.active = true;
            if (this.overlay.active) {
                tween(this.emergencyCardOpacity).to(0.14, { opacity: 0 }, { easing: 'quadIn' }).start();
                tween(this.dimOpacity).to(0.2, { opacity: 0 }, { easing: 'quadIn' }).call(() => {
                    if (this.overlay.isValid) this.overlay.active = false;
                }).start();
            }
            return;
        }
        if (this.statusRoot.active) this.statusRoot.active = false;
        this.dimOpacity.opacity = 0;
        this.emergencyCardOpacity.opacity = 0;
        if (this.overlay.active) this.overlay.active = false;
    }

    private startEmergencyBreathing(): void {
        if (this.lastPhase !== EntertainmentRecoveryPhase.KNOCKED || !this.emergencyMotionRoot.isValid) return;
        tween(this.emergencyMotionRoot)
            .to(0.55, { position: new Vec3(0, 3, 0), scale: new Vec3(1.025, 1.025, 1) }, { easing: 'sineInOut' })
            .to(0.55, { position: new Vec3(0, -3, 0), scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
            .repeatForever()
            .start();
    }

    private updateEmergencyText(dt: number): void {
        this.emergencyElapsed += Math.max(0, Number.isFinite(dt) ? dt : 0);
        if (this.emergencyElapsed < EMERGENCY_DOT_SECONDS) return;
        const steps = Math.floor(this.emergencyElapsed / EMERGENCY_DOT_SECONDS);
        this.emergencyElapsed %= EMERGENCY_DOT_SECONDS;
        this.emergencyTextIndex = (this.emergencyTextIndex + steps) % EMERGENCY_TEXTS.length;
        this.writeEmergencyText(EMERGENCY_TEXTS[this.emergencyTextIndex]);
    }

    private writeEmergencyText(text: string): void {
        if (text === this.lastEmergencyText) return;
        this.lastEmergencyText = text;
        this.emergencyLabel.string = text;
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
        const y = height * 0.5 - 172;
        if (this.statusRoot.position.x !== 0 || this.statusRoot.position.y !== y) {
            this.statusRoot.setPosition(0, y, 0);
        }
    }
}
