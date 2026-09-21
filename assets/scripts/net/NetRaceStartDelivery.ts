import { INetRoom } from './INetRoom';
import type { NetRaceMember } from './NetRaceSession';

// 元组减少重复字段；校验、复制后不再引用大厅的可变成员对象。
export function decodeStartRoster(roster: unknown, modifiers: unknown,
    hostPos: number, localPos: number): NetRaceMember[] | null {
    if (!Array.isArray(roster) || roster.length < 2 || roster.length > 8) return null;
    const members: NetRaceMember[] = [];
    const seats = new Set<number>();
    for (const entry of roster) {
        if (!Array.isArray(entry) || entry.length !== 3) return null;
        const [pos, avatarId, nickName] = entry;
        if (!Number.isInteger(pos) || pos < 0 || pos > 7 || seats.has(pos)
            || typeof avatarId !== 'string' || !avatarId || avatarId.length > 32
            || typeof nickName !== 'string' || !nickName || nickName.length > 64) return null;
        const blob = modifiers && typeof modifiers === 'object' ? (modifiers as Record<number, unknown>)[pos] : '';
        if (blob !== undefined && (typeof blob !== 'string' || blob.length > 96)) return null;
        seats.add(pos);
        members.push({ pos, avatarId, nickName, self: pos === localPos, modifiersBlob: typeof blob === 'string' ? blob : '' });
    }
    if (!seats.has(hostPos) || !seats.has(localPos)) return null;
    members.sort((a, b) => a.pos - b.pos);
    return members;
}

export function startMessageFitsBudget(message: string): boolean {
    let bytes = 0;
    for (let i = 0; i < message.length; i++) {
        const code = message.charCodeAt(i);
        if (code < 0x80) bytes++;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff && i + 1 < message.length
            && message.charCodeAt(i + 1) >= 0xdc00 && message.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
        else bytes += 3;
        if (bytes > 1536) return false;
    }
    return true;
}

// 开赛参数只序列化一次；大厅和赛中接力补发，避免页面切换切断恢复路径。
export class NetRaceStartDelivery {
    private readonly pending: Set<number>;
    private timer: ReturnType<typeof setInterval> | null = null;
    private disposed = false;

    constructor(private readonly room: INetRoom, private readonly raceId: string,
        private readonly message: string, localPos: number, members: readonly { pos: number }[]) {
        this.pending = new Set(members.filter(m => m.pos >= 0 && m.pos !== localPos).map(m => m.pos));
    }

    start(): void {
        if (this.disposed || this.timer !== null || this.pending.size === 0) return;
        this.timer = setInterval(() => {
            if (!this.disposed && this.pending.size > 0) this.send();
        }, 750);
    }

    send(): void {
        if (this.disposed) return;
        // 瞬时发送失败由同一条重试定时器恢复，不让平台异常打断开赛流程。
        try { this.room.broadcast(this.message); } catch { /* 下一次补发继续使用原文。 */ }
    }

    receive(message: string): boolean {
        if (this.disposed || message.charCodeAt(0) !== 123) return false;
        try {
            const data = JSON.parse(message);
            if (data?.t !== 'startAck') return false;
            if (data.raceId === this.raceId && Number.isInteger(data.pos)) {
                this.pending.delete(data.pos);
                if (this.pending.size === 0) this.dispose();
            }
            return true;
        } catch { return false; }
    }

    retainMembers(positions: readonly number[]): void {
        for (const pos of this.pending) if (positions.indexOf(pos) < 0) this.pending.delete(pos);
        if (this.pending.size === 0) this.dispose();
    }

    dispose(): void {
        this.disposed = true;
        if (this.timer !== null) clearInterval(this.timer);
        this.timer = null;
        this.pending.clear();
    }
}

export function acknowledgeRaceStart(room: INetRoom, raceId: string, pos: number): void {
    try { room.broadcast(JSON.stringify({ t: 'startAck', raceId, pos })); }
    catch { /* 房主补发原文时再次确认。 */ }
}
