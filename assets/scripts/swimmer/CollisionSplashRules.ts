export const COLLISION_SPLASH_MODE = {
    STANDARD: 'standard',
    WILD: 'wild',
    ENTERTAINMENT: 'entertainment',
} as const;

export type CollisionSplashMode = typeof COLLISION_SPLASH_MODE[keyof typeof COLLISION_SPLASH_MODE];

export const COLLISION_SPLASH_TIER = {
    NONE: 'none',
    MEDIUM: 'medium',
    STRONG: 'strong',
} as const;

export type CollisionSplashTier = typeof COLLISION_SPLASH_TIER[keyof typeof COLLISION_SPLASH_TIER];

export type CollisionSplashPreset = Readonly<{
    mediumThreshold: number;
    strongThreshold: number;
    showMedium: boolean;
    visualScale: number;
}>;

const STANDARD_PRESET: CollisionSplashPreset = {
    mediumThreshold: 0.9,
    strongThreshold: 2.2,
    showMedium: false,
    visualScale: 0.9,
};

const WILD_PRESET: CollisionSplashPreset = {
    mediumThreshold: 0.9,
    strongThreshold: 2.1,
    showMedium: true,
    visualScale: 1,
};

const ENTERTAINMENT_PRESET: CollisionSplashPreset = {
    mediumThreshold: 0.75,
    strongThreshold: 1.9,
    showMedium: true,
    // 娱乐模式主要通过更低阈值、略长停留和一颗额外小水滴强化读感，
    // 不再把身体碰撞放大成接近爆炸的水柱。
    visualScale: 1.08,
};

const MAX_COLLISION_MAGNITUDE = 4;

export function collisionSplashModeForRace(ruleset: string, category: string): CollisionSplashMode {
    if (ruleset === 'standard') return COLLISION_SPLASH_MODE.STANDARD;
    if (category === 'entertainment') return COLLISION_SPLASH_MODE.ENTERTAINMENT;
    return COLLISION_SPLASH_MODE.WILD;
}

export function collisionSplashPreset(mode: CollisionSplashMode): CollisionSplashPreset {
    if (mode === COLLISION_SPLASH_MODE.STANDARD) return STANDARD_PRESET;
    if (mode === COLLISION_SPLASH_MODE.ENTERTAINMENT) return ENTERTAINMENT_PRESET;
    return WILD_PRESET;
}

export function collisionSplashTierForImpact(
    magnitude: number,
    mode: CollisionSplashMode,
): CollisionSplashTier {
    const impact = Number.isFinite(magnitude) ? Math.max(0, magnitude) : 0;
    const preset = collisionSplashPreset(mode);
    if (impact >= preset.strongThreshold) return COLLISION_SPLASH_TIER.STRONG;
    if (preset.showMedium && impact >= preset.mediumThreshold) return COLLISION_SPLASH_TIER.MEDIUM;
    return COLLISION_SPLASH_TIER.NONE;
}

export function collisionSplashVisualScale(
    magnitude: number,
    mode: CollisionSplashMode,
    tier: CollisionSplashTier = collisionSplashTierForImpact(magnitude, mode),
): number {
    if (tier === COLLISION_SPLASH_TIER.NONE) return 0;
    const preset = collisionSplashPreset(mode);
    const threshold = tier === COLLISION_SPLASH_TIER.STRONG
        ? preset.strongThreshold
        : preset.mediumThreshold;
    const range = Math.max(0.001, MAX_COLLISION_MAGNITUDE - threshold);
    const normalized = clamp01((magnitude - threshold) / range);
    const tierScale = tier === COLLISION_SPLASH_TIER.STRONG
        ? 1 + normalized * 0.12
        : 0.76 + normalized * 0.14;
    return tierScale * preset.visualScale;
}

/**
 * 返回让 local +Z 沿碰撞中心线、local +X 尽量朝共同流向后方的稳定偏航角。
 * 碰撞法线本质上是一条无向轴，因此交换泳者顺序后仍返回同一朝向。
 */
export function collisionSplashYawRadians(
    normalX: number,
    normalZ: number,
    flowX: number,
    flowZ: number,
): number {
    let nx = Number.isFinite(normalX) ? normalX : 0;
    let nz = Number.isFinite(normalZ) ? normalZ : 0;
    const normalLength = Math.sqrt(nx * nx + nz * nz);
    if (normalLength > 1e-5) {
        nx /= normalLength;
        nz /= normalLength;
    } else {
        nx = 0;
        nz = 1;
    }
    const tangentX = nz;
    const tangentZ = -nx;
    const safeFlowX = Number.isFinite(flowX) ? flowX : 0;
    const safeFlowZ = Number.isFinite(flowZ) ? flowZ : 0;
    const rearDot = tangentX * -safeFlowX + tangentZ * -safeFlowZ;
    if (rearDot < -0.05
        || (Math.abs(rearDot) <= 0.05 && (nz < -1e-5 || (Math.abs(nz) <= 1e-5 && nx < 0)))) {
        nx = -nx;
        nz = -nz;
    }
    return Math.atan2(nx, nz);
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
