import { Color, Label, Node, UITransform } from 'cc';
import { EDITOR } from 'cc/env';
import { makeButton, makeLabel, makeRect, makeUiNode, uiColor } from './RuntimeUiFactory';

export type StartScreenCallbacks = {
    onStart: () => void;
    onToggleDebug: () => void;
    onModelDebug: () => void;
};

export class StartScreenBuilder {
    constructor(private readonly _callbacks: StartScreenCallbacks) {}

    build(parent: Node, w: number, h: number): Node {
        const screen = makeUiNode('StartScreen', parent);
        const safeW = Math.min(620, Math.max(300, w - 40));
        const isPortrait = h > w;
        const contentY = isPortrait ? Math.min(128, h * 0.12) : 124;
        const titleSize = isPortrait ? Math.min(40, Math.max(32, Math.floor(safeW / 10.8))) : 62;
        const subtitleSize = isPortrait ? 16 : 22;
        const buttonW = Math.min(250, safeW - 56);
        const controlsY = EDITOR ? -246 : (isPortrait ? -156 : -142);
        const coverW = w * 1.35;
        const coverH = h * 1.2;
        makeRect('StartShade', screen, coverW, coverH, uiColor(4, 12, 22, 125));
        makeRect('TopAccent', screen, coverW, 12, uiColor(255, 224, 89)).setPosition(0, h / 2 - 6, 0);
        makeFittedLabel('Kicker', screen, '100M FREESTYLE RHYTHM', isPortrait ? 14 : 18, safeW, 30, uiColor(128, 225, 235)).setPosition(0, contentY, 0);
        makeFittedLabel('Logo', screen, 'SPEED SWIMMING 3D', titleSize, safeW, titleSize + 14, uiColor(255, 255, 255)).setPosition(0, contentY - (isPortrait ? 44 : 54), 0);
        makeFittedLabel('SubTitle', screen, '交替控制左右划水，掌握长按节奏。', subtitleSize, safeW, subtitleSize + 18, uiColor(224, 235, 235)).setPosition(0, contentY - (isPortrait ? 88 : 108), 0);

        const start = makeButton('StartButton', screen, buttonW, 52, uiColor(255, 224, 89), 'START RACE');
        start.setPosition(0, EDITOR ? -58 : (isPortrait ? -52 : -68), 0);
        start.on(Node.EventType.TOUCH_END, () => this._callbacks.onStart());

        if (EDITOR) {
            const debug = makeButton('DebugButton', screen, buttonW, 52, uiColor(38, 116, 190), 'DEBUG');
            debug.setPosition(0, -120, 0);
            debug.on(Node.EventType.TOUCH_END, () => this._callbacks.onToggleDebug());

            const modelDebug = makeButton('ModelDebugButton', screen, buttonW, 52, uiColor(28, 148, 124), 'MODEL DEBUG');
            modelDebug.setPosition(0, -182, 0);
            modelDebug.on(Node.EventType.TOUCH_END, () => this._callbacks.onModelDebug());
        }

        makeFittedLabel('Controls', screen, controlText(isPortrait), isPortrait ? 14 : 18, safeW, isPortrait ? 52 : 32, uiColor(220, 232, 235)).setPosition(0, controlsY, 0);
        return screen;
    }
}

function makeFittedLabel(name: string, parent: Node, text: string, fontSize: number, width: number, height: number, fill: Color) {
    const node = makeLabel(name, parent, text, fontSize, fill);
    node.getComponent(UITransform).setContentSize(width, height);
    const label = node.getComponent(Label);
    label.overflow = Label.Overflow.SHRINK;
    label.lineHeight = Math.round(fontSize * 1.35);
    return node;
}

function controlText(isPortrait: boolean): string {
    if (isPortrait) {
        return '点击/长按屏幕：自动交替划水\n掌握松手节奏获得更高稳定性';
    }
    return '点击/长按屏幕：自动交替划水    C: camera';
}
