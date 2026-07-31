// Platform Abstraction Layer (PAL) — the ONLY contract gameplay code talks to for
// platform capabilities (login, ads, share, leaderboard). Game logic never calls
// wx.* / tt.* directly; it calls platform() (see PlatformManager) and gets one of
// the per-platform implementations. Adding a new platform = one new file, zero
// changes to callers. Selection happens in PlatformManager.platform() via the
// compile-time WECHAT / BYTEDANCE constants from 'cc/env'.

export type PlatformName = 'wechat' | 'douyin' | 'default';

// Capabilities a platform may or may not support. Callers should gate optional
// features with isSupported() so the mock/editor build degrades gracefully.
export type PlatformFeature = 'login' | 'rewardedAd' | 'share' | 'leaderboard' | 'userProfile';

// wx.login()/tt.login() return a short-lived code. Exchange it on YOUR server for
// the real openid/session (appid+secret must stay server-side, never in the bundle).
export interface LoginResult {
    code: string;
    platform: PlatformName;
}

// Public profile shown in-game (headbar, leaderboards). Avatar is a URL (remote on
// mini-game platforms); empty when unknown/unauthorized.
export interface UserProfile {
    nickName: string;
    avatarUrl: string;
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

    // Fetch the user's public profile (nickname + avatar) if already available /
    // authorized. Resolves null when unavailable or not yet authorized (the caller
    // then shows a placeholder and can trigger the platform's authorization flow).
    getUserProfile(): Promise<UserProfile | null>;

    // Interactive authorization: on WeChat/Douyin this creates the required native
    // "get user info" button (user MUST tap it — platforms forbid silent grabs) and
    // resolves the profile after the tap. If already authorized it resolves silently.
    // Resolves null if the user declines or it is unsupported. May never resolve if
    // the user ignores the button, so treat it as fire-and-forget.
    requestUserProfile(): Promise<UserProfile | null>;

    // Launch query parameters (e.g. a shared room id in `room`). Empty when none.
    // NOTE: only reflects the COLD launch; when the game is already running and the
    // user taps a share card, the platform does NOT relaunch — it fires onAppShow
    // with the NEW query instead. Use onAppShow to catch warm-launch invites.
    getLaunchQuery(): Record<string, string>;

    // Fires every time the mini-game returns to the foreground (including when a
    // share card is tapped while it is already running). `query` carries the launch
    // parameters of THAT show (e.g. a `room` id). Returns an unsubscribe function.
    onAppShow(callback: (query: Record<string, string>) => void): () => void;
}
