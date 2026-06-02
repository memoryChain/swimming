import { Label, Node, UITransform } from 'cc';
import { makeLabel, makeRect, makeUiNode, uiColor } from './RuntimeUiFactory';

export type DebugPanelRefs = {
    root: Node;
    logLabel: Label;
};

export class DebugPanelBuilder {
    build(parent: Node, w: number, h: number): DebugPanelRefs {
        const panel = makeUiNode('DebugPanel', parent);
        panel.setPosition(-w / 2 + 210, -h / 2 + 144, 0);
        makeRect('DebugBack', panel, 390, 210, uiColor(0, 0, 0, 205));
        makeLabel('DebugTitle', panel, 'DEBUG', 18, uiColor(255, 224, 89)).setPosition(-150, 80, 0);
        const label = makeLabel('DebugLog', panel, '', 14, uiColor(150, 235, 255));
        label.getComponent(UITransform).setContentSize(350, 150);
        label.setPosition(0, -10, 0);
        return {
            root: panel,
            logLabel: label.getComponent(Label),
        };
    }
}
