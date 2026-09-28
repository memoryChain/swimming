import { Node, view } from 'cc';
import { EntertainmentStatusStrip } from './EntertainmentStatusStrip';

/** 乘客个人状态只在抓握变化时更新，比赛帧不格式化 HUD 文本。 */
export class TurtleBusHud {
    private readonly strip: EntertainmentStatusStrip;

    constructor(parent: Node) {
        this.strip = new EntertainmentStatusStrip(parent, 'TurtleBusStatus');
        this.layout();
        view.on('canvas-resize', this.layout, this);
        view.on('design-resolution-changed', this.layout, this);
    }

    setHands(hands: number): void {
        if ((hands & 3) === 0) {
            this.strip.hide();
            return;
        }
        this.strip.setContent('海龟班车搭乘中', (hands & 3) === 3 ? '双手抓稳' : '单手抓稳',
            (hands & 3) === 3 ? 'normal' : 'warning');
    }

    reset(): void { this.strip.reset(); }

    dispose(): void {
        view.off('canvas-resize', this.layout, this);
        view.off('design-resolution-changed', this.layout, this);
        this.strip.dispose();
    }

    private layout(): void {
        const root = this.strip.root;
        if (!root?.isValid) return;
        const y = view.getVisibleSize().height * .5 - 118;
        if (root.position.x !== 0 || root.position.y !== y) root.setPosition(0, y, 0);
    }
}
