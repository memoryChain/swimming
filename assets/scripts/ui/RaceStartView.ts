import { Color, Label, LabelOutline, Node, Sprite, SpriteFrame, Tween, tween, sys, UIOpacity, UITransform, view } from 'cc';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { loadAvatarUiSpriteFrame } from './AvatarUiAssets';
import { styleProjectUiLabel } from './ProjectUiFonts';

type AssetKey = keyof typeof RESOURCE_PATHS.raceStartUi;
type Cue = 'ready' | 'go' | 'late' | 'good' | 'great' | 'perfect';
const FRAMES = new Map<AssetKey, SpriteFrame>();
// 来自 PS 透明裁剪清单，坐标使用 1290×720 设计画布。
const CUES: Record<Cue, readonly [number, number, number, number]> = {
    ready: [457, 508, 377, 113], go: [579, 507, 203, 115],
    late: [400, 517, 490, 97], good: [391, 516, 507, 98],
    great: [373, 516, 542, 97], perfect: [334, 516, 622, 97],
};

export function preloadRaceStartUi(done: (error: Error | null) => void): void {
    const keys = Object.keys(RESOURCE_PATHS.raceStartUi) as AssetKey[];
    let remaining = keys.length;
    let failed: Error | null = null;
    for (const key of keys) {
        loadAvatarUiSpriteFrame(RESOURCE_PATHS.raceStartUi[key], (frame) => {
            if (frame) FRAMES.set(key, frame);
            else failed = new Error(`起跳 UI 素材加载失败：${key}`);
            if (--remaining === 0) done(failed);
        });
    }
}

function active(node: Node, value: boolean): void {
    if (node.active !== value) node.active = value;
}

/** 仅负责显示；输入、发令与判定继续由现有比赛流程驱动。 */
export class RaceStartView {
    private readonly root: Node;
    private readonly cueRoot: Node;
    private readonly chargeRoot: Node;
    private readonly cue: Sprite;
    private readonly hint: Node;
    private readonly opacity: UIOpacity;
    private readonly fill: Sprite;
    private readonly cap: Node;
    private current: Cue | null = null;
    private pending: Cue | null = null;
    private ratio = 0;
    private pixel = -1;
    private tier: AssetKey | null = null;
    private elapsed = 0;
    private chargePixelHeight = 233;

    constructor(parent: Node) {
        this.root = this.node(parent, 'RaceStartArt');
        this.cueRoot = this.node(this.root, 'Cue');
        this.chargeRoot = this.node(this.root, 'Charge');
        this.cue = this.sprite(this.cueRoot, 'ready', 457, 508, 377, 113);
        this.opacity = this.cue.node.addComponent(UIOpacity);
        this.hint = this.label(this.cueRoot, '长按蓄力，听令起跳', 645, 623.5, 300, 40, 21);
        this.sprite(this.chargeRoot, 'charge-track', 1155, 224, 100, 291);
        this.fill = this.sprite(this.chargeRoot, 'charge-fill-low', 1166, 269, 72, 233);
        this.fill.type = Sprite.Type.FILLED;
        this.fill.fillType = Sprite.FillType.VERTICAL;
        this.fill.fillStart = 0;
        this.fill.fillRange = 0;
        this.cap = this.sprite(this.chargeRoot, 'charge-cap', 1209, 276, 28, 8).node;
        this.label(this.chargeRoot, '松手起跳', 1132, 312, 100, 26, 16);
        this.label(this.chargeRoot, '蓄力', 1176, 531, 70, 32, 19);
        this.layout();
        view.on('canvas-resize', this.layout, this);
        view.on('design-resolution-changed', this.layout, this);
        this.reset();
    }

    private node(parent: Node, name: string): Node {
        const node = new Node(name);
        node.layer = parent.layer;
        node.setParent(parent);
        node.addComponent(UITransform);
        return node;
    }

    private sprite(parent: Node, key: AssetKey, x: number, y: number, w: number, h: number): Sprite {
        const node = this.node(parent, key);
        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.trim = false;
        sprite.spriteFrame = FRAMES.get(key)!;
        node.getComponent(UITransform)!.setContentSize(w, h);
        node.setPosition(x + w / 2 - 645, 360 - y - h / 2, 0);
        return sprite;
    }

    private label(parent: Node, text: string, x: number, y: number, w: number, h: number, size: number): Node {
        const node = this.node(parent, text);
        const label = node.addComponent(Label);
        label.overflow = Label.Overflow.SHRINK;
        label.enableWrapText = false;
        label.string = text;
        label.fontSize = size;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        styleProjectUiLabel(label, 'semibold', Math.ceil(size * 1.3));
        const outline = node.addComponent(LabelOutline);
        outline.color = new Color(5, 22, 42, 160);
        outline.width = 2;
        node.getComponent(UITransform)!.setContentSize(w, h);
        node.setPosition(x - 645, 360 - y, 0);
        return node;
    }

    private layout(): void {
        const size = view.getVisibleSize();
        const safe = sys.getSafeAreaRect(false);
        const rightInset = Math.max(0, size.width - safe.x - safe.width);
        const scale = Math.min(size.width / 1290, size.height / 720);
        this.chargePixelHeight = Math.max(1, Math.round(233 * scale));
        this.pixel = -1;
        this.cueRoot.setScale(scale, scale, 1);
        this.chargeRoot.setScale(scale, scale, 1);
        this.chargeRoot.setPosition(size.width / 2 - 645 * scale - Math.max(0, rightInset - 35 * scale), 0, 0);
        this.cueRoot.setPosition(0, -size.height / 2 + 360 * scale, 0);
    }

    showReady(): void {
        if (this.current === 'ready') return;
        this.pending = null;
        this.showCue('ready');
        this.setCharge(0, true);
    }

    showGo(): void {
        if (this.current === 'go') return;
        this.showCue('go');
    }

    showRelease(power: number, late: boolean): void {
        const result: Cue = late ? 'late' : power >= 0.85 ? 'perfect' : power >= 0.55 ? 'great' : 'good';
        if (this.current === 'go') this.pending = result;
        else this.showCue(result);
    }

    private showCue(key: Cue): void {
        if (this.current === key) return;
        Tween.stopAllByTarget(this.opacity);
        this.current = key;
        active(this.cueRoot, true);
        active(this.hint, key === 'ready');
        const box = CUES[key];
        this.cue.spriteFrame = FRAMES.get(key)!;
        this.cue.node.getComponent(UITransform)!.setContentSize(box[2], box[3]);
        this.cue.node.setPosition(box[0] + box[2] / 2 - 645, 360 - box[1] - box[3] / 2, 0);
        this.opacity.opacity = 255;
        if (key === 'ready') return;
        tween(this.opacity).delay(key === 'go' ? 0.5 : 0.85).to(0.18, { opacity: 0 }).call(() => {
            if (!this.root.isValid || this.current !== key) return;
            this.current = null;
            active(this.cueRoot, false);
            const next = this.pending;
            this.pending = null;
            if (next) this.showCue(next);
        }).start();
    }

    setCharge(power: number, visible: boolean): void {
        const entering = visible && !this.chargeRoot.active;
        active(this.chargeRoot, visible);
        if (!visible) return;
        this.ratio = Number.isFinite(power) ? Math.max(0, Math.min(1, power)) : 0;
        if (entering) this.renderCharge();
    }

    update(dt: number): void {
        if (!this.root.activeInHierarchy || !this.chargeRoot.active) return;
        this.elapsed += dt;
        if (this.elapsed < 1 / 30) return;
        this.elapsed %= 1 / 30;
        this.renderCharge();
    }

    private renderCharge(): void {
        const pixel = Math.round(this.ratio * this.chargePixelHeight);
        const tier: AssetKey = this.ratio > 0.82 ? 'charge-fill-high' : this.ratio > 0.45 ? 'charge-fill-mid' : 'charge-fill-low';
        if (this.tier !== tier) {
            this.fill.spriteFrame = FRAMES.get(tier)!;
            this.tier = tier;
        }
        if (this.pixel === pixel) return;
        this.pixel = pixel;
        this.fill.fillRange = pixel / this.chargePixelHeight;
        active(this.cap, pixel > 0);
        const y = 502 - 233 * pixel / this.chargePixelHeight;
        this.cap.setPosition(1234 - (y - 226) * 0.2 - 645, 361 - y, 0);
    }

    reset(): void {
        Tween.stopAllByTarget(this.opacity);
        this.pending = null;
        this.current = null;
        this.pixel = -1;
        this.elapsed = 0;
        active(this.cueRoot, false);
        active(this.chargeRoot, false);
    }

    destroy(): void {
        this.reset();
        view.off('canvas-resize', this.layout, this);
        view.off('design-resolution-changed', this.layout, this);
        if (this.root.isValid) this.root.destroy();
    }
}
