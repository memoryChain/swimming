import { _decorator, Camera, Canvas, Color, Component, director, Layers, Node, view } from 'cc';
import { MainGameLaunchMode, setAiDebugDifficulty, setMainGameLaunchMode } from '../core/GameLaunchOptions';
import { loadRaceBundle } from '../core/RaceBundleLoader';
import { AI_DEBUG_DIFFICULTY_TIERS } from '../competitor/CompetitorConfig';
import { LoadingOverlay } from '../ui/LoadingOverlay';
import { makeButton, makeLabel, makeRect, makeUiNode, uiColor } from '../ui/RuntimeUiFactory';
import { SpeedStarsStartUiPrefabBuilder } from '../ui/SpeedStarsUiPrefabBuilder';
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
    }

    onDestroy() {
        this._prepareRaceFlow?.dispose();
    }

    startGame() {
        this._prepareRaceFlow?.dispose();
        this._prepareRaceFlow = null;
        this.launchMainGame('race');
    }

    private openPrepareRace() {
        if (this._prepareRaceFlow || !this._loginUiRoot) {
            return;
        }
        this._loginUiRoot.active = false;
        this._prepareRaceFlow = new PrepareRaceFlow(this._canvasNode, this._designWidth, this._designHeight, {
            onBack: () => {
                this._prepareRaceFlow?.dispose();
                this._prepareRaceFlow = null;
                if (this._loginUiRoot?.isValid) this._loginUiRoot.active = true;
            },
            onStartRace: () => this.startGame(),
        });
        this._prepareRaceFlow.showCharacterSelect();
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
            onModelDebug: () => this.startModelDebug(),
            onAiDebug: () => this.showAiDebugPicker(),
        }).build(canvasNode, width, height, (error, refs) => {
            if (error) {
                console.error('[SpeedSwimming] Login UI failed to load', error);
                return;
            }
            this._loginUiRoot = refs?.root ?? null;
        });
    }

    // Overlay that lets the tester pick the single opponent's difficulty before a
    // 100m 1v1 debug race. Built in code on the canvas so it needs no prefab.
    private showAiDebugPicker() {
        if (!this._canvasNode) {
            return;
        }
        this._canvasNode.getChildByName('AiDebugPicker')?.destroy();
        const overlay = makeUiNode('AiDebugPicker', this._canvasNode);
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
