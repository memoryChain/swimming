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
    UserProfile,
} from './IPlatform';

// Injected by the Douyin mini-game runtime adapter. Untyped on purpose.
declare const tt: any;

export class DouyinPlatform implements IPlatform {
    readonly name = 'douyin' as const;

    private _ads: Record<string, any> = {};
    private _adShows: Record<string, Promise<RewardedAdResult> | undefined> = {};

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
            case 'userProfile':
                return typeof tt.getUserInfo === 'function';
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
        const active = this._adShows[adUnitId];
        if (active) {
            // One completed view must never satisfy two independent reward intents.
            return Promise.resolve('unavailable');
        }
        const request = new Promise<RewardedAdResult>((resolve) => {
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
        this._adShows[adUnitId] = request;
        const clearRequest = () => {
            if (this._adShows[adUnitId] === request) {
                delete this._adShows[adUnitId];
            }
        };
        void request.then(clearRequest, clearRequest);
        return request;
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

    getUserProfile(): Promise<UserProfile | null> {
        return new Promise((resolve) => {
            if (!this.isSupported('userProfile')) {
                resolve(null);
                return;
            }
            tt.getUserInfo({
                success: (info: { userInfo?: { nickName?: string; avatarUrl?: string } }) => {
                    const u = info.userInfo;
                    resolve(u ? { nickName: u.nickName ?? '', avatarUrl: u.avatarUrl ?? '' } : null);
                },
                fail: () => resolve(null),
            });
        });
    }

    requestUserProfile(): Promise<UserProfile | null> {
        return new Promise((resolve) => {
            if (!this.isSupported('userProfile') || typeof tt.createUserInfoButton !== 'function') {
                resolve(null);
                return;
            }
            const button = tt.createUserInfoButton({
                type: 'text',
                text: '获取头像昵称',
                style: {
                    left: 12,
                    top: 12,
                    width: 200,
                    height: 44,
                    lineHeight: 44,
                    backgroundColor: '#1a83aa',
                    color: '#ffffff',
                    textAlign: 'center',
                    fontSize: 16,
                    borderRadius: 8,
                },
            });
            button.onTap((res: { userInfo?: { nickName?: string; avatarUrl?: string } }) => {
                const u = res && res.userInfo;
                resolve(u ? { nickName: u.nickName ?? '', avatarUrl: u.avatarUrl ?? '' } : null);
                button.destroy();
            });
        });
    }

    getLaunchQuery(): Record<string, string> {
        try {
            return (tt.getLaunchOptionsSync && tt.getLaunchOptionsSync().query) || {};
        } catch (error) {
            console.warn('[Platform] douyin getLaunchQuery failed', error);
            return {};
        }
    }

    onAppShow(callback: (query: Record<string, string>) => void): () => void {
        const handler = (res: any) => {
            try {
                callback((res && res.query) || {});
            } catch (error) {
                console.warn('[Platform] douyin onShow handler failed', error);
            }
        };
        try {
            tt.onShow(handler);
        } catch (error) {
            console.warn('[Platform] douyin onShow failed', error);
            return () => {};
        }
        return () => {
            try {
                tt.offShow && tt.offShow(handler);
            } catch (error) {
                // ignore
            }
        };
    }
}
