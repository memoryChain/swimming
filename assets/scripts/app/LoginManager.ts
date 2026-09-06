import { _decorator, Camera, Canvas, Color, Component, director, Layers, Node, UITransform, view } from 'cc';
import { MainGameLaunchMode, setAiDebugDifficulty, setMainGameLaunchMode, consumeReturnToRoom, consumeReturnToLobby, setRoomMode } from '../core/GameLaunchOptions';
import { loadRaceBundle } from '../core/RaceBundleLoader';
import { AI_DEBUG_DIFFICULTY_TIERS } from '../competitor/CompetitorConfig';
import { LoadingOverlay } from '../ui/LoadingOverlay';
import { fitFullScreenBackgroundCover, makeButton, makeLabel, makeRect, makeUiNode, uiColor } from '../ui/RuntimeUiFactory';
import { SpeedStarsStartUiPrefabBuilder } from '../ui/SpeedStarsUiPrefabBuilder';
import { ResourceHeadBar } from '../ui/ResourceHeadBar';
import { IdentityEditPanel } from '../ui/IdentityEditPanel';
import { RoomFlow } from '../ui/RoomFlow';
import { getUILayer, UILayer } from '../ui/UILayers';
import { netRoom } from '../net/NetManager';
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

    onLoad() {
        const canvasNode = this.findCanvasNode();
        canvasNode.layer = Layers.Enum.UI_2D;

        const design = view.getDesignResolutionSize();
        const width = design.width || 1280;
        const height = design.height || 720;
        this._canvasNode = canvasNode;
        this._designWidth = width;
        this._designHeight = height;

        this.setupUiCamera(canvasNode, height);
        this.buildLoginScreen(canvasNode, width, height);
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
            const invitedRoom = platform().getLaunchQuery().room;
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
        this._headBar = new ResourceHeadBar();
        this._headBar.build(getUILayer(canvasNode, UILayer.Hud), width, height, {
            onAddCoins: () => this.watchAdForCoins(),
            onEditIdentity: () => this.openIdentityEdit(),
            onOpenSettings: () => this.openSettings(),
        });
        void PlayerData.load().then(() => getProgressionManager().migrateLegacySave());
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
        await PlayerData.grantDebugCoins(PROGRESSION_CONFIG.debugGrantCoins);
        this.toast(`调试 +${PROGRESSION_CONFIG.debugGrantCoins} ${CURRENCY.coin.label}`);
    }

    onDestroy() {
        this._offAppShow?.();
        this._offAppShow = null;
        this._prepareRaceFlow?.dispose();
        this._roomFlow?.dispose();
        this._identityEditPanel?.dispose();
        this._identityEditPanel = null;
        this._settingsPanel?.dispose();
        this._settingsPanel = null;
        this._headBar?.dispose();
    }

    startGame() {
        this._headBar?.setBack(null);
        this._prepareRaceFlow?.dispose();
        this._prepareRaceFlow = null;
        this.launchMainGame('race');
    }

    private openPrepareRace() {
        if (this._prepareRaceFlow || !this._canvasNode?.isValid) {
            return;
        }
        if (this._loginUiRoot?.isValid) this._loginUiRoot.active = false;
        this._prepareRaceFlow = new PrepareRaceFlow(getUILayer(this._canvasNode, UILayer.Screen), this._canvasNode, this._designWidth, this._designHeight, {
            onStartRace: () => this.startGame(),
            onOpenRoom: () => this.openRoomFromPrepare(),
            onCharacterManagementChanged: (active) => {
                this._headBar?.setBack(null);
                this._headBar?.setIdentityVisible(!active);
            },
        });
        this._prepareRaceFlow.showReadyScreen();
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
        const invitedRoom = query && query.room;
        if (!invitedRoom) {
            return;
        }
        console.log(`[Room] onShow invite room=${invitedRoom} roomOpen=${!!this._roomFlow}`);
        // Any deferred open (login screen still loading) is superseded by this invite.
        this._pendingOpenRoom = false;
        this._pendingJoinRoomId = null;
        this._pendingReconnect = false;
        if (this._roomFlow) {
            // Already in a room. If it's the SAME room, do nothing. Otherwise LEAVE the
            // current room first, then join the friend's — previously this returned and
            // silently did nothing, so tapping a friend's invite while already in a room
            // left the player stuck in the old room ("一直加不到好友的房间里").
            if (this._roomFlow.matchesRoom(invitedRoom)) {
                return;
            }
            this._roomFlow.dispose();
            this._roomFlow = null;
            this._headBar?.setBack(null);
            // Leave the old room on the server BEFORE joining the new one (WeChat only
            // allows membership in one room at a time; joining while still in the old one
            // fails). Open the invited room once the leave settles.
            netRoom()
                .leaveRoom()
                .catch(() => undefined)
                .then(() => {
                    if (this._canvasNode?.isValid && !this._roomFlow) {
                        this.openRoom(invitedRoom);
                    }
                });
            return;
        }
        // Open the invited room in JOIN mode right away (openRoom hides the login UI).
        this.openRoom(invitedRoom);
    }

    private openRoom(joinRoomId: string | null = null, reconnect = false) {
        if (this._roomFlow) {
            return;
        }
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

    // 100m AI-debug 1v1: store the chosen difficulty and launch straight into a
    // single-opponent race. All race modes now use the fixed 100m distance.
    startAiDebug(difficulty: number) {
        setAiDebugDifficulty(difficulty);
        this.launchMainGame('ai-debug');
    }

    private launchMainGame(mode: MainGameLaunchMode) {
        if (this._loadingRace) {
            return;
        }
        this._loadingRace = true;
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
                return;
            }
            bundle.loadScene('MainGame', (sceneError, scene) => {
                if (sceneError || !scene) {
                    this._loadingRace = false;
                    LoadingOverlay.hide();
                    console.error('[SpeedSwimming] MainGame scene failed to load', sceneError);
                    return;
                }
                director.runScene(scene);
            });
        });
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
            onAiDebug: () => this.showAiDebugPicker(),
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

    // Overlay that lets the tester pick the single opponent's difficulty before a
    // 100m 1v1 debug race. Built in code on the canvas so it needs no prefab.
    private showAiDebugPicker() {
        if (!this._canvasNode) {
            return;
        }
        const popup = getUILayer(this._canvasNode, UILayer.Popup);
        popup.getChildByName('AiDebugPicker')?.destroy();
        const overlay = makeUiNode('AiDebugPicker', popup);
        overlay.layer = Layers.Enum.UI_2D;
        const dim = makeRect('Dim', overlay, this._designWidth, this._designHeight, uiColor(2, 8, 14, 210));
        fitFullScreenBackgroundCover(dim);
        makeLabel('Title', overlay, '选择 AI 难度', 30, uiColor(240, 250, 255)).setPosition(0, 190, 0);

        const tiers = AI_DEBUG_DIFFICULTY_TIERS;
        const spacing = 74;
        const firstY = ((tiers.length - 1) * spacing) / 2 + 10;
        tiers.forEach((tier, i) => {
            const button = makeButton(`Tier${i}`, overlay, 300, 60, uiColor(40, 96, 168, 240), tier.label);
            button.setPosition(0, firstY - i * spacing, 0);
            button.on(Node.EventType.TOUCH_END, () => this.startAiDebug(tier.value));
        });

        const cancel = makeButton('Cancel', overlay, 200, 52, uiColor(90, 96, 104, 235), '返回');
        cancel.setPosition(0, firstY - tiers.length * spacing - 6, 0);
        cancel.on(Node.EventType.TOUCH_END, () => overlay.destroy());

        // DEBUG ONLY: free coin grant (no ad, no cap) tucked into this dev popup so
        // it stays reachable for testing the level system, while the headbar "+"
        // runs the real rewarded-ad flow. Remove before a production release.
        const debugCoins = makeButton('DebugCoins', overlay, 300, 52, uiColor(120, 72, 24, 235), `调试 +${PROGRESSION_CONFIG.debugGrantCoins} ${CURRENCY.coin.label}`);
        debugCoins.setPosition(0, firstY - (tiers.length + 1) * spacing - 6, 0);
        debugCoins.on(Node.EventType.TOUCH_END, () => { void this.grantDebugCoins(); });
    }
}
