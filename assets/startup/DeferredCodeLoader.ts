import { assetManager } from 'cc';
import { STARTUP_RESOURCES } from './StartupResources';

let pending: Promise<void> | null = null;
export function loadGameplayCode(): Promise<void> {
    if (assetManager.getBundle(STARTUP_RESOURCES.codeBundle)) return Promise.resolve();
    if (pending) return pending;
    // 失败不缓存，用户可以重试；同一轮连续点击只发出一次加载请求。
    const request = new Promise<void>((resolve, reject) => {
        assetManager.loadBundle(STARTUP_RESOURCES.codeBundle, (error, bundle) => {
            if (error || !bundle) reject(error ?? new Error('游戏代码加载失败'));
            else resolve();
        });
    });
    pending = request;
    request.then(() => { if (pending === request) pending = null; }, () => { if (pending === request) pending = null; });
    return request;
}
