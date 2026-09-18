import { Material, Mesh, MeshRenderer, Node, utils } from 'cc';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import type { MinefieldImpact, MinefieldMineState } from './MinefieldBrawlController';
import {
    applyWaterExplosionPhase,
    buildMineGeometry,
    buildWaterExplosionGeometry,
    makeMineVertexMaterial,
} from './MineRelayBrawlPresentation';

const PRESENTATION_INTERVAL = 1 / 20;
const EXPLOSION_SECONDS = 0.58;
const EXPLOSION_POOL_SIZE = 3;
const MINEFIELD_EXPLOSION_INTENSITY = 1;
const MINE_ROTATION_Y_DEGREES = 14;
const MINE_TILT_X_DEGREES = 9;
const MINE_TILT_Z_DEGREES = 7;

type ExplosionVisual = { node: Node; remaining: number };

/** 共享网格和材质的低面数水雷池；运行时只更新节点显隐和变换。 */
export class MinefieldBrawlPresentation {
    private readonly mineNodes: Node[] = [];
    private readonly explosions: ExplosionVisual[] = [];
    private mineMesh: Mesh | null = null;
    private explosionMesh: Mesh | null = null;
    private mineMaterial: Material | null = null;
    private explosionMaterial: Material | null = null;
    private elapsed = PRESENTATION_INTERVAL;
    private clock = 0;
    private visible = true;
    private disposed = false;

    constructor(private readonly worldRoot: Node, private readonly course: RaceCourseLayout, mineCount: number) {
        if (!worldRoot?.isValid) return;
        this.mineMesh = utils.createMesh(buildMineGeometry());
        this.explosionMesh = utils.createMesh(buildWaterExplosionGeometry());
        this.mineMaterial = makeMineVertexMaterial('MinefieldBodyMaterial', true);
        this.explosionMaterial = makeMineVertexMaterial('MinefieldExplosionMaterial', false);
        for (let id = 0; id < mineCount; id++) {
            const node = this.makeMeshNode(`MinefieldMine${id}`, this.mineMesh, this.mineMaterial);
            node.setScale(1.08, 1.08, 1.08);
            this.mineNodes.push(node);
        }
        for (let index = 0; index < EXPLOSION_POOL_SIZE; index++) {
            const node = this.makeMeshNode(`MinefieldExplosion${index}`, this.explosionMesh, this.explosionMaterial);
            node.active = false;
            this.explosions.push({ node, remaining: 0 });
        }
    }

    reset(): void {
        this.elapsed = PRESENTATION_INTERVAL;
        this.clock = 0;
        this.visible = true;
        for (const node of this.mineNodes) this.setActive(node, true);
        for (const explosion of this.explosions) {
            explosion.remaining = 0;
            this.setActive(explosion.node, false);
        }
    }

    update(dt: number, mines: readonly MinefieldMineState[], visible: boolean): void {
        if (this.disposed) return;
        if (visible !== this.visible) {
            this.visible = visible;
            if (!visible) {
                for (const node of this.mineNodes) this.setActive(node, false);
                for (const explosion of this.explosions) {
                    explosion.remaining = 0;
                    this.setActive(explosion.node, false);
                }
            } else {
                this.elapsed = PRESENTATION_INTERVAL;
            }
        }
        if (!visible) {
            return;
        }
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        this.elapsed += step;
        if (this.elapsed < PRESENTATION_INTERVAL) return;
        const presentationStep = this.elapsed;
        this.elapsed = 0;
        this.clock += presentationStep;
        for (let id = 0; id < this.mineNodes.length; id++) {
            const node = this.mineNodes[id];
            const mine = mines[id];
            const active = !!mine?.active;
            this.setActive(node, active);
            if (!active) continue;
            node.setWorldPosition(
                this.course.distanceToWorldX(mine.courseX),
                this.course.waterY + 0.09 + Math.sin(this.clock * 2.6 + id * 0.8) * 0.055,
                mine.lateral,
            );
            const rotationPhase = this.clock + id * 0.73;
            node.setRotationFromEuler(
                Math.sin(rotationPhase * 0.55) * MINE_TILT_X_DEGREES,
                rotationPhase * (MINE_ROTATION_Y_DEGREES + id * 0.65) + id * 31,
                Math.cos(rotationPhase * 0.43 + 0.8) * MINE_TILT_Z_DEGREES,
            );
        }
        for (const explosion of this.explosions) {
            if (explosion.remaining <= 0) continue;
            explosion.remaining = Math.max(0, explosion.remaining - presentationStep);
            const progress = 1 - explosion.remaining / EXPLOSION_SECONDS;
            applyWaterExplosionPhase(explosion.node, progress, MINEFIELD_EXPLOSION_INTENSITY);
            if (explosion.remaining <= 0) this.setActive(explosion.node, false);
        }
    }

    showImpact(impact: MinefieldImpact): void {
        if (this.disposed || !this.visible || this.explosions.length === 0) return;
        let visual = this.explosions[0];
        for (const candidate of this.explosions) {
            if (candidate.remaining <= 0) { visual = candidate; break; }
            if (candidate.remaining < visual.remaining) visual = candidate;
        }
        visual.node.setWorldPosition(
            this.course.distanceToWorldX(impact.courseX),
            this.course.waterY + 0.05,
            impact.lateral,
        );
        visual.node.setRotationFromEuler(0, impact.mineId * 47, 0);
        applyWaterExplosionPhase(visual.node, 0, MINEFIELD_EXPLOSION_INTENSITY);
        visual.remaining = EXPLOSION_SECONDS;
        this.setActive(visual.node, true);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const node of this.mineNodes) if (node.isValid) node.destroy();
        for (const visual of this.explosions) if (visual.node.isValid) visual.node.destroy();
        this.mineNodes.length = 0;
        this.explosions.length = 0;
        this.mineMesh?.destroy();
        this.explosionMesh?.destroy();
        this.mineMaterial?.destroy();
        this.explosionMaterial?.destroy();
    }

    private makeMeshNode(name: string, mesh: Mesh, material: Material): Node {
        const node = new Node(name);
        node.setParent(this.worldRoot);
        node.layer = this.worldRoot.layer;
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = mesh;
        renderer.setMaterial(material, 0);
        return node;
    }

    private setActive(node: Node, active: boolean): void {
        if (node.isValid && node.active !== active) node.active = active;
    }
}
