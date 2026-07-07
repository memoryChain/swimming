import { Color, Graphics, Label, Node, UITransform } from 'cc';
import { makeLabel, makeRect, makeUiNode, uiColor } from './RuntimeUiFactory';

export type AiDifficultyEntry = {
    lane: number;      // 0-based lane index
    name: string;      // display name
    difficulty: number; // 0..1
};

const PANEL_WIDTH = 300;
const ROW_HEIGHT = 28;
const TITLE_HEIGHT = 26;
const BAR_WIDTH = 96;
const BAR_HEIGHT = 12;

// Compact toggleable panel that lists each AI lane's difficulty as a value plus a
// color-graded bar (green = easy, red = hard). Difficulty is static per race, so
// rows are rebuilt only when the AI roster changes (populate); no per-frame work.
export class AiDifficultyPanel {
    private _root: Node | null = null;
    private _rowsHost: Node | null = null;
    private _emptyLabel: Label | null = null;
    private _visible = false;

    build(parent: Node, w: number, h: number) {
        const root = makeUiNode('AiDifficultyPanel', parent);
        // Top-left of the canvas (origin at center).
        root.setPosition(-w / 2 + PANEL_WIDTH / 2 + 24, h / 2 - 120, 0);
        makeRect('Back', root, PANEL_WIDTH, 320, uiColor(0, 0, 0, 200));
        makeLabel('Title', root, 'AI 难度', 18, uiColor(255, 224, 89)).setPosition(0, 138, 0);
        const rowsHost = makeUiNode('Rows', root);
        rowsHost.setPosition(0, 118, 0);
        const emptyNode = makeLabel('Empty', root, '无 AI 对手', 15, uiColor(180, 200, 210));
        emptyNode.setPosition(0, 60, 0);
        this._emptyLabel = emptyNode.getComponent(Label);
        this._root = root;
        this._rowsHost = rowsHost;
        this.applyVisible();
    }

    // Rebuild one row per AI, sorted by lane. Called whenever the roster changes.
    populate(entries: AiDifficultyEntry[]) {
        if (!this._rowsHost) {
            return;
        }
        this._rowsHost.removeAllChildren();
        const sorted = entries.slice().sort((a, b) => a.lane - b.lane);
        if (this._emptyLabel) {
            this._emptyLabel.node.active = sorted.length === 0;
        }
        for (let i = 0; i < sorted.length; i++) {
            this.buildRow(sorted[i], i);
        }
        this.resizeBack(sorted.length);
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

    private buildRow(entry: AiDifficultyEntry, index: number) {
        if (!this._rowsHost) {
            return;
        }
        const row = makeUiNode(`Row${index}`, this._rowsHost);
        row.setPosition(0, -index * ROW_HEIGHT, 0);

        const label = makeLabel('Label', row, `泳道${entry.lane + 1}  ${entry.name}`, 15, uiColor(235, 246, 250));
        label.getComponent(UITransform).setContentSize(150, ROW_HEIGHT);
        label.getComponent(Label).horizontalAlign = Label.HorizontalAlign.LEFT;
        label.setPosition(-PANEL_WIDTH / 2 + 84, 0, 0);

        const tierColor = difficultyColor(entry.difficulty);
        // Bar track + graded fill.
        const trackX = PANEL_WIDTH / 2 - BAR_WIDTH / 2 - 58;
        makeRect('Track', row, BAR_WIDTH, BAR_HEIGHT, uiColor(40, 48, 56, 220)).setPosition(trackX, 0, 0);
        const fill = makeUiNode('Fill', row);
        fill.getComponent(UITransform).setContentSize(BAR_WIDTH, BAR_HEIGHT);
        fill.setPosition(trackX, 0, 0);
        const gfx = fill.addComponent(Graphics);
        const ratio = Math.max(0, Math.min(1, entry.difficulty));
        gfx.fillColor = tierColor;
        gfx.rect(-BAR_WIDTH / 2, -BAR_HEIGHT / 2, BAR_WIDTH * ratio, BAR_HEIGHT);
        gfx.fill();

        const value = makeLabel('Value', row, entry.difficulty.toFixed(2), 15, tierColor);
        value.getComponent(UITransform).setContentSize(44, ROW_HEIGHT);
        value.getComponent(Label).horizontalAlign = Label.HorizontalAlign.RIGHT;
        value.setPosition(PANEL_WIDTH / 2 - 26, 0, 0);
    }

    private resizeBack(rowCount: number) {
        if (!this._root) {
            return;
        }
        const back = this._root.getChildByName('Back');
        if (!back) {
            return;
        }
        const height = TITLE_HEIGHT + 16 + Math.max(1, rowCount) * ROW_HEIGHT + 16;
        const gfx = back.getComponent(Graphics);
        if (gfx) {
            gfx.clear();
            gfx.fillColor = uiColor(0, 0, 0, 200);
            gfx.rect(-PANEL_WIDTH / 2, -height / 2, PANEL_WIDTH, height);
            gfx.fill();
        }
        back.getComponent(UITransform)?.setContentSize(PANEL_WIDTH, height);
        // Keep the title/rows pinned to the top as the panel grows downward.
        back.setPosition(0, 138 + TITLE_HEIGHT / 2 - height / 2 + 4, 0);
    }

    private applyVisible() {
        if (this._root) {
            this._root.active = this._visible;
        }
    }
}

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
