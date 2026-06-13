import { MeshRenderer, Node, Vec3 } from 'cc';
import { DIVE_BALANCE } from '../core/GameBalance';
import { DEFAULT_POOL_DEFINITION, PoolDefinition } from './VenueConfig';

const MIN_COURSE_LENGTH = 1;
const DEFAULT_WATER_Y = 0.055;
const DEFAULT_SWIM_Y = 0;
const SWIMMER_CENTER_EDGE_INSET = 0.45;
const SWIMMER_FRONT_BOUNDARY_CLEARANCE = 2.35;
const STANDING_MODEL_LOCAL_Y = 0.55;
const PLATFORM_STANDING_LIFT = 0.04;
const WATER_NODE_NAMES = ['poolwatersurface'];
const FLOOR_NODE_NAMES = ['pool_floor'];
const START_BLOCK_NODE_NAMES = ['start_block_top_near'];
const COURSE_START_MARKER_NAMES = ['racecoursestartmarker', 'poolracestart'];
const COURSE_FINISH_MARKER_NAMES = ['racecoursefinishmarker', 'poolracefinish'];

type SceneBounds = {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
};

export class RaceCourseLayout {
    startX: number;
    finishX: number;
    poolStartX: number;
    poolFinishX: number;
    platformX: number;
    platformY: number;
    laneCount: number;
    laneWidth: number;
    poolWidth: number;
    courseLength: number;
    direction: number;
    waterY: number;
    swimY: number;
    platformBackOffset: number;
    platformYOffset: number;
    platformZOffset: number;
    entryYOffset: number;

    constructor(definition: PoolDefinition) {
        this.resetToDefinition(definition);
    }

    resetToDefinition(definition: PoolDefinition) {
        this.laneCount = definition.laneCount;
        this.laneWidth = definition.laneWidth;
        this.poolWidth = definition.laneCount * definition.laneWidth;
        const delta = definition.finishX - definition.startX;
        this.direction = delta >= 0 ? 1 : -1;
        this.courseLength = Math.max(MIN_COURSE_LENGTH, Math.abs(delta));
        this.waterY = definition.waterY ?? DEFAULT_WATER_Y;
        this.swimY = definition.swimY ?? DEFAULT_SWIM_Y;
        this.platformBackOffset = definition.platformBackOffset ?? Math.abs(DIVE_BALANCE.platformNodeOffset.x);
        this.platformYOffset = definition.platformYOffset ?? DIVE_BALANCE.platformNodeOffset.y;
        this.platformZOffset = definition.platformZOffset ?? DIVE_BALANCE.platformNodeOffset.z;
        this.entryYOffset = definition.entryYOffset ?? 0.02;
        this.poolStartX = definition.startX;
        this.poolFinishX = definition.finishX;
        this.startX = this.swimmerRootInsideBoundary(this.insetFromPoolEdge(this.poolStartX, this.direction), this.direction);
        this.finishX = this.swimmerRootInsideBoundary(this.insetFromPoolEdge(this.poolFinishX, -this.direction), -this.direction);
        this.platformX = this.poolStartX - this.direction * this.platformBackOffset;
        this.platformY = this.swimY + this.platformYOffset;
    }

    calibrateFromPoolScene(pool: Node, definition: PoolDefinition, debug?: (message: string) => void): boolean {
        if (!pool?.isValid) {
            return false;
        }

        const waterBounds = collectNamedBounds(pool, WATER_NODE_NAMES);
        const floorBounds = collectNamedBounds(pool, FLOOR_NODE_NAMES);
        const startMarker = findNamedWorldPosition(pool, COURSE_START_MARKER_NAMES);
        const finishMarker = findNamedWorldPosition(pool, COURSE_FINISH_MARKER_NAMES);
        const courseBounds = validCourseBounds(waterBounds) ? waterBounds : floorBounds;
        if ((!startMarker || !finishMarker) && (!courseBounds || !validCourseBounds(courseBounds))) {
            debug?.('pool course bounds not found; using configured race layout');
            return false;
        }

        const configuredDirection = definition.finishX - definition.startX >= 0 ? 1 : -1;
        this.direction = configuredDirection;
        this.courseLength = Math.max(MIN_COURSE_LENGTH, Math.abs(definition.finishX - definition.startX));
        if (startMarker && finishMarker) {
            this.poolStartX = startMarker.x;
            this.poolFinishX = finishMarker.x;
            this.startX = this.swimmerRootInsideBoundary(startMarker.x, this.direction);
            this.finishX = this.swimmerRootInsideBoundary(finishMarker.x, -this.direction);
        } else if (courseBounds) {
            const minX = Math.min(courseBounds.minX, courseBounds.maxX);
            const maxX = Math.max(courseBounds.minX, courseBounds.maxX);
            this.poolStartX = configuredDirection > 0 ? minX : maxX;
            this.poolFinishX = configuredDirection > 0 ? maxX : minX;
            this.startX = this.swimmerRootInsideBoundary(this.insetFromPoolEdge(this.poolStartX, this.direction), this.direction);
            this.finishX = this.swimmerRootInsideBoundary(this.insetFromPoolEdge(this.poolFinishX, -this.direction), -this.direction);
        }

        if (waterBounds) {
            this.waterY = waterBounds.maxY;
        }
        this.swimY = definition.swimY ?? DEFAULT_SWIM_Y;

        const platformBounds = collectNamedBounds(pool, START_BLOCK_NODE_NAMES);
        if (platformBounds) {
            this.platformX = (platformBounds.minX + platformBounds.maxX) * 0.5;
            this.platformY = platformBounds.maxY - STANDING_MODEL_LOCAL_Y + PLATFORM_STANDING_LIFT;
        } else {
            this.platformX = this.poolStartX - this.direction * this.platformBackOffset;
            this.platformY = this.swimY + this.platformYOffset + 0.02;
        }
        this.clampRootCourseRange();

        debug?.(
            `pool course calibrated start=${this.poolStartX.toFixed(2)} finish=${this.poolFinishX.toFixed(2)} ` +
            `swim=${this.startX.toFixed(2)}..${this.finishX.toFixed(2)} swimY=${this.swimY.toFixed(3)} ` +
            `waterY=${this.waterY.toFixed(3)} platformY=${this.platformY.toFixed(3)}`,
        );
        return true;
    }

    distanceToWorldX(distance: number): number {
        const ratio = this.distanceToCourseOffset(distance) / this.courseLength;
        return this.startX + (this.finishX - this.startX) * ratio;
    }

    directionAtDistance(distance: number): number {
        const lap = Math.floor(Math.max(0, distance) / this.courseLength);
        return lap % 2 === 0 ? this.direction : -this.direction;
    }

    finishDirectionAtDistance(distance: number): number {
        return this.directionAtDistance(Math.max(0, distance - 0.001));
    }

    currentCourseEndDistance(playerDistance: number, raceDistance: number): number {
        const distance = Math.max(0, playerDistance);
        const nextCourseEnd = (Math.floor(distance / this.courseLength) + 1) * this.courseLength;
        return Math.min(raceDistance, nextCourseEnd);
    }

    distanceToCurrentCourseEnd(playerDistance: number, raceDistance: number): number {
        return Math.max(0, this.currentCourseEndDistance(playerDistance, raceDistance) - playerDistance);
    }

    swimPosition(distance: number, z: number): Vec3 {
        return new Vec3(this.distanceToWorldX(distance), this.swimY, z);
    }

    entryPosition(distance: number, z: number): Vec3 {
        return new Vec3(this.distanceToWorldX(distance), this.swimY + this.entryYOffset, z);
    }

    platformPosition(z: number): Vec3 {
        return new Vec3(
            this.platformX,
            this.platformY,
            z + this.platformZOffset,
        );
    }

    clampSwimWorldX(x: number): number {
        const minX = Math.min(this.startX, this.finishX);
        const maxX = Math.max(this.startX, this.finishX);
        return Math.max(minX, Math.min(maxX, x));
    }

    private distanceToCourseOffset(distance: number): number {
        const lap = Math.floor(Math.max(0, distance) / this.courseLength);
        const lapDistance = Math.max(0, distance) % this.courseLength;
        return lap % 2 === 0 ? lapDistance : this.courseLength - lapDistance;
    }

    private insetFromPoolEdge(edgeX: number, inwardDirection: number): number {
        const maxInset = Math.max(0, this.courseLength * 0.12);
        const inset = Math.min(SWIMMER_CENTER_EDGE_INSET, maxInset);
        return edgeX + inwardDirection * inset;
    }

    private swimmerRootInsideBoundary(boundaryX: number, inwardDirection: number): number {
        const maxClearance = Math.max(0, this.courseLength * 0.18);
        const clearance = Math.min(SWIMMER_FRONT_BOUNDARY_CLEARANCE, maxClearance);
        return boundaryX + inwardDirection * clearance;
    }

    private clampRootCourseRange() {
        if (this.direction > 0 && this.startX > this.finishX) {
            const center = (this.poolStartX + this.poolFinishX) * 0.5;
            this.startX = center;
            this.finishX = center;
        } else if (this.direction < 0 && this.startX < this.finishX) {
            const center = (this.poolStartX + this.poolFinishX) * 0.5;
            this.startX = center;
            this.finishX = center;
        }
    }
}

export const DEFAULT_RACE_COURSE_LAYOUT = new RaceCourseLayout(DEFAULT_POOL_DEFINITION);

function validCourseBounds(bounds: SceneBounds | null): bounds is SceneBounds {
    return !!bounds && Math.abs(bounds.maxX - bounds.minX) >= MIN_COURSE_LENGTH;
}

function collectNamedBounds(root: Node, names: string[]): SceneBounds | null {
    let bounds: SceneBounds | null = null;
    visit(root, (node) => {
        if (!matchesAnyName(node.name, names)) {
            return;
        }
        const nodeBounds = boundsForNode(node);
        if (nodeBounds) {
            bounds = mergeBounds(bounds, nodeBounds);
        }
    });
    return bounds;
}

function findNamedWorldPosition(root: Node, names: string[]): Vec3 | null {
    let result: Vec3 | null = null;
    visit(root, (node) => {
        if (result || !matchesAnyName(node.name, names)) {
            return;
        }
        result = new Vec3();
        node.getWorldPosition(result);
    });
    return result;
}

function boundsForNode(node: Node): SceneBounds | null {
    let bounds: SceneBounds | null = null;
    const renderer = node.getComponent(MeshRenderer);
    const rendererBounds = renderer ? boundsForRenderer(renderer) : null;
    if (rendererBounds) {
        bounds = mergeBounds(bounds, rendererBounds);
    } else {
        const world = new Vec3();
        node.getWorldPosition(world);
        bounds = mergeBounds(bounds, {
            minX: world.x,
            maxX: world.x,
            minY: world.y,
            maxY: world.y,
            minZ: world.z,
            maxZ: world.z,
        });
    }
    for (const child of node.children) {
        bounds = mergeBounds(bounds, boundsForNode(child));
    }
    return bounds;
}

function boundsForRenderer(renderer: MeshRenderer): SceneBounds | null {
    const model = (renderer as unknown as { model?: { worldBounds?: unknown } }).model;
    const worldBounds = model?.worldBounds as { center?: Vec3; halfExtents?: Vec3 } | undefined;
    if (!worldBounds?.center || !worldBounds?.halfExtents) {
        return null;
    }
    const center = worldBounds.center;
    const half = worldBounds.halfExtents;
    return {
        minX: center.x - half.x,
        maxX: center.x + half.x,
        minY: center.y - half.y,
        maxY: center.y + half.y,
        minZ: center.z - half.z,
        maxZ: center.z + half.z,
    };
}

function mergeBounds(a: SceneBounds | null, b: SceneBounds | null): SceneBounds | null {
    if (!a) {
        return b;
    }
    if (!b) {
        return a;
    }
    return {
        minX: Math.min(a.minX, b.minX),
        maxX: Math.max(a.maxX, b.maxX),
        minY: Math.min(a.minY, b.minY),
        maxY: Math.max(a.maxY, b.maxY),
        minZ: Math.min(a.minZ, b.minZ),
        maxZ: Math.max(a.maxZ, b.maxZ),
    };
}

function matchesAnyName(name: string, candidates: string[]): boolean {
    const lower = name.toLowerCase();
    return candidates.some((candidate) => lower.includes(candidate));
}

function visit(node: Node, handle: (node: Node) => void) {
    handle(node);
    for (const child of node.children) {
        visit(child, handle);
    }
}
