import { Material, MeshRenderer, Node, Vec4 } from 'cc';

/**
 * 角色固定卡通顶光的领奖补光。普通点灯不会照亮该无光照材质，而且场馆曾出现
 * 多光源剔除闪烁，因此只在状态切换时提升顶光暗面，不增加灯光 pass 或实时阴影。
 */
export class AwardsLighting {
    private readonly originals = new Map<Material, Vec4>();

    show(roots: readonly Node[]): void {
        this.hide();
        for (const root of roots) {
            if (!root?.isValid) continue;
            for (const renderer of root.getComponentsInChildren(MeshRenderer)) {
                for (const material of renderer.sharedMaterials) {
                    if (!material?.isValid || this.originals.has(material)) continue;
                    const definition = material.effectAsset?.techniques[material.technique]?.passes[0]?.properties?.celParams;
                    if (!definition) continue; // 不碰黑色外描边、水面或其他场景材质。
                    const value = material.getProperty('celParams');
                    const defaults = definition.value as number[] | undefined;
                    const original = value instanceof Vec4 ? value.clone()
                        : new Vec4(defaults?.[0] ?? 3, defaults?.[1] ?? 0.62, defaults?.[2] ?? 1, defaults?.[3] ?? 0.25);
                    this.originals.set(material, original);
                    material.setProperty('celParams', new Vec4(
                        original.x, Math.max(original.y, 0.86), original.z, Math.min(original.w, 0.10),
                    ));
                }
            }
        }
    }

    hide(): void {
        for (const [material, original] of this.originals) {
            if (material.isValid) material.setProperty('celParams', original);
        }
        this.originals.clear();
    }
}
