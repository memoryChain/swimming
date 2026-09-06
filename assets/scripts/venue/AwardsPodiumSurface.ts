import { gfx, MeshRenderer, Node, Vec3 } from 'cc';
import type { SceneBounds } from './RaceCourseLayout';

// 直接读取领奖台本体网格，不依赖渲染器上一帧包围盒，也不计入后加的描边子节点。
// 仅进入领奖时调用，新模型的缩放、旋转和父级变换自动纳入世界坐标。
export function awardsPodiumSurface(root: Node, name: string): SceneBounds | null {
    if (root.name === name) {
        const mesh = root.getComponent(MeshRenderer)?.mesh;
        if (mesh) {
            const point = new Vec3();
            const bounds: SceneBounds = {
                minX: Infinity, maxX: -Infinity,
                minY: Infinity, maxY: -Infinity,
                minZ: Infinity, maxZ: -Infinity,
            };
            for (let primitive = 0; primitive < mesh.struct.primitives.length; primitive++) {
                const positions = mesh.readAttribute(primitive, gfx.AttributeName.ATTR_POSITION);
                if (!positions) continue;
                for (let i = 0; i < positions.length; i += 3) {
                    point.set(positions[i], positions[i + 1], positions[i + 2]);
                    Vec3.transformMat4(point, point, root.worldMatrix);
                    bounds.minX = Math.min(bounds.minX, point.x); bounds.maxX = Math.max(bounds.maxX, point.x);
                    bounds.minY = Math.min(bounds.minY, point.y); bounds.maxY = Math.max(bounds.maxY, point.y);
                    bounds.minZ = Math.min(bounds.minZ, point.z); bounds.maxZ = Math.max(bounds.maxZ, point.z);
                }
            }
            if (Number.isFinite(bounds.maxY)) return bounds;
        }
    }
    for (const child of root.children) {
        const bounds = awardsPodiumSurface(child, name);
        if (bounds) return bounds;
    }
    return null;
}
