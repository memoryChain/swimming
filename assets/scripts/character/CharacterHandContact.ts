import { gfx, Node, Quat, SkinnedMeshRenderer, Vec3 } from 'cc';

type LimbBounds = { bone: Node | null; min: Vec3; max: Vec3 };

// 加载时测量左右手臂避障范围和规范 T 姿势掌心轴，姿态校正由动作控制器负责。
export class CharacterHandContact {
    private _model: Node | null = null;
    private readonly _limbs: LimbBounds[] = Array.from({ length: 6 }, () => ({ bone: null,
        min: new Vec3(), max: new Vec3() }));
    private readonly _point = new Vec3();
    private readonly _local = new Vec3();
    private readonly _world = new Vec3();
    private readonly _corners = Array.from({ length: 48 }, () => new Vec3());
    private readonly _palmNormals = [new Vec3(), new Vec3()];

    clear() {
        this._model = null;
        for (const limb of this._limbs) limb.bone = null;
    }

    bind(model: Node, renderers: readonly SkinnedMeshRenderer[]) {
        this.clear(); this._model = model;
        for (const limb of this._limbs) {
            limb.min.set(Infinity, Infinity, Infinity); limb.max.set(-Infinity, -Infinity, -Infinity);
        }
        for (const { mesh, skeleton, skinningRoot } of renderers) {
            if (!mesh || !skeleton || !skinningRoot) continue;
            const bones = skeleton.joints.map(path => skinningRoot.getChildByPath(path));
            const names = [/^(L_Hand|(?:mixamorig:)?LeftHand)$/, /^(R_Hand|(?:mixamorig:)?RightHand)$/,
                /^(L_Forearm|(?:mixamorig:)?LeftForeArm)$/, /^(R_Forearm|(?:mixamorig:)?RightForeArm)$/,
                /^(L_Upperarm|(?:mixamorig:)?LeftArm)$/, /^(R_Upperarm|(?:mixamorig:)?RightArm)$/];
            const limbs = names.map(name => bones.find(b => name.test(b?.name ?? '')));
            const sides = bones.map(bone => {
                for (let node = bone; node && node !== skinningRoot; node = node.parent) {
                    const index = limbs.indexOf(node);
                    if (index >= 0) return index;
                }
                return -1;
            });
            for (let p = 0; p < mesh.struct.primitives.length; p++) {
                const positions = mesh.readAttribute(p, gfx.AttributeName.ATTR_POSITION);
                const joints = mesh.readAttribute(p, gfx.AttributeName.ATTR_JOINTS);
                const weights = mesh.readAttribute(p, gfx.AttributeName.ATTR_WEIGHTS);
                if (!positions || !joints || !weights) continue;
                const totals = new Array<number>(6).fill(0);
                for (let v = 0; v < positions.length / 3; v++) {
                    totals.fill(0);
                    for (let k = 0; k < 4; k++) {
                        const i = v * 4 + k, side = sides[joints[i]];
                        if (side >= 0) totals[side] += weights[i];
                    }
                    let side = 0;
                    for (let i = 1; i < 6; i++) if (totals[i] > totals[side]) side = i;
                    if (totals[side] < 0.5) continue;
                    const hand = this._limbs[side], bone = limbs[side];
                    if (!bone || (hand.bone && hand.bone !== bone)) continue;
                    this._point.set(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
                    this._world.set(0, 0, 0); let total = 0;
                    for (let k = 0; k < 4; k++) {
                        const i = v * 4 + k, joint = joints[i], weight = weights[i];
                        if (weight <= 0 || !bones[joint] || !skeleton.bindposes[joint]) continue;
                        Vec3.transformMat4(this._local, this._point, skeleton.bindposes[joint]);
                        Vec3.transformMat4(this._local, this._local, bones[joint].worldMatrix);
                        Vec3.scaleAndAdd(this._world, this._world, this._local, weight); total += weight;
                    }
                    if (total < 0.99) continue;
                    Vec3.multiplyScalar(this._world, this._world, 1 / total);
                    bone.inverseTransformPoint(this._local, this._world);
                    Vec3.min(hand.min, hand.min, this._local); Vec3.max(hand.max, hand.max, this._local);
                    hand.bone = bone;
                }
            }
        }
        this.capturePalmNormals();
    }

    /** 规范 T 姿势掌心朝模型下方；绑定时换算到各自手骨，避免左右手轴号相反。 */
    private capturePalmNormals() {
        const rotation = new Quat();
        const m = this._model.worldMatrix;
        this._world.set(-m.m04, -m.m05, -m.m06);
        Vec3.normalize(this._world, this._world);
        for (let side = 0; side < 2; side++) {
            const bone = this._limbs[side].bone;
            if (!bone) continue;
            bone.getWorldRotation(rotation); Quat.invert(rotation, rotation);
            Vec3.transformQuat(this._palmNormals[side], this._world, rotation);
        }
    }

    palmNormalWorld(side: number, out: Vec3) {
        const m = this._limbs[side].bone.worldMatrix, n = this._palmNormals[side];
        out.set(m.m00 * n.x + m.m04 * n.y + m.m08 * n.z,
            m.m01 * n.x + m.m05 * n.y + m.m09 * n.z,
            m.m02 * n.x + m.m06 * n.y + m.m10 * n.z);
        Vec3.normalize(out, out);
    }

    get ready() { return !!this._limbs[0].bone?.isValid && !!this._limbs[1].bone?.isValid; }
    get forwardSign() { return this._model && this._model.worldMatrix.m08 < 0 ? -1 : 1; }

    handWorldBounds(side: number, min: Vec3, max: Vec3) {
        this.worldBounds(side, min, max, Infinity, -Infinity, false, true);
    }

    worldBounds(side: number, min: Vec3, max: Vec3, belowY = Infinity, aboveY = -Infinity, reusePose = false, handOnly = false) {
        min.set(Infinity, Infinity, Infinity); max.set(-Infinity, -Infinity, -Infinity);
        for (let part = side; part < (handOnly ? 2 : 6); part += 2) {
            const hand = this._limbs[part];
            if (!hand.bone?.isValid) continue;
            const matrix = hand.bone.worldMatrix;
            const start = part * 8;
            for (let corner = 0; corner < 8; corner++) {
                const point = this._corners[start + corner];
                // 同一次姿势检查的各高度段复用世界顶点，不重复计算骨骼变换。
                if (!reusePose) {
                    this._local.set(corner & 1 ? hand.max.x : hand.min.x,
                        corner & 2 ? hand.max.y : hand.min.y, corner & 4 ? hand.max.z : hand.min.z);
                    Vec3.transformMat4(point, this._local, matrix);
                }
                if (point.y <= belowY && point.y >= aboveY) { Vec3.min(min, min, point); Vec3.max(max, max, point); }
            }
            // 只考虑可能碰到台身的下半部分，包括盒边与台高的交点。
            for (let corner = 0; corner < 8; corner++) {
                for (let bit = 1; bit <= 4; bit *= 2) {
                    if (corner & bit) continue;
                    const a = this._corners[start + corner], b = this._corners[start + (corner | bit)];
                    for (let edge = 0; edge < 2; edge++) {
                        const y = edge ? aboveY : belowY;
                        if ((a.y < y && b.y > y) || (b.y < y && a.y > y)) {
                            Vec3.lerp(this._world, a, b, (y - a.y) / (b.y - a.y));
                            Vec3.min(min, min, this._world); Vec3.max(max, max, this._world);
                        }
                    }
                }
            }
        }
    }
}
