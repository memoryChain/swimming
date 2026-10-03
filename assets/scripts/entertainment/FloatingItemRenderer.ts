import { Color, EffectAsset, Material, MeshRenderer, Node, Texture2D, Vec4 } from 'cc';

export type FloatingItemLayers = {
    registerFloatingObject(root: Node): () => void;
};

/** 固定池共用无光照水线材质；仅在建池、相机切换和释放时接触渲染状态。 */
export class FloatingItemRenderer {
    private readonly material: Material;
    private readonly bindings = new Map<Node, () => void>();
    private disposed = false;
    private readonly texturedMaterials = new Map<Texture2D, Material>();

    constructor(readonly effect: EffectAsset, private readonly waterY: number, private readonly layers: FloatingItemLayers | null) {
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

    /** 保留 GLB 原色图；复用已有池岸纹理水线变体，不改顶点色道具或角色材质。 */
    bindTextured(root: Node) {
        if (this.disposed || !root.isValid || this.bindings.has(root)) return;
        for (const renderer of root.getComponentsInChildren(MeshRenderer)) {
            for (let slot = 0; slot < renderer.sharedMaterials.length; slot++) {
                const source = renderer.sharedMaterials[slot];
                let texture: Texture2D | null = null;
                for (const name of ['albedoMap', 'mainTexture', 'baseColorMap', 'baseColorTexture']) {
                    let value: unknown;
                    try { value = source?.getProperty(name); } catch { continue; }
                    if (value instanceof Texture2D) { texture = value; break; }
                }
                if (!texture) throw new Error('水球原色图缺失');
                let material = this.texturedMaterials.get(texture);
                if (!material) {
                    material = new Material(); this.texturedMaterials.set(texture, material);
                    material.initialize({ effectAsset: this.effect,
                        defines: { USE_POOLSIDE_WATERLINE: true, USE_TEXTURE: true, USE_INSTANCING: true },
                        states: { depthStencilState: { depthTest: true, depthWrite: true } } });
                    material.name = 'RuntimeEntertainmentTexturedWaterline';
                    material.setProperty('mainTexture', texture); material.setProperty('mainColor', Color.WHITE);
                    material.setProperty('waterLine', new Vec4(this.waterY, 1, 0, 0));
                    material.setProperty('underwaterColor', new Color(13, 87, 158, 184));
                }
                renderer.setMaterial(material, slot);
            }
        }
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
        for (const material of this.texturedMaterials.values()) material.destroy();
        this.texturedMaterials.clear();
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
