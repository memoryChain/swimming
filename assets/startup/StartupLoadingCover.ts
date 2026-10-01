import { BlockInputEvents, Camera, Canvas, Color, director, Graphics, Label, Node, tween, Tween, UITransform, view } from 'cc';
import { STARTUP_COPY } from './StartupCopy';
import { loadStartupFont } from './StartupView';

const LAYER = 1 << 13;

/** 保留登录画面，单独相机遮住正在初始化的大厅和头像栏；不依赖业务分包。 */
export class StartupLoadingCover {
    readonly node: Node;
    private readonly parent: Node | null;
    private readonly layer: number;
    private readonly spinner: Node;
    private readonly label: Label;
    private readonly progressRoot: Node;
    private readonly progressFill: Node;
    private progressPixels = -1;
    private animation: Tween<Node> | null = null;
    private retry: (() => void) | null = null;
    private disposed = false;
    private readonly resize = () => this.layout();

    constructor(private readonly login: Node | null, private readonly presentation: 'startup' | 'transparent' = 'startup') {
        this.parent = login?.parent ?? null;
        this.layer = login?.layer ?? 0;
        const root = this.node = new Node('StartupLoadingCover');
        root.layer = LAYER;
        root.setParent(director.getScene()!);
        root.addComponent(UITransform);
        const canvas = root.addComponent(Canvas);
        const cameraNode = new Node('Camera'); cameraNode.layer = LAYER; cameraNode.setParent(root);
        const camera = cameraNode.addComponent(Camera);
        camera.visibility = LAYER;
        camera.priority = 90;
        camera.projection = Camera.ProjectionType.ORTHO;
        camera.clearFlags = presentation === 'transparent' ? Camera.ClearFlag.DEPTH_ONLY : Camera.ClearFlag.SOLID_COLOR;
        camera.clearColor = new Color(8, 25, 42, 255);
        camera.orthoHeight = (view.getDesignResolutionSize().height || 720) / 2;
        canvas.cameraComponent = camera;
        if (login?.isValid) { login.setParent(root); this.setLayer(login, LAYER); }
        const blocker = new Node('InputBlocker'); blocker.layer = LAYER; blocker.setParent(root);
        blocker.addComponent(UITransform); blocker.addComponent(BlockInputEvents);
        blocker.on(Node.EventType.TOUCH_END, () => this.retry?.());
        const spinner = this.spinner = new Node('LoadingSpinner'); spinner.layer = LAYER; spinner.setParent(blocker);
        spinner.addComponent(UITransform).setContentSize(44, 44);
        const graphic = spinner.addComponent(Graphics);
        graphic.lineWidth = 4;
        graphic.strokeColor = new Color(150, 221, 255, 255);
        graphic.arc(0, 0, 18, 0, Math.PI * 1.5, false); graphic.stroke();
        const progressRoot = this.progressRoot = new Node('LoadingProgress');
        progressRoot.layer = LAYER; progressRoot.setParent(blocker);
        progressRoot.addComponent(UITransform).setContentSize(360, 8);
        const track = progressRoot.addComponent(Graphics);
        track.fillColor = new Color(29, 57, 77, 255); track.rect(-180, -4, 360, 8); track.fill();
        const fill = this.progressFill = new Node('LoadingProgressFill');
        fill.layer = LAYER; fill.setParent(progressRoot); fill.setPosition(-180, 0, 0);
        fill.addComponent(UITransform).setContentSize(360, 8);
        const fillGraphic = fill.addComponent(Graphics);
        fillGraphic.fillColor = new Color(150, 221, 255, 255); fillGraphic.rect(0, -4, 360, 8); fillGraphic.fill();
        const text = new Node('LoadingLabel'); text.layer = LAYER; text.setParent(blocker);
        text.addComponent(UITransform).setContentSize(480, 40);
        this.label = text.addComponent(Label);
        this.label.fontSize = 25; this.label.lineHeight = 32;
        this.label.horizontalAlign = Label.HorizontalAlign.CENTER;
        this.label.verticalAlign = Label.VerticalAlign.CENTER;
        this.label.color = new Color(226, 238, 250, 255);
        void loadStartupFont().then(font => {
            if (!this.disposed && this.label.isValid) { this.label.font = font; this.label.useSystemFont = false; }
        }).catch(() => { /* 字库也断网时保留可操作的重试提示。 */ });
        view.on('canvas-resize', this.resize);
        view.on('design-resolution-changed', this.resize);
        this.layout(); this.setLoading();
    }

    setLoading(message: string = STARTUP_COPY.loading): void {
        if (this.disposed) return;
        this.retry = null;
        this.progressPixels = -1;
        if (this.progressRoot.active) this.progressRoot.active = false;
        const showText = this.presentation !== 'transparent' || message !== STARTUP_COPY.loading;
        if (this.label.node.active !== showText) this.label.node.active = showText;
        if (this.label.string !== message) this.label.string = message;
        if (!this.spinner.active) this.spinner.active = true;
        if (!this.animation) this.animation = tween(this.spinner).by(1, { angle: -324 }).repeatForever().start();
    }

    setProgress(fraction: number, message: string = STARTUP_COPY.preparing): void {
        if (this.disposed || !Number.isFinite(fraction)) return;
        const percent = Math.max(0, Math.min(100, Math.floor(fraction * 100)));
        this.showProgress(percent / 100, `${message} ${percent}%`);
    }

    setResourceProgress(completed: number, total: number): void {
        if (this.disposed || !Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) return;
        // 数量是本页已发现的资源准备项，包含后续发现的依赖，不代表下载字节或总耗时。
        const count = Math.max(0, Math.min(total, completed));
        this.showProgress(count / total, `${STARTUP_COPY.loadingUi} ${count}/${total}`);
    }

    private showProgress(fraction: number, message: string): void {
        // 透明页面等待沿用居中转圈，不因资源计数或下载回调切换成启动进度条。
        if (this.presentation === 'transparent') return;
        this.retry = null;
        this.animation?.stop(); this.animation = null;
        if (this.spinner.active) this.spinner.active = false;
        if (!this.progressRoot.active) this.progressRoot.active = true;
        if (!this.label.node.active) this.label.node.active = true;
        const pixels = Math.round(fraction * 360);
        if (pixels !== this.progressPixels) {
            this.progressPixels = pixels;
            this.progressFill.setScale(pixels / 360, 1, 1);
        }
        if (this.label.string !== message) this.label.string = message;
    }

    setRetry(retry: () => void): void {
        if (this.disposed) return;
        this.retry = retry;
        this.animation?.stop(); this.animation = null;
        this.spinner.active = false;
        this.progressRoot.active = false;
        this.label.node.active = true;
        this.label.string = STARTUP_COPY.retry;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true; this.retry = null;
        this.animation?.stop(); this.animation = null;
        view.off('canvas-resize', this.resize); view.off('design-resolution-changed', this.resize);
        if (this.login?.isValid && this.parent?.isValid) {
            this.login.setParent(this.parent); this.setLayer(this.login, this.layer);
        }
        if (this.node.isValid) this.node.destroy();
    }

    private layout(): void {
        if (!this.node.isValid) return;
        const size = view.getVisibleSize();
        this.node.getComponent(UITransform)!.setContentSize(size.width, size.height);
        this.spinner.parent!.getComponent(UITransform)!.setContentSize(size.width, size.height);
        const scale = Math.min(size.width / 1280, size.height / 720);
        this.progressRoot.setPosition(0, -261 * scale, 0); this.progressRoot.setScale(scale, scale, 1);
        this.spinner.setPosition(0, this.presentation === 'transparent' ? 0 : -261 * scale, 0); this.spinner.setScale(scale, scale, 1);
        this.label.node.setPosition(0, (this.presentation === 'transparent' ? -52 : -302) * scale, 0); this.label.node.setScale(scale, scale, 1);
    }

    private setLayer(node: Node, layer: number): void {
        node.layer = layer;
        for (const child of node.children) this.setLayer(child, layer);
    }
}
