// Platform factory + singleton. Gameplay code calls platform() and gets the right
// IPlatform for the current build. Selection uses the compile-time constants from
// 'cc/env' (WECHAT / BYTEDANCE): in a WeChat build BYTEDANCE is a literal false, so
// the Douyin branch AND the DouyinPlatform import are tree-shaken out of the bundle
// (no cross-platform SDK bloat). The classes only touch wx/tt inside methods, so
// importing all three here is safe.

import { BYTEDANCE, WECHAT } from 'cc/env';
import { IPlatform } from './IPlatform';
import { DefaultPlatform } from './DefaultPlatform';
import { DouyinPlatform } from './DouyinPlatform';
import { WechatPlatform } from './WechatPlatform';

let _platform: IPlatform | null = null;

// The active platform for this build/runtime. Lazily created on first use.
export function platform(): IPlatform {
    if (_platform) {
        return _platform;
    }
    if (WECHAT) {
        _platform = new WechatPlatform();
    } else if (BYTEDANCE) {
        _platform = new DouyinPlatform();
    } else {
        // Editor preview, browser, native, or any platform without a mini-game SDK.
        _platform = new DefaultPlatform();
    }
    return _platform;
}
