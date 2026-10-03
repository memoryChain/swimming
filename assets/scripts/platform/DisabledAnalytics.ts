import type { PlatformName } from './IPlatform';
import type { IPlatformAnalytics, AnalyticsLaunchContext, AnalyticsEvent, AnalyticsFields } from './IPlatformAnalytics';

const DISABLED_LAUNCH: AnalyticsLaunchContext = { startedAt: 0, source: 'other' };

/** 平台尚未接入时显式关闭，不缓存事件、不访问 SDK、不启动计时器。 */
export class DisabledAnalytics implements IPlatformAnalytics {
    readonly enabled = false;
    constructor(readonly platform: PlatformName) {}
    getLaunchContext(): AnalyticsLaunchContext { return DISABLED_LAUNCH; }
    report(_event: AnalyticsEvent, _fields: AnalyticsFields): void {}
}
