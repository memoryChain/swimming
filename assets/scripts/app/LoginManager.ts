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
import { ensureLogin } from '../platform/PlatformSession';
import { platform } from '../platform/PlatformManager';
import { PlayerData } from '../backend/PlayerData';
import { getProgressionManager } from '../progression/ProgressionManager';
import { SettingsManager } from './SettingsManager';
import { openSettingsPanel } from '../ui/SettingsPanel';
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
        this._pendingOpenRoom = consumeReturnToRoom();
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
            onOpenSettings: () => openSettingsPanel(canvasNode, width, height),
        });
        void PlayerData.load().then(() => getProgressionManager().migrateLegacySave());
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
        this._prepareRaceFlow = new PrepareRaceFlow(getUILayer(this._canvasNode, UILayer.Screen), this._canvasNode, this._designWidth, this._designHeight, {
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

    private openRoom() {
        if (this._roomFlow || !this._loginUiRoot) {
            return;
        }
        this._loginUiRoot.active = false;
        this._roomFlow = new RoomFlow(getUILayer(this._canvasNode, UILayer.Screen), this._designWidth, this._designHeight, {
            onExit: () => this.exitRoom(),
            onStartRace: (_humanCount) => {
                // Placeholder: real networked race (frame sync + AI fill) is phase 2B.
                // Launch the standard race in ROOM MODE so the finish screen offers
                // only "exit", which returns here and re-opens the room.
                setRoomMode(true);
                this._headBar?.setBack(null);
                this.launchMainGame('race');
            },
        });
        this._headBar?.setBack(() => this.exitRoom());
    }

    private exitRoom() {
        this._roomFlow?.dispose();
        this._roomFlow = null;
        this._headBar?.setBack(null);
        if (this._loginUiRoot?.isValid) {
            this._loginUiRoot.active = true;
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
                return;
            }
            this._loginUiRoot = refs?.root ?? null;
            // Returning from a room-mode race re-opens the room.
            if (this._pendingOpenRoom) {
                this._pendingOpenRoom = false;
                this.openRoom();
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
