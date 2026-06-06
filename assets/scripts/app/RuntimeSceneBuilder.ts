import { _decorator, Camera, Canvas, Color, Component, DirectionalLight, Layers, Material, MeshRenderer, Node, primitives, utils, Vec3, Vec4, view } from 'cc';
import { RaceCameraDirector } from '../camera/RaceCameraDirector';

const { ccclass } = _decorator;

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
        this.setupEnvironment(sceneRoot);
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
        camera.clearColor = color(38, 48, 48);
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
        sun.color = color(255, 226, 184);
        sun.illuminance = 148000;

        const fillNode = makeWorldNode('CartoonFillLight', root);
        fillNode.setRotationFromEuler(-58, -142, 0);
        const fill = fillNode.addComponent(DirectionalLight);
        fill.color = color(156, 190, 205);
        fill.illuminance = 34000;

        const topNode = makeWorldNode('CartoonTopLight', root);
        topNode.setRotationFromEuler(-88, 12, 0);
        const top = topNode.addComponent(DirectionalLight);
        top.color = color(255, 232, 196);
        top.illuminance = 42000;

        this.buildCeilingLightStrips(root);
    }

    private buildCeilingLightStrips(root: Node) {
        const lightRoot = makeWorldNode('RuntimeCeilingLights', root);
        const warm = makeUnlitMaterial('RuntimeCeilingWarmLight', color(255, 246, 214));
        const cool = makeUnlitMaterial('RuntimeCeilingCoolLight', color(220, 238, 238));
        const ceilingY = 15.45;
        const centerX = 50;
        const longitudinalZ = [-34, -24, -14, -4, 6, 16, 26, 36];
        const crossX = [-18, 8, 34, 60, 86, 112];

        const warmBoxes: RuntimeBoxSpec[] = [];
        const coolBoxes: RuntimeBoxSpec[] = [];
        for (let i = 0; i < longitudinalZ.length; i++) {
            const spec = {
                pos: new Vec3(centerX, ceilingY, longitudinalZ[i]),
                scale: new Vec3(132, 0.045, 0.36),
            };
            (i % 3 === 1 ? coolBoxes : warmBoxes).push(spec);
        }
        for (let i = 0; i < crossX.length; i++) {
            warmBoxes.push({
                pos: new Vec3(crossX[i], ceilingY - 0.02, 0),
                scale: new Vec3(0.32, 0.045, 82),
            });
        }
        addRuntimeBoxGroup(lightRoot, 'CeilingWarmLightMesh', warm, warmBoxes);
        addRuntimeBoxGroup(lightRoot, 'CeilingCoolLightMesh', cool, coolBoxes);
        this.buildCeilingSparkBulbs(lightRoot, ceilingY - 0.08);
    }

    private buildCeilingSparkBulbs(root: Node, y: number) {
        const bulbColors = [
            color(255, 252, 228),
            color(255, 232, 178),
            color(226, 238, 224),
            color(255, 220, 188),
        ];
        const bulbMaterials = bulbColors.map((c, i) => makeUnlitMaterial(`RuntimeCeilingBulb${i}`, c));
        const bulbGroups = bulbColors.map(() => [] as RuntimeBoxSpec[]);
        const xPositions = [-22, -6, 10, 26, 42, 58, 74, 90, 106, 122];
        const zPositions = [-36, -24, -12, 0, 12, 24, 36];

        for (let zi = 0; zi < zPositions.length; zi++) {
            for (let xi = 0; xi < xPositions.length; xi++) {
                if (random01(xi, zi, 0, 71) < 0.18) {
                    continue;
                }
                const group = Math.floor(random01(xi, zi, 0, 83) * bulbGroups.length) % bulbGroups.length;
                const size = 0.38 + random01(xi, zi, group, 97) * 0.3;
                const pos = new Vec3(
                    xPositions[xi] + jitter(xi, zi, 0, 2.1),
                    y - random01(xi, zi, group, 107) * 0.04,
                    zPositions[zi] + jitter(zi, xi, group, 1.5),
                );
                pushFlashBulb(bulbGroups[group], pos, size);
            }
        }

        for (let i = 0; i < bulbGroups.length; i++) {
            const node = addRuntimeBoxGroup(root, `CeilingSparkBulbMesh${i}`, bulbMaterials[i], bulbGroups[i]);
            if (!node) {
                continue;
            }
            const sparkle = node.addComponent(CeilingLightSparkle);
            sparkle.configure(bulbMaterials[i], bulbColors[i], 0.62 + i * 0.17, i * 1.4);
        }
    }

    private setupEnvironment(sceneRoot: Node) {
        const ambient = sceneRoot.scene?.globals?.ambient;
        if (!ambient) {
            return;
        }
        ambient.skyLightingColor = color(226, 220, 198);
        ambient.groundLightingColor = color(108, 174, 172);
        ambient.skyColor = new Vec4(0.34, 0.45, 0.46, 1);
        ambient.groundAlbedo = new Vec4(0.32, 0.58, 0.56, 1);
        ambient.skyIllum = 30000;
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

@ccclass('CeilingLightSparkle')
export class CeilingLightSparkle extends Component {
    private _material: Material = null;
    private _base = new Color(255, 255, 255, 255);
    private _color = new Color(255, 255, 255, 255);
    private _speed = 1;
    private _phase = 0;

    configure(material: Material, baseColor: Color, speed: number, phase: number) {
        this._material = material;
        this._base.set(baseColor);
        this._speed = speed;
        this._phase = phase;
    }

    update(dt: number) {
        if (!this._material) {
            return;
        }
        this._phase += dt * this._speed;
        const wave = (Math.sin(this._phase) + 1) * 0.5;
        const flash = Math.pow(wave, 18);
        const shimmer = (Math.sin(this._phase * 5.3 + 0.7) + 1) * 0.5;
        const scale = Math.max(0.16, Math.min(1, 0.22 + flash * 0.82 + shimmer * 0.08));
        this._color.set(
            Math.min(255, Math.round(this._base.r * scale + 255 * flash * 0.18)),
            Math.min(255, Math.round(this._base.g * scale + 255 * flash * 0.18)),
            Math.min(255, Math.round(this._base.b * scale + 255 * flash * 0.18)),
            255,
        );
        this._material.setProperty('mainColor', this._color);
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

function random01(a: number, b: number, c: number, salt: number): number {
    const seed = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719 + salt * 19.19) * 43758.5453;
    return seed - Math.floor(seed);
}

function jitter(a: number, b: number, c: number, scale: number): number {
    return (random01(a, b, c, 0) - 0.5) * scale;
}

function makeUnlitMaterial(name: string, albedo: Color): Material {
    const material = new Material();
    material.initialize({ effectName: 'builtin-unlit' });
    material.name = name;
    material.setProperty('mainColor', albedo);
    return material;
}

type RuntimeBoxSpec = {
    pos: Vec3;
    scale: Vec3;
};

function pushFlashBulb(boxes: RuntimeBoxSpec[], pos: Vec3, size: number) {
    boxes.push({
        pos: new Vec3(pos.x, pos.y - 0.028, pos.z),
        scale: new Vec3(size * 0.42, 0.1, size * 0.42),
    });
    boxes.push({
        pos: new Vec3(pos.x, pos.y, pos.z),
        scale: new Vec3(size * 1.9, 0.055, size * 0.16),
    });
    boxes.push({
        pos: new Vec3(pos.x, pos.y + 0.006, pos.z),
        scale: new Vec3(size * 0.16, 0.055, size * 1.9),
    });
}

function addRuntimeBoxGroup(parent: Node, name: string, material: Material, boxes: RuntimeBoxSpec[]): Node | null {
    if (boxes.length <= 0) {
        return null;
    }
    const node = makeWorldNode(name, parent);
    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = utils.createMesh(buildBoxGroupGeometry(boxes));
    renderer.setMaterial(material, 0);
    return node;
}

function buildBoxGroupGeometry(boxes: RuntimeBoxSpec[]): primitives.IGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const minPos = new Vec3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    const maxPos = new Vec3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

    for (const box of boxes) {
        pushBoxGeometry(positions, normals, uvs, indices, minPos, maxPos, box);
    }

    return { positions, normals, uvs, indices, minPos, maxPos };
}

function pushBoxGeometry(
    positions: number[],
    normals: number[],
    uvs: number[],
    indices: number[],
    minPos: Vec3,
    maxPos: Vec3,
    box: RuntimeBoxSpec,
) {
    const halfX = box.scale.x * 0.5;
    const halfY = box.scale.y * 0.5;
    const halfZ = box.scale.z * 0.5;
    const x0 = box.pos.x - halfX;
    const x1 = box.pos.x + halfX;
    const y0 = box.pos.y - halfY;
    const y1 = box.pos.y + halfY;
    const z0 = box.pos.z - halfZ;
    const z1 = box.pos.z + halfZ;

    pushFace(positions, normals, uvs, indices, minPos, maxPos, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
    pushFace(positions, normals, uvs, indices, minPos, maxPos, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1]);
    pushFace(positions, normals, uvs, indices, minPos, maxPos, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0]);
    pushFace(positions, normals, uvs, indices, minPos, maxPos, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]);
    pushFace(positions, normals, uvs, indices, minPos, maxPos, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0]);
    pushFace(positions, normals, uvs, indices, minPos, maxPos, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]);
}

function pushFace(
    positions: number[],
    normals: number[],
    uvs: number[],
    indices: number[],
    minPos: Vec3,
    maxPos: Vec3,
    corners: number[][],
    normal: number[],
) {
    const base = positions.length / 3;
    const faceUvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let i = 0; i < 4; i++) {
        const [x, y, z] = corners[i];
        positions.push(x, y, z);
        normals.push(normal[0], normal[1], normal[2]);
        uvs.push(faceUvs[i][0], faceUvs[i][1]);
        minPos.x = Math.min(minPos.x, x);
        minPos.y = Math.min(minPos.y, y);
        minPos.z = Math.min(minPos.z, z);
        maxPos.x = Math.max(maxPos.x, x);
        maxPos.y = Math.max(maxPos.y, y);
        maxPos.z = Math.max(maxPos.z, z);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
