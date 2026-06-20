import { Label, Node, UITransform } from 'cc';
import { MOTION_TUNING } from '../core/InputTuning';
import { resetTuningToDefaults, saveCurrentTuning, TUNING_GROUPS } from '../core/TuningDebugControls';
import { makeButton, makeLabel, makeRect, makeUiNode, uiColor } from './RuntimeUiFactory';

export type ModelDebugHudCallbacks = {
    onExit: () => void;
    onSlow: () => void;
    onFast: () => void;
    onSwitchModel: () => void;
    onSwitchSkybox: () => void;
};

export type ModelDebugHudRefs = {
    root: Node;
    speedLabel: Label;
    ratingLabel: Label;
    swimSpeedLabel: Label;
    modelLabel: Label;
    skyboxLabel: Label;
};

export class ModelDebugHudBuilder {
    private _groupIndex = 0;
    private _groupLabel: Label | null = null;
    private _statusLabel: Label | null = null;
    private _tuningOverlay: Node | null = null;
    private readonly _tuningRows: {
        root: Node;
        name: Label;
        description: Label;
        value: Label;
    }[] = [];

    constructor(private readonly _callbacks: ModelDebugHudCallbacks) {}

    build(parent: Node, w: number, h: number): ModelDebugHudRefs {
        const hud = makeUiNode('ModelDebugHUD', parent);
        const portrait = h > w;
        const topHeight = portrait ? 86 : 76;
        const bottomHeight = portrait ? 74 : 54;
        const topY = h / 2 - topHeight / 2;
        const bottomY = -h / 2 + bottomHeight / 2;
        makeRect('ModelDebugTop', hud, w, topHeight, uiColor(5, 16, 26, 190)).setPosition(0, topY, 0);
        const title = makeLabel('ModelDebugTitle', hud, portrait ? '模型调试' : '动作模型调试', portrait ? 16 : 24, uiColor(255, 255, 255));
        title.getComponent(UITransform).setContentSize(portrait ? w - 36 : 300, portrait ? 30 : topHeight);
        title.setPosition(portrait ? 0 : -w / 2 + 190, portrait ? h / 2 - 18 : topY, 0);
        const hint = makeLabel('ModelDebugHint', hud, 'A：左手/右脚    D：右手/左脚    Q/E：速度    拖拽：环绕    滚轮：缩放', 16, uiColor(150, 235, 255));
        hint.active = !portrait;
        hint.setPosition(0, topY, 0);
        const exit = makeButton('ModelDebugExit', hud, portrait ? 76 : 130, portrait ? 36 : 42, uiColor(232, 68, 72), '退出');
        exit.setPosition(portrait ? 48 : w / 2 - 86, portrait ? h / 2 - 60 : topY, 0);
        exit.on(Node.EventType.TOUCH_END, () => this._callbacks.onExit());
        const tuning = makeButton('ModelDebugTuningOpen', hud, portrait ? 76 : 110, portrait ? 36 : 42, uiColor(34, 96, 146), '参数');
        tuning.setPosition(portrait ? -48 : w / 2 - 206, portrait ? h / 2 - 60 : topY, 0);
        tuning.on(Node.EventType.TOUCH_END, () => this.setTuningOverlayVisible(true));
        makeRect('ModelDebugBottom', hud, w, bottomHeight, uiColor(5, 16, 26, 135)).setPosition(0, bottomY, 0);
        const portraitStatusWidth = Math.max(86, Math.min(112, w / 3 - 14));
        const model = makeButton('ModelDebugSwitchModel', hud, portrait ? 76 : 96, 36, uiColor(92, 76, 170), '模型');
        model.setPosition(portrait ? -118 : -304, portrait ? -h / 2 + 26 : bottomY, 0);
        model.on(Node.EventType.TOUCH_END, () => this._callbacks.onSwitchModel());
        const sky = makeButton('ModelDebugSwitchSkybox', hud, portrait ? 64 : 76, 36, uiColor(42, 128, 132), '天空');
        sky.setPosition(portrait ? -42 : -204, portrait ? -h / 2 + 26 : bottomY, 0);
        sky.on(Node.EventType.TOUCH_END, () => this._callbacks.onSwitchSkybox());
        const slower = makeButton('ModelDebugSlow', hud, 54, 36, uiColor(38, 116, 190), '-');
        slower.setPosition(portrait ? 46 : -88, portrait ? -h / 2 + 26 : bottomY, 0);
        slower.on(Node.EventType.TOUCH_END, () => this._callbacks.onSlow());
        const faster = makeButton('ModelDebugFast', hud, 54, 36, uiColor(38, 116, 190), '+');
        faster.setPosition(portrait ? 116 : 88, portrait ? -h / 2 + 26 : bottomY, 0);
        faster.on(Node.EventType.TOUCH_END, () => this._callbacks.onFast());
        const speedLabel = makeLabel('ModelDebugStatus', hud, `速度 ${MOTION_TUNING.animationSpeedScale.toFixed(2)}x`, 18, uiColor(230, 244, 250));
        speedLabel.getComponent(UITransform).setContentSize(portrait ? portraitStatusWidth : 180, 30);
        speedLabel.setPosition(portrait ? w / 3 : 0, portrait ? -h / 2 + 58 : bottomY, 0);
        speedLabel.getComponent(Label).overflow = Label.Overflow.CLAMP;
        const modelLabel = makeLabel('ModelDebugModelLabel', hud, '模型 默认', portrait ? 12 : 14, uiColor(205, 220, 255));
        modelLabel.getComponent(UITransform).setContentSize(portrait ? portraitStatusWidth : 220, 22);
        modelLabel.setPosition(portrait ? -w / 3 : -260, -h / 2 + 58, 0);
        modelLabel.getComponent(Label).overflow = Label.Overflow.CLAMP;
        const skyboxLabel = makeLabel('ModelDebugSkyboxLabel', hud, '天空 默认', portrait ? 12 : 14, uiColor(175, 232, 232));
        skyboxLabel.getComponent(UITransform).setContentSize(portrait ? portraitStatusWidth : 260, 22);
        skyboxLabel.setPosition(portrait ? 0 : 64, -h / 2 + 58, 0);
        skyboxLabel.getComponent(Label).overflow = Label.Overflow.CLAMP;
        const ratingLabel = makeLabel('ModelDebugRating', hud, '准备', 20, uiColor(230, 244, 250));
        ratingLabel.getComponent(UITransform).setContentSize(280, 32);
        ratingLabel.setPosition(0, h / 2 - (portrait ? 112 : 104), 0);
        const swimSpeedLabel = makeLabel('ModelDebugSwimSpeed', hud, '0.00 m/s', 18, uiColor(150, 235, 255));
        swimSpeedLabel.getComponent(UITransform).setContentSize(portrait ? w - 28 : 520, 30);
        swimSpeedLabel.setPosition(0, h / 2 - (portrait ? 140 : 134), 0);
        this.buildTuningPanel(hud, w, h);
        return {
            root: hud,
            speedLabel: speedLabel.getComponent(Label),
            ratingLabel: ratingLabel.getComponent(Label),
            swimSpeedLabel: swimSpeedLabel.getComponent(Label),
            modelLabel: modelLabel.getComponent(Label),
            skyboxLabel: skyboxLabel.getComponent(Label),
        };
    }

    private buildTuningPanel(parent: Node, w: number, h: number) {
        this._tuningRows.length = 0;
        const portrait = h > w;
        const overlay = makeUiNode('ModelDebugTuningOverlay', parent);
        overlay.active = false;
        this._tuningOverlay = overlay;
        makeRect('OverlayBack', overlay, w, h, uiColor(2, 8, 14, 232));

        const panelWidth = Math.max(320, w - (portrait ? 24 : 72));
        const panelHeight = Math.max(440, h - (portrait ? 104 : 128));
        const panel = makeUiNode('ModelDebugTuningPanel', overlay);
        panel.setPosition(0, -8, 0);
        makeRect('Back', panel, panelWidth, panelHeight, uiColor(6, 18, 28, 205));

        const previous = makeButton('TunePrev', panel, 54, 40, uiColor(34, 96, 146), '<');
        previous.setPosition(-panelWidth / 2 + 42, panelHeight / 2 - 34, 0);
        previous.on(Node.EventType.TOUCH_END, () => this.changeGroup(-1));

        const next = makeButton('TuneNext', panel, 54, 40, uiColor(34, 96, 146), '>');
        next.setPosition(panelWidth / 2 - 42, panelHeight / 2 - 34, 0);
        next.on(Node.EventType.TOUCH_END, () => this.changeGroup(1));

        const close = makeButton('TuneClose', overlay, 88, 40, uiColor(232, 68, 72), '关闭');
        close.setPosition(w / 2 - 58, h / 2 - 34, 0);
        close.on(Node.EventType.TOUCH_END, () => this.setTuningOverlayVisible(false));

        const groupLabelNode = makeLabel('TuneGroup', panel, '', portrait ? 20 : 22, uiColor(235, 248, 255));
        groupLabelNode.getComponent(UITransform).setContentSize(panelWidth - 144, 42);
        groupLabelNode.setPosition(0, panelHeight / 2 - 34, 0);
        this._groupLabel = groupLabelNode.getComponent(Label);

        const rowHeight = portrait ? 58 : 54;
        const rowCount = Math.max(6, Math.min(12, Math.floor((panelHeight - 150) / rowHeight)));
        const firstY = panelHeight / 2 - 92;
        const controlValueX = panelWidth / 2 - 88;
        const controlMinusX = panelWidth / 2 - 154;
        const controlPlusX = panelWidth / 2 - 26;
        const textLeft = -panelWidth / 2 + 22;
        const textRight = controlMinusX - 28;
        const textWidth = Math.max(180, textRight - textLeft);
        const textX = textLeft + textWidth / 2;
        for (let i = 0; i < rowCount; i++) {
            const row = makeUiNode(`TuneRow${i}`, panel);
            row.setPosition(0, firstY - i * rowHeight, 0);
            makeRect('RowBack', row, panelWidth - 30, rowHeight - 6, i % 2 === 0 ? uiColor(12, 34, 48, 150) : uiColor(10, 28, 42, 110));

            const nameNode = makeLabel('Name', row, '', portrait ? 16 : 18, uiColor(212, 238, 246));
            nameNode.getComponent(UITransform).setContentSize(textWidth, 22);
            nameNode.setPosition(textX, 12, 0);
            const nameLabel = nameNode.getComponent(Label);
            nameLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
            nameLabel.overflow = Label.Overflow.CLAMP;

            const descriptionNode = makeLabel('Description', row, '', portrait ? 12 : 13, uiColor(144, 198, 214));
            descriptionNode.getComponent(UITransform).setContentSize(textWidth, 30);
            descriptionNode.setPosition(textX, -13, 0);
            const descriptionLabel = descriptionNode.getComponent(Label);
            descriptionLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
            descriptionLabel.verticalAlign = Label.VerticalAlign.TOP;
            descriptionLabel.enableWrapText = true;
            descriptionLabel.overflow = Label.Overflow.CLAMP;

            const minus = makeButton('Minus', row, 42, 36, uiColor(36, 106, 160), '-');
            minus.setPosition(controlMinusX, 0, 0);
            minus.on(Node.EventType.TOUCH_END, () => this.adjustControl(i, -1));

            const valueNode = makeLabel('Value', row, '', portrait ? 16 : 18, uiColor(255, 255, 255));
            valueNode.getComponent(UITransform).setContentSize(86, 36);
            valueNode.setPosition(controlValueX, 0, 0);

            const plus = makeButton('Plus', row, 42, 36, uiColor(36, 106, 160), '+');
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
        const reset = makeButton('TuneReset', parent, 100, 38, uiColor(86, 98, 112), '重置');
        reset.getComponent(UITransform).setContentSize(100, 38);
        reset.setPosition(-92, -panelHeight / 2 + 34, 0);
        reset.on(Node.EventType.TOUCH_END, () => {
            resetTuningToDefaults();
            this.setStatus('已重置');
            this.renderTuningRows();
        });

        const apply = makeButton('TuneApply', parent, 100, 38, uiColor(28, 148, 124), '应用');
        apply.getComponent(UITransform).setContentSize(100, 38);
        apply.setPosition(92, -panelHeight / 2 + 34, 0);
        apply.on(Node.EventType.TOUCH_END, () => {
            this.setStatus(saveCurrentTuning().message);
            this.renderTuningRows();
        });

        const statusNode = makeLabel('TuneStatus', parent, '', 12, uiColor(150, 235, 255));
        statusNode.getComponent(UITransform).setContentSize(panelWidth - 32, 24);
        statusNode.setPosition(0, -panelHeight / 2 + 72, 0);
        this._statusLabel = statusNode.getComponent(Label);
    }

    private setTuningOverlayVisible(visible: boolean) {
        if (this._tuningOverlay) {
            this._tuningOverlay.active = visible;
        }
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
