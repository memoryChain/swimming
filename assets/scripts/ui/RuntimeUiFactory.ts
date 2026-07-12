import { Button, Camera, Color, EventTouch, Graphics, Label, Layers, Node, UITransform, Vec3 } from 'cc';

export function uiColor(r: number, g: number, b: number, a = 255): Color {
    return new Color(r, g, b, a);
}

export function makeUiNode(name: string, parent: Node): Node {
    const node = new Node(name);
    node.setParent(parent);
    node.layer = Layers.Enum.UI_2D;
    node.addComponent(UITransform);
    return node;
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
// dependency and matches the project's Graphics-based UI. Pass the UI camera so
// the touch point is converted screen->world correctly even when the runtime
// viewport differs from the design resolution.
export function makeDragSlider(
    name: string,
    parent: Node,
    w: number,
    h: number,
    initialRatio: number,
    onChange: (ratio: number) => void,
    camera: Camera | null = null,
): DragSlider {
    const node = makeUiNode(name, parent);
    const uiTransform = node.getComponent(UITransform)!;
    uiTransform.setContentSize(w, h + 16);
    const track = node.addComponent(Graphics);
    const handleNode = makeUiNode('Handle', node);
    handleNode.getComponent(UITransform).setContentSize(14, h + 12);
    const handle = handleNode.addComponent(Graphics);

    const draw = (ratio: number) => {
        const r = Math.max(0, Math.min(1, ratio));
        track.clear();
        track.fillColor = uiColor(28, 48, 66, 235);
        track.rect(-w / 2, -h / 2, w, h);
        track.fill();
        track.fillColor = uiColor(72, 162, 222, 245);
        track.rect(-w / 2, -h / 2, w * r, h);
        track.fill();
        handle.clear();
        handle.fillColor = uiColor(248, 252, 255);
        handle.rect(-7, -(h + 12) / 2, 14, h + 12);
        handle.fill();
        handleNode.setPosition(-w / 2 + w * r, 0, 0);
    };
    draw(initialRatio);

    const worldPoint = new Vec3();
    const onTouch = (event: EventTouch) => {
        const loc = event.getLocation();
        if (camera) {
            camera.screenToWorld(new Vec3(loc.x, loc.y, 0), worldPoint);
        } else {
            const ui = event.getUILocation();
            worldPoint.set(ui.x, ui.y, 0);
        }
        const local = uiTransform.convertToNodeSpaceAR(worldPoint);
        const ratio = Math.max(0, Math.min(1, (local.x + w / 2) / w));
        draw(ratio);
        onChange(ratio);
    };
    node.on(Node.EventType.TOUCH_START, onTouch);
    node.on(Node.EventType.TOUCH_MOVE, onTouch);

    return { node, setRatio: draw };
}
