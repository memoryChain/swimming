import type { PlayerCharacterId } from '../app/PlayerCharacterConfig';
import type { RaceDifficulty } from './GameBalance';

export type MainGameLaunchMode = 'race' | 'model-debug' | 'ai-debug' | 'underwater-debug';

export interface AiDebugSetup {
    characterId: PlayerCharacterId;
    level: number;
    mode: RaceDifficulty;
    seed: number;
    opponentCount: 1 | 7;
    mixedCharacters: boolean;
}
const pendingAiDebugSetup: AiDebugSetup = { characterId: 'cartonSwimmer6', level: 1, mode: 'beginner', seed: 20260913,
    opponentCount: 7, mixedCharacters: true };
export function getAiDebugSetup(): Readonly<AiDebugSetup> { return pendingAiDebugSetup; }
export function setAiDebugSetup(setup: AiDebugSetup) {
    pendingAiDebugSetup.characterId = setup.characterId;
    pendingAiDebugSetup.level = Number.isFinite(setup.level) ? Math.max(1, Math.min(30, Math.floor(setup.level))) : 1;
    pendingAiDebugSetup.mode = setup.mode;
    pendingAiDebugSetup.seed = setup.seed >>> 0;
    pendingAiDebugSetup.opponentCount = setup.opponentCount === 7 ? 7 : 1;
    pendingAiDebugSetup.mixedCharacters = setup.mixedCharacters === true;
}

/** 只在本地 AI 测试赛使用；所有对手共用所选等级和智力，多角色沿用赛事随机阵容。 */
export function resolveAiDebugBuildOptions(setup: Readonly<AiDebugSetup>, primaryLane: number, difficulty: number) {
    return {
        soloLane: setup.opponentCount === 1 ? primaryLane : undefined,
        difficultyOverride: difficulty,
        characterId: setup.opponentCount === 7 && setup.mixedCharacters ? undefined : setup.characterId,
        level: setup.level,
    };
}

let pendingLaunchMode: MainGameLaunchMode = 'race';
// 测试赛智力（0..1），与角色等级、对手人数分开设置。
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
let pendingReturnToLobby = false;

/** 结算的“返回大厅”跳过开游封面；仅消费一次，不影响首次启动。 */
export function setReturnToLobby(value: boolean) { pendingReturnToLobby = value; }
export function consumeReturnToLobby(): boolean {
    const value = pendingReturnToLobby;
    pendingReturnToLobby = false;
    return value;
}

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
