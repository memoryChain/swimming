import type { SampledActionId } from '../character/SampledActionMotionCurve';

export type SwimmerModelVariant = {
    id: string;
    label: string;
    candidates: string[];
    debugOnly?: boolean;
    preserveOriginalMaterial?: boolean;
    raceModelYOffset?: number;
    raceModelEulerDegrees?: readonly [number, number, number];
    debugPose?: 'breaststroke' | 'divePrep';
    swimHeadLiftDegrees?: number;
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

export type DebugSwimmerActionPose = 'divePrep' | 'freestyle' | 'breaststroke' | 'sampledAction' | 'flipTurn';

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
const MUSCLE_MAN_PREFAB_CANDIDATES = [
    'models/MuscleMan',
    'models/MuscleMan/MuscleMan',
];
const WOMEN2_PREFAB_CANDIDATES = [
    'models/Women2',
    'models/Women2/Women2',
];
const LOW_POLY_HUMAN2_PREFAB_CANDIDATES = [
    'models/LowPolyHuman2',
    'models/LowPolyHuman2/LowPolyHuman2',
];
const DIVER_PREFAB_CANDIDATES = [
    'models/Diver',
    'models/Diver/Diver',
];

export const SWIMMER_MODEL_VARIANTS: SwimmerModelVariant[] = [
    {
        id: 'muscleMan',
        label: 'Muscle Man',
        candidates: MUSCLE_MAN_PREFAB_CANDIDATES,
        preserveOriginalMaterial: true,
        swimHeadLiftDegrees: 4,
        sampledActionOverrideDir: TPOSE_ACTION_PROFILE_DIR,
        sampledActionOverrideFilePrefix: 'Tpose_',
        divePrepOverridePath: `${TPOSE_ACTION_PROFILE_DIR}/Tpose_divePrep`,
        dynamicColor: {
            mode: 'whiteKey',
            labelPrefix: 'Muscle Man',
            usesCapChannel: false,
        },
    },
    {
        id: 'women2',
        label: 'Women 2',
        candidates: WOMEN2_PREFAB_CANDIDATES,
        preserveOriginalMaterial: true,
        swimHeadLiftDegrees: 4,
        sampledActionOverrideDir: TPOSE_ACTION_PROFILE_DIR,
        sampledActionOverrideFilePrefix: 'Tpose_',
        divePrepOverridePath: `${TPOSE_ACTION_PROFILE_DIR}/Tpose_divePrep`,
        dynamicColor: {
            mode: 'whiteKey',
            labelPrefix: 'Women 2',
            usesCapChannel: false,
        },
    },
    {
        id: 'lowPolyHuman2',
        label: 'Low Poly Human 2',
        candidates: LOW_POLY_HUMAN2_PREFAB_CANDIDATES,
        preserveOriginalMaterial: true,
        swimHeadLiftDegrees: 4,
        sampledActionOverrideDir: TPOSE_ACTION_PROFILE_DIR,
        sampledActionOverrideFilePrefix: 'Tpose_',
        divePrepOverridePath: `${TPOSE_ACTION_PROFILE_DIR}/Tpose_divePrep`,
        dynamicColor: {
            mode: 'whiteKey',
            labelPrefix: 'Low Poly Human 2',
            usesCapChannel: false,
        },
    },
    {
        id: 'diver',
        label: 'Diver',
        candidates: DIVER_PREFAB_CANDIDATES,
        preserveOriginalMaterial: true,
        swimHeadLiftDegrees: 4,
        sampledActionOverrideDir: TPOSE_ACTION_PROFILE_DIR,
        sampledActionOverrideFilePrefix: 'Tpose_',
        divePrepOverridePath: `${TPOSE_ACTION_PROFILE_DIR}/Tpose_divePrep`,
        dynamicColor: {
            mode: 'whiteKey',
            labelPrefix: 'Diver',
            usesCapChannel: false,
        },
    },
];

export const DEBUG_SWIMMER_MODEL_VARIANTS: SwimmerModelVariant[] = SWIMMER_MODEL_VARIANTS;

export const DEBUG_SWIMMER_ACTION_PREVIEWS: DebugSwimmerActionPreview[] = [
    { id: 'freestyle', label: 'Freestyle', pose: 'freestyle' },
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

export const RESOURCE_PATHS = {
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
    swimmerSplashSprayTexture: 'pool/SwimmerSplashSpray/texture',
    spectatorCameraFlashTexture: 'pool/SpectatorCameraFlash/texture',
    skyboxVariants: SKYBOX_VARIANTS,
    playerOutlineEffect: 'effects/PlayerOutline',
    diveChargeGatherEffect: 'effects/DiveChargeGather',
    laneFloatCutoutEffect: 'effects/LaneFloatCutout',
    swimmerDynamicColorEffect: 'effects/SwimmerDynamicColor',
    toonPropEffect: 'effects/ToonProp',
    underwaterFloorEffect: 'effects/UnderwaterFloorTint',
    venueHeightShadeEffect: 'effects/VenueHeightShade',
    speedStarsUiPrefab: 'ui/SpeedStarsUI',
    loginUi: {
        background: 'ui/paddle-master-login-v8/background/texture',
        logo: 'ui/paddle-master-login-v8/logo/texture',
        primaryButton: 'ui/paddle-master-login-v8/primary-button/texture',
        primaryArrow: 'ui/paddle-master-login-v8/primary-arrow/texture',
        onlineButton: 'ui/paddle-master-login-v8/online-button/texture',
        onlineIcon: 'ui/paddle-master-login-v8/online-icon/texture',
        playerPlate: 'ui/paddle-master-login-v8/player-plate/texture',
        avatar: 'ui/paddle-master-login-v8/avatar/texture',
        settingsPlate: 'ui/paddle-master-login-v8/settings-plate/texture',
        settingsIcon: 'ui/paddle-master-login-v8/settings-icon/texture',
        currencyPlate: 'ui/paddle-master-login-v8/currency-plate/texture',
        currencyIcon: 'ui/paddle-master-login-v8/currency-icon/texture',
        plusIcon: 'ui/paddle-master-login-v8/plus-icon/texture',
    },
    lobbyUi: {
        background: 'ui/lobby-v1/background/texture',
        characterPanel: 'ui/lobby-v1/character-panel/texture',
        skillCard: 'ui/lobby-v1/skill-card/texture',
        characterButton: 'ui/lobby-v1/character-button/texture',
        modeBeginner: 'ui/lobby-v1/mode-beginner/texture',
        modeStandard: 'ui/lobby-v1/mode-standard/texture',
        modeChampionship: 'ui/lobby-v1/mode-championship/texture',
        modeSelectedFrame: 'ui/lobby-v1/mode-selected-frame/texture',
        onlineButton: 'ui/lobby-v1/online-button/texture',
        startButton: 'ui/lobby-v1/start-button/texture',
        topPlayer: 'ui/lobby-v1/top-player/texture',
        topSettings: 'ui/lobby-v1/top-settings/texture',
        topCurrency: 'ui/lobby-v1/top-currency/texture',
    },
    characterUi: {
        background: 'ui/character-v1/background/texture',
        headerBackground: 'ui/character-v1/header-bg/texture',
        backIcon: 'ui/character-v1/back-icon/texture',
        detailPanelBackground: 'ui/character-v1/detail-panel-bg/texture',
        tabAttributes: 'ui/character-v1/tab-attributes/texture',
        tabAppearance: 'ui/character-v1/tab-appearance/texture',
        confirmButton: 'ui/character-v1/confirm-button/texture',
        upgradeButton: 'ui/character-v1/upgrade-button/texture',
        upgradeCurrency: 'ui/character-v1/upgrade-currency/texture',
        statRow: 'ui/character-v1/stat-row/texture',
        skillHeader: 'ui/character-v1/skill-header/texture',
        statHp: 'ui/character-v1/stat-hp/texture',
        statTechnique: 'ui/character-v1/stat-technique/texture',
        statBurst: 'ui/character-v1/stat-burst/texture',
        statArrow: 'ui/character-v1/stat-arrow/texture',
        levelPill: 'ui/character-v1/level-pill/texture',
        cardFrame: 'ui/character-v1/card-base/texture',
        cardSelected: 'ui/character-v1/card-selected/texture',
        portraitBlue: 'ui/character-v1/portrait-blue/texture',
        portraitRed: 'ui/character-v1/portrait-red/texture',
        lockIcon: 'ui/character-v1/lock-icon/texture',
        statusActive: 'ui/character-v1/status-active/texture',
        skinWarm: 'ui/character-v1/skin-warm/texture',
        skinDeep: 'ui/character-v1/skin-deep/texture',
        swatchRed: 'ui/character-v1/swatch-red/texture',
        swatchBlue: 'ui/character-v1/swatch-blue/texture',
        swatchYellow: 'ui/character-v1/swatch-yellow/texture',
        swatchPurple: 'ui/character-v1/swatch-purple/texture',
        swatchGreen: 'ui/character-v1/swatch-green/texture',
        swatchOrange: 'ui/character-v1/swatch-orange/texture',
        swatchCyan: 'ui/character-v1/swatch-cyan/texture',
        swatchBlack: 'ui/character-v1/swatch-black/texture',
    },
    prepareRaceBackground: 'ui/prepare-race/locker-room-lowpoly-bg/texture',
    sampledActionsDir: TPOSE_ACTION_PROFILE_DIR,
    sampledActionsFilePrefix: 'Tpose_',
    music: {
        bundle: 'music',
        login: 'login_ripples',
        race: 'race_current',
        result: 'result_sunlit_podium',
        strokeSfx: [
            'sfx/stroke_water_01',
        ],
    },
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
