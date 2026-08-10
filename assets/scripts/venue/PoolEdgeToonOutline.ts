import { Color, gfx, Mat4, Material, Mesh, MeshRenderer, Node, utils, Vec3 } from 'cc';

// Build static, double-sided surface ribbons for selected venue geometry. The
// venue GLB remains compact and the generated lines have no race-frame CPU work.

const EDGE_NODE_NAME = 'pool_edge_batch';
const POOL_EDGE_LINE_NODE_NAME = 'PoolEdgeOutlineLines';
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

const SEAT_SIDE_TONE_NODE_NAME = 'BleacherSeatSideToneOverlay';
const SEAT_MATERIAL_KEYWORD = 'stadiumseat_blue';
const BLEACHER_ATLAS_MATERIAL_KEYWORD = 'bleacherflatcoloratlas';
const BLEACHER_ATLAS_CONCRETE_MAX_U = 1 / 3;
const SEAT_SIDE_THRESHOLD = 0.75;
const SEAT_SIDE_SURFACE_OFFSET = 0.003;
// Only a mild step down from StadiumSeat_Blue (roughly 83% brightness). Strong
// contrast turns repeated low-poly side faces into a distracting stripe pattern.
const SEAT_SIDE_COLOR = new Color(4, 34, 170, 255);

type LineGeometry = { positions: number[]; indices: number[] };

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
                    ACCESS_LINE_THICKNESS,
                    ACCESS_LINE_SURFACE_OFFSET,
                );
            }
            hardEdges++;
        }
    }
    return hardEdges;
}

function buildPoolEdgeLineGeometry(mesh: Mesh): { geometry: LineGeometry; edges: number } | null {
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

        const lineStart = new Vec3();
        const lineEnd = new Vec3();
        const opposite = new Vec3();
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

function shouldOutlinePrimitive(nodeName: string, materialName: string, primitive: number): boolean {
    const lowerMaterial = materialName.toLowerCase();
    return lowerMaterial.includes(CONCRETE_MATERIAL_KEYWORD)
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
    ceilingWallEdge(fromBlenderVenue(-15.69, 24.291, 5.08), fromBlenderVenue(59.2071, 24.291, 5.08), fromBlenderVenue(0, -1, 0), fromBlenderVenue(0, -1, 0));
    ceilingWallEdge(fromBlenderVenue(-15.737, -24.29, 5.08), fromBlenderVenue(59.2081, -24.29, 5.08), fromBlenderVenue(0, 1, 0), fromBlenderVenue(0, 1, 0));
    ceilingWallEdge(fromBlenderVenue(59.2071, 24.291, 5.08), fromBlenderVenue(64.47, 19.0281, 5.08), fromBlenderVenue(-1, -1, 0), fromBlenderVenue(-1, -1, 0));
    ceilingWallEdge(fromBlenderVenue(59.2081, -24.29, 5.08), fromBlenderVenue(64.47, -19.0281, 5.08), fromBlenderVenue(-1, 1, 0), fromBlenderVenue(-1, 1, 0));
    ceilingWallEdge(fromBlenderVenue(64.47, -19.0281, 5.08), fromBlenderVenue(64.47, 19.0281, 5.08), fromBlenderVenue(-1, 0, 0), fromBlenderVenue(-1, 0, 0));
    return 5;
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

function isSeatBatchNode(name: string): boolean {
    const lower = name.toLowerCase();
    return lower.startsWith('bleacherbatch_') || lower === 'cornerstands_merged';
}

function seatLateralAxis(nodeName: string, centerX: number, centerZ: number): { x: number; z: number } | null {
    const lower = nodeName.toLowerCase();
    if (lower.endsWith('_n') || lower.endsWith('_s')) {
        return { x: 1, z: 0 };
    }
    if (lower.endsWith('_e')) {
        return { x: 0, z: 1 };
    }
    // The two corner stands face diagonally toward the pool centre.
    const inwardX = 25 - centerX;
    const inwardZ = -centerZ;
    const length = Math.hypot(inwardX, inwardZ);
    if (length < 1e-6) {
        return null;
    }
    return { x: -inwardZ / length, z: inwardX / length };
}

function buildSeatSideToneGeometry(pool: Node): { positions: number[]; indices: number[]; nodes: number; triangles: number } | null {
    const positions: number[] = [];
    const indices: number[] = [];
    const poolWorld = new Mat4();
    const inversePoolWorld = new Mat4();
    pool.getWorldMatrix(poolWorld);
    if (!Mat4.invert(inversePoolWorld, poolWorld)) {
        return null;
    }

    let sourceNodes = 0;
    let triangleCount = 0;
    const a = new Vec3();
    const b = new Vec3();
    const c = new Vec3();
    const visit = (node: Node) => {
        if (isSeatBatchNode(node.name)) {
            const renderer = node.getComponent(MeshRenderer);
            const mesh = renderer?.mesh;
            if (renderer && mesh) {
                const nodeWorld = new Mat4();
                const nodeToPool = new Mat4();
                node.getWorldMatrix(nodeWorld);
                Mat4.multiply(nodeToPool, inversePoolWorld, nodeWorld);
                let includedNode = false;

                for (let p = 0; p < mesh.struct.primitives.length; p++) {
                    const source = renderer.getSharedMaterial(p) ?? renderer.sharedMaterials[p] ?? null;
                    const materialName = source?.name.toLowerCase() ?? '';
                    const isSeatPrimitive = materialName.includes(SEAT_MATERIAL_KEYWORD);
                    const isBleacherAtlas = materialName.includes(BLEACHER_ATLAS_MATERIAL_KEYWORD);
                    if (!isSeatPrimitive && !isBleacherAtlas) {
                        continue;
                    }
                    const rawPositions = mesh.readAttribute(p, gfx.AttributeName.ATTR_POSITION) as ArrayLike<number> | null;
                    const rawIndices = mesh.readIndices(p) as ArrayLike<number> | null;
                    const rawTexCoords = isBleacherAtlas
                        ? mesh.readAttribute(p, gfx.AttributeName.ATTR_TEX_COORD) as ArrayLike<number> | null
                        : null;
                    if (!rawPositions || rawPositions.length < 9) {
                        continue;
                    }
                    if (isBleacherAtlas && !rawTexCoords) {
                        continue;
                    }
                    const vertexCount = Math.floor(rawPositions.length / 3);
                    const sourceIndexCount = rawIndices?.length ?? vertexCount;
                    const remap = new Map<number, number>();
                    const readPoint = (sourceIndex: number, out: Vec3) => {
                        const base = sourceIndex * 3;
                        out.set(rawPositions[base], rawPositions[base + 1], rawPositions[base + 2]);
                        Vec3.transformMat4(out, out, nodeToPool);
                    };

                    for (let i = 0; i + 2 < sourceIndexCount; i += 3) {
                        const ia = rawIndices ? rawIndices[i] : i;
                        const ib = rawIndices ? rawIndices[i + 1] : i + 1;
                        const ic = rawIndices ? rawIndices[i + 2] : i + 2;
                        if (rawTexCoords) {
                            const averageU = (
                                rawTexCoords[ia * 2]
                                + rawTexCoords[ib * 2]
                                + rawTexCoords[ic * 2]
                            ) / 3;
                            if (averageU <= BLEACHER_ATLAS_CONCRETE_MAX_U) {
                                continue;
                            }
                        }
                        readPoint(ia, a);
                        readPoint(ib, b);
                        readPoint(ic, c);
                        const ux = b.x - a.x;
                        const uy = b.y - a.y;
                        const uz = b.z - a.z;
                        const vx = c.x - a.x;
                        const vy = c.y - a.y;
                        const vz = c.z - a.z;
                        const nx = uy * vz - uz * vy;
                        const ny = uz * vx - ux * vz;
                        const nz = ux * vy - uy * vx;
                        const normalLength = Math.hypot(nx, ny, nz);
                        if (normalLength < 1e-7 || Math.abs(ny / normalLength) > 0.72) {
                            continue;
                        }
                        const lateral = seatLateralAxis(node.name, (a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3);
                        if (!lateral) {
                            continue;
                        }
                        const sideDot = (nx * lateral.x + nz * lateral.z) / normalLength;
                        if (Math.abs(sideDot) < SEAT_SIDE_THRESHOLD) {
                            continue;
                        }
                        const sideSign = sideDot >= 0 ? 1 : -1;
                        const append = (sourceIndex: number, point: Vec3) => {
                            const key = sourceIndex * 2 + (sideSign > 0 ? 1 : 0);
                            const existing = remap.get(key);
                            if (existing !== undefined) {
                                return existing;
                            }
                            const outputIndex = positions.length / 3;
                            positions.push(
                                point.x + lateral.x * sideSign * SEAT_SIDE_SURFACE_OFFSET,
                                point.y,
                                point.z + lateral.z * sideSign * SEAT_SIDE_SURFACE_OFFSET,
                            );
                            remap.set(key, outputIndex);
                            return outputIndex;
                        };
                        indices.push(append(ia, a), append(ib, b), append(ic, c));
                        triangleCount++;
                        includedNode = true;
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
    return triangleCount > 0 ? { positions, indices, nodes: sourceNodes, triangles: triangleCount } : null;
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

// Add a single unlit overlay containing only the left/right-facing triangles of
// every moulded seat. The source GLB stays compact: the overlay is derived once
// at load time, then the normal stand-height pass replaces its source material
// so the darker blue follows the same upper/far dimming as the seats.
export function applySeatSideTone(pool: Node | null, debug?: (message: string) => void): void {
    if (!pool?.isValid || pool.getChildByName(SEAT_SIDE_TONE_NODE_NAME)) {
        return;
    }
    const geometry = buildSeatSideToneGeometry(pool);
    if (!geometry) {
        debug?.('seat side tone skipped: no readable matching geometry');
        return;
    }

    let mesh: Mesh | null = null;
    try {
        mesh = utils.createMesh({ positions: geometry.positions, indices: geometry.indices });
    } catch (error) {
        debug?.(`seat side tone mesh build failed: ${error}`);
        return;
    }

    const material = new Material();
    material.initialize({ effectName: 'builtin-unlit' });
    material.name = 'RuntimeSeatSideDarkBlue';
    material.setProperty('mainColor', SEAT_SIDE_COLOR);

    const node = new Node(SEAT_SIDE_TONE_NODE_NAME);
    node.setParent(pool);
    node.setPosition(0, 0, 0);
    node.setRotationFromEuler(0, 0, 0);
    node.setScale(1, 1, 1);
    node.layer = pool.layer;

    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = mesh;
    renderer.setMaterial(material, 0);
    debug?.(`seat side tone attached nodes=${geometry.nodes} triangles=${geometry.triangles} drawCalls=1`);
}
