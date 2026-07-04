import { Camera, Canvas, Color, Component, DirectionalLight, Layers, Node, Vec3, Vec4, view } from 'cc';
import { RaceCameraDirector } from '../camera/RaceCameraDirector';
import { StandardSkyboxApplier } from './StandardSkyboxApplier';

export type RuntimeSceneRefs = {
    canvasNode: Node;
    sceneRoot: Node;
    worldRoot: Node;
    cameraNode: Node;
    skyboxApplier: StandardSkyboxApplier;
    width: number;
    height: number;
};

export type RuntimeSceneBuilderOptions = {
    owner: Component;
    cameraDirector: RaceCameraDirector;
    initialCameraPosition: Readonly<{ x: number; y: number; z: number }>;
    initialCameraTarget: Readonly<{ x: number; y: number; z: number }>;
    poolWidth: number;
    debug?: (message: string) => void;
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
        this.setupEnvironment(sceneRoot);
        const worldCamera = cameraNode.getComponent(Camera);
        const skyboxApplier = new StandardSkyboxApplier();
        if (worldCamera) {
            skyboxApplier.bind(sceneRoot, worldCamera, this._options.debug);
            skyboxApplier.disable(color(74, 158, 224));
        }
        this.buildLights(worldRoot);

        return {
            canvasNode,
            sceneRoot,
            worldRoot,
            cameraNode,
            skyboxApplier,
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
        camera.clearColor = color(74, 158, 224);
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
        sunNode.setRotationFromEuler(-46, 24, 0);
        const sun = sunNode.addComponent(DirectionalLight);
        sun.color = color(255, 238, 210);
        sun.illuminance = 1.35;
    }

    private setupEnvironment(sceneRoot: Node) {
        const ambient = sceneRoot.scene?.globals?.ambient;
        if (!ambient) {
            return;
        }
        const skybox = sceneRoot.scene?.globals?.skybox;
        if (skybox) {
            skybox.useHDR = false;
        }
        ambient.skyLightingColor = color(255, 241, 219);
        ambient.groundLightingColor = color(168, 150, 126);
        ambient.skyColor = new Vec4(0.74, 0.68, 0.57, 1);
        ambient.groundAlbedo = new Vec4(0.42, 0.38, 0.32, 1);
        ambient.skyIllum = 0.8;
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
