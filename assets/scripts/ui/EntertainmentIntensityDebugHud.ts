import { Label, Node, UITransform } from 'cc';
import { EntertainmentEventId } from '../core/EntertainmentModeDirector';
import { ENTERTAINMENT_INTENSITY_LABELS, EntertainmentIntensity } from '../core/EntertainmentIntensity';
import { styleProjectUiLabel } from './ProjectUiFonts';
import { makeLabel, uiColor } from './RuntimeUiFactory';

/** 仅本地开发赛创建；隐藏时不格式化、不遍历玩法状态。 */
export class EntertainmentIntensityDebugHud {
    private label: Label | null = null;
    private elapsed = 0;
    private event: EntertainmentEventId | null = null;
    private peak = 0;

    build(parent: Node, width: number, height: number): void {
        const span = Math.min(820, width - 30);
        const node = makeLabel('EntertainmentIntensityStats', parent,
            '娱乐强度统计准备中', 17, uiColor(220, 245, 255, 245));
        node.getComponent(UITransform).setContentSize(span, 34);
        node.setPosition(-width / 2 + span / 2 + 15, height / 2 - 66, 0);
        const label = node.getComponent(Label);
        label.horizontalAlign = Label.HorizontalAlign.LEFT;
        if (Label.Overflow) label.overflow = Label.Overflow.SHRINK;
        styleProjectUiLabel(label, 'semibold', 17);
        this.label = label;
        this.elapsed = 0;
        this.event = null;
        this.peak = 0;
    }

    consumeSample(dt: number, racing: boolean): boolean {
        if (!this.label?.node?.activeInHierarchy || !racing) return false;
        this.elapsed += dt;
        if (this.elapsed < 0.2) return false;
        this.elapsed %= 0.2;
        return true;
    }

    previousEvent(): EntertainmentEventId | null { return this.event; }
    presentSummary(event: EntertainmentEventId, text: string): void {
        if (!this.label?.node?.activeInHierarchy) return;
        if (this.event !== event) { this.event = event; this.peak = 0; }
        if (this.label.string !== text) this.label.string = text;
    }

    present(event: EntertainmentEventId, level: EntertainmentIntensity,
        name: string, planned: number, actual: number, active: number, cancelled: number): void {
        if (!this.label?.node?.activeInHierarchy) return;
        if (this.event !== event) {
            this.event = event;
            this.peak = 0;
        }
        this.peak = Math.max(this.peak, active);
        const next = `${name} ${level}档${ENTERTAINMENT_INTENSITY_LABELS[level - 1]} 计划${planned} 已触发${actual}`
            + ` 在场${active}/峰值${this.peak} 取消${cancelled}`;
        if (this.label.string !== next) this.label.string = next;
    }
}
