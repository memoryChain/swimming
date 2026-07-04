// Lightweight runtime performance switches for WeChat Mini Game.
// Keep this focused on rendering/effect cost trade-offs that we may want to A/B or ship differently
// per device tier. Values here are defaults; some can be toggled at runtime for testing.
// 面向微信小游戏的轻量运行时性能开关。
// 只放渲染/特效开销相关的取舍项，方便按机型分级或做 A/B 测试。此处为默认值，部分可运行时切换。
export const PERFORMANCE_CONFIG = {
    splash: {
        // Runtime particle spray switch. Turn this off to keep surface foam but stop/clear ParticleSystem
        // spray for all swimmers, useful for quick performance A/B tests. Press L in preview to toggle.
        particleEmittersEnabled: true,

        // Cull splash for AI swimmers that are off-screen along the swim (X) axis.
        // The 2.5D side view keeps the player framed, so far-away swimmers can skip all
        // particle/foam updates. This is the startup default; press K in a preview to toggle live.
        // 裁剪沿游泳（X）轴离屏的 AI 选手水花。横版 2.5D 下玩家始终在画面内，远处选手可跳过
        // 全部粒子/泡沫更新。此为启动默认值；预览中按 K 可运行时切换。
        cullingEnabled: true,

        // Half-width (meters) of the on-screen X window around the player. AI swimmers farther than
        // this along the swim axis are treated as off-screen. Generous enough to avoid visible
        // pop-in while still skipping work once the field spreads out.
        // 玩家两侧的在屏 X 半窗宽度（米）。沿游泳轴超出此范围的 AI 选手视为离屏。取值偏宽松以避免
        // 明显弹出，同时在选手拉开后仍能省下开销。
        cullingDistanceX: 11,
    },
} as const;
