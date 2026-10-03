import { BYTEDANCE } from 'cc/env';
import { DouyinEngagement, type DouyinEngagementApi, type DouyinLaunchBridge } from './DouyinEngagement';

import { PLATFORM_ANALYTICS_CONFIG } from './AnalyticsConfig';

declare const tt: DouyinEngagementApi;
declare const GameGlobal: { __swimmingDouyinLaunch?: DouyinLaunchBridge };
let engagement: DouyinEngagement | null = null;

/** 微信、网页和编辑器返回 null，不注册抖音监听或上报。 */
export function platformEngagement(): DouyinEngagement | null {
    if (!BYTEDANCE || typeof tt === 'undefined') return null;
    if (!engagement) {
        const bridge = (typeof GameGlobal !== 'undefined' ? GameGlobal.__swimmingDouyinLaunch : undefined)
            ?? (globalThis as typeof globalThis & { __swimmingDouyinLaunch?: DouyinLaunchBridge }).__swimmingDouyinLaunch;
        engagement = new DouyinEngagement(tt, PLATFORM_ANALYTICS_CONFIG, bridge, Date.now,
            PLATFORM_ANALYTICS_CONFIG.is_test === 1);
    }
    return engagement;
}
