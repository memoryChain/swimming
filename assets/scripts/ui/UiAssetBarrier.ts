import { director, Director } from 'cc';

let current: UiAssetBarrier | null = null;

/** 只收集本次页面构建及其异步回调发起的资源，不阻塞无关页面或比赛。 */
export class UiAssetBarrier {
    pending = 0;
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

    waitFor(ready: () => boolean, timeoutMs = 60000): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.closed) { reject(new Error('界面加载已取消')); return; }
            let stableFrames = 0;
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
    let settled = false;
    return ((...args: Parameters<T>) => {
        if (settled) return;
        settled = true;
        try {
            scope.run(() => callback(...args));
            const error = failure?.(...args);
            if (error) scope.fail(error);
        } catch (error) { scope.fail(error); }
        finally { scope.pending--; }
    }) as T;
}
