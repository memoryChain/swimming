export type SwimmerModelVariant = {
    id: string;
    label: string;
    candidates: string[];
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
];

export const RESOURCE_PATHS = {
    swimmerPrefabCandidates: DEFAULT_SWIMMER_PREFAB_CANDIDATES,
    swimmerModelVariants: SWIMMER_MODEL_VARIANTS,
    poolPrefab: 'pool/PoolScene',
    poolWaterMaterial: 'pool/RagingPoolWater',
    swimmerSplashMaterial: 'pool/SwimmerSplash',
    playerOutlineEffect: 'effects/PlayerOutline',
    swimmerPerfectGlowEffect: 'effects/SwimmerPerfectGlow',
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
