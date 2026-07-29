// Douyin (ByteDance) Mini Game implementation. The tt.* API mirrors wx.* closely
// for login/ad/share; leaderboards differ (no direct cloud-storage KV), so those
// route through your own server. Only instantiated in a Douyin build.

import {
    IPlatform,
    LeaderboardEntry,
    LoginResult,
    PlatformFeature,
    RewardedAdResult,
    ShareOptions,
} from './IPlatform';

// Injected by the Douyin mini-game runtime adapter. Untyped on purpose.
declare const tt: any;

export class DouyinPlatform implements IPlatform {
    readonly name = 'douyin' as const;

    private _ads: Record<string, any> = {};

    isSupported(feature: PlatformFeature): boolean {
        if (typeof tt === 'undefined') {
            return false;
        }
        switch (feature) {
            case 'login':
                return typeof tt.login === 'function';
            case 'rewardedAd':
                return typeof tt.createRewardedVideoAd === 'function';
            case 'share':
                return typeof tt.shareAppMessage === 'function';
            case 'leaderboard':
                // No native KV leaderboard; served by your own backend.
                return false;
            default:
                return false;
        }
    }

    login(): Promise<LoginResult> {
        return new Promise((resolve, reject) => {
            tt.login({
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
                ad = tt.createRewardedVideoAd({ adUnitId });
                this._ads[adUnitId] = ad;
            }
            const cleanup = () => {
                ad.offClose(onClose);
                ad.offError(onError);
            };
            const onClose = (res: { isEnded?: boolean }) => {
                cleanup();
                const ended = !res || res.isEnded === undefined || res.isEnded === true;
                resolve(ended ? 'completed' : 'skipped');
            };
            const onError = (err: unknown) => {
                cleanup();
                console.warn('[Platform] douyin rewarded ad error', err);
                resolve('error');
            };
            ad.onClose(onClose);
            ad.onError(onError);
            ad.show().catch(() => {
                ad.load()
                    .then(() => ad.show())
                    .catch(onError);
            });
        });
    }

    share(options: ShareOptions): void {
        tt.shareAppMessage({
            title: options.title,
            imageUrl: options.imageUrl,
            query: options.query,
        });
    }

    submitScore(_score: number): Promise<void> {
        // TODO: POST the score to your server (Douyin has no cloud-storage KV like WeChat).
        console.warn('[Platform] douyin submitScore needs a server backend');
        return Promise.resolve();
    }

    getLeaderboard(_count = 10): Promise<LeaderboardEntry[]> {
        // TODO: fetch ranked rows from your server.
        console.warn('[Platform] douyin getLeaderboard needs a server backend');
        return Promise.resolve([]);
    }
}
