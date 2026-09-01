// 赛中「海豚跃」(dolphin jump) 参数配置。
//
// 玩法：双手（左右屏幕各一指）同时长按触发，角色先短暂潜入水面蓄势，再像海豚一样
// 夸张地跃出水面、划出一条抛物线（空中无阻力、无视碰撞），最后扎回水里、下潜一小段
// 再上浮恢复正常游泳。
//
// 空中默认不带任何身体轴向旋转（转体）。腾空期间每次划水输入会：播放和水里一样的
// 划水动作 + 叠加一次整圈的轴向转体（左手一个方向、右手反方向），划得越多转得越快；
// 落水后残余的转体会自动回正到正常游泳姿态。
//
// 注：本文件是「代码默认值」，运行时以 assets/resources/config/tuning.json 的保存值为准
// （调参面板「海豚跃」组可实时调整并保存）。
export const DOLPHIN_JUMP = {
    // 触发手势：左右两半屏幕需要同时按住至少这么久才触发海豚跃（用于和普通的双手划水
    // 长按区分开）。单位：秒。调小 = 更容易触发；调大 = 需要按更久。
    triggerHoldSeconds: 0.25,
    // 临界保护：距离前方折返墙或终点不足这么多米时，不允许起跳（防止飞出去/越过墙）。
    // 单位：米。
    minAvailableDistance: 3,
    // 落点安全余量：整套动作的落点至少要停在墙/终点之前这么多米。单位：米。
    endMargin: 0.0,

    // —— 起跳前的下潜蓄势（海豚式钻水）——
    // 下潜阶段的持续时间。单位：秒。
    dipSeconds: 0.3,
    // 下潜到水面以下的深度。单位：米。越大钻得越深。
    dipDepth: 0.5,
    // 下潜时身体低头俯冲的最大角度。单位：度。
    dipTiltDegrees: 24,

    // —— 空中抛物线 —— 靠近池壁时水平速度会被自动收窄，保证落点在池内；空中不施加阻力。
    // 离水弹射速度基准：越大飞得越远、越夸张。单位：米/秒。
    // 注：这是「基准值」。玩家实际弹射速度会按角色「爆发力」(burst) + 等级缩放
    //（复用跳水的养成比例 diveMaxLaunchSpeed / 基准），爆发力越高飞得越远；AI 用基准值。
    launchSpeed: 8.0,
    // 起跳角度：抛物线仰角。单位：度。越大越高越短，越小越平越远。
    launchAngleDegrees: 40,
    // 空中重力：越小滞空越久、飞得越夸张。单位：米/秒²。
    gravity: 12.0,

    // —— 空中输入驱动的轴向转体（转体只影响表现，不影响速度）——
    // 每次划水输入产生的转体角度：左手一个方向、右手反方向。单位：度（360 = 一整圈）。
    rollPerStrokeDegrees: 360,
    // 转体跟随速度：当前转角向「累计目标角度」追赶的快慢，越大转得越快、越跟手。
    // 快速连划会让目标角度叠加、从而转得更快（螺旋感更强）。
    rollEaseRate: 7,
    // 落水后把残余转体拉回正常游泳姿态（人体轴回正）所用的时间。单位：秒。
    landingRollUnwindSeconds: 0.45,

    // —— 落水后的下潜上浮 —— 入水后下潜到设定深度、停顿、再上浮，随后恢复正常游泳。
    // 落水下潜的目标深度。单位：米。
    landingDepth: 0.7,
    // 从水面下潜到目标深度所用的时间。单位：秒。
    landingDescentSeconds: 0.25,
    // 在最深处停留（滑行）的时间。单位：秒。
    landingHoldSeconds: 0.3,
    // 从最深处上浮回水面所用的时间。单位：秒。
    landingRiseSeconds: 0.5,
    // 上浮阶段身体抬头的最大角度。单位：度。
    landingRiseTiltDegrees: 16,

    // —— 水花大小 —— 数值越大水花越大越多越夸张。
    // 起跳前钻水时的水花（普通爆发）。
    dipSplashScale: 1.2,
    // 冲出水面（出水）时的大水花羽流。
    takeoffSplashScale: 2.6,
    // 扎回水里（落水）时的大水花羽流。
    landingSplashScale: 3.2,

    // 成功发动海豚跃时一次性增加的心率，封顶 200；不消耗普通体力。
    strainHr: 25,

    // —— 双形态判定：出水跃 / 深潜跃 ——
    // 角度使用角色头部相对水面的实际朝下角，而不是未经折返的欧拉角。
    jumpStableDownAngleDegrees: 30,
    diveStableDownAngleDegrees: 50,
    transitionDownAngleDegrees: 40,
    posturePredictionSeconds: 0.12,

    // —— 深潜跃标准轨迹（破浪新星）——
    // 深潜水平距离由同角色标准出水距离乘此比例，再乘 arcDistanceScale。
    diveDistanceRatio: 0.72,
    diveBaseDepth: 1.1,
    diveBaseDurationSeconds: 1.05,
    // 0..1：整段潜航的这个时刻到达最深点；小于 0.5 表示快速钻水、缓慢上浮。
    diveBottomTimeRatio: 0.42,
    // 离开正常水面游泳层后才免碰撞；上浮用更浅阈值恢复，形成稳定滞回。
    collisionDisableDepth: 0.35,
    collisionRestoreDepth: 0.20,

    // 触发前碰撞姿态/动量的受控继承。角度完整保留，速度按倍率继承并逐渐对齐轨迹。
    impactVelocityCarryScale: 0.50,
    impactAlignSeconds: 0.25,
    impactMaxAngularSpeedDegrees: 220,
    // Pure-presentation loose-limb carry. Existing collision folding is inherited,
    // then a small deterministic airflow layer keeps otherwise-clean launches from
    // becoming a perfectly rigid streamline. Recovery starts only after surfacing.
    ragdollCarryScale: 0.80,
    ragdollAirWeight: 0.22,
    ragdollWindScale: 0.65,
    ragdollRecoverySeconds: 0.80,
    // 允许侧偏和推进受损，但不允许脚本轨迹沿赛道倒退。
    minimumForwardSpeed: 0.1,
};

export type DolphinAbilityMode = 'jump' | 'dive';

// Compact outcome-affecting state captured when an authoritative dolphin action
// starts. Network replicas restore this exact state before replaying the accepted
// action so local prediction drift cannot change the route or reject it near a wall.
export interface DolphinJumpStartState {
    distance: number;
    lateral: number;
    heading: number;
    headingVelocity: number;
    speed: number;
    axialRoll: number;
    axialRollVelocity: number;
    collisionPitch: number;
    collisionPitchVelocity: number;
    knockbackDistance: number;
    knockbackLateral: number;
}

const RAD2DEG = 180 / Math.PI;

// Signed angle of the swimmer's head direction relative to the water surface.
// Positive means head-down, negative means head-up. asin(sin(pitch)) folds a full
// somersault back onto the actual vertical component, so -140° reads as 40° down
// instead of an impossible 140° dive angle.
export function dolphinHeadDownAngleDegrees(pitchRadians: number): number {
    const pitch = Number.isFinite(pitchRadians) ? pitchRadians : 0;
    return -Math.asin(Math.max(-1, Math.min(1, Math.sin(pitch)))) * RAD2DEG;
}

export function resolveDolphinAbilityMode(
    pitchRadians: number,
    pitchVelocityRadians: number,
): DolphinAbilityMode {
    const down = dolphinHeadDownAngleDegrees(pitchRadians);
    if (down >= DOLPHIN_JUMP.diveStableDownAngleDegrees) {
        return 'dive';
    }
    if (down <= DOLPHIN_JUMP.jumpStableDownAngleDegrees) {
        return 'jump';
    }
    const velocity = Number.isFinite(pitchVelocityRadians) ? pitchVelocityRadians : 0;
    const predicted = dolphinHeadDownAngleDegrees(
        pitchRadians + velocity * Math.max(0, DOLPHIN_JUMP.posturePredictionSeconds),
    );
    return predicted >= DOLPHIN_JUMP.transitionDownAngleDegrees ? 'dive' : 'jump';
}

// Per-character dolphin-jump identity. These are mutable on purpose: the debug
// tuning panel edits the shared objects in place so existing swimmers immediately
// pick up charge changes and the next jump uses the updated trajectory.
export type DolphinJumpProfileId = 'muscleMan' | 'women2' | 'lowPolyHuman2' | 'diver';

export type DolphinJumpProfile = {
    // Final charge-gain multiplier relative to the balanced character. This
    // replaces (rather than stacks with) the legacy energy-aptitude conversion.
    chargeGainScale: number;
    // Designer-facing result multipliers. The phase controller derives velocity
    // and angle from the requested apex height + air distance.
    arcHeightScale: number;
    arcDistanceScale: number;
    gravityScale: number;
    // Underwater re-entry identity, independent from near-wall fit compression.
    landingSpeedScale: number;
    landingDepthScale: number;
    landingDurationScale: number;
};

export const DOLPHIN_JUMP_PROFILES: Record<DolphinJumpProfileId, DolphinJumpProfile> = {
    // 铁臂狂鲨：低频、高远、重落水。
    muscleMan: {
        chargeGainScale: 0.72,
        arcHeightScale: 1.50,
        arcDistanceScale: 1.38,
        gravityScale: 1.05,
        landingSpeedScale: 1.05,
        landingDepthScale: 1.20,
        landingDurationScale: 1.15,
    },
    // 灵波飞鱼：高频、低平、快速回到游泳。
    women2: {
        chargeGainScale: 1.30,
        arcHeightScale: 0.62,
        arcDistanceScale: 0.78,
        gravityScale: 1.12,
        landingSpeedScale: 1.00,
        landingDepthScale: 0.70,
        landingDurationScale: 0.72,
    },
    // 破浪新星：三角色差异化的标准抛物线。
    lowPolyHuman2: {
        chargeGainScale: 1.00,
        arcHeightScale: 1.00,
        arcDistanceScale: 1.00,
        gravityScale: 1.00,
        landingSpeedScale: 1.00,
        landingDepthScale: 1.00,
        landingDurationScale: 1.00,
    },
    // 深海潜将尚未定型，暂时保持标准值且使用独立对象，方便后续单独调整。
    diver: {
        chargeGainScale: 1.00,
        arcHeightScale: 1.00,
        arcDistanceScale: 1.00,
        gravityScale: 1.00,
        landingSpeedScale: 1.00,
        landingDepthScale: 1.00,
        landingDurationScale: 1.00,
    },
};

export function getDolphinJumpProfile(characterId: string | null | undefined): DolphinJumpProfile {
    if (characterId && Object.prototype.hasOwnProperty.call(DOLPHIN_JUMP_PROFILES, characterId)) {
        return DOLPHIN_JUMP_PROFILES[characterId as DolphinJumpProfileId];
    }
    return DOLPHIN_JUMP_PROFILES.lowPolyHuman2;
}
