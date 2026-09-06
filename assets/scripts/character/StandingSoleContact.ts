import { gfx, Node, SkinnedMeshRenderer, Vec3 } from 'cc';
import type { CharacterSupportPlane } from './CharacterSupportPlane';

type Influence = { bone: Node; local: Vec3; weight: number };
type Probe = { rest: Vec3; influences: Influence[] };

// 从角色自身网格建立左右鞋底采样点，每脚最多 32 点；只在模型加载时读取网格。
// 保留原蒙皮权重，领奖时按实际骨骼变换测量鞋底，不把脚踝骨心当作台面接触点。
export class StandingSoleContact {
    private _model: Node | null = null;
    private readonly _feet: [Probe[], Probe[]] = [[], []];
    private readonly _point = new Vec3();
    private readonly _weighted = new Vec3();

    clear() {
        this._model = null;
        this._feet[0].length = 0;
        this._feet[1].length = 0;
    }

    bind(model: Node, renderers: readonly SkinnedMeshRenderer[]) {
        this.clear();
        this._model = model;
        const candidates: [Probe[], Probe[]] = [[], []];
        for (const renderer of renderers) {
            const { mesh, skeleton, skinningRoot } = renderer;
            if (!mesh || !skeleton || !skinningRoot) continue;
            const bones = skeleton.joints.map(path => skinningRoot.getChildByPath(path));
            const sides = bones.map(bone => footSide(bone?.name ?? ''));
            for (let primitive = 0; primitive < mesh.struct.primitives.length; primitive++) {
                const positions = mesh.readAttribute(primitive, gfx.AttributeName.ATTR_POSITION);
                const joints = mesh.readAttribute(primitive, gfx.AttributeName.ATTR_JOINTS);
                const weights = mesh.readAttribute(primitive, gfx.AttributeName.ATTR_WEIGHTS);
                if (!positions || !joints || !weights) continue;
                for (let vertex = 0; vertex < positions.length / 3; vertex++) {
                    let left = 0;
                    let right = 0;
                    for (let slot = 0; slot < 4; slot++) {
                        const index = vertex * 4 + slot;
                        const side = sides[joints[index]];
                        if (side === 0) left += weights[index];
                        if (side === 1) right += weights[index];
                    }
                    if (Math.max(left, right) < 0.5) continue;
                    const probe: Probe = { rest: new Vec3(), influences: [] };
                    this._point.set(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]);
                    let totalWeight = 0;
                    for (let slot = 0; slot < 4; slot++) {
                        const index = vertex * 4 + slot;
                        const joint = joints[index];
                        const weight = weights[index];
                        const bone = bones[joint];
                        const bind = skeleton.bindposes[joint];
                        if (weight <= 0 || !bone || !bind) continue;
                        const local = new Vec3();
                        Vec3.transformMat4(local, this._point, bind);
                        probe.influences.push({ bone, local, weight });
                        totalWeight += weight;
                    }
                    if (totalWeight < 0.99) continue;
                    for (const influence of probe.influences) influence.weight /= totalWeight;
                    this.worldPosition(probe, probe.rest);
                    model.inverseTransformPoint(probe.rest, probe.rest);
                    candidates[left >= right ? 0 : 1].push(probe);
                }
            }
        }
        for (let side = 0; side < 2; side++) {
            const points = candidates[side];
            if (!points.length) continue;
            let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
            for (const point of points) {
                minX = Math.min(minX, point.rest.x); maxX = Math.max(maxX, point.rest.x);
                minZ = Math.min(minZ, point.rest.z); maxZ = Math.max(maxZ, point.rest.z);
            }
            const cells: (Probe | undefined)[] = new Array(16);
            for (const point of points) {
                const x = Math.min(3, Math.floor((point.rest.x - minX) / Math.max(1e-6, maxX - minX) * 4));
                const z = Math.min(3, Math.floor((point.rest.z - minZ) / Math.max(1e-6, maxZ - minZ) * 4));
                const cell = z * 4 + x;
                if (!cells[cell] || point.rest.y < cells[cell]!.rest.y) cells[cell] = point;
            }
            for (const point of cells) if (point) this._feet[side].push(point);
            // 原来的平底网格采样会漏掉踮脚/侧翻后的最低鞋边，补充不同倾角的轮廓极点。
            for (const tilt of [Math.PI / 3, Math.PI * 0.47]) {
                for (let direction = 0; direction < 8; direction++) {
                    const angle = direction * Math.PI / 4;
                    const x = Math.cos(angle) * Math.sin(tilt), y = Math.cos(tilt), z = Math.sin(angle) * Math.sin(tilt);
                    let best = points[0], distance = Infinity;
                    for (const point of points) {
                        const d = point.rest.x * x + point.rest.y * y + point.rest.z * z;
                        if (d < distance) { distance = d; best = point; }
                    }
                    if (this._feet[side].indexOf(best) < 0) this._feet[side].push(best);
                }
            }
        }
    }

    get ready(): boolean { return this._feet[0].length > 0 && this._feet[1].length > 0; }

    restUpWorld(out: Vec3) {
        if (!this._model?.isValid) return Vec3.copy(out, Vec3.UP);
        const matrix = this._model.worldMatrix;
        out.set(matrix.m04, matrix.m05, matrix.m06);
        return Vec3.normalize(out, out);
    }

    restWorldY(): number {
        if (!this._model?.isValid || !this.ready) return Number.NaN;
        let y = Infinity;
        for (const foot of this._feet) {
            for (const probe of foot) {
                Vec3.transformMat4(this._point, probe.rest, this._model.worldMatrix);
                y = Math.min(y, this._point.y);
            }
        }
        return y;
    }

    horizontalSurfaceY(plane: CharacterSupportPlane): number {
        let height = -Infinity;
        for (const foot of this._feet) {
            for (const probe of foot) {
                Vec3.transformMat4(this._point, probe.rest, this._model.worldMatrix);
                const x = Math.max(plane.minX, Math.min(plane.maxX, this._point.x));
                const z = Math.max(plane.minZ, Math.min(plane.maxZ, this._point.z));
                height = Math.max(height, (plane.distance - plane.nx * x - plane.nz * z) / plane.ny);
            }
        }
        return height;
    }

    worldY(side: number): number {
        let y = Infinity;
        for (const probe of this._feet[side]) {
            this.worldPosition(probe, this._point);
            y = Math.min(y, this._point.y);
        }
        return y;
    }

    // 返回鞋底相对于斜面的竖直间隙，便于沿世界 Y 调整骨盆与腿部 IK。
    planeClearance(side: number, plane: CharacterSupportPlane): number {
        let clearance = Infinity;
        for (const probe of this._feet[side]) {
            this.worldPosition(probe, this._point);
            const signed = plane.nx * this._point.x + plane.ny * this._point.y
                + plane.nz * this._point.z - plane.distance;
            clearance = Math.min(clearance, signed / plane.ny);
        }
        return clearance;
    }

    worldBounds(side: number, min: Vec3, max: Vec3) {
        min.set(Infinity, Infinity, Infinity);
        max.set(-Infinity, -Infinity, -Infinity);
        for (const probe of this._feet[side]) {
            this.worldPosition(probe, this._point);
            Vec3.min(min, min, this._point);
            Vec3.max(max, max, this._point);
        }
    }

    private worldPosition(probe: Probe, out: Vec3) {
        out.set(0, 0, 0);
        for (const influence of probe.influences) {
            Vec3.transformMat4(this._weighted, influence.local, influence.bone.worldMatrix);
            Vec3.scaleAndAdd(out, out, this._weighted, influence.weight);
        }
    }
}

function footSide(name: string): number {
    if (/^(L_(Foot|Toe)|(?:mixamorig:)?Left(Foot|Toe))/.test(name)) return 0;
    if (/^(R_(Foot|Toe)|(?:mixamorig:)?Right(Foot|Toe))/.test(name)) return 1;
    return -1;
}
