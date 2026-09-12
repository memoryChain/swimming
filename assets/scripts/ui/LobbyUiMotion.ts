import { Button, EventTouch, Node, tween, Tween, UIOpacity, Vec3 } from 'cc';
import { makeUiNode } from './RuntimeUiFactory';

type Entrance = { node: Node; x: number; y: number; delay: number };

/** 大厅与角色页的短时动效；由当前页面持有，退出时统一取消。 */
export class LobbyUiMotion {
    private readonly _entrances: Entrance[] = [];
    private readonly _nodeTweens = new Map<Node, Tween<Node>>();
    private readonly _alphaTweens = new Map<UIOpacity, Tween<UIOpacity>>();
    private readonly _unbind: (() => void)[] = [];
    private readonly _popButtons: Node[] = [];
    private readonly _cardTargets = new Map<Node, { x: number; y: number; scale: number }>();
    private _completion: Tween<object> | null = null;
    private _enabled = true;

    // 只移动 Widget 内侧的容器，屏幕适配仍由外层 Widget 负责。
    group(parent: Node, name: string, x: number, y = 0, delay = 0): Node {
        const node = makeUiNode(name, parent);
        node.addComponent(UIOpacity);
        this._entrances.push({ node, x, y, delay });
        return node;
    }

    enter(short: boolean): void {
        for (const part of this._entrances) {
            const opacity = part.node.getComponent(UIOpacity)!;
            part.node.setPosition(part.x, part.y, 0);
            opacity.opacity = 0;
            const delay = short ? 0 : part.delay;
            this.nodeTween(part.node, tween(part.node).delay(delay)
                .to(short ? 0.18 : 0.3, { position: new Vec3() }, { easing: 'cubicOut' }));
            this.alphaTween(opacity, tween(opacity).delay(delay)
                .to(short ? 0.18 : 0.24, { opacity: 255 }, { easing: 'quadOut' }));
        }
        if (!short) for (const node of this._popButtons) {
            node.setScale(0.96, 0.96, 1);
            this.nodeTween(node, tween(node).delay(0.15)
                .to(0.18, { scale: new Vec3(1.02, 1.02, 1) }, { easing: 'cubicOut' })
                .to(0.08, { scale: new Vec3(1, 1, 1) }, { easing: 'quadInOut' }));
        }
    }

    exit(done: () => void): void {
        if (!this._enabled) return;
        this._enabled = false;
        for (const part of this._entrances) {
            this.nodeTween(part.node, tween(part.node)
                .to(0.18, { position: new Vec3(part.x, part.y, 0) }, { easing: 'quadIn' }));
            const opacity = part.node.getComponent(UIOpacity)!;
            this.alphaTween(opacity, tween(opacity).to(0.18, { opacity: 0 }));
        }
        // 不使用 setTimeout；页面销毁时连同待执行的导航一起取消。
        this._completion = tween({}).delay(0.18).call(() => {
            this._completion = null;
            done();
        }).start();
    }

    moveCard(node: Node, x: number, y: number, scale: number, animated: boolean): void {
        const previous = this._cardTargets.get(node);
        if (previous && previous.x === x && previous.y === y && previous.scale === scale) return;
        this._cardTargets.set(node, { x, y, scale });
        this._nodeTweens.get(node)?.stop();
        this._nodeTweens.delete(node);
        if (animated) {
            this.nodeTween(node, tween(node).to(0.21, {
                position: new Vec3(x, y, node.position.z),
                scale: new Vec3(scale, scale, node.scale.z),
            }, { easing: 'cubicOut' }));
        } else {
            if (node.position.x !== x || node.position.y !== y) node.setPosition(x, y, node.position.z);
            if (node.scale.x !== scale || node.scale.y !== scale) node.setScale(scale, scale, node.scale.z);
        }
    }

    selectFrame(node: Node, selected: boolean, animated: boolean): void {
        const opacity = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
        this._alphaTweens.get(opacity)?.stop();
        this._alphaTweens.delete(opacity);
        if (!animated) {
            if (opacity.opacity !== 255) opacity.opacity = 255;
            if (node.active !== selected) node.active = selected;
            return;
        }
        if (selected && !node.active) {
            opacity.opacity = 0;
            node.active = true;
        }
        this.alphaTween(opacity, tween(opacity).to(0.15, { opacity: selected ? 255 : 0 })
            .call(() => { if (!selected && node.isValid && node.active) node.active = false; }));
    }

    bindButton(node: Node, entrancePop = false): void {
        if (entrancePop) this._popButtons.push(node);
        const button = node.getComponent(Button)!;
        button.transition = Button.Transition.NONE;
        const base = node.scale.clone();
        let touchId: number | null = null;
        const press = (event: EventTouch) => {
            if (!this._enabled || !button.interactable || touchId !== null) return;
            touchId = event.getID();
            this.nodeTween(node, tween(node).to(0.07,
                { scale: new Vec3(base.x * 0.96, base.y * 0.96, base.z) }, { easing: 'quadOut' }));
        };
        const release = (event: EventTouch) => {
            if (event.getID() !== touchId) return;
            touchId = null;
            if (!node.isValid || !this._enabled) return;
            this.nodeTween(node, tween(node)
                .to(0.08, { scale: new Vec3(base.x * 1.02, base.y * 1.02, base.z) }, { easing: 'quadOut' })
                .to(0.08, { scale: base }, { easing: 'quadInOut' }));
        };
        const cancel = (event: EventTouch) => {
            if (event.getID() !== touchId) return;
            touchId = null;
            if (node.isValid && this._enabled) this.nodeTween(node, tween(node).to(0.1, { scale: base }));
        };
        node.on(Node.EventType.TOUCH_START, press);
        node.on(Node.EventType.TOUCH_END, release);
        node.on(Node.EventType.TOUCH_CANCEL, cancel);
        this._unbind.push(() => {
            // 引擎可能先销毁子节点、再调用页面组件 onDestroy；此时事件处理器已释放。
            // 活节点正常解绑，已销毁节点的监听由引擎清除，不再调用 Node.off。
            if (!node.isValid) return;
            node.off(Node.EventType.TOUCH_START, press);
            node.off(Node.EventType.TOUCH_END, release);
            node.off(Node.EventType.TOUCH_CANCEL, cancel);
        });
    }

    dispose(): void {
        this._enabled = false;
        this._completion?.stop();
        this._completion = null;
        for (const animation of this._nodeTweens.values()) animation.stop();
        for (const animation of this._alphaTweens.values()) animation.stop();
        this._nodeTweens.clear();
        this._alphaTweens.clear();
        for (const unbind of this._unbind) unbind();
        this._unbind.length = 0;
        this._entrances.length = 0;
        this._popButtons.length = 0;
        this._cardTargets.clear();
    }

    private nodeTween(node: Node, animation: Tween<Node>): void {
        this._nodeTweens.get(node)?.stop();
        this._nodeTweens.set(node, animation);
        animation.call(() => this._nodeTweens.delete(node)).start();
    }

    private alphaTween(opacity: UIOpacity, animation: Tween<UIOpacity>): void {
        this._alphaTweens.get(opacity)?.stop();
        this._alphaTweens.set(opacity, animation);
        animation.call(() => this._alphaTweens.delete(opacity)).start();
    }
}
