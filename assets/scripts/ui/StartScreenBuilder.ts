import { Node } from 'cc';
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
        const coverW = w * 1.35;
        const coverH = h * 1.2;
        makeRect('StartShade', screen, coverW, coverH, uiColor(4, 12, 22, 125));
        makeRect('TopAccent', screen, coverW, 12, uiColor(255, 224, 89)).setPosition(0, h / 2 - 6, 0);
        makeLabel('Kicker', screen, '100M FREESTYLE RHYTHM', 18, uiColor(128, 225, 235)).setPosition(0, 124, 0);
        makeLabel('Logo', screen, 'SPEED SWIMMING 3D', 62, uiColor(255, 255, 255)).setPosition(0, 70, 0);
        makeLabel('SubTitle', screen, 'Freestyle rhythm: alternate diagonal hand and foot strokes.', 22, uiColor(224, 235, 235)).setPosition(0, 16, 0);

        const start = makeButton('StartButton', screen, 250, 52, uiColor(255, 224, 89), 'START RACE');
        start.setPosition(0, EDITOR ? -58 : -68, 0);
        start.on(Node.EventType.TOUCH_END, () => this._callbacks.onStart());

        if (EDITOR) {
            const debug = makeButton('DebugButton', screen, 250, 52, uiColor(38, 116, 190), 'DEBUG');
            debug.setPosition(0, -120, 0);
            debug.on(Node.EventType.TOUCH_END, () => this._callbacks.onToggleDebug());

            const modelDebug = makeButton('ModelDebugButton', screen, 250, 52, uiColor(28, 148, 124), 'MODEL DEBUG');
            modelDebug.setPosition(0, -182, 0);
            modelDebug.on(Node.EventType.TOUCH_END, () => this._callbacks.onModelDebug());
        }

        makeLabel('Controls', screen, 'A / left side: left hand + right foot    D / right side: right hand + left foot    C: camera    V: free view', 18, uiColor(220, 232, 235)).setPosition(0, EDITOR ? -246 : -142, 0);
        return screen;
    }
}
