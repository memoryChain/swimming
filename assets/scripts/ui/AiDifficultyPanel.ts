import { BlockInputEvents, Color, Graphics, Label, Node, UITransform, sys, view } from 'cc';
import { makeButton, makeLabel, makeRect, makeUiNode, uiColor } from './RuntimeUiFactory';
import type { AISwimmerController } from '../entity/AISwimmerController';
import { intelligenceForDifficulty } from '../competitor/AiRaceConfig';
import { styleProjectUiLabel } from './ProjectUiFonts';

export type AiDifficultyEntry = {
    lane: number;      // 0-based lane index
    name: string;      // display name
    difficulty: number; // 0..1
};

const PANEL_WIDTH = 360;
const ROW_HEIGHT = 22;
const BAR_WIDTH = 60;
const BAR_HEIGHT = 12;

// Compact toggleable panel that lists each AI lane's difficulty as a value plus a
// color-graded bar (green = easy, red = hard). Difficulty is static per race, so
// rows are rebuilt only when the AI roster changes (populate); no per-frame work.
export class AiDifficultyPanel {
    private _root: Node | null = null;
    private _content: Node | null = null;
    private _expandButton: Node | null = null;
    private _collapsed = true;
    private _rowsHost: Node | null = null;
    private _emptyLabel: Label | null = null;
    private _visible = false;
    private _signature = '';
    private _debugLabel: Label | null = null;
    private _debugController: AISwimmerController | null = null;
    private _debugClock = 0;
    private _rowCount = 0;

    build(parent: Node, w: number, h: number) {
        const host = makeUiNode('AiDifficultyPanel', parent);
        const root = makeUiNode('Content', host);
        this._content = root;
        makeRect('Back', root, PANEL_WIDTH, 120, uiColor(0, 0, 0, 200));
        const title = makeLabel('Title', root, 'AI 角色与智力', 18, uiColor(255, 224, 89));
        title.setPosition(-40, -18, 0);
        title.getComponent(UITransform).setContentSize(PANEL_WIDTH - 104, 26);
        styleProjectUiLabel(title.getComponent(Label), 'semibold', 24);
        const collapse = makeButton('Collapse', root, 76, 36, uiColor(40, 96, 168, 235), '收起');
        collapse.setPosition(PANEL_WIDTH / 2 - 42, -20, 0);
        collapse.addComponent(BlockInputEvents);
        collapse.on(Node.EventType.TOUCH_END, () => this.setCollapsed(true));
        const expand = makeButton('Expand', host, 164, 40, uiColor(40, 96, 168, 235), 'AI 信息 · 展开');
        expand.setPosition(-PANEL_WIDTH / 2 + 82, -20, 0);
        expand.addComponent(BlockInputEvents);
        expand.on(Node.EventType.TOUCH_END, () => this.setCollapsed(false));
        this._expandButton = expand;
        styleProjectUiLabel(collapse.getChildByName('Label').getComponent(Label), 'semibold', 24);
        styleProjectUiLabel(expand.getChildByName('Label').getComponent(Label), 'semibold', 24);
        const rowsHost = makeUiNode('Rows', root);
        rowsHost.setPosition(0, -48, 0);
        const emptyNode = makeLabel('Empty', root, '无 AI 对手', 15, uiColor(180, 200, 210));
        emptyNode.setPosition(0, -48, 0);
        emptyNode.getComponent(UITransform).setContentSize(PANEL_WIDTH - 24, ROW_HEIGHT);
        styleProjectUiLabel(emptyNode.getComponent(Label), 'regular', ROW_HEIGHT);
        this._emptyLabel = emptyNode.getComponent(Label);
        this._root = host;
        this._rowsHost = rowsHost;
        this._debugLabel = makeLabel('Decision', root, '', 16, uiColor(220, 235, 245)).getComponent(Label);
        this._debugLabel.node.getComponent(UITransform).setContentSize(PANEL_WIDTH - 24, 56);
        styleProjectUiLabel(this._debugLabel, 'regular', 24);
        this._debugLabel.node.active = false;
        // 与正式 HUD 使用同一安全区缩放：避开左侧读数、顶部进度和下方手掌弧线。
        let lastX = NaN, lastY = NaN, lastScale = NaN;
        const layout = () => {
            const size = view.getVisibleSize(), safe = sys.getSafeAreaRect(false);
            const left = Math.max(0, safe.x), right = Math.max(0, size.width - safe.x - safe.width);
            const top = Math.max(0, size.height - safe.y - safe.height);
            const scale = Math.min(1, (size.width - left - right) / 1280, safe.height / 720);
            const x = -size.width / 2 + left + (244 + PANEL_WIDTH / 2) * scale;
            const y = size.height / 2 - top - 90 * scale;
            if (lastScale !== scale) { host.setScale(scale, scale, 1); lastScale = scale; }
            if (lastX !== x || lastY !== y) { host.setPosition(x, y, 0); lastX = x; lastY = y; }
        };
        layout();
        view.on('canvas-resize', layout);
        view.on('design-resolution-changed', layout);
        host.once(Node.EventType.NODE_DESTROYED, () => {
            view.off('canvas-resize', layout);
            view.off('design-resolution-changed', layout);
        });
        this.resizeBack(0);
        this.applyCollapsed();
        this.applyVisible();
    }

    // Rebuild one row per AI, sorted by lane. Called whenever the roster changes.
    populate(entries: AiDifficultyEntry[]) {
        if (!this._rowsHost) {
            return;
        }
        const signature = entries.map(e => `${e.lane}:${e.name}:${e.difficulty}`).join('|');
        if (signature === this._signature) return;
        this._signature = signature;
        // 只有阵容身份改变时重建行，并显式销毁原行的所有组件。
        for (const child of this._rowsHost.children.slice()) child.destroy();
        const sorted = entries.slice().sort((a, b) => a.lane - b.lane);
        if (this._emptyLabel) {
            this._emptyLabel.node.active = sorted.length === 0;
        }
        for (let i = 0; i < sorted.length; i++) {
            this.buildRow(sorted[i], i);
        }
        this._rowCount = sorted.length;
        this.resizeBack(sorted.length);
    }

    setDebugController(controller: AISwimmerController | null) {
        if (this._debugController === controller) return;
        this._debugController = controller;
        this._debugClock = 0.2;
        if (this._debugLabel && this._debugLabel.node.active !== !!controller) this._debugLabel.node.active = !!controller;
        this.resizeBack(this._rowCount);
    }

    update(dt: number) {
        if (this._collapsed || !this._root?.activeInHierarchy || !this._debugController || !this._debugLabel) return;
        this._debugClock += dt;
        if (this._debugClock < 0.2) return;
        this._debugClock = 0;
        const s = this._debugController.debugSnapshot();
        const action = ACTION_LABELS[s.action];
        const value = `${action}  预算 ${s.desiredEnergy.toFixed(0)}  冲刺预留 ${s.sprintReserve.toFixed(0)}\n`
            + `踢腿 ${s.kickSeconds.toFixed(1)}秒  海豚跳 ${s.jumps}次`;
        if (this._debugLabel.string !== value) this._debugLabel.string = value;
    }

    setVisible(visible: boolean) {
        this._visible = visible;
        this.applyVisible();
    }

    toggle(): boolean {
        this._visible = !this._visible;
        this.applyVisible();
        return this._visible;
    }

    get visible(): boolean {
        return this._visible;
    }

    setCollapsed(collapsed: boolean) {
        if (this._collapsed === collapsed) return;
        this._collapsed = collapsed;
        this.applyCollapsed();
        if (!collapsed) {
            this._debugClock = 0.2;
            this.update(0);
        }
    }

    private applyCollapsed() {
        if (this._content && this._content.active === this._collapsed) this._content.active = !this._collapsed;
        if (this._expandButton && this._expandButton.active !== this._collapsed) this._expandButton.active = this._collapsed;
    }

    private buildRow(entry: AiDifficultyEntry, index: number) {
        if (!this._rowsHost) {
            return;
        }
        const row = makeUiNode(`Row${index}`, this._rowsHost);
        row.setPosition(0, -index * ROW_HEIGHT, 0);

        const label = makeLabel('Label', row, `泳道${entry.lane + 1}  ${entry.name}`, 15, uiColor(235, 246, 250));
        label.getComponent(UITransform).setContentSize(210, ROW_HEIGHT);
        label.getComponent(Label).horizontalAlign = Label.HorizontalAlign.LEFT;
        label.setPosition(-PANEL_WIDTH / 2 + 117, 0, 0);
        styleProjectUiLabel(label.getComponent(Label), 'regular', ROW_HEIGHT);

        const tierColor = difficultyColor(entry.difficulty);
        // Bar track + graded fill.
        const trackX = PANEL_WIDTH / 2 - BAR_WIDTH / 2 - 64;
        makeRect('Track', row, BAR_WIDTH, BAR_HEIGHT, uiColor(40, 48, 56, 220)).setPosition(trackX, 0, 0);
        const fill = makeUiNode('Fill', row);
        fill.getComponent(UITransform).setContentSize(BAR_WIDTH, BAR_HEIGHT);
        fill.setPosition(trackX, 0, 0);
        const gfx = fill.addComponent(Graphics);
        const ratio = Math.max(0, Math.min(1, entry.difficulty));
        gfx.fillColor = tierColor;
        gfx.rect(-BAR_WIDTH / 2, -BAR_HEIGHT / 2, BAR_WIDTH * ratio, BAR_HEIGHT);
        gfx.fill();

        const value = makeLabel('Value', row, intelligenceForDifficulty(entry.difficulty).label.replace('（测试）', ''), 15, tierColor);
        value.getComponent(UITransform).setContentSize(48, ROW_HEIGHT);
        value.getComponent(Label).horizontalAlign = Label.HorizontalAlign.RIGHT;
        value.setPosition(PANEL_WIDTH / 2 - 32, 0, 0);
        styleProjectUiLabel(value.getComponent(Label), 'semibold', ROW_HEIGHT);
    }

    private resizeBack(rowCount: number) {
        if (!this._root) {
            return;
        }
        const back = this._content?.getChildByName('Back');
        if (!back) {
            return;
        }
        const rows = Math.max(1, rowCount);
        const height = 50 + rows * ROW_HEIGHT + (this._debugController ? 72 : 0);
        this._debugLabel?.node.setPosition(0, -80 - rows * ROW_HEIGHT, 0);
        const gfx = back.getComponent(Graphics);
        if (gfx) {
            gfx.clear();
            gfx.fillColor = uiColor(0, 0, 0, 200);
            gfx.rect(-PANEL_WIDTH / 2, -height / 2, PANEL_WIDTH, height);
            gfx.fill();
        }
        back.getComponent(UITransform)?.setContentSize(PANEL_WIDTH, height);
        // Keep the title/rows pinned to the top as the panel grows downward.
        back.setPosition(0, -height / 2, 0);
    }

    private applyVisible() {
        if (this._root && this._root.active !== this._visible) {
            this._root.active = this._visible;
        }
    }
}

const ACTION_LABELS = { swim: '持续划水', recover: '降心率', save: '省体力', sprint: '冲刺', evade: '潜航避碰' };

// Green (easy) → yellow → red (hard) gradient across difficulty 0..1.
function difficultyColor(difficulty: number): Color {
    const d = Math.max(0, Math.min(1, difficulty));
    if (d < 0.5) {
        // green → yellow
        const t = d / 0.5;
        return uiColor(Math.round(120 + t * 135), 210, 90);
    }
    // yellow → red
    const t = (d - 0.5) / 0.5;
    return uiColor(255, Math.round(210 - t * 150), 80);
}
