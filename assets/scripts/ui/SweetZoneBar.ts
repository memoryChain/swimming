import { Color, Graphics, Label, Node, UITransform } from 'cc';
import { Rating } from '../core/GameConstants';
import type { StrokeTimingGuide } from '../swimmer/SwimmerMotor';
import { makeUiNode } from './RuntimeUiFactory';

// Circular debug dial visualizing the arm-stroke release-timing sweet zone.
// The ring represents one full pull cycle. The pointer starts at the 3 o'clock
// direction (matching the character's hand at cycle 0) and sweeps clockwise as
// the stroke progresses. Colored arcs show where BAD / GOOD / PERFECT releases
// land. Debug-only: it makes the redesign's hidden timing readable while tuning.
const DIAL_OUTER_RADIUS = 56;
const DIAL_RING_WIDTH = 26;
const DIAL_INNER_RADIUS = DIAL_OUTER_RADIUS - DIAL_RING_WIDTH;
const DIAL_BOX = DIAL_OUTER_RADIUS * 2 + 12;
const ARC_STEPS = 48;
const SPEED_LABEL_WIDTH = 200;
const SPEED_LABEL_HEIGHT = 34;

const COLOR_BG = new Color(20, 26, 34, 210);
const COLOR_BAD = new Color(150, 60, 66, 150);
const COLOR_GOOD = new Color(70, 170, 200, 200);
const COLOR_PERFECT = new Color(255, 205, 70, 235);
const COLOR_MARKER = new Color(255, 255, 255, 245);
const COLOR_MARKER_BACK = new Color(0, 0, 0, 190);
const COLOR_MARKER_IDLE = new Color(150, 160, 170, 130);
const COLOR_SPEED = new Color(255, 255, 255, 255);

export class SweetZoneBar {
    private _root: Node = null;
    private _bandGfx: Graphics = null;
    private _markerGfx: Graphics = null;
    private _speedLabel: Label = null;
    private _lastSignature = '';
    private _tag = '';
    private _showSpeed = true;
    // Swim direction sign: +1 outbound (hand starts at 3 o'clock, sweeps CW),
    // -1 after a lap turn (hand starts at 9 o'clock, sweeps CCW). Mirrors the dial
    // so the pointer matches the character's hand once they fold back.
    private _direction = 1;

    // `tag` prefixes the speed readout (e.g. "AI") so multiple dials are
    // distinguishable when both the player and an opponent dial are on screen.
    // `showSpeed=false` shows just the static tag (used by the second per-hand dial
    // so the swimmer's speed isn't printed twice).
    build(parent: Node, x: number, y: number, tag = '', showSpeed = true) {
        this._tag = tag;
        this._showSpeed = showSpeed;
        this._root = makeUiNode('SweetZoneDial', parent);
        this._root.setPosition(x, y, 0);

        const speedNode = makeUiNode('SweetZoneSpeedLabel', this._root);
        speedNode.setPosition(0, DIAL_OUTER_RADIUS + SPEED_LABEL_HEIGHT / 2 + 6, 0);
        speedNode.getComponent(UITransform).setContentSize(SPEED_LABEL_WIDTH, SPEED_LABEL_HEIGHT);
        this._speedLabel = speedNode.addComponent(Label);
        this._speedLabel.string = showSpeed ? (tag ? `${tag} 0.00 m/s` : 'SPD 0.00 m/s') : tag;
        this._speedLabel.fontSize = 26;
        this._speedLabel.lineHeight = 32;
        this._speedLabel.color = COLOR_SPEED;
        this._speedLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        this._speedLabel.verticalAlign = Label.VerticalAlign.CENTER;

        const bandNode = makeUiNode('SweetZoneBands', this._root);
        bandNode.getComponent(UITransform).setContentSize(DIAL_BOX, DIAL_BOX);
        this._bandGfx = bandNode.addComponent(Graphics);

        const markerNode = makeUiNode('SweetZoneMarker', this._root);
        markerNode.getComponent(UITransform).setContentSize(DIAL_BOX, DIAL_BOX);
        this._markerGfx = markerNode.addComponent(Graphics);

        this.setVisible(false);
    }

    setVisible(visible: boolean) {
        if (this._root) {
            this._root.active = visible;
        }
    }

    // Redraw from the current stroke timing guide. Bands are only redrawn when
    // the zone layout (or swim direction) actually changes; the pointer follows
    // every frame while a stroke is active. `direction` is the swimmer's current
    // course direction (>=0 outbound, <0 folded back).
    update(guide: StrokeTimingGuide | null, speed = 0, direction = 1) {
        if (!this._bandGfx || !this._markerGfx) {
            return;
        }
        this._direction = direction < 0 ? -1 : 1;
        if (this._speedLabel && this._showSpeed) {
            const prefix = this._tag || 'SPD';
            this._speedLabel.string = `${prefix} ${Math.max(0, speed).toFixed(2)} m/s`;
        }
        const intervals = guide?.intervals ?? [];
        const signature = `${this._direction}|` + intervals.map((i) => `${i.rating}:${i.startRatio.toFixed(3)}-${i.endRatio.toFixed(3)}`).join('|');
        if (signature !== this._lastSignature) {
            this._lastSignature = signature;
            this.drawBands(intervals);
        }
        this.drawMarker(guide);
    }

    private drawBands(intervals: { rating: Rating; startRatio: number; endRatio: number }[]) {
        const g = this._bandGfx;
        g.clear();
        // Background ring (full circle donut).
        g.fillColor = COLOR_BG;
        this.fillRingSegment(g, 0, 1);
        if (intervals.length === 0) {
            return;
        }
        for (const interval of intervals) {
            const color = interval.rating === Rating.PERFECT
                ? COLOR_PERFECT
                : interval.rating === Rating.GOOD
                    ? COLOR_GOOD
                    : COLOR_BAD;
            const start = clamp01(interval.startRatio);
            const end = clamp01(interval.endRatio);
            if (end - start <= 0) {
                continue;
            }
            g.fillColor = color;
            this.fillRingSegment(g, start, end, 2);
        }
    }

    private drawMarker(guide: StrokeTimingGuide | null) {
        const g = this._markerGfx;
        g.clear();
        const active = !!guide?.active;
        const ratio = clamp01(guide?.currentRatio ?? 0);
        const angle = this.angleForRatio(ratio);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const tipR = DIAL_OUTER_RADIUS + 3;
        const baseR = DIAL_INNER_RADIUS - 3;

        // Pointer needle spanning the ring band at the current cycle angle.
        g.strokeColor = COLOR_MARKER_BACK;
        g.lineWidth = active ? 9 : 5;
        g.moveTo(baseR * cos, baseR * sin);
        g.lineTo(tipR * cos, tipR * sin);
        g.stroke();
        g.strokeColor = active ? COLOR_MARKER : COLOR_MARKER_IDLE;
        g.lineWidth = active ? 6 : 3;
        g.moveTo(baseR * cos, baseR * sin);
        g.lineTo(tipR * cos, tipR * sin);
        g.stroke();
    }

    // Fill a donut wedge between two cycle ratios by sampling points along the
    // outer then inner radius. `inset` shrinks the band slightly so the colored
    // zones sit just inside the background ring rim.
    private fillRingSegment(g: Graphics, startRatio: number, endRatio: number, inset = 0) {
        const outer = DIAL_OUTER_RADIUS - inset;
        const inner = DIAL_INNER_RADIUS + inset;
        const a0 = this.angleForRatio(startRatio);
        const a1 = this.angleForRatio(endRatio);
        const first = anglePoint(outer, a0);
        g.moveTo(first.x, first.y);
        for (let i = 1; i <= ARC_STEPS; i++) {
            const a = a0 + (a1 - a0) * (i / ARC_STEPS);
            const p = anglePoint(outer, a);
            g.lineTo(p.x, p.y);
        }
        for (let i = ARC_STEPS; i >= 0; i--) {
            const a = a0 + (a1 - a0) * (i / ARC_STEPS);
            const p = anglePoint(inner, a);
            g.lineTo(p.x, p.y);
        }
        g.close();
        g.fill();
    }

    // Cycle ratio (0..1) → angle (standard math, y up). Outbound: 0 maps to 3
    // o'clock (+X) and progress sweeps clockwise. Folded back: mirrored across the
    // vertical axis — 0 maps to 9 o'clock (-X) and progress sweeps counter-
    // clockwise, matching the character's hand after the lap turn.
    private angleForRatio(ratio: number): number {
        if (this._direction < 0) {
            return Math.PI + ratio * Math.PI * 2;
        }
        return -ratio * Math.PI * 2;
    }
}

// Convert a polar angle (standard math, y up) at a given radius into a point.
function anglePoint(radius: number, angle: number): { x: number; y: number } {
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

