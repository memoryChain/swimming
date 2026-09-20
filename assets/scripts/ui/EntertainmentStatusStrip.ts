import {
    Color,
    Label,
    LabelOutline,
    Node,
    Sprite,
    SpriteFrame,
    Texture2D,
    UITransform,
} from 'cc';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { makeLabel, makeUiNode, uiColor } from './RuntimeUiFactory';
import { styleProjectUiLabel } from './ProjectUiFonts';

export type EntertainmentStatusTone = 'normal' | 'warning' | 'danger' | 'protect';

export const ENTERTAINMENT_STATUS_STRIP_WIDTH = 560;
export const ENTERTAINMENT_STATUS_STRIP_HEIGHT = 56;

const MESSAGE_TEXT = new Color(244, 251, 255, 255);
const VALUE_COLORS: Record<EntertainmentStatusTone, Readonly<Color>> = {
    normal: new Color(226, 247, 255, 255),
    warning: new Color(255, 220, 66, 255),
    danger: new Color(255, 104, 88, 255),
    protect: new Color(116, 236, 255, 255),
};

/**
 * 娱乐玩法共用的无图标持续状态条。
 * 底板只承载统一造型，说明和值均为运行时 Label；每个玩法仍持有自己的实例和生命周期。
 */
export class EntertainmentStatusStrip {
    readonly root: Node;
    private readonly messageLabel: Label;
    private readonly valueLabel: Label;
    private readonly valueRoot: Node;
    private ownedFrame: SpriteFrame | null = null;
    private lastMessage = '';
    private lastValue = '';
    private lastTone: EntertainmentStatusTone = 'normal';
    private valueVisible = true;

    constructor(parent: Node, name: string) {
        this.root = makeUiNode(name, parent);
        this.root.getComponent(UITransform)!.setContentSize(
            ENTERTAINMENT_STATUS_STRIP_WIDTH,
            ENTERTAINMENT_STATUS_STRIP_HEIGHT,
        );

        const background = makeUiNode('Background', this.root);
        background.getComponent(UITransform)!.setContentSize(
            ENTERTAINMENT_STATUS_STRIP_WIDTH,
            ENTERTAINMENT_STATUS_STRIP_HEIGHT,
        );
        const backgroundSprite = background.addComponent(Sprite);
        backgroundSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        backgroundSprite.type = Sprite.Type.SIMPLE;
        backgroundSprite.trim = false;

        const messageNode = makeLabel('Message', this.root, '', 22, MESSAGE_TEXT);
        messageNode.getComponent(UITransform)!.setContentSize(360, 48);
        messageNode.setPosition(-84, 0, 1);
        this.messageLabel = messageNode.getComponent(Label)!;
        this.messageLabel.enableWrapText = false;
        this.messageLabel.overflow = Label.Overflow.SHRINK;
        this.messageLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        styleProjectUiLabel(this.messageLabel, 'semibold', 34);
        const messageOutline = messageNode.addComponent(LabelOutline);
        messageOutline.color = uiColor(0, 6, 14, 205);
        messageOutline.width = 2;

        this.valueRoot = makeUiNode('ValueArea', this.root);
        this.valueRoot.getComponent(UITransform)!.setContentSize(146, 48);
        this.valueRoot.setPosition(184, 0, 1);
        const valueNode = makeLabel('Value', this.valueRoot, '', 27, VALUE_COLORS.normal);
        valueNode.getComponent(UITransform)!.setContentSize(142, 48);
        this.valueLabel = valueNode.getComponent(Label)!;
        this.valueLabel.enableWrapText = false;
        this.valueLabel.overflow = Label.Overflow.SHRINK;
        this.valueLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        styleProjectUiLabel(this.valueLabel, 'semibold', 38);
        const valueOutline = valueNode.addComponent(LabelOutline);
        valueOutline.color = uiColor(0, 6, 14, 220);
        valueOutline.width = 2;

        loadRaceAsset(RESOURCE_PATHS.entertainmentStatusUi.base, Texture2D, (error, texture) => {
            if (error || !texture || !this.root.isValid || !backgroundSprite.isValid) return;
            const frame = new SpriteFrame();
            frame.texture = texture;
            this.ownedFrame?.destroy();
            this.ownedFrame = frame;
            if (backgroundSprite.spriteFrame !== frame) backgroundSprite.spriteFrame = frame;
        });
        this.root.once(Node.EventType.NODE_DESTROYED, () => {
            this.ownedFrame?.destroy();
            this.ownedFrame = null;
        });
        this.root.active = false;
    }

    setContent(message: string, value: string, tone: EntertainmentStatusTone): void {
        if (!this.root.active) this.root.active = true;
        const hasValue = value.length > 0;
        if (hasValue !== this.valueVisible) {
            this.valueVisible = hasValue;
            this.valueRoot.active = hasValue;
            const transform = this.messageLabel.node.getComponent(UITransform)!;
            transform.setContentSize(hasValue ? 360 : 500, 48);
            this.messageLabel.node.setPosition(hasValue ? -84 : 0, 0, 1);
        }
        if (message !== this.lastMessage) {
            this.lastMessage = message;
            this.messageLabel.string = message;
        }
        if (value !== this.lastValue) {
            this.lastValue = value;
            this.valueLabel.string = value;
        }
        if (tone !== this.lastTone) {
            this.lastTone = tone;
            const color = VALUE_COLORS[tone];
            if (!this.valueLabel.color.equals(color)) this.valueLabel.color = color;
        }
    }

    hide(): void {
        if (this.root.active) this.root.active = false;
    }

    reset(): void {
        this.lastMessage = '';
        this.lastValue = '';
        this.lastTone = 'normal';
        if (!this.valueLabel.color.equals(VALUE_COLORS.normal)) this.valueLabel.color = VALUE_COLORS.normal;
        this.hide();
    }

    dispose(): void {
        if (this.root?.isValid) this.root.destroy();
    }
}
