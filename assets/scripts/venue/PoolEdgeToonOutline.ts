import { Color, EffectAsset, gfx, Material, Mesh, MeshRenderer, Node, utils } from 'cc';
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

// Merge every submesh into one geometry and give each vertex a smooth normal
// welded across coincident positions. Returns null if the mesh has no readable
// position data.
function buildSmoothShellGeometry(mesh: Mesh): { positions: number[]; normals: number[]; indices: number[] } | null {
    const primitiveCount = mesh.struct.primitives.length;
    const positions: number[] = [];
    const indices: number[] = [];
    let vertexOffset = 0;

    for (let p = 0; p < primitiveCount; p++) {
        const pos = mesh.readAttribute(p, gfx.AttributeName.ATTR_POSITION) as ArrayLike<number> | null;
        const idx = mesh.readIndices(p) as ArrayLike<number> | null;
        if (!pos || pos.length < 9) {
            continue;
        }
        const vertCount = Math.floor(pos.length / 3);
        for (let i = 0; i < vertCount * 3; i++) {
            positions.push(pos[i]);
        }
        if (idx && idx.length >= 3) {
            for (let i = 0; i < idx.length; i++) {
                indices.push(idx[i] + vertexOffset);
            }
        } else {
            // Non-indexed submesh: emit a sequential triangle list.
            for (let i = 0; i < vertCount; i++) {
                indices.push(i + vertexOffset);
            }
        }
        vertexOffset += vertCount;
    }

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
