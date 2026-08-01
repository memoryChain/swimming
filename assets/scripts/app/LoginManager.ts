import { _decorator, Camera, Canvas, Color, Component, director, Layers, Node, UITransform, view } from 'cc';
import { MainGameLaunchMode, setAiDebugDifficulty, setMainGameLaunchMode, consumeReturnToRoom, setRoomMode } from '../core/GameLaunchOptions';
import { loadRaceBundle } from '../core/RaceBundleLoader';
import { AI_DEBUG_DIFFICULTY_TIERS } from '../competitor/CompetitorConfig';
import { LoadingOverlay } from '../ui/LoadingOverlay';
import { makeButton, makeLabel, makeRect, makeUiNode, uiColor } from '../ui/RuntimeUiFactory';
import { SpeedStarsStartUiPrefabBuilder } from '../ui/SpeedStarsUiPrefabBuilder';
import { ResourceHeadBar } from '../ui/ResourceHeadBar';
import { RoomFlow } from '../ui/RoomFlow';
import { getUILayer, UILayer } from '../ui/UILayers';
import { netRoom } from '../net/NetManager';
import { ensureLogin } from '../platform/PlatformSession';
import { platform } from '../platform/PlatformManager';
import { PlayerData } from '../backend/PlayerData';
import { AVATARS } from '../backend/IdentityConfig';
import { MusicManager } from './MusicManager';
import { PrepareRaceFlow } from '../ui/PrepareRaceFlow';

// Placeholder rewarded-ad unit id. Replace with the real id from the WeChat MP
// backend before shipping.
const SWIM_CARD_AD_UNIT_ID = 'adunit-swimcard-placeholder';

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
    private _roomFlow: RoomFlow | null = null;
    private _adPending = false;
    private _pendingOpenRoom = false;
    private _pendingJoinRoomId: string | null = null;
    private _pendingReconnect = false;
    private _loginUiRetries = 0;
    private _offAppShow: (() => void) | null = null;

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
        MusicManager.playLogin();
        // Returning from a room-mode race: re-open the room once the login UI loads.
        // This is a RECONNECT to the still-existing room, not a fresh create/join.
        const returningToRoom = consumeReturnToRoom();
        this._pendingOpenRoom = returningToRoom;
        this._pendingReconnect = returningToRoom;
        // Launched from a shared room invite (query `room=<accessInfo>`): auto-open the
        // room in JOIN mode. IMPORTANT: only on a genuine fresh launch — getLaunchQuery()
        // keeps returning the ORIGINAL invite room on every later scene load, so honoring
        // it after a race would wrongly re-JOIN the (now in-game) room ("invalid room
        // state"). When returning from a race we reconnect instead and ignore it.
        if (!returningToRoom) {
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
            onAddSwimCards: () => this.watchAdForSwimCards(),
            onEditIdentity: () => this.openIdentityEdit(),
        });
        void PlayerData.load();
    }

    // Simple identity editor popup: pick an avatar swatch and reroll the random
    // nickname. Changes persist via PlayerData; the headbar auto-refreshes.
    private openIdentityEdit() {
        if (!this._canvasNode) {
            return;
        }
        const popup = getUILayer(this._canvasNode, UILayer.Popup);
        popup.getChildByName('IdentityEdit')?.destroy();
        const root = makeUiNode('IdentityEdit', popup);
        const dim = makeRect('Dim', root, this._designWidth, this._designHeight, uiColor(2, 8, 14, 200));
        dim.on(Node.EventType.TOUCH_END, () => root.destroy());
        const panel = makeRect('Panel', root, 520, 440, uiColor(14, 36, 58, 250));
        makeLabel('Title', panel, '编辑资料', 30, uiColor(240, 250, 255)).setPosition(0, 176, 1);
        const content = makeUiNode('Content', panel);
        const render = () => {
            content.removeAllChildren();
            const nick = makeLabel('Nick', content, PlayerData.nickName, 26, uiColor(255, 244, 188));
            nick.getComponent(UITransform)!.setContentSize(460, 36);
            nick.setPosition(0, 128, 1);
            const reroll = makeButton('Reroll', content, 168, 46, uiColor(40, 96, 168, 240), '换个昵称');
            reroll.setPosition(0, 78, 1);
            reroll.on(Node.EventType.TOUCH_END, () => { void PlayerData.rerollNickName().then(render); });
            const size = 66;
            const cols = 4;
            AVATARS.forEach((option, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const x = (col - (cols - 1) / 2) * 108;
                const y = 6 - row * 86;
                if (option.id === PlayerData.avatarId) {
                    makeRect(`Sel${i}`, content, size + 10, size + 10, uiColor(20, 205, 229, 255)).setPosition(x, y, 0);
                }
                const [r, g, b] = option.color;
                const swatch = makeButton(`Av_${option.id}`, content, size, size, uiColor(r, g, b, 255), '');
                swatch.setPosition(x, y, 1);
                swatch.on(Node.EventType.TOUCH_END, () => { void PlayerData.setAvatar(option.id).then(render); });
            });
        };
        render();
        const close = makeButton('Close', panel, 200, 52, uiColor(61, 81, 99, 255), '完成');
        close.setPosition(0, -182, 1);
        close.on(Node.EventType.TOUCH_END, () => root.destroy());
    }

    // Watch a rewarded ad to gain 游泳卡. The reward is granted authoritatively by the
    // backend (mock now, cloud function later); the headbar auto-refreshes via
    // PlayerData.onChange. Guarded so double-taps don't stack ad requests.
    private async watchAdForSwimCards() {
        if (this._adPending) {
            return;
        }
        this._adPending = true;
        try {
            const outcome = await platform().showRewardedAd(SWIM_CARD_AD_UNIT_ID);
            if (outcome !== 'completed') {
                console.log(`[Login] rewarded ad not completed: ${outcome}`);
                return;
            }
            const result = await PlayerData.grantAdReward();
            if (result.ok) {
                console.log(`[Login] +${result.granted} 游泳卡 (total ${result.profile.swimCards})`);
            } else if (result.reason === 'capped') {
                console.log('[Login] daily ad reward cap reached');
            }
        } finally {
            this._adPending = false;
        }
    }

    onDestroy() {
        this._offAppShow?.();
        this._offAppShow = null;
        this._prepareRaceFlow?.dispose();
        this._roomFlow?.dispose();
        this._headBar?.dispose();
    }

    startGame() {
        this._headBar?.setBack(null);
        this._prepareRaceFlow?.dispose();
        this._prepareRaceFlow = null;
        this.launchMainGame('race');
    }

    private openPrepareRace() {
        if (this._prepareRaceFlow || !this._loginUiRoot) {
            return;
        }
        this._loginUiRoot.active = false;
        this._prepareRaceFlow = new PrepareRaceFlow(getUILayer(this._canvasNode, UILayer.Screen), this._designWidth, this._designHeight, {
            onBack: () => this.exitPrepareRace(),
            onStartRace: () => this.startGame(),
        });
        this._prepareRaceFlow.showCharacterSelect();
        // Integrate the back action into the headbar (top-left) so it never clashes
        // with the prepare-race UI.
        this._headBar?.setBack(() => this.exitPrepareRace());
    }

    private exitPrepareRace() {
        this._prepareRaceFlow?.dispose();
        this._prepareRaceFlow = null;
        this._headBar?.setBack(null);
        if (this._loginUiRoot?.isValid) {
            this._loginUiRoot.active = true;
        }
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
        this._headBar?.setBack(() => this.exitRoom());
    }

    private exitRoom() {
        this._roomFlow?.dispose();
        this._roomFlow = null;
        this._headBar?.setBack(null);
        if (this._loginUiRoot?.isValid) {
            this._loginUiRoot.active = true;
        } else if (this._canvasNode?.isValid) {
            // A guest launched straight into the room from a share never had the login
            // menu built — build it now so exiting returns to a real screen instead of
            // leaving a blank one.
            this.buildLoginScreen(this._canvasNode, this._designWidth, this._designHeight);
        }
    }

    startModelDebug() {
        this.launchMainGame('model-debug');
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
            onRoom: () => this.openRoom(),
            onModelDebug: () => this.startModelDebug(),
            onAiDebug: () => this.showAiDebugPicker(),
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
        makeRect('Dim', overlay, this._designWidth, this._designHeight, uiColor(2, 8, 14, 210));
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
    }
}
