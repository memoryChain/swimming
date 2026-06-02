import { Label, Node } from 'cc';
import { makeButton, makeLabel, makeRect, makeUiNode, uiColor } from './RuntimeUiFactory';

export type ModelDebugHudCallbacks = {
    onExit: () => void;
    onSlow: () => void;
    onFast: () => void;
};

export type ModelDebugHudRefs = {
    root: Node;
    speedLabel: Label;
};

export class ModelDebugHudBuilder {
    constructor(private readonly _callbacks: ModelDebugHudCallbacks) {}

    build(parent: Node, w: number, h: number): ModelDebugHudRefs {
        const hud = makeUiNode('ModelDebugHUD', parent);
        makeRect('ModelDebugTop', hud, w, 76, uiColor(5, 16, 26, 190)).setPosition(0, h / 2 - 38, 0);
        makeLabel('ModelDebugTitle', hud, 'MODEL ACTION DEBUG', 24, uiColor(255, 255, 255)).setPosition(-w / 2 + 190, h / 2 - 38, 0);
        makeLabel('ModelDebugHint', hud, 'A: legs    D: arms    Q/E: speed    Drag: orbit    Wheel: zoom', 18, uiColor(150, 235, 255)).setPosition(0, h / 2 - 38, 0);
        const exit = makeButton('ModelDebugExit', hud, 130, 42, uiColor(232, 68, 72), 'EXIT');
        exit.setPosition(w / 2 - 86, h / 2 - 38, 0);
        exit.on(Node.EventType.TOUCH_END, () => this._callbacks.onExit());
        makeRect('ModelDebugBottom', hud, w, 54, uiColor(5, 16, 26, 120)).setPosition(0, -h / 2 + 27, 0);
        const slower = makeButton('ModelDebugSlow', hud, 54, 36, uiColor(38, 116, 190), '-');
        slower.setPosition(-88, -h / 2 + 27, 0);
        slower.on(Node.EventType.TOUCH_END, () => this._callbacks.onSlow());
        const faster = makeButton('ModelDebugFast', hud, 54, 36, uiColor(38, 116, 190), '+');
        faster.setPosition(88, -h / 2 + 27, 0);
        faster.on(Node.EventType.TOUCH_END, () => this._callbacks.onFast());
        const speedLabel = makeLabel('ModelDebugStatus', hud, 'Speed 0.35x', 18, uiColor(230, 244, 250));
        speedLabel.setPosition(0, -h / 2 + 27, 0);
        return {
            root: hud,
            speedLabel: speedLabel.getComponent(Label),
        };
    }
}
