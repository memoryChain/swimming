import { Label, Node } from 'cc';

export class DebugLogController {
    private _panel: Node | null = null;
    private _label: Label | null = null;
    private readonly _lines: string[] = [];
    private _visible = false;

    constructor(
        private readonly _prefix = '[SpeedSwimming]',
        private readonly _maxLines = 9,
    ) {}

    bind(panel: Node, label: Label) {
        this._panel = panel;
        this._label = label;
        this.syncPanel();
        this.syncLabel();
    }

    log(message: string) {
        console.log(`${this._prefix} ${message}`);
        this._lines.push(message);
        if (this._lines.length > this._maxLines) {
            this._lines.shift();
        }
        this.syncLabel();
    }

    toggle(): boolean {
        this._visible = !this._visible;
        this.syncPanel();
        this.log(`debug=${this._visible ? 'on' : 'off'}`);
        return this._visible;
    }

    get visible(): boolean {
        return this._visible;
    }

    private syncPanel() {
        if (this._panel) {
            this._panel.active = this._visible;
        }
    }

    private syncLabel() {
        if (this._label) {
            this._label.string = this._lines.join('\n');
        }
    }
}
