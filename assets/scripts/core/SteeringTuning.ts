// Steering / "蛇形转向" comedy system tuning.
// 蛇形转向搞笑系统的手感数值。设计见 docs/imbalance-comedy-design.zh.md。
//
// Core idea: a stroke no longer only accelerates — it also injects heading angular
// velocity. That velocity survives release and decays through water drag, so the
// swimmer keeps drawing an arc instead of travelling along one fixed diagonal.
// Opposite strokes reverse the curvature and naturally produce an S; simultaneous
// strokes cancel. Forward progress is speed*cos(heading), so veering is slower.
//
// 核心：划手给偏航角速度一个冲量。松手后角速度继续存在，朝向持续变化、轨迹继续画弧；
// 划另一侧会反转曲率，自然形成 S 形。同时双划仍相互抵消，连续同侧则让弯道越来越急。
export const MAX_STEERING_HEADING_DEGREES = 85;

export const STEERING_TUNING = {
    // Angular-velocity impulse (degrees/second) from one full-power arm stroke.
    turnAngularImpulse: 36,

    // Exponential water drag on steering angular velocity. Lower preserves the
    // curve longer; 0 keeps turning until an opposite stroke or boundary counters it.
    turnAngularDrag: 0.6,

    // Hard angular-velocity cap for repeated same-side strokes.
    maxTurnRate: 95,

    // Maximum |heading| (degrees). At 65° cos≈0.42, so the swimmer still moves
    // forward (~40% speed) while looking hilariously crooked; it never swims
    // sideways or backward.
    // 朝向角上限（度）。65° 时 cos≈0.42，仍向前（约四成速度）但已明显歪斜；运行时还有
    // MAX_STEERING_HEADING_DEGREES 硬上限，保证存档或调参异常也不能横游或倒游。
    maxHeading: 65,


    // Turn the curvature inward after the oriented body touches a pool wall.
    poolWallHeadingCorrectionRate: 2.5,
    // Minimum inward-facing angle the wall helper tries to establish before it
    // stops interfering. This gives the body footprint enough room to detach.
    poolWallEscapeHeadingDegrees: 14,

    // Sustained player kicking offers a forgiving way to recover from a bad
    // heading. Once kick cadence reaches this frequency, the target heading
    // gradually returns to the lane axis through a damped angular spring.
    kickStraightenMinCadenceHz: 2.5,
    kickStraightenRate: 0.0,

    // Turn scales with stroke POWER: the longer a stroke is held (the further the
    // pull travels before release), the bigger the turn. This is the multiplier
    // for the weakest (shortest) real stroke; a full-length pull turns at 1.0.
    // So a light flick barely bends the path while a strong, long pull swings it
    // hard. 1 = no power scaling (every stroke turns the full amount).
    // 转向角与划水“发力”挂钩：按得越久（松手前拉水行程越长）偏得越多。这是最弱（最
    // 短）真实划水的转向倍率，拉满一次划水 = 1.0。轻点几乎不拐，重划狠拐。1 = 不按力度缩放。
    turnPowerMinFactor: 0.35,

    // AI steering: opponents share the SAME stroke-steering as the player and
    // weave purely through imperfect input (the AI controller only decides which
    // side to stroke). aiCorrectHeadingRatio = how far off course (fraction of
    // maxHeading) before the AI tries to steer back. aiWanderChance = base chance
    // a sloppy AI breaks clean alternation (repeats a side) to amplify its curve;
    // scaled by (1 - difficulty), so weak AI weaves much more.
    // AI 转向：对手与玩家共用同一套划水转向，完全靠不完美的输入蛇形（AI 控制器
    // 只决定划哪一侧）。aiCorrectHeadingRatio = 偏离多少（占 maxHeading 比例）后 AI 开始纠偏；
    // aiWanderChance = AI 打破整齐交替（重复同侧）放大偏航的基础概率，按 (1-难度) 缩放。
    aiCorrectHeadingRatio: 0.3,
    aiWanderChance: 0.5,

    // Pool-wall clearance (metres) kept between the swimmer root and the pool's
    // side walls when clamping the lateral offset.
    // 横向钳制时，泳者根节点与泳池侧壁之间保留的余量（米）。
    poolWallClearance: 0.1,

    // Deterministic oriented footprint used for pool-wall and lane-lockdown checks.
    // It follows only the synchronized root heading, never the render-rate skeleton pose,
    // so AI pose LOD/culling cannot change race results across devices.
    // 泳池边界与封道判定使用的确定性朝向包围体。只跟随同步的根节点朝向，不读取渲染骨骼，
    // 避免 AI 动作降频或离屏冻结导致不同设备判定不一致。
    poolBoundaryBodyHalfLength: 1.35,
    poolBoundaryBodyHalfWidth: 0.4,

    // Use the behind-the-swimmer sprint chase camera for the surface-swim phase
    // so the weaving reads clearly. Not a slider (boolean).
    // 游泳推进段是否使用背后跟拍的冲刺视角，让蛇形一目了然。（布尔，不是滑块）
    useSprintSwimView: true,
};
