import { _decorator, Camera, Canvas, Component, director, Layers, Node, UITransform, view } from 'cc';
import { makeButton, makeLabel, makeRect, makeUiNode, uiColor } from '../ui/RuntimeUiFactory';

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
        camera.clearColor = uiColor(8, 25, 42);
        camera.priority = 0;
        camera.orthoHeight = height / 2;
        canvas.cameraComponent = camera;
    }

    private buildLoginScreen(canvasNode: Node, width: number, height: number) {
        canvasNode.getChildByName('LoginRoot')?.destroy();

        const root = makeUiNode('LoginRoot', canvasNode);
        root.getComponent(UITransform).setContentSize(width, height);

        makeRect('Backdrop', root, width, height, uiColor(8, 25, 42));
        makeRect('WaterBand', root, width, 130, uiColor(16, 132, 174)).setPosition(0, -height / 2 + 65, 0);
        makeRect('StartBlock', root, 290, 58, uiColor(255, 222, 82)).setPosition(0, -64, 0);

        makeLabel('Kicker', root, 'RACE LOGIN', 18, uiColor(127, 226, 236)).setPosition(0, 112, 0);
        makeLabel('Title', root, 'SPEED SWIMMING', 56, uiColor(255, 255, 255)).setPosition(0, 56, 0);
        makeLabel('Subtitle', root, 'Ready when you are.', 22, uiColor(218, 235, 238)).setPosition(0, 4, 0);

        const start = makeButton('EnterRaceButton', root, 220, 52, uiColor(38, 116, 190), 'START');
        start.setPosition(0, -64, 0);
        start.on(Node.EventType.TOUCH_END, () => this.startGame(), this);
    }
}
