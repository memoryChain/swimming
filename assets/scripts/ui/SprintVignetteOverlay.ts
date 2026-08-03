import { Color, Graphics, Node, Tween, tween, UIOpacity, UITransform, view } from 'cc';
import { makeUiNode } from './RuntimeUiFactory';

// Warm radial vignette for the sprint phase that behaves like a tide:
//   - Entering: the transparent centre shrinks, so the warm rings sweep IN from
//     the screen edge toward the centre, growing stronger until full.
//   - Leaving:  the transparent centre grows back, so the rings RETREAT from the
//     centre out to the edge and vanish - instead of a flat opacity fade.
// `reveal` (0..1) drives the inner radius; the overlay redraws each frame while
// a reveal tween runs. Graphics does not intercept touch events.
const VIGNETTE_COLOR = new Color(255, 110, 40, 255);
const ACTIVE_OPACITY = 80;
const INNER_RADIUS_RATIO = 0.42;
// 32 translucent rings are enough at mobile resolution. Quantizing the reveal
// animation prevents a full Graphics mesh rebuild on every 60/120Hz render frame.
const RING_COUNT = 32;
const REVEAL_DRAW_STEPS = 30;
const ENTER_SECONDS = 1.0;
const EXIT_SECONDS = 1.3;

export class SprintVignetteOverlay {
    private _root: Node | null = null;
    private _graphics: Graphics | null = null;
    private _opacity: UIOpacity | null = null;
    private _width = 0;
    private _height = 0;
    private _reveal = 0;
    private _revealTween: { value: number } | null = null;
    private _requestedActive = false;
    private _drawStep = -1;
    private readonly _stroke = new Color();

    bind(hud: Node) {
        if (!hud?.isValid || this._root?.isValid) {
            return;
        }
        this._root = makeUiNode('SprintVignette', hud);
        this._root.setSiblingIndex(0);
        this._opacity = this._root.addComponent(UIOpacity);
        this._opacity.opacity = 0;
        this._graphics = this._root.addComponent(Graphics);
        this.resize();
        this._root.active = false;
    }

    setActive(active: boolean) {
        if (!this._root?.isValid || !this._opacity) {
            return;
        }
        if (active === this._requestedActive) {
            return;
        }
        this._requestedActive = active;
        if (this._revealTween) {
            Tween.stopAllByTarget(this._revealTween);
            this._revealTween = null;
        }
        if (active) {
            this._root.active = true;
            this.resize();
            this._opacity.opacity = ACTIVE_OPACITY;
            const counter = { value: this._reveal };
            this._revealTween = counter;
            tween(counter)
                .to(ENTER_SECONDS, { value: 1 }, {
                    onUpdate: () => {
                        this._reveal = counter.value;
                        this.draw();
                    },
                    onComplete: () => {
                        this._revealTween = null;
                    },
                })
                .start();
        } else {
            const counter = { value: this._reveal };
            this._revealTween = counter;
            tween(counter)
                .to(EXIT_SECONDS, { value: 0 }, {
                    onUpdate: () => {
                        this._reveal = counter.value;
                        this.draw();
                    },
                    onComplete: () => {
                        this._revealTween = null;
                        this._reveal = 0;
                        this._graphics?.clear();
                        this._drawStep = -1;
                        if (this._root?.isValid) {
                            this._root.active = false;
                        }
                    },
                })
                .start();
        }
    }

    private resize() {
        const size = view.getVisibleSize();
        if (size.width === this._width && size.height === this._height) {
            return;
        }
        this._width = size.width;
        this._height = size.height;
        this._root?.getComponent(UITransform)?.setContentSize(size.width, size.height);
        this._drawStep = -1;
        this.draw();
    }

    private draw() {
        const graphics = this._graphics;
        if (!graphics || this._width <= 0 || this._height <= 0) {
            return;
        }
        const drawStep = Math.round(Math.max(0, Math.min(1, this._reveal)) * REVEAL_DRAW_STEPS);
        if (drawStep === this._drawStep) {
            return;
        }
        this._drawStep = drawStep;
        graphics.clear();
        if (drawStep <= 0) {
            return;
        }
        const reveal = drawStep / REVEAL_DRAW_STEPS;
        const halfWidth = this._width * 0.5;
        const halfHeight = this._height * 0.5;
        const maxRadius = Math.sqrt(halfWidth * halfWidth + halfHeight * halfHeight);
        const targetInner = maxRadius * INNER_RADIUS_RATIO;
        // reveal 0 -> innerRadius == maxRadius (no rings visible); 1 -> innerRadius
        // == targetInner (full vignette). Entering shrinks innerRadius so rings
        // sweep in from the edge; leaving grows it back so they retreat out.
        const innerRadius = maxRadius + (targetInner - maxRadius) * reveal;
        const span = maxRadius - innerRadius;
        if (span <= 0) {
            return;
        }
        const ringWidth = span / RING_COUNT;
        graphics.lineWidth = ringWidth + 1;
        for (let i = 0; i < RING_COUNT; i++) {
            const r = innerRadius + (i + 0.5) * ringWidth;
            const norm = i / (RING_COUNT - 1);
            const alpha = Math.round(255 * smoothstep(norm));
            if (alpha <= 0) {
                continue;
            }
            this._stroke.set(VIGNETTE_COLOR.r, VIGNETTE_COLOR.g, VIGNETTE_COLOR.b, alpha);
            graphics.strokeColor = this._stroke;
            graphics.circle(0, 0, r);
            graphics.stroke();
        }
    }
}

function smoothstep(t: number): number {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
}
