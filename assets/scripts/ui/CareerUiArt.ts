import { Button, Graphics, Node, Sprite, SpriteFrame, Texture2D, UITransform } from 'cc';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { makeUiNode } from './RuntimeUiFactory';

/** 复用分包内美术；只创建本页持有的SpriteFrame，销毁时释放，不复制纹理。 */
export function careerArt(parent: Node, name: string, path: string, width: number, height: number,
    x = 0, y = 0, sliced = false): Node {
    const node = makeUiNode(name, parent);
    node.getComponent(UITransform)!.setContentSize(width, height); node.setPosition(x, y);
    const sprite = node.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.trim = false;
    let owned: SpriteFrame | null = null;
    node.once(Node.EventType.NODE_DESTROYED, () => { owned?.destroy(); owned = null; });
    loadRaceAsset(path, Texture2D, (error, texture) => {
        if (error || !texture || !node.isValid) return;
        const frame = new SpriteFrame(); frame.texture = texture;
        if (sliced) {
            frame.insetLeft = frame.insetRight = Math.min(40, texture.width / 4);
            frame.insetTop = frame.insetBottom = Math.min(40, texture.height / 4);
            sprite.type = Sprite.Type.SLICED;
        }
        owned = frame; sprite.spriteFrame = frame;
        const fallback = parent.getComponent(Graphics);
        if (name === 'Surface' && fallback) fallback.enabled = false;
    });
    return node;
}

export function careerButtonFeedback(node: Node): void {
    const button = node.getComponent(Button)!;
    button.transition = Button.Transition.SCALE; button.zoomScale = 0.96; button.duration = 0.08;
}
