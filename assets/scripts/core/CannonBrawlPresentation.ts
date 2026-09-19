import { Color, gfx, Material, Mesh, MeshRenderer, Node, primitives, utils, Vec3 } from 'cc';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { CANNON_BRAWL_TUNING, CannonImpact, CannonLaunch } from './CannonBrawlController';
import { applyWaterExplosionPhase, buildWaterExplosionGeometry } from './MineRelayBrawlPresentation';

const PRESENTATION_INTERVAL = 1 / 20;
const CANNON_EDGE_OFFSET = 1.4;
const PROJECTILE_ARC_HEIGHT = 5.8;
const IMPACT_SECONDS = 0.52;
const CANNON_EXPLOSION_INTENSITY = 1.08;

/** 固定网格、共享材质的炮台／炮弹／水面预警表现；只消费权威规则状态。 */
export class CannonBrawlPresentation {
    private readonly cannons: Node[] = [];
    private marker: Node | null = null;
    private projectile: Node | null = null;
    private impactPlume: Node | null = null;
    private cannonMesh: Mesh | null = null;
    private markerMesh: Mesh | null = null;
    private projectileMesh: Mesh | null = null;
    private impactMesh: Mesh | null = null;
    private cannonMaterial: Material | null = null;
    private markerMaterial: Material | null = null;
    private projectileMaterial: Material | null = null;
    private impactMaterial: Material | null = null;
    private activeStrikeId = -1;
    private lastStrikeId = -1;
    private activeCannonIndex = 0;
    private targetX = 0;
    private targetZ = 0;
    private sourceX = 0;
    private sourceY = 0;
    private sourceZ = 0;
    private impactRemaining = 0;
    private elapsed = PRESENTATION_INTERVAL;
    private clock = 0;
    private disposed = false;

    constructor(
        private readonly parent: Node,
        private readonly course: RaceCourseLayout,
    ) {
        this.build();
    }

    reset(): void {
        this.activeStrikeId = -1;
        this.lastStrikeId = -1;
        this.impactRemaining = 0;
        this.elapsed = PRESENTATION_INTERVAL;
        this.clock = 0;
        this.setActive(this.marker, false);
        this.setActive(this.projectile, false);
        this.setActive(this.impactPlume, false);
    }

    showLaunch(launch: CannonLaunch): void {
        if (this.disposed || !launch) return;
        this.activeStrikeId = launch.strikeId;
        this.lastStrikeId = launch.strikeId;
        this.activeCannonIndex = launch.strikeId & 1;
        const target = this.course.swimPosition(launch.targetDistance, launch.targetZ);
        this.targetX = target.x;
        this.targetZ = target.z;
        const side = this.activeCannonIndex === 0 ? -1 : 1;
        const edgeZ = side * (this.course.poolWidth * 0.5 + CANNON_EDGE_OFFSET);
        const cannon = this.cannons[this.activeCannonIndex];
        if (cannon?.isValid) {
            cannon.setWorldPosition(target.x, this.course.waterY + 0.12, edgeZ);
            cannon.setRotationFromEuler(0, side > 0 ? 180 : 0, 0);
        }
        this.sourceX = target.x;
        this.sourceY = this.course.waterY + 1.2;
        this.sourceZ = edgeZ + (side > 0 ? -0.9 : 0.9);
        this.marker?.setWorldPosition(target.x, this.course.waterY + 0.045, target.z);
        this.marker?.setScale(1, 1, 1);
        this.projectile?.setWorldPosition(this.sourceX, this.sourceY, this.sourceZ);
        this.projectile?.setScale(0.58, 0.58, 0.58);
        this.setActive(this.marker, true);
        this.setActive(this.projectile, true);
        this.setActive(this.impactPlume, false);
        this.impactRemaining = 0;
    }

    showImpact(impact: CannonImpact): void {
        if (this.disposed || !impact
            || (impact.strikeId !== this.activeStrikeId && impact.strikeId !== this.lastStrikeId)) return;
        this.setActive(this.marker, false);
        this.setActive(this.projectile, false);
        if (this.impactPlume?.isValid) {
            this.impactPlume.setWorldPosition(this.targetX, this.course.waterY + 0.035, this.targetZ);
            this.impactPlume.setRotationFromEuler(0, impact.strikeId * 53, 0);
            applyWaterExplosionPhase(this.impactPlume, 0, CANNON_EXPLOSION_INTENSITY);
            this.impactPlume.active = true;
        }
        this.impactRemaining = IMPACT_SECONDS;
        this.activeStrikeId = -1;
    }

    syncLaunch(launch: CannonLaunch | null): void {
        if (!launch) {
            if (this.activeStrikeId >= 0) {
                this.activeStrikeId = -1;
                this.setActive(this.marker, false);
                this.setActive(this.projectile, false);
            }
            return;
        }
        if (launch.strikeId !== this.activeStrikeId) this.showLaunch(launch);
    }

    update(dt: number, launch: CannonLaunch | null, remainingSeconds: number, racing: boolean): void {
        if (this.disposed) return;
        if (!racing) {
            this.setActive(this.marker, false);
            this.setActive(this.projectile, false);
            this.setActive(this.impactPlume, false);
            return;
        }
        this.syncLaunch(launch);
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        this.elapsed += step;
        if (this.elapsed < PRESENTATION_INTERVAL) return;
        const presentationStep = this.elapsed;
        this.elapsed = 0;
        this.clock += presentationStep;

        if (launch && this.activeStrikeId === launch.strikeId) {
            const total = Math.max(0.01, CANNON_BRAWL_TUNING.warningSeconds);
            const progress = Math.max(0, Math.min(1, 1 - remainingSeconds / total));
            const x = this.sourceX + (this.targetX - this.sourceX) * progress;
            const z = this.sourceZ + (this.targetZ - this.sourceZ) * progress;
            const y = this.sourceY + (this.course.waterY + 0.12 - this.sourceY) * progress
                + Math.sin(progress * Math.PI) * PROJECTILE_ARC_HEIGHT;
            this.projectile?.setWorldPosition(x, y, z);
            const markerPulse = 1 + Math.sin(this.clock * 10) * 0.055;
            this.marker?.setScale(markerPulse, 1, markerPulse);
        }

        if (this.impactRemaining > 0) {
            this.impactRemaining = Math.max(0, this.impactRemaining - presentationStep);
            const progress = 1 - this.impactRemaining / IMPACT_SECONDS;
            if (this.impactPlume) applyWaterExplosionPhase(this.impactPlume, progress, CANNON_EXPLOSION_INTENSITY);
            if (this.impactRemaining <= 0) this.setActive(this.impactPlume, false);
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const cannon of this.cannons) if (cannon?.isValid) cannon.destroy();
        this.cannons.length = 0;
        if (this.marker?.isValid) this.marker.destroy();
        if (this.projectile?.isValid) this.projectile.destroy();
        if (this.impactPlume?.isValid) this.impactPlume.destroy();
        this.marker = this.projectile = this.impactPlume = null;
        this.cannonMesh?.destroy();
        this.markerMesh?.destroy();
        this.projectileMesh?.destroy();
        this.impactMesh?.destroy();
        this.cannonMaterial?.destroy();
        this.markerMaterial?.destroy();
        this.projectileMaterial?.destroy();
        this.impactMaterial?.destroy();
    }

    private build(): void {
        if (!this.parent?.isValid) return;
        this.cannonMesh = utils.createMesh(buildCannonGeometry());
        this.markerMesh = utils.createMesh(buildMarkerGeometry());
        this.projectileMesh = utils.createMesh(buildLowPolyBallGeometry());
        this.impactMesh = utils.createMesh(buildWaterExplosionGeometry());
        this.cannonMaterial = makeVertexMaterial('CannonBrawlPropMaterial', true);
        this.markerMaterial = makeVertexMaterial('CannonBrawlMarkerMaterial', false);
        this.impactMaterial = makeVertexMaterial('CannonBrawlImpactMaterial', false);
        this.projectileMaterial = new Material();
        this.projectileMaterial.initialize({ effectName: 'builtin-unlit' });
        this.projectileMaterial.name = 'CannonBrawlProjectileMaterial';
        this.projectileMaterial.setProperty('mainColor', new Color(31, 35, 41, 255));

        const midpoint = (this.course.startX + this.course.finishX) * 0.5;
        for (let i = 0; i < 2; i++) {
            const side = i === 0 ? -1 : 1;
            const cannon = this.makeMeshNode(`PoolsideCannon_${i + 1}`, this.cannonMesh, this.cannonMaterial);
            cannon.setWorldPosition(midpoint, this.course.waterY + 0.12, side * (this.course.poolWidth * 0.5 + CANNON_EDGE_OFFSET));
            cannon.setRotationFromEuler(0, side > 0 ? 180 : 0, 0);
            this.cannons.push(cannon);
        }
        this.marker = this.makeMeshNode('CannonImpactWarning', this.markerMesh, this.markerMaterial);
        this.projectile = this.makeMeshNode('CannonProjectile', this.projectileMesh, this.projectileMaterial);
        this.impactPlume = this.makeMeshNode('CannonImpactPlume', this.impactMesh, this.impactMaterial);
        this.marker.active = false;
        this.projectile.active = false;
        this.impactPlume.active = false;
    }

    private makeMeshNode(name: string, mesh: Mesh, material: Material): Node {
        const node = new Node(name);
        node.setParent(this.parent);
        node.layer = this.parent.layer;
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = mesh;
        renderer.setMaterial(material, 0);
        return node;
    }

    private setActive(node: Node | null, active: boolean): void {
        if (node?.isValid && node.active !== active) node.active = active;
    }
}

function makeVertexMaterial(name: string, opaque: boolean): Material {
    const material = new Material();
    material.initialize({
        effectName: 'builtin-unlit',
        technique: opaque ? 0 : 1,
        defines: { USE_VERTEX_COLOR: true },
        states: opaque ? undefined : {
            rasterizerState: { cullMode: gfx.CullMode.NONE },
            depthStencilState: { depthTest: true, depthWrite: false },
        },
    });
    material.name = name;
    material.setProperty('mainColor', Color.WHITE);
    return material;
}

function buildCannonGeometry(): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const iron: ColorTuple = [0.12, 0.15, 0.20, 1];
    const ironLight: ColorTuple = [0.22, 0.28, 0.35, 1];
    const ironDark: ColorTuple = [0.055, 0.065, 0.085, 1];
    const carriage: ColorTuple = [0.53, 0.17, 0.09, 1];
    const carriageLight: ColorTuple = [0.68, 0.27, 0.11, 1];
    const brass: ColorTuple = [0.72, 0.45, 0.14, 1];

    // 贴地底盘和两根炮架纵梁保持明确接触，远景先读出稳重的梯形承重轮廓。
    appendBox(positions, colors, indices, 0, 0.14, -0.02, 1.72, 0.28, 1.38, iron);
    appendBox(positions, colors, indices, -0.49, 0.43, -0.08, 0.25, 0.34, 1.24, carriage);
    appendBox(positions, colors, indices, 0.49, 0.43, -0.08, 0.25, 0.34, 1.24, carriage);
    appendBox(positions, colors, indices, 0, 0.39, -0.57, 1.18, 0.34, 0.24, carriageLight);

    // 轮轴贯穿两侧车轮；外胎、轮面和轮毂分层但仍属于同一合并网格。
    appendCylinder(positions, colors, indices, 0, 0.46, 0.08, 0.12, 1.66, 'x', ironDark);
    for (const side of [-1, 1]) {
        // 三层共用轴向中心，并让轮面、轮毂依次加宽。这样两侧端盖都会逐层
        // 外凸，不再全部落在同一平面产生深度闪烁（看起来像轮子一直在转）。
        const wheelCenterX = side * 0.76;
        appendCylinder(positions, colors, indices, wheelCenterX, 0.46, 0.08, 0.52, 0.22, 'x', ironDark);
        appendCylinder(positions, colors, indices, wheelCenterX, 0.46, 0.08, 0.39, 0.25, 'x', carriage);
        appendCylinder(positions, colors, indices, wheelCenterX, 0.46, 0.08, 0.18, 0.30, 'x', brass);
    }

    // 两根斜撑从纵梁上表面接到炮耳下方，避免炮管像悬浮在方盒上。
    appendBeamYZ(positions, colors, indices, -0.49, 0.55, -0.33, 0.94, -0.07, 0.18, 0.16, carriageLight);
    appendBeamYZ(positions, colors, indices, 0.49, 0.55, -0.33, 0.94, -0.07, 0.18, 0.16, carriageLight);
    appendCylinder(positions, colors, indices, 0, 0.98, -0.05, 0.31, 1.12, 'x', brass);

    // 炮身由后膛、加强箍、渐细炮管和双层炮口组成，保留硬朗十边低模轮廓。
    appendTaperedCylinder(positions, colors, indices,
        0, 0.94, -0.70, 0, 0.98, -0.18, 0.36, 0.30, ironLight);
    appendTaperedCylinder(positions, colors, indices,
        0, 0.975, -0.24, 0, 1.01, 0.02, 0.36, 0.32, brass);
    appendTaperedCylinder(positions, colors, indices,
        0, 1.00, -0.02, 0, 1.18, 1.34, 0.27, 0.17, ironLight);
    appendTaperedCylinder(positions, colors, indices,
        0, 1.16, 1.24, 0, 1.20, 1.53, 0.25, 0.29, iron);
    appendTaperedCylinder(positions, colors, indices,
        0, 1.195, 1.47, 0, 1.22, 1.66, 0.34, 0.34, brass);
    // 略微前置的暗色圆面覆盖炮口端盖，比赛镜头下能明确读成空膛而不是实心柱。
    appendTaperedCylinder(positions, colors, indices,
        0, 1.222, 1.662, 0, 1.223, 1.675, 0.235, 0.235, ironDark);

    // 后膛把手让背面也有清晰轮廓，同时与后膛末端保持小幅穿插连接。
    appendBox(positions, colors, indices, 0, 0.88, -0.78, 0.40, 0.16, 0.26, brass);
    return geometry(positions, colors, indices, new Vec3(-0.96, 0, -0.91), new Vec3(0.96, 1.57, 1.70));
}

function buildMarkerGeometry(): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    appendDisc(positions, colors, indices, CANNON_BRAWL_TUNING.coreAlongRadius,
        CANNON_BRAWL_TUNING.coreLateralRadius, [1, 0.12, 0.04, 0.54], [1, 0.22, 0.03, 0.18], 0);
    appendRing(positions, colors, indices,
        CANNON_BRAWL_TUNING.coreAlongRadius * 1.12,
        CANNON_BRAWL_TUNING.coreLateralRadius * 1.12,
        CANNON_BRAWL_TUNING.splashAlongRadius,
        CANNON_BRAWL_TUNING.splashLateralRadius,
        [1, 0.57, 0.05, 0.34], [1, 0.77, 0.18, 0.05], 0.002);
    return geometry(
        positions, colors, indices,
        new Vec3(-CANNON_BRAWL_TUNING.splashAlongRadius, -0.01, -CANNON_BRAWL_TUNING.splashLateralRadius),
        new Vec3(CANNON_BRAWL_TUNING.splashAlongRadius, 0.01, CANNON_BRAWL_TUNING.splashLateralRadius),
    );
}

function buildLowPolyBallGeometry(): primitives.IGeometry {
    const positions = [0, 0.65, 0, 0.65, 0, 0, 0, 0, 0.65, -0.65, 0, 0, 0, 0, -0.65, 0, -0.65, 0];
    const colors: number[] = [];
    for (let i = 0; i < 6; i++) colors.push(1, 1, 1, 1);
    const indices = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1, 5, 2, 1, 5, 3, 2, 5, 4, 3, 5, 1, 4];
    return geometry(positions, colors, indices, new Vec3(-0.65, -0.65, -0.65), new Vec3(0.65, 0.65, 0.65));
}

type ColorTuple = readonly [number, number, number, number];

function geometry(positions: number[], colors: number[], indices: number[], minPos: Vec3, maxPos: Vec3): primitives.IGeometry {
    return { positions, colors, indices, minPos, maxPos };
}

function pushColor(colors: number[], color: ColorTuple, count: number): void {
    for (let i = 0; i < count; i++) colors.push(color[0], color[1], color[2], color[3]);
}

function appendBox(
    positions: number[], colors: number[], indices: number[],
    cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: ColorTuple,
): void {
    const base = positions.length / 3;
    const x = sx * 0.5, y = sy * 0.5, z = sz * 0.5;
    positions.push(
        cx - x, cy - y, cz - z, cx + x, cy - y, cz - z, cx + x, cy + y, cz - z, cx - x, cy + y, cz - z,
        cx - x, cy - y, cz + z, cx + x, cy - y, cz + z, cx + x, cy + y, cz + z, cx - x, cy + y, cz + z,
    );
    pushColor(colors, color, 8);
    const faces = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 4, 7, 0, 7, 3,
        1, 2, 6, 1, 6, 5, 3, 7, 6, 3, 6, 2, 0, 1, 5, 0, 5, 4];
    for (const index of faces) indices.push(base + index);
}

function appendCylinder(
    positions: number[], colors: number[], indices: number[],
    cx: number, cy: number, cz: number, radius: number, length: number, axis: 'x' | 'z', color: ColorTuple,
): void {
    const segments = 10;
    const base = positions.length / 3;
    for (let end = -1; end <= 1; end += 2) {
        for (let i = 0; i < segments; i++) {
            const a = i / segments * Math.PI * 2;
            const u = Math.cos(a) * radius;
            const v = Math.sin(a) * radius;
            positions.push(
                axis === 'x' ? cx + end * length * 0.5 : cx + u,
                cy + v,
                axis === 'z' ? cz + end * length * 0.5 : cz + u,
            );
        }
    }
    pushColor(colors, color, segments * 2);
    for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        indices.push(base + i, base + segments + i, base + next, base + next, base + segments + i, base + segments + next);
    }
    const capA = positions.length / 3;
    positions.push(axis === 'x' ? cx - length * 0.5 : cx, cy, axis === 'z' ? cz - length * 0.5 : cz);
    const capB = capA + 1;
    positions.push(axis === 'x' ? cx + length * 0.5 : cx, cy, axis === 'z' ? cz + length * 0.5 : cz);
    pushColor(colors, color, 2);
    for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        indices.push(capA, base + next, base + i, capB, base + segments + i, base + segments + next);
    }
}

function appendTaperedCylinder(
    positions: number[], colors: number[], indices: number[],
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    radiusA: number, radiusB: number, color: ColorTuple,
): void {
    const segments = 10;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const nx = dx / length, ny = dy / length, nz = dz / length;
    // 炮管接近 Z 轴，优先用世界 Y 构造稳定横截面；退化时改用世界 X。
    const refX = Math.abs(ny) > 0.92 ? 1 : 0;
    const refY = Math.abs(ny) > 0.92 ? 0 : 1;
    let ux = ny * 0 - nz * refY;
    let uy = nz * refX - nx * 0;
    let uz = nx * refY - ny * refX;
    const uLength = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
    ux /= uLength; uy /= uLength; uz /= uLength;
    const vx = ny * uz - nz * uy;
    const vy = nz * ux - nx * uz;
    const vz = nx * uy - ny * ux;
    const base = positions.length / 3;
    for (let i = 0; i < segments; i++) {
        const angle = i / segments * Math.PI * 2;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        positions.push(
            ax + (ux * cos + vx * sin) * radiusA,
            ay + (uy * cos + vy * sin) * radiusA,
            az + (uz * cos + vz * sin) * radiusA,
        );
    }
    for (let i = 0; i < segments; i++) {
        const angle = i / segments * Math.PI * 2;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        positions.push(
            bx + (ux * cos + vx * sin) * radiusB,
            by + (uy * cos + vy * sin) * radiusB,
            bz + (uz * cos + vz * sin) * radiusB,
        );
    }
    pushColor(colors, color, segments * 2);
    for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        // 横截面基向量满足 u × v = 轴向；按外侧逆时针绕序构造侧壁。
        indices.push(base + i, base + next, base + segments + i,
            base + next, base + segments + next, base + segments + i);
    }
    const capA = positions.length / 3;
    positions.push(ax, ay, az, bx, by, bz);
    pushColor(colors, color, 2);
    for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        indices.push(capA, base + next, base + i,
            capA + 1, base + segments + i, base + segments + next);
    }
}

function appendBeamYZ(
    positions: number[], colors: number[], indices: number[],
    cx: number, ay: number, az: number, by: number, bz: number,
    widthX: number, thickness: number, color: ColorTuple,
): void {
    const dy = by - ay, dz = bz - az;
    const length = Math.sqrt(dy * dy + dz * dz) || 1;
    const py = -dz / length * thickness * 0.5;
    const pz = dy / length * thickness * 0.5;
    const hx = widthX * 0.5;
    const base = positions.length / 3;
    positions.push(
        cx - hx, ay - py, az - pz, cx + hx, ay - py, az - pz,
        cx + hx, ay + py, az + pz, cx - hx, ay + py, az + pz,
        cx - hx, by - py, bz - pz, cx + hx, by - py, bz - pz,
        cx + hx, by + py, bz + pz, cx - hx, by + py, bz + pz,
    );
    pushColor(colors, color, 8);
    const faces = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6,
        0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7,
        0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2];
    for (const index of faces) indices.push(base + index);
}

function appendDisc(
    positions: number[], colors: number[], indices: number[],
    radiusX: number, radiusZ: number, centerColor: ColorTuple, edgeColor: ColorTuple, y: number,
): void {
    const segments = 24;
    const base = positions.length / 3;
    positions.push(0, y, 0);
    pushColor(colors, centerColor, 1);
    for (let i = 0; i <= segments; i++) {
        const a = i / segments * Math.PI * 2;
        positions.push(Math.cos(a) * radiusX, y, Math.sin(a) * radiusZ);
        pushColor(colors, edgeColor, 1);
    }
    for (let i = 0; i < segments; i++) indices.push(base, base + i + 1, base + i + 2);
}

function appendRing(
    positions: number[], colors: number[], indices: number[],
    innerX: number, innerZ: number, outerX: number, outerZ: number,
    innerColor: ColorTuple, outerColor: ColorTuple, y: number,
): void {
    const segments = 24;
    const base = positions.length / 3;
    for (let i = 0; i <= segments; i++) {
        const a = i / segments * Math.PI * 2;
        positions.push(Math.cos(a) * innerX, y, Math.sin(a) * innerZ,
            Math.cos(a) * outerX, y, Math.sin(a) * outerZ);
        pushColor(colors, innerColor, 1);
        pushColor(colors, outerColor, 1);
    }
    for (let i = 0; i < segments; i++) {
        const lower = base + i * 2;
        indices.push(lower, lower + 2, lower + 1, lower + 1, lower + 2, lower + 3);
    }
}
