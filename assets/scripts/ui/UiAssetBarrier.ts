import { director, Director } from 'cc';
import { StartupLoadingCover } from '../../startup/StartupLoadingCover';

let current: UiAssetBarrier | null = null;

/** 只收集本次页面构建及其异步回调发起的资源，不阻塞无关页面或比赛。 */
export class UiAssetBarrier {
    pending = 0;
    total = 0;
    completed = 0;
    private closed = false;
    private error: Error | null = null;
    private stop: ((error?: Error) => void) | null = null;

    run<T>(work: () => T): T {
        const previous = current;
        current = this.closed ? null : this;
        try { return work(); } finally { current = previous; }
    }

    fail(error: unknown): void {
        if (!this.closed && !this.error) this.error = error instanceof Error ? error : new Error(String(error));
    }

    waitFor(ready: () => boolean, timeoutMs = 60000, progress?: (completed: number, total: number) => void): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.closed) { reject(new Error('界面加载已取消')); return; }
            let stableFrames = 0;
            let reportedCompleted = -1, reportedTotal = -1;
            const finish = (error?: Error) => {
                clearTimeout(timer);
                director.off(Director.EVENT_AFTER_DRAW, check);
                this.stop = null;
                this.closed = true;
                if (error) reject(error); else resolve();
            };
            const check = () => {
                try {
                    if (this.error) { finish(this.error); return; }
                    // 合并同帧回调；嵌套请求会增加总数，不把当前列表当成已知全集。
                    if (progress && (reportedCompleted !== this.completed || reportedTotal !== this.total)) {
                        reportedCompleted = this.completed; reportedTotal = this.total;
                        progress(this.completed, this.total);
                    }
                    if (this.pending === 0 && ready()) {
                        // 资源回调完成后仍让布局、姿态和渲染提交至少走过两帧。
                        if (++stableFrames >= 2) finish();
                    } else stableFrames = 0;
                } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
            };
            const timer = setTimeout(() => finish(new Error('界面加载超时')), timeoutMs);
            this.stop = finish;
            director.on(Director.EVENT_AFTER_DRAW, check);
        });
    }

    cancel(): void {
        if (this.closed) return;
        this.closed = true;
        this.stop?.(new Error('界面加载已取消'));
    }
}

/** 共享缓存的新订阅也独立计数；迟到回调可以填缓存，但不能加入下一轮等待。 */
export function trackUiCallback<T extends (...args: any[]) => void>(
    callback: T, failure?: (...args: Parameters<T>) => unknown,
): T {
    const scope = current;
    if (!scope) return callback;
    scope.pending++;
    scope.total++;
    let settled = false;
    return ((...args: Parameters<T>) => {
        if (settled) return;
        settled = true;
        try {
            scope.run(() => callback(...args));
            const error = failure?.(...args);
            if (error) scope.fail(error);
        } catch (error) { scope.fail(error); }
        finally { scope.pending--; scope.completed++; }
    }) as T;
}

/** 首次整页呈现：先准备美术，遮罩下挂载并提交，完成后播放入场。 */
export class UiPageLoadGate {
    private scope: UiAssetBarrier | null = null;
    private cover: StartupLoadingCover | null = null;

    open(prepare: (done: (error: Error | null) => void) => void, mount: () => void,
        ready: () => boolean = () => true, enter: () => void = () => {}): void {
        if (this.scope) return;
        const scope = this.scope = new UiAssetBarrier();
        let mounted = false;
        let failure: Error | null = null;
        scope.run(() => prepare(trackUiCallback((error: Error | null) => {
            if (this.scope !== scope) return;
            if (error) { failure = error; scope.fail(error); return; }
            mount(); mounted = true;
        })));
        if (!failure && mounted && scope.pending === 0 && ready()) {
            scope.cancel(); this.scope = null;
            this.cover?.dispose(); this.cover = null;
            enter(); return;
        }
        this.cover ??= new StartupLoadingCover(null, 'transparent');
        this.cover.setLoading();
        void scope.waitFor(() => mounted && ready(), 60000,
            (completed, total) => this.cover?.setResourceProgress(completed, total)).then(() => {
            if (this.scope !== scope) return;
            this.scope = null;
            this.cover?.dispose(); this.cover = null;
            enter();
        }).catch(error => {
            if (this.scope !== scope) return;
            this.scope = null;
            console.warn('[界面] 资源未就绪，可重试', error);
            this.cover?.setRetry(() => this.open(prepare, mount, ready, enter));
        });
    }

    run(work: () => void): void { if (this.scope) this.scope.run(work); else work(); }

    cancel(): void {
        const scope = this.scope; this.scope = null;
        scope?.cancel(); this.cover?.dispose(); this.cover = null;
    }
}
