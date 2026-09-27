import { BlockInputEvents, Camera, Canvas, Color, director, Graphics, Label, Node, UITransform, view } from 'cc';
import { styleProjectUiLabel } from './ProjectUiFonts';

// Full-screen loading cover that persists across the Login -> MainGame scene
// switch. Without it the new scene shows its world camera's solid blue clear
// color while the pool GLB, swimmer models, tuning and sampled actions load
// asynchronously. The overlay is created on the Login scene before the switch
// and removed by GameManager once the race scene is fully built, so the blue
// gap is never visible.

// Dedicated user layer so the overlay camera only renders the loading label and
// nothing else (and no other camera renders the loading label). Cocos reserves
// bits 20+, and the project already uses bits 8-12, so bit 13 is free.
const LOADING_OVERLAY_LAYER = 1 << 13;
const OVERLAY_NODE_NAME = 'RaceLoadingOverlay';
// Rendered after the world (priority 0) and MainGame UI (priority 10) cameras so
// its SOLID_COLOR clear wipes them and draws the loading label on top.
const OVERLAY_CAMERA_PRIORITY = 100;
export class LoadingOverlay {
    private static _node: Node | null = null;
    private static _fill: Node | null = null;
    private static _label: Label | null = null;
    private static _percent = -1;
    private static _message = '加载中';

    // Create and show the overlay as a persistent root node. Safe to call more
    // than once; subsequent calls are ignored while an overlay is already up.
    static show(message = '加载中'): void {
        if (this._node?.isValid) {
            return;
        }
        const design = view.getDesignResolutionSize();
        const height = design.height || 720;

        const root = new Node(OVERLAY_NODE_NAME);
        root.layer = LOADING_OVERLAY_LAYER;
        const visible = view.getVisibleSize();
        root.addComponent(UITransform).setContentSize(visible.width, visible.height);
        root.addComponent(BlockInputEvents);
        const canvas = root.addComponent(Canvas);

        const cameraNode = new Node('Camera');
        cameraNode.setParent(root);
        cameraNode.layer = LOADING_OVERLAY_LAYER;
        const camera = cameraNode.addComponent(Camera);
        camera.visibility = LOADING_OVERLAY_LAYER;
        camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        camera.clearColor = new Color(8, 25, 42, 255);
        camera.priority = OVERLAY_CAMERA_PRIORITY;
        camera.orthoHeight = height / 2;
        canvas.cameraComponent = camera;

        const labelNode = new Node('LoadingLabel');
        labelNode.setParent(root);
        labelNode.layer = LOADING_OVERLAY_LAYER;
        labelNode.setPosition(0, -46, 0);
        labelNode.addComponent(UITransform).setContentSize(620, 80);
        const label = labelNode.addComponent(Label);
        label.string = message;
        label.fontSize = 34;
        label.lineHeight = 40;
        label.color = new Color(226, 238, 250, 255);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        styleProjectUiLabel(label, 'semibold', 40);

        const track = new Node('LoadingProgress');
        track.setParent(root); track.layer = LOADING_OVERLAY_LAYER;
        track.addComponent(UITransform).setContentSize(360, 12);
        const trackGraphics = track.addComponent(Graphics);
        trackGraphics.fillColor = new Color(70, 96, 122, 255);
        trackGraphics.rect(-180, 0, 360, 12); trackGraphics.fill();
        const fill = new Node('LoadingProgressFill');
        fill.setParent(track); fill.layer = LOADING_OVERLAY_LAYER; fill.setPosition(-180, 0, 0);
        fill.addComponent(UITransform).setContentSize(360, 12);
        const fillGraphics = fill.addComponent(Graphics);
        fillGraphics.fillColor = new Color(120, 196, 255, 255);
        fillGraphics.rect(0, 0, 360, 12); fillGraphics.fill();
        this._fill = fill; this._label = label; this._percent = -1; this._message = message;

        director.addPersistRootNode(root);
        this._node = root;
        this.setProgress(0);
    }

    static setProgress(fraction: number): void {
        if (!this._node?.isValid || !Number.isFinite(fraction)) return;
        const percent = Math.max(this._percent, Math.min(100, Math.floor(fraction * 100)));
        if (percent === this._percent) return;
        this._percent = percent;
        this._fill?.setScale(percent / 100, 1, 1);
        if (this._label?.isValid) this._label.string = `${this._message} ${percent}%`;
    }

    // Remove the overlay once the race scene is ready. Safe to call when nothing
    // is showing.
    static hide(): void {
        const node = this._node;
        this._node = null;
        this._fill = null; this._label = null; this._percent = -1;
        if (!node?.isValid) {
            return;
        }
        director.removePersistRootNode(node);
        node.destroy();
    }
}
