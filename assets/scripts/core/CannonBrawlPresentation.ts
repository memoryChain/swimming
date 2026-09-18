import { Color, gfx, Material, Mesh, MeshRenderer, Node, primitives, utils, Vec3 } from 'cc';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { CANNON_BRAWL_TUNING, CannonImpact, CannonLaunch } from './CannonBrawlController';

const PRESENTATION_INTERVAL = 1 / 20;
const CANNON_EDGE_OFFSET = 1.4;
const PROJECTILE_ARC_HEIGHT = 5.8;
const IMPACT_SECONDS = 0.52;

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
            this.impactPlume.setScale(0.35, 0.35, 0.35);
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
            const scale = 0.35 + Math.sin(Math.min(1, progress) * Math.PI * 0.72) * 1.25;
            this.impactPlume?.setScale(scale, 0.55 + scale * 1.1, scale);
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
        this.impactMesh = utils.createMesh(buildImpactGeometry());
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
    appendBox(positions, colors, indices, 0, 0.15, 0, 1.65, 0.3, 1.35, [0.18, 0.22, 0.28, 1]);
    appendBox(positions, colors, indices, 0, 0.52, 0.12, 1.02, 0.52, 1.02, [0.55, 0.20, 0.12, 1]);
    appendCylinder(positions, colors, indices, -0.72, 0.42, 0.15, 0.48, 0.20, 'x', [0.11, 0.12, 0.15, 1]);
    appendCylinder(positions, colors, indices, 0.72, 0.42, 0.15, 0.48, 0.20, 'x', [0.11, 0.12, 0.15, 1]);
    appendCylinder(positions, colors, indices, 0, 1.02, 0.36, 0.23, 2.25, 'z', [0.19, 0.23, 0.29, 1]);
    appendCylinder(positions, colors, indices, 0, 1.02, 1.43, 0.32, 0.24, 'z', [0.08, 0.10, 0.13, 1]);
    appendBox(positions, colors, indices, 0, 0.74, -0.72, 0.28, 0.28, 0.58, [0.67, 0.27, 0.12, 1]);
    return geometry(positions, colors, indices, new Vec3(-0.85, 0, -1.05), new Vec3(0.85, 1.5, 1.58));
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

function buildImpactGeometry(): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const plumeColor: ColorTuple = [0.72, 0.94, 1, 0.72];
    const tipColor: ColorTuple = [0.88, 0.98, 1, 0.04];
    appendRibbon(positions, colors, indices, -0.75, 0, 0.75, 0, 3.2, plumeColor, tipColor);
    appendRibbon(positions, colors, indices, 0, -0.75, 0, 0.75, 3.2, plumeColor, tipColor);
    appendRing(positions, colors, indices, 0.45, 0.45, 2.1, 2.1,
        [0.75, 0.95, 1, 0.38], [0.75, 0.95, 1, 0], 0.02);
    return geometry(positions, colors, indices, new Vec3(-2.1, 0, -2.1), new Vec3(2.1, 3.2, 2.1));
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

function appendRibbon(
    positions: number[], colors: number[], indices: number[],
    x0: number, z0: number, x1: number, z1: number, tipY: number,
    bottomColor: ColorTuple, topColor: ColorTuple,
): void {
    const base = positions.length / 3;
    positions.push(x0, 0, z0, x1, 0, z1, x1 * 0.15, tipY, z1 * 0.15, x0 * 0.15, tipY, z0 * 0.15);
    pushColor(colors, bottomColor, 2);
    pushColor(colors, topColor, 2);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
