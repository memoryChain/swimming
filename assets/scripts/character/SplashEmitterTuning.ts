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
    visual: 'plume' | 'spray';
    sideOffsetZ: number;
    basePosition: SplashVec3;
    palmOffset: SplashVec3;
    forwardTilt: number;
    lateralTilt: number;
    countScale: number;
    sizeScale: number;
    heightScale: number;
};

export const SPLASH_EMITTER_TUNING = {
    // Splash particle art style switch:
    //   'streak' = soft round droplet stretched along velocity into thin water streaks.
    //   'blocky' = hard-edged square sprites, billboard (no stretch), spun by random rotation.
    // 水花粒子美术风格开关：
    //   'streak' = 柔和圆点沿速度拉伸成细长水条（当前）。
    //   'blocky' = 硬边方块贴图，普通广告牌（不拉伸），靠随机旋转呈现方块。
    style: 'streak' as 'streak' | 'blocky',

    // Highest renderer priority so splashes draw after transparent water.
    // 最高渲染优先级，确保水花绘制在透明水面之后。
    renderPriority: 255,

    // Runtime particle alpha, 0-255. Translucent so streaks read as water spray, not solid white.
    // 运行时粒子透明度，范围 0-255；偏透使水条读作水花飞溅，而非实白。
    particleAlpha: 182,
    plumeAlpha: 158,

    // Maximum swim speed used to normalize splash intensity.
    // 用于归一化水花强度的最大游泳速度。
    speedNormalize: 3.2,

    // Overall particle count scaling by swim speed. The multiplier ramps from
    // minScale to maxScale as speed crosses the arm-cycle speed window
    // [STROKE_QUALITY_TUNING.armCycleSpeedStart, STROKE_QUALITY_TUNING.armCycleSpeedFull],
    // clamped at both ends. This only changes how MANY particles each burst
    // emits — never when bursts trigger. Below the start speed the count stays
    // at minScale (few splashes); at/above the full speed it stays at maxScale
    // (most splashes).
    // 粒子数量随游泳速度整体缩放。倍率在手臂轮速的速度窗口
    // [STROKE_QUALITY_TUNING.armCycleSpeedStart, STROKE_QUALITY_TUNING.armCycleSpeedFull]
    // 内从 minScale 线性升到 maxScale，两端夹住。它只改变每次爆发发射多少粒子，
    // 绝不改变爆发的触发时机。低于起始速度恒为 minScale（水花少），
    // 达到顶速及以上恒为 maxScale（水花最多）。
    speedCountScale: {
        enabled: true,
        minScale: 0.2,
        maxScale: 1,
    },

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
        kick: 1.7,

        // Generic splash strength added by arm and kick triggers.
        // 手臂/打腿触发时叠加的通用水花强度。
        armGeneric: 1,
        kickGeneric: 0.72,

        // Burst decay rates per second.
        // 每秒衰减速度。
        genericDecay: 2.8,
        armDecay: 3.2,
        kickDecay: 3.1,

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
        // Particle capacity per emitter. Short-lived streaks stay sparse to contain CPU simulation
        // and transparent overdraw on WeChat Mini Game.
        // 每个发射器的粒子容量。细短水丝保持稀疏，控制微信小游戏的 CPU 模拟和透明叠绘。
        capacity: 32,

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
        defaultLifetime: [0.16, 0.3] as const,
        defaultSpeed: [2, 3.5] as const,
        defaultSize: [0.04, 0.09] as const,
        startRotationZMin: 0,
        startRotationZMax: 0,
        startDelay: 0,
        handGravity: 1.4,
        legGravity: 0.75,
        rateOverTime: 0,
        rateOverDistance: 0,

        // Local X Euler for Cocos cone particles. Cocos cone emits along local -Z.
        // Cocos 圆锥粒子的本地 X 欧拉角；Cocos cone 默认沿本地 -Z 发射。
        emitterEulerX: 90,

        // Shape module enum values used by Cocos ParticleSystem.
        // Cocos 粒子 ShapeModule 使用的枚举值。
        coneShapeType: 2,
        emitFromBase: 0,

        // A medium cone branches into a flame-like white spray without becoming a broad square cloud.
        // 中等圆锥角把水滴分成白色火焰般的细支，同时避免变成宽大的方块云团。
        handShapeAngle: 64,
        legShapeAngle: 32,
        handShapeRadius: 0.055,
        legShapeRadius: 0.07,
        shapeArc: 360,
        handRandomDirection: 0,
        legRandomDirection: 0,
        handRandomPosition: 0.035,
        legRandomPosition: 0.055,
        handSphericalDirection: 0.1,
        legSphericalDirection: 0,

        // Stretched-billboard renderer: elongate the small droplets along their velocity so each
        // particle reads as a fine white water filament from every camera angle.
        // 拉伸广告牌渲染：把小水滴沿速度拉长，使每颗粒子在任何相机角度都读作细白水丝。
        stretchedRenderMode: 1,
        stretchVelocityScale: 0.085,
        stretchLengthScale: 0.68,

        // Plain billboard render mode used by the 'blocky' style (no velocity stretch).
        // 'blocky' 风格使用的普通广告牌渲染模式（不做速度拉伸）。
        blockyRenderMode: 0,

        // Lifetime alpha fade: hold visible, then fade out near end of life.
        // 生命周期透明度：先保持可见，接近生命末尾淡出。
        fadeHoldAlpha: 1,
        fadeHoldTime: 0.4,
        fadeEndTime: 1,
        fadeEndAlpha: 0,
        waterlineLifetimeCap: 0.38,
        roleWaterlineLifetimeCap: {
            hand: 0.28,
            leg: 0.4,
            body: 0.26,
        },
        roleFade: {
            hand: { holdTime: 0.26, endTime: 0.64 },
            leg: { holdTime: 0.32, endTime: 0.76 },
            body: { holdTime: 0.28, endTime: 0.66 },
        },

        // Size-over-lifetime curve: pop full, then shrink/thin as the droplet falls.
        // 生命周期尺寸曲线：先饱满弹出，随水滴下落再缩小变细。
        sizeOverLifetime: [
            [0, 1],
            [0.6, 0.9],
            [1, 0.3],
        ] as const,
        roleSizeOverLifetime: {
            hand: [[0, 1], [0.38, 0.95], [0.72, 0], [1, 0]],
            leg: [[0, 1], [0.5, 0.95], [0.88, 0], [1, 0]],
            body: [[0, 1], [0.32, 0.9], [0.66, 0], [1, 0]],
        } as const,
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

    blockyTexture: {
        // Hard-edged square splash sprite for the 'blocky' style. Fills most of the tile with a
        // near-solid square, small soft rim so it doesn't alias too hard on WeChat.
        // 'blocky' 风格的硬边方块贴图；方块几乎填满贴图，仅留很窄的柔和边，避免真机上锯齿过硬。
        size: 16,
        // Half-extent of the solid square in normalized [0,1] (1 = fills to border).
        // 实心方块的半边长，归一化 [0,1]（1 = 填满到边界）。
        halfExtent: 0.82,
        // Edge softness band width (0 = perfectly hard pixel edge).
        // 边缘柔化带宽度（0 = 完全硬像素边）。
        edgeSoftness: 0.12,
        // Blocky sprites usually look better a bit bigger; multiplies particle size.
        // 方块贴图通常稍大更好看；对粒子尺寸的整体倍率。
        sizeMultiplier: 0.3,
    },

    particleEmitters: {
        enableHand: true,
        enableLeg: true,
        enableBody: false,

        // Reduced splash LOD for background AI swimmers. The player always stays framed and keeps the
        // full emitter set; distant AI swimmers only need a hint of spray. Cutting particle systems per
        // AI from 14 -> a few is the single biggest WeChat Mini Game draw-call/CPU win here.
        // 背景 AI 选手的精简水花 LOD。玩家始终在画面中央、保留全套发射器；远处 AI 只需一点飞溅暗示。
        // 把每个 AI 的粒子系统从 14 个降到少数几个，是这里对微信小游戏 draw call / CPU 最大的单项优化。
        reduced: {
            // How many emitters (from the front of each cluster) to keep per hand / per lower-leg.
            // 每只手 / 每条小腿保留的发射器数量（取各 cluster 前 N 个）。
            handCount: 1,
            legCount: 1,
            // Body emitters are ambient-only; drop them entirely for reduced swimmers.
            // 身体发射器纯属氛围，精简选手直接去掉。
            enableBody: false,
            // Keep surface foam meshes so AI still visibly disturb the water; only the heavy CPU
            // particle spray is trimmed. Set true to also skip foam for even fewer draw calls.
            // 保留水面泡沫网格，让 AI 仍能看出扰动水面；只削减昂贵的 CPU 粒子飞溅。置 true 可连泡沫一并跳过。
            disableFoam: false,
        },

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
                visual: 'plume',
                sideOffsetZ: 0,
                basePosition: [0.46, 0.08, 0],
                palmOffset: [0.28, 0.018, 0],
                forwardTilt: 0,
                lateralTilt: 0,
                countScale: 0.68,
                sizeScale: 2.55,
                heightScale: 3.1,
            },
            {
                nameSuffix: 'Inner',
                role: 'hand',
                visual: 'plume',
                sideOffsetZ: -0.14,
                basePosition: [0.49, 0.075, 0],
                palmOffset: [0.3, 0.014, -0.14],
                forwardTilt: 0,
                lateralTilt: 0,
                countScale: 0.34,
                sizeScale: 1.8,
                heightScale: 2.35,
            },
            {
                nameSuffix: 'Outer',
                role: 'hand',
                visual: 'spray',
                sideOffsetZ: 0.16,
                basePosition: [0.51, 0.085, 0],
                palmOffset: [0.13, -0.035, 0.16],
                forwardTilt: 10,
                lateralTilt: 18,
                countScale: 0.52,
                sizeScale: 0.7,
                heightScale: 0.82,
            },
        ] satisfies SplashParticleEmitterTuning[],

        // Lower-leg emitter. Tune palmOffset[1] to change kick splash height.
        // 小腿发射器；调 palmOffset[1] 可以改变打腿水花高度。
        legCluster: [
            {
                nameSuffix: 'Toe',
                role: 'leg',
                visual: 'plume',
                sideOffsetZ: 0.02,
                basePosition: [-0.7, 0.018, 0],
                palmOffset: [0.08, 0.018, 0.035],
                forwardTilt: 0,
                lateralTilt: 0,
                countScale: 0.46,
                sizeScale: 2.15,
                heightScale: 2.75,
            },
            {
                nameSuffix: 'Sole',
                role: 'leg',
                visual: 'plume',
                sideOffsetZ: -0.015,
                basePosition: [-0.74, 0.014, 0],
                palmOffset: [-0.02, 0.015, -0.09],
                forwardTilt: 0,
                lateralTilt: 0,
                countScale: 0.28,
                sizeScale: 1.55,
                heightScale: 2.05,
            },
            {
                nameSuffix: 'Heel',
                role: 'leg',
                visual: 'spray',
                sideOffsetZ: -0.055,
                basePosition: [-0.78, 0.012, 0],
                palmOffset: [-0.09, 0.012, -0.05],
                forwardTilt: 10,
                lateralTilt: 18,
                countScale: 0.24,
                sizeScale: 0.72,
                heightScale: 0.8,
            },
            {
                nameSuffix: 'Backwash',
                role: 'leg',
                visual: 'spray',
                sideOffsetZ: 0.035,
                basePosition: [-0.84, 0.01, 0],
                palmOffset: [-0.18, 0.006, 0.02],
                forwardTilt: -12,
                lateralTilt: -13,
                countScale: 0.18,
                sizeScale: 0.68,
                heightScale: 0.75,
            },
        ] satisfies SplashParticleEmitterTuning[],

        // Body emitter: ambient foam churn alongside the torso, positioned near mid-body at water level.
        // Follows the 'Body' bone (torso). palmOffset[2] is mirrored per side.
        // 身体发射器：躯干两侧的环境泡沫翻涌，位于身体中段水面处；跟随 'Body'（躯干）骨骼，palmOffset[2] 按左右镜像。
        body: {
            nameSuffix: '',
            role: 'body',
            visual: 'spray',
            sideOffsetZ: 0,
            basePosition: [-0.1, 0.012, 0],
            palmOffset: [-0.05, -0.01, 0.06],
            forwardTilt: 0,
            lateralTilt: 12,
            countScale: 0.12,
            sizeScale: 0.7,
            heightScale: 0.8,
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
        handBurstCountMin: 4,
        handBurstCountMax: 10,
        handBurstExtraCount: 2,
        handBurstCountClampMin: 3,
        handBurstCountClampMax: 12,
        handBurstArmWeight: 0.75,
        handBurstGenericWeight: 0.35,

        legSignalSpeedWeight: 0.2,
        legSignalCycleWeight: 0.52,
        legSignalActionWeight: 0.24,
        legSignalBurstWeight: 0.2,
        legSignalMax: 1.15,
        legEntryThreshold: 0.18,
        legLastEntryThreshold: 0.08,
        legEntryScaleMin: 0.9,
        legEntryScaleMax: 1.16,
        legEmitThreshold: 0.08,
        legBurstCountMin: 4,
        legBurstCountMax: 11,
        legBurstSpeedScale: 0.42,
        legBurstPullScale: 0.86,
        legCooldownMin: 0.07,
        legCooldownMax: 0.16,

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
        bodyBurstSpeedScale: 0.3,
        bodyBurstPullScale: 0.58,
        bodyCooldownMin: 0.05,
        bodyCooldownMax: 0.12,
        bodySpeedBack: 0.12,

        // Particle burst physics and size ranges.
        // 粒子爆发的速度、生命周期和尺寸范围。
        handSpeedMin: 2,
        handSpeedMax: 3.4,
        legSpeedMin: 2.2,
        legSpeedMax: 3.6,
        plumeSpeedScale: 0,
        plumeLifetimeScale: 0.58,
        plumeGravity: 0,
        speedRangeMinScale: 0.58,
        speedRangeMaxScale: 1.08,
        handLifetimeMin: 0.16,
        handLifetimeMaxLowSpeed: 0.24,
        handLifetimeMaxHighSpeed: 0.28,
        legLifetimeMin: 0.2,
        legLifetimeMaxLowSpeed: 0.3,
        legLifetimeMaxHighSpeed: 0.36,
        handSizeMin: 0.045,
        handSizeMax: 0.1,
        legSizeMin: 0.06,
        legSizeMax: 0.13,
        sizeRangeMinScale: 0.82,
        sizeRangeMaxScale: 1.14,
        minimumScaledCount: 1,
        handSpraySeconds: 0.035,
        legSpraySeconds: 0.045,
        initialEmitScale: 0.72,
        handInitialEmitMin: 2,
        legInitialEmitMin: 1,
        burstCooldownMin: 0.018,
        burstCooldownMax: 0.04,
        keepAliveMin: 0.2,
        keepAliveMax: 0.32,

        // Frame spray accumulation and per-particle jitter.
        // 连续发射累计与单粒子抖动。
        minSprayDt: 1 / 240,
        maxSprayDt: 1 / 20,
        handJitterX: 0.04,
        handJitterY: 0.014,
        handJitterZ: 0.05,
        legJitterX: 0.11,
        legJitterY: 0.025,
        legJitterZ: 0.105,
        baseJitterYDown: -0.006,
        handRotationJitterX: 10,
        handRotationJitterY: 18,
        handRotationJitterZ: 24,
        legRotationJitterX: 0,
        legRotationJitterY: 0,
        legRotationJitterZ: 0,

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
