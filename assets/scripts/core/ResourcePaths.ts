export type SwimmerModelVariant = {
    id: string;
    label: string;
    candidates: string[];
    preserveOriginalMaterial?: boolean;
    raceModelYOffset?: number;
    swimHeadLiftDegrees?: number;
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
    speedStarsUiPrefab: 'ui/SpeedStarsUI',
};

export function findSwimmerModelVariant(id: string): SwimmerModelVariant | null {
    return SWIMMER_MODEL_VARIANTS.find((variant) => variant.id === id) ?? null;
}

export function defaultSwimmerModelVariant(): SwimmerModelVariant {
    return SWIMMER_MODEL_VARIANTS[0];
}

export const ANIMATION_CLIPS = {
    freestyle: 'FreestyleFull',
};
