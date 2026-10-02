/** 抖音复访与事件上报；依赖注入便于验证，不参与比赛模拟。 */
export type AnalyticsFields = Record<string, string | number>;
export type BasicAnalyticsEvent = 'lobby_ready' | 'race_start' | 'race_end' | 'race_again'
    | 'sidebar_guide_click' | 'sidebar_jump_result' | 'sidebar_return';

export interface DouyinShowInfo {
    scene?: string;
    launch_from?: string;
    location?: string;
    showFrom?: number;
}

export interface DouyinLaunchBridge {
    startedAt: number;
    latest: DouyinShowInfo;
    sequence: number;
    subscribe(callback: (info: DouyinShowInfo, sequence: number) => void): () => void;
}

export interface DouyinEngagementApi {
    checkScene?: (options: { scene: 'sidebar'; success: (result: { isExist?: boolean }) => void; fail: () => void }) => void;
    navigateToScene?: (options: { scene: 'sidebar'; success: () => void; fail: () => void }) => void;
    reportAnalytics?: (event: string, data: AnalyticsFields) => void;
    getLaunchOptionsSync?: () => DouyinShowInfo;
    onShow?: (callback: (info: DouyinShowInfo) => void) => void;
    offShow?: (callback: (info: DouyinShowInfo) => void) => void;
}

export type SidebarState = Readonly<{ supported: boolean; returned: boolean; navigating: boolean }>;

export function isSidebarEntry(info: DouyinShowInfo): boolean {
    // 查询参数和 scene 单独都不能作为复访证据；普通切前后台不产生复访。
    return info.showFrom !== 0 && info.launch_from === 'homepage' && info.location === 'sidebar_card';
}

export class DouyinEngagement {
    private readonly listeners = new Set<(state: SidebarState) => void>();
    private latest: DouyinShowInfo = {};
    private sequence = -1;
    private supported = false;
    private navigating = false;
    private lobbyReported = false;
    private lastReturnSequence = -1;
    private checkPending: Promise<boolean> | null = null;
    private offShow: (() => void) | null = null;
    private disposed = false;
    private warned = false;
    private readonly startedAt: number;

    constructor(
        private readonly api: DouyinEngagementApi,
        private readonly common: AnalyticsFields,
        bridge?: DouyinLaunchBridge,
        private readonly now: () => number = Date.now,
        private readonly logEvents = false,
    ) {
        this.startedAt = bridge?.startedAt ?? now();
        if (bridge) {
            this.offShow = bridge.subscribe((info, sequence) => this.receiveShow(info, sequence));
            this.receiveShow(bridge.latest, bridge.sequence);
        } else {
            // 未经构建钩子的开发环境兜底；正式测试包必须包含早期监听。
            const handler = (info: DouyinShowInfo) => this.receiveShow(info, this.sequence + 1);
            try {
                api.onShow?.(handler);
                this.offShow = () => api.offShow?.(handler);
                this.receiveShow(api.getLaunchOptionsSync?.() ?? {}, 0);
            } catch { /* 宿主接口失败不阻断游戏。 */ }
        }
    }

    get state(): SidebarState {
        return { supported: this.supported, returned: isSidebarEntry(this.latest), navigating: this.navigating };
    }

    subscribe(callback: (state: SidebarState) => void): () => void {
        this.listeners.add(callback);
        callback(this.state);
        return () => this.listeners.delete(callback);
    }

    checkSidebar(): Promise<boolean> {
        if (this.disposed) return Promise.resolve(false);
        if (this.checkPending) return this.checkPending;
        const check = this.api.checkScene;
        if (!check || !this.api.navigateToScene) return Promise.resolve(false);
        const pending = new Promise<boolean>(resolve => {
            let settled = false;
            const timer = setTimeout(() => finish(false), 5000);
            const finish = (supported: boolean) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (!this.disposed) { this.supported = supported; this.notify(); }
                resolve(supported && !this.disposed);
            };
            try { check.call(this.api, { scene: 'sidebar', success: res => finish(res?.isExist === true), fail: () => finish(false) }); }
            catch { finish(false); }
        });
        this.checkPending = pending;
        void pending.then(() => { if (this.checkPending === pending) this.checkPending = null; });
        return pending;
    }

    navigateSidebar(): Promise<'success' | 'failed' | 'unavailable' | 'busy'> {
        if (this.disposed || !this.supported || !this.api.navigateToScene) return Promise.resolve('unavailable');
        if (this.navigating) return Promise.resolve('busy');
        this.navigating = true;
        this.notify();
        return new Promise(resolve => {
            let settled = false;
            const timer = setTimeout(() => finish('failed'), 10000);
            const finish = (result: 'success' | 'failed') => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this.navigating = false;
                if (!this.disposed) {
                    this.report('sidebar_jump_result', { entry: 'lobby', result });
                    this.notify();
                }
                // 跳转 success 仅表示离开游戏，绝不更改 returned。
                resolve(result);
            };
            try { this.api.navigateToScene!({ scene: 'sidebar', success: () => finish('success'), fail: () => finish('failed') }); }
            catch { finish('failed'); }
        });
    }

    reportLobbyReady(): void {
        if (this.lobbyReported) return;
        this.lobbyReported = true;
        this.report('lobby_ready', {
            load_ms: Math.max(0, this.now() - this.startedAt),
            source: isSidebarEntry(this.latest) ? 'sidebar' : 'other',
        });
    }

    report(event: BasicAnalyticsEvent, fields: AnalyticsFields): void {
        if (this.disposed || !this.api.reportAnalytics) return;
        try {
            const data = { ...this.common, ...fields };
            this.api.reportAnalytics(event, data);
            // 只在测试版的业务事件上记录调用；不宣称后台已入库。
            if (this.logEvents) console.info('[DouyinAnalytics] 接口调用', event, data);
        } catch {
            if (!this.warned) { this.warned = true; console.warn('[DouyinAnalytics] 上报接口异常，游戏继续运行'); }
        }
    }

    dispose(): void {
        this.disposed = true;
        this.offShow?.();
        this.offShow = null;
        this.listeners.clear();
    }

    private receiveShow(info: DouyinShowInfo, sequence: number): void {
        if (this.disposed || sequence <= this.sequence) return;
        this.sequence = sequence;
        // 完整替换来源，不能将新回调缺失字段与旧侧边栏字段合并。
        this.latest = { scene: info.scene, launch_from: info.launch_from, location: info.location, showFrom: info.showFrom };
        if (isSidebarEntry(this.latest) && this.lastReturnSequence !== sequence) {
            this.lastReturnSequence = sequence;
            this.report('sidebar_return', { source: 'sidebar', scene: info.scene ?? '' });
        }
        this.notify();
    }

    private notify(): void {
        if (this.disposed) return;
        const state = this.state;
        for (const listener of this.listeners) {
            try { listener(state); } catch { /* 一个界面失效不能中断其他监听。 */ }
        }
    }
}

export interface RaceAnalyticsContext {
    mode: string;
    distance: number;
    character_id: string;
    play_type: 'local' | 'network';
    test_type: 'normal' | 'ai_debug';
}

/** 每台设备只统计本地玩家；状态转换触发，不在 update 中上报。 */
export class RaceAnalyticsTracker {
    private context: RaceAnalyticsContext | null = null;
    private ended = false;

    constructor(private readonly send: (event: BasicAnalyticsEvent, fields: AnalyticsFields) => void) {}

    reset(): void { this.context = null; this.ended = false; }

    start(context: RaceAnalyticsContext): void {
        if (this.context) return;
        this.context = { ...context };
        this.send('race_start', { ...this.context });
    }

    end(outcome: 'completed' | 'dnf' | 'eliminated' | 'quit', time: number, placement: number, distance: number): void {
        if (!this.context || this.ended) return;
        this.ended = true;
        const finite = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
        this.send('race_end', { ...this.context, outcome,
            // 平台数值型验证要求整数；毫秒保留成绩精度，不改变游戏计时。
            time_ms: Math.round(finite(time) * 1000), placement: Math.floor(finite(placement)),
            progress_percent: Math.min(100, Math.round(finite(distance) / Math.max(1, this.context.distance) * 100)),
        });
    }

    again(): void {
        if (this.context && this.ended) this.send('race_again', { ...this.context });
    }
}
