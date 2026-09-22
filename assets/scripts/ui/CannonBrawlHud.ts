import { Node, view } from 'cc';
import { GameState } from '../core/GameConstants';
import { EntertainmentStatusStrip, EntertainmentStatusTone } from './EntertainmentStatusStrip';

const SAMPLE_SECONDS = 0.1;
const COMPLETION_SECONDS = 2;

/** 水球点名状态条；一次构建，10Hz 采样，只在最终显示值变化时写 UI。 */
export class CannonBrawlHud {
    readonly root: Node;
    private readonly strip: EntertainmentStatusStrip;
    private elapsed = SAMPLE_SECONDS;
    private completionRemainingSeconds = 0;
    private hadPendingStrike = false;

    constructor(parent: Node, _width: number, _height: number) {
        this.strip = new EntertainmentStatusStrip(parent, 'CannonBrawlStatus');
        this.root = this.strip.root;
        this.layout();
        view.on('canvas-resize', this.layout, this);
        view.on('design-resolution-changed', this.layout, this);
    }

    reset(): void {
        this.elapsed = SAMPLE_SECONDS;
        this.strip.reset();
        this.hide();
    }

    hide(): void {
        this.completionRemainingSeconds = 0;
        this.hadPendingStrike = false;
        this.strip.hide();
    }

    consumeSample(dt: number, state: GameState): boolean {
        if (state !== GameState.RACING) {
            this.hide();
            return false;
        }
        const step = Math.max(0, Number.isFinite(dt) ? dt : 0);
        if (this.completionRemainingSeconds > 0) {
            this.completionRemainingSeconds = Math.max(0, this.completionRemainingSeconds - step);
            if (this.completionRemainingSeconds <= 0 && this.root.active) this.root.active = false;
        }
        this.elapsed += step;
        if (this.elapsed < SAMPLE_SECONDS) return false;
        this.elapsed %= SAMPLE_SECONDS;
        return true;
    }

    updateValues(
        remainingStrikes: number,
        activeRemainingSeconds: number,
        playerRecovering: boolean,
        showCompletion = true,
    ): void {
        let message: string;
        let value: string;
        let tone: EntertainmentStatusTone = 'normal';
        if (activeRemainingSeconds > 0 || remainingStrikes > 0) {
            this.hadPendingStrike = true;
            this.completionRemainingSeconds = 0;
        }
        if (playerRecovering) {
            message = '水球点名';
            value = '搭圈调整';
            tone = 'danger';
        } else if (activeRemainingSeconds > 0) {
            const seconds = Math.max(0.1, Math.ceil(activeRemainingSeconds * 10) / 10).toFixed(1);
            message = '水球落点倒计时';
            value = `${seconds}秒`;
            tone = 'warning';
        } else if (remainingStrikes > 0) {
            message = '下一发待命';
            value = `${remainingStrikes}发`;
        } else if (showCompletion && (this.hadPendingStrike || this.completionRemainingSeconds > 0)) {
            if (this.hadPendingStrike) {
                this.hadPendingStrike = false;
                this.completionRemainingSeconds = COMPLETION_SECONDS;
            }
            message = '水球点名结束';
            value = '向终点冲刺';
        } else {
            this.hide();
            return;
        }
        this.strip.setContent(message, value, tone);
    }

    dispose(): void {
        view.off('canvas-resize', this.layout, this);
        view.off('design-resolution-changed', this.layout, this);
        this.strip.dispose();
    }

    private layout(): void {
        if (!this.root?.isValid) return;
        const size = view.getVisibleSize();
        const y = size.height * 0.5 - 118;
        if (this.root.position.x !== 0 || this.root.position.y !== y) this.root.setPosition(0, y, 0);
    }
}
