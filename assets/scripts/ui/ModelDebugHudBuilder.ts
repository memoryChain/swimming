import { Label, Node, UITransform } from 'cc';
import { MOTION_TUNING } from '../core/InputTuning';
import { resetTuningToDefaults, saveCurrentTuning, TUNING_GROUPS } from '../core/TuningDebugControls';
import { makeButton, makeLabel, makeRect, makeUiNode, uiColor } from './RuntimeUiFactory';

export type ModelDebugHudCallbacks = {
    onExit: () => void;
    onSlow: () => void;
    onFast: () => void;
};

export type ModelDebugHudRefs = {
    root: Node;
    speedLabel: Label;
    ratingLabel: Label;
    swimSpeedLabel: Label;
};

export class ModelDebugHudBuilder {
    private _groupIndex = 0;
    private _groupLabel: Label | null = null;
    private _statusLabel: Label | null = null;
    private readonly _tuningRows: {
        root: Node;
        name: Label;
        description: Label;
        value: Label;
    }[] = [];

    constructor(private readonly _callbacks: ModelDebugHudCallbacks) {}

    build(parent: Node, w: number, h: number): ModelDebugHudRefs {
        const hud = makeUiNode('ModelDebugHUD', parent);
        makeRect('ModelDebugTop', hud, w, 76, uiColor(5, 16, 26, 190)).setPosition(0, h / 2 - 38, 0);
        makeLabel('ModelDebugTitle', hud, 'MODEL ACTION DEBUG', 24, uiColor(255, 255, 255)).setPosition(-w / 2 + 190, h / 2 - 38, 0);
        makeLabel('ModelDebugHint', hud, 'A: left hand/right foot    D: right hand/left foot    Q/E: speed    Drag: orbit    Wheel: zoom', 16, uiColor(150, 235, 255)).setPosition(0, h / 2 - 38, 0);
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
        const speedLabel = makeLabel('ModelDebugStatus', hud, `Speed ${MOTION_TUNING.animationSpeedScale.toFixed(2)}x`, 18, uiColor(230, 244, 250));
        speedLabel.setPosition(0, -h / 2 + 27, 0);
        const ratingLabel = makeLabel('ModelDebugRating', hud, 'READY', 20, uiColor(230, 244, 250));
        ratingLabel.getComponent(UITransform).setContentSize(280, 32);
        ratingLabel.setPosition(0, h / 2 - 104, 0);
        const swimSpeedLabel = makeLabel('ModelDebugSwimSpeed', hud, '0.00 m/s', 18, uiColor(150, 235, 255));
        swimSpeedLabel.getComponent(UITransform).setContentSize(520, 30);
        swimSpeedLabel.setPosition(0, h / 2 - 134, 0);
        this.buildTuningPanel(hud, w, h);
        return {
            root: hud,
            speedLabel: speedLabel.getComponent(Label),
            ratingLabel: ratingLabel.getComponent(Label),
            swimSpeedLabel: swimSpeedLabel.getComponent(Label),
        };
    }

    private buildTuningPanel(parent: Node, w: number, h: number) {
        this._tuningRows.length = 0;
        const panelWidth = Math.min(460, Math.max(410, w * 0.34));
        const panelHeight = Math.min(548, h - 116);
        const panelX = -w / 2 + panelWidth / 2 + 18;
        const panelY = -6;
        const panel = makeUiNode('ModelDebugTuningPanel', parent);
        panel.setPosition(panelX, panelY, 0);
        makeRect('Back', panel, panelWidth, panelHeight, uiColor(6, 18, 28, 205));

        const previous = makeButton('TunePrev', panel, 38, 30, uiColor(34, 96, 146), '<');
        previous.setPosition(-panelWidth / 2 + 34, panelHeight / 2 - 28, 0);
        previous.on(Node.EventType.TOUCH_END, () => this.changeGroup(-1));

        const next = makeButton('TuneNext', panel, 38, 30, uiColor(34, 96, 146), '>');
        next.setPosition(panelWidth / 2 - 34, panelHeight / 2 - 28, 0);
        next.on(Node.EventType.TOUCH_END, () => this.changeGroup(1));

        const groupLabelNode = makeLabel('TuneGroup', panel, '', 18, uiColor(235, 248, 255));
        groupLabelNode.getComponent(UITransform).setContentSize(panelWidth - 100, 32);
        groupLabelNode.setPosition(0, panelHeight / 2 - 28, 0);
        this._groupLabel = groupLabelNode.getComponent(Label);

        const rowCount = 11;
        const rowHeight = 37;
        const firstY = panelHeight / 2 - 82;
        const controlValueX = panelWidth / 2 - 76;
        const controlMinusX = panelWidth / 2 - 122;
        const controlPlusX = panelWidth / 2 - 30;
        const textLeft = -panelWidth / 2 + 16;
        const textRight = controlMinusX - 24;
        const textWidth = Math.max(150, textRight - textLeft);
        const textX = textLeft + textWidth / 2;
        for (let i = 0; i < rowCount; i++) {
            const row = makeUiNode(`TuneRow${i}`, panel);
            row.setPosition(0, firstY - i * rowHeight, 0);
            makeRect('RowBack', row, panelWidth - 22, 34, i % 2 === 0 ? uiColor(12, 34, 48, 130) : uiColor(10, 28, 42, 90));

            const nameNode = makeLabel('Name', row, '', 14, uiColor(185, 225, 238));
            nameNode.getComponent(UITransform).setContentSize(textWidth, 16);
            nameNode.setPosition(textX, 8, 0);
            const nameLabel = nameNode.getComponent(Label);
            nameLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
            nameLabel.overflow = Label.Overflow.CLAMP;

            const descriptionNode = makeLabel('Description', row, '', 11, uiColor(124, 178, 196));
            descriptionNode.getComponent(UITransform).setContentSize(textWidth, 22);
            descriptionNode.setPosition(textX, -8, 0);
            const descriptionLabel = descriptionNode.getComponent(Label);
            descriptionLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
            descriptionLabel.verticalAlign = Label.VerticalAlign.TOP;
            descriptionLabel.fontSize = 9;
            descriptionLabel.enableWrapText = true;
            descriptionLabel.overflow = Label.Overflow.CLAMP;

            const minus = makeButton('Minus', row, 30, 28, uiColor(36, 106, 160), '-');
            minus.setPosition(controlMinusX, 0, 0);
            minus.on(Node.EventType.TOUCH_END, () => this.adjustControl(i, -1));

            const valueNode = makeLabel('Value', row, '', 14, uiColor(255, 255, 255));
            valueNode.getComponent(UITransform).setContentSize(72, 28);
            valueNode.setPosition(controlValueX, 0, 0);

            const plus = makeButton('Plus', row, 30, 28, uiColor(36, 106, 160), '+');
            plus.setPosition(controlPlusX, 0, 0);
            plus.on(Node.EventType.TOUCH_END, () => this.adjustControl(i, 1));

            this._tuningRows.push({
                root: row,
                name: nameLabel,
                description: descriptionLabel,
                value: valueNode.getComponent(Label),
            });
        }

        this.renderTuningRows();
        this.buildApplyControls(panel, panelWidth, panelHeight);
    }

    private changeGroup(direction: number) {
        this._groupIndex = positiveMod(this._groupIndex + direction, TUNING_GROUPS.length);
        this.renderTuningRows();
    }

    private adjustControl(rowIndex: number, direction: number) {
        const control = TUNING_GROUPS[this._groupIndex]?.controls[rowIndex];
        if (!control) {
            return;
        }
        control.set(control.get() + direction * control.step);
        this.renderTuningRows();
    }

    private renderTuningRows() {
        const group = TUNING_GROUPS[this._groupIndex];
        if (this._groupLabel) {
            this._groupLabel.string = `${this._groupIndex + 1}/${TUNING_GROUPS.length} ${group.name}`;
        }
        for (let i = 0; i < this._tuningRows.length; i++) {
            const row = this._tuningRows[i];
            const control = group.controls[i];
            row.root.active = !!control;
            if (!control) {
                continue;
            }
            row.name.string = control.label;
            row.description.string = control.description;
            row.value.string = `${control.get().toFixed(control.precision)}${control.suffix ?? ''}`;
        }
    }

    private buildApplyControls(parent: Node, panelWidth: number, panelHeight: number) {
        const reset = makeButton('TuneReset', parent, 76, 28, uiColor(86, 98, 112), '重置');
        reset.setPosition(-74, -panelHeight / 2 + 24, 0);
        reset.on(Node.EventType.TOUCH_END, () => {
            resetTuningToDefaults();
            this.setStatus('已重置');
            this.renderTuningRows();
        });

        const apply = makeButton('TuneApply', parent, 76, 28, uiColor(28, 148, 124), '应用');
        apply.setPosition(74, -panelHeight / 2 + 24, 0);
        apply.on(Node.EventType.TOUCH_END, () => {
            this.setStatus(saveCurrentTuning().message);
            this.renderTuningRows();
        });

        const statusNode = makeLabel('TuneStatus', parent, '', 12, uiColor(150, 235, 255));
        statusNode.getComponent(UITransform).setContentSize(panelWidth - 32, 18);
        statusNode.setPosition(0, -panelHeight / 2 + 52, 0);
        this._statusLabel = statusNode.getComponent(Label);
    }

    private setStatus(message: string) {
        if (this._statusLabel) {
            this._statusLabel.string = message;
        }
    }
}

function positiveMod(value: number, divisor: number): number {
    return ((value % divisor) + divisor) % divisor;
}
