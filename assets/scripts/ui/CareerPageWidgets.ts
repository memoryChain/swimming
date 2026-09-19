import { Button, Color, Label, Node, Sprite, SpriteFrame, Texture2D, UITransform } from 'cc';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { makeLabel, makeUiNode, uiColor } from './RuntimeUiFactory';
import { styleProjectUiLabel } from './ProjectUiFonts';
import { loadAvatarUiSpriteFrame as loadUiSpriteFrame } from './AvatarUiAssets';
import { careerButtonFeedback } from './CareerUiArt';

export const CAREER_INK = uiColor(9, 25, 67);
export const CAREER_MUTED = uiColor(74, 106, 151);
export const CAREER_WHITE = uiColor(248, 252, 255);
export const CAREER_YELLOW = uiColor(255, 222, 59);
export function showCareerNode(node: Node, value: boolean): void { if (node.active !== value) node.active = value; }
export function careerText(label: Label, value: string): void { if (label.string !== value) label.string = value; }
export function careerColor(target: Label | Sprite, color: Color): void { if (!target.color.equals(color)) target.color = color; }

/** 使用共享纹理缓存。旧请求与已销毁页面均不得回写；不重建控件。 */
export class CareerImage {
    readonly node: Node;
    readonly sprite: Sprite;
    private path = '';
    private ownedFrame: SpriteFrame | null = null;
    constructor(parent: Node, name: string, path: string, readonly width: number, readonly height: number,
        x: number, y: number, private readonly contain = false, private readonly sliced = false, private readonly sliceInset = 18) {
        this.node = makeUiNode(name, parent);
        this.node.setPosition(x, y);
        this.node.getComponent(UITransform)!.setContentSize(width, height);
        this.sprite = this.node.addComponent(Sprite);
        this.sprite.sizeMode = Sprite.SizeMode.CUSTOM; this.sprite.trim = false;
        if (sliced) this.sprite.type = Sprite.Type.SLICED;
        this.node.once(Node.EventType.NODE_DESTROYED, () => { this.ownedFrame?.destroy(); this.ownedFrame = null; });
        this.set(path);
    }
    set(path: string): void {
        if (this.path === path) return;
        this.path = path;
        if (this.sliced) {
            // 缓存SpriteFrame可能已被动态合图，frame.texture此时是整张图集。
            // 从资源缓存取得原始Texture2D创建独立帧，保持引擎正常合批能力。
            loadRaceAsset(path, Texture2D, (error, texture) => {
                if (error || !texture || !this.node.isValid || this.path !== path) return;
                const display = new SpriteFrame(); display.texture = texture;
                display.insetLeft = display.insetRight = Math.min(this.sliceInset, texture.width / 2);
                display.insetTop = display.insetBottom = Math.min(this.sliceInset, texture.height / 2);
                const previous = this.ownedFrame;
                this.ownedFrame = display; this.sprite.spriteFrame = display;
                previous?.destroy();
            });
            return;
        }
        loadUiSpriteFrame(path, frame => {
            if (!frame || !this.node.isValid || this.path !== path) return;
            if (this.sprite.spriteFrame !== frame) this.sprite.spriteFrame = frame;
            if (this.contain) {
                const scale = Math.min(this.width / frame.rect.width, this.height / frame.rect.height);
                const w = frame.rect.width * scale, h = frame.rect.height * scale, tr = this.node.getComponent(UITransform)!;
                if (tr.contentSize.width !== w || tr.contentSize.height !== h) tr.setContentSize(w, h);
            }
        });
    }
}

// PSD左上原点转换为组内Cocos坐标；子组同样保持1280×720参考原点。
export function careerImage(parent: Node, name: string, path: string, x: number, y: number,
    w: number, h: number, contain = false, sliced = false): CareerImage {
    return new CareerImage(parent, name, path, w, h, x + w / 2 - 640, 360 - y - h / 2, contain, sliced);
}
export function careerLabel(parent: Node, name: string, value: string, x: number, y: number,
    w: number, h: number, size: number, color = CAREER_INK, center = false, bold = true): Label {
    const node = makeLabel(name, parent, value, size, color);
    node.setPosition(x + w / 2 - 640, 360 - y - h / 2);
    const label = node.getComponent(Label)!;
    label.overflow = Label.Overflow.SHRINK; label.enableWrapText = false;
    label.horizontalAlign = center ? Label.HorizontalAlign.CENTER : Label.HorizontalAlign.LEFT;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    styleProjectUiLabel(label, bold ? 'semibold' : 'regular', size + 7);
    node.getComponent(UITransform)!.setContentSize(w, h);
    return label;
}

export class CareerControl {
    readonly root: Node;
    readonly label: Label;
    private readonly button: Button;
    private readonly art: CareerImage | null;
    private readonly arrow: CareerImage | null;
    private readonly lock: CareerImage | null;
    constructor(parent: Node, name: string, value: string, x: number, y: number, w: number, h: number,
        action: () => void, primary = false, fontSize = 24) {
        this.root = makeUiNode(name, parent);
        this.root.setPosition(x + w / 2 - 640, 360 - y - h / 2);
        this.root.getComponent(UITransform)!.setContentSize(w, h);
        this.button = this.root.addComponent(Button); this.button.target = this.root;
        careerButtonFeedback(this.root);
        this.art = primary ? new CareerImage(this.root, 'Surface', RESOURCE_PATHS.careerUi.button, w, h, 0, 0) : null;
        this.label = careerLabel(this.root, 'Label', value, 640 - w / 2 + 12, 360 - h / 2, w - 24, h, fontSize, CAREER_INK, true);
        this.arrow = primary ? new CareerImage(this.root, 'Arrow', RESOURCE_PATHS.careerUi.arrow, 27, 24, 105, 0) : null;
        this.lock = primary ? new CareerImage(this.root, 'Lock', RESOURCE_PATHS.careerUi.lock, 23, 32, -116, 0) : null;
        if (this.lock) this.lock.node.active = false;
        this.root.on(Button.EventType.CLICK, () => { if (this.button.interactable && this.root.activeInHierarchy) action(); });
    }
    update(value: string, enabled: boolean, locked = false): void {
        careerText(this.label, value);
        if (this.button.interactable !== enabled) this.button.interactable = enabled;
        this.art?.set(locked ? RESOURCE_PATHS.careerUi.disabledButton : RESOURCE_PATHS.careerUi.button);
        if (this.art) careerColor(this.label, locked ? CAREER_MUTED : CAREER_INK);
        if (this.arrow) showCareerNode(this.arrow.node, !locked);
        if (this.lock) showCareerNode(this.lock.node, locked);
        // 动态文案居中，箭头按实际字符宽度留出位置，不写死四字按钮。
        if (this.arrow) {
            const estimate = Math.min(value.length * this.label.fontSize, 250);
            const x = locked ? 18 : -20;
            if (this.label.node.position.x !== x) this.label.node.setPosition(x, 0);
            const arrowX = estimate / 2 + 10;
            if (this.arrow.node.position.x !== arrowX) this.arrow.node.setPosition(arrowX, 0);
        }
    }
}
