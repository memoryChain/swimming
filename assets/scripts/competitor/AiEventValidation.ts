import { PLAYER_CHARACTER_DEFINITIONS } from '../app/PlayerCharacterConfig';
import { AI_INTELLIGENCE } from './AiRaceConfig';
import type { AiEventConfig } from './AiRaceConfig';

/** 开赛前校验配置，拒绝拼错角色、空池或无效权重，避免静默生成错误阵容。 */
export function validateAiEvent(event: AiEventConfig): void {
    if (!Number.isInteger(event.minLevel) || !Number.isInteger(event.maxLevel)
        || event.minLevel < 1 || event.maxLevel > 30 || event.minLevel > event.maxLevel) throw new Error('AI等级范围必须为1到30的整数');
    if (!event.intelligence.length || event.intelligence.some(id => !AI_INTELLIGENCE[id])) throw new Error('AI行为难度配置无效');
    if (event.opponentCount !== undefined && (!Number.isInteger(event.opponentCount)
        || event.opponentCount < 1 || event.intelligence.length !== event.opponentCount)) throw new Error('AI难度数量必须与对手人数一致');
    if (event.characterWeights === undefined) return;
    let total = 0;
    const seen: string[] = [];
    for (const entry of event.characterWeights) {
        if (!PLAYER_CHARACTER_DEFINITIONS.some(c => c.id === entry.characterId)) throw new Error(`AI角色不存在：${entry.characterId}`);
        if (seen.indexOf(entry.characterId) >= 0) throw new Error(`AI角色重复配置：${entry.characterId}`);
        seen.push(entry.characterId);
        if (!Number.isFinite(entry.weight) || entry.weight < 0) throw new Error('AI角色权重必须是非负有限数');
        total += entry.weight;
    }
    if (!Number.isFinite(total) || total <= 0) throw new Error('AI角色池至少需要一个正权重角色');
}
export function copyAiEvent(event: AiEventConfig): AiEventConfig {
    validateAiEvent(event);
    return { ...(event.opponentCount === undefined ? {} : {opponentCount: event.opponentCount}), minLevel: event.minLevel, maxLevel: event.maxLevel, intelligence: event.intelligence.slice(),
        ...(event.characterWeights === undefined ? {} : { characterWeights: event.characterWeights.map(entry => ({...entry})) }) };
}
