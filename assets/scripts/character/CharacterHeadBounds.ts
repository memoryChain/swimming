import { Camera, gfx, Node, SkinnedMeshRenderer, Vec3 } from 'cc';

// 模型加载时测量头发、帽子等头部网格，在头骨空间缓存包围盒。
// 只投影八个角点即可跟随转头、动作和缩放，避免逐帧读取网格或把举手算成头顶。
export class CharacterHeadBounds {
    private _head: Node | null = null;
    private readonly _min = new Vec3();
    private readonly _max = new Vec3();
    private readonly _point = new Vec3();
    private readonly _local = new Vec3();
    private readonly _world = new Vec3();
    private readonly _screen = new Vec3();

    clear() { this._head = null; }

    bind(renderers: readonly SkinnedMeshRenderer[]) {
        this.clear();
        this._min.set(Infinity, Infinity, Infinity);
        this._max.set(-Infinity, -Infinity, -Infinity);
        for (const renderer of renderers) {
            const { mesh, skeleton, skinningRoot } = renderer;
            if (!mesh || !skeleton || !skinningRoot) continue;
            const bones = skeleton.joints.map(path => skinningRoot.getChildByPath(path));
            const head = bones.find(bone => /^(?:mixamorig:)?Head$/.test(bone?.name ?? ''));
            if (!head || (this._head && this._head !== head)) continue;
            for (let primitive = 0; primitive < mesh.struct.primitives.length; primitive++) {
                const positions = mesh.readAttribute(primitive, gfx.AttributeName.ATTR_POSITION);
                const joints = mesh.readAttribute(primitive, gfx.AttributeName.ATTR_JOINTS);
                const weights = mesh.readAttribute(primitive, gfx.AttributeName.ATTR_WEIGHTS);
                if (!positions || !joints || !weights) continue;
                for (let vertex = 0; vertex < positions.length / 3; vertex++) {
                    let headWeight = 0;
                    for (let slot = 0; slot < 4; slot++) {
                        const index = vertex * 4 + slot;
                        if (bones[joints[index]] === head) headWeight += weights[index];
                    }
                    if (headWeight < 0.5) continue;
                    this._point.set(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]);
                    this._world.set(0, 0, 0);
                    let totalWeight = 0;
                    for (let slot = 0; slot < 4; slot++) {
                        const index = vertex * 4 + slot;
                        const joint = joints[index], weight = weights[index];
                        const bone = bones[joint], bind = skeleton.bindposes[joint];
                        if (weight <= 0 || !bone || !bind) continue;
                        Vec3.transformMat4(this._local, this._point, bind);
                        Vec3.transformMat4(this._local, this._local, bone.worldMatrix);
                        Vec3.scaleAndAdd(this._world, this._world, this._local, weight);
                        totalWeight += weight;
                    }
                    if (totalWeight < 0.99) continue;
                    Vec3.multiplyScalar(this._world, this._world, 1 / totalWeight);
                    head.inverseTransformPoint(this._local, this._world);
                    Vec3.min(this._min, this._min, this._local);
                    Vec3.max(this._max, this._max, this._local);
                    this._head = head;
                }
            }
        }
    }

    topScreenPosition(camera: Camera, out: Vec3): boolean {
        if (!this._head?.isValid) return false;
        let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
        const matrix = this._head.worldMatrix;
        for (let corner = 0; corner < 8; corner++) {
            this._local.set(corner & 1 ? this._max.x : this._min.x,
                corner & 2 ? this._max.y : this._min.y, corner & 4 ? this._max.z : this._min.z);
            Vec3.transformMat4(this._world, this._local, matrix);
            camera.worldToScreen(this._world, this._screen);
            minX = Math.min(minX, this._screen.x);
            maxX = Math.max(maxX, this._screen.x);
            maxY = Math.max(maxY, this._screen.y);
        }
        out.set((minX + maxX) * 0.5, maxY, this._screen.z);
        return true;
    }
}
