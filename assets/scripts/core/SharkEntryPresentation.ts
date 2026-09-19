import { Color, gfx, Material, Mesh, MeshRenderer, Node, utils, Vec3 } from 'cc';
import type { SharkController } from '../entity/SharkController';
import { SHARK_TUNING, SharkState } from '../entity/SharkTuning';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { applyWaterExplosionPhase, buildWaterExplosionGeometry } from './MineRelayBrawlPresentation';

const PRESENTATION_INTERVAL = 1 / 20;

/** 首轮警告内的一次性水下上浮表现；只消费已同步的鲨鱼状态，不参与赛果判定。 */
export class SharkEntryPresentation {
    private splash: Node | null = null;
    private splashMesh: Mesh | null = null;
    private splashMaterial: Material | null = null;
    private splashRemaining = 0;
    private splashPlayed = false;
    private elapsed = PRESENTATION_INTERVAL;
    private lastVisualY = Number.NaN;
    private disposed = false;
    private readonly sharkWorldPosition = new Vec3();

    constructor(
        private readonly worldRoot: Node,
        private readonly visualRoot: Node,
        private readonly course: RaceCourseLayout,
        layer: number,
    ) {
        this.build(layer);
    }

    reset(): void {
        this.splashRemaining = 0;
        this.splashPlayed = false;
        this.elapsed = PRESENTATION_INTERVAL;
        this.setVisualY(0);
        this.setActive(this.splash, false);
    }

    update(dt: number, shark: SharkController): void {
        if (this.disposed || !shark) return;
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        const firstEntry = shark.state === SharkState.WARNING
            && shark.sequence === 1
            && shark.huntIndex === 0;

        if (firstEntry) {
            const progress = shark.entryProgress;
            const eased = progress * progress * (3 - 2 * progress);
            this.setVisualY(-SHARK_TUNING.entryStartDepth * (1 - eased));
            if (!this.splashPlayed
                && progress >= SHARK_TUNING.entrySplashProgress
                && progress < 1) {
                this.playSplash(shark);
            }
        } else {
            this.setVisualY(0);
            if (shark.state === SharkState.INACTIVE) this.splashPlayed = false;
        }

        this.elapsed += step;
        if (this.elapsed < PRESENTATION_INTERVAL) return;
        const presentationStep = this.elapsed;
        this.elapsed = 0;
        if (this.splashRemaining <= 0) return;
        this.splashRemaining = Math.max(0, this.splashRemaining - presentationStep);
        const progress = 1 - this.splashRemaining / Math.max(0.01, SHARK_TUNING.entrySplashSeconds);
        if (this.splash) {
            applyWaterExplosionPhase(this.splash, progress, SHARK_TUNING.entrySplashIntensity);
        }
        if (this.splashRemaining <= 0) this.setActive(this.splash, false);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.splash?.isValid) this.splash.destroy();
        this.splash = null;
        this.splashMesh?.destroy();
        this.splashMesh = null;
        this.splashMaterial?.destroy();
        this.splashMaterial = null;
    }

    private playSplash(shark: SharkController): void {
        this.splashPlayed = true;
        if (!this.splash?.isValid) return;
        shark.node.getWorldPosition(this.sharkWorldPosition);
        this.splash.setWorldPosition(
            this.sharkWorldPosition.x,
            this.course.waterY + 0.035,
            this.sharkWorldPosition.z,
        );
        this.splash.setRotationFromEuler(0, shark.sequence * 53, 0);
        applyWaterExplosionPhase(this.splash, 0, SHARK_TUNING.entrySplashIntensity);
        this.setActive(this.splash, true);
        this.splashRemaining = SHARK_TUNING.entrySplashSeconds;
        this.elapsed = PRESENTATION_INTERVAL;
    }

    private setVisualY(y: number): void {
        if (!this.visualRoot?.isValid || Math.abs(y - this.lastVisualY) < 0.001) return;
        this.lastVisualY = y;
        this.visualRoot.setPosition(0, y, 0);
    }

    private build(layer: number): void {
        if (!this.worldRoot?.isValid) return;
        this.splashMesh = utils.createMesh(buildWaterExplosionGeometry());
        this.splashMaterial = new Material();
        this.splashMaterial.initialize({
            effectName: 'builtin-unlit',
            technique: 1,
            defines: { USE_VERTEX_COLOR: true },
            states: {
                rasterizerState: { cullMode: gfx.CullMode.NONE },
                depthStencilState: { depthTest: true, depthWrite: false },
            },
        });
        this.splashMaterial.name = 'SharkEntrySplashMaterial';
        this.splashMaterial.setProperty('mainColor', Color.WHITE);

        const splash = new Node('SharkEntrySplash');
        splash.setParent(this.worldRoot);
        splash.layer = layer;
        const renderer = splash.addComponent(MeshRenderer);
        renderer.mesh = this.splashMesh;
        renderer.setMaterial(this.splashMaterial, 0);
        splash.active = false;
        this.splash = splash;
    }

    private setActive(node: Node | null, active: boolean): void {
        if (node?.isValid && node.active !== active) node.active = active;
    }
}
