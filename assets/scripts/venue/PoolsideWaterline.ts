import { Color, EffectAsset, Layers, Material, MeshRenderer, Node, Texture2D, Vec4 } from 'cc';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { SWIMMER_LAYER } from './WaterSurfaceBinder';

const POOLSIDE_NODE_NAME = 'PoolsideProps_Merged';

// 泳池梯和扶手属于池岸图集合批。只替换这一个批次的材质与相机层，不拆网格。
// 由水面相机控制器管理生命周期，没有逐帧遍历或材质更新。
export class PoolsideWaterline {
    private _node: Node | null = null;
    private _renderer: MeshRenderer | null = null;
    private _source: Material | null = null;
    private _material: Material | null = null;
    private _originalLayer = Layers.Enum.DEFAULT;
    private _underwater = false;
    private _loadToken = 0;
    private readonly _waterLine = new Vec4(0.055, 1, 0, 0);

    bind(pool: Node, waterY: number) {
        const node = findPoolside(pool);
        if (node && node === this._node) return;
        this.dispose();
        const renderer = node?.getComponent(MeshRenderer);
        // 当前权威 GLB 为单 primitive；不要把未来的多材质模型静默覆盖成同一张图。
        if (!node || !renderer?.mesh || renderer.sharedMaterials.length !== 1) return;
        const source = renderer.getSharedMaterial(0);
        // 图集是自发光材质，albedo 为黑；必须读 emissiveMap，不能当人物底图处理。
        const texture = readProperty(source, 'emissiveMap');
        if (!(texture instanceof Texture2D)) return;

        this._node = node;
        this._renderer = renderer;
        this._source = source;
        this._originalLayer = node.layer;
        this._waterLine.x = waterY;
        const token = ++this._loadToken;
        loadRaceAsset(RESOURCE_PATHS.venueHeightShadeEffect, EffectAsset, (error, effect) => {
            if (token !== this._loadToken || !node.isValid || !renderer.isValid) return;
            if (error || !effect) {
                console.warn('[SpeedSwimming] 池岸水线材质加载失败', error);
                return;
            }
            const material = new Material();
            material.initialize({
                effectAsset: effect,
                defines: { USE_TEXTURE: true, USE_POOLSIDE_WATERLINE: true },
                states: { depthStencilState: { depthTest: true, depthWrite: true } },
            });
            material.name = 'RuntimePoolsideWaterline';
            material.setProperty('mainTexture', texture);
            const emissive = readProperty(source, 'emissive');
            material.setProperty('mainColor', emissive instanceof Color ? emissive : Color.WHITE);
            material.setProperty('waterLine', this._waterLine);
            // 与浮漂保持同一水线色；水上图集颜色与原来一致。
            material.setProperty('underwaterColor', new Color(13, 87, 158, 184));
            this._material = material;
            renderer.setMaterial(material, 0);
            this.applyLayer();
        });
    }

    setUnderwaterViewActive(active: boolean) {
        if (this._underwater === active) return;
        this._underwater = active;
        this.applyLayer();
    }

    private applyLayer() {
        if (!this._material || !this._node?.isValid) return;
        // 水上随人物在水面之后绘制，保留池壁/池沿深度遮挡。
        // 水下回到主相机，让不透明水面镜像遮挡岸上道具，亦不重复绘入镜像。
        const layer = this._underwater ? this._originalLayer : SWIMMER_LAYER;
        if (this._node.layer !== layer) this._node.layer = layer;
    }

    dispose() {
        this._loadToken++;
        if (this._renderer?.isValid && this._material
            && this._renderer.getSharedMaterial(0) === this._material) {
            this._renderer.setMaterial(this._source, 0);
        }
        if (this._node?.isValid && this._node.layer !== this._originalLayer) {
            this._node.layer = this._originalLayer;
        }
        this._material?.destroy();
        this._material = null;
        this._source = null;
        this._renderer = null;
        this._node = null;
        this._underwater = false;
    }
}

function findPoolside(node: Node): Node | null {
    if (node.name === POOLSIDE_NODE_NAME) return node;
    for (const child of node.children) {
        const found = findPoolside(child);
        if (found) return found;
    }
    return null;
}

function readProperty(material: Material | null, key: string): unknown {
    try { return material?.getProperty(key); } catch { return null; }
}
