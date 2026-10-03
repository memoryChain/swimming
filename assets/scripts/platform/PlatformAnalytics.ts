import { BYTEDANCE, WECHAT } from 'cc/env';
import type { IPlatformAnalytics } from './IPlatformAnalytics';
import { GameAnalytics } from './GameAnalytics';
import { DouyinAnalytics } from './DouyinAnalytics';
import { DisabledAnalytics } from './DisabledAnalytics';

let analytics: GameAnalytics | null = null;

/** 接入新平台时在这里选择实现，业务调用和事件字段无需改动。 */
export function gameAnalytics(): GameAnalytics {
    if (analytics) return analytics;
    let adapter: IPlatformAnalytics;
    if (BYTEDANCE) adapter = new DouyinAnalytics();
    // 微信暂未接入埋点；以后只替换平台实现，不修改游戏流程。
    else if (WECHAT) adapter = new DisabledAnalytics('wechat');
    else adapter = new DisabledAnalytics('default');
    analytics = new GameAnalytics(adapter);
    return analytics;
}
