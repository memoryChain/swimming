import { _decorator, Camera, Canvas, Color, Component, director, Layers, Node, view } from 'cc';
import { setRaceDistance } from '../core/GameBalance';
import { setMainGameLaunchMode } from '../core/GameLaunchOptions';
import { SpeedStarsStartUiPrefabBuilder } from '../ui/SpeedStarsUiPrefabBuilder';

const { ccclass } = _decorator;

@ccclass('LoginManager')
export class LoginManager extends Component {
    onLoad() {
        const canvasNode = this.findCanvasNode();
        canvasNode.layer = Layers.Enum.UI_2D;

        const design = view.getDesignResolutionSize();
        const width = design.width || 1280;
        const height = design.height || 720;

        this.setupUiCamera(canvasNode, height);
        this.buildLoginScreen(canvasNode, width, height);
    }

    startGame() {
        setMainGameLaunchMode('race');
        director.loadScene('MainGame');
    }

    startModelDebug() {
        setMainGameLaunchMode('model-debug');
        director.loadScene('MainGame');
    }

    startFreeSwim() {
        setMainGameLaunchMode('free-swim');
        director.loadScene('MainGame');
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
            onStart: () => this.startGame(),
            onDistanceSelect: (distance) => setRaceDistance(distance),
            onModelDebug: () => this.startModelDebug(),
            onFreeSwim: () => this.startFreeSwim(),
        }).build(canvasNode, width, height, (error) => {
            if (error) {
                console.error('[SpeedSwimming] Login UI failed to load', error);
            }
        });
    }
}
