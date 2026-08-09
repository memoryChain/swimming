import { Color, EffectAsset, gfx, Mat4, Material, Mesh, MeshRenderer, Node, utils, Vec3 } from 'cc';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';

// Preview: drop the player's inverted-hull "comic" outline onto the white pool
// surround curbs (pool_edge_batch). The venue GLB is exported WITHOUT normals to
// save size, but the inverted-hull outline needs per-vertex normals to extrude
// along. Rather than re-export the whole venue with normals (bloats every mesh),
// we recompute SMOOTH (position-welded) normals for just the 4 low-poly curb
// boxes at load time and build a single static shell mesh. Welding coincident
// box-corner vertices averages the face normals, which keeps the outline closed
// at the hard 90° corners instead of splitting open like a raw face-normal hull.
//
// Cost: one extra static, unlit draw call (no skinning, no per-frame work). The
// shell is parented under the curb node, so it hides together with the curbs
// when the camera goes underwater.

const EDGE_NODE_NAME = 'pool_edge_batch';
const SHELL_NODE_NAME = 'PoolEdgeOutlineShell';
// Local-space inflation is lineWidth * 0.001 units (see PlayerOutline.effect).
// The venue is authored in metres, so ~10 => ~1cm outline around the curbs.
const OUTLINE_LINE_WIDTH = 10;
const OUTLINE_DEPTH_BIAS = 0.02;
const OUTLINE_COLOR = new Color(6, 10, 16, 255);
const WELD_UNIT = 1000; // 1mm position quantisation for normal welding.

const TIER_SHELL_NODE_NAME = 'VenueTierEdgeShell';
const TIER_OUTLINE_LINE_WIDTH = 8;
const TIER_OUTLINE_DEPTH_BIAS = 0.018;
const ACCESS_SHELL_NODE_NAME = 'VenueAccessStairEdgeShell';
// Entrance stairs sit much farther from the race camera than the pool curb.
// A 4 cm world-space hull stays around one pixel at broadcast-camera distance.
const ACCESS_OUTLINE_LINE_WIDTH = 40;
const ACCESS_OUTLINE_DEPTH_BIAS = 0.022;
const CONCRETE_MATERIAL_KEYWORD = 'bleacher_step_concrete';
const PLATFORM_MATERIAL_KEYWORD = 'upper_tier_platform_blue';

const SEAT_SIDE_TONE_NODE_NAME = 'BleacherSeatSideToneOverlay';
const SEAT_MATERIAL_KEYWORD = 'stadiumseat_blue';
const SEAT_SIDE_THRESHOLD = 0.75;
const SEAT_SIDE_SURFACE_OFFSET = 0.003;
// Only a mild step down from StadiumSeat_Blue (roughly 83% brightness). Strong
// contrast turns repeated low-poly side faces into a distracting stripe pattern.
const SEAT_SIDE_COLOR = new Color(4, 34, 170, 255);

type ShellGeometry = { positions: number[]; normals: number[]; indices: number[] };
type StructureOutlineGroup = 'tier' | 'access';

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

function finishSmoothShellGeometry(positions: number[], indices: number[]): ShellGeometry | null {
    if (positions.length < 9 || indices.length < 3) {
        return null;
    }

    const vertexCount = positions.length / 3;
    // Accumulate face normals into a per-position bucket so coincident corner
    // vertices share one averaged (smooth) normal.
    const weld = new Map<string, [number, number, number]>();
    const keyOf = (x: number, y: number, z: number) =>
        `${Math.round(x * WELD_UNIT)}_${Math.round(y * WELD_UNIT)}_${Math.round(z * WELD_UNIT)}`;

    for (let t = 0; t + 2 < indices.length; t += 3) {
        const a = indices[t] * 3;
        const b = indices[t + 1] * 3;
        const c = indices[t + 2] * 3;
        const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
        const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
        const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx - ax, vy = cy - ay, vz = cz - az;
        // Face normal (unnormalised so larger faces weigh more, which is fine).
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        for (const base of [a, b, c]) {
            const key = keyOf(positions[base], positions[base + 1], positions[base + 2]);
            const acc = weld.get(key);
            if (acc) {
                acc[0] += nx; acc[1] += ny; acc[2] += nz;
            } else {
                weld.set(key, [nx, ny, nz]);
            }
        }
    }

    const normals: number[] = new Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
        const base = i * 3;
        const key = keyOf(positions[base], positions[base + 1], positions[base + 2]);
        const acc = weld.get(key);
        let nx = 0, ny = 1, nz = 0;
        if (acc) {
            const len = Math.hypot(acc[0], acc[1], acc[2]);
            if (len > 1e-6) {
                nx = acc[0] / len; ny = acc[1] / len; nz = acc[2] / len;
            }
        }
        normals[base] = nx; normals[base + 1] = ny; normals[base + 2] = nz;
    }

    return { positions, normals, indices };
}

function appendPrimitive(
    mesh: Mesh,
    primitive: number,
    positions: number[],
    indices: number[],
    transform?: Mat4,
): number {
    const pos = mesh.readAttribute(primitive, gfx.AttributeName.ATTR_POSITION) as ArrayLike<number> | null;
    const idx = mesh.readIndices(primitive) as ArrayLike<number> | null;
    if (!pos || pos.length < 9) {
        return 0;
    }
    const vertexOffset = positions.length / 3;
    const vertCount = Math.floor(pos.length / 3);
    const point = new Vec3();
    for (let i = 0; i < vertCount; i++) {
        const base = i * 3;
        if (transform) {
            point.set(pos[base], pos[base + 1], pos[base + 2]);
            Vec3.transformMat4(point, point, transform);
            positions.push(point.x, point.y, point.z);
        } else {
            positions.push(pos[base], pos[base + 1], pos[base + 2]);
        }
    }
    if (idx && idx.length >= 3) {
        for (let i = 0; i < idx.length; i++) {
            indices.push(idx[i] + vertexOffset);
        }
        return Math.floor(idx.length / 3);
    }
    // Non-indexed submesh: emit a sequential triangle list.
    for (let i = 0; i < vertCount; i++) {
        indices.push(i + vertexOffset);
    }
    return Math.floor(vertCount / 3);
}

// Merge every submesh into one geometry and give each vertex a smooth normal
// welded across coincident positions. Returns null if the mesh has no readable
// position data.
function buildSmoothShellGeometry(mesh: Mesh): ShellGeometry | null {
    const positions: number[] = [];
    const indices: number[] = [];
    for (let p = 0; p < mesh.struct.primitives.length; p++) {
        appendPrimitive(mesh, p, positions, indices);
    }
    return finishSmoothShellGeometry(positions, indices);
}

function isTierOutlineNode(name: string, group: StructureOutlineGroup): boolean {
    const lower = name.toLowerCase();
    if (group === 'access') {
        return lower === 'bleacheraccess_architecture_merged';
    }
    return lower.startsWith('bleacherbatch_')
        || lower === 'cornerstands_merged'
        || lower === 'standstructure_merged';
}

function shouldOutlinePrimitive(nodeName: string, materialName: string, primitive: number): boolean {
    const lowerNode = nodeName.toLowerCase();
    const lowerMaterial = materialName.toLowerCase();
    if (lowerNode === 'standstructure_merged') {
        return lowerMaterial.includes(PLATFORM_MATERIAL_KEYWORD)
            || (!lowerMaterial && primitive === 0);
    }
    return lowerMaterial.includes(CONCRETE_MATERIAL_KEYWORD)
        || (!lowerMaterial && primitive === 0);
}

function buildTierShellGeometry(
    pool: Node,
    group: StructureOutlineGroup,
): { geometry: ShellGeometry; nodes: number; triangles: number } | null {
    const positions: number[] = [];
    const indices: number[] = [];
    const poolWorld = new Mat4();
    const inversePoolWorld = new Mat4();
    pool.getWorldMatrix(poolWorld);
    if (!Mat4.invert(inversePoolWorld, poolWorld)) {
        return null;
    }

    let sourceNodes = 0;
    let triangles = 0;
    const visit = (node: Node) => {
        if (isTierOutlineNode(node.name, group)) {
            const renderer = node.getComponent(MeshRenderer);
            const mesh = renderer?.mesh;
            if (renderer && mesh) {
                const nodeWorld = new Mat4();
                const nodeToPool = new Mat4();
                node.getWorldMatrix(nodeWorld);
                Mat4.multiply(nodeToPool, inversePoolWorld, nodeWorld);
                let included = false;
                for (let p = 0; p < mesh.struct.primitives.length; p++) {
                    const source = renderer.getSharedMaterial(p) ?? renderer.sharedMaterials[p] ?? null;
                    if (!shouldOutlinePrimitive(node.name, source?.name ?? '', p)) {
                        continue;
                    }
                    triangles += appendPrimitive(mesh, p, positions, indices, nodeToPool);
                    included = true;
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

    const geometry = finishSmoothShellGeometry(positions, indices);
    return geometry ? { geometry, nodes: sourceNodes, triangles } : null;
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
                    if (!source?.name.toLowerCase().includes(SEAT_MATERIAL_KEYWORD)) {
                        continue;
                    }
                    const rawPositions = mesh.readAttribute(p, gfx.AttributeName.ATTR_POSITION) as ArrayLike<number> | null;
                    const rawIndices = mesh.readIndices(p) as ArrayLike<number> | null;
                    if (!rawPositions || rawPositions.length < 9) {
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

// Attach a comic-style inverted-hull outline to the pool surround curbs. Safe to
// call once after the pool scene is ready; no-ops if the curb node or its mesh is
// missing or the shell already exists.
export function applyPoolEdgeToonOutline(pool: Node | null, debug?: (message: string) => void): void {
    if (!pool?.isValid) {
        return;
    }
    const edge = findNodeByName(pool, EDGE_NODE_NAME);
    if (!edge?.isValid) {
        debug?.('pool edge outline skipped: curb node missing');
        return;
    }
    if (edge.getChildByName(SHELL_NODE_NAME)) {
        return;
    }
    const renderer = edge.getComponent(MeshRenderer);
    if (!renderer?.mesh) {
        debug?.('pool edge outline skipped: curb renderer/mesh missing');
        return;
    }

    const geometry = buildSmoothShellGeometry(renderer.mesh);
    if (!geometry) {
        debug?.('pool edge outline skipped: no readable curb geometry');
        return;
    }

    let shellMesh: Mesh | null = null;
    try {
        shellMesh = utils.createMesh(geometry);
    } catch (error) {
        debug?.(`pool edge outline mesh build failed: ${error}`);
        return;
    }

    loadRaceAsset(RESOURCE_PATHS.playerOutlineEffect, EffectAsset, (err, effect) => {
        if (err || !effect || !edge.isValid || !shellMesh) {
            shellMesh?.destroy();
            debug?.('pool edge outline skipped: outline effect unavailable');
            return;
        }
        if (edge.getChildByName(SHELL_NODE_NAME)) {
            shellMesh.destroy();
            return;
        }

        const material = new Material();
        material.initialize({ effectAsset: effect });
        material.name = 'PoolEdgeInvertedHullOutline';
        material.setProperty('lineWidth', OUTLINE_LINE_WIDTH);
        material.setProperty('depthBias', OUTLINE_DEPTH_BIAS);
        material.setProperty('baseColor', OUTLINE_COLOR);

        const shell = new Node(SHELL_NODE_NAME);
        shell.setParent(edge);
        shell.setPosition(0, 0, 0);
        shell.setRotationFromEuler(0, 0, 0);
        shell.setScale(1, 1, 1);
        shell.layer = edge.layer;

        const shellRenderer = shell.addComponent(MeshRenderer);
        shellRenderer.mesh = shellMesh;
        shellRenderer.setMaterial(material, 0);
        debug?.('pool edge comic outline attached');
    });
}

// Outline only the large structural silhouettes that need separation in the
// flat-colour venue: bleacher concrete steps, access stairs/platforms and the
// upper platform. Seat, rail, door and emergency-sign primitives are excluded.
// All selected primitives are folded into one static shell, so the effect costs
// one draw call and does no per-frame CPU work.
export function applyStandStructureToonOutline(pool: Node | null, debug?: (message: string) => void): void {
    if (!pool?.isValid
        || pool.getChildByName(TIER_SHELL_NODE_NAME)
        || pool.getChildByName(ACCESS_SHELL_NODE_NAME)) {
        return;
    }
    const tierBuilt = buildTierShellGeometry(pool, 'tier');
    const accessBuilt = buildTierShellGeometry(pool, 'access');
    if (!tierBuilt || !accessBuilt) {
        debug?.('stand structure outline skipped: no readable matching geometry');
        return;
    }

    let tierMesh: Mesh | null = null;
    let accessMesh: Mesh | null = null;
    try {
        tierMesh = utils.createMesh(tierBuilt.geometry);
        accessMesh = utils.createMesh(accessBuilt.geometry);
    } catch (error) {
        tierMesh?.destroy();
        accessMesh?.destroy();
        debug?.(`stand structure outline mesh build failed: ${error}`);
        return;
    }

    loadRaceAsset(RESOURCE_PATHS.playerOutlineEffect, EffectAsset, (err, effect) => {
        if (err || !effect || !pool.isValid || !tierMesh || !accessMesh) {
            tierMesh?.destroy();
            accessMesh?.destroy();
            debug?.('stand structure outline skipped: outline effect unavailable');
            return;
        }
        if (pool.getChildByName(TIER_SHELL_NODE_NAME) || pool.getChildByName(ACCESS_SHELL_NODE_NAME)) {
            tierMesh.destroy();
            accessMesh.destroy();
            return;
        }

        const attach = (name: string, mesh: Mesh, lineWidth: number, depthBias: number) => {
            const material = new Material();
            material.initialize({ effectAsset: effect });
            material.name = `${name}Material`;
            material.setProperty('lineWidth', lineWidth);
            material.setProperty('depthBias', depthBias);
            material.setProperty('baseColor', OUTLINE_COLOR);

            const shell = new Node(name);
            shell.setParent(pool);
            shell.setPosition(0, 0, 0);
            shell.setRotationFromEuler(0, 0, 0);
            shell.setScale(1, 1, 1);
            shell.layer = pool.layer;

            const renderer = shell.addComponent(MeshRenderer);
            renderer.mesh = mesh;
            renderer.setMaterial(material, 0);
        };
        attach(TIER_SHELL_NODE_NAME, tierMesh, TIER_OUTLINE_LINE_WIDTH, TIER_OUTLINE_DEPTH_BIAS);
        attach(ACCESS_SHELL_NODE_NAME, accessMesh, ACCESS_OUTLINE_LINE_WIDTH, ACCESS_OUTLINE_DEPTH_BIAS);
        debug?.(`stand structure outline attached tier=${tierBuilt.triangles} access=${accessBuilt.triangles} drawCalls=2`);
    });
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
