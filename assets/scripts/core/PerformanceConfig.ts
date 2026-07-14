// Lightweight runtime performance switches for WeChat Mini Game.
// Keep this focused on rendering/effect cost trade-offs that we may want to A/B or ship differently
// per device tier. Values here are defaults; some can be toggled at runtime for testing.
// 面向微信小游戏的轻量运行时性能开关。
// 只放渲染/特效开销相关的取舍项，方便按机型分级或做 A/B 测试。此处为默认值，部分可运行时切换。
export const PERFORMANCE_CONFIG = {
    // Venue jumbotron: the big-screen "broadcast side view" feed. When false the whole
    // feature is skipped (no extra feed camera / RenderTexture / feed water+floor), and
    // the screens just keep their static material. Turn off if the extra render pass is
    // too costly on a device.
    // 场馆大屏转播画面开关。关掉则完全不启用大屏(不建馈送相机/RT/大屏水池),屏幕保持静态材质。
    scoreboardFeed: {
        enabled: false,
    },

    splash: {
        // Runtime particle spray switch. Turn this off to keep surface foam but stop/clear ParticleSystem
        // spray for all swimmers, useful for quick performance A/B tests. Press L in preview to toggle.
        particleEmittersEnabled: true,

        // Cull splash + freeze pose for AI swimmers that are off-screen. Visibility is tested against
        // the actual camera frustum (works for broadcast / top / underwater views alike), so
        // this correctly handles zoom and non-side-on shots instead of a crude X-distance guess.
        // This is the startup default; press K in a preview to toggle live.
        // 对离屏 AI 选手裁剪水花并冻结姿态。可见性用真实相机视锥体判断（转播/俯视/水下/自由视角都适用），
        // 因此能正确处理缩放和非横版机位，而非粗暴的 X 距离估算。此为启动默认值；预览中按 K 可运行时切换。
        cullingEnabled: true,

        // World-space margin (meters) added around each swimmer when frustum-testing. Padding avoids
        // popping a swimmer whose body/splash still pokes into view while its origin just left the frame.
        // XZ pads the horizontal spread; Y pads the small vertical splash column.
        // 视锥测试时在每个选手周围额外扩展的世界尺寸（米）。留白避免选手原点刚出画面、但身体/水花仍探进
        // 画面时被误裁。XZ 扩展水平范围，Y 扩展较小的竖直水花柱。
        visibilityMarginXZ: 1.4,
        visibilityMarginY: 1.2,

        // Fallback half-width (meters) of the on-screen X window around the player, used only when the
        // camera / frustum is unavailable (e.g. before the camera binds). Frustum culling is preferred.
        // 玩家两侧在屏 X 半窗宽度（米），仅在相机/视锥不可用时（如相机绑定前）作为回退。优先用视锥裁剪。
        cullingDistanceX: 11,
    },

    motion: {
        // The per-swimmer procedural freestyle pose (2 arms + 2 legs + root/torso IK, all quaternion
        // math) runs every frame for every racing swimmer. With 8 lanes this dominates CPU during the
        // race and eases as AI swimmers finish — matching the observed 60fps -> 50fps -> 60fps curve.
        // 每个游泳者的程序化自由泳姿态（双臂+双腿+躯干 IK，全四元数运算）每帧对所有在游选手运行。
        // 8 泳道时它在比赛中主导 CPU，AI 陆续完赛后开销回落，正好对应观察到的 60→50→60 帧曲线。

        // Throttle background AI pose updates: recompute their skeleton every N frames instead of every
        // frame (motor cycles still advance every frame, so motion stays continuous — only the skeleton
        // write cadence drops). Player is never throttled.
        // 背景 AI 姿态降频：每 N 帧才重算一次骨骼（motor 相位仍每帧推进，动作保持连续，只是骨骼写入频率下降）。
        // 玩家永不降频。
        aiPoseThrottleEnabled: true,

        // Distance-based LOD for on-screen AI: swimmers close to the player update more often; far ones
        // update less. Stride = frames between skeleton rebuilds at a 60fps base (2 = ~30fps, 3 = ~20fps).
        // Distance is measured along the swim (X) axis to the player. Tiers are checked nearest-first;
        // an AI uses the first tier whose maxDistanceX it falls within, else farTierStride.
        // 屏内 AI 按到主角的距离分级：近的更新更勤、远的更疏。stride = 60fps 下每几帧重算一次骨骼
        // （2≈30fps，3≈20fps）。距离取沿游泳（X）轴到玩家的间距。分级从近到远匹配：AI 落入第一个
        // maxDistanceX 内的分级即用其 stride，否则用 farTierStride。
        aiPoseDistanceTiers: [
            // Near: within 6m of the player -> ~30fps.
            // 近：距玩家 6m 内 -> 约 30fps。
            { maxDistanceX: 6, stride: 2 },
        ] as const,

        // Far tier stride for on-screen AI beyond every tier above (still inside the frustum) -> ~20fps.
        // 超出以上全部分级但仍在视锥内的远处 AI 使用的 stride -> 约 20fps。
        farTierStride: 3,

        // Freeze pose entirely for AI swimmers that are culled off-screen (see splash.cullingDistanceX).
        // They aren't visible, so their skeleton doesn't need updating at all — the biggest win once the
        // field spreads out along the lane.
        // 对离屏被裁剪的 AI 选手（见 splash.cullingDistanceX）完全冻结姿态。它们不可见，骨骼无需更新——
        // 选手沿泳道拉开后这是最大的一项节省。
        freezePoseWhenCulled: true,
    },
} as const;
