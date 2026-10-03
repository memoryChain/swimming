import type { AnalyticsEvent, AnalyticsFields } from './IPlatformAnalytics';

export interface RaceAnalyticsContext {
    mode: string;
    distance: number;
    character_id: string;
    play_type: 'local' | 'network';
    test_type: 'normal' | 'ai_debug';
}

/** 每台设备只统计本地玩家；状态转换触发，不在 update 中上报。 */
export class RaceAnalyticsTracker {
    private context: RaceAnalyticsContext | null = null;
    private ended = false;

    constructor(private readonly send: (event: AnalyticsEvent, fields: AnalyticsFields) => void) {}

    reset(): void { this.context = null; this.ended = false; }

    start(context: RaceAnalyticsContext): void {
        if (this.context) return;
        this.context = { ...context };
        this.send('race_start', { ...this.context });
    }

    /** 单机触壁按本地成绩记录；联机继续等待权威成绩。 */
    endLocalFinish(time: number, placement: number, distance: number): void {
        if (this.context?.play_type === 'local') this.end('completed', time, placement, distance);
    }

    end(outcome: 'completed' | 'dnf' | 'eliminated' | 'quit', time: number, placement: number, distance: number): void {
        if (!this.context || this.ended) return;
        this.ended = true;
        const finite = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
        this.send('race_end', { ...this.context, outcome,
            // 平台数值型验证要求整数；毫秒保留成绩精度，不改变游戏计时。
            time_ms: Math.round(finite(time) * 1000), placement: Math.floor(finite(placement)),
            progress_percent: Math.min(100, Math.round(finite(distance) / Math.max(1, this.context.distance) * 100)),
        });
    }

    again(): void {
        if (this.context && this.ended) this.send('race_again', { ...this.context });
    }
}
