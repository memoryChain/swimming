import { gfx, MeshRenderer, Node, Vec3 } from 'cc';
import type { CharacterSupportPlane } from '../character/CharacterSupportPlane';

type SurfaceGroup = CharacterSupportPlane & { area: number };

// 合批前从起跳台网格提取最大的朝上共面区域，排除细小装饰、扶手和后方凸起。
// 每次场馆加载只执行一次，结果使用世界坐标并保留实际实例缩放。
export function readStartBlockSurface(block: Node): CharacterSupportPlane | null {
    const groups: SurfaceGroup[] = [];
    const a = new Vec3(), b = new Vec3(), c = new Vec3();
    const ab = new Vec3(), ac = new Vec3(), normal = new Vec3();
    let obstacleMinX = Infinity, obstacleMaxX = -Infinity;
    let obstacleMinY = Infinity, obstacleMaxY = -Infinity;
    const triangles: number[] = [];
    for (const renderer of block.getComponentsInChildren(MeshRenderer)) {
        const mesh = renderer.mesh;
        if (!mesh) continue;
        for (let primitive = 0; primitive < mesh.struct.primitives.length; primitive++) {
            const positions = mesh.readAttribute(primitive, gfx.AttributeName.ATTR_POSITION);
            const indices = mesh.readIndices(primitive);
            if (!positions) continue;
            const count = indices?.length ?? positions.length / 3;
            for (let i = 0; i + 2 < count; i += 3) {
                const ai = (indices ? indices[i] : i) * 3;
                const bi = (indices ? indices[i + 1] : i + 1) * 3;
                const ci = (indices ? indices[i + 2] : i + 2) * 3;
                a.set(positions[ai], positions[ai + 1], positions[ai + 2]);
                b.set(positions[bi], positions[bi + 1], positions[bi + 2]);
                c.set(positions[ci], positions[ci + 1], positions[ci + 2]);
                Vec3.transformMat4(a, a, renderer.node.worldMatrix);
                Vec3.transformMat4(b, b, renderer.node.worldMatrix);
                Vec3.transformMat4(c, c, renderer.node.worldMatrix);
                obstacleMinX = Math.min(obstacleMinX, a.x, b.x, c.x);
                obstacleMaxX = Math.max(obstacleMaxX, a.x, b.x, c.x);
                obstacleMinY = Math.min(obstacleMinY, a.y, b.y, c.y);
                obstacleMaxY = Math.max(obstacleMaxY, a.y, b.y, c.y);
                triangles.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
                Vec3.subtract(ab, b, a); Vec3.subtract(ac, c, a);
                Vec3.cross(normal, ab, ac);
                const area = normal.length() * 0.5;
                if (area < 1e-8) continue;
                Vec3.normalize(normal, normal);
                if (normal.y < 0.7) continue;
                const distance = Vec3.dot(normal, a);
                let group = groups.find(g => g.nx * normal.x + g.ny * normal.y + g.nz * normal.z > 0.9999
                    && Math.abs(g.distance - distance) < 0.003);
                if (!group) {
                    group = { nx: normal.x, ny: normal.y, nz: normal.z, distance, area: 0,
                        minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
                    groups.push(group);
                }
                group.area += area;
                group.minX = Math.min(group.minX, a.x, b.x, c.x); group.maxX = Math.max(group.maxX, a.x, b.x, c.x);
                group.minY = Math.min(group.minY, a.y, b.y, c.y); group.maxY = Math.max(group.maxY, a.y, b.y, c.y);
                group.minZ = Math.min(group.minZ, a.z, b.z, c.z); group.maxZ = Math.max(group.maxZ, a.z, b.z, c.z);
            }
        }
    }
    let best: SurfaceGroup | null = null;
    for (const group of groups) if (!best || group.area > best.area) best = group;
    if (best) {
        best.obstacleMinX = obstacleMinX; best.obstacleMaxX = obstacleMaxX;
        const bands = Array.from({ length: 16 }, (_, i) => ({
            minY: obstacleMinY + (obstacleMaxY - obstacleMinY) * i / 16,
            maxY: obstacleMinY + (obstacleMaxY - obstacleMinY) * (i + 1) / 16,
            minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity,
        }));
        for (const band of bands) {
            const include = (x: number, z: number) => {
                band.minX = Math.min(band.minX, x); band.maxX = Math.max(band.maxX, x);
                band.minZ = Math.min(band.minZ, z); band.maxZ = Math.max(band.maxZ, z);
            };
            for (let i = 0; i < triangles.length; i += 9) {
                for (let vertex = 0; vertex < 3; vertex++) {
                    const a = i + vertex * 3, b = i + ((vertex + 1) % 3) * 3;
                    const ay = triangles[a + 1], by = triangles[b + 1];
                    if (ay >= band.minY && ay <= band.maxY) include(triangles[a], triangles[a + 2]);
                    for (let edge = 0; edge < 2; edge++) {
                        const y = edge ? band.maxY : band.minY;
                        if ((ay < y && by > y) || (by < y && ay > y)) {
                            const t = (y - ay) / (by - ay);
                            include(triangles[a] + (triangles[b] - triangles[a]) * t,
                                triangles[a + 2] + (triangles[b + 2] - triangles[a + 2]) * t);
                        }
                    }
                }
            }
        }
        best.obstacleBands = bands.filter(b => Number.isFinite(b.minX));
    }
    return best;
}
