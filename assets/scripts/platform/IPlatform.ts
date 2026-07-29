// Platform Abstraction Layer (PAL) — the ONLY contract gameplay code talks to for
// platform capabilities (login, ads, share, leaderboard). Game logic never calls
// wx.* / tt.* directly; it calls platform() (see PlatformManager) and gets one of
// the per-platform implementations. Adding a new platform = one new file, zero
// changes to callers. Selection happens in PlatformManager.platform() via the
// compile-time WECHAT / BYTEDANCE constants from 'cc/env'.

export type PlatformName = 'wechat' | 'douyin' | 'default';

// Capabilities a platform may or may not support. Callers should gate optional
// features with isSupported() so the mock/editor build degrades gracefully.
export type PlatformFeature = 'login' | 'rewardedAd' | 'share' | 'leaderboard';

// wx.login()/tt.login() return a short-lived code. Exchange it on YOUR server for
// the real openid/session (appid+secret must stay server-side, never in the bundle).
export interface LoginResult {
    code: string;
    platform: PlatformName;
}

export type RewardedAdResult =
    | 'completed'    // watched to the end — grant the reward
    | 'skipped'      // closed early — do NOT grant
    | 'error'        // failed to load/show
    | 'unavailable'; // platform has no rewarded-ad support (e.g. editor/web)

export interface ShareOptions {
    title: string;
    // Preview image. Mini-game platforms want a hosted URL or a local path they can read.
    imageUrl?: string;
    // Extra launch query appended to the share link (e.g. 'from=share&roomId=123').
    query?: string;
}

export interface LeaderboardEntry {
    rank: number;
    name: string;
    avatarUrl?: string;
    score: number;
    isSelf?: boolean;
}

export interface IPlatform {
    readonly name: PlatformName;

    // Cheap synchronous capability probe. Use before offering an ad button, etc.
    isSupported(feature: PlatformFeature): boolean;

    // Resolve with a code to send to your server. Rejects if the platform refuses.
    login(): Promise<LoginResult>;

    // Resolve with the watch outcome. Never rejects — inspect the result instead so
    // callers don't have to try/catch around a reward flow.
    showRewardedAd(adUnitId: string): Promise<RewardedAdResult>;

    // Fire-and-forget share. No result: platforms don't reliably report success.
    share(options: ShareOptions): void;

    // Push the player's score to the platform/server-backed leaderboard.
    submitScore(score: number): Promise<void>;

    // Fetch ranked entries (self + top/friends). Empty array when unsupported.
    getLeaderboard(count?: number): Promise<LeaderboardEntry[]>;
}
