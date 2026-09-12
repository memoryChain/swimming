import { Node, tween, Tween, UIOpacity, Vec3 } from 'cc';
import { makeUiNode } from './RuntimeUiFactory';

type Part = {
    node: Node; opacity: UIOpacity; offset: Vec3; duration: number; delay: number;
    control: boolean; move: Tween<Node> | null; fade: Tween<UIOpacity> | null;
};
const REST = new Vec3();

/** 仅在 HUD 显隐边缘运行；独立容器避免与屏幕适配、按压和排名位置互相抢写。 */
export class RaceHudEntrance {
    private readonly _parts: Part[] = [];

    wrap(content: Node, x: number, y: number, duration: number, delay = 0, control = false): void {
        const node = makeUiNode(`${content.name}Entrance`, content.parent!);
        content.setParent(node);
        this._parts.push({ node, opacity: node.addComponent(UIOpacity), offset: new Vec3(x, y, 0),
            duration, delay, control, move: null, fade: null });
    }

    play(): void {
        this.reset();
        for (const part of this._parts) {
            part.opacity.opacity = 0;
            if (part.offset.x !== 0 || part.offset.y !== 0) {
                part.node.setPosition(part.offset);
                part.move = tween(part.node).delay(part.delay)
                    .to(part.duration, { position: REST }, { easing: 'cubicOut' })
                    .call(() => { part.move = null; }).start();
            }
            part.fade = tween(part.opacity).delay(part.delay)
                .to(part.duration, { opacity: 255 }, { easing: 'quadOut' })
                .call(() => { part.fade = null; }).start();
        }
    }

    // 入场期间已有划水输入时，操作提示立即就位；不延迟任何输入或判定。
    finishControls(): void {
        for (const part of this._parts) if (part.control && part.fade) this.finish(part);
    }

    reset(): void { for (const part of this._parts) this.finish(part); }
    dispose(): void { this.reset(); this._parts.length = 0; }

    private finish(part: Part): void {
        part.move?.stop(); part.fade?.stop();
        part.move = null; part.fade = null;
        if (part.node.isValid && (part.node.position.x !== 0 || part.node.position.y !== 0)) part.node.setPosition(REST);
        if (part.opacity.isValid && part.opacity.opacity !== 255) part.opacity.opacity = 255;
    }
}
