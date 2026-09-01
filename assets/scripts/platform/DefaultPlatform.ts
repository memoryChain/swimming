// Default / fallback platform: used in the Cocos editor preview, browser builds,
// and native runtimes where no mini-game SDK (wx / tt) exists. Everything is a
// harmless mock so the whole game — including menus that call login/leaderboard —
// runs locally without crashing on a missing global.

import {
    IPlatform,
    LeaderboardEntry,
    LoginResult,
    PlatformFeature,
    RewardedAdResult,
    ShareOptions,
    UserProfile,
} from './IPlatform';

export class DefaultPlatform implements IPlatform {
    readonly name = 'default' as const;

    isSupported(_feature: PlatformFeature): boolean {
        // Mock supports login/leaderboard/share (fake) but reports no real ad.
        return true;
    }

    login(): Promise<LoginResult> {
        return Promise.resolve({ code: 'mock-code', platform: this.name });
    }

    showRewardedAd(adUnitId: string): Promise<RewardedAdResult> {
        console.log(`[Platform] mock rewarded ad "${adUnitId}" -> auto complete`);
        // Auto-grant in dev so reward flows are testable without a real ad SDK.
        return Promise.resolve('completed');
    }

    share(options: ShareOptions): void {
        console.log(`[Platform] mock share: ${options.title}`);
    }

    submitScore(score: number): Promise<void> {
        console.log(`[Platform] mock submitScore: ${score}`);
        return Promise.resolve();
    }

    getLeaderboard(count = 10): Promise<LeaderboardEntry[]> {
        const rows: LeaderboardEntry[] = [];
        for (let i = 0; i < count; i++) {
            rows.push({
                rank: i + 1,
                name: i === 0 ? '你(测试)' : `玩家${i + 1}`,
                score: 100 - i * 7,
                isSelf: i === 0,
            });
        }
        return Promise.resolve(rows);
    }

    getUserProfile(): Promise<UserProfile | null> {
        // Editor/web mock identity so the headbar has something to show locally.
        return Promise.resolve({ nickName: '游客', avatarUrl: '' });
    }

    requestUserProfile(): Promise<UserProfile | null> {
        // No real authorization off-platform; return the same mock.
        return Promise.resolve({ nickName: '游客', avatarUrl: '' });
    }

    getLaunchQuery(): Record<string, string> {
        return {};
    }

    onAppShow(_callback: (query: Record<string, string>) => void): () => void {
        // No foreground/background lifecycle off-platform.
        return () => {};
    }

    getTopRightReservedRatio(): number {
        return 0;
    }
}
