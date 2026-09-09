import { BlockInputEvents, Button, Camera, Color, Label, Node, UITransform, Vec2, Vec3 } from 'cc';
import { PREVIEW_EFFECTS, PreviewEffect, SceneEffectPreviewState } from '../venue/SceneEffectPreviewState';
import { makeButton, makeRect, makeScreenEdgeGroup } from './RuntimeUiFactory';
import { styleProjectUiLabel } from './ProjectUiFonts';

const TITLES: Record<PreviewEffect, string> = { crowd: '观众', floats: '泳道浮漂', ceiling: '顶棚灯架', bubbles: '角色气泡' };
const BUTTON_COLOR = new Color(23, 48, 67, 240);
const ON_COLOR = new Color(105, 237, 205);
const OFF_COLOR = new Color(173, 181, 188);

// 调试面板只在预览入口挂载；没有 update、Tween 或逐帧文字/图形重建。
export class SceneEffectPreviewPanel {
    readonly root: Node;
    private readonly _header: Node;
    private readonly _content: Node;
    private readonly _labels = new Map<PreviewEffect, Label>();
    private readonly _screenPoint = new Vec3();
    private readonly _worldPoint = new Vec3();
    private readonly _point = new Vec2();

    constructor(parent: Node, private readonly _state: SceneEffectPreviewState, private readonly _camera: Camera | null) {
        this.root = makeScreenEdgeGroup('SceneEffectPreviewPanel', parent, 'left', 220, 348, 20);
        this._header = makeButton('PreviewExpand', this.root, 200, 40, BUTTON_COLOR, '效果开关 · 收起');
        this._header.setPosition(0, 140, 0);
        this._header.addComponent(BlockInputEvents);
        this.styleLabel(this._header);
        this._content = makeRect('PreviewOptions', this.root, 220, 276, new Color(7, 20, 31, 210));
        this._content.setPosition(0, -26, 0);
        this._content.addComponent(BlockInputEvents);
        PREVIEW_EFFECTS.forEach((effect, index) => {
            const button = makeButton(`Preview_${effect}`, this._content, 196, 40, BUTTON_COLOR, `${TITLES[effect]}：开`);
            button.setPosition(0, 106 - index * 48, 0);
            const label = this.styleLabel(button);
            label.color = ON_COLOR;
            this._labels.set(effect, label);
            button.on(Button.EventType.CLICK, () => {
                this._state.setEnabled(effect, !this._state.isEnabled(effect));
                this.refreshLabel(effect);
            });
        });
        const reset = makeButton('PreviewReset', this._content, 196, 36, BUTTON_COLOR, '恢复默认');
        reset.setPosition(0, -100, 0);
        this.styleLabel(reset);
        reset.on(Button.EventType.CLICK, () => {
            this._state.reset();
            for (const effect of PREVIEW_EFFECTS) this.refreshLabel(effect);
        });
        this._header.on(Button.EventType.CLICK, () => {
            this._content.active = !this._content.active;
            this._header.getChildByName('Label')!.getComponent(Label)!.string = this._content.active ? '效果开关 · 收起' : '效果开关 · 展开';
        });
    }

    // 全局相机输入不会被普通 UI 冒泡拦截，需要用同一可见区域显式命中检测。
    blocksPointer(x: number, y: number): boolean {
        if (!this.root.isValid || !this.root.activeInHierarchy || !this._camera?.isValid) return false;
        this._screenPoint.set(x, y, 0);
        this._camera.screenToWorld(this._screenPoint, this._worldPoint);
        this._point.set(this._worldPoint.x, this._worldPoint.y);
        return this._header.getComponent(UITransform)!.getBoundingBoxToWorld().contains(this._point)
            || (this._content.active && this._content.getComponent(UITransform)!.getBoundingBoxToWorld().contains(this._point));
    }

    dispose() { if (this.root.isValid) this.root.destroy(); }

    private styleLabel(button: Node): Label {
        const label = button.getChildByName('Label')!.getComponent(Label)!;
        styleProjectUiLabel(label, 'semibold', 26);
        return label;
    }

    private refreshLabel(effect: PreviewEffect) {
        const enabled = this._state.isEnabled(effect);
        const label = this._labels.get(effect)!;
        const text = `${TITLES[effect]}：${enabled ? '开' : '关'}`;
        if (label.string !== text) label.string = text;
        const color = enabled ? ON_COLOR : OFF_COLOR;
        if (!label.color.equals(color)) label.color = color;
    }
}
