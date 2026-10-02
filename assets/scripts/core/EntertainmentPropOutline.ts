import { Color, EffectAsset, gfx, Material, Mesh, MeshRenderer, Node, SkinnedMeshRenderer, utils } from 'cc';
import { loadRaceAsset } from './RaceBundleLoader';
import { RESOURCE_PATHS } from './ResourcePaths';
import { ENTERTAINMENT_OUTLINE_GEOMETRY } from './EntertainmentOutlineGeometry';

type GeometryKey = Exclude<keyof typeof ENTERTAINMENT_OUTLINE_GEOMETRY, 'SharkSkin'>;
type Attachment = { parent: Node; key?: GeometryKey; source?: SkinnedMeshRenderer };

/** 一个道具池共用轮廓网格和材质。只在挂接／加载／销毁时工作，不进入比赛帧更新。 */
export class EntertainmentPropOutline {
    private readonly meshes = new Map<GeometryKey, Mesh>();
    private readonly nodes: Node[] = [];
    private readonly attached = new Set<Node>();
    private pending: Attachment[] = [];
    private material: Material | null = null;
    private skinMesh: Mesh | null = null;
    private loading = false;
    private disposed = false;

    // 宽度为局部法线外扩量 × 0.001；缩放后仍需按道具的世界尺寸复核。
    constructor(private readonly lineWidth = 3) {}

    attachStatic(parent: Node, key: GeometryKey): void {
        this.attach({ parent, key });
    }

    attachSharkModel(model: Node): void {
        for (const source of model.getComponentsInChildren(SkinnedMeshRenderer)) {
            if (source.mesh && source.node.name !== 'PropOutline') this.attach({ parent: source.node, source });
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.pending.length = 0;
        for (const node of this.nodes) if (node.isValid) node.destroy();
        for (const mesh of this.meshes.values()) mesh.destroy();
        this.skinMesh?.destroy();
        this.skinMesh = null;
        this.material?.destroy();
        this.material = null;
        this.nodes.length = 0;
        this.meshes.clear();
        this.attached.clear();
    }

    private attach(item: Attachment): void {
        if (this.disposed || !item.parent.isValid || this.attached.has(item.parent)) return;
        this.attached.add(item.parent);
        if (this.material) { this.create(item); return; }
        this.pending.push(item);
        if (this.loading) return;
        this.loading = true;
        loadRaceAsset(RESOURCE_PATHS.playerOutlineEffect, EffectAsset, (error, effect) => {
            if (this.disposed) return;
            this.loading = false;
            if (error || !effect) { this.pending.length = 0; this.attached.clear(); return; }
            if (!this.pending.some(entry => entry.parent.isValid)) { this.pending.length = 0; return; }
            const material = new Material();
            material.initialize({ effectAsset: effect });
            material.name = 'EntertainmentPropOutline';
            material.setProperty('lineWidth', this.lineWidth);
            material.setProperty('depthBias', 0);
            material.setProperty('baseColor', new Color(12, 24, 32, 255));
            this.material = material;
            for (const entry of this.pending) this.create(entry);
            this.pending.length = 0;
        });
    }

    private create(item: Attachment): void {
        if (!item.parent.isValid || !this.material) return;
        const source = item.source;
        if (source && (!source.isValid || !source.mesh)) return;
        const node = new Node('PropOutline');
        node.setParent(item.parent);
        node.layer = item.parent.layer;
        this.nodes.push(node);
        if (source) {
            // 专用身体／鱼鳍网格保留正式蒙皮权重，共用原骨架；附件薄片不参与描边。
            if (!this.skinMesh) {
                const data = ENTERTAINMENT_OUTLINE_GEOMETRY.SharkSkin;
                this.skinMesh = utils.createMesh({ positions: data.positions, normals: data.normals, indices: data.indices,
                    customAttributes: [
                        { attr: new gfx.Attribute(gfx.AttributeName.ATTR_JOINTS, gfx.Format.RGBA32F), values: data.joints },
                        { attr: new gfx.Attribute(gfx.AttributeName.ATTR_WEIGHTS, gfx.Format.RGBA32F), values: data.weights },
                    ] });
            }
            const renderer = node.addComponent(SkinnedMeshRenderer);
            renderer.mesh = this.skinMesh;
            renderer.skeleton = source.skeleton;
            // Cocos 在设置 skinningRoot 时接入原 SkeletalAnimation，继承烘焙模式和当前片段。
            // 不能强制切成实时蒙皮，否则烘焙播放时骨骼节点不更新，轮廓会停在静止姿态。
            renderer.skinningRoot = source.skinningRoot;
            renderer.enabled = source.enabled;
            renderer.setMaterial(this.material, 0);
        } else {
            const key = item.key!;
            let mesh = this.meshes.get(key);
            if (!mesh) { mesh = utils.createMesh(ENTERTAINMENT_OUTLINE_GEOMETRY[key]); this.meshes.set(key, mesh); }
            const renderer = node.addComponent(MeshRenderer);
            renderer.mesh = mesh;
            renderer.setMaterial(this.material, 0);
        }
    }
}
