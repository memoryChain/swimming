import { director, Director } from 'cc';

type Complete<T> = (error?: unknown, value?: T) => void;
let current: RaceLoading | null = null;

/** 一次进场的等待、分帧任务和取消边界；结束后不保留帧监听。 */
export class RaceLoading {
    private failure: Error | null = null;
    private closed = false;
    private readonly pending = new Set<(error: Error) => void>();
    private readonly checks = new Set<() => void>();
    private readonly jobs: Array<() => void> = [];
    private readonly startedAt = Date.now();
    private readonly timings: string[] = [];
    assetsPending = 0;
    private readonly timeout: ReturnType<typeof setTimeout>;

    constructor(timeoutMs = 60000) {
        current?.cancel(new Error('比赛加载已被替换'));
        current = this;
        this.timeout = setTimeout(() => this.cancel(new Error('比赛加载超时，请返回重试')), timeoutMs);
        director.on(Director.EVENT_AFTER_DRAW, this.onFrame, this);
    }

    get active(): boolean { return !this.closed; }

    step<T = void>(name: string, start: (done: Complete<T>) => void): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            if (this.closed) { reject(this.failure ?? new Error('比赛加载已取消')); return; }
            const began = Date.now();
            let settled = false;
            const abort = (error: Error) => finish(error);
            const finish: Complete<T> = (error, value) => {
                if (settled) return;
                settled = true;
                this.pending.delete(abort);
                if (error) reject(error);
                else { this.timings.push(`${name}=${Date.now() - began}ms`); resolve(value as T); }
            };
            this.pending.add(abort);
            try { start(finish); } catch (error) { finish(error); }
        });
    }

    waitFor(name: string, ready: () => boolean): Promise<void> {
        let check: () => void;
        return this.step(name, done => {
            check = () => {
                try { if (ready()) done(); } catch (error) { done(error); }
            };
            this.checks.add(check);
        }).then(() => { this.checks.delete(check); }, error => { this.checks.delete(check); throw error; });
    }

    frames(count = 1): Promise<void> {
        return this.waitFor('渲染准备', () => --count <= 0);
    }

    private onFrame() {
        if (!this.active) return;
        // 每帧最多实例化一个模型；下载请求仍由资源系统并发处理。
        this.jobs.shift()?.();
        for (const check of this.checks) check();
    }

    enqueue(job: () => void) { if (this.active) this.jobs.push(job); }

    finish() {
        console.log(`[RaceLoading] ${this.timings.join('；')}；总计=${Date.now() - this.startedAt}ms`);
        this.cancel();
    }

    cancel(error = new Error('比赛加载已取消')) {
        if (this.closed) return;
        this.closed = true;
        this.failure = error;
        clearTimeout(this.timeout);
        director.off(Director.EVENT_AFTER_DRAW, this.onFrame, this);
        this.jobs.length = 0;
        this.checks.clear();
        for (const abort of this.pending) abort(error);
        this.pending.clear();
        if (current === this) current = null;
    }
}

/** 只有比赛加载阶段分帧；大厅和角色调试仍沿用原有调用方式。 */
export function initializeRaceModel(initialize: () => void, failed: (error: unknown) => void) {
    const run = () => { try { initialize(); } catch (error) { failed(error); } };
    if (current?.active) current.enqueue(run);
    else run();
}

/** 把材质、字库和 UI 等嵌套异步请求也纳入当前进场等待。 */
export function trackRaceAsset<T extends (...args: any[]) => void>(callback: T): T {
    const scope = current;
    if (!scope?.active) return callback;
    scope.assetsPending++;
    let settled = false;
    return ((...args: Parameters<T>) => {
        if (settled) return;
        settled = true;
        try { callback(...args); }
        catch (error) { if (scope.active) scope.cancel(error instanceof Error ? error : new Error(String(error))); }
        finally { scope.assetsPending--; }
    }) as T;
}
