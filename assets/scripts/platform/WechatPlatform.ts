// WeChat Mini Game implementation. Only compiled/instantiated in a WeChat build
// (PlatformManager gates on the WECHAT constant from 'cc/env'), but the wx global
// is only touched inside methods so importing this file elsewhere is harmless.

import {
    IPlatform,
    LeaderboardEntry,
    LoginResult,
    PlatformFeature,
    RewardedAdResult,
    ShareOptions,
} from './IPlatform';

// Injected by the WeChat mini-game runtime adapter. Untyped on purpose.
declare const wx: any;

export class WechatPlatform implements IPlatform {
    readonly name = 'wechat' as const;

    // Rewarded-ad instances must be created ONCE and reused; creating a new one per
    // show leaks and is discouraged by WeChat. Cache them by ad unit id.
    private _ads: Record<string, any> = {};

    isSupported(feature: PlatformFeature): boolean {
        if (typeof wx === 'undefined') {
            return false;
        }
        switch (feature) {
            case 'login':
                return typeof wx.login === 'function';
            case 'rewardedAd':
                return typeof wx.createRewardedVideoAd === 'function';
            case 'share':
                return typeof wx.shareAppMessage === 'function';
            case 'leaderboard':
                return typeof wx.setUserCloudStorage === 'function';
            default:
                return false;
        }
    }

    login(): Promise<LoginResult> {
        return new Promise((resolve, reject) => {
            wx.login({
                success: (res: { code: string }) => resolve({ code: res.code, platform: this.name }),
                fail: reject,
            });
        });
    }

    showRewardedAd(adUnitId: string): Promise<RewardedAdResult> {
        if (!this.isSupported('rewardedAd')) {
            return Promise.resolve('unavailable');
        }
        return new Promise((resolve) => {
            let ad = this._ads[adUnitId];
            if (!ad) {
                ad = wx.createRewardedVideoAd({ adUnitId });
                this._ads[adUnitId] = ad;
            }
            const cleanup = () => {
                ad.offClose(onClose);
                ad.offError(onError);
            };
            const onClose = (res: { isEnded?: boolean }) => {
                cleanup();
                // isEnded undefined on some older bases -> treat as watched.
                const ended = !res || res.isEnded === undefined || res.isEnded === true;
                resolve(ended ? 'completed' : 'skipped');
            };
            const onError = (err: unknown) => {
                cleanup();
                console.warn('[Platform] wechat rewarded ad error', err);
                resolve('error');
            };
            ad.onClose(onClose);
            ad.onError(onError);
            // Show immediately; if it isn't preloaded, load then show.
            ad.show().catch(() => {
                ad.load()
                    .then(() => ad.show())
                    .catch(onError);
            });
        });
    }

    share(options: ShareOptions): void {
        wx.shareAppMessage({
            title: options.title,
            imageUrl: options.imageUrl,
            query: options.query,
        });
    }

    submitScore(score: number): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.isSupported('leaderboard')) {
                resolve();
                return;
            }
            // KV cloud storage backs WeChat's friend leaderboard (read in the open
            // data context). Keep the key stable ('score') to match the sub-domain.
            wx.setUserCloudStorage({
                KVDataList: [{ key: 'score', value: String(score) }],
                success: () => resolve(),
                fail: reject,
            });
        });
    }

    getLeaderboard(_count = 10): Promise<LeaderboardEntry[]> {
        // NOTE: WeChat friend scores are only readable inside the OPEN DATA CONTEXT
        // (a separate sub-domain rendered to a shared canvas) — the main context
        // cannot read them directly. Two options to finish this:
        //   1) Render the open-data-context leaderboard to a texture (wx.getOpenDataContext).
        //   2) Keep scores on YOUR server and return them here (simplest, cross-platform).
        // Returning empty until one of those is wired.
        console.warn('[Platform] wechat getLeaderboard needs open-data-context or a server backend');
        return Promise.resolve([]);
    }
}
