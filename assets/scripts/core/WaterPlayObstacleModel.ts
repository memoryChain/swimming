import { Color, instantiate, Material, Mesh, MeshRenderer, Node, primitives, utils } from 'cc';
import { findNode, loadSwimmerPrefab, setLayerRecursive } from '../character/CharacterModelLoader';
import { WATER_PLAY_GEOMETRY } from './WaterPlayObstacleGeometry';

export const WATER_CANNON_PIVOT = { x: 0, y: 1.04, z: 0 } as const;
/** 喷管局部端面；须经喷管的仰角与炮台水平朝向变换。 */
export const WATER_CANNON_MUZZLE = { x: 0, y: 0, z: 1.02 } as const;
export const WATER_CANNON_REST_PITCH = 40;
export const SPRAY_BUOY_NOZZLE_HEIGHT = 0.25;
export const SPRAY_BUOY_TETHER_ANCHOR = { x: -0.32, y: 0.195, z: 0.05 } as const;

type WaterPlayKind = keyof typeof WATER_PLAY_GEOMETRY;
type ModelSlot = { root: Node; parts: Node[]; renderers: MeshRenderer[] };

/** 同源固定网格立即可见；GLB 就绪后替换网格引用，不重建比赛节点或重播动作。 */
export class WaterPlayObstacleModels {
    private readonly material: Material;
    private readonly meshes: Mesh[] = [];
    private readonly names: string[];
    private readonly slots: ModelSlot[] = [];
    private disposed = false;

    constructor(kind: WaterPlayKind, parents: readonly Node[], candidates: string[]) {
        this.material = new Material();
        this.material.initialize({ effectName: 'builtin-unlit', defines: { USE_VERTEX_COLOR: true } });
        this.material.setProperty('mainColor', Color.WHITE);
        const geometry = WATER_PLAY_GEOMETRY[kind] as Record<string, primitives.IGeometry>;
        this.names = Object.keys(geometry);
        for (const name of this.names) this.meshes.push(utils.createMesh(geometry[name]));
        for (const parent of parents) {
            const slot: ModelSlot = { root: parent, parts: [], renderers: [] };
            for (let i = 0; i < this.names.length; i++) {
                const part = new Node(this.names[i]);
                part.setParent(parent);
                part.layer = parent.layer;
                const renderer = part.addComponent(MeshRenderer);
                renderer.mesh = this.meshes[i];
                renderer.setMaterial(this.material, 0);
                slot.parts.push(part);
                slot.renderers.push(renderer);
            }
            this.slots.push(slot);
        }
        loadSwimmerPrefab((error, result) => {
            if (this.disposed || error || !result || !this.slots[0]?.root.isValid) return;
            // 临时解析导入资源，只在加载回调中分配；节点变换仍由表现持有。
            const imported = instantiate(result.prefab);
            setLayerRecursive(imported, parents[0].layer);
            const importedMeshes = this.names.map(name => findNode(imported, name)?.getComponent(MeshRenderer)?.mesh);
            if (importedMeshes.every(Boolean)) {
                for (const slot of this.slots) {
                    if (!slot.root.isValid) continue;
                    for (let i = 0; i < slot.renderers.length; i++) slot.renderers[i].mesh = importedMeshes[i]!;
                }
            }
            imported.destroy();
        }, candidates);
    }

    part(slot: number, name: string): Node | null {
        const index = this.names.indexOf(name);
        return this.slots[slot]?.parts[index] ?? null;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const mesh of this.meshes) mesh.destroy();
        this.material.destroy();
        this.slots.length = 0;
    }
}
