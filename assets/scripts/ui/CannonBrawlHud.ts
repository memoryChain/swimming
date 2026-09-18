import { Color, Label, LabelOutline, Node, UITransform, view } from 'cc';
import { GameState } from '../core/GameConstants';
import { makeLabel, makeRoundedRect, uiColor } from './RuntimeUiFactory';
import { styleProjectUiLabel } from './ProjectUiFonts';

const SAMPLE_SECONDS = 0.1;
const NORMAL_TEXT = new Color(226, 247, 255, 255);
const WARNING_TEXT = new Color(255, 220, 66, 255);
const DANGER_TEXT = new Color(255, 92, 62, 255);

export type CannonThreat = 'core' | 'splash' | 'safe';

/** 炮火逃生赛状态条；一次构建，10Hz 采样，只在最终显示值变化时写 UI。 */
export class CannonBrawlHud {
    readonly root: Node;
    private readonly label: Label;
    private elapsed = SAMPLE_SECONDS;
    private lastText = '';
    private colorState = 0;

    constructor(parent: Node, _width: number, _height: number) {
        this.root = makeRoundedRect(
            'CannonBrawlStatus', parent, 560, 42,
            uiColor(7, 24, 36, 220), 18,
            uiColor(255, 92, 44, 230), 2,
        );
        this.layout();
        view.on('canvas-resize', this.layout, this);
        view.on('design-resolution-changed', this.layout, this);
        const labelNode = makeLabel('Status', this.root, '', 19, NORMAL_TEXT);
        labelNode.getComponent(UITransform)?.setContentSize(530, 38);
        this.label = labelNode.getComponent(Label)!;
        this.label.enableWrapText = false;
        this.label.overflow = Label.Overflow.SHRINK;
        styleProjectUiLabel(this.label, 'semibold', 34);
        const outline = labelNode.addComponent(LabelOutline);
        outline.color = uiColor(0, 0, 0, 100);
        outline.width = 1;
        this.root.active = false;
    }

    reset(): void {
        this.elapsed = SAMPLE_SECONDS;
        this.lastText = '';
        this.colorState = 0;
        if (this.root.active) this.root.active = false;
    }

    consumeSample(dt: number, state: GameState): boolean {
        const visible = state === GameState.RACING;
        if (this.root.active !== visible) this.root.active = visible;
        if (!visible) return false;
        this.elapsed += Math.max(0, Number.isFinite(dt) ? dt : 0);
        if (this.elapsed < SAMPLE_SECONDS) return false;
        this.elapsed %= SAMPLE_SECONDS;
        return true;
    }

    updateValues(
        remainingStrikes: number,
        activeRemainingSeconds: number,
        threat: CannonThreat,
        playerRecovering: boolean,
    ): void {
        let text: string;
        let colorState = 0;
        if (playerRecovering) {
            text = '炮弹核心命中 · 正在重新入水';
            colorState = 2;
        } else if (activeRemainingSeconds > 0) {
            const seconds = Math.max(0.1, Math.ceil(activeRemainingSeconds * 10) / 10).toFixed(1);
            if (threat === 'core') {
                text = `核心危险 · ${seconds}秒后落下 · 立即横移`;
                colorState = 2;
            } else if (threat === 'splash') {
                text = `冲击区 · ${seconds}秒后落下 · 继续躲避`;
                colorState = 1;
            } else {
                text = `炮弹 ${seconds}秒后落下 · 已离开危险区`;
                colorState = 0;
            }
        } else if (remainingStrikes > 0) {
            text = `下一轮炮击待命 · 还剩${remainingStrikes}发`;
        } else {
            text = '炮击阶段结束 · 向终点冲刺';
        }
        if (text !== this.lastText) {
            this.lastText = text;
            this.label.string = text;
        }
        if (colorState !== this.colorState) {
            this.colorState = colorState;
            const color = colorState === 2 ? DANGER_TEXT : colorState === 1 ? WARNING_TEXT : NORMAL_TEXT;
            if (!this.label.color.equals(color)) this.label.color = color;
        }
    }

    dispose(): void {
        view.off('canvas-resize', this.layout, this);
        view.off('design-resolution-changed', this.layout, this);
        if (this.root?.isValid) this.root.destroy();
    }

    private layout(): void {
        if (!this.root?.isValid) return;
        const size = view.getVisibleSize();
        const y = size.height * 0.5 - 118;
        if (this.root.position.x !== 0 || this.root.position.y !== y) this.root.setPosition(0, y, 0);
    }
}
