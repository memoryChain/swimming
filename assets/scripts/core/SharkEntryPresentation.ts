import { Node, Vec3 } from 'cc';
import type { SharkController } from '../entity/SharkController';
import { SHARK_TUNING, SharkState } from '../entity/SharkTuning';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';
import {
    ENTERTAINMENT_SPLASH_OWNER,
    ENTERTAINMENT_SPLASH_PROFILE,
    EntertainmentWaterSplashPool,
} from './EntertainmentWaterSplash';

/** 首轮警告内的一次性水下上浮表现；只消费已同步的鲨鱼状态，不参与赛果判定。 */
export class SharkEntryPresentation {
    private splashPlayed = false;
    private lastVisualY = Number.NaN;
    private disposed = false;
    private previousState = SharkState.INACTIVE;
    private exitElapsed = 0;
    private readonly sharkWorldPosition = new Vec3();

    constructor(
        worldRoot: Node,
        private readonly visualRoot: Node,
        private readonly course: RaceCourseLayout,
        private readonly splashLayer: number,
        private readonly waterSplashes: EntertainmentWaterSplashPool | null,
    ) {
        void worldRoot;
    }

    reset(): void {
        this.splashPlayed = false;
        this.previousState = SharkState.INACTIVE;
        this.exitElapsed = 0;
        this.setVisualY(0);
        this.waterSplashes?.cancelOwner(ENTERTAINMENT_SPLASH_OWNER.SHARK_ENTRY);
    }

    update(dt: number, shark: SharkController): void {
        if (this.disposed || !shark) return;
        if (shark.state === SharkState.SATIATED) {
            if (this.previousState !== SharkState.SATIATED) {
                // 已错过退场时直接恢复水下状态，不从水面重新退一次。
                this.exitElapsed = this.previousState === SharkState.INACTIVE ? 1.2 : 0;
            }
            this.exitElapsed = Math.min(1.2, this.exitElapsed + Math.max(0, Number.isFinite(dt) ? dt : 0));
            const progress = this.exitElapsed / 1.2;
            this.setVisualY(SHARK_TUNING.satiatedSinkOffset * progress * progress);
            this.previousState = shark.state;
            return;
        }
        this.previousState = shark.state;
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

    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.waterSplashes?.cancelOwner(ENTERTAINMENT_SPLASH_OWNER.SHARK_ENTRY);
    }

    private playSplash(shark: SharkController): void {
        this.splashPlayed = true;
        shark.node.getWorldPosition(this.sharkWorldPosition);
        this.sharkWorldPosition.y = this.course.waterY + 0.035;
        this.waterSplashes?.play({
            owner: ENTERTAINMENT_SPLASH_OWNER.SHARK_ENTRY,
            profile: ENTERTAINMENT_SPLASH_PROFILE.HEAVY_ENTRY,
            position: this.sharkWorldPosition,
            yawDegrees: shark.node.eulerAngles.y,
            intensity: SHARK_TUNING.entrySplashIntensity,
            duration: SHARK_TUNING.entrySplashSeconds,
            radialScale: 0.92,
            verticalScale: 0.88,
            layer: this.splashLayer,
        });
    }

    private setVisualY(y: number): void {
        if (!this.visualRoot?.isValid || Math.abs(y - this.lastVisualY) < 0.001) return;
        this.lastVisualY = y;
        this.visualRoot.setPosition(0, y, 0);
    }

}
