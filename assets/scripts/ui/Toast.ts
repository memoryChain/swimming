// Lightweight transient toast. Mounts a single pill on the Toast layer (top-most,
// above the 3D character preview) that fades in, holds, fades out, and self-
// destroys. Calling showToast again replaces any toast already showing.
//
// The Toast layer lives on the popup overlay canvas (see UILayers), so toasts
// render above screens, the headbar, and the character preview, but below the
// cross-scene LoadingOverlay.
import { Label, Node, UIOpacity, UITransform, Vec3, tween, view } from 'cc';
import { getUILayer, UILayer } from './UILayers';
import { makeLabel, makeRoundedRect, makeUiNode, uiColor } from './RuntimeUiFactory';

export type ToastOptions = {
    // Total time the toast stays visible (seconds). Default 1.5.
    duration?: number;
};

const TOAST_NODE_NAME = 'Toast';
const TOAST_WIDTH = 380;
const TOAST_HEIGHT = 56;

export function showToast(canvas: Node, text: string, options?: ToastOptions): void {
    const layer = getUILayer(canvas, UILayer.Toast);
    // Replace any toast already on the layer so a new one never stacks on top.
    layer.getChildByName(TOAST_NODE_NAME)?.destroy();

    const design = view.getDesignResolutionSize();
    const width = design.width || 1280;
    const height = design.height || 720;

    const root = makeUiNode(TOAST_NODE_NAME, layer);
    root.getComponent(UITransform)!.setContentSize(width, height);
    root.setPosition(0, 0, 0);

    // Sit below the top UI (title / headbar / upgrade buttons) so it doesn't cover
    // them, but high enough to be noticed immediately.
    const restY = height / 2 - 210;
    const pill = makeRoundedRect('Pill', root, TOAST_WIDTH, TOAST_HEIGHT, uiColor(14, 36, 58, 235), 14, uiColor(86, 196, 236, 130), 1.5);
    pill.setPosition(0, restY, 0);

    const label = makeLabel('Text', pill, text, 22, uiColor(242, 250, 255, 255));
    label.getComponent(UITransform)!.setContentSize(TOAST_WIDTH - 24, TOAST_HEIGHT);
    const labelComp = label.getComponent(Label)!;
    labelComp.horizontalAlign = Label.HorizontalAlign.CENTER;
    labelComp.verticalAlign = Label.VerticalAlign.CENTER;
    labelComp.overflow = Label.Overflow.SHRINK;

    const opacity = pill.getComponent(UIOpacity) ?? pill.addComponent(UIOpacity);
    opacity.opacity = 0;
    pill.setScale(0.92, 0.92, 1);

    const duration = options?.duration ?? 1.5;
    const fadeIn = 0.18;
    const fadeOut = 0.4;
    tween(opacity)
        .to(fadeIn, { opacity: 255 })
        .delay(Math.max(0, duration - fadeIn - fadeOut))
        .to(fadeOut, { opacity: 0 })
        .call(() => { if (root.isValid) root.destroy(); })
        .start();
    tween(pill)
        .to(fadeIn, { position: new Vec3(0, restY + 8, 0), scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
        .start();
}