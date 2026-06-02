import { Node } from 'cc';
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
        makeRect('StartShade', screen, w, h, uiColor(4, 12, 22, 125));
        makeRect('TopAccent', screen, w, 12, uiColor(255, 224, 89)).setPosition(0, h / 2 - 6, 0);
        makeLabel('Kicker', screen, '100M FREESTYLE RHYTHM', 18, uiColor(128, 225, 235)).setPosition(0, 124, 0);
        makeLabel('Logo', screen, 'SPEED SWIMMING 3D', 62, uiColor(255, 255, 255)).setPosition(0, 70, 0);
        makeLabel('SubTitle', screen, 'Freestyle rhythm: left click kicks, right click pulls the arms.', 22, uiColor(224, 235, 235)).setPosition(0, 16, 0);

        const start = makeButton('StartButton', screen, 220, 52, uiColor(255, 224, 89), 'START RACE');
        start.setPosition(-124, -62, 0);
        start.on(Node.EventType.TOUCH_END, () => this._callbacks.onStart());

        const debug = makeButton('DebugButton', screen, 190, 52, uiColor(38, 116, 190), 'DEBUG');
        debug.setPosition(116, -62, 0);
        debug.on(Node.EventType.TOUCH_END, () => this._callbacks.onToggleDebug());

        const modelDebug = makeButton('ModelDebugButton', screen, 240, 48, uiColor(28, 148, 124), 'MODEL DEBUG');
        modelDebug.setPosition(0, -126, 0);
        modelDebug.on(Node.EventType.TOUCH_END, () => this._callbacks.onModelDebug());

        makeLabel('Controls', screen, 'Left mouse / A: kick    Right mouse / D: arm pull    C: camera    V: free view', 18, uiColor(220, 232, 235)).setPosition(0, -184, 0);
        return screen;
    }
}
