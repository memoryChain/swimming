import { Node, view } from 'cc';
import { GameState } from '../core/GameConstants';
import { EntertainmentStatusStrip, EntertainmentStatusTone } from './EntertainmentStatusStrip';

const SAMPLE_SECONDS = 0.1;
const COMPLETION_SECONDS = 2;
/** 定时炸弹模式状态条；稳定节点、10Hz 采样、只在最终值变化时写属性。 */
export class MineRelayBrawlHud {
    readonly root: Node;
    private readonly strip: EntertainmentStatusStrip;
    private elapsed = SAMPLE_SECONDS;
    private completionRemainingSeconds = 0;
    private hadPendingRound = false;

    constructor(parent: Node, _width: number, _height: number) {
        this.strip = new EntertainmentStatusStrip(parent, 'MineRelayStatus');
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
        this.hadPendingRound = false;
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
        carrierLane: number,
        playerLane: number,
        remainingSeconds: number,
        locked: boolean,
        remainingRounds: number,
        showCompletion = true,
    ): void {
        let message: string;
        let value: string;
        let tone: EntertainmentStatusTone = 'normal';
        if (carrierLane >= 0 || remainingRounds > 0) {
            this.hadPendingRound = true;
            this.completionRemainingSeconds = 0;
        }
        if (carrierLane >= 0) {
            const seconds = Math.max(0, Math.ceil(remainingSeconds * 10) / 10).toFixed(1);
            if (carrierLane === playerLane) {
                if (locked) {
                    message = '炸弹已锁定';
                } else {
                    message = '你持有定时炸弹 · 贴近对手传出';
                }
                tone = 'danger';
            } else {
                message = `炸弹在${carrierLane + 1}号泳道${locked ? ' · 已锁定' : ''}`;
                tone = locked ? 'danger' : 'warning';
            }
            value = `${seconds}秒`;
        } else if (remainingRounds > 0) {
            message = '下一轮炸弹待命';
            value = `${remainingRounds}轮`;
        } else if (showCompletion && (this.hadPendingRound || this.completionRemainingSeconds > 0)) {
            if (this.hadPendingRound) {
                this.hadPendingRound = false;
                this.completionRemainingSeconds = COMPLETION_SECONDS;
            }
            message = '炸弹阶段结束';
            value = '全力冲刺';
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
