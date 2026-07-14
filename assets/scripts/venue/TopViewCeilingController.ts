import { Node } from 'cc';

type CeilingEntry = {
    node: Node;
    activeBeforeTopView: boolean;
};

// Hides the exported venue ceiling meshes while a race camera is looking down
// from above the roof, then restores every node to the state it had on entry.
// The LowPolyPool asset intentionally names these nodes with "ceiling" so the
// runtime does not need serialized references to individual GLB children.
export class TopViewCeilingController {
    private readonly _entries: CeilingEntry[] = [];
    private _topViewActive = false;

    bind(pool: Node): number {
        this.restore();
        this._entries.length = 0;
        this.collect(pool);
        return this._entries.length;
    }

    update(topViewActive: boolean) {
        if (topViewActive === this._topViewActive) {
            return;
        }
        if (topViewActive) {
            for (const entry of this._entries) {
                if (!entry.node?.isValid) {
                    continue;
                }
                entry.activeBeforeTopView = entry.node.active;
                entry.node.active = false;
            }
            this._topViewActive = true;
            return;
        }
        this.restore();
    }

    dispose() {
        this.restore();
        this._entries.length = 0;
    }

    private collect(node: Node) {
        if (node.name.toLowerCase().includes('ceiling')) {
            this._entries.push({ node, activeBeforeTopView: node.active });
        }
        for (const child of node.children) {
            this.collect(child);
        }
    }

    private restore() {
        if (!this._topViewActive) {
            return;
        }
        for (const entry of this._entries) {
            if (entry.node?.isValid) {
                entry.node.active = entry.activeBeforeTopView;
            }
        }
        this._topViewActive = false;
    }
}
