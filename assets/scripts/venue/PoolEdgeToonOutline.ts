import { Color, gfx, Mat4, Material, Mesh, MeshRenderer, Node, utils, Vec3 } from 'cc';

// Build static, double-sided surface ribbons for selected venue geometry. The
// venue GLB remains compact and the generated lines have no race-frame CPU work.

const EDGE_NODE_NAME = 'pool_edge_batch';
const POOL_EDGE_LINE_NODE_NAME = 'PoolEdgeOutlineLines';
const PODIUM_NODE_NAMES = ['award_podium_1', 'award_podium_2', 'award_podium_3'];
const PODIUM_LINE_NODE_NAME = 'AwardsPodiumOutlineLines';
const PODIUM_SURFACE_COLOR = new Color(234, 89, 89, 255);
const PODIUM_CONTACT_EPSILON = 1e-3;
const POOL_EDGE_LINE_THICKNESS = 0.01;
const POOL_EDGE_LINE_SURFACE_OFFSET = 0.002;
const POOL_EDGE_HARD_EDGE_DOT = 0.95;
const POOL_EDGE_HEIGHT_EPSILON = 1e-4;
const OUTLINE_COLOR = new Color(6, 10, 16, 255);
const STRUCTURE_LINE_NODE_NAME = 'VenueStructureEdgeLines';
const ACCESS_LINE_THICKNESS = 0.025;
const ACCESS_LINE_SURFACE_OFFSET = 0.002;
const ACCESS_HARD_EDGE_DOT = 0.95;
const STRUCTURE_LINE_THICKNESS = 0.05;
const STRUCTURE_LINE_SURFACE_OFFSET = 0.003;
// Exported access stair flights contain 84-92 indexed triangles each, while
// the adjacent wall and lintel components contain only 10-12.
const ACCESS_STAIR_MIN_COMPONENT_TRIANGLES = 48;
const CONCRETE_MATERIAL_KEYWORD = 'bleacher_step_concrete';
const WALL_SILVER_MATERIAL_KEYWORD = 'venue_wall_silvergray';
const TIER_FRONT_LINE_NODE_NAME = 'VenueTierFrontOutlineLines';
// Thin bleacher outline (stairs/walls stay at ACCESS_LINE_THICKNESS 0.025).
const TIER_FRONT_LINE_THICKNESS = 0.012;
// Standoff of each band from its backing face (same magnitude as the
// stair/wall outlines).
const TIER_FRONT_LINE_SURFACE_OFFSET = 0.003;
const TIER_FRONT_NODE_PATTERN = /^bleacherbatch_t([1-4])_([nsew])$/;
const TIER_FRONT_CORNER_NODE_NAME = 'cornerstands_merged';

type LineGeometry = { positions: number[]; indices: number[] };
type Bounds3 = {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
};

function findNodeByName(root: Node, name: string): Node | null {
    if (root.name === name) {
        return root;
    }
    for (const child of root.children) {
        const found = findNodeByName(child, name);
        if (found) {
            return found;
        }
    }
    return null;
}

function appendSurfaceRibbon(
    positions: number[],
    indices: number[],
    start: Vec3,
    end: Vec3,
    opposite: Vec3,
    faceNormal: Vec3,
    transform: Mat4,
    thickness: number,
    offset: number,
): void {
    const tangent = new Vec3();
    Vec3.subtract(tangent, end, start);
    if (tangent.lengthSqr() < 1e-8) {
        return;
    }
    tangent.normalize();

    const midpoint = new Vec3();
    Vec3.add(midpoint, start, end).multiplyScalar(0.5);
    const inward = new Vec3();
    Vec3.subtract(inward, opposite, midpoint);
    const tangentProjection = Vec3.dot(inward, tangent);
    inward.x -= tangent.x * tangentProjection;
    inward.y -= tangent.y * tangentProjection;
    inward.z -= tangent.z * tangentProjection;
    if (inward.lengthSqr() < 1e-8) {
        return;
    }
    inward.normalize().multiplyScalar(thickness);

    const surfaceOffset = new Vec3(faceNormal);
    surfaceOffset.normalize().multiplyScalar(offset);
    const points = [new Vec3(), new Vec3(), new Vec3(), new Vec3()];
    Vec3.add(points[0], start, surfaceOffset);
    Vec3.add(points[1], end, surfaceOffset);
    Vec3.add(points[2], end, inward).add(surfaceOffset);
    Vec3.add(points[3], start, inward).add(surfaceOffset);
    for (const point of points) {
        Vec3.transformMat4(point, point, transform);
    }

    const vertexOffset = positions.length / 3;
    for (const point of points) {
        positions.push(point.x, point.y, point.z);
    }
    indices.push(
        vertexOffset, vertexOffset + 1, vertexOffset + 2,
        vertexOffset, vertexOffset + 2, vertexOffset + 3,
    );
}
function appendDirectedRibbon(
    positions: number[],
    indices: number[],
    start: Vec3,
    end: Vec3,
    inwardDirection: Vec3,
    faceNormal: Vec3,
    transform: Mat4,
    thickness: number,
    offset: number,
): void {
    const midpoint = new Vec3();
    Vec3.add(midpoint, start, end).multiplyScalar(0.5);
    const opposite = new Vec3();
    Vec3.add(opposite, midpoint, inwardDirection);
    appendSurfaceRibbon(
        positions,
        indices,
        start,
        end,
        opposite,
        faceNormal,
        transform,
        thickness,
        offset,
    );
}

function appendAccessStairEdgeLines(
    mesh: Mesh,
    primitive: number,
    positions: number[],
    indices: number[],
    transform: Mat4,
): number {
    const pos = mesh.readAttribute(primitive, gfx.AttributeName.ATTR_POSITION) as ArrayLike<number> | null;
    const idx = mesh.readIndices(primitive) as ArrayLike<number> | null;
    if (!pos || !idx || pos.length < 9 || idx.length < 3) {
        return 0;
    }

    const triangleCount = Math.floor(idx.length / 3);
    const vertexTriangles = new Map<number, number[]>();
    for (let triangle = 0; triangle < triangleCount; triangle++) {
        const indexBase = triangle * 3;
        for (let corner = 0; corner < 3; corner++) {
            const vertex = idx[indexBase + corner];
            let adjacent = vertexTriangles.get(vertex);
            if (!adjacent) {
                adjacent = [];
                vertexTriangles.set(vertex, adjacent);
            }
            adjacent.push(triangle);
        }
    }

    const visited = new Uint8Array(triangleCount);
    let stairLines = 0;

    for (let start = 0; start < triangleCount; start++) {
        if (visited[start]) {
            continue;
        }
        visited[start] = 1;
        const stack = [start];
        const component: number[] = [];
        while (stack.length > 0) {
            const triangle = stack.pop()!;
            component.push(triangle);
            const indexBase = triangle * 3;
            for (let corner = 0; corner < 3; corner++) {
                const vertex = idx[indexBase + corner];
                const adjacent = vertexTriangles.get(vertex);
                if (!adjacent) {
                    continue;
                }
                for (const next of adjacent) {
                    if (!visited[next]) {
                        visited[next] = 1;
                        stack.push(next);
                    }
                }
            }
        }
        if (component.length < ACCESS_STAIR_MIN_COMPONENT_TRIANGLES) {
            continue;
        }
        const vertices = new Set<number>();
        for (const triangle of component) {
            const indexBase = triangle * 3;
            vertices.add(idx[indexBase]);
            vertices.add(idx[indexBase + 1]);
            vertices.add(idx[indexBase + 2]);
        }
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minZ = Number.POSITIVE_INFINITY;
        let maxZ = Number.NEGATIVE_INFINITY;
        for (const vertex of vertices) {
            const sourceBase = vertex * 3;
            minX = Math.min(minX, pos[sourceBase]);
            maxX = Math.max(maxX, pos[sourceBase]);
            minZ = Math.min(minZ, pos[sourceBase + 2]);
            maxZ = Math.max(maxZ, pos[sourceBase + 2]);
        }
        const lateralOffset = maxX - minX <= maxZ - minZ ? 0 : 2;
        const lateralMin = lateralOffset === 0 ? minX : minZ;
        const lateralMax = lateralOffset === 0 ? maxX : maxZ;
        const edgeFaces = new Map<string, {
            a: number;
            b: number;
            faces: { normal: Vec3; opposite: number }[];
        }>();
        for (const triangle of component) {
            const indexBase = triangle * 3;
            const a = idx[indexBase];
            const b = idx[indexBase + 1];
            const c = idx[indexBase + 2];
            const pa = new Vec3(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]);
            const pb = new Vec3(pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
            const pc = new Vec3(pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]);
            const ab = new Vec3();
            const ac = new Vec3();
            const faceNormal = new Vec3();
            Vec3.subtract(ab, pb, pa);
            Vec3.subtract(ac, pc, pa);
            Vec3.cross(faceNormal, ab, ac).normalize();
            for (const [edgeA, edgeB, opposite] of [[a, b, c], [b, c, a], [c, a, b]]) {
                const key = edgeA < edgeB ? `${edgeA}_${edgeB}` : `${edgeB}_${edgeA}`;
                let edge = edgeFaces.get(key);
                if (!edge) {
                    edge = { a: Math.min(edgeA, edgeB), b: Math.max(edgeA, edgeB), faces: [] };
                    edgeFaces.set(key, edge);
                }
                edge.faces.push({ normal: faceNormal, opposite });
            }
        }
        const lineStart = new Vec3();
        const lineEnd = new Vec3();
        const opposite = new Vec3();
        for (const edge of edgeFaces.values()) {
            if (edge.faces.length !== 2
                || Math.abs(Vec3.dot(edge.faces[0].normal, edge.faces[1].normal)) > ACCESS_HARD_EDGE_DOT) {
                continue;
            }
            const aBase = edge.a * 3;
            const bBase = edge.b * 3;
            const aLateral = pos[aBase + lateralOffset];
            const bLateral = pos[bBase + lateralOffset];
            const onMinSide = Math.abs(aLateral - lateralMin) < 1e-4 && Math.abs(bLateral - lateralMin) < 1e-4;
            const onMaxSide = Math.abs(aLateral - lateralMax) < 1e-4 && Math.abs(bLateral - lateralMax) < 1e-4;
            const spansStairWidth = (
                Math.abs(aLateral - lateralMin) < 1e-4 && Math.abs(bLateral - lateralMax) < 1e-4
            ) || (
                Math.abs(aLateral - lateralMax) < 1e-4 && Math.abs(bLateral - lateralMin) < 1e-4
            );
            if (!onMinSide && !onMaxSide && !spansStairWidth) {
                continue;
            }
            lineStart.set(pos[aBase], pos[aBase + 1], pos[aBase + 2]);
            lineEnd.set(pos[bBase], pos[bBase + 1], pos[bBase + 2]);
            const faces = spansStairWidth
                ? edge.faces
                : edge.faces.filter((face) => Math.abs(face.normal[lateralOffset]) > 0.9);
            const ribbonFaces = faces.length > 0 ? faces : edge.faces;
            for (const face of ribbonFaces) {
                const oppositeBase = face.opposite * 3;
                opposite.set(pos[oppositeBase], pos[oppositeBase + 1], pos[oppositeBase + 2]);
                appendSurfaceRibbon(
                    positions,
                    indices,
                    lineStart,
                    lineEnd,
                    opposite,
                    face.normal,
                    transform,
                    ACCESS_LINE_THICKNESS,
                    ACCESS_LINE_SURFACE_OFFSET,
                );
            }
            stairLines++;
        }
    }
    return stairLines;
}

function appendPrimitiveHardEdgeRibbons(
    mesh: Mesh,
    primitive: number,
    positions: number[],
    indices: number[],
    transform: Mat4,
    includeComponent: (triangleCount: number) => boolean,
    thickness: number = ACCESS_LINE_THICKNESS,
    offset: number = ACCESS_LINE_SURFACE_OFFSET,
): number {
    const pos = mesh.readAttribute(primitive, gfx.AttributeName.ATTR_POSITION) as ArrayLike<number> | null;
    const idx = mesh.readIndices(primitive) as ArrayLike<number> | null;
    if (!pos || !idx || pos.length < 9 || idx.length < 3) {
        return 0;
    }

    const triangleCount = Math.floor(idx.length / 3);
    const vertexTriangles = new Map<number, number[]>();
    for (let triangle = 0; triangle < triangleCount; triangle++) {
        const indexBase = triangle * 3;
        for (let corner = 0; corner < 3; corner++) {
            const vertex = idx[indexBase + corner];
            let adjacent = vertexTriangles.get(vertex);
            if (!adjacent) {
                adjacent = [];
                vertexTriangles.set(vertex, adjacent);
            }
            adjacent.push(triangle);
        }
    }

    const visited = new Uint8Array(triangleCount);
    let hardEdges = 0;
    for (let start = 0; start < triangleCount; start++) {
        if (visited[start]) {
            continue;
        }
        visited[start] = 1;
        const stack = [start];
        const component: number[] = [];
        while (stack.length > 0) {
            const triangle = stack.pop()!;
            component.push(triangle);
            const indexBase = triangle * 3;
            for (let corner = 0; corner < 3; corner++) {
                const adjacent = vertexTriangles.get(idx[indexBase + corner]);
                if (!adjacent) {
                    continue;
                }
                for (const next of adjacent) {
                    if (!visited[next]) {
                        visited[next] = 1;
                        stack.push(next);
                    }
                }
            }
        }
        if (!includeComponent(component.length)) {
            continue;
        }

        const edgeFaces = new Map<string, {
            a: number;
            b: number;
            faces: { normal: Vec3; opposite: number }[];
        }>();
        for (const triangle of component) {
            const indexBase = triangle * 3;
            const a = idx[indexBase];
            const b = idx[indexBase + 1];
            const c = idx[indexBase + 2];
            const pa = new Vec3(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]);
            const pb = new Vec3(pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
            const pc = new Vec3(pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]);
            const ab = new Vec3();
            const ac = new Vec3();
            const faceNormal = new Vec3();
            Vec3.subtract(ab, pb, pa);
            Vec3.subtract(ac, pc, pa);
            Vec3.cross(faceNormal, ab, ac).normalize();
            for (const [edgeA, edgeB, opposite] of [[a, b, c], [b, c, a], [c, a, b]]) {
                const key = edgeA < edgeB ? `${edgeA}_${edgeB}` : `${edgeB}_${edgeA}`;
                let edge = edgeFaces.get(key);
                if (!edge) {
                    edge = { a: Math.min(edgeA, edgeB), b: Math.max(edgeA, edgeB), faces: [] };
                    edgeFaces.set(key, edge);
                }
                edge.faces.push({ normal: faceNormal, opposite });
            }
        }

        const lineStart = new Vec3();
        const lineEnd = new Vec3();
        const opposite = new Vec3();
        for (const edge of edgeFaces.values()) {
            if (edge.faces.length > 1
                && Math.abs(Vec3.dot(edge.faces[0].normal, edge.faces[1].normal)) > ACCESS_HARD_EDGE_DOT) {
                continue;
            }
            const aBase = edge.a * 3;
            const bBase = edge.b * 3;
            lineStart.set(pos[aBase], pos[aBase + 1], pos[aBase + 2]);
            lineEnd.set(pos[bBase], pos[bBase + 1], pos[bBase + 2]);
            for (const face of edge.faces) {
                const oppositeBase = face.opposite * 3;
                opposite.set(pos[oppositeBase], pos[oppositeBase + 1], pos[oppositeBase + 2]);
                appendSurfaceRibbon(
                    positions,
                    indices,
                    lineStart,
                    lineEnd,
                    opposite,
                    face.normal,
                    transform,
                    thickness,
                    offset,
                );
            }
            hardEdges++;
        }
    }
    return hardEdges;
}

// Outline the seating tiers with the same position-only hard-edge scheme as the
// stair/wall outlines. It reads only vertex positions + indices (never UVs), so
// it survives the WeChat build where the untextured flat-colour bleachers have
// no readable UV stream. The FlatColor bleachers share one baked colour-atlas
// material, so material filtering is impossible; every hard edge of the tier
// geometry is extracted (no individual seats, so that is just the stepped
// tiers), and welded coplanar module seams are not hard edges, so no seam line.
function buildTierFrontLineGeometry(pool: Node): {
    geometry: LineGeometry;
    sourceNodes: number;
    edges: number;
} | null {
    const positions: number[] = [];
    const indices: number[] = [];
    const poolWorld = new Mat4();
    const inversePoolWorld = new Mat4();
    pool.getWorldMatrix(poolWorld);
    if (!Mat4.invert(inversePoolWorld, poolWorld)) {
        return null;
    }
    let sourceNodes = 0;
    let edgeCount = 0;
    const visit = (node: Node) => {
        const lowerName = node.name.toLowerCase();
        const isTierNode = TIER_FRONT_NODE_PATTERN.test(lowerName)
            || lowerName === TIER_FRONT_CORNER_NODE_NAME;
        if (isTierNode) {
            const renderer = node.getComponent(MeshRenderer);
            const mesh = renderer?.mesh;
            if (renderer && mesh) {
                const nodeWorld = new Mat4();
                const nodeToPool = new Mat4();
                node.getWorldMatrix(nodeWorld);
                Mat4.multiply(nodeToPool, inversePoolWorld, nodeWorld);
                let included = false;
                // The FlatColor bleachers are baked into a single colour-atlas
                // material, so the step/seat/side distinction lives in the atlas
                // UVs, not in separate materials. We cannot filter by material
                // name; instead we extract every hard edge of the tier geometry
                // (which, with no individual seats, is just the stepped tiers).
                for (let primitive = 0; primitive < mesh.struct.primitives.length; primitive++) {
                    const edges = appendPrimitiveHardEdgeRibbons(
                        mesh, primitive, positions, indices, nodeToPool, () => true,
                        TIER_FRONT_LINE_THICKNESS, TIER_FRONT_LINE_SURFACE_OFFSET,
                    );
                    edgeCount += edges;
                    included ||= edges > 0;
                }
                if (included) {
                    sourceNodes++;
                }
            }
        }
        for (const child of node.children) {
            visit(child);
        }
    };
    visit(pool);
    return indices.length > 0 ? {
        geometry: { positions, indices },
        sourceNodes,
        edges: edgeCount,
    } : null;
}

function buildPoolEdgeLineGeometry(
    mesh: Mesh,
    transform?: Mat4,
    adjustEdge?: (start: Vec3, end: Vec3) => boolean,
): { geometry: LineGeometry; edges: number } | null {
    const positions: number[] = [];
    const indices: number[] = [];
    const identity = new Mat4();
    Mat4.identity(identity);
    let hardEdges = 0;

    for (let primitive = 0; primitive < mesh.struct.primitives.length; primitive++) {
        const pos = mesh.readAttribute(primitive, gfx.AttributeName.ATTR_POSITION) as ArrayLike<number> | null;
        const idx = mesh.readIndices(primitive) as ArrayLike<number> | null;
        if (!pos || !idx || pos.length < 9 || idx.length < 3) {
            continue;
        }
        let minY = Number.POSITIVE_INFINITY;
        for (let vertex = 0; vertex + 2 < pos.length; vertex += 3) {
            minY = Math.min(minY, pos[vertex + 1]);
        }
        const edgeFaces = new Map<string, {
            a: number;
            b: number;
            faces: { normal: Vec3; opposite: number }[];
        }>();
        for (let indexBase = 0; indexBase + 2 < idx.length; indexBase += 3) {
            const a = idx[indexBase];
            const b = idx[indexBase + 1];
            const c = idx[indexBase + 2];
            const pa = new Vec3(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]);
            const pb = new Vec3(pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
            const pc = new Vec3(pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]);
            const ab = new Vec3();
            const ac = new Vec3();
            const faceNormal = new Vec3();
            Vec3.subtract(ab, pb, pa);
            Vec3.subtract(ac, pc, pa);
            Vec3.cross(faceNormal, ab, ac).normalize();
            for (const [edgeA, edgeB, opposite] of [[a, b, c], [b, c, a], [c, a, b]]) {
                const key = edgeA < edgeB ? `${edgeA}_${edgeB}` : `${edgeB}_${edgeA}`;
                let edge = edgeFaces.get(key);
                if (!edge) {
                    edge = { a: Math.min(edgeA, edgeB), b: Math.max(edgeA, edgeB), faces: [] };
                    edgeFaces.set(key, edge);
                }
                edge.faces.push({ normal: faceNormal, opposite });
            }
        }

        const localStart = new Vec3();
        const localEnd = new Vec3();
        const localOpposite = new Vec3();
        const lineStart = new Vec3();
        const lineEnd = new Vec3();
        const opposite = new Vec3();
        const faceNormal = new Vec3();
        const normalTip = new Vec3();
        const transformedOrigin = new Vec3();
        if (transform) {
            Vec3.transformMat4(transformedOrigin, Vec3.ZERO, transform);
        }
        for (const edge of edgeFaces.values()) {
            if (edge.faces.length !== 2
                || Math.abs(Vec3.dot(edge.faces[0].normal, edge.faces[1].normal)) > POOL_EDGE_HARD_EDGE_DOT) {
                continue;
            }
            const aBase = edge.a * 3;
            const bBase = edge.b * 3;
            if (Math.abs(pos[aBase + 1] - minY) < POOL_EDGE_HEIGHT_EPSILON
                && Math.abs(pos[bBase + 1] - minY) < POOL_EDGE_HEIGHT_EPSILON) {
                continue;
            }
            localStart.set(pos[aBase], pos[aBase + 1], pos[aBase + 2]);
            localEnd.set(pos[bBase], pos[bBase + 1], pos[bBase + 2]);
            if (transform) {
                Vec3.transformMat4(lineStart, localStart, transform);
                Vec3.transformMat4(lineEnd, localEnd, transform);
            } else {
                lineStart.set(localStart);
                lineEnd.set(localEnd);
            }
            if (adjustEdge && !adjustEdge(lineStart, lineEnd)) {
                continue;
            }
            for (const face of edge.faces) {
                const oppositeBase = face.opposite * 3;
                localOpposite.set(pos[oppositeBase], pos[oppositeBase + 1], pos[oppositeBase + 2]);
                if (transform) {
                    Vec3.transformMat4(opposite, localOpposite, transform);
                    normalTip.set(face.normal);
                    Vec3.transformMat4(normalTip, normalTip, transform);
                    Vec3.subtract(faceNormal, normalTip, transformedOrigin).normalize();
                } else {
                    opposite.set(localOpposite);
                    faceNormal.set(face.normal);
                }
                appendSurfaceRibbon(
                    positions,
                    indices,
                    lineStart,
                    lineEnd,
                    opposite,
                    faceNormal,
                    identity,
                    POOL_EDGE_LINE_THICKNESS,
                    POOL_EDGE_LINE_SURFACE_OFFSET,
                );
            }
            hardEdges++;
        }
    }
    return indices.length > 0 ? { geometry: { positions, indices }, edges: hardEdges } : null;
}

function transformedMeshBounds(
    mesh: Mesh,
    transform: Mat4,
): Bounds3 | null {
    const min = mesh.struct.minPosition;
    const max = mesh.struct.maxPosition;
    if (!min || !max) {
        return null;
    }
    const bounds: Bounds3 = {
        minX: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
        minZ: Number.POSITIVE_INFINITY,
        maxZ: Number.NEGATIVE_INFINITY,
    };
    const point = new Vec3();
    for (let corner = 0; corner < 8; corner++) {
        point.set(
            (corner & 1) ? max.x : min.x,
            (corner & 2) ? max.y : min.y,
            (corner & 4) ? max.z : min.z,
        );
        Vec3.transformMat4(point, point, transform);
        bounds.minX = Math.min(bounds.minX, point.x);
        bounds.maxX = Math.max(bounds.maxX, point.x);
        bounds.minY = Math.min(bounds.minY, point.y);
        bounds.maxY = Math.max(bounds.maxY, point.y);
        bounds.minZ = Math.min(bounds.minZ, point.z);
        bounds.maxZ = Math.max(bounds.maxZ, point.z);
    }
    return bounds;
}

function adjustPodiumInternalVerticalEdge(
    start: Vec3,
    end: Vec3,
    own: Bounds3,
    all: Bounds3[],
): boolean {
    if (Math.abs(start.x - end.x) > PODIUM_CONTACT_EPSILON
        || Math.abs(start.z - end.z) > PODIUM_CONTACT_EPSILON
        || Math.abs(start.y - end.y) <= PODIUM_CONTACT_EPSILON) {
        return true;
    }

    let sharedHeight = own.minY;
    for (const other of all) {
        if (other === own || Math.abs(other.minY - own.minY) > PODIUM_CONTACT_EPSILON) {
            continue;
        }
        const withinSharedX = start.x >= Math.max(own.minX, other.minX) - PODIUM_CONTACT_EPSILON
            && start.x <= Math.min(own.maxX, other.maxX) + PODIUM_CONTACT_EPSILON;
        const withinSharedZ = start.z >= Math.max(own.minZ, other.minZ) - PODIUM_CONTACT_EPSILON
            && start.z <= Math.min(own.maxZ, other.maxZ) + PODIUM_CONTACT_EPSILON;
        const touchesAcrossX = withinSharedZ && (
            (Math.abs(start.x - own.minX) <= PODIUM_CONTACT_EPSILON
                && Math.abs(start.x - other.maxX) <= PODIUM_CONTACT_EPSILON)
            || (Math.abs(start.x - own.maxX) <= PODIUM_CONTACT_EPSILON
                && Math.abs(start.x - other.minX) <= PODIUM_CONTACT_EPSILON)
        );
        const touchesAcrossZ = withinSharedX && (
            (Math.abs(start.z - own.minZ) <= PODIUM_CONTACT_EPSILON
                && Math.abs(start.z - other.maxZ) <= PODIUM_CONTACT_EPSILON)
            || (Math.abs(start.z - own.maxZ) <= PODIUM_CONTACT_EPSILON
                && Math.abs(start.z - other.minZ) <= PODIUM_CONTACT_EPSILON)
        );
        if (touchesAcrossX || touchesAcrossZ) {
            sharedHeight = Math.max(sharedHeight, Math.min(own.maxY, other.maxY));
        }
    }

    const low = Math.min(start.y, end.y);
    const high = Math.max(start.y, end.y);
    if (sharedHeight <= low + PODIUM_CONTACT_EPSILON) {
        return true;
    }
    if (sharedHeight >= high - PODIUM_CONTACT_EPSILON) {
        return false;
    }
    if (start.y < end.y) {
        start.y = sharedHeight;
    } else {
        end.y = sharedHeight;
    }
    return true;
}

function shouldOutlinePrimitive(nodeName: string, materialName: string, primitive: number): boolean {
    const lowerNode = nodeName.toLowerCase();
    const lowerMaterial = materialName.toLowerCase();
    return lowerMaterial.includes(CONCRETE_MATERIAL_KEYWORD)
        || (lowerNode === 'bleacheraccess_architecture_merged'
            && lowerMaterial.includes(WALL_SILVER_MATERIAL_KEYWORD))
        || (!lowerMaterial && primitive === 0);
}

function fromBlenderVenue(x: number, y: number, z: number): Vec3 {
    return new Vec3(x, z, -y);
}

function appendConfiguredStructureContactLines(
    positions: number[],
    indices: number[],
): number {
    const identity = new Mat4();
    Mat4.identity(identity);
    const down = fromBlenderVenue(0, 0, -1);

    const append = (start: Vec3, end: Vec3, inward: Vec3, normal: Vec3) => {
        appendDirectedRibbon(
            positions,
            indices,
            start,
            end,
            inward,
            normal,
            identity,
            STRUCTURE_LINE_THICKNESS,
            STRUCTURE_LINE_SURFACE_OFFSET,
        );
    };
    const ceilingWallEdge = (
        start: Vec3,
        end: Vec3,
        towardCeiling: Vec3,
        towardPool: Vec3,
    ) => {
        append(start, end, towardCeiling, down);
        append(start, end, down, towardPool);
    };
    // These are the visible wall planes; the slab bounds penetrate the walls.
    // Adjacent straight/diagonal segments share wall-plane intersections so the
    // one-sided ribbons overlap cleanly at all four corner junctions.
    ceilingWallEdge(fromBlenderVenue(-18.9484, 24.291, 5.08), fromBlenderVenue(59.2071, 24.291, 5.08), fromBlenderVenue(0, -1, 0), fromBlenderVenue(0, -1, 0));
    ceilingWallEdge(fromBlenderVenue(-18.9494, -24.29, 5.08), fromBlenderVenue(59.2081, -24.29, 5.08), fromBlenderVenue(0, 1, 0), fromBlenderVenue(0, 1, 0));
    ceilingWallEdge(fromBlenderVenue(-18.9484, 24.291, 5.08), fromBlenderVenue(-24.2113, 19.0281, 5.08), fromBlenderVenue(1, -1, 0), fromBlenderVenue(1, -1, 0));
    ceilingWallEdge(fromBlenderVenue(-18.9494, -24.29, 5.08), fromBlenderVenue(-24.2113, -19.0281, 5.08), fromBlenderVenue(1, 1, 0), fromBlenderVenue(1, 1, 0));
    ceilingWallEdge(fromBlenderVenue(-24.2113, -19.0281, 5.08), fromBlenderVenue(-24.2113, 19.0281, 5.08), fromBlenderVenue(1, 0, 0), fromBlenderVenue(1, 0, 0));
    ceilingWallEdge(fromBlenderVenue(59.2071, 24.291, 5.08), fromBlenderVenue(64.47, 19.0281, 5.08), fromBlenderVenue(-1, -1, 0), fromBlenderVenue(-1, -1, 0));
    ceilingWallEdge(fromBlenderVenue(59.2081, -24.29, 5.08), fromBlenderVenue(64.47, -19.0281, 5.08), fromBlenderVenue(-1, 1, 0), fromBlenderVenue(-1, 1, 0));
    ceilingWallEdge(fromBlenderVenue(64.47, -19.0281, 5.08), fromBlenderVenue(64.47, 19.0281, 5.08), fromBlenderVenue(-1, 0, 0), fromBlenderVenue(-1, 0, 0));
    return 8;
}

function buildStandStructureLineGeometry(
    pool: Node,
): {
    geometry: LineGeometry;
    nodes: number;
    stairLines: number;
    buildingEdges: number;
    contactLines: number;
} | null {
    const positions: number[] = [];
    const indices: number[] = [];
    const poolWorld = new Mat4();
    const inversePoolWorld = new Mat4();
    pool.getWorldMatrix(poolWorld);
    if (!Mat4.invert(inversePoolWorld, poolWorld)) {
        return null;
    }
    const contactLines = appendConfiguredStructureContactLines(positions, indices);

    let sourceNodes = 0;
    let stairLines = 0;
    let buildingEdges = 0;
    const visit = (node: Node) => {
        const lowerName = node.name.toLowerCase();
        const isAccessArchitecture = lowerName === 'bleacheraccess_architecture_merged';
        const isBuildingStructure = lowerName === 'standstructure_merged' || lowerName.includes('upperplatform');
        if (isAccessArchitecture || isBuildingStructure) {
            const renderer = node.getComponent(MeshRenderer);
            const mesh = renderer?.mesh;
            if (renderer && mesh) {
                const nodeWorld = new Mat4();
                const nodeToPool = new Mat4();
                node.getWorldMatrix(nodeWorld);
                Mat4.multiply(nodeToPool, inversePoolWorld, nodeWorld);
                let includedNode = false;
                for (let primitive = 0; primitive < mesh.struct.primitives.length; primitive++) {
                    const source = renderer.getSharedMaterial(primitive) ?? renderer.sharedMaterials[primitive] ?? null;
                    if (isBuildingStructure) {
                        const edges = appendPrimitiveHardEdgeRibbons(
                            mesh, primitive, positions, indices, nodeToPool, () => true,
                        );
                        buildingEdges += edges;
                        includedNode ||= edges > 0;
                        continue;
                    }
                    if (shouldOutlinePrimitive(node.name, source?.name ?? '', primitive)) {
                        const edges = appendPrimitiveHardEdgeRibbons(
                            mesh,
                            primitive,
                            positions,
                            indices,
                            nodeToPool,
                            (componentTriangles) => componentTriangles < ACCESS_STAIR_MIN_COMPONENT_TRIANGLES,
                        );
                        const lines = appendAccessStairEdgeLines(
                            mesh, primitive, positions, indices, nodeToPool,
                        );
                        buildingEdges += edges;
                        stairLines += lines;
                        includedNode ||= edges > 0 || lines > 0;
                    }
                }
                if (includedNode) {
                    sourceNodes++;
                }
            }
        }
        for (const child of node.children) {
            visit(child);
        }
    };
    visit(pool);
    return indices.length > 0 ? {
        geometry: { positions, indices },
        nodes: sourceNodes,
        stairLines,
        buildingEdges,
        contactLines,
    } : null;
}

// Attach explicit double-sided ribbons to the top and vertical hard edges of
// the four pool surround curbs. Bottom edges remain unoutlined.
export function applyPoolEdgeToonOutline(pool: Node | null, debug?: (message: string) => void): void {
    if (!pool?.isValid) {
        return;
    }
    const edge = findNodeByName(pool, EDGE_NODE_NAME);
    if (!edge?.isValid) {
        debug?.('pool edge outline skipped: curb node missing');
        return;
    }
    if (edge.getChildByName(POOL_EDGE_LINE_NODE_NAME)) {
        return;
    }
    const renderer = edge.getComponent(MeshRenderer);
    if (!renderer?.mesh) {
        debug?.('pool edge outline skipped: curb renderer/mesh missing');
        return;
    }

    const built = buildPoolEdgeLineGeometry(renderer.mesh);
    if (!built) {
        debug?.('pool edge outline skipped: no readable curb geometry');
        return;
    }

    let lineMesh: Mesh | null = null;
    try {
        lineMesh = utils.createMesh(built.geometry);
    } catch (error) {
        debug?.(`pool edge outline mesh build failed: ${error}`);
        return;
    }

    const material = new Material();
    material.initialize({
        effectName: 'builtin-unlit',
        states: {
            rasterizerState: {
                cullMode: gfx.CullMode.NONE,
            },
        },
    });
    material.name = 'PoolEdgeLineMaterial';
    material.setProperty('mainColor', OUTLINE_COLOR);

    const lineNode = new Node(POOL_EDGE_LINE_NODE_NAME);
    lineNode.setParent(edge);
    lineNode.setPosition(0, 0, 0);
    lineNode.setRotationFromEuler(0, 0, 0);
    lineNode.setScale(1, 1, 1);
    lineNode.layer = edge.layer;

    const lineRenderer = lineNode.addComponent(MeshRenderer);
    lineRenderer.mesh = lineMesh;
    lineRenderer.setMaterial(material, 0);
    debug?.(`pool edge ribbons attached edges=${built.edges} triangles=${built.geometry.indices.length / 3} drawCalls=1`);
}

// Reuse the pool-curb hard-edge treatment for the three awards steps, merging
// all ribbons into one static renderer so the podium costs one extra draw call.
export function applyAwardsPodiumToonOutline(pool: Node | null, debug?: (message: string) => void): void {
    if (!pool?.isValid || pool.getChildByName(PODIUM_LINE_NODE_NAME)) {
        return;
    }

    const poolWorld = new Mat4();
    const inversePoolWorld = new Mat4();
    pool.getWorldMatrix(poolWorld);
    if (!Mat4.invert(inversePoolWorld, poolWorld)) {
        debug?.('awards podium outline skipped: pool transform is not invertible');
        return;
    }

    const podiums: { node: Node; renderer: MeshRenderer; mesh: Mesh; transform: Mat4; bounds: Bounds3 }[] = [];
    for (const name of PODIUM_NODE_NAMES) {
        const node = findNodeByName(pool, name);
        const renderer = node?.getComponent(MeshRenderer);
        const mesh = renderer?.mesh;
        if (!node?.isValid || !renderer || !mesh) {
            debug?.(`awards podium source missing: ${name}`);
            continue;
        }
        const nodeWorld = new Mat4();
        const nodeToPool = new Mat4();
        node.getWorldMatrix(nodeWorld);
        Mat4.multiply(nodeToPool, inversePoolWorld, nodeWorld);
        const bounds = transformedMeshBounds(mesh, nodeToPool);
        if (!bounds) {
            debug?.(`awards podium bounds unreadable: ${name}`);
            continue;
        }
        podiums.push({ node, renderer, mesh, transform: nodeToPool, bounds });
    }
    if (podiums.length === 0) {
        debug?.('awards podium setup skipped: no readable podium geometry');
        return;
    }

    const surfaceMaterial = new Material();
    surfaceMaterial.initialize({ effectName: 'builtin-unlit' });
    surfaceMaterial.name = 'AwardsPodiumUnlitMaterial';
    surfaceMaterial.setProperty('mainColor', PODIUM_SURFACE_COLOR);
    for (const podium of podiums) {
        const materialCount = Math.max(1, podium.renderer.sharedMaterials.length);
        for (let primitive = 0; primitive < materialCount; primitive++) {
            podium.renderer.setMaterial(surfaceMaterial, primitive);
        }
    }

    const geometry: LineGeometry = { positions: [], indices: [] };
    const allBounds = podiums.map((podium) => podium.bounds);
    let hardEdges = 0;
    let lineLayer = pool.layer;
    for (const podium of podiums) {
        const built = buildPoolEdgeLineGeometry(
            podium.mesh,
            podium.transform,
            (start, end) => adjustPodiumInternalVerticalEdge(start, end, podium.bounds, allBounds),
        );
        if (!built) {
            debug?.(`awards podium outline geometry unreadable: ${podium.node.name}`);
            continue;
        }
        const vertexOffset = geometry.positions.length / 3;
        geometry.positions.push(...built.geometry.positions);
        for (const index of built.geometry.indices) {
            geometry.indices.push(index + vertexOffset);
        }
        hardEdges += built.edges;
        lineLayer = podium.node.layer;
    }
    if (geometry.indices.length === 0) {
        debug?.('awards podium outline skipped: no visible hard edges');
        return;
    }

    let lineMesh: Mesh | null = null;
    try {
        lineMesh = utils.createMesh(geometry);
    } catch (error) {
        debug?.(`awards podium outline mesh build failed: ${error}`);
        return;
    }

    const material = new Material();
    material.initialize({
        effectName: 'builtin-unlit',
        states: {
            rasterizerState: {
                cullMode: gfx.CullMode.NONE,
            },
        },
    });
    material.name = 'AwardsPodiumLineMaterial';
    material.setProperty('mainColor', OUTLINE_COLOR);

    const lineNode = new Node(PODIUM_LINE_NODE_NAME);
    lineNode.setParent(pool);
    lineNode.setPosition(0, 0, 0);
    lineNode.setRotationFromEuler(0, 0, 0);
    lineNode.setScale(1, 1, 1);
    lineNode.layer = lineLayer;

    const lineRenderer = lineNode.addComponent(MeshRenderer);
    lineRenderer.mesh = lineMesh;
    lineRenderer.setMaterial(material, 0);
    debug?.(`awards podium unlit+ribbons attached nodes=${podiums.length} edges=${hardEdges} triangles=${geometry.indices.length / 3} drawCalls=1`);
}

// Build one static line mesh for stair folds and the selected architectural
// contacts. Ordinary bleacher tiers, seats, rails, doors and signs are excluded.
export function applyStandStructureToonOutline(pool: Node | null, debug?: (message: string) => void): void {
    if (!pool?.isValid || pool.getChildByName(STRUCTURE_LINE_NODE_NAME)) {
        return;
    }
    const structureBuilt = buildStandStructureLineGeometry(pool);
    if (!structureBuilt) {
        debug?.('venue structure outline skipped: no readable matching geometry');
        return;
    }

    let structureMesh: Mesh | null = null;
    try {
        structureMesh = utils.createMesh(structureBuilt.geometry);
    } catch (error) {
        structureMesh?.destroy();
        debug?.(`venue structure outline mesh build failed: ${error}`);
        return;
    }

    const lineMaterial = new Material();
    lineMaterial.initialize({
        effectName: 'builtin-unlit',
        states: {
            rasterizerState: {
                cullMode: gfx.CullMode.NONE,
            },
        },
    });
    lineMaterial.name = 'VenueStructureEdgeLineMaterial';
    lineMaterial.setProperty('mainColor', OUTLINE_COLOR);
    const lineNode = new Node(STRUCTURE_LINE_NODE_NAME);
    lineNode.setParent(pool);
    lineNode.setPosition(0, 0, 0);
    lineNode.setRotationFromEuler(0, 0, 0);
    lineNode.setScale(1, 1, 1);
    lineNode.layer = pool.layer;
    const lineRenderer = lineNode.addComponent(MeshRenderer);
    lineRenderer.mesh = structureMesh;
    lineRenderer.setMaterial(lineMaterial, 0);
    debug?.(
        `venue structure ribbons attached stairs=${structureBuilt.stairLines}`
        + ` buildingEdges=${structureBuilt.buildingEdges}`
        + ` contactLines=${structureBuilt.contactLines}`
        + ` triangles=${structureBuilt.geometry.indices.length / 3} drawCalls=1`,
    );
}

// Outline the pool-facing seating tiers by reusing the proven position-only
// hard-edge treatment of the stairs/walls (no UV atlas), so it renders on the
// WeChat build where the untextured bleachers have no readable UV stream.
export function applyTierFrontToonOutline(pool: Node | null, debug?: (message: string) => void): void {
    if (!pool?.isValid || pool.getChildByName(TIER_FRONT_LINE_NODE_NAME)) {
        return;
    }
    const built = buildTierFrontLineGeometry(pool);
    if (!built) {
        debug?.('tier front outline skipped: no matching fold lines');
        return;
    }
    let outlineMesh: Mesh | null = null;
    try {
        outlineMesh = utils.createMesh(built.geometry);
    } catch (error) {
        debug?.(`tier front outline mesh build failed: ${error}`);
        return;
    }
    const material = new Material();
    material.initialize({
        effectName: 'builtin-unlit',
        states: {
            rasterizerState: {
                cullMode: gfx.CullMode.NONE,
            },
        },
    });
    material.name = 'VenueTierFrontOutlineMaterial';
    material.setProperty('mainColor', OUTLINE_COLOR);
    const lineNode = new Node(TIER_FRONT_LINE_NODE_NAME);
    lineNode.setParent(pool);
    lineNode.setPosition(0, 0, 0);
    lineNode.setRotationFromEuler(0, 0, 0);
    lineNode.setScale(1, 1, 1);
    lineNode.layer = pool.layer;
    const renderer = lineNode.addComponent(MeshRenderer);
    renderer.mesh = outlineMesh;
    renderer.setMaterial(material, 0);
    debug?.(
        `tier front outline attached nodes=${built.sourceNodes}`
        + ` edges=${built.edges}`
        + ` triangles=${built.geometry.indices.length / 3} drawCalls=1`,
    );
}

