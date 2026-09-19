import { BlockInputEvents, Button, Label, Node, UITransform } from 'cc';
import { makeButton, makeLabel, makeRect, makeUiNode, uiColor } from './RuntimeUiFactory';

import { styleProjectUiLabel } from './ProjectUiFonts';

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

/** 一次创建，仅在打开、选择和比赛状态切换时更新。 */
export class CareerRaceDebugPanel {
    private root: Node;
    private panel: Node;
    private rankLabel: Label;
    private placement = 1;
    private count = 1;

    build(parent: Node, width: number, height: number, getCount: () => number, finish: (rank: number) => boolean) {
        this.root = makeUiNode('CareerRaceDebug', parent);
        const button = (name: string, owner: Node, text: string, w: number, x: number, y: number, action: () => void) => {
            const node = makeButton(name, owner, w, 42, uiColor(65, 81, 110, 245), text);
            node.setPosition(x, y, 0);
            styleProjectUiLabel(node.getChildByName('Label').getComponent(Label), 'semibold', 20);
            node.on(Button.EventType.CLICK, action);
        };
        button('Open', this.root, '调试结算', 120, width / 2 - 326, height / 2 - 42, () => {
            this.count = Math.max(1, getCount());
            this.setPlacement(Math.min(this.placement, this.count));
            this.panel.active = !this.panel.active;
        });
        this.panel = makeRect('RankPanel', this.root, 400, 220, uiColor(18, 30, 48, 245));
        this.panel.addComponent(BlockInputEvents);
        const title = makeLabel('Title', this.panel, '生涯调试：选择完赛名次', 22, uiColor(255, 225, 150));
        title.setPosition(0, 78, 0);
        styleProjectUiLabel(title.getComponent(Label), 'semibold', 22);
        const hint = makeLabel('Hint', this.panel, '将按所选名次保存生涯结算', 18, uiColor(210, 220, 235));
        hint.setPosition(0, 46, 0);
        styleProjectUiLabel(hint.getComponent(Label), 'regular', 18);
        this.rankLabel = makeLabel('Rank', this.panel, '', 24, uiColor(255, 255, 255)).getComponent(Label);
        this.rankLabel.overflow = Label.Overflow.SHRINK;
        this.rankLabel.node.getComponent(UITransform).setContentSize(190, 42);
        styleProjectUiLabel(this.rankLabel, 'semibold', 24);
        button('Previous', this.panel, '−', 64, -135, 0, () => this.setPlacement(Math.max(1, this.placement - 1)));
        button('Next', this.panel, '+', 64, 135, 0, () => this.setPlacement(Math.min(this.count, this.placement + 1)));
        button('Cancel', this.panel, '取消', 110, -100, -72, () => { this.panel.active = false; });
        button('Finish', this.panel, '立即结束比赛', 180, 70, -72, () => {
            if (finish(this.placement)) this.panel.active = false;
        });
        this.panel.active = false;
        this.root.active = false;
    }

    setAvailable(available: boolean) {
        if (!this.root) return;
        if (this.root.active !== available) this.root.active = available;
        if (!available && this.panel.active) this.panel.active = false;
    }

    private setPlacement(placement: number) {
        this.placement = placement;
        const text = `第 ${placement} 名 / 共 ${this.count} 人`;
        if (this.rankLabel.string !== text) this.rankLabel.string = text;
    }
}
