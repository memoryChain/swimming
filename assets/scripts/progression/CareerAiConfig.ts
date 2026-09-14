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
];

/**
 * ai(最低等级, 最高等级, 行为难度列表, 可选的角色权重列表)。
 * 等级决定角色属性；下列难度只决定AI的操作与判断，不额外增加属性：
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

export interface CareerAiTier {
    league: AiEventConfig;
    /** 顺序为预赛、决赛，或预赛、半决赛、决赛；每轮独立配置。 */
    cup: readonly AiEventConfig[];
}

/** 索引与联赛等级一一对应。调整本表即可改变生涯AI，不影响快速比赛或好友房间。 */
export const CAREER_AI_EVENTS: readonly CareerAiTier[] = [
    { // 1. 泳馆新秀
        league: ai(1, 3, ['rookie', 'rookie', 'rookie', 'rookie', 'rookie', 'rookie', 'rookie']),
        //league: ai(1, 3, ['extreme']),
        cup: [
            ai(1, 3, ['rookie', 'rookie', 'rookie', 'rookie', 'rookie', 'rookie', 'rookie']), // 预赛
            ai(1, 3, ['rookie', 'rookie', 'rookie', 'normal', 'rookie', 'rookie', 'rookie']), // 决赛
        ],
    },
    { // 2. 俱乐部选手
        league: ai(4, 8, ['rookie', 'normal', 'normal', 'normal', 'rookie', 'normal', 'normal']),
        cup: [
            ai(4, 8, ['rookie', 'normal', 'normal', 'normal', 'rookie', 'normal', 'normal']), // 预赛
            ai(4, 8, ['normal', 'normal', 'normal', 'skilled', 'normal', 'normal', 'normal']), // 决赛
        ],
    },
    { // 3. 城市精英
        league: ai(9, 14, ['rookie', 'normal', 'normal', 'normal', 'rookie', 'normal', 'normal']),
        cup: [
            ai(9, 14, ['rookie', 'normal', 'normal', 'normal', 'rookie', 'normal', 'normal']), // 预赛
            ai(9, 14, ['normal', 'normal', 'normal', 'skilled', 'normal', 'normal', 'normal']), // 决赛
        ],
    },
    { // 4. 区域强者
        league: ai(15, 20, ['normal', 'skilled', 'skilled', 'skilled', 'normal', 'skilled', 'skilled']),
        cup: [
            ai(15, 20, ['normal', 'skilled', 'skilled', 'skilled', 'normal', 'skilled', 'skilled']), // 预赛
            ai(15, 20, ['skilled', 'skilled', 'skilled', 'expert', 'skilled', 'skilled', 'skilled']), // 半决赛
            ai(15, 20, ['skilled', 'skilled', 'skilled', 'expert', 'skilled', 'skilled', 'skilled']), // 决赛
        ],
    },
    { // 5. 全国大师
        league: ai(21, 26, ['normal', 'skilled', 'skilled', 'skilled', 'normal', 'skilled', 'skilled']),
        cup: [
            ai(21, 26, ['normal', 'skilled', 'skilled', 'skilled', 'normal', 'skilled', 'skilled']), // 预赛
            ai(21, 26, ['skilled', 'skilled', 'skilled', 'expert', 'skilled', 'skilled', 'skilled']), // 半决赛
            ai(21, 26, ['skilled', 'skilled', 'skilled', 'expert', 'skilled', 'skilled', 'skilled']), // 决赛
        ],
    },
    { // 6. 冠军级
        league: ai(27, 30, ['skilled', 'expert', 'expert', 'expert', 'skilled', 'expert', 'expert']),
        cup: [
            ai(27, 30, ['skilled', 'expert', 'expert', 'expert', 'skilled', 'expert', 'expert']), // 预赛
            ai(27, 30, ['expert', 'expert', 'expert', 'expert', 'expert', 'expert', 'expert']), // 半决赛
            ai(27, 30, ['expert', 'expert', 'expert', 'expert', 'expert', 'expert', 'expert']), // 决赛
        ],
    },
];
