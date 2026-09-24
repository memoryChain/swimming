import { assetManager, Button, Color, Font, Label, Layers, Node, resources, Sprite, SpriteFrame, Texture2D, UITransform, view } from 'cc';
import { STARTUP_RESOURCES } from './StartupResources';
import { STARTUP_COPY } from './StartupCopy';

function loadTexture(path: string): Promise<Texture2D> {
    return new Promise((resolve, reject) => resources.load(path, Texture2D, (error, asset) => {
        if (error || !asset) reject(error ?? new Error(path)); else resolve(asset);
    }));
}
function loadFont(): Promise<Font> {
    return new Promise((resolve, reject) => assetManager.loadBundle(STARTUP_RESOURCES.fontBundle, (error, bundle) => {
        if (error || !bundle) { reject(error ?? new Error('首屏字体加载失败')); return; }
        bundle.load(STARTUP_RESOURCES.font, Font, (fontError, font) => {
            if (fontError || !font) reject(fontError ?? new Error('首屏字体缺失')); else resolve(font);
        });
    }));
}

export class StartupView {
    readonly root: Node;
    private label: Label | null = null;
    private state: keyof typeof STARTUP_COPY = 'start';
    private disposed = false;
    private readonly frames: SpriteFrame[] = [];
    private readonly layoutItems: { node: Node; x: number; y: number }[] = [];
    private background: Node | null = null;
    private readonly resize = () => this.layout();

    constructor(parent: Node, private readonly onStart: () => void) {
        this.root = this.node('StartupLogin', parent, 1280, 720);
        this.root.once(Node.EventType.NODE_DESTROYED, () => this.dispose());
        view.on('canvas-resize', this.resize);
        view.on('design-resolution-changed', this.resize);
    }

    async build(): Promise<void> {
        const paths = STARTUP_RESOURCES.loginUi;
        const [background, logo, button, arrow, font] = await Promise.all([
            loadTexture(paths.background), loadTexture(paths.logo), loadTexture(paths.primaryButton),
            loadTexture(paths.primaryArrow), loadFont(),
        ]);
        if (this.disposed || !this.root.isValid) return;
        this.background = this.sprite('Background', this.root, background, 1280, 720);
        this.art('Logo', logo, 608, 262, 28, 157);
        const primary = this.art('StartButton', button, 373, 119, -0.5, -151.5);
        const control = primary.addComponent(Button);
        control.target = primary;
        control.transition = Button.Transition.SCALE;
        control.zoomScale = 0.96;
        control.duration = 0.08;
        primary.on(Node.EventType.TOUCH_END, this.onStart);
        const labelNode = this.node('Label', primary, 160, 50);
        labelNode.setPosition(0, 0.5, 1);
        const label = labelNode.addComponent(Label);
        label.overflow = Label.Overflow.SHRINK;
        label.enableWrapText = false;
        label.font = font;
        label.useSystemFont = false;
        label.fontSize = 40;
        label.lineHeight = 50;
        label.color = new Color(0, 29, 65);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.string = STARTUP_COPY[this.state];
        labelNode.getComponent(UITransform)!.setContentSize(160, 50);
        this.label = label;
        this.sprite('Arrow', primary, arrow, 38, 38).setPosition(122.5, -0.5, 1);
        this.layout();
    }

    setState(state: keyof typeof STARTUP_COPY): void {
        this.state = state;
        if (this.label?.isValid && this.label.string !== STARTUP_COPY[state]) this.label.string = STARTUP_COPY[state];
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        view.off('canvas-resize', this.resize);
        view.off('design-resolution-changed', this.resize);
        for (const frame of this.frames) frame.destroy();
        this.frames.length = 0;
    }
    private node(name: string, parent: Node, w: number, h: number): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.setParent(parent);
        node.addComponent(UITransform).setContentSize(w, h);
        return node;
    }
    private sprite(name: string, parent: Node, texture: Texture2D, w: number, h: number): Node {
        const node = this.node(name, parent, w, h);
        const frame = new SpriteFrame(); frame.texture = texture; this.frames.push(frame);
        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.trim = false; sprite.spriteFrame = frame;
        node.getComponent(UITransform)!.setContentSize(w, h);
        return node;
    }
    private art(name: string, texture: Texture2D, w: number, h: number, x: number, y: number): Node {
        const node = this.sprite(name, this.root, texture, w, h);
        this.layoutItems.push({ node, x, y });
        return node;
    }
    private layout(): void {
        if (!this.root.isValid) return;
        const size = view.getVisibleSize();
        this.root.getComponent(UITransform)!.setContentSize(size.width, size.height);
        const scale = Math.min(size.width / 1280, size.height / 720);
        for (const item of this.layoutItems) {
            item.node.setPosition(item.x * scale, item.y * scale, 0);
            item.node.setScale(scale, scale, 1);
        }
        if (this.background) {
            const cover = Math.max(size.width / 1280, size.height / 720);
            this.background.setScale(cover, cover, 1);
        }
    }
}
