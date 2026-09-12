import { PlayerCharacterId } from '../app/PlayerCharacterConfig';
import { RaceDifficulty } from '../core/GameBalance';

export type AiIntelligenceId = 'rookie' | 'normal' | 'skilled' | 'expert' | 'extreme';
export interface AiIntelligence {
    id: AiIntelligenceId;
    label: string;
    value: number;
    chargeMin: number;
    chargeMax: number;
    timingSigma: number;
    gap: number;
    kickHz: number;
    decisionSeconds: number;
    discipline: number;
    budgetTolerance: number;
    jumpDelay: number;
}

// 智力只改变输入和判断。数值先作为可验证的基线，实际准确率由共享判定产生。
export const AI_INTELLIGENCE: Record<AiIntelligenceId, AiIntelligence> = {
    rookie: { id: 'rookie', label: '新手', value: 0.3, chargeMin: 0.35, chargeMax: 0.72, timingSigma: 0.10, gap: 0.20, kickHz: 3, decisionSeconds: 0.6, discipline: 0.55, budgetTolerance: 18, jumpDelay: 5 },
    normal: { id: 'normal', label: '普通', value: 0.5, chargeMin: 0.62, chargeMax: 0.87, timingSigma: 0.060, gap: 0.12, kickHz: 4, decisionSeconds: 0.4, discipline: 0.8, budgetTolerance: 10, jumpDelay: 2.5 },
    skilled: { id: 'skilled', label: '高手', value: 0.75, chargeMin: 0.8, chargeMax: 0.96, timingSigma: 0.027, gap: 0.06, kickHz: 5, decisionSeconds: 0.25, discipline: 0.94, budgetTolerance: 5, jumpDelay: 1 },
    expert: { id: 'expert', label: '专家', value: 0.95, chargeMin: 0.93, chargeMax: 1, timingSigma: 0.009, gap: 0.025, kickHz: 6, decisionSeconds: 0.15, discipline: 0.99, budgetTolerance: 2, jumpDelay: 0.3 },
    extreme: { id: 'extreme', label: '变态（测试）', value: 1, chargeMin: 1, chargeMax: 1, timingSigma: 0, gap: 0, kickHz: 8, decisionSeconds: 1 / 30, discipline: 1, budgetTolerance: 1, jumpDelay: 0 },
};

export function intelligenceForDifficulty(value: number): AiIntelligence {
    return value >= 1 ? AI_INTELLIGENCE.extreme : value > 0.85 ? AI_INTELLIGENCE.expert
        : value > 0.6 ? AI_INTELLIGENCE.skilled : value > 0.35 ? AI_INTELLIGENCE.normal : AI_INTELLIGENCE.rookie;
}

export interface AiCharacterStrategy {
    heartTarget: number;
    heartRecovery: number;
    budgetExponent: number;
    sprint200: number;
    sprint400: number;
    kickBlock: number;
    avoidContact: boolean;
    contest: boolean;
}

// 明确逐角色定义，新增角色时 TypeScript 要求补齐策略；特性与能力数值仍取共享角色数据。
export const AI_CHARACTER_STRATEGIES: Record<PlayerCharacterId, AiCharacterStrategy> = {
    cartonSwimmer6: { heartTarget: 162, heartRecovery: 127, budgetExponent: 0.95, sprint200: 28, sprint400: 35, kickBlock: 1.6, avoidContact: true, contest: false },
    cartonSwimmer8: { heartTarget: 150, heartRecovery: 120, budgetExponent: 0.9, sprint200: 30, sprint400: 38, kickBlock: 1.8, avoidContact: true, contest: false },
    cartonSwimmer5: { heartTarget: 137, heartRecovery: 108, budgetExponent: 0.8, sprint200: 25, sprint400: 32, kickBlock: 3, avoidContact: true, contest: false },
    cartonSwimmer9: { heartTarget: 148, heartRecovery: 112, budgetExponent: 0.95, sprint200: 30, sprint400: 40, kickBlock: 1.5, avoidContact: true, contest: false },
    cartonSwimmer10: { heartTarget: 130, heartRecovery: 106, budgetExponent: 0.9, sprint200: 25, sprint400: 32, kickBlock: 2, avoidContact: true, contest: false },
    cartonSwimmer11: { heartTarget: 138, heartRecovery: 115, budgetExponent: 0.95, sprint200: 28, sprint400: 36, kickBlock: 2.5, avoidContact: true, contest: false },
    cartonSwimmer12: { heartTarget: 145, heartRecovery: 112, budgetExponent: 0.88, sprint200: 26, sprint400: 34, kickBlock: 2, avoidContact: true, contest: false },
    cartonSwimmer13: { heartTarget: 142, heartRecovery: 114, budgetExponent: 0.93, sprint200: 30, sprint400: 40, kickBlock: 2.4, avoidContact: true, contest: false },
    cartonSwimmer14: { heartTarget: 162, heartRecovery: 116, budgetExponent: 0.96, sprint200: 32, sprint400: 42, kickBlock: 3, avoidContact: true, contest: false },
    cartonSwimmer15: { heartTarget: 157, heartRecovery: 122, budgetExponent: 1, sprint200: 35, sprint400: 45, kickBlock: 1.6, avoidContact: false, contest: false },
    muscleMan: { heartTarget: 145, heartRecovery: 112, budgetExponent: 0.78, sprint200: 22, sprint400: 28, kickBlock: 3.2, avoidContact: false, contest: true },
};

export const AI_PLANNER_TUNING = {
    budgetScale: 1,
    heartTargetOffset: 0,
    sprintDistanceScale: 1,
    kickBlockScale: 1,
    jumpSpaceMargin: 1,
};

export interface AiEventConfig {
    minLevel: number;
    maxLevel: number;
    intelligence: readonly AiIntelligenceId[];
}
export const AI_EVENTS: Record<string, AiEventConfig> = {
    club: { minLevel: 1, maxLevel: 5, intelligence: ['rookie', 'normal', 'normal', 'skilled'] },
    regional: { minLevel: 8, maxLevel: 15, intelligence: ['normal', 'skilled', 'skilled', 'expert'] },
    elite: { minLevel: 20, maxLevel: 30, intelligence: ['skilled', 'expert', 'expert'] },
};
// 当前三个入口同属俱乐部赛事。赛制不隐式升级智力，后续赛事可独立指向其它配置。
export const AI_EVENT_BY_MODE: Record<RaceDifficulty, string> = {
    beginner: 'club', competitive: 'club', championship: 'club',
};
