import { Button, Color, Graphics, Label, Layers, Node, UITransform } from 'cc';

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
