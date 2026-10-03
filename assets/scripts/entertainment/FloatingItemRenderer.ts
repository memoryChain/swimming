import { Color, EffectAsset, Material, MeshRenderer, Node, Vec4 } from 'cc';

export type FloatingItemLayers = {
    registerFloatingObject(root: Node): () => void;
};

/** 固定池共用无光照水线材质；仅在建池、相机切换和释放时接触渲染状态。 */
export class FloatingItemRenderer {
    private readonly material: Material;
    private readonly bindings = new Map<Node, () => void>();
    private disposed = false;

    constructor(readonly effect: EffectAsset, waterY: number, private readonly layers: FloatingItemLayers | null) {
        this.material = new Material();
        this.material.initialize({
            effectAsset: effect,
            defines: { USE_FLOATING_VERTEX_COLOR: true, USE_INSTANCING: true },
            states: { depthStencilState: { depthTest: true, depthWrite: true } },
        });
        this.material.name = 'RuntimeEntertainmentWaterline';
        this.material.setProperty('mainColor', Color.WHITE);
        this.material.setProperty('waterLine', new Vec4(waterY, 1, 0, 0));
        // 与主干浮漂和池岸道具一致；不修改全局水色来补偿物体受光。
        this.material.setProperty('underwaterColor', new Color(13, 87, 158, 184));
    }

    bind(root: Node) {
        if (this.disposed || !root.isValid || this.bindings.has(root)) return;
        this.applyMaterial(root);
        this.bindings.set(root, this.layers?.registerFloatingObject(root) ?? (() => {}));
    }

    unbind(root: Node) {
        const release = this.bindings.get(root);
        if (!release) return;
        release();
        this.bindings.delete(root);
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        for (const release of this.bindings.values()) release();
        this.bindings.clear();
        this.material.destroy();
    }

    private applyMaterial(node: Node) {
        const renderer = node.getComponent(MeshRenderer);
        if (renderer) {
            const count = Math.max(1, renderer.sharedMaterials.length);
            for (let i = 0; i < count; i++) renderer.setMaterial(this.material, i);
        }
        for (const child of node.children) this.applyMaterial(child);
    }
}
