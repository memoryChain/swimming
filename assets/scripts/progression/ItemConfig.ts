import { PLAYER_CHARACTER_DEFINITIONS, PlayerCharacterId } from '../app/PlayerCharacterConfig';

export interface ItemDefinition {
    id: string; name: string; description: string;
    kind: 'character-sign' | 'universal-sign' | 'dye';
    characterId?: PlayerCharacterId;
    maxStack: number;
}
export const UNIVERSAL_SIGN_CARD = 'sign_universal';
export const DYE_ITEM = 'dye';
export function signingCardId(characterId: string): string { return `sign_${characterId}`; }
/** 设计阶段，未接入库存、掉落或消费。道具表：稳定ID用于存档与掉落引用；一张签约卡永久开启培养资格。 */
export const ITEMS: readonly ItemDefinition[] = [
    { id: UNIVERSAL_SIGN_CARD, name: '万能签约卡', description: '为任意一个角色永久开启培养资格', kind: 'universal-sign', maxStack: 9999 },
    { id: DYE_ITEM, name: '染色剂', description: '永久解锁额外配色，已有免费配色不受影响', kind: 'dye', maxStack: 9999 },
    ...PLAYER_CHARACTER_DEFINITIONS.map(character => ({ id: signingCardId(character.id), name: `${character.name}签约卡`,
        description: `为${character.name}永久开启培养资格`, kind: 'character-sign' as const, characterId: character.id, maxStack: 9999 })),
];
export function findItem(id: string): ItemDefinition | undefined { return ITEMS.find(item => item.id === id); }
export interface ItemGrant { itemId: string; count: number; }
