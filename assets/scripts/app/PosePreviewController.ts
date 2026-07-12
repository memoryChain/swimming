import { _decorator, Camera, Color, Component, DirectionalLight, EventKeyboard, input, Input, Layers, Material, MeshRenderer, Node, primitives, RenderTexture, utils, Vec3 } from 'cc';
import { CartoonSwimmerRig } from '../entity/CartoonSwimmerRig';

const { ccclass, property } = _decorator;

type PreviewView = 'side' | 'front' | 'threeQuarter';
type PosePreviewCapture = {
    view: string;
    filename: string;
    filePath?: string;
    width: number;
    height: number;
    dataUrl: string;
};

const MODEL_LOAD_DELAY_SECONDS = 0.15;
const PREVIEW_SWIMMER_ROOT_Y = -0.42;
const KEY_1 = 49;
const KEY_2 = 50;
const KEY_3 = 51;
const KEY_P = 80;
const KEY_T = 84;
const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 720;
const DEFAULT_CAPTURE_DIRECTORY = 'F:/myworkspace/cocosProjects/SpeedSwimming/tools/pose-preview-captures';

declare const window: {
    __posePreviewCapture?: PosePreviewCapture;
} & Window;

@ccclass('PosePreviewController')
export class PosePreviewController extends Component {
    @property
    public viewName = 'threeQuarter';

    @property
    public downloadCapture = true;

    @property
    public autoCaptureOnStart = true;

    @property
    public captureDirectory = DEFAULT_CAPTURE_DIRECTORY;

    private _worldRoot: Node = null;
    private _cameraNode: Node = null;
    private _rig: CartoonSwimmerRig = null;
    private _captureIndex = 0;

    onLoad() {
        this.node.layer = Layers.Enum.DEFAULT;
        this.disableDefaultSceneNodes();
        this.rebuild();
        if (this.autoCaptureOnStart) {
            this.scheduleOnce(() => this.capturePreviewSequence(), 1.2);
        }
    }

    onEnable() {
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    onDisable() {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    rebuild() {
        this.node.removeAllChildren();
        this._worldRoot = this.makeNode('PosePreviewWorld', this.node);
        this.buildEnvironment(this._worldRoot);
        this.buildReferences(this._worldRoot);
        this.buildSwimmer(this._worldRoot);
        this._cameraNode = this.buildCamera(this.node);
        this.applyView(this.viewName as PreviewView);
    }

    setView(view: PreviewView) {
        this.viewName = view;
        this.applyView(view);
    }

    private onKeyDown(event: EventKeyboard) {
        if (event.keyCode === KEY_1) {
            this.setView('side');
        } else if (event.keyCode === KEY_2) {
            this.setView('front');
        } else if (event.keyCode === KEY_3) {
            this.setView('threeQuarter');
        } else if (event.keyCode === KEY_P) {
            this.captureCurrentView();
        } else if (event.keyCode === KEY_T) {
            this.previewShowcaseToDiveReadyTransition();
        }
    }

    private previewShowcaseToDiveReadyTransition() {
        this._rig?.setShowcaseStanding();
        this.scheduleOnce(() => this._rig?.setDiveReady(true), 0.8);
    }

    captureCurrentView(download = this.downloadCapture) {
        const camera = this._cameraNode?.getComponent(Camera);
        if (!camera) {
            console.warn('[SpeedSwimming] pose preview capture skipped: missing camera');
            return;
        }

        const renderTexture = new RenderTexture('PosePreviewCapture');
        renderTexture.reset({ width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT });
        const previousTarget = camera.targetTexture;
        camera.targetTexture = renderTexture;

        this.scheduleOnce(() => {
            const pixels = renderTexture.readPixels(0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
            camera.targetTexture = previousTarget;
            if (!pixels) {
                renderTexture.destroy();
                console.warn('[SpeedSwimming] pose preview capture failed: readPixels returned empty data');
                return;
            }

            const dataUrl = this.pixelsToPngDataUrl(pixels, CAPTURE_WIDTH, CAPTURE_HEIGHT);
            const filename = this.captureFilename();
            const filePath = this.trySaveDataUrl(dataUrl, filename);
            const result: PosePreviewCapture = {
                view: this.viewName,
                filename,
                filePath,
                width: CAPTURE_WIDTH,
                height: CAPTURE_HEIGHT,
                dataUrl,
            };
            if (typeof window !== 'undefined') {
                window.__posePreviewCapture = result;
            }
            if (download) {
                this.downloadDataUrl(dataUrl, filename);
            }
            renderTexture.destroy();
            console.log(`[SpeedSwimming] pose preview captured ${filePath || filename} ${CAPTURE_WIDTH}x${CAPTURE_HEIGHT}`);
        }, 0);
    }

    private capturePreviewSequence() {
        const views: PreviewView[] = ['side', 'front', 'threeQuarter'];
        views.forEach((view, index) => {
            this.scheduleOnce(() => {
                this.setView(view);
                this.captureCurrentView(false);
            }, index * 0.35);
        });
    }

    private buildEnvironment(parent: Node) {
        const sunNode = this.makeNode('PosePreviewSun', parent);
        sunNode.setRotationFromEuler(-48, 26, 0);
        const sun = sunNode.addComponent(DirectionalLight);
        sun.color = new Color(255, 238, 210, 255);
        sun.illuminance = 1.4;

        const ambient = this.node.scene?.globals?.ambient;
        if (ambient) {
            ambient.skyLightingColor = new Color(194, 228, 255, 255);
            ambient.groundLightingColor = new Color(82, 164, 178, 255);
            ambient.skyIllum = 0.8;
        }
        const skybox = this.node.scene?.globals?.skybox;
        if (skybox) {
            skybox.useHDR = false;
        }
    }

    private buildReferences(parent: Node) {
        const platformMaterial = this.makeMaterial('PosePreviewPlatform', new Color(224, 239, 220, 255));
        const waterMaterial = this.makeMaterial('PosePreviewWater', new Color(42, 208, 232, 140));
        const lineMaterial = this.makeMaterial('PosePreviewLine', new Color(242, 255, 255, 230));

        this.addBox(parent, 'PosePreviewStartBlock', platformMaterial, new Vec3(0, 0.26, 0), new Vec3(1.35, 0.18, 1.12));
        this.addBox(parent, 'PosePreviewPoolDeck', platformMaterial, new Vec3(0.36, 0.04, 0), new Vec3(2.8, 0.08, 1.45));
        this.addBox(parent, 'PosePreviewWaterPlane', waterMaterial, new Vec3(1.55, -0.03, 0), new Vec3(3.2, 0.018, 1.45));
        this.addBox(parent, 'PosePreviewWaterLineNear', lineMaterial, new Vec3(1.55, -0.005, -0.72), new Vec3(3.2, 0.012, 0.018));
        this.addBox(parent, 'PosePreviewWaterLineFar', lineMaterial, new Vec3(1.55, -0.005, 0.72), new Vec3(3.2, 0.012, 0.018));
    }

    private buildSwimmer(parent: Node) {
        const swimmerNode = this.makeNode('PosePreviewSwimmer', parent);
        swimmerNode.setPosition(0, PREVIEW_SWIMMER_ROOT_Y, 0);
        const rig = swimmerNode.addComponent(CartoonSwimmerRig);
        rig.setModelVariant('swimmer0621_2');
        rig.setColorVariant('original');
        rig.setWaterY(-0.03);
        rig.build(
            new Color(246, 176, 118, 255),
            new Color(36, 42, 53, 255),
            new Color(32, 42, 52, 255),
            false,
            true,
        );
        rig.setDiveReady(true);
        this._rig = rig;
        this.scheduleOnce(() => this._rig?.setDiveReady(true), MODEL_LOAD_DELAY_SECONDS);
    }

    private buildCamera(parent: Node): Node {
        const cameraNode = this.makeNode('PosePreviewCamera', parent);
        const camera = cameraNode.addComponent(Camera);
        camera.projection = Camera.ProjectionType.PERSPECTIVE;
        camera.visibility = Layers.BitMask.DEFAULT;
        camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        camera.clearColor = new Color(74, 158, 224, 255);
        camera.fov = 35;
        camera.near = 0.05;
        camera.far = 80;
        camera.priority = 20;
        return cameraNode;
    }

    private disableDefaultSceneNodes() {
        const sceneRoot = this.node.parent;
        if (!sceneRoot) {
            return;
        }
        for (const child of sceneRoot.children) {
            if (child === this.node) {
                continue;
            }
            if (child.name === 'Main Camera' || child.name === 'Main Light') {
                child.active = false;
            }
        }
    }

    private applyView(view: PreviewView) {
        if (!this._cameraNode) {
            return;
        }
        const target = new Vec3(0.05, 0.8, 0);
        const viewName = view === 'side' || view === 'front' || view === 'threeQuarter' ? view : 'threeQuarter';
        if (viewName === 'side') {
            this._cameraNode.setPosition(4.2, 1.28, 0);
        } else if (viewName === 'front') {
            this._cameraNode.setPosition(0.22, 1.2, 4.0);
        } else {
            this._cameraNode.setPosition(3.45, 1.45, 2.85);
        }
        this._cameraNode.lookAt(target);
    }

    private makeNode(name: string, parent: Node): Node {
        const node = new Node(name);
        node.setParent(parent);
        node.layer = Layers.Enum.DEFAULT;
        return node;
    }

    private addBox(parent: Node, name: string, material: Material, position: Vec3, scale: Vec3) {
        const node = this.makeNode(name, parent);
        node.setPosition(position);
        node.setScale(scale);
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = utils.createMesh(primitives.box());
        renderer.setMaterial(material, 0);
    }

    private makeMaterial(name: string, color: Color): Material {
        const material = new Material();
        material.initialize({ effectName: 'builtin-unlit' });
        material.name = name;
        material.setProperty('mainColor', color);
        return material;
    }

    private pixelsToPngDataUrl(pixels: Uint8Array, width: number, height: number): string {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('PosePreview capture failed: 2D canvas context is unavailable');
        }
        const imageData = context.createImageData(width, height);
        const rowBytes = width * 4;
        for (let y = 0; y < height; y++) {
            const srcStart = (height - 1 - y) * rowBytes;
            const dstStart = y * rowBytes;
            imageData.data.set(pixels.subarray(srcStart, srcStart + rowBytes), dstStart);
        }
        context.putImageData(imageData, 0, 0);
        return canvas.toDataURL('image/png');
    }

    private downloadDataUrl(dataUrl: string, filename: string) {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
    }

    private trySaveDataUrl(dataUrl: string, filename: string): string | undefined {
        const globalScope = globalThis as {
            require?: (name: string) => any;
        };
        const windowScope = typeof window !== 'undefined'
            ? window as typeof window & { require?: (name: string) => any }
            : null;
        const nodeRequire = globalScope.require || windowScope?.require;
        if (!nodeRequire || !this.captureDirectory) {
            return undefined;
        }
        try {
            const fs = nodeRequire('fs');
            const bufferModule = nodeRequire('buffer');
            fs.mkdirSync(this.captureDirectory, { recursive: true });
            const filePath = `${this.captureDirectory.replace(/\\/g, '/')}/${filename}`;
            const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
            fs.writeFileSync(filePath, bufferModule.Buffer.from(base64, 'base64'));
            return filePath;
        } catch (error) {
            console.warn(`[SpeedSwimming] pose preview capture local save skipped: ${error}`);
            return undefined;
        }
    }

    private captureFilename(): string {
        this._captureIndex += 1;
        const viewName = this.viewName === 'side' || this.viewName === 'front' || this.viewName === 'threeQuarter'
            ? this.viewName
            : 'threeQuarter';
        const index = this._captureIndex < 10 ? `0${this._captureIndex}` : `${this._captureIndex}`;
        return `pose-preview-${viewName}-${index}.png`;
    }
}
