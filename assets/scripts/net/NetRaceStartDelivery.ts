import { INetRoom } from './INetRoom';

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
