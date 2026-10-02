import { Node, view } from 'cc';
import { Swimmer } from '../entity/Swimmer';
import { AISwimmerController } from '../entity/AISwimmerController';
import { EntertainmentStatusStrip } from '../ui/EntertainmentStatusStrip';
import { EntertainmentEventBanner } from '../ui/SharkEventBanner';
import { RaceEventPictureInPictureCamera } from '../camera/RaceEventPictureInPictureCamera';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { StrokeSfxManager } from '../app/StrokeSfxManager';
import { GiantWaveIntensity, GiantWavePreset, GiantWaveSample, GiantWaveSimulation, giantWaveTargetZ, waveArrivalTime } from './GiantWaveRules';
import { GiantWavePresentation } from './GiantWavePresentation';
import { litterRowOverlapsDanger } from './EntertainmentBackgroundSafety';

const PREVIEWS = ['出发端即将起浪 · 顺浪加速，迎浪减速', '折返端即将起浪 · 顺浪加速，迎浪减速'];
const ACTIONS = ['出发端浪头出发 · 顺浪借力，迎浪绕行', '折返端浪头出发 · 顺浪借力，迎浪绕行'];

/** 单项自行排浪；综合事件由导演激活、校正年龄及销毁。 */
export class GiantWaveController {
    readonly simulation: GiantWaveSimulation;
    private readonly presentation: GiantWavePresentation;
    private readonly strip: EntertainmentStatusStrip;
    private readonly samples: GiantWaveSample[];
    private aiClock = 0;
    private hudClock = 0;
    private soundedWave = -1;
    private wasRacing = false;
    private autopilot: AISwimmerController | null = null;
    private eventAge = 0;
    constructor(world: Node, hud: Node, private readonly course: RaceCourseLayout,
        private readonly swimmers: readonly Swimmer[], private readonly ai: readonly AISwimmerController[],
        seed: number, preset: GiantWavePreset, private readonly banner: EntertainmentEventBanner,
        private readonly camera: RaceEventPictureInPictureCamera | null,
        intensity: GiantWaveIntensity = 3, private readonly raceDistance = 200,
        private readonly formal = false,
        private readonly movementAuthority?: (index: number) => boolean) {
        this.simulation = new GiantWaveSimulation(course.courseLength, Math.min(course.poolStartX, course.poolFinishX),
            Math.max(course.poolStartX, course.poolFinishX), course.poolWidth, seed, preset,
            Math.abs(course.finishX - course.startX), intensity, raceDistance, formal);
        this.samples = swimmers.map(() => ({ distance: 0, x: 0, z: 0, direction: 1, speed: 0, eligible: false }));
        this.presentation = new GiantWavePresentation(world, course.waterY);
        this.strip = new EntertainmentStatusStrip(hud, 'GiantWaveStatus');
        this.layout();
        view.on('canvas-resize', this.layout, this);
        view.on('design-resolution-changed', this.layout, this);
        for (const swimmer of swimmers) {
            swimmer.giantWaveState = this.simulation.state;
            swimmer.giantWaveTuning = formal ? this.simulation.spec : null;
        }
    }
    get isDone(): boolean { return this.simulation.state.phase === 'complete'; }
    isBackgroundLitterRowSafe(worldX: number): boolean {
        const state = this.simulation.state;
        return state.phase !== 'active' || !litterRowOverlapsDanger(worldX, state.x,
            state.length * .5 + 2, state.direction * state.speed * 2);
    }
    /** 快照恢复静默进入当前年龄；迟到包不让浪倒退或重播入场。 */
    syncEventAge(age: number, playEntrance = false): void {
        if (!this.formal || !Number.isFinite(age) || age < 0) return;
        const first = this.simulation.state.phase === 'waiting';
        this.eventAge = Math.max(this.eventAge, age);
        this.simulation.seekEvent(this.eventAge);
        if (first) {
            this.presentation.begin(this.simulation.spec.height);
            if (playEntrance) {
                this.camera?.showGiantWavePreview(this.simulation.state);
                StrokeSfxManager.playStroke();
            }
        }
    }
    private layout(): void {
        if (this.strip.root.isValid) this.strip.root.setPosition(0, view.getVisibleSize().height * 0.5 - 118, 0);
    }
    reset(): void {
        this.simulation.reset(); this.presentation.hide(); this.strip.reset();
        this.camera?.updateGiantWave(false, 0, this.simulation.state);
        this.aiClock = 0; this.hudClock = 0; this.soundedWave = -1; this.wasRacing = false;
        this.eventAge = 0;
        for (const swimmer of this.swimmers) swimmer.clearGiantWave();
        for (const controller of this.ai) controller?.setGiantWaveTargetZ(null);
        this.clearAutopilot();
    }
    update(dt: number, racing: boolean, autopilot: AISwimmerController | null): void {
        if (this.autopilot !== autopilot) {
            this.clearAutopilot();
            this.autopilot = autopilot;
            this.aiClock = 0;
        }
        if (!racing) {
            if (this.wasRacing) {
                this.reset();
            }
            return;
        }
        this.wasRacing = true;
        let finished = false;
        for (let i = 0; i < this.swimmers.length; i++) {
            const swimmer = this.swimmers[i], sample = this.samples[i];
            if (this.movementAuthority) swimmer.setGiantWaveAuthority(this.movementAuthority(i));
            sample.distance = swimmer.distance;
            sample.x = this.course.distanceToWorldX(swimmer.distance);
            sample.z = swimmer.startPosition.z + swimmer.motor.lateralOffset;
            sample.direction = this.course.directionAtDistance(swimmer.distance);
            sample.speed = swimmer.motor.currentSpeed;
            sample.eligible = swimmer.canRideGiantWave;
            if (sample.distance >= this.raceDistance) finished = true;
        }
        const state = this.simulation.state, before = state.phase, beforeAge = state.age;
        if (this.formal) {
            this.eventAge += Math.max(0, dt);
            this.simulation.seekEvent(this.eventAge);
        } else this.simulation.update(dt, this.samples, finished);
        if (!this.formal && state.phase !== before) {
            const variant = state.direction === Math.sign(this.course.poolFinishX - this.course.poolStartX) ? 0 : 1;
            if (state.phase === 'preview') this.banner.showEvent(PREVIEWS[variant], 'warning', state.timer * 1000);
            if (state.phase === 'active') {
                this.banner.showEvent(ACTIONS[variant], 'danger', 3000, 'broadcast', '巨浪冲浪');
                this.presentation.begin();
                this.camera?.showGiantWavePreview(state);
                StrokeSfxManager.playStroke();
            }
            if (before === 'preview' && state.phase !== 'active') this.banner.hideEvent();
        }
        if (before === 'active' && state.phase === 'active'
            && beforeAge < waveArrivalTime(state) && state.age >= waveArrivalTime(state)) {
            this.camera?.showGiantWavePreview(state, true);
            StrokeSfxManager.playStroke(true);
        }
        this.presentation.update(state);
        this.camera?.updateGiantWave(true, dt, state);
        this.aiClock -= dt;
        if (this.aiClock <= 0) {
            this.aiClock = 0.15;
            for (let i = 0; i < this.ai.length; i++) {
                if (!this.ai[i]?.remoteDriven) this.ai[i]?.setGiantWaveTargetZ(this.targetZ(i + 1),
                    this.samples[i + 1].direction !== state.direction);
            }
            autopilot?.setGiantWaveTargetZ(this.targetZ(0), this.samples[0].direction !== state.direction);
        }
        this.hudClock -= dt;
        if (this.hudClock <= 0) {
            this.hudClock = 0.1;
            if (this.swimmers[0]?.isGiantWaveOpposed) {
                this.strip.setContent('迎浪减速', '侧移避浪', 'warning');
            } else if (this.swimmers[0]?.isGiantWaveRiding) {
                this.strip.setContent('借浪加速', '继续划水', 'protect');
                if (this.soundedWave !== state.wave) {
                    this.soundedWave = state.wave; StrokeSfxManager.playStroke(true);
                }
            } else this.strip.hide();
        }
    }
    private targetZ(index: number): number | null {
        return giantWaveTargetZ(this.simulation.state, this.samples[index], index, this.course.poolWidth,
            this.simulation.swimSpan / this.course.courseLength);
    }
    private clearAutopilot(): void {
        this.autopilot?.setGiantWaveTargetZ(null);
        this.autopilot = null;
    }
    dispose(): void {
        for (const swimmer of this.swimmers) {
            swimmer.giantWaveState = null; swimmer.giantWaveTuning = null; swimmer.clearGiantWave();
            if (this.movementAuthority) swimmer.setGiantWaveAuthority(true);
        }
        for (const controller of this.ai) controller?.setGiantWaveTargetZ(null);
        this.clearAutopilot();
        view.off('canvas-resize', this.layout, this);
        view.off('design-resolution-changed', this.layout, this);
        this.strip.dispose(); this.presentation.dispose();
        this.camera?.updateGiantWave(false, 0, this.simulation.state);
    }
}
