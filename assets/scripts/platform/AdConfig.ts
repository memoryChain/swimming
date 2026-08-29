// Rewarded-ad unit ids, one place to configure per platform. These ids come from
// the platform's backend console (WeChat 公众平台 / 抖音开放平台) — they are NOT
// secret (they ship in the client), but they must match a real ad unit or the ad
// won't show on device.
//
// TODO(ads): replace the placeholder ids below with the real ad unit ids created
// in each platform's backend. The editor/web build never reads these (DefaultPlatform
// auto-completes the mock ad), so leaving placeholders is safe for local testing.

import { PlatformName } from './IPlatform';

// Placeholder — replace with the real WeChat rewarded-video ad unit id.
const WECHAT_REWARDED_AD_UNIT_ID = 'adunit-0000000000000000';

// Placeholder — replace with the real Douyin rewarded-video ad unit id.
const DOUYIN_REWARDED_AD_UNIT_ID = 'adunit-0000000000000000';

// The rewarded-ad unit id for the currently running platform. DefaultPlatform
// (editor/web) ignores the id and auto-completes, so any value works there.
export function rewardedAdUnitId(platformName: PlatformName): string {
    switch (platformName) {
        case 'wechat':
            return WECHAT_REWARDED_AD_UNIT_ID;
        case 'douyin':
            return DOUYIN_REWARDED_AD_UNIT_ID;
        default:
            return WECHAT_REWARDED_AD_UNIT_ID;
    }
}

export function isRewardedAdConfigured(platformName: PlatformName): boolean {
    if (platformName === 'default') {
        // Editor/web uses the deterministic mock and ignores the id.
        return true;
    }
    const adUnitId = rewardedAdUnitId(platformName);
    return adUnitId.length > 0 && adUnitId !== 'adunit-0000000000000000';
}
