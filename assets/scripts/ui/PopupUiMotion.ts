import { BlockInputEvents, Button, EventTouch, Node, tween, Tween, UIOpacity, UITransform, Vec3 } from 'cc';
import { fitFullScreenBackgroundCover, makeUiNode } from './RuntimeUiFactory';

type Phase = 'hidden' | 'opening' | 'open' | 'closing';

/** 共用弹窗动效：层级只建一次，遮罩到退场结束才释放输入。 */
export class PopupUiMotion {
    private _phase: Phase = 'hidden';
    private readonly _origin: Vec3;
    private readonly _scale: Vec3;
    private readonly _dimOpacity: UIOpacity;
    private readonly _panelOpacity: UIOpacity;
    private readonly _blocker: Node;
    private readonly _feedback = new Map<Node, Tween<Node>>();
    private readonly _resetButtons: (() => void)[] = [];
    private readonly _unbind: (() => void)[] = [];
    private _panelTween: Tween<Node> | null = null;
    private _fadeTween: Tween<UIOpacity> | null = null;
    private _dimTween: Tween<UIOpacity> | null = null;

    constructor(private readonly _root: Node, dim: Node, private readonly _panel: Node) {
        this._origin = _panel.position.clone();
        this._scale = _panel.scale.clone();
        this._dimOpacity = dim.getComponent(UIOpacity) ?? dim.addComponent(UIOpacity);
        this._panelOpacity = _panel.getComponent(UIOpacity) ?? _panel.addComponent(UIOpacity);
        if (!dim.getComponent(BlockInputEvents)) dim.addComponent(BlockInputEvents);
        const blocker = makeUiNode('PopupClosingBlocker', _root);
        const size = _root.getComponent(UITransform)!.contentSize;
        blocker.getComponent(UITransform)!.setContentSize(size.width, size.height);
        fitFullScreenBackgroundCover(blocker, size.width, size.height);
        blocker.addComponent(BlockInputEvents);
        blocker.active = false;
        this._blocker = blocker;
    }

    get showing(): boolean { return this._phase === 'opening' || this._phase === 'open'; }
    get interactive(): boolean { return this._root.isValid && this._root.active && this.showing; }

    show(): void {
        if (!this._root.isValid || this.showing) return;
        this.stopTransition();
        this.resetFeedback();
        if (this._phase === 'hidden') {
            this._panel.setPosition(this._origin.x, this._origin.y - 16, this._origin.z);
            this._panel.setScale(this._scale.x * 0.92, this._scale.y * 0.92, this._scale.z);
            this._panelOpacity.opacity = 0;
            this._dimOpacity.opacity = 0;
        }
        this._phase = 'opening';
        if (this._blocker.active) this._blocker.active = false;
        if (!this._root.active) this._root.active = true;
        this._panelTween = tween(this._panel)
            .to(0.19, { position: this._origin, scale: this.scaled(1.015) }, { easing: 'cubicOut' })
            .to(0.07, { scale: this._scale }, { easing: 'quadInOut' })
            .call(() => { this._phase = 'open'; this._panelTween = null; }).start();
        this._fadeTween = tween(this._panelOpacity).to(0.14, { opacity: 255 })
            .call(() => { this._fadeTween = null; }).start();
        this._dimTween = tween(this._dimOpacity).to(0.14, { opacity: 255 })
            .call(() => { this._dimTween = null; }).start();
    }

    hide(): void {
        if (!this.interactive) return;
        this.stopTransition();
        this._phase = 'closing';
        this._blocker.active = true;
        this._panelTween = tween(this._panel).to(0.16, {
            position: new Vec3(this._origin.x, this._origin.y - 8, this._origin.z), scale: this.scaled(0.96),
        }, { easing: 'quadIn' }).call(() => {
            this._panelTween = null;
            this.stopTransition();
            this.resetFeedback();
            this._phase = 'hidden';
            if (this._root.isValid && this._root.active) this._root.active = false;
        }).start();
        this._fadeTween = tween(this._panelOpacity).to(0.16, { opacity: 0 }).start();
        this._dimTween = tween(this._dimOpacity).to(0.16, { opacity: 0 }).start();
    }

    bindButton(node: Node, allowed: () => boolean): void {
        const button = node.getComponent(Button)!;
        button.transition = Button.Transition.NONE;
        const base = node.scale.clone();
        let touchId: number | null = null;
        const reset = () => {
            touchId = null;
            if (node.isValid && (node.scale.x !== base.x || node.scale.y !== base.y)) node.setScale(base);
        };
        const press = (event: EventTouch) => {
            if (!this.interactive || !allowed() || !button.interactable || touchId !== null) return;
            touchId = event.getID();
            this.feedback(node, tween(node).to(0.07, { scale: new Vec3(base.x * 0.96, base.y * 0.96, base.z) }));
        };
        const release = (event: EventTouch) => {
            if (event.getID() !== touchId) return;
            touchId = null;
            if (node.isValid) this.feedback(node, tween(node).to(0.12, { scale: base }, { easing: 'quadOut' }));
        };
        node.on(Node.EventType.TOUCH_START, press);
        node.on(Node.EventType.TOUCH_END, release);
        node.on(Node.EventType.TOUCH_CANCEL, release);
        this._resetButtons.push(reset);
        this._unbind.push(() => {
            node.off(Node.EventType.TOUCH_START, press);
            node.off(Node.EventType.TOUCH_END, release);
            node.off(Node.EventType.TOUCH_CANCEL, release);
        });
    }

    pulse(node: Node): void {
        if (!this.interactive || !node.isValid) return;
        this._feedback.get(node)?.stop();
        node.setScale(0.95, 0.95, 1);
        this.feedback(node, tween(node).to(0.1, { scale: new Vec3(1.035, 1.035, 1) }, { easing: 'quadOut' })
            .to(0.08, { scale: new Vec3(1, 1, 1) }, { easing: 'quadInOut' }));
    }

    dispose(): void {
        this.stopTransition();
        this.resetFeedback();
        this._phase = 'hidden';
        for (const unbind of this._unbind) unbind();
        this._unbind.length = 0;
        this._resetButtons.length = 0;
    }

    private scaled(factor: number): Vec3 { return new Vec3(this._scale.x * factor, this._scale.y * factor, this._scale.z); }
    private stopTransition(): void {
        this._panelTween?.stop(); this._fadeTween?.stop(); this._dimTween?.stop();
        this._panelTween = null; this._fadeTween = null; this._dimTween = null;
    }
    private feedback(node: Node, animation: Tween<Node>): void {
        this._feedback.get(node)?.stop();
        this._feedback.set(node, animation);
        animation.call(() => this._feedback.delete(node)).start();
    }
    private resetFeedback(): void {
        for (const [node, animation] of this._feedback) {
            animation.stop();
            if (node.isValid) node.setScale(1, 1, 1);
        }
        this._feedback.clear();
        for (const reset of this._resetButtons) reset();
    }
}
