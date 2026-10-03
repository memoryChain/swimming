import type { IPlatformAnalytics, AnalyticsLaunchContext, AnalyticsEvent, AnalyticsFields } from './IPlatformAnalytics';
import { platformEngagement } from './PlatformEngagement';

/** 抖音实现沿用早期启动桥接；比赛事件定义由公共层管理。 */
export class DouyinAnalytics implements IPlatformAnalytics {
    readonly platform = 'douyin';
    private readonly service = platformEngagement();
    get enabled(): boolean { return this.service?.canReportAnalytics ?? false; }
    getLaunchContext(): AnalyticsLaunchContext {
        return this.service?.getAnalyticsLaunchContext() ?? { startedAt: 0, source: 'other' };
    }
    report(event: AnalyticsEvent, fields: AnalyticsFields): void {
        this.service?.report(event, fields);
    }
}
