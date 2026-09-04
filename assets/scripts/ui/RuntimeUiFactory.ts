import { Button, Camera, Canvas, Color, EventTouch, Graphics, Label, Layers, Node, UITransform, Vec3, view } from 'cc';

export const UI_DESIGN_WIDTH = 1280;
export const UI_DESIGN_HEIGHT = 720;

export function uiColor(r: number, g: number, b: number, a = 255): Color {
    return new Color(r, g, b, a);
}

export function makeUiNode(name: string, parent: Node): Node {
    const node = new Node(name);
    node.setParent(parent);
    // Inherit the parent's Cocos layer so UI built under a dedicated layer (e.g.
    // the popup overlay) lands on that layer automatically; normal UI stays UI_2D.
    node.layer = parent?.layer ?? Layers.Enum.UI_2D;
    node.addComponent(UITransform);
    return node;
}

// Full-screen UI is authored on a fixed 1280x720 landscape canvas. Cocos uses
// fitHeight for this project, so extra-wide phones expose more horizontal design
// space than 1280. Background art and solid backdrops therefore need CSS-like
// `cover`: preserve the authored aspect ratio, fill the visible area, and crop
// only the overflow. Foreground controls keep their original design coordinates.
export function fitFullScreenBackgroundCover(
    node: Node,
    authoredWidth = UI_DESIGN_WIDTH,
    authoredHeight = UI_DESIGN_HEIGHT,
): void {
    const transform = node.getComponent(UITransform);
    if (!transform || authoredWidth <= 0 || authoredHeight <= 0) {
        return;
    }
    if (transform.contentSize.width !== authoredWidth || transform.contentSize.height !== authoredHeight) {
        transform.setContentSize(authoredWidth, authoredHeight);
    }
    const visibleSize = view.getVisibleSize();
    const coverScale = Math.max(
        visibleSize.width / authoredWidth,
        visibleSize.height / authoredHeight,
    );
    if (node.position.x !== 0 || node.position.y !== 0) {
        node.setPosition(0, 0, node.position.z);
    }
    if (node.scale.x !== coverScale || node.scale.y !== coverScale) {
        node.setScale(coverScale, coverScale, node.scale.z);
    }
}

export function fitNodeToVisibleScreen(node: Node): void {
    const visibleSize = view.getVisibleSize();
    const transform = node.getComponent(UITransform);
    if (node.position.x !== 0 || node.position.y !== 0) {
        node.setPosition(0, 0, node.position.z);
    }
    if (transform
        && (transform.contentSize.width !== visibleSize.width || transform.contentSize.height !== visibleSize.height)) {
        transform.setContentSize(visibleSize.width, visibleSize.height);
    }
}

export function makeRect(name: string, parent: Node, w: number, h: number, fill: Color): Node {
    const node = makeUiNode(name, parent);
    node.getComponent(UITransform).setContentSize(w, h);
    const gfx = node.addComponent(Graphics);
    gfx.fillColor = fill;
    gfx.rect(-w / 2, -h / 2, w, h);
    gfx.fill();
    return node;
}

export function makeLeftRect(name: string, parent: Node, w: number, h: number, fill: Color): Node {
    const node = makeUiNode(name, parent);
    node.getComponent(UITransform).setContentSize(w, h);
    const gfx = node.addComponent(Graphics);
    drawLeftFill(gfx, w, h, 1, fill);
    return node;
}

export function makeBottomRect(name: string, parent: Node, w: number, h: number, fill: Color): Node {
    const node = makeUiNode(name, parent);
    node.getComponent(UITransform).setContentSize(w, h);
    const gfx = node.addComponent(Graphics);
    drawBottomFill(gfx, w, h, 1, fill);
    return node;
}

export function makeTouchArea(name: string, parent: Node, w: number, h: number): Node {
    const node = makeUiNode(name, parent);
    node.getComponent(UITransform).setContentSize(w, h);
    const button = node.addComponent(Button);
    button.target = node;
    button.interactable = true;
    button.transition = Button.Transition.NONE;
    return node;
}

export function makeLabel(name: string, parent: Node, text: string, fontSize: number, fill: Color): Node {
    const node = makeUiNode(name, parent);
    node.getComponent(UITransform).setContentSize(620, fontSize + 14);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.color = fill;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    return node;
}

export function makeButton(name: string, parent: Node, w: number, h: number, fill: Color, text: string): Node {
    const node = makeRect(name, parent, w, h, fill);
    const button = node.addComponent(Button);
    // Make the node's full UITransform the authoritative Cocos Button hit box.
    // Text is presentation only; it must never define the clickable region.
    button.target = node;
    button.interactable = true;
    button.transition = Button.Transition.NONE;
    if (text) {
        const labelNode = makeLabel('Label', node, text, 18, uiColor(255, 255, 255, 235));
        labelNode.getComponent(UITransform).setContentSize(w, h);
    }
    return node;
}

export function makeRoundedRect(
    name: string,
    parent: Node,
    w: number,
    h: number,
    fill: Color,
    radius = 10,
    stroke: Color | null = null,
    strokeWidth = 1.5,
): Node {
    const node = makeUiNode(name, parent);
    node.getComponent(UITransform).setContentSize(w, h);
    const gfx = node.addComponent(Graphics);
    gfx.fillColor = fill;
    gfx.roundRect(-w / 2, -h / 2, w, h, radius);
    gfx.fill();
    if (stroke) {
        gfx.strokeColor = stroke;
        gfx.lineWidth = strokeWidth;
        gfx.roundRect(
            -w / 2 + strokeWidth / 2,
            -h / 2 + strokeWidth / 2,
            w - strokeWidth,
            h - strokeWidth,
            Math.max(0, radius - strokeWidth / 2),
        );
        gfx.stroke();
    }
    return node;
}

export function makeOutlineButton(
    name: string,
    parent: Node,
    w: number,
    h: number,
    fill: Color,
    text: string,
    stroke: Color,
    radius = 12,
): Node {
    const node = makeRoundedRect(name, parent, w, h, fill, radius, stroke, 2);
    const button = node.addComponent(Button);
    button.target = node;
    button.interactable = true;
    button.transition = Button.Transition.NONE;
    if (text) {
        const labelNode = makeLabel('Label', node, text, 18, uiColor(255, 255, 255, 235));
        labelNode.getComponent(UITransform).setContentSize(w, h);
    }
    return node;
}
export function drawLeftFill(gfx: Graphics, w: number, h: number, ratio: number, fill: Color) {
    if (!gfx) {
        return;
    }
    gfx.clear();
    gfx.fillColor = fill;
    gfx.rect(0, -h / 2, w * ratio, h);
    gfx.fill();
}

export function drawBottomFill(gfx: Graphics, w: number, h: number, ratio: number, fill: Color) {
    if (!gfx) {
        return;
    }
    const clamped = Math.max(0, Math.min(1, ratio));
    gfx.clear();
    gfx.fillColor = fill;
    gfx.rect(-w / 2, -h / 2, w, h * clamped);
    gfx.fill();
}

export type DragSlider = {
    node: Node;
    // Redraw the slider to a 0..1 ratio without firing onChange (for external sync).
    setRatio: (ratio: number) => void;
};

// A self-drawn horizontal drag slider (Graphics track + fill + handle) that
// reports a 0..1 ratio on touch/drag. Avoids the Slider component's SpriteFrame
// dependency and matches the project's Graphics-based UI. Touch points are
// converted with the camera that renders the slider (walked up to its Canvas),
// so it works on any canvas including the popup overlay without a caller-supplied
// camera.
export function makeDragSlider(
    name: string,
    parent: Node,
    w: number,
    h: number,
    initialRatio: number,
    onChange: (ratio: number) => void,
): DragSlider {
    const node = makeUiNode(name, parent);
    const uiTransform = node.getComponent(UITransform)!;
    uiTransform.setContentSize(w, Math.max(48, h + 24));

    const trackNode = makeUiNode('Track', node);
    trackNode.getComponent(UITransform)!.setContentSize(w, h);
    const track = trackNode.addComponent(Graphics);
    track.fillColor = uiColor(213, 224, 242, 255);
    track.roundRect(-w / 2, -h / 2, w, h, h / 2);
    track.fill();

    const fillNode = makeUiNode('Fill', node);
    fillNode.getComponent(UITransform)!.setContentSize(w, h);
    const fill = fillNode.addComponent(Graphics);

    const handleNode = makeUiNode('Handle', node);
    handleNode.getComponent(UITransform)!.setContentSize(36, 36);
    const handle = handleNode.addComponent(Graphics);
    handle.fillColor = uiColor(255, 255, 255, 255);
    handle.circle(0, 0, 17);
    handle.fill();
    handle.strokeColor = uiColor(80, 113, 215, 255);
    handle.lineWidth = 3;
    handle.circle(0, 0, 15.5);
    handle.stroke();
    handle.fillColor = uiColor(40, 210, 232, 255);
    handle.circle(0, 0, 8);
    handle.fill();

    let lastPixelWidth = -1;

    const draw = (ratio: number) => {
        const r = Math.max(0, Math.min(1, ratio));
        const pixelWidth = Math.round(w * r);
        if (pixelWidth === lastPixelWidth) return false;
        lastPixelWidth = pixelWidth;
        fill.clear();
        if (pixelWidth > 0) {
            fill.fillColor = uiColor(69, 116, 226, 255);
            fill.roundRect(-w / 2, -h / 2, Math.max(h, pixelWidth), h, h / 2);
            fill.fill();
        }
        handleNode.setPosition(-w / 2 + pixelWidth, 0, 1);
        return true;
    };
    draw(initialRatio);

    const worldPoint = new Vec3();
    const screenPoint = new Vec3();
    let camera: Camera | null = null;
    const onTouch = (event: EventTouch) => {
        if (!camera) {
            let owner: Node | null = node;
            while (owner) {
                const canvas = owner.getComponent(Canvas);
                if (canvas?.cameraComponent) {
                    camera = canvas.cameraComponent;
                    break;
                }
                owner = owner.parent;
            }
        }
        if (!camera) {
            return;
        }
        const loc = event.getLocation();
        screenPoint.set(loc.x, loc.y, 0);
        camera.screenToWorld(screenPoint, worldPoint);
        const local = uiTransform.convertToNodeSpaceAR(worldPoint);
        const ratio = Math.max(0, Math.min(1, (local.x + w / 2) / w));
        if (draw(ratio)) {
            onChange(ratio);
        }
    };
    node.on(Node.EventType.TOUCH_START, onTouch);
    node.on(Node.EventType.TOUCH_MOVE, onTouch);

    return { node, setRatio: draw };
}
