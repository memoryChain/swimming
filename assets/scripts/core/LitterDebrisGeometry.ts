import { primitives, Vec3 } from 'cc';

type ColorTuple = readonly [number, number, number, number];
type ProfileRing = readonly [
    x: number,
    radiusY: number,
    radiusZ: number,
    centerY: number,
    centerZ: number,
    color: ColorTuple,
];

const COLA_DARK: ColorTuple = [0.24, 0.09, 0.035, 1];
const COLA_LIGHT: ColorTuple = [0.48, 0.22, 0.075, 1];
const COLA_LABEL: ColorTuple = [0.88, 0.055, 0.035, 1];
const COLA_LABEL_LIGHT: ColorTuple = [1, 0.82, 0.42, 1];
const COLA_CAP: ColorTuple = [0.72, 0.035, 0.025, 1];
const WATER_CLEAR: ColorTuple = [0.54, 0.83, 0.9, 1];
const WATER_SHADOW: ColorTuple = [0.28, 0.62, 0.74, 1];
const WATER_LABEL: ColorTuple = [0.08, 0.43, 0.78, 1];
const WATER_LABEL_LIGHT: ColorTuple = [0.88, 0.96, 0.94, 1];
const SPORT_TEAL: ColorTuple = [0.05, 0.48, 0.49, 1];
const SPORT_DARK: ColorTuple = [0.025, 0.19, 0.25, 1];
const SPORT_ORANGE: ColorTuple = [1, 0.38, 0.045, 1];
const SPORT_LIGHT: ColorTuple = [0.9, 0.9, 0.68, 1];
const FOAM_BASE: ColorTuple = [0.68, 0.65, 0.54, 1];
const FOAM_LIGHT: ColorTuple = [0.93, 0.9, 0.76, 1];
const FOAM_RIM: ColorTuple = [0.82, 0.79, 0.67, 1];
const FOAM_SHADOW: ColorTuple = [0.49, 0.47, 0.4, 1];
const FOOD_STAIN: ColorTuple = [0.68, 0.31, 0.055, 1];

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

    /** 用一组相连的椭圆截面生成低面数瓶身，截面偏移用来表现压瘪和不对称。 */
    profileRingsX(rings: readonly ProfileRing[], segments = 10): void {
        const offset = this.positions.length / 3;
        for (const [x, radiusY, radiusZ, centerY, centerZ, color] of rings) {
            for (let side = 0; side < segments; side++) {
                const angle = side / segments * Math.PI * 2;
                this.positions.push(
                    x,
                    centerY + Math.cos(angle) * radiusY,
                    centerZ + Math.sin(angle) * radiusZ,
                );
                this.colors.push(...color);
            }
        }
        for (let ring = 0; ring < rings.length - 1; ring++) {
            const ringStart = offset + ring * segments;
            const nextStart = ringStart + segments;
            for (let side = 0; side < segments; side++) {
                const next = (side + 1) % segments;
                this.indices.push(ringStart + side, ringStart + next, nextStart + next);
                this.indices.push(ringStart + side, nextStart + next, nextStart + side);
            }
        }
        for (let side = 1; side < segments - 1; side++) {
            this.indices.push(offset, offset + segments - side, offset + segments - side - 1);
            const last = offset + (rings.length - 1) * segments;
            this.indices.push(last, last + side, last + side + 1);
        }
    }
}

export function buildBottleLitterGeometry(variant: number): primitives.IGeometry {
    const normalized = ((Math.floor(variant) % 3) + 3) % 3;
    if (normalized === 1) return buildCrushedWaterBottleGeometry();
    if (normalized === 2) return buildSportDrinkBottleGeometry();
    return buildClassicColaBottleGeometry();
}

function buildClassicColaBottleGeometry(): primitives.IGeometry {
    const builder = new GeometryBuilder();
    builder.profileRingsX([
        [-0.39, 0.064, 0.064, 0.035, 0, COLA_CAP],
        [-0.345, 0.064, 0.064, 0.035, 0, COLA_CAP],
        [-0.325, 0.054, 0.054, 0.035, 0, COLA_DARK],
        [-0.265, 0.064, 0.064, 0.035, 0, COLA_LIGHT],
        [-0.195, 0.108, 0.108, 0.035, 0, COLA_LIGHT],
        [-0.125, 0.128, 0.128, 0.035, 0, COLA_DARK],
        [-0.09, 0.13, 0.13, 0.035, 0, COLA_LABEL],
        [0.12, 0.13, 0.13, 0.035, 0, COLA_LABEL],
        [0.155, 0.13, 0.13, 0.035, 0, COLA_LABEL_LIGHT],
        [0.275, 0.126, 0.126, 0.035, 0, COLA_DARK],
        [0.355, 0.112, 0.112, 0.035, 0, COLA_DARK],
        [0.39, 0.092, 0.092, 0.035, 0, COLA_DARK],
    ]);
    return geometry(builder, new Vec3(-0.39, -0.095, -0.13), new Vec3(0.39, 0.165, 0.13));
}

function buildCrushedWaterBottleGeometry(): primitives.IGeometry {
    const builder = new GeometryBuilder();
    builder.profileRingsX([
        [-0.37, 0.052, 0.048, 0.015, 0.002, WATER_LABEL],
        [-0.325, 0.052, 0.048, 0.015, 0.002, WATER_LABEL],
        [-0.30, 0.045, 0.042, 0.014, 0.002, WATER_SHADOW],
        [-0.245, 0.074, 0.064, 0.012, 0.008, WATER_CLEAR],
        [-0.17, 0.112, 0.078, 0.004, 0.014, WATER_CLEAR],
        [-0.08, 0.095, 0.062, -0.012, 0.02, WATER_SHADOW],
        [-0.02, 0.116, 0.074, -0.018, 0.012, WATER_LABEL],
        [0.12, 0.102, 0.065, -0.006, -0.008, WATER_LABEL_LIGHT],
        [0.21, 0.116, 0.076, 0.012, -0.015, WATER_CLEAR],
        [0.29, 0.09, 0.062, 0.018, -0.008, WATER_SHADOW],
        [0.37, 0.074, 0.055, 0.012, 0, WATER_CLEAR],
    ], 8);
    return geometry(builder, new Vec3(-0.37, -0.134, -0.092), new Vec3(0.37, 0.135, 0.092));
}

function buildSportDrinkBottleGeometry(): primitives.IGeometry {
    const builder = new GeometryBuilder();
    builder.profileRingsX([
        [-0.33, 0.082, 0.082, 0.025, 0, SPORT_ORANGE],
        [-0.275, 0.082, 0.082, 0.025, 0, SPORT_ORANGE],
        [-0.255, 0.066, 0.066, 0.025, 0, SPORT_DARK],
        [-0.205, 0.102, 0.102, 0.025, 0, SPORT_TEAL],
        [-0.145, 0.144, 0.13, 0.025, 0, SPORT_TEAL],
        [-0.09, 0.15, 0.135, 0.025, 0, SPORT_DARK],
        [0.08, 0.15, 0.135, 0.025, 0, SPORT_LIGHT],
        [0.14, 0.15, 0.135, 0.025, 0, SPORT_ORANGE],
        [0.26, 0.142, 0.128, 0.025, 0, SPORT_TEAL],
        [0.33, 0.12, 0.108, 0.025, 0, SPORT_DARK],
    ]);
    return geometry(builder, new Vec3(-0.33, -0.125, -0.135), new Vec3(0.33, 0.175, 0.135));
}

export function buildMealTrayLitterGeometry(): primitives.IGeometry {
    const builder = new GeometryBuilder();
    const outer: ReadonlyArray<readonly [number, number]> = [
        [-0.38, -0.205], [-0.32, -0.255], [0.31, -0.255], [0.39, -0.185],
        [0.39, 0.185], [0.31, 0.255], [-0.32, 0.255], [-0.39, 0.19],
    ];
    const lid: ReadonlyArray<readonly [number, number]> = [
        [-0.32, -0.16], [-0.27, -0.205], [0.25, -0.205], [0.32, -0.15],
        [0.32, 0.145], [0.25, 0.2], [-0.27, 0.2], [-0.32, 0.15],
    ];
    builder.prism(outer, -0.07, 0.005, FOAM_BASE);
    builder.prism(lid, 0.006, 0.075, FOAM_LIGHT);
    builder.box(-0.34, -0.23, 0.012, 0.34, -0.19, 0.09, FOAM_RIM);
    builder.box(-0.34, 0.19, 0.012, 0.34, 0.23, 0.09, FOAM_RIM);
    builder.box(-0.375, -0.17, 0.012, -0.325, 0.17, 0.09, FOAM_RIM);
    builder.box(0.325, -0.17, 0.012, 0.375, 0.17, 0.09, FOAM_RIM);
    builder.box(-0.31, 0.225, -0.045, 0.31, 0.262, 0.035, FOAM_SHADOW);
    builder.prism([
        [-0.19, -0.08], [0.11, -0.1], [0.2, -0.015], [0.13, 0.08], [-0.16, 0.07],
    ], 0.076, 0.086, FOOD_STAIN);
    builder.box(-0.025, -0.17, 0.076, 0.015, 0.14, 0.087, FOAM_RIM);
    return geometry(builder, new Vec3(-0.39, -0.255, -0.07), new Vec3(0.39, 0.262, 0.09));
}

function geometry(builder: GeometryBuilder, minPos: Vec3, maxPos: Vec3): primitives.IGeometry {
    return {
        positions: builder.positions,
        colors: builder.colors,
        indices: builder.indices,
        minPos,
        maxPos,
    };
}
