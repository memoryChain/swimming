// UI layering framework. Instead of ad-hoc setSiblingIndex/bringToTop calls, all
// screen UI is mounted into ONE of a fixed set of ordered layer containers. A
// node in a higher layer always renders above nodes in lower layers, no matter
// when it was added (async prefab loads included).
//
// Usage:
//   const screen = getUILayer(canvas, UILayer.Screen);
//   builder.build(screen, ...);            // full-screen UI screens
//   headBar.build(getUILayer(canvas, UILayer.Hud), ...);   // persistent overlays
//   makeUiNode('Dialog', getUILayer(canvas, UILayer.Hud));  // interactive modals
//
// Layer containers sit at canvas center (0,0) at design size, so children keep the
// same coordinates they'd have directly under the Canvas.
//
// Popup/Toast live on a SEPARATE overlay canvas with its own camera (priority 2,
// dedicated layer bit 1<<14). The prepare-race 3D character preview renders on a
// priority-1 camera. Interactive menu dialogs use Hud and pause that preview so
// rendering and input share one camera. Popup/Toast remain for transient content
// that truly has to render above the preview. makeUiNode inherits its parent's
// layer, so those subtrees land on 1<<14 and are rendered only by this camera.
//
// NOTE: the cross-scene LoadingOverlay is intentionally NOT part of this; it uses
// its own persistent node + camera (priority 100) so it stays above everything,
// including these layers.

import { Camera, Canvas, Layers, Node, UITransform, view } from 'cc';
import { makeUiNode } from './RuntimeUiFactory';

export enum UILayer {
    // Backdrops / scene-wide art behind the UI.
    Background = 0,
    // Main full-screen UI screens (login, prepare-race, results...).
    Screen = 1,
    // Persistent overlays that sit above screens but below dialogs (resource
    // headbar, non-modal HUD widgets on menus).
    Hud = 2,
    // Dedicated overlay content. Interactive menu dialogs should normally use
    // Hud and pause the prepare-race preview instead.
    Popup = 3,
    // Transient top-most feedback (toasts, reward pop text).
    Toast = 4,
}

// Dedicated user layer for the popup overlay camera only. Cocos reserves bits
// 20+; the project uses bits 10-13 (swimmer/scoreboard/water/loading), so bit 14
// is free. No other camera renders this bit, and this camera renders nothing else.
const POPUP_LAYER_BIT = 1 << 14;
// Rendered after the UI camera (priority 0) and the prepare-race preview camera
// (priority 1), before the LoadingOverlay (priority 100).
const POPUP_CAMERA_PRIORITY = 2;
const POPUP_CANVAS_NAME = 'UILayerPopupCanvas';
const MAIN_LAYERS: UILayer[] = [UILayer.Background, UILayer.Screen, UILayer.Hud];
const POPUP_LAYERS: UILayer[] = [UILayer.Popup, UILayer.Toast];
const SYNCED_POPUP_CANVASES = new WeakSet<Node>();

function layerNodeName(layer: UILayer): string {
    return `UILayer_${layer}_${UILayer[layer]}`;
}

// Get (lazily creating) the container node for a UI layer. Background/Screen/Hud
// sit under `canvas` (rendered by the main UI camera); Popup/Toast sit under the
// popup overlay canvas (rendered by the priority-2 overlay camera) so dialogs
// appear above the 3D character preview. Also re-asserts the fixed layer order so
// the containers stay contiguous and correctly ordered even if other children
// were added later.
export function getUILayer(canvas: Node, layer: UILayer): Node {
    ensureLayers(canvas);
    if (POPUP_LAYERS.indexOf(layer) >= 0) {
        const overlay = popupHost(canvas).getChildByName(POPUP_CANVAS_NAME)!;
        return overlay.getChildByName(layerNodeName(layer))!;
    }
    return canvas.getChildByName(layerNodeName(layer))!;
}

// The overlay canvas is a sibling of `canvas` (under its parent) so it gets its
// own transform/camera without nesting inside the main Canvas. Falls back to
// `canvas` itself if it has no parent.
function popupHost(canvas: Node): Node {
    return canvas.parent ?? canvas;
}

function syncPopupOverlay(overlay: Node): void {
    const apply = () => {
        if (!overlay.isValid) return;
        const visible = view.getVisibleSize();
        const design = view.getDesignResolutionSize();
        const width = visible.width || design.width || 1280;
        const height = visible.height || design.height || 720;
        const resize = (node: Node): void => {
            const transform = node.getComponent(UITransform);
            if (transform
                && (transform.contentSize.width !== width || transform.contentSize.height !== height)) {
                transform.setContentSize(width, height);
            }
        };
        resize(overlay);
        for (const layer of POPUP_LAYERS) {
            const node = overlay.getChildByName(layerNodeName(layer));
            if (node) resize(node);
        }
        const camera = overlay.getComponent(Canvas)?.cameraComponent;
        const orthoHeight = height / 2;
        if (camera && camera.orthoHeight !== orthoHeight) camera.orthoHeight = orthoHeight;
    };

    apply();
    if (SYNCED_POPUP_CANVASES.has(overlay)) return;
    SYNCED_POPUP_CANVASES.add(overlay);
    view.on('canvas-resize', apply);
    view.on('design-resolution-changed', apply);
    overlay.once(Node.EventType.NODE_DESTROYED, () => {
        view.off('canvas-resize', apply);
        view.off('design-resolution-changed', apply);
    });
}

function ensureLayers(canvas: Node): void {
    const design = view.getDesignResolutionSize();
    const width = design.width || 1280;
    const height = design.height || 720;
    // Keep the main canvas on UI_2D so makeUiNode children built under it stay on
    // UI_2D (rendered by the main UI camera, below the character preview).
    canvas.layer = Layers.Enum.UI_2D;

    for (const layer of MAIN_LAYERS) {
        const name = layerNodeName(layer);
        let node = canvas.getChildByName(name);
        if (!node) {
            node = makeUiNode(name, canvas);
            node.setPosition(0, 0, 0);
            node.getComponent(UITransform)?.setContentSize(width, height);
        }
    }

    const host = popupHost(canvas);
    let overlay = host.getChildByName(POPUP_CANVAS_NAME);
    if (!overlay) {
        overlay = new Node(POPUP_CANVAS_NAME);
        overlay.setParent(host);
        overlay.setPosition(0, 0, 0);
        overlay.layer = POPUP_LAYER_BIT;
        overlay.addComponent(UITransform).setContentSize(width, height);
        const overlayCanvas = overlay.addComponent(Canvas);
        const cameraNode = new Node('Camera');
        cameraNode.setParent(overlay);
        cameraNode.setPosition(0, 0, 0);
        cameraNode.layer = POPUP_LAYER_BIT;
        const camera = cameraNode.addComponent(Camera);
        // Only render the popup layer bit; DEPTH_ONLY so the dim/panel blend over
        // the already-drawn UI + 3D character instead of wiping them.
        camera.visibility = POPUP_LAYER_BIT;
        camera.projection = Camera.ProjectionType.ORTHO;
        camera.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
        camera.priority = POPUP_CAMERA_PRIORITY;
        camera.orthoHeight = height / 2;
        overlayCanvas.cameraComponent = camera;
    }

    for (const layer of POPUP_LAYERS) {
        const name = layerNodeName(layer);
        let node = overlay!.getChildByName(name);
        if (!node) {
            // makeUiNode inherits overlay.layer (POPUP_LAYER_BIT), so popup content
            // is rendered only by the overlay camera.
            node = makeUiNode(name, overlay!);
            node.setPosition(0, 0, 0);
            node.getComponent(UITransform)?.setContentSize(width, height);
        }
    }
    syncPopupOverlay(overlay!);

    // Keep the main layer containers as the last N children of canvas, ordered.
    const total = canvas.children.length;
    MAIN_LAYERS.forEach((layer, i) => {
        canvas.getChildByName(layerNodeName(layer))?.setSiblingIndex(total - MAIN_LAYERS.length + i);
    });
    // Overlay sits last under the host; its own camera ordering is by priority, so
    // this is mostly for scene-graph tidiness.
    host.getChildByName(POPUP_CANVAS_NAME)?.setSiblingIndex(host.children.length - 1);
    const overlayNode = host.getChildByName(POPUP_CANVAS_NAME)!;
    const overlayTotal = overlayNode.children.length;
    POPUP_LAYERS.forEach((layer, i) => {
        overlayNode.getChildByName(layerNodeName(layer))?.setSiblingIndex(overlayTotal - POPUP_LAYERS.length + i);
    });
}
