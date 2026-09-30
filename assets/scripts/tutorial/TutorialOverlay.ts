import { BlockInputEvents, Button, Canvas, Color, Graphics, Label, Node, Rect, UITransform, Vec3, view } from 'cc';
import { getUILayer, UILayer } from '../ui/UILayers';
import { makeButton, makeLabel, makeRect, makeUiNode } from '../ui/RuntimeUiFactory';
import { styleProjectUiLabel } from '../ui/ProjectUiFonts';

/** 临时教学界面。大厅只放行原比赛按钮，比赛说明仍完整拦截输入。 */
export class TutorialOverlay {
    readonly root: Node;
    private readonly shade: Node;
    private readonly shadeBlocker: BlockInputEvents;
    private readonly inputBlockers: Node[] = [];
    private readonly panel: Node;
    private readonly panelBlocker: BlockInputEvents;
    private readonly stage: Label;
    private readonly title: Label;
    private laidOut = false;
    private panelMode = '';
    private compact = false;
    private multilineCompact = false;
    private readonly body: Label;
    private readonly action: Node;
    private readonly actionLabel: Label;
    private readonly cue: Label;
    private readonly highlight: Graphics;
    private target: Node | null = null;
    private modal = true;
    private lobby = false;
    private callback: (() => void) | null = null;
    private readonly resize = () => this.layout();
    constructor(private readonly canvas: Node) {
        this.root = makeUiNode('TutorialOverlay', getUILayer(canvas, UILayer.Popup));
        this.shade = makeUiNode('TutorialDim', this.root);
        this.shade.addComponent(Graphics);
        this.shadeBlocker = this.shade.addComponent(BlockInputEvents);
        for (let i = 0; i < 4; i++) {
            const blocker = makeUiNode(`TutorialInputBlock${i}`, this.shade);
            blocker.addComponent(BlockInputEvents);
            blocker.active = false;
            this.inputBlockers.push(blocker);
        }
        this.panel = makeRect('LessonCard', this.root, 690, 210, new Color(12, 36, 51, 242));
        this.panelBlocker = this.panel.addComponent(BlockInputEvents);
        this.highlight = makeUiNode('TutorialTargetOutline', this.root).addComponent(Graphics);
        this.cue = this.label('GestureCue', this.root, 25, 740, 48, 0, 0, true);
        this.cue.color = new Color(204, 238, 83);
        this.cue.node.active = false;
        this.stage = this.label('LessonStage', this.panel, 16, 650, 25, 0, 91, true);
        this.stage.node.active = false;
        this.title = this.label('Title', this.panel, 26, 650, 42, 0, 71, true);
        this.body = this.label('Body', this.panel, 21, 644, 116, 0, -7, false);
        this.action = makeButton('TutorialAction', this.root, 264, 62, new Color(26, 134, 158), '');
        this.action.addComponent(BlockInputEvents);
        this.actionLabel = this.label('ActionLabel', this.action, 23, 254, 55, 0, 0, true);
        this.action.on(Button.EventType.CLICK, () => this.callback?.());
        view.on('canvas-resize', this.resize);
        view.on('design-resolution-changed', this.resize);
    }
    private label(name: string, parent: Node, size: number, w: number, h: number, x: number, y: number, bold: boolean): Label {
        const node = makeLabel(name, parent, '', size, Color.WHITE);
        const label = node.getComponent(Label)!;
        label.overflow = Label.Overflow.SHRINK;
        label.enableWrapText = true;
        styleProjectUiLabel(label, bold ? 'semibold' : 'regular', size + 8);
        node.getComponent(UITransform)!.setContentSize(w, h);
        node.setPosition(x, y);
        return label;
    }
    show(title: string, body: string, modal: boolean, button: string, action: (() => void) | null, target: Node | null = null, lobby = false, compact = false): void {
        const wasHidden = !this.root.active;
        if (wasHidden) this.root.active = true;
        if (!this.root.activeInHierarchy) throw new Error('教学界面未挂载到可见画布');
        if (this.title.string !== title) this.title.string = title;
        if (this.body.string !== body) this.body.string = body;
        if (this.actionLabel.string !== button) this.actionLabel.string = button;
        const panelVisible = modal || !!body;
        const visibilityChanged = this.panel.active !== panelVisible;
        if (visibilityChanged) this.panel.active = panelVisible;
        if (this.panelBlocker.enabled !== modal) this.panelBlocker.enabled = modal;
        this.callback = lobby ? null : action;
        const actionVisible = !!button && !lobby;
        if (this.action.active !== actionVisible) this.action.active = actionVisible;
        const multilineCompact = compact && !modal && body.includes('\n');
        const layoutChanged = wasHidden || !this.laidOut || this.modal !== modal || this.lobby !== lobby || this.target !== target
            || this.compact !== compact || this.multilineCompact !== multilineCompact || visibilityChanged;
        this.modal = modal;
        this.lobby = lobby;
        this.target = target;
        this.compact = compact;
        this.multilineCompact = multilineCompact;
        if (layoutChanged) this.layout();
    }
    setStage(text: string): void {
        if (this.stage.string !== text) this.stage.string = text;
        if (this.stage.node.active !== !!text) this.stage.node.active = !!text;
    }
    setCue(text: string): void {
        if (this.cue.string !== text) this.cue.string = text;
        const visible = !!text && !this.modal && !this.compact;
        if (this.cue.node.active !== visible) this.cue.node.active = visible;
    }
    private targetRect(): Rect | null {
        if (!this.target?.isValid) return null;
        let source: Node | null = this.target;
        while (source && !source.getComponent(Canvas)) source = source.parent;
        let dest: Node | null = this.root;
        while (dest && !dest.getComponent(Canvas)) dest = dest.parent;
        const from = source?.getComponent(Canvas)?.cameraComponent;
        const to = dest?.getComponent(Canvas)?.cameraComponent;
        const transform = this.target.getComponent(UITransform);
        if (!from?.camera || !to?.camera || !transform) return null;
        // 新建弹窗相机尚未渲染，先更新矩阵，避免首屏投影出零尺寸按钮。
        from.camera.update(true);
        to.camera.update(true);
        const convert = (x: number, y: number) => {
            const world = transform.convertToWorldSpaceAR(new Vec3(x, y));
            const screen = from.worldToScreen(world, new Vec3());
            const destination = to.screenToWorld(screen, new Vec3());
            return this.root.getComponent(UITransform)!.convertToNodeSpaceAR(destination);
        };
        const a = convert(-transform.width / 2, -transform.height / 2);
        const b = convert(transform.width / 2, transform.height / 2);
        if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)
            || b.x <= a.x || b.y <= a.y) return null;
        return new Rect(a.x - 12, a.y - 12, b.x - a.x + 24, b.y - a.y + 24);
    }
    private setInputBlock(index: number, x: number, y: number, width: number, height: number): void {
        const node = this.inputBlockers[index];
        const active = width > 0 && height > 0;
        if (node.active !== active) node.active = active;
        if (!active) return;
        const transform = node.getComponent(UITransform)!;
        if (transform.width !== width || transform.height !== height) transform.setContentSize(width, height);
        const px = x + width / 2, py = y + height / 2;
        if (node.position.x !== px || node.position.y !== py) node.setPosition(px, py);
    }
    private layout(): void {
        if (!this.root.activeInHierarchy) return;
        this.laidOut = true;
        const size = view.getVisibleSize();
        const w = size.width, h = size.height;
        const scale = Math.min(1, w / 1000, h / 720);
        this.root.getComponent(UITransform)!.setContentSize(w, h);
        this.shade.getComponent(UITransform)!.setContentSize(w, h);
        if (this.shade.active !== this.modal) this.shade.active = this.modal;
        this.cue.node.setScale(scale, scale, 1);
        this.cue.node.setPosition(0, h / 2 - 247 * scale);
        const mode = `${this.compact}:${this.modal}:${this.multilineCompact}`;
        const width = this.compact ? 460 : 690;
        const height = this.compact ? this.modal ? 190 : this.multilineCompact ? 78 : 54 : this.modal ? 248 : 154;
        if (this.panelMode !== mode) {
            this.panelMode = mode;
            this.panel.getComponent(UITransform)!.setContentSize(width, height);
            const panelGfx = this.panel.getComponent(Graphics)!;
            panelGfx.clear(); panelGfx.fillColor = new Color(12, 36, 51, 242);
            panelGfx.rect(-width / 2, -height / 2, width, height); panelGfx.fill();
            const titleVisible = !this.compact || this.modal;
            if (this.title.node.active !== titleVisible) this.title.node.active = titleVisible;
            this.stage.node.setPosition(0, this.modal ? 100 : 60);
            this.title.node.setPosition(0, this.compact ? 63 : this.modal ? 68 : 32);
            this.title.fontSize = this.compact ? 22 : 26;
            this.title.node.getComponent(UITransform)!.setContentSize(width - 40, 42);
            this.body.node.setPosition(0, this.compact ? this.modal ? 12 : 0 : this.modal ? -13 : -26);
            this.body.fontSize = this.compact ? 18 : this.modal ? 21 : 18;
            this.body.lineHeight = this.compact ? 26 : this.modal ? 29 : 26;
            this.body.node.getComponent(UITransform)!.setContentSize(width - 40,
                this.compact ? this.modal ? 70 : this.multilineCompact ? 60 : 36 : this.modal ? 116 : 78);
        }
        this.panel.setScale(scale, scale, 1);
        this.panel.setPosition(0, this.modal ? 0 : h / 2 - 116 * scale);
        this.action.setScale(scale, scale, 1);
        this.action.setPosition(0, -174 * scale);
        const hole = this.targetRect();
        const passTarget = this.modal && this.lobby && !!hole && hole.width > 24 && hole.height > 24
            && hole.xMax > -w / 2 && hole.x < w / 2 && hole.yMax > -h / 2 && hole.y < h / 2;
        const blockScreen = !passTarget;
        if (this.shadeBlocker.enabled !== blockScreen) this.shadeBlocker.enabled = blockScreen;
        if (!passTarget) for (const blocker of this.inputBlockers) if (blocker.active) blocker.active = false;
        if (this.compact) {
            // 小提示跟随 HUD 的边缘，只在窗口或目标变化时定位。
            const halfW = width * scale / 2, halfH = height * scale / 2;
            const margin = 24 * scale;
            const right = hole ? hole.x + hole.width / 2 > 0 : false;
            const x = hole && right ? hole.xMax - halfW : -w / 2 + margin + halfW;
            const y = hole ? right ? hole.yMax + 16 * scale + halfH : hole.y - 16 * scale - halfH : h / 2 - 210 * scale - halfH;
            const px = Math.max(-w / 2 + margin + halfW, Math.min(w / 2 - margin - halfW, x));
            const py = Math.max(-h / 2 + margin + halfH, Math.min(h / 2 - margin - halfH, y));
            this.panel.setPosition(px, py);
            this.action.setPosition(px, py - 58 * scale);
            this.action.setScale(0.76 * scale, 0.76 * scale, 1);
        }
        const cueVisible = !!this.cue.string && !this.modal && !this.compact;
        if (this.cue.node.active !== cueVisible) this.cue.node.active = cueVisible;
        this.highlight.clear();
        if (!this.modal && this.panel.active && hole) {
            this.highlight.strokeColor = new Color(204, 238, 83);
            this.highlight.lineWidth = 3;
            this.highlight.rect(hole.x, hole.y, hole.width, hole.height);
            this.highlight.stroke();
        }
        const gfx = this.shade.getComponent(Graphics)!;
        gfx.clear();
        if (!this.modal) return;
        gfx.fillColor = new Color(4, 16, 27, 175);
        if (hole && hole.xMax > -w / 2 && hole.x < w / 2 && hole.yMax > -h / 2 && hole.y < h / 2) {
            const l = Math.max(-w / 2, hole.x), r = Math.min(w / 2, hole.xMax);
            const b = Math.max(-h / 2, hole.y), t = Math.min(h / 2, hole.yMax);
            gfx.rect(-w / 2, -h / 2, w, Math.max(0, b + h / 2));
            gfx.rect(-w / 2, t, w, Math.max(0, h / 2 - t));
            gfx.rect(-w / 2, b, Math.max(0, l + w / 2), t - b);
            gfx.rect(r, b, Math.max(0, w / 2 - r), t - b);
            gfx.fill();
            gfx.strokeColor = new Color(204, 238, 83); gfx.lineWidth = 3;
            gfx.rect(l, b, r - l, t - b); gfx.stroke();
            if (passTarget) {
                // 视觉高亮有留白，触摸只放行原按钮的真实矩形。
                const il = Math.max(-w / 2, hole.x + 12), ir = Math.min(w / 2, hole.xMax - 12);
                const ib = Math.max(-h / 2, hole.y + 12), it = Math.min(h / 2, hole.yMax - 12);
                this.setInputBlock(0, -w / 2, -h / 2, w, ib + h / 2);
                this.setInputBlock(1, -w / 2, it, w, h / 2 - it);
                this.setInputBlock(2, -w / 2, ib, il + w / 2, it - ib);
                this.setInputBlock(3, ir, ib, w / 2 - ir, it - ib);
                // 欢迎卡避开真实按钮；窄屏放不下时在可用区域等比缩放。
                const margin = 24 * scale, gap = 24 * scale;
                const above = h / 2 - margin - t - gap;
                const below = b + h / 2 - margin - gap;
                const cardScale = Math.min(scale, Math.max(0, above, below) / height);
                const placeAbove = above >= height * cardScale;
                const halfWidth = width * cardScale / 2, halfHeight = height * cardScale / 2;
                const px = Math.max(-w / 2 + margin + halfWidth,
                    Math.min(w / 2 - margin - halfWidth, (l + r) / 2));
                this.panel.setScale(cardScale, cardScale, 1);
                this.panel.setPosition(px, placeAbove ? t + gap + halfHeight : b - gap - halfHeight);
            }
        } else { gfx.rect(-w / 2, -h / 2, w, h); gfx.fill(); }
    }
    hide(): void { if (this.root.isValid) this.root.active = false; }
    dispose(): void {
        view.off('canvas-resize', this.resize);
        view.off('design-resolution-changed', this.resize);
        if (this.root.isValid) this.root.destroy();
    }
}
