export type SplashVec3 = readonly [number, number, number];

export type SplashFoamPartTuning = {
    name: string;
    basePosition: SplashVec3;
    baseEuler: SplashVec3;
    baseScale: SplashVec3;
    speedWeight: number;
    armWeight: number;
    kickWeight: number;
    burstWeight: number;
    width: number;
    length: number;
    flowStrength: number;
    trailStrength: number;
};

export type SplashParticleEmitterTuning = {
    nameSuffix: string;
    role: 'hand' | 'leg' | 'body';
    sideOffsetZ: number;
    basePosition: SplashVec3;
    palmOffset: SplashVec3;
    forwardTilt: number;
    lateralTilt: number;
    countScale: number;
};

export const SPLASH_EMITTER_TUNING = {
    // Highest renderer priority so splashes draw after transparent water.
    // 最高渲染优先级，确保水花绘制在透明水面之后。
    renderPriority: 255,

    // Runtime particle alpha, 0-255. Translucent so streaks read as water spray, not solid white.
    // 运行时粒子透明度，范围 0-255；偏透使水条读作水花飞溅，而非实白。
    particleAlpha: 120,

    // Maximum swim speed used to normalize splash intensity.
    // 用于归一化水花强度的最大游泳速度。
    speedNormalize: 3.2,

    // Fallback delta time before the first real update.
    // 第一次真实 update 到来前使用的备用帧间隔。
    initialDt: 1 / 60,

    // Speed sample used when a manual splash burst is triggered.
    // 手动触发水花爆发时用于刷新效果的速度采样。
    triggerBurstUpdateSpeed: 0.8,

    // Random seed range sent to the splash foam shader.
    // 传给水面泡沫 shader 的随机种子范围。
    foamSeedRange: 20,

    burst: {
        // Arm stroke burst strength injected when a stroke is triggered.
        // 手臂划水触发时注入的水花爆发强度。
        armStroke: 1.15,

        // Kick burst strength injected when a kick is triggered.
        // 打腿触发时注入的水花爆发强度。
        kick: 1.25,

        // Generic splash strength added by arm and kick triggers.
        // 手臂/打腿触发时叠加的通用水花强度。
        armGeneric: 1,
        kickGeneric: 0.65,

        // Burst decay rates per second.
        // 每秒衰减速度。
        genericDecay: 2.8,
        armDecay: 3.2,
        kickDecay: 3.8,

        // Generic burst split when triggerBurst(scale) is used.
        // triggerBurst(scale) 调用时拆分到手臂/腿部的比例。
        armScale: 0.85,
        kickScale: 0.7,
    },

    foam: {
        // Surface foam mesh segmentation. Keep low for WeChat Mini Game.
        // 水面泡沫网格细分；微信小游戏保持较低。
        widthSegments: 4,
        lengthSegments: 2,

        // Hand and foot foam activation thresholds.
        // 手部和脚部泡沫显示阈值。
        handContactThreshold: 0.08,
        actionThreshold: 0.04,
        burstThreshold: 0.04,

        // Intensity clamp sent to the foam shader.
        // 传入泡沫 shader 的强度上限。
        maxIntensity: 2.4,

        // Scale multipliers for surface foam when moving fast or bursting.
        // 高速移动或爆发时水面泡沫的缩放倍率。
        speedScaleX: 0.28,
        surgeScaleX: 0.55,
        surgeScaleZ: 0.58,
        footBoost: 1.14,

        // Surface foam action weights.
        // 水面泡沫动作强度权重。
        handSpeedActionWeight: 0.35,
        handGenericBurstWeight: 0.18,
        handArmBurstWeight: 0.7,
        footGenericBurstWeight: 0.45,
        footArmBurstWeight: 0.5,
        footKickBurstWeight: 0.5,
        footSpeedMotionWeight: 0.42,
        footKickMotionWeight: 0.58,
        handSpeedMotionWeight: 0.08,
        handArmMotionWeight: 0.72,
        otherSpeedMotionWeight: 0.16,
        handBurstGenericWeight: 0.28,
        handArmCycleBurstWeight: 0.45,

        // Small vertical lift for foam during burst.
        // 爆发时泡沫片的轻微上抬。
        surgeYOffset: 0.004,

        // Foam position lead/trail values relative to body and bones.
        // 泡沫相对身体和骨骼的前后位置偏移。
        footBoneSpeedBack: 0.34,
        bodySpeedBack: 0.08,
        fallbackBaseSpeedBack: 0.14,
        fallbackFootExtraBack: 0.26,
        handStrokeXFront: 0.78,
        handStrokeXBack: 0.28,
        handSpeedBack: 0.08,

        // Surface foam definitions. Z is mirrored by separate left/right entries where needed.
        // 水面泡沫定义；需要左右区分时直接配置不同 Z。
        parts: [
            {
                name: 'LeftHandFoam',
                basePosition: [0.28, 0.004, -0.38],
                baseEuler: [0, 0, -8],
                baseScale: [0.42, 1, 0.32],
                speedWeight: 0.3,
                armWeight: 1.35,
                kickWeight: 0.04,
                burstWeight: 0.95,
                width: 0.82,
                length: 0.68,
                flowStrength: 0.18,
                trailStrength: 0.45,
            },
            {
                name: 'RightHandFoam',
                basePosition: [0.28, 0.004, 0.38],
                baseEuler: [0, 0, 8],
                baseScale: [0.42, 1, 0.32],
                speedWeight: 0.3,
                armWeight: 1.35,
                kickWeight: 0.04,
                burstWeight: 0.95,
                width: 0.82,
                length: 0.68,
                flowStrength: 0.18,
                trailStrength: 0.45,
            },
            {
                name: 'FootFoam',
                basePosition: [-0.94, 0.005, 0],
                baseEuler: [0, 0, 0],
                baseScale: [0.72, 1, 0.48],
                speedWeight: 0.85,
                armWeight: 0.04,
                kickWeight: 1.65,
                burstWeight: 1,
                width: 1.34,
                length: 0.78,
                flowStrength: 1,
                trailStrength: 1,
            },
        ] satisfies SplashFoamPartTuning[],
    },

    particleSystem: {
        // Particle capacity per emitter. Fewer, bigger cartoon clumps need far less capacity.
        // 每个发射器的粒子容量；更少、更大的卡通团块需要的容量小得多。
        capacity: 56,

        // Particle system playback duration; emissions are manual bursts.
        // 粒子系统播放时长；实际发射由代码手动 burst 控制。
        duration: 1,

        // Local-space simulation keeps particles attached to each swimmer.
        // 本地空间模拟，让粒子跟随各自运动员节点。
        simulationSpace: 0,
        simulationSpeed: 1,

        // Expanded bounds to avoid Cocos culling short-lived splash particles.
        // 扩大包围盒，避免 Cocos 裁掉短生命周期水花。
        aabbHalfX: 2.2,
        aabbHalfY: 2.0,
        aabbHalfZ: 2.2,

        // Default values before role-specific burst tuning is applied.
        // 角色特定 burst 参数生效前的默认粒子值。
        defaultLifetime: [0.22, 0.4] as const,
        defaultSpeed: [1.7, 3.1] as const,
        defaultSize: [0.04, 0.085] as const,
        startRotationZMin: 0,
        startRotationZMax: 6.2831853,
        startDelay: 0,
        handGravity: 1.4,
        legGravity: 0.5,
        rateOverTime: 0,
        rateOverDistance: 0,

        // Local X Euler for Cocos cone particles. Cocos cone emits along local -Z.
        // Cocos 圆锥粒子的本地 X 欧拉角；Cocos cone 默认沿本地 -Z 发射。
        emitterEulerX: 90,

        // Shape module enum values used by Cocos ParticleSystem.
        // Cocos 粒子 ShapeModule 使用的枚举值。
        coneShapeType: 2,
        emitFromBase: 0,

        // Wider cone so droplets spray outward/sideways in a fan, not a narrow upward column.
        // 更宽的圆锥，让水滴向外/侧向扭开成扇形，而非窄窄向上的柱。
        handShapeAngle: 78,
        legShapeAngle: 34,
        handShapeRadius: 0.055,
        legShapeRadius: 0.035,
        shapeArc: 360,
        handRandomDirection: 0,
        legRandomDirection: 0.18,
        handRandomPosition: 0.035,
        legRandomPosition: 0.02,
        handSphericalDirection: 0.1,
        legSphericalDirection: 0.03,

        // Stretched-billboard renderer: slight elongation along velocity. Keep low so droplets stay
        // dabs, not long flame-like tongues.
        // 拉伸广告牌渲染：沿速度方向轻微拉长。保持较低，让水滴是短块而非火苗长舔。
        stretchedRenderMode: 1,
        stretchVelocityScale: 0.018,
        stretchLengthScale: 0.12,

        // Lifetime alpha fade: hold visible, then fade out near end of life.
        // 生命周期透明度：先保持可见，接近生命末尾淡出。
        fadeHoldAlpha: 1,
        fadeHoldTime: 0.4,
        fadeEndAlpha: 0,

        // Size-over-lifetime curve: pop full, then shrink/thin as the droplet falls.
        // 生命周期尺寸曲线：先饱满弹出，随水滴下落再缩小变细。
        sizeOverLifetime: [
            [0, 1],
            [0.6, 0.9],
            [1, 0.3],
        ] as const,
    },

    dropletTexture: {
        // Soft round droplet sprite. Stretched billboard turns it into a water streak at runtime.
        // 柔和圆形水滴贴图；拉伸广告牌在运行时把它变成水条。
        size: 32,
        // Gaussian body softness (smaller = softer/wider).
        // 高斯主体柔度（越小越柔越宽）。
        softness: 3.2,
        // Bright tight core for a wet highlight.
        // 明亮紧致的核心，形成湿润高光。
        coreBoost: 0.32,
        coreSoftness: 12,
        // Safety feather so alpha reaches zero before the border.
        // 安全羽化，确保 alpha 在边界前归零。
        featherStart: 0.5,
    },

    particleEmitters: {
        // Side lane offsets for left/right hand, lower-leg and body emitters.
        // 左右手、左右小腿和身体发射器的侧向偏移。
        leftHandZ: -0.38,
        rightHandZ: 0.38,
        leftLegZ: -0.24,
        rightLegZ: 0.24,
        leftBodyZ: -0.26,
        rightBodyZ: 0.26,

        // Hand emitter cluster. Tune palmOffset[1] to change emission height.
        // Kept to 3 emitters per hand for WeChat: fewer particle systems and less overdraw.
        // 手部发射器组；调 palmOffset[1] 可以改变发射高度。
        // 微信小游戏下每只手保留 3 个发射器：更少粒子系统、更少透明叠绘。
        handCluster: [
            {
                nameSuffix: 'Core',
                role: 'hand',
                sideOffsetZ: 0,
                basePosition: [0.46, 0.08, 0],
                palmOffset: [0.1, -0.06, 0],
                forwardTilt: -6,
                lateralTilt: 0,
                countScale: 0.34,
            },
            {
                nameSuffix: 'Inner',
                role: 'hand',
                sideOffsetZ: -0.055,
                basePosition: [0.49, 0.075, 0],
                palmOffset: [0.12, -0.055, -0.055],
                forwardTilt: -12,
                lateralTilt: -13,
                countScale: 0.22,
            },
            {
                nameSuffix: 'Outer',
                role: 'hand',
                sideOffsetZ: 0.07,
                basePosition: [0.51, 0.085, 0],
                palmOffset: [0.13, -0.065, 0.07],
                forwardTilt: 10,
                lateralTilt: 18,
                countScale: 0.22,
            },
        ] satisfies SplashParticleEmitterTuning[],

        // Lower-leg emitter. Tune palmOffset[1] to change kick splash height.
        // 小腿发射器；调 palmOffset[1] 可以改变打腿水花高度。
        leg: {
            nameSuffix: '',
            role: 'leg',
            sideOffsetZ: 0,
            basePosition: [-0.72, 0.018, 0],
            palmOffset: [-0.1, 0.012, 0.035],
            forwardTilt: 10,
            lateralTilt: 4,
            countScale: 0.24,
        } satisfies SplashParticleEmitterTuning,

        // Body emitter: ambient foam churn alongside the torso, positioned near mid-body at water level.
        // Follows the 'Body' bone (torso). palmOffset[2] is mirrored per side.
        // 身体发射器：躯干两侧的环境泡沫翻涌，位于身体中段水面处；跟随 'Body'（躯干）骨骼，palmOffset[2] 按左右镜像。
        body: {
            nameSuffix: '',
            role: 'body',
            sideOffsetZ: 0,
            basePosition: [-0.1, 0.012, 0],
            palmOffset: [-0.05, -0.01, 0.06],
            forwardTilt: 0,
            lateralTilt: 12,
            countScale: 0.12,
        } satisfies SplashParticleEmitterTuning,
    },

    behavior: {
        // Hand splash entry and burst thresholds.
        // 手部水花入水和爆发阈值。
        handEntryThreshold: 0.28,
        handLastContactThreshold: 0.14,
        handProgressWindow: 0.26,
        handEntryScaleMin: 0.9,
        handEntryScaleMax: 1.18,
        handBurstCountMin: 8,
        handBurstCountMax: 20,
        handBurstExtraCount: 5,
        handBurstCountClampMin: 6,
        handBurstCountClampMax: 26,
        handBurstArmWeight: 0.75,
        handBurstGenericWeight: 0.35,

        // Leg splash only appears near water surface.
        // 腿部水花只在接近水面时出现。
        legSurfaceContactThreshold: 0.04,
        legSurfaceMaxDepth: 0.2,
        legSurfaceMaxAbove: -0.12,
        legSurfaceSoftStart: 0.025,
        legSurfaceSoftEnd: 0.2,
        legSurfaceYBlend: 0.72,
        legSignalSpeedWeight: 0.2,
        legSignalCycleWeight: 0.42,
        legSignalActionWeight: 0.18,
        legSignalBurstWeight: 0.12,
        legSignalMax: 0.95,
        legEmitThreshold: 0.24,
        legPulseThreshold: 0.3,
        legBurstCountMin: 7,
        legBurstCountMax: 18,
        legBurstSpeedScale: 0.5,
        legBurstPullScale: 1.0,
        legCooldownMin: 0.06,
        legCooldownMax: 0.14,

        // Body splash: continuous low churn alongside the torso, scaled by speed.
        // 身体水花：躯干两侧随速度增强的持续低量翻涌。
        bodySignalSpeedWeight: 0.85,
        bodySignalCycleWeight: 0.35,
        bodySignalBurstWeight: 0.18,
        bodySignalMax: 0.9,
        bodyEmitThreshold: 0.16,
        bodyPulseThreshold: 0.3,
        bodyBurstCountMin: 3,
        bodyBurstCountMax: 8,
        bodyBurstSpeedScale: 0.42,
        bodyBurstPullScale: 0.82,
        bodyCooldownMin: 0.05,
        bodyCooldownMax: 0.12,
        bodySpeedBack: 0.12,

        // Particle burst physics and size ranges.
        // 粒子爆发的速度、生命周期和尺寸范围。
        handSpeedMin: 1.8,
        handSpeedMax: 3.2,
        legSpeedMin: 1.7,
        legSpeedMax: 3.0,
        speedRangeMinScale: 0.58,
        speedRangeMaxScale: 1.08,
        handLifetimeMin: 0.24,
        handLifetimeMaxLowSpeed: 0.36,
        handLifetimeMaxHighSpeed: 0.46,
        legLifetimeMin: 0.22,
        legLifetimeMaxLowSpeed: 0.32,
        legLifetimeMaxHighSpeed: 0.42,
        handSizeMin: 0.12,
        handSizeMax: 0.22,
        legSizeMin: 0.16,
        legSizeMax: 0.28,
        sizeRangeMinScale: 0.82,
        sizeRangeMaxScale: 1.14,
        minimumScaledCount: 3,
        handSpraySeconds: 0.03,
        legSpraySeconds: 0.02,
        initialEmitScale: 0.72,
        handInitialEmitMin: 3,
        legInitialEmitMin: 1,
        burstCooldownMin: 0.018,
        burstCooldownMax: 0.04,
        keepAliveMin: 0.24,
        keepAliveMax: 0.36,

        // Frame spray accumulation and per-particle jitter.
        // 连续发射累计与单粒子抖动。
        minSprayDt: 1 / 240,
        maxSprayDt: 1 / 20,
        handJitterX: 0.04,
        handJitterY: 0.014,
        handJitterZ: 0.05,
        legJitterX: 0.026,
        legJitterY: 0.006,
        legJitterZ: 0.03,
        baseJitterYDown: -0.006,
        handRotationJitterX: 10,
        handRotationJitterY: 18,
        handRotationJitterZ: 24,
        legRotationJitterX: 4,
        legRotationJitterY: 7,
        legRotationJitterZ: 8,

        // A small part of hand droplets splashes forward for a natural look.
        // 少量手部水滴向前飞溅，让效果更自然。
        forwardSplashChance: 0.28,
        forwardOffsetMin: 0.018,
        forwardOffsetMax: 0.152,
        forwardTurnMin: 118,
        forwardTurnMax: 164,

        // Bone-following offsets.
        // 跟随骨骼时的偏移。
        boneSpeedLead: 0.03,
        fallbackForwardReach: 0.96,
        fallbackBackReach: 0.78,
        fallbackSpeedLead: 0.08,
    },
} as const;
