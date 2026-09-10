export type RiverCourseFrame = {
    x: number;
    z: number;
    tangentX: number;
    tangentZ: number;
    normalX: number;
    normalZ: number;
    curvature: number;
};

export type RiverCoursePathOptions = {
    startX: number;
    startZ?: number;
    direction?: number;
    length: number;
    startStraight: number;
    finishStraight: number;
    curveCount: number;
    headingDegrees: number;
    sampleSpacing: number;
};

const DEG2RAD = Math.PI / 180;
const MIN_LENGTH = 1;
const MIN_SPACING = 0.25;

/**
 * Allocation-free sampled centre line for the local river-brawl course.
 * Distance remains the authoritative race coordinate; this class only maps it
 * to a world-space centre/tangent/normal frame.
 */
export class RiverCoursePath {
    private _length = MIN_LENGTH;
    private _spacing = 1;
    private _direction = 1;
    private _sampleCount = 2;
    private _x = new Float32Array(2);
    private _z = new Float32Array(2);
    private _tangentX = new Float32Array(2);
    private _tangentZ = new Float32Array(2);
    private _curvature = new Float32Array(2);

    constructor(options: RiverCoursePathOptions) {
        this.reset(options);
    }

    get length(): number {
        return this._length;
    }

    get sampleSpacing(): number {
        return this._spacing;
    }

    reset(options: RiverCoursePathOptions): void {
        this._length = finitePositive(options.length, MIN_LENGTH);
        this._spacing = Math.max(MIN_SPACING, finitePositive(options.sampleSpacing, 1));
        this._direction = options.direction !== undefined && options.direction < 0 ? -1 : 1;
        this._sampleCount = Math.max(2, Math.ceil(this._length / this._spacing) + 1);
        this._spacing = this._length / (this._sampleCount - 1);
        this._x = new Float32Array(this._sampleCount);
        this._z = new Float32Array(this._sampleCount);
        this._tangentX = new Float32Array(this._sampleCount);
        this._tangentZ = new Float32Array(this._sampleCount);
        this._curvature = new Float32Array(this._sampleCount);

        const startX = finite(options.startX, 0);
        const startZ = finite(options.startZ ?? 0, 0);
        const startStraight = clamp(finiteNonNegative(options.startStraight), 0, this._length * 0.45);
        const finishStraight = clamp(
            finiteNonNegative(options.finishStraight),
            0,
            Math.max(0, this._length - startStraight),
        );
        const curvedLength = Math.max(0, this._length - startStraight - finishStraight);
        const curveCount = Math.max(0, Math.round(finiteNonNegative(options.curveCount)));
        const amplitude = clamp(Math.abs(finite(options.headingDegrees, 0)), 0, 35) * DEG2RAD;
        const angularRate = curvedLength > 0 && curveCount > 0
            ? Math.PI * 2 * curveCount / curvedLength
            : 0;

        for (let i = 0; i < this._sampleCount; i++) {
            const distance = i * this._spacing;
            const heading = courseHeading(distance, startStraight, curvedLength, amplitude, angularRate);
            this._tangentX[i] = this._direction * Math.cos(heading);
            this._tangentZ[i] = Math.sin(heading);
            this._curvature[i] = courseCurvature(distance, startStraight, curvedLength, amplitude, angularRate);
        }

        this._x[0] = startX;
        this._z[0] = startZ;
        for (let i = 1; i < this._sampleCount; i++) {
            // Midpoint integration keeps the sampled distance very close to arc
            // length without runtime searches or spline allocations.
            const midDistance = (i - 0.5) * this._spacing;
            const heading = courseHeading(midDistance, startStraight, curvedLength, amplitude, angularRate);
            this._x[i] = this._x[i - 1] + this._direction * Math.cos(heading) * this._spacing;
            this._z[i] = this._z[i - 1] + Math.sin(heading) * this._spacing;
        }
    }

    sample(distance: number, out: RiverCourseFrame): RiverCourseFrame {
        const d = finite(distance, 0);
        if (d <= 0) {
            return this.writeExtrapolated(0, d, out);
        }
        if (d >= this._length) {
            return this.writeExtrapolated(this._sampleCount - 1, d - this._length, out);
        }
        const sample = d / this._spacing;
        const first = Math.min(this._sampleCount - 2, Math.floor(sample));
        const ratio = sample - first;
        const second = first + 1;
        const tx = lerp(this._tangentX[first], this._tangentX[second], ratio);
        const tz = lerp(this._tangentZ[first], this._tangentZ[second], ratio);
        const invLength = 1 / Math.max(1e-6, Math.hypot(tx, tz));
        out.x = lerp(this._x[first], this._x[second], ratio);
        out.z = lerp(this._z[first], this._z[second], ratio);
        out.tangentX = tx * invLength;
        out.tangentZ = tz * invLength;
        // Keep positive lateral aligned with +Z on both authored course directions.
        out.normalX = -this._direction * out.tangentZ;
        out.normalZ = this._direction * out.tangentX;
        out.curvature = lerp(this._curvature[first], this._curvature[second], ratio);
        return out;
    }

    private writeExtrapolated(index: number, extraDistance: number, out: RiverCourseFrame): RiverCourseFrame {
        const tx = this._tangentX[index];
        const tz = this._tangentZ[index];
        out.x = this._x[index] + tx * extraDistance;
        out.z = this._z[index] + tz * extraDistance;
        out.tangentX = tx;
        out.tangentZ = tz;
        out.normalX = -this._direction * tz;
        out.normalZ = this._direction * tx;
        out.curvature = 0;
        return out;
    }
}

function courseHeading(
    distance: number,
    startStraight: number,
    curvedLength: number,
    amplitude: number,
    angularRate: number,
): number {
    if (curvedLength <= 0 || angularRate <= 0 || distance <= startStraight || distance >= startStraight + curvedLength) {
        return 0;
    }
    return amplitude * Math.sin((distance - startStraight) * angularRate);
}

function courseCurvature(
    distance: number,
    startStraight: number,
    curvedLength: number,
    amplitude: number,
    angularRate: number,
): number {
    if (curvedLength <= 0 || angularRate <= 0 || distance <= startStraight || distance >= startStraight + curvedLength) {
        return 0;
    }
    return amplitude * angularRate * Math.cos((distance - startStraight) * angularRate);
}

function finite(value: number, fallback: number): number {
    return Number.isFinite(value) ? value : fallback;
}

function finitePositive(value: number, fallback: number): number {
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteNonNegative(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, ratio: number): number {
    return a + (b - a) * ratio;
}
