import type { Node } from 'cc';
import type { Swimmer } from '../entity/Swimmer';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';
import type { FloatingItemLayers } from './FloatingItemRenderer';
import { GiantWaveSimulation, giantWaveTargetZ, type GiantWaveSample } from './GiantWaveRules';
import { GiantWavePresentation } from './GiantWavePresentation';
import type { GiantWaveMeshes } from './EntertainmentItemAssets';

/** 本局独立普通巨浪，准备阶段创建，重赛复用；不管理 HUD、画中画、云端或联机。 */
export class GiantWaveRaceController {
    readonly simulation: GiantWaveSimulation;
    private readonly presentation: GiantWavePresentation;
    private readonly samples: GiantWaveSample[];
    private disposed = false;
    constructor(parent: Node, private readonly course: RaceCourseLayout, private readonly swimmers: readonly Swimmer[],
        seed: number, private readonly raceDistance: number, meshes: GiantWaveMeshes, layers: FloatingItemLayers | null = null, singleTriggerDistance: number | null = null) {
        this.simulation = new GiantWaveSimulation(course.courseLength, Math.min(course.poolStartX, course.poolFinishX),
            Math.max(course.poolStartX, course.poolFinishX), course.poolWidth, seed, singleTriggerDistance === null ? 'three' : 'single',
            Math.abs(course.finishX - course.startX), singleTriggerDistance === null ? 3 : 1, raceDistance, singleTriggerDistance);
        this.samples = swimmers.map(() => ({ distance: 0, x: 0, z: 0, direction: 1, speed: 0, eligible: false }));
        this.presentation = new GiantWavePresentation(parent, course.waterY, meshes, layers);
        let bound = 0;
        try {
            this.presentation.begin(this.simulation.spec.height);
            for (; bound < swimmers.length; bound++) {
                swimmers[bound].configureEntertainmentGiantWave(this.simulation.state, this.simulation.spec);
            }
        } catch (error) {
            // 包含当前可能只绑定了一半的选手，随后释放已成功创建的表现。
            for (let i = 0; i <= bound && i < swimmers.length; i++) swimmers[i].configureEntertainmentGiantWave(null);
            this.presentation.dispose();
            throw error;
        }
    }
    get isBusy(): boolean { return this.simulation.state.phase === 'preview' || this.simulation.state.phase === 'active'; }
    get isDone(): boolean { return this.simulation.state.phase === 'complete'; }
    reset(): void {
        if (this.disposed) return;
        this.simulation.reset(); this.presentation.hide();
        for (const swimmer of this.swimmers) swimmer.resetEntertainmentGiantWave();
    }
    update(dt: number): void {
        if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
        let finished = false;
        for (let i = 0; i < this.swimmers.length; i++) {
            const swimmer = this.swimmers[i], sample = this.samples[i];
            sample.distance = swimmer.distance;
            sample.x = this.course.distanceToWorldX(swimmer.distance);
            sample.z = swimmer.startPosition.z + swimmer.motor.lateralOffset;
            sample.direction = this.course.directionAtDistance(swimmer.distance);
            sample.speed = swimmer.motor.currentSpeed;
            sample.eligible = swimmer.canRideGiantWave;
            if (sample.distance >= this.raceDistance) finished = true;
        }
        this.simulation.update(dt, this.samples, finished);
        this.presentation.update(this.simulation.state);
    }
    targetZForAi(index: number): number | null {
        if (this.disposed) return null;
        const sample = this.samples[index];
        if (!sample) return null;
        return giantWaveTargetZ(this.simulation.state, sample, index, this.course.poolWidth,
            this.simulation.swimSpan / this.course.courseLength);
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const swimmer of this.swimmers) swimmer.configureEntertainmentGiantWave(null);
        this.presentation.dispose();
    }
}
