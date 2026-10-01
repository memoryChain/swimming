import { Color, Node, Sprite, UITransform } from 'cc';
import { Rating } from '../core/GameConstants';
import type { StrokeTimingGuide } from '../swimmer/SwimmerMotor';

const EMPTY_COLOR = new Color(255, 82, 91, 180);
const BAD_COLOR = new Color(255, 82, 91, 190);
const GOOD_COLOR = new Color(76, 216, 235, 225);
const PERFECT_COLOR = new Color(255, 214, 64, 245);

/** 旧调试甜区条：隐藏不读选手；30Hz、读数复用，样式及位置按变化写入。 */
export class StrokeTimingDebugView {
    private readonly sprite: Sprite | null;
    private readonly guide: StrokeTimingGuide = {
        active: false, currentRatio: 0, holdSeconds: 0, actionSeconds: 0,
        minHoldRatio: 0, intervals: [],
    };
    private elapsed = 0;
    private visible = false;
    private displayedRating: Rating | null | undefined;
    private markerY = NaN;

    constructor(private readonly fill: Node, private readonly marker: Node | null) {
        this.sprite = fill.getComponent(Sprite);
        const transform = fill.getComponent(UITransform);
        if (transform && transform.contentSize.height !== 216) transform.setContentSize(transform.contentSize.width, 216);
        if (fill.position.y !== -3) fill.setPosition(fill.position.x, -3, fill.position.z);
    }

    update(dt: number, visible: boolean,
        source: { fillStrokeTimingGuide(target: StrokeTimingGuide): StrokeTimingGuide }) {
        if (!visible || !this.fill.activeInHierarchy) {
            if (this.marker?.active) this.marker.active = false;
            this.elapsed = 0;
            this.visible = false;
            return;
        }
        this.elapsed += Math.max(0, dt);
        if (this.visible && this.elapsed < 1 / 30) return;
        this.visible = true;
        this.elapsed %= 1 / 30;
        const guide = source.fillStrokeTimingGuide(this.guide);
        let rating: Rating | null = guide.intervals.length > 0 ? Rating.BAD : null;
        for (const interval of guide.intervals) {
            if (interval.rating === Rating.PERFECT) { rating = Rating.PERFECT; break; }
            if (interval.rating === Rating.GOOD) rating = Rating.GOOD;
        }
        if (rating !== this.displayedRating) {
            this.displayedRating = rating;
            if (this.sprite) this.sprite.color = rating === Rating.PERFECT ? PERFECT_COLOR
                : rating === Rating.GOOD ? GOOD_COLOR : rating === null ? EMPTY_COLOR : BAD_COLOR;
        }
        if (this.marker) {
            if (this.marker.active !== guide.active) this.marker.active = guide.active;
            if (guide.active) {
                const y = Math.round(-108 + Math.max(0, Math.min(1, guide.currentRatio)) * 216);
                if (y !== this.markerY) {
                    this.markerY = y;
                    this.marker.setPosition(this.marker.position.x, y, 0);
                }
            }
        }
    }
}
