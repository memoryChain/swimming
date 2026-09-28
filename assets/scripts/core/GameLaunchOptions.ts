import type { PlayerCharacterId } from '../app/PlayerCharacterConfig';
import { sys } from 'cc';
import type { RaceModeId } from './GameBalance';
import type { WhirlpoolSpawnSelection } from './WhirlpoolBrawlRules';
import type { ObstacleLayout } from './ObstacleBrawlRules';
import { normalizeEntertainmentRaceGrade, type EntertainmentRaceGrade } from './EntertainmentRacePlan';
import { ENTERTAINMENT_TEST_COMBINATIONS, EntertainmentIntensity,
    EntertainmentTestCombination, normalizeEntertainmentIntensity } from './EntertainmentIntensity';

export type MainGameLaunchMode = 'race' | 'model-debug' | 'ai-debug' | 'underwater-debug';

export interface AiDebugSetup {
    giantWavePreset?: 'three' | 'single';
    /** 两个新单项各自记住选择；开赛仍由 entertainmentIntensity 传递本局有效档位。 */
    giantWaveIntensity?: EntertainmentIntensity;
    geyserIntensity?: EntertainmentIntensity;
    characterId: PlayerCharacterId;
    level: number;
    mode: RaceModeId;
    seed: number;
    opponentCount: 1 | 7;
    mixedCharacters: boolean;
    whirlpoolSelection: WhirlpoolSpawnSelection;
    /** null 表示原规格回归；五档仅在本地调试比赛生效。 */
    entertainmentIntensity?: EntertainmentIntensity | null;
    /** 综合娱乐整局档位；与单项测试强度独立。 */
    entertainmentRaceGrade?: EntertainmentRaceGrade;
    entertainmentEventIntensities?: readonly EntertainmentIntensity[];
    entertainmentTestCombination?: EntertainmentTestCombination | null;
    obstacleLayout?: ObstacleLayout;
    raceDistance?: 200 | 400;
}
const pendingAiDebugSetup: AiDebugSetup = { characterId: 'cartonSwimmer6', level: 1, mode: 'beginner', seed: 20260913,
    opponentCount: 7, mixedCharacters: true, whirlpoolSelection: 'random', entertainmentIntensity: null,
    entertainmentRaceGrade: 3,
    entertainmentEventIntensities: [3, 3, 3, 3, 3, 3, 3, 1, 3, 3], entertainmentTestCombination: null,
    obstacleLayout: 'mixed', raceDistance: 200 };
export function getAiDebugSetup(): Readonly<AiDebugSetup> { return pendingAiDebugSetup; }

const ENTERTAINMENT_GRADE_STORAGE_KEY = 'speed-swimming.entertainment-grade.v1';
function loadEntertainmentRaceGrade(): EntertainmentRaceGrade {
    try { return normalizeEntertainmentRaceGrade(Number(sys.localStorage.getItem(ENTERTAINMENT_GRADE_STORAGE_KEY))) ?? 3; }
    catch { return 3; }
}
let selectedEntertainmentRaceGrade: EntertainmentRaceGrade = loadEntertainmentRaceGrade();
export function getEntertainmentRaceGrade(): EntertainmentRaceGrade { return selectedEntertainmentRaceGrade; }
export function setEntertainmentRaceGrade(value: number): void {
    selectedEntertainmentRaceGrade = normalizeEntertainmentRaceGrade(value) ?? 3;
    try { sys.localStorage.setItem(ENTERTAINMENT_GRADE_STORAGE_KEY, String(selectedEntertainmentRaceGrade)); }
    catch { /* 本地存储不可用时仅保留本次会话选择。 */ }
}
export function setAiDebugSetup(setup: AiDebugSetup) {
    pendingAiDebugSetup.giantWavePreset = setup.giantWavePreset === 'single' ? 'single' : 'three';
    pendingAiDebugSetup.giantWaveIntensity = (setup.mode === 'giant-wave-brawl'
        ? normalizeEntertainmentIntensity(setup.entertainmentIntensity) : null)
        ?? normalizeEntertainmentIntensity(setup.giantWaveIntensity) ?? pendingAiDebugSetup.giantWaveIntensity ?? 3;
    pendingAiDebugSetup.geyserIntensity = (setup.mode === 'geyser-brawl'
        ? normalizeEntertainmentIntensity(setup.entertainmentIntensity) : null)
        ?? normalizeEntertainmentIntensity(setup.geyserIntensity) ?? pendingAiDebugSetup.geyserIntensity ?? 2;
    pendingAiDebugSetup.characterId = setup.characterId;
    pendingAiDebugSetup.level = Number.isFinite(setup.level) ? Math.max(1, Math.min(30, Math.floor(setup.level))) : 1;
    const oldBuoyMode = setup.mode === 'minefield-brawl';
    const oldDebrisMode = setup.mode === 'litter-brawl';
    pendingAiDebugSetup.mode = oldBuoyMode || oldDebrisMode ? 'obstacle-brawl' : setup.mode;
    pendingAiDebugSetup.seed = setup.seed >>> 0;
    pendingAiDebugSetup.opponentCount = setup.opponentCount === 7 ? 7 : 1;
    pendingAiDebugSetup.mixedCharacters = setup.mixedCharacters === true;
    pendingAiDebugSetup.whirlpoolSelection = setup.whirlpoolSelection === 'normal' || setup.whirlpoolSelection === 'super'
        ? setup.whirlpoolSelection
        : 'random';
    pendingAiDebugSetup.entertainmentIntensity = setup.mode === 'turtle-bus-brawl' ? null
        : setup.mode === 'giant-wave-brawl' ? pendingAiDebugSetup.giantWaveIntensity
        : setup.mode === 'geyser-brawl' ? pendingAiDebugSetup.geyserIntensity
        : normalizeEntertainmentIntensity(setup.entertainmentIntensity);
    pendingAiDebugSetup.entertainmentRaceGrade = normalizeEntertainmentRaceGrade(setup.entertainmentRaceGrade) ?? 3;
    pendingAiDebugSetup.entertainmentEventIntensities = Array.from({ length: 10 }, (_, index) => index === 7 ? 1 :
        normalizeEntertainmentIntensity(setup.entertainmentEventIntensities?.[index]) ?? 3);
    pendingAiDebugSetup.entertainmentTestCombination = ENTERTAINMENT_TEST_COMBINATIONS.find(
        preset => preset.id === setup.entertainmentTestCombination)?.id ?? null;
    pendingAiDebugSetup.obstacleLayout = oldBuoyMode ? 'buoy' : oldDebrisMode ? 'debris'
        : setup.obstacleLayout === 'debris' || setup.obstacleLayout === 'buoy'
            ? setup.obstacleLayout : 'mixed';
    pendingAiDebugSetup.raceDistance = setup.raceDistance === 400 ? 400 : 200;
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
let pendingRoomRaceDistance: 200 | 400 = 200;
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

export function setRoomRaceDistance(value: 200 | 400) {
    pendingRoomRaceDistance = value === 400 ? 400 : 200;
}

export function consumeRoomRaceDistance(): 200 | 400 {
    const value = pendingRoomRaceDistance;
    pendingRoomRaceDistance = 200;
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
