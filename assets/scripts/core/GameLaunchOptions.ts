export type MainGameLaunchMode = 'race' | 'model-debug' | 'free-swim';

let pendingLaunchMode: MainGameLaunchMode = 'race';

export function setMainGameLaunchMode(mode: MainGameLaunchMode) {
    pendingLaunchMode = mode;
}

export function consumeMainGameLaunchMode(): MainGameLaunchMode {
    const mode = pendingLaunchMode;
    pendingLaunchMode = 'race';
    return mode;
}
