import { Color, Label, LabelOutline, Node, UITransform, Widget } from 'cc';
import { makeLabel } from './RuntimeUiFactory';
import { styleProjectUiLabel } from './ProjectUiFonts';

/** 本地调试读数；只建一个 Label，10Hz 读取量化值，隐藏后零工作。 */
export class MineRelayBrawlHud {
    readonly root: Node;
    private readonly label: Label;
    private elapsed = .1;
    private lane = -2;
    private tenths = -1;
    private locked = false;
    private paused = false;
    private rounds = -1;
    constructor(parent: Node) {
        this.root = makeLabel('TimedWaterBalloonStatus', parent, '', 22, new Color(244, 251, 255));
        this.root.getComponent(UITransform)!.setContentSize(620, 44);
        this.label = this.root.getComponent(Label)!;
        this.label.enableWrapText = false; this.label.overflow = Label.Overflow.SHRINK;
        this.label.horizontalAlign = Label.HorizontalAlign.CENTER;
        styleProjectUiLabel(this.label, 'semibold', 30);
        const outline = this.root.addComponent(LabelOutline); outline.color = new Color(0, 6, 14, 205); outline.width = 2;
        const widget = this.root.addComponent(Widget); widget.target = parent; widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
        widget.isAlignTop = true; widget.top = 80; widget.isAlignHorizontalCenter = true; widget.horizontalCenter = 0;
        this.root.active = false;
    }
    setRacing(racing: boolean): void {
        if (!this.root.isValid) return;
        if (this.root.active !== racing) this.root.active = racing;
        this.elapsed = .1; this.lane = -2;
    }
    update(dt: number, lane: number, seconds: number, locked: boolean, paused: boolean, rounds: number): void {
        if (!this.root.isValid || !this.root.activeInHierarchy) return;
        this.elapsed += dt; if (this.elapsed < .1) return; this.elapsed %= .1;
        const tenths = Math.max(0, Math.ceil(seconds * 10));
        if (lane === this.lane && tenths === this.tenths && locked === this.locked && paused === this.paused && rounds === this.rounds) return;
        this.lane = lane; this.tenths = tenths; this.locked = locked; this.paused = paused; this.rounds = rounds;
        const text = lane >= 0 ? paused ? `${lane + 1}号泳道携带水球 · 计时暂停`
            : `${lane + 1}号泳道携带水球 · ${(tenths / 10).toFixed(1)}秒 · ${locked ? '无法转交' : '贴近对手转交'}`
            : rounds > 0 ? `下一轮水球待命 · 剩余${rounds}轮` : '水球阶段结束';
        if (this.label.string !== text) this.label.string = text;
    }
    dispose(): void { if (this.root.isValid) this.root.destroy(); }
}
