import { Camera, Canvas, Color, Component, DirectionalLight, Layers, Node, SphereLight, Vec3, view } from 'cc';
import { RaceCameraDirector } from '../camera/RaceCameraDirector';

export type RuntimeSceneRefs = {
    canvasNode: Node;
    sceneRoot: Node;
    worldRoot: Node;
    cameraNode: Node;
    width: number;
    height: number;
};

export type RuntimeSceneBuilderOptions = {
    owner: Component;
    cameraDirector: RaceCameraDirector;
    initialCameraPosition: Readonly<{ x: number; y: number; z: number }>;
    initialCameraTarget: Readonly<{ x: number; y: number; z: number }>;
    poolWidth: number;
};

export class RuntimeSceneBuilder {
    constructor(private readonly _options: RuntimeSceneBuilderOptions) {}

    build(): RuntimeSceneRefs {
        const canvasNode = this.findCanvasNode();
        const sceneRoot = canvasNode.parent || canvasNode;
        canvasNode.layer = Layers.Enum.UI_2D;
        this._options.owner.node.layer = Layers.Enum.UI_2D;
        this.cleanRuntimeChildren(canvasNode, sceneRoot);

        const design = view.getDesignResolutionSize();
        const width = design.width || 1280;
        const height = design.height || 720;

        this.setupUiCamera(canvasNode, height);
        const worldRoot = makeWorldNode('Runtime3DWorld', sceneRoot);
        const cameraNode = this.setupWorldCamera(sceneRoot);
        this.buildLights(worldRoot);

        return {
            canvasNode,
            sceneRoot,
            worldRoot,
            cameraNode,
            width,
            height,
        };
    }

    findCanvasNode(): Node {
        const ownerNode = this._options.owner.node;
        if (ownerNode.getComponent(Canvas)) {
            return ownerNode;
        }
        const parent = ownerNode.parent;
        if (parent?.getComponent(Canvas)) {
            return parent;
        }
        return ownerNode;
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
        const camera = cameraNode.getComponent(Camera);
        camera.visibility = Layers.BitMask.UI_2D;
        camera.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
        camera.priority = 10;
        camera.orthoHeight = height / 2;
        canvas.cameraComponent = camera;
    }

    private setupWorldCamera(sceneRoot: Node): Node {
        const cameraNode = makeWorldNode('BroadcastCamera3D', sceneRoot);
        const start = this._options.initialCameraPosition;
        const target = this._options.initialCameraTarget;
        cameraNode.setPosition(start.x, start.y, start.z);
        const camera = cameraNode.addComponent(Camera);
        camera.projection = Camera.ProjectionType.PERSPECTIVE;
        camera.visibility = Layers.BitMask.DEFAULT;
        camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        camera.clearColor = color(122, 198, 238);
        camera.fov = 36;
        camera.near = 0.1;
        camera.far = 260;
        camera.priority = 0;
        cameraNode.lookAt(new Vec3(target.x, target.y, target.z));
        this._options.cameraDirector.bindCamera(cameraNode);
        return cameraNode;
    }

    private buildLights(root: Node) {
        const sunNode = makeWorldNode('StadiumSun', root);
        sunNode.setRotationFromEuler(-48, 34, 0);
        const sun = sunNode.addComponent(DirectionalLight);
        sun.illuminance = 118000;

        const fillNode = makeWorldNode('PoolFillLight', root);
        fillNode.setPosition(45, 10, 8);
        const fill = fillNode.addComponent(SphereLight);
        fill.luminousFlux = 9800;
        fill.size = 9;

        for (let x = 0; x <= 100; x += 20) {
            const lightNode = makeWorldNode('RoofLight', root);
            lightNode.setPosition(x, 8.6, -this._options.poolWidth / 2 - 7.2);
            const light = lightNode.addComponent(SphereLight);
            light.luminousFlux = 1600;
            light.size = 1.1;

            const mirrorNode = makeWorldNode('RoofLightMirror', root);
            mirrorNode.setPosition(x, 8.6, this._options.poolWidth / 2 + 7.2);
            const mirror = mirrorNode.addComponent(SphereLight);
            mirror.luminousFlux = 1600;
            mirror.size = 1.1;
        }
    }

    private cleanRuntimeChildren(canvasNode: Node, sceneRoot: Node) {
        const camera = canvasNode.getChildByName('Camera');
        for (const child of [...canvasNode.children]) {
            if (child !== camera && child !== this._options.owner.node) {
                child.active = false;
                child.destroy();
            }
        }
        for (const child of [...sceneRoot.children]) {
            if (child.name === 'Runtime3DWorld' || child.name === 'BroadcastCamera3D') {
                child.destroy();
            }
        }
    }
}

export function makeWorldNode(name: string, parent: Node): Node {
    const node = new Node(name);
    node.setParent(parent);
    node.layer = Layers.Enum.DEFAULT;
    return node;
}

function color(r: number, g: number, b: number, a = 255): Color {
    return new Color(r, g, b, a);
}
