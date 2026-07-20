// Steering / "蛇形转向" comedy system tuning.
// 蛇形转向搞笑系统的手感数值。设计见 docs/imbalance-comedy-design.zh.md。
//
// Core idea: a stroke no longer only accelerates — it also nudges the swimmer's
// heading. A RIGHT-hand stroke turns the body toward +Z ("left"); a LEFT-hand
// stroke turns toward -Z ("right"). Alternating strokes (or both at once) cancel
// out and keep a straight line; spamming one side curves the path. Forward race
// progress is speed*cos(heading), so veering is naturally slower — no extra
// penalty needed. Lane ropes have no collision; only the pool walls clamp.
//
// 核心：划手不再只是加速，还会给一个转向冲量。右手 → 身体偏向 +Z（"左"），左手 → 偏向
// -Z（"右"）。左右交替（或同时双划）相互抵消保持直线；连点一侧就画弧。名次进度按
// speed*cos(heading)，所以歪着游天然更慢，无需额外惩罚。泳道绳无碰撞，只有池壁钳制。
export const MAX_STEERING_HEADING_DEGREES = 85;

export const STEERING_TUNING = {
    // Heading change (degrees) applied by a single arm stroke.
    // 单手划水施加的转向角（度）。
    turnPerStroke: 14,

    // Maximum |heading| (degrees). At 65° cos≈0.42, so the swimmer still moves
    // forward (~40% speed) while looking hilariously crooked; it never swims
    // sideways or backward.
    // 朝向角上限（度）。65° 时 cos≈0.42，仍向前（约四成速度）但已明显歪斜；运行时还有
    // MAX_STEERING_HEADING_DEGREES 硬上限，保证存档或调参异常也不能横游或倒游。
    maxHeading: 65,


    // How fast the actual heading eases toward its target, per second. A stroke
    // bumps the target on RELEASE; the body then turns GRADUALLY toward it rather
    // than snapping. Lower = slower, lazier turn; higher = snappier.
    // 实际朝向向目标靠拢的速率（每秒）。划水在“松手”时改变目标，身体随后逐渐转过去而非瞬间硬转。
    // 越低转得越慢越懒，越高越干脆。
    turnEaseRate: 3.5,

    // Sustained player kicking offers a forgiving way to recover from a bad
    // heading. Once kick cadence reaches this frequency, the target heading
    // gradually returns to the lane axis. The body still follows it through
    // turnEaseRate, so correction never snaps.
    kickStraightenMinCadenceHz: 2.5,
    kickStraightenRate: 1.5,

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
    // a sloppy AI breaks clean alternation (repeats a side) to start a drift;
    // scaled by (1 - difficulty) so strong AI almost never wanders and stays
    // straight, weak AI weaves a lot. No separate wobble system.
    // AI 转向：对手与玩家共用同一套划水转向，完全靠不完美的输入蛇形（AI 控制器
    // 只决定划哪一侧）。aiCorrectHeadingRatio = 偏离多少（占 maxHeading 比例）后 AI 开始纠偏；
    // aiWanderChance = 跟 AI 打破整齐交替（重复同侧）开始飘的基础概率，按 (1-难度) 缩放。
    aiCorrectHeadingRatio: 0.3,
    aiWanderChance: 0.5,

    // Pool-wall clearance (metres) kept between the swimmer root and the pool's
    // side walls when clamping the lateral offset.
    // 横向钳制时，泳者根节点与泳池侧壁之间保留的余量（米）。
    poolWallClearance: 0.4,

    // Use the behind-the-swimmer sprint chase camera for the surface-swim phase
    // so the weaving reads clearly. Not a slider (boolean).
    // 游泳推进段是否使用背后跟拍的冲刺视角，让蛇形一目了然。（布尔，不是滑块）
    useSprintSwimView: true,
};
