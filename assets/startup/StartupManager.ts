import { _decorator, Camera, Canvas, Color, Component, js, Layers, Node, sys, view } from 'cc';
import { WECHAT } from 'cc/env';
import { loadGameplayCode } from './DeferredCodeLoader';
import { offerStartupHandoff } from './StartupHandoff';
import { observeStartupInvites, showStartupRetry, startupInvite } from './StartupPlatform';
import { StartupView } from './StartupView';
import { MusicManager } from './MusicManager';
import { StartupLoadingCover } from './StartupLoadingCover';

const { ccclass } = _decorator;
@ccclass('StartupManager')
export class StartupManager extends Component {
    private screen: StartupView | null = null;
    private loading = false;
    private attached = false;
    private cover: StartupLoadingCover | null = null;
    private joinRoomId: string | null = null;
    private offInvites: (() => void) | null = null;
    private readonly retry = () => { void this.enter(); };

    onLoad(): void {
        // 编辑器沿用原入口；返回登录场景时也直接复用已加载的业务模块。
        if (js.getClassByName('LoginManager')) { this.attachRuntime(); return; }
        if (!WECHAT) { void this.enter(false); return; }
        const canvas = this.node.getComponent(Canvas)!;
        const camera = canvas.cameraComponent ?? this.node.getChildByName('Camera')?.getComponent(Camera);
        if (camera) {
            camera.visibility = Layers.BitMask.UI_2D;
            camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
            camera.clearColor = new Color(8, 25, 42, 255);
            camera.orthoHeight = (view.getDesignResolutionSize().height || 720) / 2;
        }
        this.node.layer = Layers.Enum.UI_2D;
        this.applySavedMusicVolume();
        MusicManager.playLogin();
        this.joinRoomId = startupInvite();
        this.offInvites = observeStartupInvites(room => {
            this.joinRoomId = room;
            void this.enter();
        });
        void this.buildScreen();
        if (this.joinRoomId) void this.enter();
    }

    private async buildScreen(): Promise<void> {
        if (this.screen || !this.node.isValid || this.attached) return;
        const screen = new StartupView(this.node, () => { void this.enter(); });
        this.screen = screen;
        try { await screen.build(); if (this.loading) screen.setState('loading'); }
        catch (error) {
            if (!this.node.isValid || this.attached) return;
            console.warn('[启动] 首屏加载失败，转入原登录入口', error);
            screen.root.destroy(); this.screen = null;
            this.node.on(Node.EventType.TOUCH_END, this.retry);
            // 原入口保留资源重试与错误恢复；不把首屏图片失败变成永久空白。
            void this.enter(false);
        }
    }

    private async enter(enterLobby = true): Promise<void> {
        if (this.loading || this.attached || !this.node.isValid) return;
        this.loading = true;
        this.screen?.setState('loading');
        if (this.screen) {
            this.cover ??= new StartupLoadingCover(this.screen.root);
            this.cover.setLoading();
        }
        try {
            await loadGameplayCode();
            if (!this.node.isValid) return;
            this.attachRuntime(enterLobby || !!this.joinRoomId);
        } catch (error) {
            if (!this.node.isValid) return;
            this.screen?.setState('retry');
            this.cover?.setRetry(() => { void this.enter(enterLobby); });
            console.warn('[启动] 游戏加载失败，可点击重试', error);
            if (!this.screen) showStartupRetry(() => { if (this.node.isValid) void this.enter(enterLobby); });
        } finally { this.loading = false; }
    }

    private attachRuntime(enterLobby = false): void {
        if (this.attached || !this.node.isValid) return;
        const Runtime = js.getClassByName('LoginManager') as typeof Component;
        if (!Runtime) throw new Error('游戏代码加载完成但登录入口未注册');
        this.offInvites?.(); this.offInvites = null;
        if (enterLobby) offerStartupHandoff(this.node, { root: this.screen?.root.isValid ? this.screen.root : null, joinRoomId: this.joinRoomId, cover: this.cover ?? undefined });
        else this.cover?.dispose();
        this.node.addComponent(Runtime);
        this.cover = null;
        this.attached = true;
        this.node.off(Node.EventType.TOUCH_END, this.retry);
    }

    onDestroy(): void { this.cover?.dispose(); this.cover = null; this.offInvites?.(); this.offInvites = null; this.node.off(Node.EventType.TOUCH_END, this.retry); }

    private applySavedMusicVolume(): void {
        let volume = 0.8;
        try {
            const saved = JSON.parse(sys.localStorage.getItem('SpeedSwimming.Settings.v1') || '{}');
            volume = typeof saved.musicVolume === 'number' && Number.isFinite(saved.musicVolume)
                ? Math.max(0, Math.min(1, saved.musicVolume)) : saved.musicOn === false ? 0 : 0.8;
        } catch { /* 沿用损坏存档的默认音量。 */ }
        MusicManager.setVolume(volume);
    }
}
