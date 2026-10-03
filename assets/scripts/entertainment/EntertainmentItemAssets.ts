import { Mesh, MeshRenderer, Node, Prefab } from 'cc';

export type EntertainmentDebrisMeshes = {
    bottles: readonly [Mesh, Mesh, Mesh];
    tray: Mesh;
};

/** 赛前读取已导入 GLB 的共享 Mesh；运行时槽位不需要隐藏的模型副本。 */
export function readEntertainmentItemMesh(prefab: Prefab, assetPath: string): Mesh {
    const root = prefab.data as Node | null;
    if (!root?.isValid) throw new Error(`娱乐道具模型无效：${assetPath}`);
    const renderers = root.getComponentsInChildren(MeshRenderer);
    if (renderers.length !== 1 || !renderers[0].mesh || !hasIdentityTransforms(root)) {
        throw new Error(`娱乐道具必须包含单网格并应用变换：${assetPath}`);
    }
    return renderers[0].mesh;
}

function hasIdentityTransforms(node: Node): boolean {
    const p = node.position, q = node.rotation, s = node.scale;
    const epsilon = 1e-6;
    if (Math.abs(p.x) > epsilon || Math.abs(p.y) > epsilon || Math.abs(p.z) > epsilon
        || Math.abs(q.x) > epsilon || Math.abs(q.y) > epsilon || Math.abs(q.z) > epsilon
        || Math.abs(Math.abs(q.w) - 1) > epsilon
        || Math.abs(s.x - 1) > epsilon || Math.abs(s.y - 1) > epsilon || Math.abs(s.z - 1) > epsilon) return false;
    for (const child of node.children) if (!hasIdentityTransforms(child)) return false;
    return true;
}
