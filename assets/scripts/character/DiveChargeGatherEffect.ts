import { Color, director, EffectAsset, Material, Mesh, MeshRenderer, Node, utils, Vec3, Vec4 } from 'cc';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';

const GATHER_BLUE = new Color(48, 198, 255, 238);
const GATHER_YELLOW = new Color(255, 218, 42, 238);
const GATHER_RED = new Color(255, 54, 24, 238);
const RELEASE_YELLOW_WHITE = new Color(255, 232, 128, 255);
const RELEASE_BURST_SECONDS = 0.38;
const RELEASE_BURST_DISTANCE = 0.92;
const GATHER_TRAVEL_DISTANCE = 0.72;
const GATHER_FIXED_DENSITY = 0.34;
const RAY_INNER_RADIUS = 0.26;
const RAY_OUTER_RADIUS = 0.76;
const RAY_HALF_WIDTH = 0.009;
const RELEASE_HALO_SEGMENTS = 28;
const RELEASE_HALO_HALF_WIDTH = 0.045;
const POSITION_EPSILON_SQ = 0.0004;

// Fixed directions give a stable, authored silhouette around the swimmer while
// keeping the whole gather effect in one mesh / one draw call. Two crossed
// ribbons are created per direction so the streaks remain readable from the
// countdown camera without camera-facing nodes or per-frame billboard work.
const RAY_DIRECTIONS: ReadonlyArray<readonly [number, number, number]> = [
    [1, 0.18, 0.10],
    [-1, 0.26, -0.06],
    [0.38, 0.92, 0.14],
    [-0.42, 0.88, -0.18],
    [0.22, -0.95, 0.12],
    [-0.30, -0.90, -0.16],
    [0.45, 0.32, 0.84],
    [-0.52, 0.25, 0.80],
    [0.48, -0.30, -0.82],
    [-0.46, -0.34, -0.80],
    [0.82, 0.48, 0.28],
    [-0.80, 0.52, 0.32],
    [0.76, -0.54, 0.28],
    [-0.74, -0.56, 0.34],
    [0.16, 0.72, 0.68],
    [-0.18, 0.70, 0.70],
    [0.20, -0.72, 0.66],
    [-0.22, -0.70, 0.68],
    [0.68, 0.10, 0.72],
    [-0.70, 0.08, 0.70],
    [0.66, 0.12, -0.74],
    [-0.68, 0.06, -0.72],
    [0.88, -0.18, 0.42],
    [-0.86, -0.16, 0.46],
    [0.84, 0.20, -0.44],
    [-0.82, 0.22, -0.48],
    [0.10, 0.96, 0.32],
    [-0.12, -0.96, 0.30],
];

/**
 * One pooled mesh/material for the start-dive charge gather effect.
 *
 * Geometry is created once; the shader moves and density-fades each tapered
 * ribbon using cc_time. Runtime code only updates compact material parameters
 * and follows the upper-body anchor at the caller's throttled cadence.
 */
export class DiveChargeGatherEffect {
    private readonly _node: Node;
    private readonly _params = new Vec4(0, 0, GATHER_TRAVEL_DISTANCE, 0);
    // x = continuous phase at y, y = shader time origin, z = cycles/second,
    // w = visible share of the authored ray set.
    private readonly _motionParams = new Vec4(0, 0, gatherSpeedForProgress(0), GATHER_FIXED_DENSITY);
    // x = release mode, y = release start time, z = duration, w = travel distance.
    private readonly _releaseParams = new Vec4(0, 0, RELEASE_BURST_SECONDS, RELEASE_BURST_DISTANCE);
    private readonly _lastWorldPosition = new Vec3(Number.NaN, Number.NaN, Number.NaN);
    private _material: Material | null = null;
    private _mesh: Mesh | null = null;
    private _requestedActive = false;
    private _releaseActive = false;
    private _intensity = 0;
    private _progress = 0;
    private _loadToken = 0;

    constructor(owner: Node) {
        this._node = new Node('DiveChargeGatherEffect');
        this._node.layer = owner.layer;
        this._node.setParent(owner.parent || owner);
        this._node.active = false;
        this.loadEffect();
    }

    setActive(active: boolean) {
        if (this._requestedActive === active) {
            return;
        }
        this._requestedActive = active;
        this.syncVisibility();
    }

    /** Switch the existing pooled gather mesh into a one-shot outward burst. */
    releaseBurst(duration = RELEASE_BURST_SECONDS): number {
        if (!this._node.isValid) {
            return 0;
        }
        const burstDuration = Math.max(0.01, duration);
        this._requestedActive = false;
        this._releaseActive = true;
        this._intensity = 0;
        this._releaseParams.set(1, shaderTimeSeconds(), burstDuration, RELEASE_BURST_DISTANCE);
        if (this._material?.isValid) {
            this._material.setProperty('releaseParams', this._releaseParams);
            this._node.active = true;
        }
        return burstDuration;
    }

    setCharge(intensity: number, progress: number) {
        const next = Math.max(0, Math.min(1, intensity));
        const nextProgress = Math.max(0, Math.min(1, progress));
        if (this._intensity === next && this._progress === nextProgress) {
            return;
        }
        this._intensity = next;
        this._progress = nextProgress;
        if (!this._material?.isValid) {
            return;
        }
        this.updateMotionParams(nextProgress);
        this._params.x = next;
        this._params.w = nextProgress;
        this._material.setProperty('chargeParams', this._params);
        this._material.setProperty('gatherMotion', this._motionParams);
    }

    setWorldPosition(position: Vec3) {
        if (!this._node.isValid || Vec3.squaredDistance(position, this._lastWorldPosition) < POSITION_EPSILON_SQ) {
            return;
        }
        this._lastWorldPosition.set(position);
        this._node.setWorldPosition(position);
    }

    destroy() {
        this._loadToken += 1;
        this._requestedActive = false;
        this._releaseActive = false;
        this._intensity = 0;
        // Disable immediately; component/node destruction is deferred until the
        // end of the frame and must not leave one last gather draw after launch.
        if (this._node.isValid && this._node.active) {
            this._node.active = false;
        }
        if (this._material?.isValid) {
            this._material.destroy();
        }
        if (this._mesh?.isValid) {
            this._mesh.destroy();
        }
        this._material = null;
        this._mesh = null;
        if (this._node.isValid) {
            this._node.destroy();
        }
    }

    private loadEffect() {
        const token = ++this._loadToken;
        loadRaceAsset(RESOURCE_PATHS.diveChargeGatherEffect, EffectAsset, (error, effect) => {
            if (token !== this._loadToken || !this._node.isValid) {
                return;
            }
            if (error || !effect) {
                console.warn('[SpeedSwimming] failed to load dive charge gather effect', error);
                return;
            }
            this.build(effect);
        });
    }

    private build(effect: EffectAsset) {
        if (!this._node.isValid || this._material || this._mesh) {
            return;
        }
        const material = new Material();
        material.initialize({ effectAsset: effect });
        material.name = 'RuntimeDiveChargeGather';
        material.setProperty('chargeBlue', GATHER_BLUE);
        material.setProperty('chargeYellow', GATHER_YELLOW);
        material.setProperty('chargeRed', GATHER_RED);
        material.setProperty('releaseColor', RELEASE_YELLOW_WHITE);
        this._params.x = this._intensity;
        this._params.w = this._progress;
        const now = shaderTimeSeconds();
        this._motionParams.set(0, now, gatherSpeedForProgress(this._progress), GATHER_FIXED_DENSITY);
        material.setProperty('chargeParams', this._params);
        material.setProperty('gatherMotion', this._motionParams);
        material.setProperty('releaseParams', this._releaseParams);

        const mesh = utils.createMesh(buildGatherGeometry());
        const renderer = this._node.addComponent(MeshRenderer);
        renderer.mesh = mesh;
        renderer.setMaterial(material, 0);
        this._material = material;
        this._mesh = mesh;
        this.syncVisibility();
    }

    private updateMotionParams(progress: number) {
        const now = shaderTimeSeconds();
        // Rebase the phase whenever speed changes. The shader continues from
        // this exact phase at the new rate, avoiding jumps between colour tiers.
        const elapsed = Math.max(0, now - this._motionParams.y);
        const phase = positiveMod(this._motionParams.x + elapsed * this._motionParams.z, 1);
        this._motionParams.set(
            phase,
            now,
            gatherSpeedForProgress(progress),
            GATHER_FIXED_DENSITY,
        );
    }

    private syncVisibility() {
        const visible = this._releaseActive
            || (this._requestedActive && !!this._material?.isValid && this._intensity > 0);
        if (this._node.active !== visible) {
            this._node.active = visible;
        }
    }
}

function buildGatherGeometry() {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const direction = new Vec3();
    const sideA = new Vec3();
    const sideB = new Vec3();

    for (let rayIndex = 0; rayIndex < RAY_DIRECTIONS.length; rayIndex++) {
        const value = RAY_DIRECTIONS[rayIndex];
        direction.set(value[0], value[1], value[2]).normalize();
        makePerpendicular(direction, sideA);
        Vec3.cross(sideB, direction, sideA).normalize();
        const phase = rayIndex / RAY_DIRECTIONS.length;
        const densityRank = rayIndex / Math.max(1, RAY_DIRECTIONS.length - 1);
        appendRibbon(positions, normals, uvs, colors, indices, direction, sideA, phase, densityRank);
        appendRibbon(positions, normals, uvs, colors, indices, direction, sideB, phase, densityRank);
    }
    // Three crossed soft rings read as one volumetric halo from the side, top,
    // and diagonal countdown cameras while staying in this mesh's draw call.
    appendReleaseHalo(positions, normals, uvs, colors, indices);
    return { positions, normals, uvs, colors, indices };
}

function appendReleaseHalo(
    positions: number[],
    normals: number[],
    uvs: number[],
    colors: number[],
    indices: number[],
) {
    appendHaloRing(positions, normals, uvs, colors, indices, [1, 0, 0], [0, 1, 0]);
    appendHaloRing(positions, normals, uvs, colors, indices, [1, 0, 0], [0, 0, 1]);
    appendHaloRing(positions, normals, uvs, colors, indices, [0, 1, 0], [0, 0, 1]);
}

function appendHaloRing(
    positions: number[],
    normals: number[],
    uvs: number[],
    colors: number[],
    indices: number[],
    axisA: readonly [number, number, number],
    axisB: readonly [number, number, number],
) {
    for (let segment = 0; segment < RELEASE_HALO_SEGMENTS; segment++) {
        const angle0 = segment / RELEASE_HALO_SEGMENTS * Math.PI * 2;
        const angle1 = (segment + 1) / RELEASE_HALO_SEGMENTS * Math.PI * 2;
        const direction0: readonly [number, number, number] = [
            axisA[0] * Math.cos(angle0) + axisB[0] * Math.sin(angle0),
            axisA[1] * Math.cos(angle0) + axisB[1] * Math.sin(angle0),
            axisA[2] * Math.cos(angle0) + axisB[2] * Math.sin(angle0),
        ];
        const direction1: readonly [number, number, number] = [
            axisA[0] * Math.cos(angle1) + axisB[0] * Math.sin(angle1),
            axisA[1] * Math.cos(angle1) + axisB[1] * Math.sin(angle1),
            axisA[2] * Math.cos(angle1) + axisB[2] * Math.sin(angle1),
        ];
        const base = positions.length / 3;
        appendHaloVertex(positions, normals, uvs, colors, direction0, 1 - RELEASE_HALO_HALF_WIDTH, segment / RELEASE_HALO_SEGMENTS, 0);
        appendHaloVertex(positions, normals, uvs, colors, direction0, 1 + RELEASE_HALO_HALF_WIDTH, segment / RELEASE_HALO_SEGMENTS, 1);
        appendHaloVertex(positions, normals, uvs, colors, direction1, 1 - RELEASE_HALO_HALF_WIDTH, (segment + 1) / RELEASE_HALO_SEGMENTS, 0);
        appendHaloVertex(positions, normals, uvs, colors, direction1, 1 + RELEASE_HALO_HALF_WIDTH, (segment + 1) / RELEASE_HALO_SEGMENTS, 1);
        indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
}

function appendHaloVertex(
    positions: number[],
    normals: number[],
    uvs: number[],
    colors: number[],
    direction: readonly [number, number, number],
    radius: number,
    u: number,
    v: number,
) {
    positions.push(direction[0] * radius, direction[1] * radius, direction[2] * radius);
    normals.push(direction[0], direction[1], direction[2]);
    uvs.push(u, v);
    // Vertex colour B marks release-halo geometry; gather rays keep B at zero.
    colors.push(0, 0, 1, 1);
}

function appendRibbon(
    positions: number[],
    normals: number[],
    uvs: number[],
    colors: number[],
    indices: number[],
    direction: Vec3,
    side: Vec3,
    phase: number,
    densityRank: number,
) {
    const base = positions.length / 3;
    // Wider, bright end is closest to the body; the far end narrows into a tail.
    appendVertex(positions, normals, uvs, colors, direction, side, RAY_INNER_RADIUS, -RAY_HALF_WIDTH, phase, densityRank, 0, 0);
    appendVertex(positions, normals, uvs, colors, direction, side, RAY_INNER_RADIUS, RAY_HALF_WIDTH, phase, densityRank, 0, 1);
    appendVertex(positions, normals, uvs, colors, direction, side, RAY_OUTER_RADIUS, -RAY_HALF_WIDTH * 0.18, phase, densityRank, 1, 0);
    appendVertex(positions, normals, uvs, colors, direction, side, RAY_OUTER_RADIUS, RAY_HALF_WIDTH * 0.18, phase, densityRank, 1, 1);
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
}

function appendVertex(
    positions: number[],
    normals: number[],
    uvs: number[],
    colors: number[],
    direction: Vec3,
    side: Vec3,
    radius: number,
    width: number,
    phase: number,
    densityRank: number,
    u: number,
    v: number,
) {
    positions.push(
        direction.x * radius + side.x * width,
        direction.y * radius + side.y * width,
        direction.z * radius + side.z * width,
    );
    const encodedLength = 1 + phase;
    normals.push(direction.x * encodedLength, direction.y * encodedLength, direction.z * encodedLength);
    uvs.push(u, v);
    colors.push(densityRank, 0, 0, 1);
}

function makePerpendicular(direction: Vec3, out: Vec3) {
    if (Math.abs(direction.y) < 0.88) {
        Vec3.cross(out, direction, Vec3.UP).normalize();
    } else {
        Vec3.cross(out, direction, Vec3.RIGHT).normalize();
    }
}

function gatherSpeedForProgress(progress: number): number {
    const value = Math.max(0, Math.min(1, progress));
    if (value < 0.34) {
        return lerp(2.2, 2.6, value / 0.34);
    }
    if (value < 0.67) {
        return lerp(2.6, 3.25, (value - 0.34) / 0.33);
    }
    return lerp(3.25, 3.9, (value - 0.67) / 0.33);
}

function shaderTimeSeconds(): number {
    return director.root?.cumulativeTime ?? 0;
}

function lerp(from: number, to: number, ratio: number): number {
    return from + (to - from) * Math.max(0, Math.min(1, ratio));
}

function positiveMod(value: number, divisor: number): number {
    return ((value % divisor) + divisor) % divisor;
}
