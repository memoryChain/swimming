export type MainGameLaunchMode = 'race' | 'model-debug' | 'ai-debug';

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

// Room mode: the next race was launched from the online room. GameManager reads it
// to show only an "exit" action (no replay) on the finish screen.
let pendingRoomMode = false;
// Set when a room-mode race exits back to Login, so LoginManager re-opens the room.
let pendingReturnToRoom = false;

export function setRoomMode(value: boolean) {
    pendingRoomMode = value;
}

export function consumeRoomMode(): boolean {
    const value = pendingRoomMode;
    pendingRoomMode = false;
    return value;
}

export function setReturnToRoom(value: boolean) {
    pendingReturnToRoom = value;
}

export function consumeReturnToRoom(): boolean {
    const value = pendingReturnToRoom;
    pendingReturnToRoom = false;
    return value;
}
