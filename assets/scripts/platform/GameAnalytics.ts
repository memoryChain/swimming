import type { IPlatformAnalytics, AnalyticsEvent, AnalyticsFields } from './IPlatformAnalytics';
import { PLATFORM_ANALYTICS_CONFIG } from './AnalyticsConfig';
import { RaceAnalyticsTracker } from './RaceAnalyticsTracker';

/** 共用业务事件和去重规则，不依赖具体平台或比赛模拟。 */
export class GameAnalytics {
    private lobbyReported = false;
    private warned = false;

    constructor(private readonly adapter: IPlatformAnalytics,
        private readonly common: AnalyticsFields = PLATFORM_ANALYTICS_CONFIG,
        private readonly now: () => number = Date.now) {}

    reportLobbyReady(): void {
        if (!this.adapter.enabled || this.lobbyReported) return;
        this.lobbyReported = true;
        try {
            const launch = this.adapter.getLaunchContext();
            const elapsed = this.now() - launch.startedAt;
            this.report('lobby_ready', { load_ms: Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : 0,
                source: launch.source });
        } catch { this.warnOnce(); }
    }

    createRaceTracker(): RaceAnalyticsTracker | null {
        return this.adapter.enabled ? new RaceAnalyticsTracker((event, fields) => this.report(event, fields)) : null;
    }

    private report(event: AnalyticsEvent, fields: AnalyticsFields): void {
        if (!this.adapter.enabled) return;
        try { this.adapter.report(event, { ...fields, ...this.common }); }
        catch { this.warnOnce(); }
    }

    private warnOnce(): void {
        if (this.warned) return;
        this.warned = true;
        console.warn('[GameAnalytics] 上报接口异常，游戏继续运行');
    }
}
