import { primitives, Vec3 } from 'cc';

type ColorTuple = readonly [number, number, number, number];

const COLA_DARK: ColorTuple = [0.24, 0.09, 0.035, 1];
const COLA_LIGHT: ColorTuple = [0.48, 0.22, 0.075, 1];
const COLA_LABEL: ColorTuple = [0.88, 0.055, 0.035, 1];
const COLA_LABEL_LIGHT: ColorTuple = [1, 0.82, 0.42, 1];
const COLA_CAP: ColorTuple = [0.72, 0.035, 0.025, 1];
const SNACK_ORANGE: ColorTuple = [0.96, 0.43, 0.055, 1];
const SNACK_YELLOW: ColorTuple = [1, 0.78, 0.12, 1];
const SNACK_RED: ColorTuple = [0.78, 0.045, 0.035, 1];
const SNACK_DARK: ColorTuple = [0.30, 0.075, 0.035, 1];

class GeometryBuilder {
    readonly positions: number[] = [];
    readonly colors: number[] = [];
    readonly indices: number[] = [];

    append(vertices: ReadonlyArray<readonly [number, number, number]>, faces: readonly number[][], color: ColorTuple): void {
        const offset = this.positions.length / 3;
        for (const vertex of vertices) this.positions.push(vertex[0], vertex[1], vertex[2]);
        for (let index = 0; index < vertices.length; index++) this.colors.push(...color);
        for (const face of faces) {
            for (let index = 1; index < face.length - 1; index++) {
                this.indices.push(offset + face[0], offset + face[index], offset + face[index + 1]);
            }
        }
    }

    box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, color: ColorTuple): void {
        this.append([
            [minX, minY, minZ], [maxX, minY, minZ], [maxX, maxY, minZ], [minX, maxY, minZ],
            [minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ],
        ], [
            [0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3],
            [1, 2, 6, 5], [0, 1, 5, 4], [3, 7, 6, 2],
        ], color);
    }

    prism(profile: ReadonlyArray<readonly [number, number]>, zMin: number, zMax: number, color: ColorTuple): void {
        const count = profile.length;
        const vertices: Array<readonly [number, number, number]> = [];
        for (const [x, y] of profile) vertices.push([x, y, zMin]);
        for (const [x, y] of profile) vertices.push([x, y, zMax]);
        const faces: number[][] = [
            Array.from({ length: count }, (_, index) => count - 1 - index),
            Array.from({ length: count }, (_, index) => count + index),
        ];
        for (let index = 0; index < count; index++) {
            const next = (index + 1) % count;
            faces.push([index, next, count + next, count + index]);
        }
        this.append(vertices, faces, color);
    }

    ringsX(rings: ReadonlyArray<readonly [number, number, ColorTuple]>, centerY: number, centerZ: number, segments = 10): void {
        for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex++) {
            const [x0, r0, color] = rings[ringIndex];
            const [x1, r1] = rings[ringIndex + 1];
            const vertices: Array<readonly [number, number, number]> = [];
            for (let side = 0; side < segments; side++) {
                const angle = side / segments * Math.PI * 2;
                vertices.push([x0, centerY + Math.cos(angle) * r0, centerZ + Math.sin(angle) * r0]);
            }
            for (let side = 0; side < segments; side++) {
                const angle = side / segments * Math.PI * 2;
                vertices.push([x1, centerY + Math.cos(angle) * r1, centerZ + Math.sin(angle) * r1]);
            }
            const faces: number[][] = [];
            if (ringIndex === 0) faces.push(Array.from({ length: segments }, (_, index) => segments - 1 - index));
            if (ringIndex === rings.length - 2) faces.push(Array.from({ length: segments }, (_, index) => segments + index));
            for (let side = 0; side < segments; side++) {
                const next = (side + 1) % segments;
                faces.push([side, next, segments + next, segments + side]);
            }
            this.append(vertices, faces, color);
        }
    }
}

export function buildRigidLitterGeometry(): primitives.IGeometry {
    const builder = new GeometryBuilder();
    // 单只横卧可乐瓶：瓶盖、细颈、肩部、标签与收底均来自连续截面。
    builder.ringsX([
        [-0.46, 0.080, COLA_CAP], [-0.405, 0.080, COLA_CAP],
        [-0.385, 0.066, COLA_DARK], [-0.315, 0.075, COLA_LIGHT],
        [-0.235, 0.135, COLA_LIGHT], [-0.145, 0.155, COLA_DARK],
        [-0.105, 0.158, COLA_LABEL], [0.145, 0.158, COLA_LABEL],
        [0.185, 0.158, COLA_LABEL_LIGHT], [0.315, 0.153, COLA_DARK],
        [0.415, 0.142, COLA_DARK], [0.455, 0.118, COLA_DARK],
    ], 0.055, 0, 10);
    return {
        positions: builder.positions,
        colors: builder.colors,
        indices: builder.indices,
        minPos: new Vec3(-0.46, -0.103, -0.158),
        maxPos: new Vec3(0.455, 0.213, 0.158),
    };
}

export function buildSoftLitterGeometry(): primitives.IGeometry {
    const builder = new GeometryBuilder();
    // 扁薄零食袋：锯齿状封边和轻微鼓包保持清晰的包装袋轮廓。
    builder.prism([
        [-0.42, -0.16], [-0.39, -0.235], [-0.27, -0.21], [-0.12, -0.245],
        [0.03, -0.215], [0.19, -0.24], [0.37, -0.20], [0.42, -0.10],
        [0.39, 0.19], [0.25, 0.235], [0.08, 0.215], [-0.08, 0.245],
        [-0.25, 0.215], [-0.39, 0.185],
    ], -0.060, 0.060, SNACK_ORANGE);
    // 上下压封边、正面徽标和两条折痕使用实体薄层，避免透明贴片。
    builder.box(-0.37, 0.175, -0.064, 0.37, 0.225, 0.064, SNACK_YELLOW);
    builder.box(-0.35, -0.225, -0.064, 0.35, -0.175, 0.064, SNACK_YELLOW);
    builder.prism([[-0.21, -0.09], [0.18, -0.10], [0.25, 0.02], [0.17, 0.13], [-0.18, 0.12], [-0.25, 0.01]],
        0.061, 0.078, SNACK_RED);
    builder.prism([[-0.31, 0.13], [-0.27, 0.15], [-0.08, -0.13], [-0.13, -0.15]],
        0.061, 0.079, SNACK_DARK);
    builder.prism([[0.16, 0.16], [0.20, 0.14], [0.32, -0.12], [0.27, -0.14]],
        0.061, 0.079, SNACK_YELLOW);
    return {
        positions: builder.positions,
        colors: builder.colors,
        indices: builder.indices,
        minPos: new Vec3(-0.42, -0.245, -0.064),
        maxPos: new Vec3(0.42, 0.245, 0.079),
    };
}
