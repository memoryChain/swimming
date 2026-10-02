import type { PlayerCharacterId } from '../app/PlayerCharacterConfig';
import type { RaceDifficulty } from '../core/GameBalance';
import { AI_INTELLIGENCE, AiIntelligenceId } from './AiRaceConfig';
import type { AiRosterEntry } from './CompetitorConfig';

export type BossPolicy = 'muscle' | 'duel' | 'dive' | 'endurance' | 'wall' | 'combo' | 'allstar';
export type BossRole = 'leader' | 'guard' | 'diver' | 'hopper' | 'wall' | 'pace' | 'chaser';
export interface BossSlot { characterId: PlayerCharacterId; level: number; skill: AiIntelligenceId; role: BossRole; name: string; }
export interface BossTeamTactics {
    joinRange: number; assemblySeconds: number; releaseSeconds: number;
    stagingWidth: number; reserveWidth: number; forwardGap: number; paceResponse: number;
    wallAssemblyRange: number; wallPressRange: number;
}
export interface BossPreset {
    id: string; name: string; policy: BossPolicy; mode: RaceDifficulty; distance: 200 | 400;
    qualifyPlace: number; hint: string; roster: readonly BossSlot[];
    pressureCount: number; prepareSeconds: number; pressSeconds: number; restSeconds: number;
    team: Readonly<BossTeamTactics>;
}
const slot = (characterId: PlayerCharacterId, level: number, skill: AiIntelligenceId, role: BossRole, name: string): BossSlot =>
    ({ characterId, level, skill, role, name });
const MUSCLE_TEAM_NAMES = ['铁臂阿彪', '磐石大山', '钢肩阿宽', '举铁老杜', '杠铃小满', '大力阿岳', '巨掌阿壮'] as const;
const muscles = (advanced: boolean): BossSlot[] => Array.from({ length: 7 }, (_, i) =>
    slot('muscleMan', advanced ? 30 : i === 0 ? 5 : i < 3 ? 4 : 3,
        advanced ? 'expert' : i === 0 ? 'normal' : i < 3 ? 'rookie' : 'learner',
        i === 0 ? 'leader' : 'guard', MUSCLE_TEAM_NAMES[i]));
const preset = (id: string, name: string, policy: BossPolicy, distance: 200 | 400, qualifyPlace: number,
    hint: string, roster: readonly BossSlot[], pressureCount = 1): BossPreset => ({
    id, name, policy, distance, qualifyPlace, hint, roster, pressureCount,
    mode: policy === 'duel' || policy === 'combo' ? 'beginner' : distance === 400 ? 'championship' : 'competitive',
    prepareSeconds: pressureCount > 1 ? 0.6 : 0.8, pressSeconds: pressureCount > 1 ? 3 : 2,
    restSeconds: pressureCount > 1 ? 4 : 6,
    team: { joinRange: 18, assemblySeconds: 10, releaseSeconds: 2,
        stagingWidth: 1.9, reserveWidth: 3.8, forwardGap: 1.6, paceResponse: 0.55,
        wallAssemblyRange: 35, wallPressRange: 22 },
});

/** 仅供AI调试体验；生涯、快速赛、好友房均不读取此表。 */
export const BOSS_AI_PRESETS: readonly BossPreset[] = [
    preset('club-muscles', '铁臂兄弟团', 'muscle', 200, 4, '阿彪带队轮流卡位。抓住交班空隙，从空侧穿过去。', muscles(false)),
    preset('city-ninja', '静水擂台', 'duel', 200, 1, '无痕每一划都讲究时机。稳住自己的节奏，把余力留到最后。', [slot('cartonSwimmer10', 10, 'skilled', 'leader', '静水无痕')], 0),
    preset('region-dive', '深蓝穿梭团', 'dive', 200, 3, '老鲨带潜水哥开路，阿跃和阿跳趁机穿行。看准水面空隙，别跟着扎堆。', [
        slot('cartonSwimmer13', 16, 'expert', 'leader', '深蓝老鲨'), slot('cartonSwimmer13', 14, 'skilled', 'diver', '气泡阿潜'),
        slot('cartonSwimmer13', 14, 'skilled', 'diver', '小潜艇'), slot('cartonSwimmer8', 14, 'skilled', 'hopper', '弹簧阿跃'),
        slot('cartonSwimmer8', 13, 'skilled', 'hopper', '浪花阿跳'), slot('cartonSwimmer9', 12, 'normal', 'pace', '猫步桃桃'),
        slot('cartonSwimmer16', 12, 'normal', 'pace', '霓虹小柚'),
    ], 0),
    preset('region-endurance', '不打烊泳队', 'endurance', 400, 1, '老秦慢拍领游，两位机甲轮流接班。前半程省些力，后半程再争先。', [
        slot('cartonSwimmer11', 17, 'expert', 'leader', '慢拍老秦'), slot('cartonSwimmer15', 16, 'skilled', 'guard', '铁罐阿周'),
        slot('cartonSwimmer15', 16, 'skilled', 'guard', '铆钉小洛'), slot('cartonSwimmer5', 14, 'normal', 'pace', '长腿可可'),
        slot('cartonSwimmer5', 14, 'normal', 'pace', '踏浪小晴'), slot('cartonSwimmer6', 14, 'normal', 'pace', '小夏同学'),
        slot('cartonSwimmer6', 14, 'normal', 'pace', '水花小米'),
    ]),
    preset('master-wall', '池壁弹射队', 'wall', 200, 3, '阿飞一蹬墙就来劲，侧翼还会替他让路。池段中间，是你追回来的机会。', [
        slot('cartonSwimmer12', 24, 'expert', 'leader', '弹射阿飞'), slot('cartonSwimmer12', 23, 'expert', 'wall', '回旋小林'),
        slot('cartonSwimmer12', 22, 'expert', 'wall', '追浪阿迅'), slot('cartonSwimmer5', 23, 'expert', 'guard', '长腿可可'),
        slot('cartonSwimmer5', 20, 'normal', 'pace', '踏浪小晴'), slot('cartonSwimmer9', 20, 'normal', 'pace', '猫步桃桃'),
        slot('cartonSwimmer6', 21, 'skilled', 'pace', '小夏同学'),
    ], 2),
    preset('master-combo', '风火不掉拍', 'combo', 400, 1, '阿焰越划越顺。守住自己的节奏，趁他掉拍或放慢时追上去。', [slot('cartonSwimmer14', 25, 'expert', 'leader', '追风阿焰')], 0),
    preset('champion-muscles', '铁臂团·返场', 'muscle', 200, 3, '阿彪和老队友们回来认真游了。前卫封路、侧翼接应，找准交班空隙突围。', muscles(true), 2),
    preset('champion-allstar', '浪尖邀请赛', 'allstar', 400, 1, '小柚召集了熟悉的老对手。卡位、潜航和出墙轮番配合，抢下最后的头名。', [
        slot('cartonSwimmer16', 30, 'expert', 'leader', '霓虹小柚'), slot('muscleMan', 30, 'expert', 'guard', MUSCLE_TEAM_NAMES[0]),
        slot('cartonSwimmer12', 30, 'expert', 'wall', '弹射阿飞'), slot('cartonSwimmer13', 30, 'expert', 'diver', '深蓝老鲨'),
        slot('cartonSwimmer15', 30, 'expert', 'guard', '铁罐阿周'), slot('cartonSwimmer10', 30, 'expert', 'chaser', '静水无痕'),
        slot('cartonSwimmer14', 30, 'expert', 'chaser', '追风阿焰'),
    ], 2),
];
export function findBossPreset(id: string | null | undefined): BossPreset | null {
    return BOSS_AI_PRESETS.find(p => p.id === id) ?? null;
}
export function bossRoster(preset: BossPreset): AiRosterEntry[] {
    return preset.roster.map(s => ({ name: s.name, profile: { characterId: s.characterId, level: s.level,
        intelligence: s.skill, difficulty: AI_INTELLIGENCE[s.skill].value } }));
}
