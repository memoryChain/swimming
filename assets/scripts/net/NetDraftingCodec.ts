import type { NetSnapshotEntry } from './NetRaceSnapshot';

/** 复用原完赛位：低位是完赛，余位为资格与来源；36进制始终一字符，不增包长。 */
export function encodeDraftingState(entry: Pick<NetSnapshotEntry, 'finished' | 'draftingEligible' | 'draftingSource'>): string {
    const source = entry.draftingSource ?? -1;
    const code = !entry.draftingEligible || entry.finished ? 0
        : Number.isInteger(source) && source >= 0 && source < 8 ? source + 2 : 1;
    return (code * 2 + (entry.finished ? 1 : 0)).toString(36);
}
export function draftingCode(value: string | undefined): number {
    return value !== undefined && /^[0-9a-j]$/.test(value) ? parseInt(value, 36) : 0;
}
