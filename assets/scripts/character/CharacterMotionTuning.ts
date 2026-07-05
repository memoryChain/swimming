/**
 * Character motion presentation tuning.
 * 人物动作表现调参集中区。
 *
 * These values only control visual pose, model placement, and transition feel.
 * 这些数值只控制人物姿态、模型摆位和动作过渡观感。
 *
 * Gameplay physics values such as race speed, dive distance, and stroke scoring
 * should stay in GameBalance/InputTuning.
 * 比赛速度、跳水距离、划水评分等玩法数值仍应放在 GameBalance/InputTuning。
 */

export const CHARACTER_POSE_TUNING = {
    // Default model scale applied to runtime swimmer GLB.
    // 运行时泳手 GLB 的默认模型缩放。
    modelScale: 1.35,

    // Model root Y offset while swimming in race pose.
    // 比赛游泳姿态下模型根节点的基础 Y 偏移。
    raceModelBaseY: 0.18,

    // Fallback water height used before the venue provides a water surface Y.
    // 场馆水面高度尚未传入前使用的默认水面高度。
    splashWaterY: 0.408,

    // Default seconds for blending from dive-prep pose into streamline/glide.
    // 从跳水预备姿态过渡到流线型/滑行姿态的默认时长。
    diveStreamlineTransitionSeconds: 0.22,

    // Backward local X offset for the model while standing on the start block.
    // 跳台预备姿态下模型在本地 X 方向向后的偏移。
    divePrepModelBackOffset: -0.08,

    // Local Y offset for the model while standing on the start block.
    // 跳台预备姿态下模型本地 Y 高度。
    divePrepModelY: 0.44,

    // Model Euler rotation for the start-block dive-prep pose.
    // 跳台预备姿态下模型欧拉角。
    divePrepModelEuler: [0, 90, 0] as const,

    // Finish/tread-water model Y height at the wall.
    // 触壁后踩水/漂浮姿态的模型 Y 高度。
    finishFloatBaseY: -0.78,

    // Vertical bobbing amplitude while treading water after finish.
    // 完赛踩水时上下浮动幅度。
    finishFloatBobAmplitude: 0.018,

    // Vertical bobbing speed while treading water after finish.
    // 完赛踩水时上下浮动速度。
    finishFloatBobSpeed: 2.6,

    // Full procedural tread-water cycle duration before animation speed scaling.
    // 程序化踩水动作在动画倍率前的一整轮周期。
    finishTreadWaterCycleSeconds: 2.25,

    // Procedural breaststroke preview cycle duration before animation speed scaling.
    // Debug 预览里的程序化蛙泳/踩水动作在动画倍率前的一整轮周期。
    breaststrokePreviewCycleSeconds: 2.25,

    // At or below this race speed the swimmer blends toward the tread-water pose.
    // 比赛速度低于该值时，泳手向踩水姿态过渡。
    raceTreadEnterSpeed: 0.42,

    // At or above this race speed the swimmer blends back to freestyle. The gap
    // between enter/exit gives hysteresis so the pose does not flicker near the edge.
    // 比赛速度高于该值时，泳手切回自由泳。进入/退出阈值之间留出迟滞，避免临界抖动。
    raceTreadExitSpeed: 0.9,

    // Crossfade rate (weight units per second) between freestyle and tread-water.
    // 自由泳与踩水之间的过渡速率（每秒权重变化量），越大切换越快。
    raceTreadBlendRate: 2.6,

    // Full mid-race tread-water cycle duration before animation speed scaling.
    // 比赛途中踩水动作在动画倍率前的一整轮周期。
    raceTreadWaterCycleSeconds: 2.25,

    // Model root Y offset (added on top of raceModelBaseY) at full mid-race tread-water.
    // Matches the finish tread/breaststroke reference so the body sits at the right water height.
    // 比赛途中完全踩水时模型根节点在 raceModelBaseY 之上叠加的 Y 偏移。与完赛踩水/蛙泳参考一致，
    // 让身体停在正确的水面高度。
    raceTreadModelYOffset: -0.88,

    // Model Euler rotation at full mid-race tread-water (upright), blended from the prone race euler.
    // 比赛途中完全踩水时模型欧拉角（竖直），从俯卧的比赛欧拉角过渡而来。
    raceTreadModelEuler: [0, 90, 0] as const,

    // After any stroke input, keep targeting freestyle for this long so re-inputting always pulls the
    // swimmer out of tread-water immediately, even before race speed climbs back past the exit speed.
    // 任一次划水输入后，在这段时间内持续以自由泳为目标，让重新输入立即把泳手拉出踩水，无需等速度重新爬过退出阈值。
    raceTreadStrokeExitHoldSeconds: 0.6,
};

export const FREESTYLE_POSE_TUNING = {
    // Phase offset applied to arm cycles before solving arm pose.
    // 手臂相位进入姿态求解前的偏移量。
    armForwardCycleOffset: 0,

    // Default head pitch lift when a model variant does not override it.
    // 模型变体没有单独配置时使用的默认头部抬起角度。
    defaultSwimHeadLiftDegrees: -14,

    // Internal body roll amplitude for freestyle side-to-side motion.
    // 自由泳身体左右滚转的内部幅度。
    freestyleInternalBodyRollDegrees: 22,

    // Local side offset used to keep the body centered while rolling.
    // 身体滚转时用于保持轴线居中的本地侧向补偿。
    freestyleAxisCenteringOffset: 0.075,

    // Extra local side offset during right-side breathing to counter top-view drift.
    // 右侧换气/右手移臂时额外的本地侧向补偿，用来抵消俯视角下轴线偏移。
    freestyleRightBreathAxisCenteringOffset: -0.028,

    // Multiplier for head and neck twist during right-side breathing.
    // 右侧换气时头颈扭动的表现倍率，不影响身体轴线补偿。
    freestyleRightBreathHeadTurnScale: 1.45,

    // Forward body pitch used by the tread-water/breaststroke pose solver.
    // 踩水/蛙泳式姿态求解时身体前倾角度。
    treadWaterBodyForwardDegrees: 24,

    // Yaw correction for tread-water/breaststroke pose.
    // 踩水/蛙泳式姿态的偏航校正。
    treadWaterStraightenYawDegrees: 0,

    // Roll correction for tread-water/breaststroke pose.
    // 踩水/蛙泳式姿态的滚转校正。
    treadWaterStraightenRollDegrees: 0,

    // Extra arm reach applied on top of the sampled dive-prep pose.
    // 跳水预备采样姿态上额外叠加的手臂前伸角度。
    divePrepArmForwardDegrees: 7,
};

export const SWIMMER_ACTION_TUNING = {
    // Clearance from pool edge when placing the swimmer in finish float pose.
    // 完赛漂浮姿态距离池壁保留的安全距离。
    finishFloatPoolEdgeClearance: 0.55,

    // Minimum crouch duration for high-power dives.
    // 高质量跳水时较短的下蹲蓄势时长。
    diveCrouchSecondsMin: 0.18,

    // Maximum crouch duration for low-power dives.
    // 低质量跳水时较长的下蹲蓄势时长。
    diveCrouchSecondsMax: 0.26,

    // Ratio of flight time spent extending into streamline.
    // 腾空阶段中用于伸展到流线型姿态的时间占比。
    diveExtensionRatio: 0.52,

    // Portion of the dive pose transition that plays before the root leaves the block.
    diveLaunchDelayRatio: 0.25,

    // Start-block compression before launch.
    diveCrouchBackOffset: 0.1,
    diveCrouchDrop: 0.06,

    // Underwater visual depth at dive entry.
    // 入水瞬间角色视觉上沉入水下的深度。
    diveEntryDepth: 0.58,

    // Seconds to hold the underwater glide depth after dive entry.
    // 入水后保持水下滑行深度的时间。
    diveUnderwaterHoldSeconds: 2.0,

    // Seconds used to rise from underwater glide back to surface height.
    // 从水下滑行高度回升到水面高度的时间。
    diveUnderwaterRiseSeconds: 1.35,

    // Portion of the underwater hold used to straighten from the head-down entry
    // lean back to horizontal. Smaller values level the body out sooner.
    // 水下保持阶段中用于把入水斜下姿态拉回水平的时间占比，越小越早变水平。
    diveStraightenRatio: 0.35,

    // Peak head-up tilt (degrees) while the body ascends toward the surface.
    // 上浮阶段身体斜上抬头的最大角度。
    diveUnderwaterRiseTiltDegrees: 12,
};
