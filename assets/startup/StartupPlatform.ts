// 启动阶段只观察邀请，不创建 GameServerManager 或联机会话。
type InviteApi = {
    getLaunchOptionsSync?: () => { query?: Record<string, string> };
    onShow?: (listener: (event: { query?: Record<string, string> }) => void) => void;
    offShow?: (listener: (event: { query?: Record<string, string> }) => void) => void;
    showModal?: (options: { title: string; content: string; confirmText: string; showCancel: boolean; success: (result: { confirm: boolean }) => void }) => void;
};
function api(): InviteApi | undefined { return (globalThis as unknown as { wx?: InviteApi }).wx; }
export function startupInvite(): string | null {
    try { return api()?.getLaunchOptionsSync?.().query?.room || null; } catch { return null; }
}
export function observeStartupInvites(callback: (room: string) => void): () => void {
    const platform = api();
    const listener = (event: { query?: Record<string, string> }) => {
        if (event?.query?.room) callback(event.query.room);
    };
    try { platform?.onShow?.(listener); } catch { /* 平台不支持监听时保留冷启动入口。 */ }
    return () => { try { platform?.offShow?.(listener); } catch { /* 销毁不能阻断场景切换。 */ } };
}

// 字体或图片也下载失败时使用微信原生提示，避免空白首屏无法重试。
export function showStartupRetry(onRetry: () => void): void {
    api()?.showModal?.({ title: '加载失败', content: '请检查网络连接后重试', confirmText: '重试', showCancel: false,
        success: result => { if (result.confirm) onRetry(); },
    });
}
