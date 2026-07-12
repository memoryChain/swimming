import { Camera, Label, Node, UITransform } from 'cc';
import { applyWaterColorTuning, WATER_COLOR_TUNING } from '../venue/WaterColorTuning';
import { makeButton, makeDragSlider, makeLabel, makeRect, makeUiNode, uiColor } from './RuntimeUiFactory';

type SliderSpec = {
    label: string;
    min: number;
    max: number;
    get: () => number;
    set: (value: number) => void;
    integer?: boolean;
};

// In-race water colour panel: a column of drag sliders bound to WATER_COLOR_TUNING.
// Dragging updates the live water + swimmer materials immediately via
// applyWaterColorTuning(), so colours can be tuned during an actual race without
// editing .mtl/.effect files. Toggle open/close with toggle().
export class WaterColorPanelBuilder {
    private _panel: Node | null = null;

    build(parent: Node, w: number, h: number, camera: Camera | null = null): Node {
        const specs: SliderSpec[] = [
            { label: '深水 R', min: 0, max: 255, integer: true, get: () => WATER_COLOR_TUNING.deepR, set: (v) => WATER_COLOR_TUNING.deepR = v },
            { label: '深水 G', min: 0, max: 255, integer: true, get: () => WATER_COLOR_TUNING.deepG, set: (v) => WATER_COLOR_TUNING.deepG = v },
            { label: '深水 B', min: 0, max: 255, integer: true, get: () => WATER_COLOR_TUNING.deepB, set: (v) => WATER_COLOR_TUNING.deepB = v },
            { label: '浅水 R', min: 0, max: 255, integer: true, get: () => WATER_COLOR_TUNING.shallowR, set: (v) => WATER_COLOR_TUNING.shallowR = v },
            { label: '浅水 G', min: 0, max: 255, integer: true, get: () => WATER_COLOR_TUNING.shallowG, set: (v) => WATER_COLOR_TUNING.shallowG = v },
            { label: '浅水 B', min: 0, max: 255, integer: true, get: () => WATER_COLOR_TUNING.shallowB, set: (v) => WATER_COLOR_TUNING.shallowB = v },
            { label: '水色浓度', min: 0, max: 1, get: () => WATER_COLOR_TUNING.tintStrength, set: (v) => WATER_COLOR_TUNING.tintStrength = v },
            { label: '身体蓝 R', min: 0, max: 255, integer: true, get: () => WATER_COLOR_TUNING.bodyR, set: (v) => WATER_COLOR_TUNING.bodyR = v },
            { label: '身体蓝 G', min: 0, max: 255, integer: true, get: () => WATER_COLOR_TUNING.bodyG, set: (v) => WATER_COLOR_TUNING.bodyG = v },
            { label: '身体蓝 B', min: 0, max: 255, integer: true, get: () => WATER_COLOR_TUNING.bodyB, set: (v) => WATER_COLOR_TUNING.bodyB = v },
            { label: '身体蓝浓度', min: 0, max: 1, get: () => WATER_COLOR_TUNING.bodyStrength, set: (v) => WATER_COLOR_TUNING.bodyStrength = v },
        ];

        const rowHeight = 34;
        const headerHeight = 44;
        const panelWidth = Math.min(w - 40, 320);
        const panelHeight = headerHeight + specs.length * rowHeight + 20;

        const panel = makeUiNode('WaterColorPanel', parent);
        // Give the root node the panel's real size so the input blocker's
        // getBoundingBoxToWorld() covers the whole panel (the visible back rect is
        // only a child and would otherwise leave the root at zero size).
        panel.getComponent(UITransform).setContentSize(panelWidth, panelHeight);
        panel.setPosition(-w / 2 + panelWidth / 2 + 12, 0, 0);
        panel.active = false;
        this._panel = panel;
        makeRect('WaterColorBack', panel, panelWidth, panelHeight, uiColor(6, 18, 28, 225));

        const title = makeLabel('WaterColorTitle', panel, '水色调节', 18, uiColor(150, 235, 255));
        title.getComponent(UITransform).setContentSize(panelWidth - 120, 30);
        title.setPosition(-panelWidth / 2 + (panelWidth - 120) / 2 + 14, panelHeight / 2 - 24, 0);

        const close = makeButton('WaterColorClose', panel, 68, 34, uiColor(232, 68, 72, 235), '关闭');
        close.setPosition(panelWidth / 2 - 44, panelHeight / 2 - 22, 0);
        close.on(Node.EventType.TOUCH_END, () => this.setVisible(false));

        const labelWidth = 96;
        const valueWidth = 54;
        const sliderWidth = panelWidth - labelWidth - valueWidth - 40;
        const labelX = -panelWidth / 2 + 14 + labelWidth / 2;
        const sliderX = labelX + labelWidth / 2 + sliderWidth / 2 + 6;
        const valueX = panelWidth / 2 - 14 - valueWidth / 2;
        const firstY = panelHeight / 2 - headerHeight - rowHeight / 2 + 6;

        for (let i = 0; i < specs.length; i++) {
            const spec = specs[i];
            const y = firstY - i * rowHeight;

            const nameNode = makeLabel(`WaterName${i}`, panel, spec.label, 15, uiColor(226, 244, 252));
            const nameLabel = nameNode.getComponent(Label);
            nameLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
            nameNode.getComponent(UITransform).setContentSize(labelWidth, 26);
            nameNode.setPosition(labelX, y, 0);

            const valueNode = makeLabel(`WaterValue${i}`, panel, '', 15, uiColor(255, 255, 255));
            const valueLabel = valueNode.getComponent(Label);
            valueLabel.horizontalAlign = Label.HorizontalAlign.RIGHT;
            valueNode.getComponent(UITransform).setContentSize(valueWidth, 26);
            valueNode.setPosition(valueX, y, 0);

            const range = spec.max - spec.min;
            const format = (value: number) => spec.integer ? `${Math.round(value)}` : value.toFixed(2);
            valueLabel.string = format(spec.get());

            const initialRatio = range > 0 ? (spec.get() - spec.min) / range : 0;
            const slider = makeDragSlider(`WaterSlider${i}`, panel, sliderWidth, 12, initialRatio, (ratio) => {
                let value = spec.min + ratio * range;
                if (spec.integer) {
                    value = Math.round(value);
                }
                spec.set(value);
                valueLabel.string = format(value);
                applyWaterColorTuning();
            }, camera);
            slider.node.setPosition(sliderX, y, 0);
        }

        return panel;
    }

    toggle() {
        this.setVisible(!(this._panel?.active ?? false));
    }

    setVisible(visible: boolean) {
        if (this._panel?.isValid) {
            this._panel.active = visible;
        }
    }
}
