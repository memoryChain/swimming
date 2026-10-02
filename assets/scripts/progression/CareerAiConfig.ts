import type { AiCharacterWeight, AiEventConfig, AiIntelligenceId } from '../competitor/AiRaceConfig';

/** 默认角色池。每场可独立替换为自己的数组；只留一项即可全场同角色。 */
export const DEFAULT_CAREER_CHARACTERS: readonly AiCharacterWeight[] = [
    { characterId: 'cartonSwimmer6', weight: 1 }, // 蛙妹
    { characterId: 'cartonSwimmer8', weight: 1 }, // 蛙少
    { characterId: 'cartonSwimmer5', weight: 1 }, // 超级腿
    { characterId: 'cartonSwimmer9', weight: 1 }, // 猫姐
    { characterId: 'cartonSwimmer10', weight: 1 }, // 忍者哥
    { characterId: 'cartonSwimmer11', weight: 1 }, // 健身教练
    { characterId: 'cartonSwimmer12', weight: 1 }, // 飞毛腿
    { characterId: 'cartonSwimmer13', weight: 1 }, // 潜水哥
    { characterId: 'cartonSwimmer14', weight: 1 }, // 风火轮
    { characterId: 'cartonSwimmer15', weight: 1 }, // 机甲coser
    { characterId: 'muscleMan', weight: 1 }, // 肌肉男
    { characterId: 'cartonSwimmer16', weight: 1 }, // 赛博少女
];

/**
 * ai(最低等级, 最高等级, 行为难度列表, 可选的角色权重列表)。
 * 等级决定角色属性；下列难度只决定AI的操作与判断，不额外增加属性：
 * - learner：启蒙。换手慢、误差更大，让初期练习获得稳定正反馈。
 * - rookie：新手。划水时机误差较大，动作间隔和决策间隔较长。
 * - normal：普通。节奏和判断比新手稳定，作为常规对手。
 * - skilled：高手。划水更准确，动作衔接更快，决策更及时。
 * - expert：专家。时机误差很小，动作紧凑，反应快。
 * - extreme：极限测试档（界面名为“变态（测试）”）。时机随机误差和动作间隔为0，
 *   用于测试上限；不代表无视体力或必胜，不建议用于正式生涯配置。
 * 具体行为参数在 competitor/AiRaceConfig.ts 的 AI_INTELLIGENCE 中调整。
 *
 * 难度列表有几项，比赛就生成几名AI；当前8泳道支持1～7项。
 * ['expert'] = 玩家对1名专家AI；['rookie', 'normal', 'skilled'] = 3名AI。
 * 开赛只打乱这些名额的站位，不补齐空泳道。角色另外按权重独立抽取。
 */
function ai(minLevel: number, maxLevel: number, intelligence: readonly AiIntelligenceId[],
    characterWeights: readonly AiCharacterWeight[] = DEFAULT_CAREER_CHARACTERS): AiEventConfig {
    return { minLevel, maxLevel, intelligence, characterWeights, opponentCount: intelligence.length };
}

/** 初期避免复杂被动技能叠加；新手友好的阵容仍使用真实角色能力。 */
export const LEARNER_CHARACTERS: readonly AiCharacterWeight[] = [
    { characterId: 'cartonSwimmer16', weight: 4 },
    { characterId: 'cartonSwimmer8', weight: 2 },
    { characterId: 'cartonSwimmer9', weight: 1 },
];
export const CLUB_CHARACTERS: readonly AiCharacterWeight[] = [
    { characterId: 'cartonSwimmer6', weight: 2 },
    { characterId: 'cartonSwimmer8', weight: 2 },
    { characterId: 'cartonSwimmer9', weight: 2 },
    { characterId: 'cartonSwimmer11', weight: 1 },
    { characterId: 'cartonSwimmer16', weight: 2 },
];
export const TECHNICAL_CHARACTERS: readonly AiCharacterWeight[] = [
    { characterId: 'cartonSwimmer6', weight: 1 },
    { characterId: 'cartonSwimmer10', weight: 3 },
    { characterId: 'cartonSwimmer12', weight: 2 },
    { characterId: 'cartonSwimmer14', weight: 2 },
    { characterId: 'cartonSwimmer16', weight: 1 },
];

export interface CareerAiTier {
    league: AiEventConfig;
    leagueAlternate: AiEventConfig;
    cup: readonly AiEventConfig[];
}

/** 常规赛均为八人，保留热闹的满场体验；难度由等级、操作档及资格控制，不按人数递增。 */
export const CAREER_AI_EVENTS: readonly CareerAiTier[] = [
    { // 泳馆新秀：从满场狂野对抗开始，用弱AI与宽松资格保留新人正反馈。
        league: ai(1, 1, ['learner', 'learner', 'learner', 'learner', 'learner', 'learner', 'learner'], LEARNER_CHARACTERS),
        leagueAlternate: ai(1, 1, ['learner', 'learner', 'learner', 'learner', 'learner', 'learner', 'learner'], LEARNER_CHARACTERS),
        cup: [
            ai(1, 1, ['learner', 'learner', 'learner', 'learner', 'learner', 'learner', 'learner'], LEARNER_CHARACTERS),
            ai(1, 2, ['learner', 'learner', 'learner', 'learner', 'learner', 'learner', 'rookie'], LEARNER_CHARACTERS),
        ],
    },
    { // 俱乐部选手：少数较强对手带来目标，更多弱对手提供超越反馈。
        league: ai(2, 4, ['learner', 'learner', 'learner', 'learner', 'learner', 'rookie', 'rookie'], CLUB_CHARACTERS),
        leagueAlternate: ai(2, 4, ['learner', 'learner', 'learner', 'learner', 'rookie', 'rookie', 'normal'], CLUB_CHARACTERS),
        cup: [
            ai(2, 4, ['learner', 'learner', 'learner', 'learner', 'rookie', 'rookie', 'rookie'], CLUB_CHARACTERS),
            ai(3, 5, ['learner', 'learner', 'learner', 'learner', 'rookie', 'rookie', 'normal'], CLUB_CHARACTERS),
        ],
    },
    { // 城市精英：稳定操作开始重要，决赛仍保留较弱陪跑。
        league: ai(5, 9, ['rookie', 'rookie', 'rookie', 'rookie', 'normal', 'normal', 'normal']),
        leagueAlternate: ai(5, 9, ['rookie', 'rookie', 'rookie', 'rookie', 'normal', 'normal', 'skilled'], TECHNICAL_CHARACTERS),
        cup: [
            ai(5, 9, ['rookie', 'rookie', 'rookie', 'normal', 'normal', 'normal', 'normal']),
            ai(7, 11, ['rookie', 'rookie', 'rookie', 'rookie', 'normal', 'normal', 'skilled'], TECHNICAL_CHARACTERS),
        ],
    },
    { // 区域强者：长距离和强对手制造挑战，阵容仍保留普通档。
        league: ai(10, 15, ['normal', 'normal', 'normal', 'skilled', 'skilled', 'skilled', 'skilled']),
        leagueAlternate: ai(10, 15, ['normal', 'normal', 'normal', 'normal', 'skilled', 'skilled', 'skilled']),
        cup: [
            ai(10, 15, ['normal', 'normal', 'normal', 'skilled', 'skilled', 'skilled', 'skilled']),
            ai(12, 16, ['normal', 'normal', 'skilled', 'skilled', 'skilled', 'skilled', 'expert']),
            ai(14, 17, ['normal', 'normal', 'normal', 'normal', 'skilled', 'skilled', 'expert'], TECHNICAL_CHARACTERS),
        ],
    },
    { // 全国大师：高手为主，专家数量逐轮增加。
        league: ai(17, 23, ['skilled', 'skilled', 'skilled', 'skilled', 'skilled', 'expert', 'expert']),
        leagueAlternate: ai(17, 23, ['normal', 'normal', 'skilled', 'skilled', 'skilled', 'expert', 'expert']),
        cup: [
            ai(17, 23, ['skilled', 'skilled', 'skilled', 'skilled', 'skilled', 'expert', 'expert']),
            ai(20, 24, ['normal', 'normal', 'skilled', 'skilled', 'expert', 'expert', 'expert']),
            ai(22, 25, ['normal', 'normal', 'skilled', 'expert', 'expert', 'expert', 'expert']),
        ],
    },
    { // 冠军级：满场高等级专家，正式生涯不用极限测试档。
        league: ai(26, 30, ['skilled', 'skilled', 'expert', 'expert', 'expert', 'expert', 'expert']),
        leagueAlternate: ai(26, 30, ['skilled', 'expert', 'expert', 'expert', 'expert', 'expert', 'expert']),
        cup: [
            ai(26, 30, ['skilled', 'skilled', 'expert', 'expert', 'expert', 'expert', 'expert']),
            ai(28, 30, ['expert', 'expert', 'expert', 'expert', 'expert', 'expert', 'expert']),
            ai(30, 30, ['expert', 'expert', 'expert', 'expert', 'expert', 'expert', 'expert']),
        ],
    },
];

export const CAREER_SCHEDULE = [
    { leagueNames: ['热身赛', '欢乐对抗'], leagueRules: ['wild', 'wild'], leagueDistances: [200, 200],
        cupRules: ['wild', 'wild'], qualifyPlaces: [8, 5], winPoints: 30, finishPoints: 20, finishGrace: 90, factor: 1 },
    { leagueNames: ['俱乐部对抗', '节奏挑战'], leagueRules: ['wild', 'standard'], leagueDistances: [200, 200],
        cupRules: ['wild', 'wild'], qualifyPlaces: [6, 4], winPoints: 28, finishPoints: 12, finishGrace: 45, factor: 1.5 },
    { leagueNames: ['城市对抗', '技术挑战'], leagueRules: ['wild', 'standard'], leagueDistances: [200, 200],
        cupRules: ['wild', 'wild'], qualifyPlaces: [4, 1], winPoints: 26, finishPoints: 8, finishGrace: 20, factor: 2.3 },
    { leagueNames: ['区域对抗', '耐力挑战'], leagueRules: ['wild', 'wild'], leagueDistances: [200, 400],
        cupRules: ['wild', 'wild', 'wild'], qualifyPlaces: [5, 3, 1], winPoints: 24, finishPoints: 6, finishGrace: 15, factor: 3.5 },
    { leagueNames: ['大师对抗', '长距离挑战'], leagueRules: ['wild', 'wild'], leagueDistances: [200, 400],
        cupRules: ['wild', 'wild', 'wild'], qualifyPlaces: [4, 3, 1], winPoints: 24, finishPoints: 6, finishGrace: 12, factor: 5.2 },
    { leagueNames: ['冠军对抗', '冠军耐力赛'], leagueRules: ['wild', 'wild'], leagueDistances: [200, 400],
        cupRules: ['wild', 'wild', 'wild'], qualifyPlaces: [4, 3, 1], winPoints: 24, finishPoints: 6, finishGrace: 10, factor: 7.5 },
] as const;

/** 未来审核合并后接入可选支线，不替代晋级杯，也不阻塞主线。关闭槽位不会轮转或开赛。 */
export const CAREER_OPTIONAL_EVENT_SLOTS = [
    { id: 'club-items-intro', tier: 1, enabled: false, ruleSetId: 'items-intro', opponentCount: 7 },
    { id: 'region-items-party', tier: 3, enabled: false, ruleSetId: 'items-party', opponentCount: 7 },
    { id: 'champion-items-open', tier: 5, enabled: false, ruleSetId: 'items-open', opponentCount: 7 },
] as const;
