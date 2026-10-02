import { Color, EffectAsset, Material, Mesh, MeshRenderer, Node, utils } from 'cc';
import { loadRaceAsset } from './RaceBundleLoader';
import { RESOURCE_PATHS } from './ResourcePaths';
import { TURTLE_BUS_OUTLINE_GEOMETRY } from './TurtleBusOutlineGeometry';

/** 沿用人物描边效果；宽度是模型局部外扩量（参数×0.001），不是像素。 */
export const TURTLE_BUS_OUTLINE_STYLE = {
    lineWidth: 3,
    depthBias: 0,
    color: [12, 24, 32, 255] as const,
};

/** 一次性挂到身体与四鳍，完全继承父节点动作和显隐，没有比赛帧更新。 */
export class TurtleBusOutline {
    private readonly nodes: Node[] = [];
    private readonly meshes: Mesh[] = [];
    private material: Material | null = null;
    private disposed = false;
    private visible = true;

    constructor(owner: Node, bodyAndFins: readonly Node[]) {
        loadRaceAsset(RESOURCE_PATHS.playerOutlineEffect, EffectAsset, (error, effect) => {
            if (this.disposed || !owner.isValid || error || !effect) return;
            const material = new Material();
            material.initialize({ effectAsset: effect });
            material.name = 'TurtleBusOutline';
            material.setProperty('lineWidth', TURTLE_BUS_OUTLINE_STYLE.lineWidth);
            material.setProperty('depthBias', TURTLE_BUS_OUTLINE_STYLE.depthBias);
            material.setProperty('baseColor', new Color(...TURTLE_BUS_OUTLINE_STYLE.color));
            this.material = material;
            const geometry = [TURTLE_BUS_OUTLINE_GEOMETRY.body,
                TURTLE_BUS_OUTLINE_GEOMETRY.frontLeft, TURTLE_BUS_OUTLINE_GEOMETRY.frontRight,
                TURTLE_BUS_OUTLINE_GEOMETRY.rearLeft, TURTLE_BUS_OUTLINE_GEOMETRY.rearRight];
            for (let i = 0; i < geometry.length; i++) {
                const target = bodyAndFins[i];
                if (!target?.isValid) continue;
                const mesh = utils.createMesh(geometry[i]);
                const node = new Node('TurtleOutline');
                node.setParent(target);
                node.layer = target.layer;
                if (!this.visible) node.active = false;
                const renderer = node.addComponent(MeshRenderer);
                renderer.mesh = mesh;
                renderer.setMaterial(material, 0);
                this.meshes.push(mesh);
                this.nodes.push(node);
            }
        });
    }

    setVisible(visible: boolean): void {
        if (this.disposed || this.visible === visible) return;
        this.visible = visible;
        for (const node of this.nodes) if (node.isValid && node.active !== visible) node.active = visible;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const node of this.nodes) if (node.isValid) node.destroy();
        for (const mesh of this.meshes) mesh.destroy();
        this.material?.destroy();
        this.material = null;
        this.nodes.length = 0;
        this.meshes.length = 0;
    }
}
