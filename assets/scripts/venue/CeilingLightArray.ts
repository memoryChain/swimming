import { _decorator, Color, Component, gfx, Material, MeshRenderer, Node } from 'cc';

const { ccclass } = _decorator;
const CEILING_NODE = 'ceiling_lighting_rig';

// 几何来自场馆 GLB：屋盖、拱肋、吊杆和线性灯共用一个不透明顶点色批次。
// 这里只做一次材质绑定；没有灯光组件、透明光晕、逐灯节点或比赛帧计算。
@ccclass('CeilingLightingMaterialOwner')
export class CeilingLightingMaterialOwner extends Component {
    material: Material | null = null;

    onDestroy() {
        this.material?.destroy();
        this.material = null;
    }
}

function findCeiling(node: Node): Node | null {
    if (node.name === CEILING_NODE) return node;
    for (const child of node.children) {
        const found = findCeiling(child);
        if (found) return found;
    }
    return null;
}

export function applyCeilingLightArray(pool: Node | null, debug?: (message: string) => void): void {
    if (!pool?.isValid) return;
    const node = findCeiling(pool);
    const renderer = node?.getComponent(MeshRenderer);
    if (!node || !renderer?.mesh) {
        debug?.('ceiling lighting skipped: reimport the current venue GLB');
        return;
    }
    if (node.getComponent(CeilingLightingMaterialOwner)) return;

    const material = new Material();
    material.initialize({
        effectName: 'builtin-unlit',
        defines: { USE_VERTEX_COLOR: true },
        states: {
            rasterizerState: { cullMode: gfx.CullMode.BACK },
            depthStencilState: { depthTest: true, depthWrite: true },
        },
    });
    material.name = 'CeilingArchitecturalVertexColor';
    material.setProperty('mainColor', Color.WHITE);
    renderer.setMaterial(material, 0);
    node.addComponent(CeilingLightingMaterialOwner).material = material;
    debug?.('ceiling lighting bound: 1 opaque batch, no frame updates');
}
