import { Color, Label, LabelOutline, Node, UIOpacity, UITransform } from 'cc';
import { makeLabel, makeUiNode } from './RuntimeUiFactory';

// One stable, event-driven banner for shark state changes. It deliberately does
// not animate or redraw every frame; update() merely hides it once its deadline
// passes, keeping race HUD work negligible on iOS WeChat.
export class SharkEventBanner {
    private _root: Node | null = null;
    private _label: Label | null = null;
    private _until = 0;
    private _text = '';
    private readonly _queue: { text: string; color: Color; durationMs: number }[] = [];

    bind(hud: Node): void {
        if (this._root?.isValid || !hud?.isValid) return;
        // Matches the old shark alert treatment: large heavy type with a dark
        // outline, rather than an ordinary compact HUD label.
        const root = makeUiNode('SharkEventBanner', hud);
        root.getComponent(UITransform)!.setContentSize(720, 120);
        root.setPosition(0, 210, 0);
        root.addComponent(UIOpacity).opacity = 255;
        const labelNode = makeLabel('Label', root, '', 40, new Color(255, 200, 100, 255));
        labelNode.getComponent(UITransform)!.setContentSize(720, 100);
        const label = labelNode.getComponent(Label)!;
        label.isBold = true;
        label.lineHeight = 50;
        const outline = labelNode.addComponent(LabelOutline);
        outline.color = new Color(6, 16, 30, 235);
        outline.width = 6;
        this._root = root;
        this._label = label;
        root.active = false;
    }

    show(text: string, color: Color, durationMs: number): void {
        this._queue.length = 0;
        this.present(text, color, durationMs);
    }

    // Used for a consequence that must follow the current alert (for example,
    // "XX was taken" followed by the shark's withdrawal). Event-only, so the
    // tiny queue creates no race-frame churn.
    enqueue(text: string, color: Color, durationMs: number): void {
        const root = this._root;
        if (!root?.isValid) return;
        if (!root.active) {
            this.present(text, color, durationMs);
            return;
        }
        this._queue.push({ text, color, durationMs: Math.max(0, durationMs) });
    }

    private present(text: string, color: Color, durationMs: number): void {
        const root = this._root;
        const label = this._label;
        if (!root?.isValid || !label) return;
        if (label.string !== text) label.string = text;
        // Event-only assignment; Color is not mutated elsewhere on this label.
        if (label.color.r !== color.r || label.color.g !== color.g || label.color.b !== color.b || label.color.a !== color.a) {
            label.color = color;
        }
        if (!root.active) root.active = true;
        this._text = text;
        this._until = Date.now() + Math.max(0, durationMs);
    }

    update(): void {
        const root = this._root;
        if (!root?.active || Date.now() < this._until) return;
        const next = this._queue.shift();
        if (next) {
            this.present(next.text, next.color, next.durationMs);
            return;
        }
        root.active = false;
        this._text = '';
    }

    hide(): void {
        if (this._root?.active) this._root.active = false;
        this._until = 0;
        this._text = '';
        this._queue.length = 0;
    }
}
