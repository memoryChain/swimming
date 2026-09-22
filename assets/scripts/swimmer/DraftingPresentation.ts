import { Color, gfx, Material, Mesh, MeshRenderer, Node, Texture2D, utils } from 'cc';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { DraftingModel, DRAFTING_POINTS, DRAFTING_TUNING } from './DraftingRules';

const QUADS_PER_UPLOAD_BUCKET = 8;
interface DraftingUpload {
    positions: Float32Array;
    uvs: Float32Array;
    colors: Float32Array;
    indices16: Uint16Array;
}

/** 共用图集、单次提交、固定容量；只在15Hz路径更新时上传顶点。 */
export class DraftingPresentation {
    private readonly root: Node;
    private readonly material = new Material();
    private readonly mesh: Mesh;
    private readonly positions: Float32Array;
    private readonly colors: Float32Array;
    private readonly uploads: DraftingUpload[] = [];
    private ready = false;
    private disposed = false;
    private revision = -1;

    constructor(parent: Node, private readonly model: DraftingModel, private readonly waterY: number) {
        const quads = model.paths.length * (DRAFTING_POINTS - 1), vertices = quads * 4;
        this.positions = new Float32Array(vertices * 3);
        this.colors = new Float32Array(vertices * 4);
        const uvs = new Float32Array(vertices * 2), indices16 = new Uint16Array(quads * 6);
        for (let i = 0; i < quads; i++) {
            const v = i * 4;
            indices16.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6);
            // 复用水面图集左半幅，保留纹理柔边。
            uvs.set([0, 0, 0.5, 0, 0, 1, 0.5, 1], i * 8);
        }
        const minPos = { x: -200, y: waterY - 1, z: -50 };
        const maxPos = { x: 200, y: waterY + 1, z: 50 };
        const dynamic = (utils as unknown as { MeshUtils: { createDynamicMesh: Function } }).MeshUtils;
        this.mesh = dynamic.createDynamicMesh(0, { positions: this.positions, colors: this.colors, uvs, indices16, minPos, maxPos }, undefined,
            { maxSubMeshes: 1, maxSubMeshVertices: vertices, maxSubMeshIndices: indices16.length });
        // Cocos 动态网格按流的顺序上传，UV及索引即使不变也必须保留。
        // 初始化时缓存分档视图，共用原缓冲。比赛内不创建 subarray，只上传有效前缀。
        for (let count = QUADS_PER_UPLOAD_BUCKET; count < quads + QUADS_PER_UPLOAD_BUCKET; count += QUADS_PER_UPLOAD_BUCKET) {
            const size = Math.min(count, quads);
            this.uploads.push({ positions: this.positions.subarray(0, size * 12),
                uvs: uvs.subarray(0, size * 8), colors: this.colors.subarray(0, size * 16),
                indices16: indices16.subarray(0, size * 6) });
        }
        this.root = new Node('DraftingWake'); parent.addChild(this.root); this.root.layer = parent.layer;
        this.material.initialize({ effectName: 'builtin-unlit', technique: 1,
            defines: { USE_VERTEX_COLOR: true, USE_TEXTURE: true }, states: {
                rasterizerState: { cullMode: gfx.CullMode.NONE },
                depthStencilState: { depthTest: true, depthWrite: false },
            } });
        this.material.setProperty('mainColor', new Color(130, 240, 245, 160));
        const renderer = this.root.addComponent(MeshRenderer);
        renderer.mesh = this.mesh; renderer.setMaterial(this.material, 0);
        this.root.active = false;
        loadRaceAsset(RESOURCE_PATHS.swimmerSplashSurfaceTexture, Texture2D, (error, texture) => {
            if (this.disposed || error || !texture) return;
            this.material.setProperty('mainTexture', texture);
            this.ready = true;
        });
    }

    update(): void {
        if (!DRAFTING_TUNING.visuals || !this.ready) { this.hide(); return; }
        if (this.revision === this.model.revision) return;
        this.revision = this.model.revision;
        let quad = 0;
        for (let lane = 0; lane < this.model.paths.length; lane++) {
            const path = this.model.paths[lane], racer = this.model.racers[lane];
            if (path.count < 2 || !racer.eligible) continue;
            const residue = path.generating ? 1 : Math.max(0, 1 - (this.model.clock - path.stoppedAt) / Math.max(0.01, DRAFTING_TUNING.residueSeconds));
            let along = Math.hypot(racer.x - path.x[path.head], racer.z - path.z[path.head]);
            for (let back = 1; back < path.count; back++) {
                const a = path.index(back - 1), b = path.index(back);
                if (this.model.clock - path.time[b] > DRAFTING_TUNING.maxAge) break;
                const vx = path.x[b] - path.x[a], vz = path.z[b] - path.z[a], len = Math.hypot(vx, vz);
                if (len < 0.001) continue;
                const begin = Math.max(0, (DRAFTING_TUNING.minDistance - along) / len);
                const end = Math.min(1, (DRAFTING_TUNING.maxDistance - along) / len);
                if (begin < end) {
                    const ax = path.x[a] + vx * begin, az = path.z[a] + vz * begin;
                    const bx = path.x[a] + vx * end, bz = path.z[a] + vz * end;
                    const nx = -vz / len * DRAFTING_TUNING.width * 0.5, nz = vx / len * DRAFTING_TUNING.width * 0.5;
                    const opacity = residue * Math.min(1, (DRAFTING_TUNING.maxDistance - along) / 0.7);
                    const base = quad++ * 4;
                    this.vertex(base, ax + nx, az + nz, opacity);
                    this.vertex(base + 1, ax - nx, az - nz, opacity);
                    this.vertex(base + 2, bx + nx, bz + nz, opacity);
                    this.vertex(base + 3, bx - nx, bz - nz, opacity);
                }
                along += len;
                if (along >= DRAFTING_TUNING.maxDistance) break;
            }
        }
        if (!quad) { this.hide(); return; }
        const upload = this.uploads[Math.floor((quad - 1) / QUADS_PER_UPLOAD_BUCKET)];
        // 只清掉当前分档内至多七片的尾部，防止人数减少后画出上一轮残留。
        this.positions.fill(0, quad * 12, upload.positions.length);
        this.mesh.updateSubMesh(0, upload);
        if (!this.root.active) this.root.active = true;
    }
    private vertex(i: number, x: number, z: number, alpha: number): void {
        this.positions[i * 3] = x; this.positions[i * 3 + 1] = this.waterY + 0.018; this.positions[i * 3 + 2] = z;
        this.colors[i * 4] = 1; this.colors[i * 4 + 1] = 1; this.colors[i * 4 + 2] = 1; this.colors[i * 4 + 3] = alpha;
    }
    hide(): void { if (this.root.active) this.root.active = false; this.revision = -1; }
    dispose(): void { this.disposed = true; if (this.root.isValid) this.root.destroy(); this.mesh.destroy(); this.material.destroy(); }
}
