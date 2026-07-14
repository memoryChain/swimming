import { _decorator, Camera, Canvas, Color, Component, director, Graphics, Label, Layers, Node, UITransform, Vec3, view } from 'cc';

const { ccclass } = _decorator;

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
// Full turns per second for the spinner ring.
const SPINNER_TURNS_PER_SECOND = 0.9;

// Cycles a trailing ellipsis and spins the loading ring so the loading screen
// visibly animates and never looks frozen while assets stream in.
@ccclass('LoadingDotsAnimator')
class LoadingDotsAnimator extends Component {
    label: Label = null;
    spinner: Node = null;
    baseText = '加载中';
    private _elapsed = 0;
    private _dots = -1;
    private _spin = 0;
    private readonly _spinEuler = new Vec3();

    update(dt: number) {
        this._elapsed += dt;
        if (this.label?.isValid) {
            const dots = Math.floor(this._elapsed / 0.35) % 4;
            if (dots !== this._dots) {
                this._dots = dots;
                this.label.string = this.baseText + '.'.repeat(dots);
            }
        }
        if (this.spinner?.isValid) {
            this._spin = (this._spin - dt * SPINNER_TURNS_PER_SECOND * 360) % 360;
            this._spinEuler.set(0, 0, this._spin);
            this.spinner.setRotationFromEuler(this._spinEuler);
        }
    }
}

// Draws a circular track plus a bright leading arc; rotating the whole node
// gives the classic "spinner" look without needing any texture asset.
function drawSpinnerRing(gfx: Graphics, radius: number): void {
    gfx.clear();
    gfx.lineWidth = 6;
    gfx.lineCap = Graphics.LineCap.ROUND;
    gfx.strokeColor = new Color(70, 96, 122, 180);
    gfx.circle(0, 0, radius);
    gfx.stroke();
    gfx.strokeColor = new Color(120, 196, 255, 255);
    // Leading arc spanning ~270 degrees (from -30deg counter-clockwise).
    gfx.arc(0, 0, radius, -Math.PI / 6, Math.PI * 1.3, true);
    gfx.stroke();
}


export class LoadingOverlay {
    private static _node: Node | null = null;

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
        root.addComponent(UITransform);
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

        const spinnerNode = new Node('LoadingSpinner');
        spinnerNode.setParent(root);
        spinnerNode.layer = LOADING_OVERLAY_LAYER;
        spinnerNode.setPosition(0, 36, 0);
        const spinnerRadius = 26;
        spinnerNode.addComponent(UITransform).setContentSize(spinnerRadius * 2 + 12, spinnerRadius * 2 + 12);
        drawSpinnerRing(spinnerNode.addComponent(Graphics), spinnerRadius);

        const animator = root.addComponent(LoadingDotsAnimator);
        animator.label = label;
        animator.spinner = spinnerNode;
        animator.baseText = message;

        director.addPersistRootNode(root);
        this._node = root;
    }

    // Remove the overlay once the race scene is ready. Safe to call when nothing
    // is showing.
    static hide(): void {
        const node = this._node;
        this._node = null;
        if (!node?.isValid) {
            return;
        }
        director.removePersistRootNode(node);
        node.destroy();
    }
}
