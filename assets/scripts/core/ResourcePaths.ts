import type { SampledActionId } from '../character/SampledActionMotionCurve';

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

export const SWIMMER_MODEL_VARIANTS: SwimmerModelVariant[] = [
    {
        id: 'muscleMan',
        label: 'Muscle Man',
        candidates: MUSCLE_MAN_PREFAB_CANDIDATES,
        modelScaleMultiplier: 1.12,
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
        id: 'cartonSwimmer5',
        label: '逐浪少女',
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
            labelPrefix: '逐浪少女',
            usesCapChannel: false,
        },
    },
    {
        id: 'cartonSwimmer6',
        label: '跃浪少女',
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
            labelPrefix: '跃浪少女',
            usesCapChannel: false,
        },
    },
    {
        id: 'cartonSwimmer8',
        label: '蛙跃潮童',
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
            labelPrefix: '蛙跃潮童',
            usesCapChannel: false,
        },
    },
    {
        id: 'cartonSwimmer9',
        label: '霓光灵猫',
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
            labelPrefix: '霓光灵猫',
            usesCapChannel: false,
        },
    },
    {
        id: 'cartonSwimmer10',
        label: '青影忍浪',
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
            labelPrefix: '青影忍浪',
            usesCapChannel: false,
        },
    },
    {
        id: 'cartonSwimmer11',
        label: '疾风浪客',
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
            labelPrefix: '疾风浪客',
            usesCapChannel: false,
        },
    },
    {
        id: 'cartonSwimmer12',
        label: '绿电潮童',
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
            labelPrefix: '绿电潮童',
            usesCapChannel: false,
        },
    },
    {
        id: 'cartonSwimmer13',
        label: '深潜先锋',
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
            labelPrefix: '深潜先锋',
            usesCapChannel: false,
        },
    },
    {
        id: 'cartonSwimmer14',
        label: '霓绿少女',
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
            labelPrefix: '霓绿少女',
            usesCapChannel: false,
        },
    },
    // 新机甲沿用唯一标准动作集；遮罩只控制绿甲，不把白甲或关节当肤色。
    {
        id: 'cartonSwimmer15',
        label: '破浪机甲',
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
            labelPrefix: '破浪机甲',
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
    uiFonts: {
        regular: 'fonts/ShuiMasterUI-Regular',
        semibold: 'fonts/ShuiMasterUI-SemiBold',
    },
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
    settlementUi: {
        shade: 'ui/settlement-v1/right-shade/texture',
        honors: [
            'ui/settlement-v1/honor-gold/texture', 'ui/settlement-v1/honor-silver/texture',
            'ui/settlement-v1/honor-bronze/texture', 'ui/settlement-v1/honor-normal/texture',
        ],
        medals: [
            'ui/settlement-v1/medal-gold/texture', 'ui/settlement-v1/medal-silver/texture',
            'ui/settlement-v1/medal-bronze/texture', 'ui/settlement-v1/medal-normal/texture',
        ],
        rows: [
            'ui/settlement-v1/row-gold/texture', 'ui/settlement-v1/row-silver/texture',
            'ui/settlement-v1/row-bronze/texture', 'ui/settlement-v1/row-normal/texture',
        ],
        self: 'ui/settlement-v1/row-self/texture',
        header: 'ui/settlement-v1/table-header/texture',
        wave: 'ui/settlement-v1/wave/texture',
    },
    onlineRoomUi: {
        hostPanel: 'ui/online-room-v1/host-panel/texture',
        membersPanel: 'ui/online-room-v1/members-panel/texture',
        memberHost: 'ui/online-room-v1/member-host/texture',
        memberReady: 'ui/online-room-v1/member-ready/texture',
        memberIdle: 'ui/online-room-v1/member-idle/texture',
        memberEmpty: 'ui/online-room-v1/member-empty/texture',
        badgeHost: 'ui/online-room-v1/badge-host/texture',
        badgeReady: 'ui/online-room-v1/badge-ready/texture',
        badgeIdle: 'ui/online-room-v1/badge-idle/texture',
        avatarRing: 'ui/online-room-v1/avatar-ring/texture',
        exitButton: 'ui/online-room-v1/exit-button/texture',
        cancelReady: 'ui/online-room-v1/cancel-ready/texture',
        modePanel: 'ui/online-room-v1/mode-panel/texture',
        popup: 'ui/online-room-v1/popup/texture',
        dangerButton: 'ui/online-room-v1/danger-button/texture',
        drawer: 'ui/online-room-v1/drawer/texture',
    },
    avatarPickerUi: {
        panel: 'ui/avatar-picker-v1/panel/texture',
        avatarBase: 'ui/avatar-picker-v1/avatar-base/texture',
        selectedRing: 'ui/avatar-picker-v1/selected-ring/texture',
        selectedCheck: 'ui/avatar-picker-v1/selected-check/texture',
        nicknameRow: 'ui/avatar-picker-v1/nickname-row/texture',
        nicknameField: 'ui/avatar-picker-v1/nickname-field/texture',
        refreshIcon: 'ui/avatar-picker-v1/refresh-icon/texture',
        cancelButton: 'ui/avatar-picker-v1/button-cancel/texture',
        confirmButton: 'ui/avatar-picker-v1/button-confirm/texture',
        avatars: [
            'ui/avatar-picker-v1/avatar-01-female-diver/texture',
            'ui/avatar-picker-v1/avatar-02-future-girl/texture',
            'ui/avatar-picker-v1/avatar-03-courier-boy/texture',
            'ui/avatar-picker-v1/avatar-04-skater-boy/texture',
            'ui/avatar-picker-v1/avatar-05-short-hair-girl/texture',
            'ui/avatar-picker-v1/avatar-06-muscle-man/texture',
            'ui/avatar-picker-v1/avatar-07-frog-girl/texture',
            'ui/avatar-picker-v1/avatar-08-frog-boy-yellow/texture',
            'ui/avatar-picker-v1/avatar-09-frog-boy-lime/texture',
            'ui/avatar-picker-v1/avatar-10-lifeguard-girl/texture',
        ] as const,
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
        portraits: {
            cartonSwimmer6: 'ui/character-v1/portrait-cartonSwimmer6/texture',
            cartonSwimmer8: 'ui/character-v1/portrait-cartonSwimmer8/texture',
            cartonSwimmer5: 'ui/character-v1/portrait-cartonSwimmer5/texture',
            cartonSwimmer9: 'ui/character-v1/portrait-cartonSwimmer9/texture',
            cartonSwimmer10: 'ui/character-v1/portrait-cartonSwimmer10/texture',
            cartonSwimmer11: 'ui/character-v1/portrait-cartonSwimmer11/texture',
            cartonSwimmer12: 'ui/character-v1/portrait-cartonSwimmer12/texture',
            cartonSwimmer13: 'ui/character-v1/portrait-cartonSwimmer13/texture',
            cartonSwimmer14: 'ui/character-v1/portrait-cartonSwimmer14/texture',
            cartonSwimmer15: 'ui/character-v1/portrait-cartonSwimmer15/texture',
            muscleMan: 'ui/character-v1/portrait-muscleMan/texture',
        },
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
