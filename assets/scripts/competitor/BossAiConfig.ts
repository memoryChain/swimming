import type { PlayerCharacterId } from '../app/PlayerCharacterConfig';
import type { RaceDifficulty } from '../core/GameBalance';
import { AI_INTELLIGENCE, AiIntelligenceId } from './AiRaceConfig';
import type { AiRosterEntry } from './CompetitorConfig';

export type BossPolicy = 'muscle' | 'duel' | 'dive' | 'endurance' | 'wall' | 'combo' | 'allstar';
export type BossRole = 'leader' | 'guard' | 'diver' | 'hopper' | 'wall' | 'pace' | 'chaser';
export interface BossSlot { characterId: PlayerCharacterId; level: number; skill: AiIntelligenceId; role: BossRole; name: string; }
export interface BossPreset {
    id: string; name: string; policy: BossPolicy; mode: RaceDifficulty; distance: 200 | 400;
    qualifyPlace: number; hint: string; roster: readonly BossSlot[];
    pressureCount: number; prepareSeconds: number; pressSeconds: number; restSeconds: number;
}
const slot = (characterId: PlayerCharacterId, level: number, skill: AiIntelligenceId, role: BossRole, name: string): BossSlot =>
    ({ characterId, level, skill, role, name });
const muscles = (advanced: boolean): BossSlot[] => Array.from({ length: 7 }, (_, i) =>
    slot('muscleMan', advanced ? 30 : i === 0 ? 5 : i < 3 ? 4 : 3,
        advanced ? 'expert' : i === 0 ? 'normal' : i < 3 ? 'rookie' : 'learner',
        i === 0 ? 'leader' : 'guard', i === 0 ? '铁臂队长' : `铁臂队员${i}`));
const preset = (id: string, name: string, policy: BossPolicy, distance: 200 | 400, qualifyPlace: number,
    hint: string, roster: readonly BossSlot[], pressureCount = 1): BossPreset => ({
    id, name, policy, distance, qualifyPlace, hint, roster, pressureCount,
    mode: policy === 'duel' || policy === 'combo' ? 'beginner' : distance === 400 ? 'championship' : 'competitive',
    prepareSeconds: pressureCount > 1 ? 0.6 : 0.8, pressSeconds: pressureCount > 1 ? 3 : 2,
    restSeconds: pressureCount > 1 ? 4 : 6,
});

/** 仅供AI调试体验；生涯、快速赛、好友房均不读取此表。 */
export const BOSS_AI_PRESETS: readonly BossPreset[] = [
    preset('club-muscles', '七兄弟会', 'muscle', 200, 4, '轮流卡位，抓住换班空隙；前四为体验达标。', muscles(false)),
    preset('city-ninja', '忍者试刀', 'duel', 200, 1, '精准宿敌，稳住心率，把余力留到最后。', [slot('cartonSwimmer10', 10, 'skilled', 'leader', '静水忍者')], 0),
    preset('region-dive', '潜航穿插', 'dive', 200, 3, '潜水与小跳交替穿行，利用水面空隙；前三达标。', [
        slot('cartonSwimmer13', 16, 'expert', 'leader', '深水队长'), slot('cartonSwimmer13', 14, 'skilled', 'diver', '潜航左翼'),
        slot('cartonSwimmer13', 14, 'skilled', 'diver', '潜航右翼'), slot('cartonSwimmer8', 14, 'skilled', 'hopper', '跳跃先锋'),
        slot('cartonSwimmer8', 13, 'skilled', 'hopper', '跳跃侧翼'), slot('cartonSwimmer9', 12, 'normal', 'pace', '平衡队员'),
        slot('cartonSwimmer16', 12, 'normal', 'pace', '水面队员'),
    ], 0),
    preset('region-endurance', '四百米呼吸课', 'endurance', 400, 1, '教练稳配速，机甲轮换卡线，前半程留余力。', [
        slot('cartonSwimmer11', 17, 'expert', 'leader', '呼吸教练'), slot('cartonSwimmer15', 16, 'skilled', 'guard', '巡航机甲甲'),
        slot('cartonSwimmer15', 16, 'skilled', 'guard', '巡航机甲乙'), slot('cartonSwimmer5', 14, 'normal', 'pace', '踢腿队员甲'),
        slot('cartonSwimmer5', 14, 'normal', 'pace', '踢腿队员乙'), slot('cartonSwimmer6', 14, 'normal', 'pace', '稳游队员甲'),
        slot('cartonSwimmer6', 14, 'normal', 'pace', '稳游队员乙'),
    ]),
    preset('master-wall', '折返双雄', 'wall', 200, 3, '飞毛腿出墙追击，超级腿掩护；池段中段追回。', [
        slot('cartonSwimmer12', 24, 'expert', 'leader', '蹬墙主将'), slot('cartonSwimmer12', 23, 'expert', 'wall', '折返侧翼甲'),
        slot('cartonSwimmer12', 22, 'expert', 'wall', '折返侧翼乙'), slot('cartonSwimmer5', 23, 'expert', 'guard', '长腿护卫'),
        slot('cartonSwimmer5', 20, 'normal', 'pace', '踢腿队员'), slot('cartonSwimmer9', 20, 'normal', 'pace', '平衡队员'),
        slot('cartonSwimmer6', 21, 'skilled', 'pace', '稳游队员'),
    ]),
    preset('master-combo', '风火对决', 'combo', 400, 1, '风火轮保护连击，抓住失误与恢复的追赶机会。', [slot('cartonSwimmer14', 25, 'expert', 'leader', '风火宿敌')], 0),
    preset('champion-muscles', '七兄弟会·换班围堵', 'muscle', 200, 3, '专家队轮流夹击，最多两名主动配合；前三达标。', muscles(true), 2),
    preset('champion-allstar', '全明星决战', 'allstar', 400, 1, '争位、折返、潜航与末程追逐组成战术接力。', [
        slot('cartonSwimmer16', 30, 'expert', 'leader', '赛博领队'), slot('muscleMan', 30, 'expert', 'guard', '铁臂护卫'),
        slot('cartonSwimmer12', 30, 'expert', 'wall', '折返王牌'), slot('cartonSwimmer13', 30, 'expert', 'diver', '潜航王牌'),
        slot('cartonSwimmer15', 30, 'expert', 'guard', '巡航王牌'), slot('cartonSwimmer10', 30, 'expert', 'chaser', '精准王牌'),
        slot('cartonSwimmer14', 30, 'expert', 'chaser', '连击王牌'),
    ], 2),
];
export function findBossPreset(id: string | null | undefined): BossPreset | null {
    return BOSS_AI_PRESETS.find(p => p.id === id) ?? null;
}
export function bossRoster(preset: BossPreset): AiRosterEntry[] {
    return preset.roster.map(s => ({ name: s.name, profile: { characterId: s.characterId, level: s.level,
        intelligence: s.skill, difficulty: AI_INTELLIGENCE[s.skill].value } }));
}
