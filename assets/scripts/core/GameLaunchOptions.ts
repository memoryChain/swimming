export type MainGameLaunchMode = 'race' | 'model-debug';

let pendingLaunchMode: MainGameLaunchMode = 'race';

export function setMainGameLaunchMode(mode: MainGameLaunchMode) {
    pendingLaunchMode = mode;
}

export function consumeMainGameLaunchMode(): MainGameLaunchMode {
    const mode = pendingLaunchMode;
    pendingLaunchMode = 'race';
    return mode;
}
