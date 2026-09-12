import { randomInt, shuffleInPlace } from '../core/SharedRNG';
import { PLAYER_CHARACTER_DEFINITIONS, PlayerCharacterId } from '../app/PlayerCharacterConfig';
import { getRaceDifficulty } from '../core/GameBalance';
import { AI_EVENTS, AI_EVENT_BY_MODE, AI_INTELLIGENCE, AiIntelligenceId } from './AiRaceConfig';

export type AICompetitorProfile = {
    characterId: PlayerCharacterId;
    level: number;
    intelligence: AiIntelligenceId;
    difficulty: number;
};

export const AI_DEBUG_DIFFICULTY_TIERS = (['rookie', 'normal', 'skilled', 'expert', 'extreme'] as AiIntelligenceId[])
    .map((id) => ({ label: AI_INTELLIGENCE[id].label, value: AI_INTELLIGENCE[id].value }));

// 旧稳定 ID 继续服务保存的手感参数，角色和各智力的参数见 AiRaceConfig。
export const AI_STROKE_TUNING = {
    timingSigmaLow: 0.12,
    maxReleaseProgress: 0.48,
    gapSecondsSlow: 0.22,
    gapJitter: 0.28,
    startDelayMin: 0.04,
    startDelayMax: 0.2,
    maxHoldSeconds: 0.6,
};
export const AI_DOLPHIN_TUNING = { enabled: true as boolean };

export type AiNameTier = {
    // Inclusive upper bound on base profile difficulty for this tier.
    maxDifficulty: number;
    names: string[];
};

export const AI_NAME_TIERS: AiNameTier[] = [
    // 弱（菜鸟）：名字自带喜感，一看就是来划水的。
    {
        maxDifficulty: 0.6,
        names: ['王划水', '李扑通', '张狗刨', '赵慢半拍', '孙漏气', '刘二饼', '周浮板', '吴呛水'],
    },
    // 中坚（普通）：踏实、常见的中国名字。
    {
        maxDifficulty: 0.78,
        names: ['张建军', '李国强', '王志刚', '赵永胜', '陈海涛', '刘大江', '周奋进', '孙拼搏'],
    },
    // 高手 / 大师：名字自带高手气场。
    {
        maxDifficulty: Number.POSITIVE_INFINITY,
        names: ['浪里白条', '陈飞鱼', '水中蛟龙', '赵劈波', '何逐浪', '江疾风', '龙教头', '海霸王'],
    },
];

function aiNameTierIndex(difficulty: number): number {
    for (let i = 0; i < AI_NAME_TIERS.length; i++) {
        if (difficulty <= AI_NAME_TIERS[i].maxDifficulty) {
            return i;
        }
    }
    return AI_NAME_TIERS.length - 1;
}

// Pick a name for each difficulty, preferring the matching tier so the name hints
// at the opponent's skill. Names never repeat within one roster: if a tier runs
// out we spill over to the nearest remaining tier.
export function assignAiNames(difficulties: number[]): string[] {
    const pools = AI_NAME_TIERS.map((tier) => shuffleInPlace(tier.names.slice()));
    return difficulties.map((difficulty) => {
        const preferred = aiNameTierIndex(difficulty);
        for (let distance = 0; distance < pools.length; distance++) {
            for (const index of [preferred - distance, preferred + distance]) {
                if (index >= 0 && index < pools.length && pools[index].length > 0) {
                    return pools[index].pop() as string;
                }
            }
        }
        return 'AI';
    });
}

export type AiRosterEntry = {
    profile: AICompetitorProfile;
    name: string;
};

// Build a freshly randomized roster of `count` AI opponents: the difficulty
// profiles are shuffled (so the exact lineup and its lane order differ every race)
// and each opponent gets a difficulty-appropriate name. Called both at race build
// time and when the player taps "再来一次", so every restart reshuffles opponents
// and their lane positions.
export function buildRandomizedAiRoster(count: number): AiRosterEntry[] {
    const event = AI_EVENTS[AI_EVENT_BY_MODE[getRaceDifficulty()]] ?? AI_EVENTS.club;
    const characters = shuffleInPlace(PLAYER_CHARACTER_DEFINITIONS.filter((character) => character.unlocked));
    const tiers = shuffleInPlace(event.intelligence.slice());
    const chosen: AICompetitorProfile[] = [];
    for (let i = 0; i < count; i++) {
        const skill = AI_INTELLIGENCE[tiers[i % tiers.length]];
        chosen.push({ characterId: characters[i % characters.length].id,
            level: event.minLevel + randomInt(event.maxLevel - event.minLevel + 1),
            intelligence: skill.id, difficulty: skill.value });
    }
    const names = assignAiNames(chosen.map((profile) => profile.difficulty));
    return chosen.map((profile, i) => ({ profile, name: names[i] }));
}
