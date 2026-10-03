import type { PlatformName } from './IPlatform';

export type AnalyticsFields = Readonly<Record<string, string | number>>;
export type AnalyticsEvent = 'lobby_ready' | 'race_start' | 'race_end' | 'race_again'
    | 'sidebar_guide_click' | 'sidebar_jump_result' | 'sidebar_return';
export type AnalyticsLaunchContext = Readonly<{ startedAt: number; source: string }>;

/** 游戏统一产生事件；平台实现只负责来源信息和上报接口。 */
export interface IPlatformAnalytics {
    readonly platform: PlatformName;
    readonly enabled: boolean;
    getLaunchContext(): AnalyticsLaunchContext;
    report(event: AnalyticsEvent, fields: AnalyticsFields): void;
}
