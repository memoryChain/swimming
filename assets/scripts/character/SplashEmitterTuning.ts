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
    role: 'hand' | 'leg';
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

    // Runtime particle alpha, 0-255. Lower values make droplets softer.
    // 运行时粒子透明度，范围 0-255；数值越低水滴越柔和。
    particleAlpha: 185,

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
        // Particle capacity per emitter.
        // 每个发射器的粒子容量。
        capacity: 120,

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
        startRotationZ: 0,
        startDelay: 0,
        handGravity: 2.25,
        legGravity: 0.55,
        rateOverTime: 0,
        rateOverDistance: 0,

        // Local X Euler for Cocos cone particles. Cocos cone emits along local -Z.
        // Cocos 圆锥粒子的本地 X 欧拉角；Cocos cone 默认沿本地 -Z 发射。
        emitterEulerX: 90,

        // Shape module enum values used by Cocos ParticleSystem.
        // Cocos 粒子 ShapeModule 使用的枚举值。
        coneShapeType: 2,
        emitFromBase: 0,

        // Cone emitter settings for hand and leg particles.
        // 手部和腿部粒子圆锥发射器设置。
        handShapeAngle: 58,
        legShapeAngle: 24,
        handShapeRadius: 0.055,
        legShapeRadius: 0.035,
        shapeArc: 360,
        handRandomDirection: 0,
        legRandomDirection: 0.18,
        handRandomPosition: 0.035,
        legRandomPosition: 0.02,
        handSphericalDirection: 0.1,
        legSphericalDirection: 0.03,

        // Lifetime alpha fade: particles stay visible, then fade before impact.
        // 生命周期透明度淡出：粒子先保持可见，接近落水时淡出。
        fadeHoldAlpha: 0.92,
        fadeHoldTime: 0.58,
        fadeEndAlpha: 0,

        // Size-over-lifetime curve. Starts fuller, shrinks near disappearance.
        // 生命周期尺寸曲线：出生时略大，消失前缩小。
        sizeOverLifetime: [
            [0, 1.18],
            [0.55, 0.92],
            [1, 0.16],
        ] as const,
    },

    particleTexture: {
        // Runtime droplet texture size. Small to keep memory and upload cheap.
        // 运行时水滴贴图大小；保持较小以节省内存和上传成本。
        size: 16,
        coreRadius: 0.28,
        highlightRadius: 0.42,
        highlightAlphaScale: 0.72,
    },

    particleEmitters: {
        // Side lane offsets for left/right hand and lower-leg emitters.
        // 左右手和左右小腿发射器的侧向偏移。
        leftHandZ: -0.38,
        rightHandZ: 0.38,
        leftLegZ: -0.24,
        rightLegZ: 0.24,

        // Hand emitter cluster. Tune palmOffset[1] to change emission height.
        // 手部发射器组；调 palmOffset[1] 可以改变发射高度。
        handCluster: [
            {
                nameSuffix: 'Core',
                role: 'hand',
                sideOffsetZ: 0,
                basePosition: [0.46, 0.08, 0],
                palmOffset: [0.1, 0.06, 0],
                forwardTilt: -6,
                lateralTilt: 0,
                countScale: 0.28,
            },
            {
                nameSuffix: 'Inner',
                role: 'hand',
                sideOffsetZ: -0.055,
                basePosition: [0.49, 0.075, 0],
                palmOffset: [0.12, 0.055, -0.055],
                forwardTilt: -12,
                lateralTilt: -13,
                countScale: 0.2,
            },
            {
                nameSuffix: 'Outer',
                role: 'hand',
                sideOffsetZ: 0.07,
                basePosition: [0.51, 0.085, 0],
                palmOffset: [0.13, 0.065, 0.07],
                forwardTilt: 10,
                lateralTilt: 18,
                countScale: 0.2,
            },
            {
                nameSuffix: 'Mist',
                role: 'hand',
                sideOffsetZ: 0.025,
                basePosition: [0.43, 0.11, 0],
                palmOffset: [0.06, 0.08, 0.025],
                forwardTilt: 16,
                lateralTilt: 8,
                countScale: 0.12,
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
            forwardTilt: 90,
            lateralTilt: 4,
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
        handBurstCountMin: 30,
        handBurstCountMax: 86,
        handBurstExtraCount: 18,
        handBurstCountClampMin: 20,
        handBurstCountClampMax: 104,
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
        legSignalMax: 0.9,
        legEmitThreshold: 0.28,
        legBurstCountMin: 4,
        legBurstCountMax: 13,
        legBurstSpeedScale: 0.46,
        legBurstPullScale: 0.34,
        legCooldownMin: 0.095,
        legCooldownMax: 0.18,

        // Particle burst physics and size ranges.
        // 粒子爆发的速度、生命周期和尺寸范围。
        handSpeedMin: 1.7,
        handSpeedMax: 3.0,
        legSpeedMin: 0.45,
        legSpeedMax: 1.15,
        speedRangeMinScale: 0.58,
        speedRangeMaxScale: 1.08,
        handLifetimeMin: 0.15,
        handLifetimeMaxLowSpeed: 0.24,
        handLifetimeMaxHighSpeed: 0.32,
        legLifetimeMin: 0.1,
        legLifetimeMaxLowSpeed: 0.18,
        legLifetimeMaxHighSpeed: 0.26,
        handSizeMin: 0.045,
        handSizeMax: 0.085,
        legSizeMin: 0.025,
        legSizeMax: 0.045,
        sizeRangeMinScale: 0.55,
        sizeRangeMaxScale: 1.12,
        minimumScaledCount: 10,
        handSpraySeconds: 0.085,
        legSpraySeconds: 0.045,
        initialEmitScale: 0.22,
        handInitialEmitMin: 4,
        legInitialEmitMin: 2,
        burstCooldownMin: 0.018,
        burstCooldownMax: 0.04,
        keepAliveMin: 0.36,
        keepAliveMax: 0.58,

        // Frame spray accumulation and per-particle jitter.
        // 连续发射累计与单粒子抖动。
        minSprayDt: 1 / 240,
        maxSprayDt: 1 / 20,
        handJitterX: 0.055,
        handJitterY: 0.018,
        handJitterZ: 0.075,
        legJitterX: 0.035,
        legJitterY: 0.006,
        legJitterZ: 0.04,
        baseJitterYDown: -0.006,
        handRotationJitterX: 10,
        handRotationJitterY: 18,
        handRotationJitterZ: 24,
        legRotationJitterX: 4,
        legRotationJitterY: 7,
        legRotationJitterZ: 8,

        // A small part of hand droplets splashes forward for a natural look.
        // 少量手部水滴向前飞溅，让效果更自然。
        forwardSplashChance: 0.18,
        forwardOffsetMin: 0.018,
        forwardOffsetMax: 0.052,
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
