import { BYTEDANCE } from 'cc/env';
import { DouyinEngagement, DouyinEngagementApi, DouyinLaunchBridge } from './DouyinEngagement';

/** 发正式版本前修改测试标记与版本号；字段必须与后台事件配置一致。 */
export const PLATFORM_ANALYTICS_CONFIG = {
    build_version: 'douyin-platform-test-2',
    schema_version: 2,
    is_test: 1,
};

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
