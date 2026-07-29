// UI layering framework. Instead of ad-hoc setSiblingIndex/bringToTop calls, all
// screen UI is mounted into ONE of a fixed set of ordered layer containers under
// the Canvas. A node in a higher layer always renders above nodes in lower layers,
// no matter when it was added (async prefab loads included).
//
// Usage:
//   const screen = getUILayer(canvas, UILayer.Screen);
//   builder.build(screen, ...);            // full-screen UI screens
//   headBar.build(getUILayer(canvas, UILayer.Hud), ...);   // persistent overlays
//   makeUiNode('Dialog', getUILayer(canvas, UILayer.Popup));// modal dialogs
//
// Layer containers sit at canvas center (0,0) at design size, so children keep the
// same coordinates they'd have directly under the Canvas.
//
// NOTE: the cross-scene LoadingOverlay is intentionally NOT part of this — it uses
// its own persistent node + camera (priority 100) so it stays above everything,
// including these layers.

import { Node, UITransform, view } from 'cc';
import { makeUiNode } from './RuntimeUiFactory';

export enum UILayer {
    // Backdrops / scene-wide art behind the UI.
    Background = 0,
    // Main full-screen UI screens (login, prepare-race, results...).
    Screen = 1,
    // Persistent overlays that sit above screens but below dialogs (resource
    // headbar, non-modal HUD widgets on menus).
    Hud = 2,
    // Modal dialogs, pickers, confirmations.
    Popup = 3,
    // Transient top-most feedback (toasts, reward pop text).
    Toast = 4,
}

// Ascending render order (last = top-most).
const LAYER_ORDER: UILayer[] = [
    UILayer.Background,
    UILayer.Screen,
    UILayer.Hud,
    UILayer.Popup,
    UILayer.Toast,
];

function layerNodeName(layer: UILayer): string {
    return `UILayer_${layer}_${UILayer[layer]}`;
}

// Get (lazily creating) the container node for a UI layer under `canvas`. Also
// re-asserts the fixed layer order so the containers stay contiguous and correctly
// ordered even if other children were added to the canvas.
export function getUILayer(canvas: Node, layer: UILayer): Node {
    ensureLayers(canvas);
    return canvas.getChildByName(layerNodeName(layer))!;
}

function ensureLayers(canvas: Node): void {
    const design = view.getDesignResolutionSize();
    for (const l of LAYER_ORDER) {
        const name = layerNodeName(l);
        let node = canvas.getChildByName(name);
        if (!node) {
            node = makeUiNode(name, canvas);
            node.setPosition(0, 0, 0);
            node.getComponent(UITransform)?.setContentSize(design.width || 1280, design.height || 720);
        }
    }
    // Place the layer containers as the last N children, in LAYER_ORDER. This keeps
    // higher layers above lower ones regardless of insertion timing.
    const total = canvas.children.length;
    LAYER_ORDER.forEach((l, i) => {
        canvas.getChildByName(layerNodeName(l))?.setSiblingIndex(total - LAYER_ORDER.length + i);
    });
}
