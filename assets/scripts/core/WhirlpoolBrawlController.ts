import { Color, gfx, Material, Mesh, MeshRenderer, Node, primitives, utils, Vec3 } from 'cc';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import {
    WHIRLPOOL_BRAWL_TUNING,
    WHIRLPOOL_SPAWNS,
    whirlpoolCenterZ,
    whirlpoolTargetZForAi,
} from './WhirlpoolBrawlRules';

type Visual = {
    root: Node;
    distance: number;
    spin: -1 | 1;
    phase: number;
};

const PRESENTATION_INTERVAL = 1 / 20;
const VISIBLE_AHEAD_DISTANCE = 48;
const VISIBLE_BEHIND_DISTANCE = 12;
const ANNOUNCEMENT_DISTANCE = 16;
const ROTATION_DEGREES_PER_SECOND = 46;

/** 漩涡玩法的低开销表现与 AI 路线提示；物理作用由泳者模拟步中的纯规则计算。 */
export class WhirlpoolBrawlController {
    private readonly visuals: Visual[] = [];
    private mesh: Mesh | null = null;
    private material: Material | null = null;
    private elapsed = PRESENTATION_INTERVAL;
    private clock = 0;
    private announcedMask = 0;
    private disposed = false;

    constructor(
        private readonly parent: Node,
        private readonly course: RaceCourseLayout,
        private readonly onApproach: (index: number) => void,
    ) {
        this.buildVisuals();
    }

    reset(): void {
        this.elapsed = PRESENTATION_INTERVAL;
        this.clock = 0;
        this.announcedMask = 0;
        for (const visual of this.visuals) {
            if (visual.root?.isValid && visual.root.active) visual.root.active = false;
        }
    }

    updatePresentation(referenceDistance: number, dt: number, allowAnnouncements: boolean): void {
        if (this.disposed) return;
        const distance = Number.isFinite(referenceDistance) ? referenceDistance : 0;
        if (allowAnnouncements) {
            for (let i = 0; i < WHIRLPOOL_SPAWNS.length; i++) {
                const ahead = WHIRLPOOL_SPAWNS[i].distance - distance;
                const bit = 1 << i;
                if ((this.announcedMask & bit) === 0 && ahead <= ANNOUNCEMENT_DISTANCE && ahead >= -1) {
                    this.announcedMask |= bit;
                    this.onApproach(i);
                }
            }
        }

        this.elapsed += Math.max(0, Number.isFinite(dt) ? dt : 0);
        if (this.elapsed < PRESENTATION_INTERVAL) return;
        const step = this.elapsed;
        this.elapsed = 0;
        this.clock += step;
        for (const visual of this.visuals) {
            const ahead = visual.distance - distance;
            const visible = ahead <= VISIBLE_AHEAD_DISTANCE && ahead >= -VISIBLE_BEHIND_DISTANCE;
            if (visual.root.active !== visible) visual.root.active = visible;
            if (!visible) continue;
            const pulse = 1 + Math.sin(this.clock * 2.1 + visual.phase) * 0.035;
            visual.root.setScale(pulse, 1, visual.spin * pulse);
            visual.root.setRotationFromEuler(0, visual.spin * this.clock * ROTATION_DEGREES_PER_SECOND, 0);
        }
    }

    targetZForAi(distance: number, currentZ: number): number | null {
        return whirlpoolTargetZForAi(distance, currentZ, this.course.poolWidth);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const visual of this.visuals) {
            if (visual.root?.isValid) visual.root.destroy();
        }
        this.visuals.length = 0;
        this.mesh?.destroy();
        this.material?.destroy();
        this.mesh = null;
        this.material = null;
    }

    private buildVisuals(): void {
        if (!this.parent?.isValid) return;
        const mesh = utils.createMesh(buildWhirlpoolGeometry());
        const material = new Material();
        material.initialize({
            effectName: 'builtin-unlit',
            technique: 1,
            defines: { USE_VERTEX_COLOR: true },
            states: {
                rasterizerState: { cullMode: gfx.CullMode.NONE },
                depthStencilState: { depthTest: true, depthWrite: false },
            },
        });
        material.name = 'WhirlpoolSharedMaterial';
        material.setProperty('mainColor', Color.WHITE);
        this.mesh = mesh;
        this.material = material;

        for (const spawn of WHIRLPOOL_SPAWNS) {
            const node = new Node(`Whirlpool_${spawn.id}`);
            node.setParent(this.parent);
            node.layer = this.parent.layer;
            const renderer = node.addComponent(MeshRenderer);
            renderer.mesh = mesh;
            renderer.setMaterial(material, 0);
            const p = this.course.swimPosition(spawn.distance, whirlpoolCenterZ(spawn, this.course.poolWidth));
            node.setWorldPosition(p.x, this.course.waterY + 0.035, p.z);
            node.setScale(1, 1, spawn.spin);
            node.active = false;
            this.visuals.push({ root: node, distance: spawn.distance, spin: spawn.spin, phase: spawn.id * 1.37 });
        }
    }
}

function buildWhirlpoolGeometry(): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const arms = 3;
    const segments = 16;
    const maxRadius = Math.max(1, WHIRLPOOL_BRAWL_TUNING.lateralRadius);

    for (let arm = 0; arm < arms; arm++) {
        const baseAngle = arm / arms * Math.PI * 2;
        for (let segment = 0; segment <= segments; segment++) {
            const t = segment / segments;
            const radius = 0.38 + t * (maxRadius - 0.38);
            const angle = baseAngle + t * Math.PI * 1.45;
            const width = 0.22 + t * 0.20;
            const tangentX = -Math.sin(angle);
            const tangentZ = Math.cos(angle);
            const centerX = Math.cos(angle) * radius;
            const centerZ = Math.sin(angle) * radius;
            positions.push(
                centerX - tangentX * width, 0, centerZ - tangentZ * width,
                centerX + tangentX * width, 0, centerZ + tangentZ * width,
            );
            const alpha = Math.sin(Math.PI * Math.min(1, t * 1.08)) * (0.72 - t * 0.30);
            colors.push(0.34, 0.92, 1, alpha, 0.82, 0.98, 1, alpha * 0.72);
        }
        const base = arm * (segments + 1) * 2;
        for (let segment = 0; segment < segments; segment++) {
            const lower = base + segment * 2;
            indices.push(lower, lower + 2, lower + 1, lower + 1, lower + 2, lower + 3);
        }
    }

    const coreBase = positions.length / 3;
    const coreSegments = 20;
    const coreRadius = maxRadius * WHIRLPOOL_BRAWL_TUNING.coreRadiusRatio;
    positions.push(0, -0.002, 0);
    colors.push(0.04, 0.28, 0.46, 0.78);
    for (let segment = 0; segment <= coreSegments; segment++) {
        const angle = segment / coreSegments * Math.PI * 2;
        positions.push(Math.cos(angle) * coreRadius, -0.002, Math.sin(angle) * coreRadius);
        colors.push(0.12, 0.58, 0.76, 0.16);
    }
    for (let segment = 0; segment < coreSegments; segment++) {
        indices.push(coreBase, coreBase + segment + 1, coreBase + segment + 2);
    }

    return {
        positions,
        colors,
        indices,
        minPos: new Vec3(-maxRadius, -0.01, -maxRadius),
        maxPos: new Vec3(maxRadius, 0.01, maxRadius),
    };
}
