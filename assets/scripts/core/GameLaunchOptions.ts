export type MainGameLaunchMode = 'race' | 'model-debug' | 'flipturn-debug' | 'ai-debug';

let pendingLaunchMode: MainGameLaunchMode = 'race';
// Difficulty (0..1) chosen for the 100m AI-debug 1v1 mode. Set from the login
// picker just before the MainGame scene loads; consumed once by GameManager.
let pendingAiDebugDifficulty = 0.8;

export function setMainGameLaunchMode(mode: MainGameLaunchMode) {
    pendingLaunchMode = mode;
}

export function consumeMainGameLaunchMode(): MainGameLaunchMode {
    const mode = pendingLaunchMode;
    pendingLaunchMode = 'race';
    return mode;
}

export function setAiDebugDifficulty(difficulty: number) {
    pendingAiDebugDifficulty = Math.max(0, Math.min(1, difficulty));
}

export function getAiDebugDifficulty(): number {
    return pendingAiDebugDifficulty;
}
