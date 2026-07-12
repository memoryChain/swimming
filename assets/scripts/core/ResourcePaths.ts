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
};

export type SwimmerColorVariant = {
    id: string;
    label: string;
    suit?: readonly [number, number, number];
    cap?: readonly [number, number, number];
};

export type DebugSwimmerActionPose = 'divePrep' | 'freestyle' | 'breaststroke' | 'sampledAction';

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

const DEFAULT_SWIMMER_PREFAB_CANDIDATES = [
    'models/UserSwimmerLow',
    'models/UserSwimmerLow/UserSwimmerLow',
];

export const SWIMMER_MODEL_VARIANTS: SwimmerModelVariant[] = [
    {
        id: 'default',
        label: 'Default',
        candidates: DEFAULT_SWIMMER_PREFAB_CANDIDATES,
    },
    {
        id: 'newMan01',
        label: 'New Man 01',
        candidates: [
            'models/UserSwimmerNewMan01',
            'models/UserSwimmerNewMan01/UserSwimmerNewMan01',
        ],
    },
    {
        id: 'swimmer04',
        label: 'Swimmer 04',
        candidates: [
            'models/UserSwimmer04',
            'models/UserSwimmer04/UserSwimmer04',
        ],
        swimHeadLiftDegrees: 4,
    },
    {
        id: 'swimmer04Original',
        label: 'Swimmer 04 Original',
        candidates: [
            'models/UserSwimmer04Original',
            'models/UserSwimmer04Original/UserSwimmer04Original',
        ],
        preserveOriginalMaterial: true,
        swimHeadLiftDegrees: 4,
    },
    {
        id: 'swimmer0621_2',
        label: 'Swimmer 0621-2',
        candidates: [
            'models/UserSwimmer0621_2',
            'models/UserSwimmer0621_2/UserSwimmer0621_2',
        ],
        preserveOriginalMaterial: true,
        swimHeadLiftDegrees: 4,
    },
    {
        id: 'swimmer0621_2_mixamoSwimming',
        label: 'Mixamo Swimming',
        candidates: [
            'models/UserSwimmer0621_2MixamoSwimming',
            'models/UserSwimmer0621_2MixamoSwimming/UserSwimmer0621_2MixamoSwimming',
        ],
        debugOnly: true,
        preserveOriginalMaterial: true,
        raceModelEulerDegrees: [0, 90, 0],
        swimHeadLiftDegrees: 4,
    },
    {
        id: 'swimmer0621_2_breaststrokeProc',
        label: 'Tread Water Proc',
        candidates: [
            'models/UserSwimmer0621_2',
            'models/UserSwimmer0621_2/UserSwimmer0621_2',
        ],
        debugOnly: true,
        preserveOriginalMaterial: true,
        debugPose: 'breaststroke',
        raceModelYOffset: -0.88,
        raceModelEulerDegrees: [0, 90, 0],
        swimHeadLiftDegrees: 6,
    },
    {
        id: 'swimmer0621_2_divePrepPose',
        label: 'Dive Prep Pose',
        candidates: [
            'models/UserSwimmer0621_2',
            'models/UserSwimmer0621_2/UserSwimmer0621_2',
        ],
        debugOnly: true,
        preserveOriginalMaterial: true,
        debugPose: 'divePrep',
        raceModelEulerDegrees: [0, 90, 0],
        swimHeadLiftDegrees: 4,
    },
];

export const DEBUG_SWIMMER_MODEL_VARIANTS: SwimmerModelVariant[] = SWIMMER_MODEL_VARIANTS.filter((variant) =>
    variant.id === 'swimmer0621_2'
);

export const DEBUG_SWIMMER_ACTION_PREVIEWS: DebugSwimmerActionPreview[] = [
    { id: 'waving', label: 'Waving', pose: 'sampledAction', sampledActionId: 'waving' },
];

export const SWIMMER_0621_2_COLOR_VARIANTS: SwimmerColorVariant[] = [
    { id: 'original', label: 'Original' },
    { id: 'redBlue', label: 'Red / Blue', suit: [240, 68, 58], cap: [22, 119, 232] },
    { id: 'blueWhite', label: 'Blue / White', suit: [23, 109, 218], cap: [245, 238, 220] },
    { id: 'blackYellow', label: 'Black / Yellow', suit: [36, 42, 53], cap: [255, 209, 42] },
    { id: 'greenOrange', label: 'Green / Orange', suit: [32, 196, 106], cap: [255, 121, 38] },
    { id: 'purpleCyan', label: 'Purple / Cyan', suit: [139, 77, 255], cap: [35, 220, 232] },
    { id: 'orangeNavy', label: 'Orange / Navy', suit: [255, 137, 38], cap: [24, 60, 143] },
    { id: 'pinkMint', label: 'Pink / Mint', suit: [240, 59, 168], cap: [98, 237, 178] },
    { id: 'cyanRed', label: 'Cyan / Red', suit: [24, 199, 216], cap: [240, 68, 80] },
    { id: 'yellowPurple', label: 'Yellow / Purple', suit: [244, 201, 54], cap: [120, 71, 216] },
    { id: 'whiteRed', label: 'White / Red', suit: [241, 238, 227], cap: [217, 49, 73] },
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
    swimmerPrefabCandidates: DEFAULT_SWIMMER_PREFAB_CANDIDATES,
    swimmerModelVariants: SWIMMER_MODEL_VARIANTS,
    poolPrefab: 'pool/PoolScene',
    poolWaterMaterial: 'pool/RagingPoolWater',
    swimmerSplashMaterial: 'pool/SwimmerSplash',
    skyboxVariants: SKYBOX_VARIANTS,
    playerOutlineEffect: 'effects/PlayerOutline',
    swimmerPerfectGlowEffect: 'effects/SwimmerPerfectGlow',
    swimmerDynamicColorEffect: 'effects/SwimmerDynamicColor',
    swimmer0621ColorMask: 'models/UserSwimmer0621_2ColorMask/texture',
    speedStarsUiPrefab: 'ui/SpeedStarsUI',
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

export function findSwimmer0621ColorVariant(id: string): SwimmerColorVariant | null {
    return SWIMMER_0621_2_COLOR_VARIANTS.find((variant) => variant.id === id) ?? null;
}

export function defaultSwimmer0621ColorVariant(): SwimmerColorVariant {
    return SWIMMER_0621_2_COLOR_VARIANTS[0];
}

export const ANIMATION_CLIPS = {
    freestyle: 'FreestyleFull',
};
