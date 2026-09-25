import { _decorator, Camera, Canvas, Color, Component, director, Layers, Node, UITransform, view } from 'cc';
import { MainGameLaunchMode, setAiDebugDifficulty, setMainGameLaunchMode, consumeReturnToRoom, consumeReturnToLobby, setRoomMode } from '../core/GameLaunchOptions';
import { DEBUG_UI_ENABLED } from '../core/DebugUiPolicy';
import { setSoloRaceTicket } from '../progression/SoloRaceSession';
import { setSoloRaceDistance } from '../core/GameBalance';
import { setSoloAiEvent } from '../competitor/CompetitorConfig';
import { loadRaceBundle } from '../core/RaceBundleLoader';
import { mountAiDebugSetupPicker } from '../ui/AiDebugSetupPicker';
import { getAiDebugSetup } from '../core/GameLaunchOptions';
import { setRaceDifficulty } from '../core/GameBalance';
import { LoadingOverlay } from '../ui/LoadingOverlay';
import { fitFullScreenBackgroundCover, makeButton, makeLabel, makeRect, makeUiNode, uiColor } from '../ui/RuntimeUiFactory';
import { SpeedStarsStartUiPrefabBuilder } from '../ui/SpeedStarsUiPrefabBuilder';
import { ResourceHeadBar } from '../ui/ResourceHeadBar';
import { IdentityEditPanel } from '../ui/IdentityEditPanel';
import { RoomFlow } from '../ui/RoomFlow';
import { getUILayer, UILayer } from '../ui/UILayers';
import { ensureLogin } from '../platform/PlatformSession';
import { platform } from '../platform/PlatformManager';
import { rewardedAdUnitId } from '../platform/AdConfig';
import { showToast } from '../ui/Toast';
import { PlayerData } from '../backend/PlayerData';
import { PROGRESSION_CONFIG, CURRENCY } from '../backend/PlayerProfile';
import { getProgressionManager } from '../progression/ProgressionManager';
import { SettingsManager } from './SettingsManager';
import { SettingsPanel } from '../ui/SettingsPanel';
import { MusicManager } from './MusicManager';
import { PrepareRaceFlow } from '../ui/PrepareRaceFlow';
import { takeStartupHandoff } from '../../startup/StartupHandoff';
import { StartupLoadingCover } from '../../startup/StartupLoadingCover';
import { UiAssetBarrier } from '../ui/UiAssetBarrier';
import { prepareProjectUiFonts } from '../ui/ProjectUiFonts';


const { ccclass } = _decorator;

@ccclass('LoginManager')
export class LoginManager extends Component {
    private _canvasNode: Node = null;
    private _designWidth = 1280;
    private _designHeight = 720;
    private _loadingRace = false;
    private _loginUiRoot: Node | null = null;
    private _prepareRaceFlow: PrepareRaceFlow | null = null;
    private _headBar: ResourceHeadBar | null = null;
    private _identityEditPanel: IdentityEditPanel | null = null;
    private _settingsPanel: SettingsPanel | null = null;
    private _roomFlow: RoomFlow | null = null;
    private _pendingOpenRoom = false;
    private _pendingOpenLobby = false;
    private _pendingJoinRoomId: string | null = null;
    private _pendingReconnect = false;
    private _loginUiRetries = 0;
    private _offAppShow: (() => void) | null = null;
    private _adInProgress = false;
    private _nextInvitedRoom: string | null = null;
    private _switchingInvite = false;
    private _destroyed = false;
    private _lobbyLoading: UiAssetBarrier | null = null;
    private _lobbyCover: StartupLoadingCover | null = null;

    onLoad() {
        const startup = takeStartupHandoff(this.node);
        this._lobbyCover = startup?.cover ?? null;
        const canvasNode = this.findCanvasNode();
        canvasNode.layer = Layers.Enum.UI_2D;

        const design = view.getDesignResolutionSize();
        const width = design.width || 1280;
        const height = design.height || 720;
        this._canvasNode = canvasNode;
        this._designWidth = width;
        this._designHeight = height;

        this.setupUiCamera(canvasNode, height);
        SettingsManager.apply();
        MusicManager.playLogin();
        // Returning from a room-mode race: re-open the room once the login UI loads.
        // This is a RECONNECT to the still-existing room, not a fresh create/join.
        const returningToRoom = consumeReturnToRoom();
        this._pendingOpenLobby = consumeReturnToLobby() && !returningToRoom;
        this._pendingOpenRoom = returningToRoom;
        this._pendingReconnect = returningToRoom;
        // Launched from a shared room invite (query `room=<accessInfo>`): auto-open the
        // room in JOIN mode. IMPORTANT: only on a genuine fresh launch — getLaunchQuery()
        // keeps returning the ORIGINAL invite room on every later scene load, so honoring
        // it after a race would wrongly re-JOIN the (now in-game) room ("invalid room
        // state"). When returning from a race we reconnect instead and ignore it.
        if (!returningToRoom && !this._pendingOpenLobby) {
            const invitedRoom = startup?.joinRoomId ?? platform().getLaunchQuery().room;
            if (invitedRoom) {
                this._pendingJoinRoomId = invitedRoom;
                this._pendingOpenRoom = true;
                this._pendingReconnect = false;
            }
        }
        // Warm-launch invites: when the game is ALREADY running and the user taps a
        // share card, WeChat does not relaunch (onLoad won't run again) — it fires
        // onShow with the new query. Catch that here so a room invite still opens the
        // room instead of just foregrounding the game.
        this._offAppShow = platform().onAppShow((query) => this.handleAppShowInvite(query));
        // Log in as soon as the entry scene opens. On WeChat/Douyin this fetches a
        // login code (to later exchange on a server); in the editor/web build it is a
        // harmless mock. Fire-and-forget: the result is cached in PlatformSession.
        void ensureLogin();
        // Unified resource headbar (游泳卡) mounted into the HUD layer so it always
        // renders above screen UI (login prefab, prepare-race) without any manual
        // z-order juggling. Load the profile so the count reflects saved data.
        void PlayerData.load().then(() => getProgressionManager().migrateLegacySave());
        // 首屏交接或比赛返回直接准备大厅；加载遮罩保留到目标页面就绪。
        if (startup || this._pendingOpenLobby) {
            this._loginUiRoot = startup?.root ?? null;
            if (this._pendingOpenRoom) {
                this._pendingOpenRoom = false;
                this.openRoom(this._pendingJoinRoomId, this._pendingReconnect);
                this._pendingJoinRoomId = null;
            } else {
                this._pendingOpenLobby = false;
                this.openPrepareRace();
            }
        } else {
            this.buildLoginScreen(canvasNode, width, height);
        }
    }

    // Lazily mount the authored avatar picker once. Reopening only resets its draft
    // values and visibility; selection changes never rebuild the hierarchy.
    private openIdentityEdit() {
        if (!this._canvasNode) {
            return;
        }
        const popup = getUILayer(this._canvasNode, UILayer.Popup);
        if (!this._identityEditPanel) {
            this._identityEditPanel = new IdentityEditPanel();
            this._identityEditPanel.build(popup, this._designWidth, this._designHeight);
        }
        this._identityEditPanel.show();
    }

    // Mount once like the identity popup; reopening only refreshes draft values.
    private openSettings() {
        if (!this._canvasNode) {
            return;
        }
        const popup = getUILayer(this._canvasNode, UILayer.Popup);
        if (!this._settingsPanel) {
            this._settingsPanel = new SettingsPanel();
            this._settingsPanel.build(popup, this._designWidth, this._designHeight);
        }
        this._settingsPanel.show();
    }

    // Rewarded-ad reward flow for the headbar "+" button: show the ad, and only on
    // a completed view ask the backend to grant coins (it enforces the daily cap).
    // The headbar auto-refreshes via PlayerData.onChange. Editor/web auto-completes
    // the mock ad so this is testable locally.
    private async watchAdForCoins() {
        if (this._adInProgress) {
            return;
        }
        this._adInProgress = true;
        try {
            const outcome = await platform().showRewardedAd(rewardedAdUnitId(platform().name));
            if (outcome === 'completed') {
                const reward = await PlayerData.grantAdReward();
                if (reward.ok) {
                    this.toast(`+${reward.granted} ${CURRENCY.coin.label}`);
                } else if (reward.reason === 'capped') {
                    this.toast('今日看广告次数已达上限');
                } else {
                    this.toast('发放失败，请稍后再试');
                }
            } else if (outcome === 'unavailable') {
                this.toast('暂无可用广告');
            } else if (outcome === 'error') {
                this.toast('广告加载失败，请稍后再试');
            }
            // 'skipped' (closed early): no reward, no nagging toast.
        } finally {
            this._adInProgress = false;
        }
    }

    private toast(text: string) {
        if (this._canvasNode?.isValid) {
            showToast(this._canvasNode, text);
        }
    }

    // DEBUG ONLY: add coins with no ad and no cap. Reachable only from the AI-debug
    // popup (hidden dev panel), NOT the headbar "+" which now runs the real ad flow.
    // See PROGRESSION_CONFIG.debugGrantCoins - remove before a production release.
    private async grantDebugCoins() {
        if (!DEBUG_UI_ENABLED) return;
        await PlayerData.grantDebugCoins(PROGRESSION_CONFIG.debugGrantCoins);
        this.toast(`调试 +${PROGRESSION_CONFIG.debugGrantCoins} ${CURRENCY.coin.label}`);
    }

    onDestroy() {
        this._destroyed = true;
        this.cancelLobbyLoading();
        this._nextInvitedRoom = null;
        this._offAppShow?.();
        this._offAppShow = null;
        this._prepareRaceFlow?.dispose();
        this._prepareRaceFlow = null;
        this._roomFlow?.dispose();
        this._identityEditPanel?.dispose();
        this._identityEditPanel = null;
        this._settingsPanel?.dispose();
        this._settingsPanel = null;
        this._headBar?.dispose();
    }

    startGame() {
        this._headBar?.setBack(null);
        this.launchMainGame('race');
    }

    private openPrepareRace() {
        if (this._prepareRaceFlow || this._lobbyLoading || this._destroyed || !this._canvasNode?.isValid) {
            return;
        }
        this._lobbyCover ??= new StartupLoadingCover(this._loginUiRoot);
        this._lobbyCover.setLoading();
        const loading = this._lobbyLoading = new UiAssetBarrier();
        void this.prepareLobby(loading);
    }

    private async prepareLobby(loading: UiAssetBarrier): Promise<void> {
        let mounted = false;
        const ready = loading.waitFor(() => {
            if (!mounted) return false;
            const flow = this._prepareRaceFlow;
            if (flow?.presentationError) throw flow.presentationError;
            return !!flow?.presentationReady;
        });
        // 先还原存档，避免先建默认角色，存档返回后再销毁重建。
        void PlayerData.load().then(() => {
            if (this._lobbyLoading !== loading || this._destroyed || !this._canvasNode?.isValid) return;
            if (!PlayerData.loaded) { loading.fail(new Error('存档加载失败')); return; }
            try {
                loading.run(() => {
                    prepareProjectUiFonts();
                    this.buildHeadBar();
                    this.buildPrepareRace();
                });
                mounted = true;
            } catch (error) { loading.fail(error); }
        }, error => loading.fail(error));
        try {
            await ready;
            if (this._lobbyLoading !== loading || this._destroyed) return;
            this._lobbyLoading = null;
            if (this._loginUiRoot?.isValid) this._loginUiRoot.active = false;
            this._prepareRaceFlow?.playReadyEntrance();
            this._lobbyCover?.dispose(); this._lobbyCover = null;
        } catch (error) {
            if (this._lobbyLoading !== loading || this._destroyed) return;
            this._lobbyLoading = null;
            this._prepareRaceFlow?.dispose(); this._prepareRaceFlow = null;
            this._headBar?.dispose(); this._headBar = null;
            console.warn('[大厅] 加载失败，可点击重试', error);
            this._lobbyCover?.setRetry(() => this.openPrepareRace());
        }
    }

    private cancelLobbyLoading(): void {
        const loading = this._lobbyLoading; this._lobbyLoading = null;
        loading?.cancel();
        this._lobbyCover?.dispose(); this._lobbyCover = null;
    }

    private buildHeadBar(): void {
        if (this._headBar) return;
        this._headBar = new ResourceHeadBar();
        this._headBar.build(getUILayer(this._canvasNode, UILayer.Hud), this._designWidth, this._designHeight, {
            onAddCoins: () => this.toast('单人比赛获得金币，角色页可消耗金币升级'),
            onEditIdentity: () => this.openIdentityEdit(),
            onOpenSettings: () => this.openSettings(),
        });
    }

    private buildPrepareRace(): void {
        this._prepareRaceFlow = new PrepareRaceFlow(getUILayer(this._canvasNode, UILayer.Screen), this._canvasNode, this._designWidth, this._designHeight, {
            onStartRace: () => this.startGame(),
            onOpenRoom: () => this.openRoomFromPrepare(),
            onAiDebug: () => this.showAiDebugPicker(),
            onCharacterManagementChanged: (active) => {
                this._headBar?.setBack(null);
                this._headBar?.setIdentityVisible(!active);
            },
        });
        this._prepareRaceFlow.showReadyScreen(true);
        // The approved lobby composition has no back button. Character management
        // supplies its own temporary return action through the callback above.
        this._headBar?.setBack(null);
    }

    private exitPrepareRace() {
        this._prepareRaceFlow?.dispose();
        this._prepareRaceFlow = null;
        this._headBar?.setBack(null);
        this._headBar?.setIdentityVisible(true);
        if (this._loginUiRoot?.isValid) {
            this._loginUiRoot.active = true;
        }
    }

    private openRoomFromPrepare() {
        this._headBar?.setBack(null);
        this._headBar?.setIdentityVisible(true);
        this.openRoom();
    }

    private handleAppShowInvite(query: Record<string, string>) {
        const invitedRoom = query?.room;
        if (!invitedRoom || this._destroyed) return;
        this._pendingOpenRoom = false;
        this._pendingJoinRoomId = null;
        this._pendingReconnect = false;
        this._nextInvitedRoom = invitedRoom;
        void this.followLatestInvite();
    }

    private async followLatestInvite(): Promise<void> {
        if (this._switchingInvite) return;
        this._switchingInvite = true;
        try {
            while (this._nextInvitedRoom && !this._destroyed && this._canvasNode?.isValid) {
                const room = this._roomFlow;
                if (room?.matchesRoom(this._nextInvitedRoom)) { this._nextInvitedRoom = null; return; }
                if (room) {
                    if (!await room.leaveForInvite()) { this._nextInvitedRoom = null; return; }
                    if (this._destroyed || !this._canvasNode?.isValid) return;
                    room.dispose();
                    if (this._roomFlow === room) this._roomFlow = null;
                }
                // 等待退房期间收到更多邀请时，只进入最新房间。
                const target = this._nextInvitedRoom;
                this._nextInvitedRoom = null;
                if (target) this.openRoom(target);
            }
        } finally { this._switchingInvite = false; }
    }

    private openRoom(joinRoomId: string | null = null, reconnect = false) {
        if (this._roomFlow) {
            return;
        }
        this.cancelLobbyLoading();
        this.buildHeadBar();
        this._prepareRaceFlow?.dispose();
        this._prepareRaceFlow = null;
        // NOTE: do NOT gate on _loginUiRoot here. When launched from a friend's share
        // (cold start), the room must open even if the login prefab isn't ready yet —
        // otherwise the guest lands on an empty scene ("竖屏 + 啥都没有"). Just hide the
        // login UI if it happens to exist.
        console.log(`[Room] openRoom join=${joinRoomId ?? '(host)'} loginRoot=${!!this._loginUiRoot} design=${this._designWidth}x${this._designHeight}`);
        if (this._loginUiRoot?.isValid) {
            this._loginUiRoot.active = false;
        }
        this._roomFlow = new RoomFlow(getUILayer(this._canvasNode, UILayer.Screen), this._designWidth, this._designHeight, {
            onExit: () => this.exitRoom(),
            onStartLocalRace: (_humanCount) => {
                // Editor / local preview: standard race in ROOM MODE so the finish
                // screen offers only "exit", which returns here and re-opens the room.
                setRoomMode(true);
                this._headBar?.setBack(null);
                this.launchMainGame('race');
            },
            onStartNetRace: () => {
                // Networked race: RoomFlow has already set the shared NetRaceSession
                // (seed + roster). GameManager consumes it and reseeds SharedRNG.
                setRoomMode(true);
                this._headBar?.setBack(null);
                this.launchMainGame('race');
            },
        }, joinRoomId, reconnect);
        this._headBar?.setBack(null);
        this._headBar?.setIdentityVisible(false);
    }

    private exitRoom() {
        this._headBar?.setIdentityVisible(true);
        this._roomFlow?.dispose();
        this._roomFlow = null;
        this._headBar?.setBack(null);
        setRoomMode(false);
        this.openPrepareRace();
    }

    startModelDebug() {
        this.launchMainGame('model-debug');
    }

    // Dedicated underwater-effect tuning scene: just the player + venue, the
    // player flutter-kicks below the surface and laps back and forth so the
    // submerged water look can be tuned without playing a full race.
    startUnderwaterDebug() {
        this.launchMainGame('underwater-debug');
    }

    // 测试赛使用面板指定的赛程、人数、角色等级与智力。
    startAiDebug(difficulty: number) {
        if (!DEBUG_UI_ENABLED) return;
        setAiDebugDifficulty(difficulty);
        setRaceDifficulty(getAiDebugSetup().mode);
        this.launchMainGame('ai-debug');
    }

    private launchMainGame(mode: MainGameLaunchMode) {
        if (!DEBUG_UI_ENABLED && mode !== 'race') return;
        if (this._loadingRace) {
            return;
        }
        this._loadingRace = true;
        if (mode !== 'race') { setSoloRaceTicket(null); setSoloRaceDistance(null); setSoloAiEvent(null); }
        setMainGameLaunchMode(mode);

        // Cover the whole Login -> MainGame switch with a persistent loading
        // screen so the new scene's blue world-camera clear color never shows
        // while the pool, swimmers and tuning stream in. GameManager removes it
        // once the race scene is built.
        LoadingOverlay.show();

        loadRaceBundle((bundleError, bundle) => {
            if (bundleError || !bundle) {
                this._loadingRace = false;
                LoadingOverlay.hide();
                console.error('[SpeedSwimming] race bundle failed to load', bundleError);
                this.recoverPrepareAfterLoadFailure();
                return;
            }
            bundle.loadScene('MainGame', (sceneError, scene) => {
                if (sceneError || !scene) {
                    this._loadingRace = false;
                    LoadingOverlay.hide();
                    console.error('[SpeedSwimming] MainGame scene failed to load', sceneError);
                    this.recoverPrepareAfterLoadFailure();
                    return;
                }
                // AI 测试也从大厅进入。趁节点仍有效先清理按钮动效、监听和预览；
                // 不能等引擎销毁子节点后的 onDestroy 再解绑。加载失败不移除大厅。
                this._prepareRaceFlow?.dispose();
                this._prepareRaceFlow = null;
                director.runScene(scene);
            });
        });
    }

    private recoverPrepareAfterLoadFailure(): void {
        // 加载失败后的生命周期恢复，旧界面已退场，需要重新挂载可操作入口。
        this._prepareRaceFlow?.dispose(); this._prepareRaceFlow = null;
        this.openPrepareRace(); this.toast('比赛加载失败，请重试');
    }

    private findCanvasNode(): Node {
        if (this.node.getComponent(Canvas)) {
            return this.node;
        }
        const parent = this.node.parent;
        if (parent?.getComponent(Canvas)) {
            return parent;
        }
        return this.node;
    }

    private setupUiCamera(canvasNode: Node, height: number) {
        const canvas = canvasNode.getComponent(Canvas) || canvasNode.addComponent(Canvas);
        let cameraNode = canvasNode.getChildByName('Camera');
        if (!cameraNode) {
            cameraNode = new Node('Camera');
            cameraNode.setParent(canvasNode);
            cameraNode.addComponent(Camera);
        }
        cameraNode.layer = Layers.Enum.UI_2D;

        const camera = cameraNode.getComponent(Camera) || cameraNode.addComponent(Camera);
        camera.visibility = Layers.BitMask.UI_2D;
        camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        camera.clearColor = new Color(8, 25, 42, 255);
        camera.priority = 0;
        camera.orthoHeight = height / 2;
        canvas.cameraComponent = camera;
    }

    private buildLoginScreen(canvasNode: Node, width: number, height: number) {
        canvasNode.getChildByName('SpeedStarsUI')?.destroy();
        new SpeedStarsStartUiPrefabBuilder({
            onStart: () => this.openPrepareRace(),
            onModelDebug: () => this.startModelDebug(),
            onUnderwaterDebug: () => this.startUnderwaterDebug(),
        }).build(getUILayer(canvasNode, UILayer.Screen), width, height, (error, refs) => {
            if (error) {
                console.error('[SpeedSwimming] Login UI failed to load', error);
                // Cold launch from a friend's share can transiently fail asset/runtime
                // init (subpackage download, GameServerManager subcontext). Retry a
                // couple times before giving up so the menu isn't permanently missing.
                if (this._loginUiRetries < 2 && this._canvasNode?.isValid && !this._roomFlow) {
                    this._loginUiRetries++;
                    this.scheduleOnce(() => {
                        if (this._canvasNode?.isValid && !this._loginUiRoot?.isValid && !this._roomFlow) {
                            this.buildLoginScreen(this._canvasNode, this._designWidth, this._designHeight);
                        }
                    }, 0.6);
                }
            } else {
                this._loginUiRoot = refs?.root ?? null;
                if (this._loginUiRoot?.isValid && (this._prepareRaceFlow || this._roomFlow)) {
                    this._loginUiRoot.active = false;
                }
                this._loginUiRetries = 0;
            }
            // Open the invited/returning room REGARDLESS of whether the login prefab
            // loaded — a guest launched from a friend's share must never get stuck on
            // an empty screen just because the menu prefab was slow/failed to load.
            if (this._pendingOpenRoom) {
                this._pendingOpenRoom = false;
                const roomId = this._pendingJoinRoomId;
                this._pendingJoinRoomId = null;
                const reconnect = this._pendingReconnect;
                this._pendingReconnect = false;
                this.openRoom(roomId, reconnect);
            } else if (this._pendingOpenLobby) {
                this._pendingOpenLobby = false;
                this.openPrepareRace();
            }
        });
    }

    // 弹框继承 Popup 专用渲染层，不能改为主界面的 UI_2D。
    private showAiDebugPicker() {
        if (!DEBUG_UI_ENABLED || !this._canvasNode) {
            return;
        }
        const popup = getUILayer(this._canvasNode, UILayer.Popup);
        popup.getChildByName('AiDebugPicker')?.destroy();
        mountAiDebugSetupPicker(popup, difficulty => this.startAiDebug(difficulty), () => { void this.grantDebugCoins(); });
    }
}
