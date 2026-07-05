import { Color, Graphics, Node, UITransform } from 'cc';
import { Rating } from '../core/GameConstants';
import type { StrokeTimingGuide } from '../swimmer/SwimmerMotor';
import { makeUiNode } from './RuntimeUiFactory';

// Horizontal debug bar visualizing the arm-stroke release-timing sweet zone.
// The x axis is pull-arc progress (0..1 of a full cycle). Colored bands show
// where BAD / GOOD / PERFECT releases land; a moving marker tracks the current
// stroke's pull progress so you can see exactly where you release. Debug-only:
// it makes the redesign's hidden timing readable while tuning feel.
const BAR_WIDTH = 360;
const BAR_HEIGHT = 26;

const COLOR_BG = new Color(20, 26, 34, 210);
const COLOR_BAD = new Color(150, 60, 66, 150);
const COLOR_GOOD = new Color(70, 170, 200, 200);
const COLOR_PERFECT = new Color(255, 205, 70, 235);
const COLOR_MARKER = new Color(255, 255, 255, 245);
const COLOR_MARKER_IDLE = new Color(150, 160, 170, 130);

export class SweetZoneBar {
    private _root: Node = null;
    private _bandGfx: Graphics = null;
    private _markerGfx: Graphics = null;
    private _lastSignature = '';

    build(parent: Node, x: number, y: number) {
        this._root = makeUiNode('SweetZoneBar', parent);
        this._root.setPosition(x, y, 0);

        const bandNode = makeUiNode('SweetZoneBands', this._root);
        bandNode.getComponent(UITransform).setContentSize(BAR_WIDTH, BAR_HEIGHT);
        this._bandGfx = bandNode.addComponent(Graphics);

        const markerNode = makeUiNode('SweetZoneMarker', this._root);
        markerNode.getComponent(UITransform).setContentSize(BAR_WIDTH, BAR_HEIGHT);
        this._markerGfx = markerNode.addComponent(Graphics);

        this.setVisible(false);
    }

    setVisible(visible: boolean) {
        if (this._root) {
            this._root.active = visible;
        }
    }

    // Redraw from the current stroke timing guide. Bands are only redrawn when
    // the zone layout actually changes (cheap steady-state); the marker follows
    // every frame while a stroke is active.
    update(guide: StrokeTimingGuide | null) {
        if (!this._bandGfx || !this._markerGfx) {
            return;
        }
        const intervals = guide?.intervals ?? [];
        const signature = intervals.map((i) => `${i.rating}:${i.startRatio.toFixed(3)}-${i.endRatio.toFixed(3)}`).join('|');
        if (signature !== this._lastSignature) {
            this._lastSignature = signature;
            this.drawBands(intervals);
        }
        this.drawMarker(guide);
    }

    private drawBands(intervals: { rating: Rating; startRatio: number; endRatio: number }[]) {
        const g = this._bandGfx;
        g.clear();
        // Background track.
        g.fillColor = COLOR_BG;
        g.roundRect(-BAR_WIDTH / 2, -BAR_HEIGHT / 2, BAR_WIDTH, BAR_HEIGHT, 4);
        g.fill();
        if (intervals.length === 0) {
            return;
        }
        for (const interval of intervals) {
            const color = interval.rating === Rating.PERFECT
                ? COLOR_PERFECT
                : interval.rating === Rating.GOOD
                    ? COLOR_GOOD
                    : COLOR_BAD;
            const x0 = -BAR_WIDTH / 2 + clamp01(interval.startRatio) * BAR_WIDTH;
            const x1 = -BAR_WIDTH / 2 + clamp01(interval.endRatio) * BAR_WIDTH;
            const w = Math.max(0, x1 - x0);
            if (w <= 0) {
                continue;
            }
            g.fillColor = color;
            g.rect(x0, -BAR_HEIGHT / 2 + 2, w, BAR_HEIGHT - 4);
            g.fill();
        }
    }

    private drawMarker(guide: StrokeTimingGuide | null) {
        const g = this._markerGfx;
        g.clear();
        const active = !!guide?.active;
        const ratio = clamp01(guide?.currentRatio ?? 0);
        const x = -BAR_WIDTH / 2 + ratio * BAR_WIDTH;
        g.strokeColor = active ? COLOR_MARKER : COLOR_MARKER_IDLE;
        g.lineWidth = active ? 4 : 2;
        g.moveTo(x, -BAR_HEIGHT / 2 - 3);
        g.lineTo(x, BAR_HEIGHT / 2 + 3);
        g.stroke();
    }
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}
