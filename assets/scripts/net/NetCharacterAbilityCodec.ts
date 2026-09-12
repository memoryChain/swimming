import type { CharacterAbilitySnapshot } from '../swimmer/CharacterAbilityState';

// 追加一个字段；深度毫米、踢腿保持毫秒、连击层数、连击余时毫秒。
const bounded = (value: number, max: number) => Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0;

export function encodeCharacterAbility(state: Readonly<CharacterAbilitySnapshot> | undefined): string {
    if (!state) return '0';
    const depth = Math.round(bounded(state.depth, 2) * 1000);
    const kick = Math.round(bounded(state.kickRemaining, 2) * 1000);
    const stacks = Math.floor(bounded(state.stacks, 10));
    const idle = Math.round(bounded(state.idleRemaining, 10) * 1000);
    return depth || kick || stacks || idle ? `${depth}:${kick}:${stacks}:${idle}` : '0';
}

export function decodeCharacterAbility(token: string | undefined): CharacterAbilitySnapshot | undefined {
    if (token === undefined) return undefined;
    const empty = { depth: 0, kickRemaining: 0, stacks: 0, idleRemaining: 0 };
    if (token === '0') return empty;
    const parts = token.split(':');
    if (parts.length !== 4 || parts.some(part => !/^\d+$/.test(part))) return empty;
    const values = parts.map(Number);
    if (values.some(value => !Number.isSafeInteger(value))) return empty;
    return {
        depth: bounded(values[0], 2000) / 1000,
        kickRemaining: bounded(values[1], 2000) / 1000,
        stacks: bounded(values[2], 10),
        idleRemaining: bounded(values[3], 10000) / 1000,
    };
}
