// Player progression profile — the account's persistent 养成 data. Phase 1 has a
// single currency: 游泳卡 (swim cards). Kept deliberately small; add fields over time
// and bump PLAYER_PROFILE_SCHEMA when the shape changes so old saves can migrate.

export const PLAYER_PROFILE_SCHEMA = 1;

// In-game resource display names (single source of truth for UI text).
export const CURRENCY = {
    swimCard: { id: 'swimCard', label: '游泳卡' },
} as const;

// Tunable progression numbers shared by the client mock. The real WeChat Cloud
// function is authoritative and keeps its own copy of these (server can't trust
// client values); keep the two in sync when they matter.
export const PROGRESSION_CONFIG = {
    // Swim cards granted per completed rewarded-ad view.
    adRewardSwimCards: 1,
    // Max rewarded-ad grants per day (anti-spam).
    dailyAdCap: 10,
} as const;

export interface PlayerProfile {
    schema: number;
    // 游泳卡 balance.
    swimCards: number;
    // Per-day rewarded-ad counter (reset when the date rolls over).
    daily: {
        date: string; // 'YYYY-MM-DD' local
        adCount: number;
    };
}

export function todayString(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = pad2(now.getMonth() + 1);
    const d = pad2(now.getDate());
    return `${y}-${m}-${d}`;
}

function pad2(value: number): string {
    return value < 10 ? `0${value}` : `${value}`;
}

export function createDefaultProfile(): PlayerProfile {
    return {
        schema: PLAYER_PROFILE_SCHEMA,
        swimCards: 0,
        daily: { date: todayString(), adCount: 0 },
    };
}

// Fill in any missing fields on a loaded profile (forward-compatible migration)
// and roll the daily counter over if the date changed. Always returns a valid,
// fully-populated profile.
export function normalizeProfile(raw: unknown): PlayerProfile {
    const base = createDefaultProfile();
    if (!raw || typeof raw !== 'object') {
        return base;
    }
    const src = raw as Partial<PlayerProfile>;
    const profile: PlayerProfile = {
        schema: PLAYER_PROFILE_SCHEMA,
        swimCards: Number.isFinite(src.swimCards as number) ? Math.max(0, Math.floor(src.swimCards as number)) : 0,
        daily: {
            date: typeof src.daily?.date === 'string' ? src.daily!.date : base.daily.date,
            adCount: Number.isFinite(src.daily?.adCount as number) ? Math.max(0, Math.floor(src.daily!.adCount as number)) : 0,
        },
    };
    // Roll over the daily counter on a new day.
    if (profile.daily.date !== todayString()) {
        profile.daily.date = todayString();
        profile.daily.adCount = 0;
    }
    return profile;
}
