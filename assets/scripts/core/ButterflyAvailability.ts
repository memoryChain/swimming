import type { MainGameLaunchMode } from './GameLaunchOptions';

/** 本地比赛共用泳姿，不受模式或调试页限制；模型预览及尚未接入协议的联机保持隔离。 */
export function resolveButterflyAvailability(launch: MainGameLaunchMode,
    networked: boolean, room: boolean): boolean {
    if (networked || room) return false;
    return launch === 'race' || launch === 'ai-debug';
}
