// UI layering framework. Instead of ad-hoc setSiblingIndex/bringToTop calls, all
// screen UI is mounted into ONE of a fixed set of ordered layer containers. A
// node in a higher layer always renders above nodes in lower layers, no matter
// when it was added (async prefab loads included).
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
// 弹窗使用各自所属 Canvas 的独立覆盖相机，位于所属 UI 之上，图层为 1<<14。
// The prepare-race 3D character preview renders on a
// priority-1 camera, so without this overlay any modal would be hidden behind the
// character. The overlay camera (DEPTH_ONLY) draws popups above the character but
// below the cross-scene LoadingOverlay (priority 100). makeUiNode inherits its
// parent's layer, so every popup subtree node automatically lands on 1<<14 and is
// rendered solely by the overlay camera.
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
    // Modal dialogs, pickers, confirmations. Rendered on the popup overlay canvas
    // so they appear above the 3D character preview.
    Popup = 3,
    // Transient top-most feedback (toasts, reward pop text).
    Toast = 4,
}

// Dedicated user layer for the popup overlay camera only. Cocos reserves bits
// 20+; the project uses bits 10-13 (swimmer/scoreboard/water/loading), so bit 14
// is free. No other camera renders this bit, and this camera renders nothing else.
const POPUP_LAYER_BIT = 1 << 14;
// 最低优先级覆盖大厅角色相机（1）；实际值还须高于所属 UI，低于加载遮罩（100）。
const POPUP_CAMERA_PRIORITY = 2;
const POPUP_CANVAS_NAME = 'UILayerPopupCanvas';
// 大厅画布会以隐藏的常驻节点进入比赛，不能按场景内同名节点查找弹窗归属。
const POPUP_CANVASES = new WeakMap<Node, Node>();
const MAIN_LAYERS: UILayer[] = [UILayer.Background, UILayer.Screen, UILayer.Hud];
const POPUP_LAYERS: UILayer[] = [UILayer.Popup, UILayer.Toast];

function layerNodeName(layer: UILayer): string {
    return `UILayer_${layer}_${UILayer[layer]}`;
}

// Get (lazily creating) the container node for a UI layer. Background/Screen/Hud
// sit under `canvas` (rendered by the main UI camera); Popup/Toast sit under the
// popup overlay canvas (rendered after the owning UI camera) so dialogs
// appear above the 3D character preview. Also re-asserts the fixed layer order so
// the containers stay contiguous and correctly ordered even if other children
// were added later.
export function getUILayer(canvas: Node, layer: UILayer): Node {
    const overlay = ensureLayers(canvas);
    if (POPUP_LAYERS.indexOf(layer) >= 0) {
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

function ensureLayers(canvas: Node): Node {
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
    let overlay = POPUP_CANVASES.get(canvas);
    if (!overlay?.isValid) {
        overlay = new Node(POPUP_CANVAS_NAME);
        POPUP_CANVASES.set(canvas, overlay);
        const ownedOverlay = overlay;
        canvas.once(Node.EventType.NODE_DESTROYED, () => {
            if (ownedOverlay.isValid) ownedOverlay.destroy();
            if (POPUP_CANVASES.get(canvas) === ownedOverlay) POPUP_CANVASES.delete(canvas);
        });
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

    // 大厅主相机优先级为 0，比赛为 10；弹窗在所属 UI 之后绘制。
    const popupCamera = overlay.getComponent(Canvas)!.cameraComponent;
    const priority = Math.max(POPUP_CAMERA_PRIORITY, (canvas.getComponent(Canvas)?.cameraComponent?.priority ?? 0) + 1);
    if (popupCamera.priority !== priority) popupCamera.priority = priority;

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

    // Keep the main layer containers as the last N children of canvas, ordered.
    const total = canvas.children.length;
    MAIN_LAYERS.forEach((layer, i) => {
        canvas.getChildByName(layerNodeName(layer))?.setSiblingIndex(total - MAIN_LAYERS.length + i);
    });
    // Overlay sits last under the host; its own camera ordering is by priority, so
    // this is mostly for scene-graph tidiness.
    overlay.setSiblingIndex(host.children.length - 1);
    const overlayNode = overlay;
    const overlayTotal = overlayNode.children.length;
    POPUP_LAYERS.forEach((layer, i) => {
        overlayNode.getChildByName(layerNodeName(layer))?.setSiblingIndex(overlayTotal - POPUP_LAYERS.length + i);
    });
    return overlay;
}
