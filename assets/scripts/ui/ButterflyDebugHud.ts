import { Label, Node, UITransform } from 'cc';
import type { ButterflyStroke } from '../swimmer/ButterflyStroke';
import { makeLabel, uiColor } from './RuntimeUiFactory';
import { styleProjectUiLabel } from './ProjectUiFonts';

/** 专用单人测试读数；10Hz，隐藏时不格式化，不重绘图形。 */
export class ButterflyDebugHud {
    private label: Label;
    private elapsed = 0;

    constructor(parent: Node, width: number, height: number) {
        const node = makeLabel('ButterflyDebugStatus', parent, '', 19, uiColor(224, 250, 255));
        node.getComponent(UITransform).setContentSize(Math.min(820, width - 40), 60);
        node.setPosition(0, height / 2 - 124, 0);
        this.label = node.getComponent(Label);
        this.label.overflow = Label.Overflow.SHRINK;
        styleProjectUiLabel(this.label, 'regular', 26);
    }

    update(dt: number, visible: boolean, beat: ButterflyStroke | null) {
        const node = this.label.node;
        if (node.active !== visible) node.active = visible;
        if (!visible || !node.activeInHierarchy || !beat) return;
        this.elapsed += dt;
        if (this.elapsed < 0.1) return;
        this.elapsed = 0;
        const phase = !beat.active ? '自由泳 · 可以切换' : beat.held ? '蝶泳抱水 · 等待松手' : '蝶泳回臂 · 暂不能转向';
        const rating = beat.lastQuality < 0 ? '等待第一拍' : beat.lastTimedOut ? '按住超时'
            : beat.lastQuality === 1 ? '完美' : beat.lastQuality > 0 ? '良好' : '松手偏早';
        const next = `${phase}　${beat.active ? Math.round(beat.progress * 100) : 0}%\n上一拍：${rating}　双手按住发力，松手后接下一拍`;
        if (this.label.string !== next) this.label.string = next;
    }
}
