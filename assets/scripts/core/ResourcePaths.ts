import { STARTUP_RESOURCES } from '../../startup/StartupResources';
import type { SampledActionId } from '../character/SampledActionMotionCurve';
import type { CharacterAbilityId } from './CharacterAbilityConfig';

export type SurfaceSwimStyle = 'legacy' | 'freestyle';

export type SwimmerModelVariant = {
    id: string;
    label: string;
    candidates: string[];
    debugOnly?: boolean;
    preserveOriginalMaterial?: boolean;
    // Uniform visual scale relative to CHARACTER_POSE_TUNING.modelScale.
    // This scales the complete imported model hierarchy without changing gameplay.
    modelScaleMultiplier?: number;
    raceModelYOffset?: number;
    raceModelEulerDegrees?: readonly [number, number, number];
    debugPose?: 'breaststroke' | 'divePrep';
    swimHeadLiftDegrees?: number;
    // 水面划水动作；省略时沿用旧版划水，仅指定角色启用新版自由泳。
    surfaceSwimStyle?: SurfaceSwimStyle;
    // Inverted-hull shell width. Omit to use the shared character default.
    outlineWidth?: number;
    // Rig-profile emote and tread-water curves. Characters normalized to the
    // same T-pose skeleton should point at one shared profile directory.
    sampledActionOverrideDir?: string;
    sampledActionOverrideFilePrefix?: string;
    // A static rig-profile pose can be shared even when a character keeps
    // geometry-specific emote curves for foot contact.
    divePrepOverridePath?: string;
    dynamicColor?: {
        mode?: 'mask' | 'whiteKey';
        maskPath?: string;
        labelPrefix: string;
        usesCapChannel: boolean;
    };
};

export type SwimmerColorVariant = {
    id: string;
    label: string;
    suitLabel?: string;
    suit?: readonly [number, number, number];
    cap?: readonly [number, number, number];
};

export type DebugSwimmerActionPose = 'divePrep' | 'freestyle' | 'butterfly' | 'breaststroke' | 'sampledAction' | 'flipTurn';

export type DebugSwimmerActionPreview = {
    id: string;
    label: string;
    pose: DebugSwimmerActionPose;
    sampledActionId?: SampledActionId;
};

export type SkyboxFaceName = 'right' | 'left' | 'top' | 'bottom' | 'front' | 'back';

export type SkyboxVariant = {
    id: string;
    label: string;
    paths: Record<SkyboxFaceName, string>;
};

const TPOSE_ACTION_PROFILE_DIR = 'model-actions/tPose';
export const CHARACTER_PRELOAD_PATHS = { models: 'models', actions: 'model-actions' } as const;
const MUSCLE_MAN_PREFAB_CANDIDATES = [
    'models/MuscleMan',
    'models/MuscleMan/MuscleMan',
];
const CARTON_SWIMMER5_PREFAB_CANDIDATES = [
    'models/CartonSwimmer5',
    'models/CartonSwimmer5/CartonSwimmer5',
];
const CARTON_SWIMMER6_PREFAB_CANDIDATES = [
    'models/CartonSwimmer6',
    'models/CartonSwimmer6/CartonSwimmer6',
];
const CARTON_SWIMMER8_PREFAB_CANDIDATES = [
    'models/CartonSwimmer8',
    'models/CartonSwimmer8/CartonSwimmer8',
];
const CARTON_SWIMMER9_PREFAB_CANDIDATES = [
    'models/CartonSwimmer9',
    'models/CartonSwimmer9/CartonSwimmer9',
];
const CARTON_SWIMMER10_PREFAB_CANDIDATES = [
    'models/CartonSwimmer10',
    'models/CartonSwimmer10/CartonSwimmer10',
];
const CARTON_SWIMMER11_PREFAB_CANDIDATES = [
    'models/CartonSwimmer11',
    'models/CartonSwimmer11/CartonSwimmer11',
];
const CARTON_SWIMMER12_PREFAB_CANDIDATES = [
    'models/CartonSwimmer12',
    'models/CartonSwimmer12/CartonSwimmer12',
];
const CARTON_SWIMMER13_PREFAB_CANDIDATES = [
    'models/CartonSwimmer13',
    'models/CartonSwimmer13/CartonSwimmer13',
];
const CARTON_SWIMMER14_PREFAB_CANDIDATES = [
    'models/CartonSwimmer14',
    'models/CartonSwimmer14/CartonSwimmer14',
];
const CARTON_SWIMMER15_PREFAB_CANDIDATES = [
    'models/CartonSwimmer15',
    'models/CartonSwimmer15/CartonSwimmer15',
];
const CARTON_SWIMMER16_PREFAB_CANDIDATES = [
    'models/CartonSwimmer16',
    'models/CartonSwimmer16/CartonSwimmer16',
];

export const SWIMMER_MODEL_VARIANTS: SwimmerModelVariant[] = [
    {
        id: 'muscleMan',
        surfaceSwimStyle: 'freestyle',
        label: '肌肉男',
        candidates: MUSCLE_MAN_PREFAB_CANDIDATES,
        modelScaleMultiplier: 1.24,
        preserveOriginalMaterial: true,
        swimHeadLiftDegrees: 4,
        sampledActionOverrideDir: TPOSE_ACTION_PROFILE_DIR,
        sampledActionOverrideFilePrefix: 'Tpose_',
        divePrepOverridePath: `${TPOSE_ACTION_PROFILE_DIR}/Tpose_divePrep`,
        dynamicColor: {
            mode: 'mask',
            maskPath: 'models/MuscleManColorMask/texture',
            labelPrefix: '肌肉男',
            usesCapChannel: true,
        },
    },
    {
        id: 'cartonSwimmer5',
        label: '超级腿',
        candidates: CARTON_SWIMMER5_PREFAB_CANDIDATES,
        // Per-character whole-model tuning. Edit these multipliers directly when
        // comparing the roster; 1 keeps the shared default scale.
        modelScaleMultiplier: 1.0,
        preserveOriginalMaterial: true,
        swimHeadLiftDegrees: 4,
        sampledActionOverrideDir: TPOSE_ACTION_PROFILE_DIR,
        sampledActionOverrideFilePrefix: 'Tpose_',
        divePrepOverridePath: `${TPOSE_ACTION_PROFILE_DIR}/Tpose_divePrep`,
        dynamicColor: {
            mode: 'mask',
            maskPath: 'models/CartonSwimmer5ColorMask/texture',
            labelPrefix: '超级腿',
            usesCapChannel: false,
        },
    },
    {
        id: 'cartonSwimmer6',
        label: '蛙妹',
        candidates: CARTON_SWIMMER6_PREFAB_CANDIDATES,
        modelScaleMultiplier: 0.97,
        preserveOriginalMaterial: true,
        swimHeadLiftDegrees: 4,
        sampledActionOverrideDir: TPOSE_ACTION_PROFILE_DIR,
        sampledActionOverrideFilePrefix: 'Tpose_',
        divePrepOverridePath: `${TPOSE_ACTION_PROFILE_DIR}/Tpose_divePrep`,
        dynamicColor: {
            mode: 'mask',
            maskPath: 'models/CartonSwimmer6ColorMask/texture',
            labelPrefix: '蛙妹',
            usesCapChannel: false,
        },
    },
    {
        id: 'cartonSwimmer8',
        label: '蛙少',
        candidates: CARTON_SWIMMER8_PREFAB_CANDIDATES,
        modelScaleMultiplier: 1.02,
        preserveOriginalMaterial: true,
        swimHeadLiftDegrees: 4,
        sampledActionOverrideDir: TPOSE_ACTION_PROFILE_DIR,
        sampledActionOverrideFilePrefix: 'Tpose_',
        divePrepOverridePath: `${TPOSE_ACTION_PROFILE_DIR}/Tpose_divePrep`,
        dynamicColor: {
            mode: 'mask',
            maskPath: 'models/CartonSwimmer8ColorMask/texture',
            labelPrefix: '蛙少',
            usesCapChannel: false,
        },
    },
    {
        id: 'cartonSwimmer9',
        label: '猫姐',
        candidates: CARTON_SWIMMER9_PREFAB_CANDIDATES,
        modelScaleMultiplier: 1.00,
        preserveOriginalMaterial: true,
        swimHeadLiftDegrees: 4,
        sampledActionOverrideDir: TPOSE_ACTION_PROFILE_DIR,
        sampledActionOverrideFilePrefix: 'Tpose_',
        divePrepOverridePath: `${TPOSE_ACTION_PROFILE_DIR}/Tpose_divePrep`,
        dynamicColor: {
            mode: 'mask',
            maskPath: 'models/CartonSwimmer9ColorMask/texture',
            labelPrefix: '猫姐',
            usesCapChannel: false,
        },
    },
    {
        id: 'cartonSwimmer10',
        label: '忍者哥',
        candidates: CARTON_SWIMMER10_PREFAB_CANDIDATES,
        modelScaleMultiplier: 1.02,
        preserveOriginalMaterial: true,
        swimHeadLiftDegrees: 4,
        sampledActionOverrideDir: TPOSE_ACTION_PROFILE_DIR,
        sampledActionOverrideFilePrefix: 'Tpose_',
        divePrepOverridePath: `${TPOSE_ACTION_PROFILE_DIR}/Tpose_divePrep`,
        dynamicColor: {
            mode: 'mask',
            maskPath: 'models/CartonSwimmer10ColorMask/texture',
            labelPrefix: '忍者哥',
            usesCapChannel: false,
        },
    },
    {
        id: 'cartonSwimmer11',
        label: '健身教练',
        candidates: CARTON_SWIMMER11_PREFAB_CANDIDATES,
        modelScaleMultiplier: 1.06,
        preserveOriginalMaterial: true,
        swimHeadLiftDegrees: 4,
        sampledActionOverrideDir: TPOSE_ACTION_PROFILE_DIR,
        sampledActionOverrideFilePrefix: 'Tpose_',
        divePrepOverridePath: `${TPOSE_ACTION_PROFILE_DIR}/Tpose_divePrep`,
        dynamicColor: {
            mode: 'mask',
            maskPath: 'models/CartonSwimmer11ColorMask/texture',
            labelPrefix: '健身教练',
            usesCapChannel: false,
        },
    },
    {
        id: 'cartonSwimmer12',
        label: '飞毛腿',
        candidates: CARTON_SWIMMER12_PREFAB_CANDIDATES,
        modelScaleMultiplier: 1.0,
        preserveOriginalMaterial: true,
        swimHeadLiftDegrees: 4,
        sampledActionOverrideDir: TPOSE_ACTION_PROFILE_DIR,
        sampledActionOverrideFilePrefix: 'Tpose_',
        divePrepOverridePath: `${TPOSE_ACTION_PROFILE_DIR}/Tpose_divePrep`,
        dynamicColor: {
            mode: 'mask',
            maskPath: 'models/CartonSwimmer12ColorMask/texture',
            labelPrefix: '飞毛腿',
            usesCapChannel: false,
        },
    },
    {
        id: 'cartonSwimmer13',
        label: '潜水哥',
        candidates: CARTON_SWIMMER13_PREFAB_CANDIDATES,
        modelScaleMultiplier: 1.04,
        preserveOriginalMaterial: true,
        swimHeadLiftDegrees: 4,
        sampledActionOverrideDir: TPOSE_ACTION_PROFILE_DIR,
        sampledActionOverrideFilePrefix: 'Tpose_',
        divePrepOverridePath: `${TPOSE_ACTION_PROFILE_DIR}/Tpose_divePrep`,
        dynamicColor: {
            mode: 'mask',
            maskPath: 'models/CartonSwimmer13ColorMask/texture',
            labelPrefix: '潜水哥',
            usesCapChannel: false,
        },
    },
    {
        id: 'cartonSwimmer14',
        label: '风火轮',
        candidates: CARTON_SWIMMER14_PREFAB_CANDIDATES,
        modelScaleMultiplier: 1.0,
        preserveOriginalMaterial: true,
        swimHeadLiftDegrees: 4,
        sampledActionOverrideDir: TPOSE_ACTION_PROFILE_DIR,
        sampledActionOverrideFilePrefix: 'Tpose_',
        divePrepOverridePath: `${TPOSE_ACTION_PROFILE_DIR}/Tpose_divePrep`,
        dynamicColor: {
            mode: 'mask',
            maskPath: 'models/CartonSwimmer14ColorMask/texture',
            labelPrefix: '风火轮',
            usesCapChannel: false,
        },
    },
    // 新机甲沿用唯一标准动作集；遮罩只控制绿甲，不把白甲或关节当肤色。
    {
        id: 'cartonSwimmer15',
        label: '机甲coser',
        candidates: CARTON_SWIMMER15_PREFAB_CANDIDATES,
        modelScaleMultiplier: 1.12,
        preserveOriginalMaterial: true,
        swimHeadLiftDegrees: 4,
        sampledActionOverrideDir: TPOSE_ACTION_PROFILE_DIR,
        sampledActionOverrideFilePrefix: 'Tpose_',
        divePrepOverridePath: `${TPOSE_ACTION_PROFILE_DIR}/Tpose_divePrep`,
        dynamicColor: {
            mode: 'mask',
            maskPath: 'models/CartonSwimmer15ColorMask/texture',
            labelPrefix: '机甲coser',
            usesCapChannel: false,
        },
    },
    {
        id: 'cartonSwimmer16',
        label: '赛博少女',
        candidates: CARTON_SWIMMER16_PREFAB_CANDIDATES,
        modelScaleMultiplier: 1.0,
        preserveOriginalMaterial: true,
        swimHeadLiftDegrees: 4,
        sampledActionOverrideDir: TPOSE_ACTION_PROFILE_DIR,
        sampledActionOverrideFilePrefix: 'Tpose_',
        divePrepOverridePath: `${TPOSE_ACTION_PROFILE_DIR}/Tpose_divePrep`,
        dynamicColor: {
            mode: 'mask',
            maskPath: 'models/CartonSwimmer16ColorMask/texture',
            labelPrefix: '赛博少女',
            usesCapChannel: false,
        },
    },
];

export const DEBUG_SWIMMER_MODEL_VARIANTS: SwimmerModelVariant[] = SWIMMER_MODEL_VARIANTS;

export const DEBUG_SWIMMER_ACTION_PREVIEWS: DebugSwimmerActionPreview[] = [
    { id: 'freestyle', label: 'Freestyle', pose: 'freestyle' },
    { id: 'butterfly', label: '蝶泳预览', pose: 'butterfly' },
    { id: 'flip_turn', label: 'Flip Turn', pose: 'flipTurn' },
    { id: 'waving', label: 'Waving', pose: 'sampledAction', sampledActionId: 'waving' },
    { id: 'arm_stretching', label: 'Arm Stretching', pose: 'sampledAction', sampledActionId: 'arm_stretching' },
    { id: 'chicken_dance', label: 'Chicken Dance', pose: 'sampledAction', sampledActionId: 'chicken_dance' },
    { id: 'neck_stretching', label: 'Neck Stretching', pose: 'sampledAction', sampledActionId: 'neck_stretching' },
    { id: 'silly_dancing', label: 'Silly Dancing', pose: 'sampledAction', sampledActionId: 'silly_dancing' },
    { id: 'twist_dance', label: 'Twist Dance', pose: 'sampledAction', sampledActionId: 'twist_dance' },
    { id: 'waving_gesture', label: 'Waving Gesture', pose: 'sampledAction', sampledActionId: 'waving_gesture' },
    { id: 'ymca_dance', label: 'Ymca Dance', pose: 'sampledAction', sampledActionId: 'ymca_dance' },
    { id: 'dancing_twerk', label: 'Dancing Twerk', pose: 'sampledAction', sampledActionId: 'dancing_twerk' },
    { id: 'joyful_jump', label: 'Joyful Jump', pose: 'sampledAction', sampledActionId: 'joyful_jump' },
    { id: 'victory_idle', label: 'Victory Idle', pose: 'sampledAction', sampledActionId: 'victory_idle' },
    { id: 'victory', label: 'Victory', pose: 'sampledAction', sampledActionId: 'victory' },
    { id: 'angry', label: 'Angry', pose: 'sampledAction', sampledActionId: 'angry' },
    { id: 'defeated', label: 'Defeated', pose: 'sampledAction', sampledActionId: 'defeated' },
    { id: 'loser', label: 'Loser', pose: 'sampledAction', sampledActionId: 'loser' },
    { id: 'clapping', label: 'Clapping', pose: 'sampledAction', sampledActionId: 'clapping' },
    { id: 'excited', label: 'Excited', pose: 'sampledAction', sampledActionId: 'excited' },
    { id: 'happy', label: 'Happy', pose: 'sampledAction', sampledActionId: 'happy' },
    { id: 'waving_0713', label: 'Waving 0713', pose: 'sampledAction', sampledActionId: 'waving_0713' },
];

export const SWIMMER_COLOR_VARIANTS: SwimmerColorVariant[] = [
    { id: 'redBlue', label: 'Red / Blue', suitLabel: 'Red', suit: [240, 68, 58], cap: [22, 119, 232] },
    { id: 'blueWhite', label: 'Blue / White', suitLabel: 'Blue', suit: [23, 109, 218], cap: [245, 238, 220] },
    { id: 'blackYellow', label: 'Black / Yellow', suitLabel: 'Black', suit: [36, 42, 53], cap: [255, 209, 42] },
    { id: 'greenOrange', label: 'Green / Orange', suitLabel: 'Green', suit: [32, 196, 106], cap: [255, 121, 38] },
    { id: 'purpleCyan', label: 'Purple / Cyan', suitLabel: 'Purple', suit: [139, 77, 255], cap: [35, 220, 232] },
    { id: 'orangeNavy', label: 'Orange / Navy', suitLabel: 'Orange', suit: [255, 137, 38], cap: [24, 60, 143] },
    { id: 'pinkMint', label: 'Pink / Mint', suitLabel: 'Pink', suit: [240, 59, 168], cap: [98, 237, 178] },
    { id: 'cyanRed', label: 'Cyan / Red', suitLabel: 'Cyan', suit: [24, 199, 216], cap: [240, 68, 80] },
    { id: 'yellowPurple', label: 'Yellow / Purple', suitLabel: 'Yellow', suit: [244, 201, 54], cap: [120, 71, 216] },
];

const SKYBOX_FACE_NAMES: SkyboxFaceName[] = ['right', 'left', 'top', 'bottom', 'front', 'back'];

function makeSkyboxPaths(folder: string): Record<SkyboxFaceName, string> {
    const paths = {} as Record<SkyboxFaceName, string>;
    for (const faceName of SKYBOX_FACE_NAMES) {
        paths[faceName] = `skybox/${folder}/${faceName}/texture`;
    }
    return paths;
}

export const SKYBOX_VARIANTS: SkyboxVariant[] = [
    {
        id: 'pixelNightSmall',
        label: 'Pixel Night Small',
        paths: makeSkyboxPaths('PixelNightSmall'),
    },
];

export const DEFAULT_SKYBOX_VARIANT: SkyboxVariant = SKYBOX_VARIANTS[0];

// 大厅、角色和联机页共用全景原图，显示层保持这一宽高比。
export const PREPARE_PANORAMA_WIDTH = 2115;
export const PREPARE_PANORAMA_HEIGHT = 743;

export const RESOURCE_PATHS = {
    geyser: {
        foam: 'items/GeyserSurfaceFoam/GeyserSurfaceFoam',
        jet: 'items/GeyserWaterJet/GeyserWaterJet',
        drops: 'items/GeyserDroplets/GeyserDroplets',
    },
    giantWave: {
        body: 'items/GiantWaveBody/GiantWaveBody',
        wake: 'items/GiantWaveWake/GiantWaveWake',
        shore: 'items/GiantWaveShore/GiantWaveShore',
    },
    entertainmentSupplies: {
        soda: 'items/StimulantBottle/StimulantBottle',
        slush: 'items/CalmSlush/CalmSlush',
    },
    cannon: {
        base: 'items/CannonBase/CannonBase',
        nozzle: 'items/CannonNozzle/CannonNozzle',
        ball: 'items/CannonWaterBall/CannonWaterBall',
        warning: 'items/CannonImpactWarning/CannonImpactWarning',
    },
    sprayBuoy: {
        model: 'items/SprayBuoy/SprayBuoy',
        ring: 'items/RecoveryFloatRing/RecoveryFloatRing',
        entryBody: 'items/SprayBuoyEntryBody/SprayBuoyEntryBody',
        entryRing: 'items/SprayBuoyEntryRing/SprayBuoyEntryRing',
        splashBody: 'items/SprayBuoySplashBody/SprayBuoySplashBody',
        splashRing: 'items/SprayBuoySplashRing/SprayBuoySplashRing',
        splashCore: 'items/SprayBuoySplashCore/SprayBuoySplashCore',
    },
    entertainmentDebris: {
        cola: 'items/ColaBottle/ColaBottle',
        water: 'items/CrushedWaterBottle/CrushedWaterBottle',
        sport: 'items/SportDrinkBottle/SportDrinkBottle',
        tray: 'items/MealTray/MealTray',
    },
    venuePreloadDirs: ['pool', 'skybox', 'material-effects'] as const,
    uiBundle: { name: 'ui', root: 'ui' },
    uiAtlases: {
        'avatars': 'ui/avatars/atlas',
        'common': 'ui/common/atlas',
        'avatar-picker': 'ui/avatar-picker/atlas',
        'career/controls': 'ui/career/controls/atlas',
        'character-skills': 'ui/character-skills/atlas',
        'character/controls': 'ui/character/controls/atlas',
        'character/portraits': 'ui/character/portraits/atlas',
        'lobby/controls': 'ui/lobby/controls/atlas',
        'online-room': 'ui/online-room/atlas',
        'race-intro': 'ui/race-intro/atlas',
        'race-hud': 'ui/race-hud/atlas',
        'settlement': 'ui/settlement/atlas',
    } as Record<string, string>,
    raceStartUi: {
        'ready': 'ui/race-intro/ready/spriteFrame',
        'go': 'ui/race-intro/go/spriteFrame',
        'late': 'ui/race-intro/late/spriteFrame',
        'good': 'ui/race-intro/good/spriteFrame',
        'great': 'ui/race-intro/great/spriteFrame',
        'perfect': 'ui/race-intro/perfect/spriteFrame',
        'charge-track': 'ui/race-intro/charge-track/spriteFrame',
        'charge-fill-low': 'ui/race-intro/charge-fill-low/spriteFrame',
        'charge-fill-mid': 'ui/race-intro/charge-fill-mid/spriteFrame',
        'charge-fill-high': 'ui/race-intro/charge-fill-high/spriteFrame',
        'charge-cap': 'ui/race-intro/charge-cap/spriteFrame',
    },
    swimmerPrefabCandidates: MUSCLE_MAN_PREFAB_CANDIDATES,
    swimmerModelVariants: SWIMMER_MODEL_VARIANTS,
    poolPrefab: 'pool/PoolScene',
    startBlockPrefabCandidates: [
        'pool/StartBlock/StartBlock',
        'pool/StartBlock',
    ],
    poolWaterMaterial: 'pool/RagingPoolWater',
    swimmerSplashMaterial: 'pool/SwimmerSplash',
    swimmerSplashParticleTexture: 'pool/SwimmerSplashDroplet/texture',
    swimmerSplashSurfaceTexture: 'pool/SwimmerSplashSurface/texture',
    swimmerSplashSprayTexture: 'pool/SwimmerSplashSpray/texture',
    spectatorCameraFlashTexture: 'pool/SpectatorCameraFlash/texture',
    skyboxVariants: SKYBOX_VARIANTS,
    playerOutlineEffect: 'effects/PlayerOutline',
    diveChargeGatherEffect: 'effects/DiveChargeGather',
    laneFloatCutoutEffect: 'effects/LaneFloatCutout',
    swimmerDynamicColorEffect: 'effects/SwimmerDynamicColor',
    toonPropEffect: 'effects/ToonProp',
    underwaterFloorEffect: 'effects/UnderwaterFloorTint',
    whirlpoolFunnelEffect: 'effects/WhirlpoolFunnel',
    venueHeightShadeEffect: 'effects/VenueHeightShade',
    speedStarsUiPrefab: 'ui/SpeedStarsUI',
    uiFonts: {
        regular: 'fonts/ShuiMasterUI-Regular',
        semibold: 'fonts/ShuiMasterUI-SemiBold',
    },
    loginUi: STARTUP_RESOURCES.loginUi,
    careerUi: {
        panelWhite: 'ui/career/controls/panel-white/spriteFrame',
        tagActive: 'ui/career/controls/tag-active/spriteFrame',
        tagAccount: 'ui/career/controls/tag-account/spriteFrame',
        tagCharacter: 'ui/career/controls/tag-character/spriteFrame',
        route: 'ui/career/controls/route/spriteFrame',
        background: 'ui/career/background/background/texture',
        characterBar: 'ui/career/controls/character-bar/spriteFrame',
        panel: 'ui/career/controls/panel/spriteFrame',
        button: 'ui/career/controls/button-yellow/spriteFrame',
        disabledButton: 'ui/career/controls/button-disabled/spriteFrame',
        arrow: 'ui/career/controls/arrow/spriteFrame',
        lock: 'ui/career/controls/lock/spriteFrame',
        podium: 'ui/career/controls/podium/spriteFrame',
        progressTrack: 'ui/career/controls/progress-track/spriteFrame',
        progressFill: 'ui/career/controls/progress-fill/spriteFrame',
        badges: [
            'ui/career/badges/badge-1/texture', 'ui/career/badges/badge-2/texture',
            'ui/career/badges/badge-3/texture', 'ui/career/badges/badge-4/texture',
            'ui/career/badges/badge-5/texture', 'ui/career/badges/badge-6/texture',
        ] as const,
        lockedBadges: [
            'ui/career/badges/badge-1-locked/texture', 'ui/career/badges/badge-2-locked/texture',
            'ui/career/badges/badge-3-locked/texture', 'ui/career/badges/badge-4-locked/texture',
            'ui/career/badges/badge-5-locked/texture', 'ui/career/badges/badge-6-locked/texture',
        ] as const,
    },
    characterSkillIcons: {
        frogSense: 'ui/character-skills/frog-sense/spriteFrame',
        frogHop: 'ui/character-skills/frog-hop/spriteFrame',
        powerKick: 'ui/character-skills/power-kick/spriteFrame',
        catBalance: 'ui/character-skills/cat-balance/spriteFrame',
        precision: 'ui/character-skills/precision/spriteFrame',
        breathControl: 'ui/character-skills/skill-breath/spriteFrame',
        wallKick: 'ui/character-skills/wall-kick/spriteFrame',
        kickDive: 'ui/character-skills/kick-dive/spriteFrame',
        perfectChain: 'ui/character-skills/perfect-chain/spriteFrame',
        exoskeleton: 'ui/character-skills/exoskeleton/spriteFrame',
        heavyBody: 'ui/character-skills/heavy-body/spriteFrame',
    } satisfies Record<Exclude<CharacterAbilityId, 'none'>, string>,
    lobbyB: {
        background: 'ui/lobby/background/background/texture',
        careerCard: 'ui/lobby/controls/career-card/spriteFrame',
        careerButton: 'ui/lobby/controls/career-button/spriteFrame',
        arrow: 'ui/lobby/controls/arrow/spriteFrame',
        progressTrack: 'ui/lobby/controls/progress-track/spriteFrame',
        progressFill: 'ui/lobby/controls/progress-fill/spriteFrame',
        quickButton: 'ui/lobby/controls/quick-button/spriteFrame',
        quickIcon: 'ui/lobby/controls/quick-icon/spriteFrame',
        characterButton: 'ui/lobby/controls/character-button/spriteFrame',
        characterInfo: 'ui/lobby/controls/character-info/spriteFrame',
        skillBase: 'ui/common/skill-base/spriteFrame',
    },
    lobbyUi: {
        onlineButton: 'ui/common/online-button/spriteFrame',
        startButton: 'ui/common/start-button/spriteFrame',
        topPlayer: 'ui/common/top-player/spriteFrame',
        topSettings: 'ui/common/top-settings/spriteFrame',
        topCurrency: 'ui/common/top-currency/spriteFrame',
    },
    softSpeedStreak: 'ui/vfx/SoftSpeedStreak/texture',
    raceHudCountdownFont: 'fonts/Bungee-Regular',
    raceHudUi: {
        speedFont: 'fonts/ShuiMasterSpeed-Heavy',
        praiseGood: 'ui/race-hud/praise-good/spriteFrame',
        praiseGreat: 'ui/race-hud/praise-great/spriteFrame',
        praiseExcellent: 'ui/race-hud/praise-excellent/spriteFrame',
        praisePerfect: 'ui/race-hud/praise-perfect/spriteFrame',
        praiseAmazing: 'ui/race-hud/praise-amazing/spriteFrame',
        praiseCrazy: 'ui/race-hud/praise-crazy/spriteFrame',
        praiseUnbelievable: 'ui/race-hud/praise-unbelievable/spriteFrame',
        strokeArc: 'ui/race-hud/arc/spriteFrame',
        strokeBand: 'ui/race-hud/perfect-band/spriteFrame',
        strokeHand: 'ui/race-hud/hand/spriteFrame',
        strokeButton: 'ui/race-hud/button/spriteFrame',
        strokeMarker: 'ui/race-hud/marker/spriteFrame',
        strokeMarkerGlow: 'ui/race-hud/marker-glow/spriteFrame',
        strokeRipple: 'ui/race-hud/ripple-ring/spriteFrame',
        strokeInnerGlow: 'ui/race-hud/inner-glow/spriteFrame',
        base: 'ui/race-hud/status-base/spriteFrame',
        ring: 'ui/race-hud/status-ring/spriteFrame',
        heart: 'ui/race-hud/heart/spriteFrame',
        lightning: 'ui/race-hud/lightning/spriteFrame',
        warning: 'ui/race-hud/warning/spriteFrame',
        progress: 'ui/race-hud/progress-track/spriteFrame',
        rankRing: 'ui/race-hud/rank-ring/spriteFrame',
        rankSelfRing: 'ui/race-hud/rank-self-ring/spriteFrame',
        dolphin: 'ui/race-hud/dolphin/spriteFrame',
        jumpReady: 'ui/race-hud/jump-ready/spriteFrame',
    },
    preRaceUi: {
        eventStrip: 'ui/race-intro/event-strip/spriteFrame',
        cardNormal: 'ui/race-intro/card-normal/spriteFrame',
        cardSelf: 'ui/race-intro/card-self/spriteFrame',
        laneNormal: 'ui/race-intro/lane-normal/spriteFrame',
        laneSelf: 'ui/race-intro/lane-self/spriteFrame',
        selfTag: 'ui/race-intro/self-tag/spriteFrame',
    },
    settlementUi: {
        shade: 'ui/settlement/right-shade/spriteFrame',
        honors: [
            'ui/settlement/honor-gold/spriteFrame', 'ui/settlement/honor-silver/spriteFrame',
            'ui/settlement/honor-bronze/spriteFrame', 'ui/settlement/honor-normal/spriteFrame',
        ],
        medals: [
            'ui/settlement/medal-gold/spriteFrame', 'ui/settlement/medal-silver/spriteFrame',
            'ui/settlement/medal-bronze/spriteFrame', 'ui/settlement/medal-normal/spriteFrame',
        ],
        rows: [
            'ui/settlement/row-gold/spriteFrame', 'ui/settlement/row-silver/spriteFrame',
            'ui/settlement/row-bronze/spriteFrame', 'ui/settlement/row-normal/spriteFrame',
        ],
        self: 'ui/settlement/row-self/spriteFrame',
        header: 'ui/settlement/table-header/spriteFrame',
        wave: 'ui/settlement/wave/spriteFrame',
    },
    onlineRoomUi: {
        hostPanel: 'ui/online-room/host-panel/spriteFrame',
        membersPanel: 'ui/online-room/members-panel/spriteFrame',
        memberHost: 'ui/online-room/member-host/spriteFrame',
        memberReady: 'ui/online-room/member-ready/spriteFrame',
        memberIdle: 'ui/online-room/member-idle/spriteFrame',
        memberEmpty: 'ui/online-room/member-empty/spriteFrame',
        badgeHost: 'ui/online-room/badge-host/spriteFrame',
        badgeReady: 'ui/online-room/badge-ready/spriteFrame',
        badgeIdle: 'ui/online-room/badge-idle/spriteFrame',
        avatarRing: 'ui/online-room/avatar-ring/spriteFrame',
        exitButton: 'ui/online-room/exit-button/spriteFrame',
        cancelReady: 'ui/online-room/cancel-ready/spriteFrame',
        modePanel: 'ui/online-room/mode-panel/spriteFrame',
        popup: 'ui/online-room/popup/spriteFrame',
        dangerButton: 'ui/online-room/danger-button/spriteFrame',
        drawer: 'ui/online-room/drawer/spriteFrame',
    },
    avatarPickerUi: {
        panel: 'ui/avatar-picker/panel/spriteFrame',
        avatarBase: 'ui/common/avatar-base/spriteFrame',
        selectedRing: 'ui/avatar-picker/selected-ring/spriteFrame',
        selectedCheck: 'ui/avatar-picker/selected-check/spriteFrame',
        nicknameRow: 'ui/avatar-picker/nickname-row/spriteFrame',
        nicknameField: 'ui/avatar-picker/nickname-field/spriteFrame',
        refreshIcon: 'ui/avatar-picker/refresh-icon/spriteFrame',
        cancelButton: 'ui/avatar-picker/button-cancel/spriteFrame',
        confirmButton: 'ui/avatar-picker/button-confirm/spriteFrame',
        avatars: [
            'ui/avatars/avatar-01-female-diver/spriteFrame',
            'ui/avatars/avatar-02-future-girl/spriteFrame',
            'ui/avatars/avatar-03-courier-boy/spriteFrame',
            'ui/avatars/avatar-04-skater-boy/spriteFrame',
            'ui/avatars/avatar-05-short-hair-girl/spriteFrame',
            'ui/avatars/avatar-06-muscle-man/spriteFrame',
            'ui/avatars/avatar-07-frog-girl/spriteFrame',
            'ui/avatars/avatar-08-frog-boy-yellow/spriteFrame',
            'ui/avatars/avatar-09-frog-boy-lime/spriteFrame',
            'ui/avatars/avatar-10-lifeguard-girl/spriteFrame',
        ] as const,
    },
    characterUi: {
        headerBackground: 'ui/common/header-bg/spriteFrame',
        backIcon: 'ui/common/back-icon/spriteFrame',
        detailPanelBackground: 'ui/character/controls/detail-panel-bg/spriteFrame',
        tabAttributes: 'ui/character/controls/tab-attributes/spriteFrame',
        tabAppearance: 'ui/character/controls/tab-appearance/spriteFrame',
        confirmButton: 'ui/character/controls/confirm-button/spriteFrame',
        upgradeButton: 'ui/character/controls/upgrade-button/spriteFrame',
        upgradeCurrency: 'ui/character/controls/upgrade-currency/spriteFrame',
        statRow: 'ui/character/controls/stat-row/spriteFrame',
        skillHeader: 'ui/character/controls/skill-header/spriteFrame',
        statHp: 'ui/character/controls/stat-hp/spriteFrame',
        statTechnique: 'ui/character/controls/stat-technique/spriteFrame',
        statBurst: 'ui/character/controls/stat-burst/spriteFrame',
        statArrow: 'ui/character/controls/stat-arrow/spriteFrame',
        levelPill: 'ui/common/level-pill/spriteFrame',
        cardFrame: 'ui/character/controls/card-base/spriteFrame',
        cardSelected: 'ui/character/controls/card-selected/spriteFrame',
        portraits: {
            cartonSwimmer6: 'ui/character/portraits/portrait-cartonSwimmer6/spriteFrame',
            cartonSwimmer8: 'ui/character/portraits/portrait-cartonSwimmer8/spriteFrame',
            cartonSwimmer5: 'ui/character/portraits/portrait-cartonSwimmer5/spriteFrame',
            cartonSwimmer9: 'ui/character/portraits/portrait-cartonSwimmer9/spriteFrame',
            cartonSwimmer10: 'ui/character/portraits/portrait-cartonSwimmer10/spriteFrame',
            cartonSwimmer11: 'ui/character/portraits/portrait-cartonSwimmer11/spriteFrame',
            cartonSwimmer12: 'ui/character/portraits/portrait-cartonSwimmer12/spriteFrame',
            cartonSwimmer13: 'ui/character/portraits/portrait-cartonSwimmer13/spriteFrame',
            cartonSwimmer14: 'ui/character/portraits/portrait-cartonSwimmer14/spriteFrame',
            cartonSwimmer15: 'ui/character/portraits/portrait-cartonSwimmer15/spriteFrame',
            cartonSwimmer16: 'ui/character/portraits/portrait-cartonSwimmer16/spriteFrame',
            muscleMan: 'ui/character/portraits/portrait-muscleMan/spriteFrame',
        },
        statusActive: 'ui/character/controls/status-active/spriteFrame',
        skinWarm: 'ui/character/controls/skin-warm/spriteFrame',
        skinDeep: 'ui/character/controls/skin-deep/spriteFrame',
        swatchRed: 'ui/character/controls/swatch-red/spriteFrame',
        swatchBlue: 'ui/character/controls/swatch-blue/spriteFrame',
        swatchYellow: 'ui/character/controls/swatch-yellow/spriteFrame',
        swatchPurple: 'ui/character/controls/swatch-purple/spriteFrame',
        swatchGreen: 'ui/character/controls/swatch-green/spriteFrame',
        swatchOrange: 'ui/character/controls/swatch-orange/spriteFrame',
        swatchCyan: 'ui/character/controls/swatch-cyan/spriteFrame',
        swatchBlack: 'ui/character/controls/swatch-black/spriteFrame',
        swatchSoftLilac: 'ui/character/controls/swatch-soft-lilac/spriteFrame',
        swatchLime: 'ui/character/controls/swatch-lime/spriteFrame',
        swatchLakeTeal: 'ui/character/controls/swatch-lake-teal/spriteFrame',
        swatchDeepOcean: 'ui/character/controls/swatch-deep-ocean/spriteFrame',
        swatchCherryRed: 'ui/character/controls/swatch-cherry-red/spriteFrame',
        swatchStrawberryPink: 'ui/character/controls/swatch-strawberry-pink/spriteFrame',
    },
    sampledActionsDir: TPOSE_ACTION_PROFILE_DIR,
    sampledActionsFilePrefix: 'Tpose_',
    music: STARTUP_RESOURCES.music,
};

export function findSwimmerModelVariant(id: string): SwimmerModelVariant | null {
    return SWIMMER_MODEL_VARIANTS.find((variant) => variant.id === id) ?? null;
}

export function isDebugOnlySwimmerModelVariant(id: string): boolean {
    return findSwimmerModelVariant(id)?.debugOnly === true;
}

export function defaultSwimmerModelVariant(): SwimmerModelVariant {
    return SWIMMER_MODEL_VARIANTS[0];
}

export function findSwimmerColorVariant(id: string): SwimmerColorVariant | null {
    return SWIMMER_COLOR_VARIANTS.find((variant) => variant.id === id) ?? null;
}

export function defaultSwimmerColorVariant(): SwimmerColorVariant {
    return SWIMMER_COLOR_VARIANTS[0];
}

export const ANIMATION_CLIPS = {
    freestyle: 'FreestyleFull',
};
