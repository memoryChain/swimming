import { Node } from 'cc';

type CeilingEntry = {
    node: Node;
    layerBeforeBind: number;
};

type VisibilityCamera = {
    visibility: number;
    isValid?: boolean;
};

// User layer bits 8..14 are already used by water, swimmers, scoreboard,
// spectators and popup UI. Keep the venue ceiling on its own camera-filterable
// layer so an overhead event camera can omit it without hiding it in the main view.
export const VENUE_CEILING_LAYER = 1 << 15;

export function setCameraVenueCeilingVisible(camera: VisibilityCamera | null, visible: boolean): void {
    if (!camera || camera.isValid === false) return;
    const visibility = visible
        ? camera.visibility | VENUE_CEILING_LAYER
        : camera.visibility & ~VENUE_CEILING_LAYER;
    if (camera.visibility !== visibility) camera.visibility = visibility;
}

// Moves exported venue ceiling meshes onto a dedicated layer, then filters that
// layer per camera while a race or event camera is looking down from above.
// The LowPolyPool asset intentionally names these nodes with "ceiling" so the
// runtime does not need serialized references to individual GLB children.
export class TopViewCeilingController {
    private readonly _entries: CeilingEntry[] = [];
    private _camera: VisibilityCamera | null = null;
    private _cameraHadCeilingLayer = false;
    private _topViewActive = false;

    bind(pool: Node, camera: VisibilityCamera | null = null): number {
        this.dispose();
        this._camera = camera;
        this._cameraHadCeilingLayer = !!camera && (camera.visibility & VENUE_CEILING_LAYER) !== 0;
        this.collect(pool, false);
        for (const entry of this._entries) {
            if (entry.node?.isValid && entry.node.layer !== VENUE_CEILING_LAYER) {
                entry.node.layer = VENUE_CEILING_LAYER;
            }
        }
        setCameraVenueCeilingVisible(this._camera, true);
        return this._entries.length;
    }

    update(topViewActive: boolean) {
        if (topViewActive === this._topViewActive) {
            return;
        }
        this._topViewActive = topViewActive;
        setCameraVenueCeilingVisible(this._camera, !topViewActive);
    }

    dispose() {
        if (this._camera) {
            setCameraVenueCeilingVisible(this._camera, this._cameraHadCeilingLayer);
        }
        for (const entry of this._entries) {
            if (entry.node?.isValid && entry.node.layer !== entry.layerBeforeBind) {
                entry.node.layer = entry.layerBeforeBind;
            }
        }
        this._entries.length = 0;
        this._camera = null;
        this._cameraHadCeilingLayer = false;
        this._topViewActive = false;
    }

    private collect(node: Node, insideCeiling: boolean) {
        const isCeiling = insideCeiling || node.name.toLowerCase().includes('ceiling');
        if (isCeiling) {
            this._entries.push({ node, layerBeforeBind: node.layer });
        }
        for (const child of node.children) {
            this.collect(child, isCeiling);
        }
    }
}
