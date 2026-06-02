import { Color, Layers, Material, MeshRenderer, Node, primitives, utils, Vec3 } from 'cc';
import { PoolDefinition } from './VenueConfig';

export class PoolFallbackBuilder {
    build(root: Node, definition: PoolDefinition) {
        const poolWidth = definition.laneCount * definition.laneWidth;
        const mats = {
            floor: makeMaterial('emptyPoolFloor', color(14, 32, 54)),
            start: makeMaterial('startLine', color(255, 224, 36)),
            finish: makeMaterial('finishLine', color(255, 255, 255)),
        };
        const centerX = (definition.startX + definition.finishX) * 0.5;
        const length = definition.raceDistance + 16;

        addBox(root, 'EmptyRaceSurface', mats.floor, new Vec3(centerX, -0.06, 0), new Vec3(length, 0.04, poolWidth + 2));
        addBox(root, 'StartLine', mats.start, new Vec3(definition.startX, 0.02, 0), new Vec3(0.24, 0.04, poolWidth + 1));
        addBox(root, 'FinishLine', mats.finish, new Vec3(definition.finishX, 0.02, 0), new Vec3(0.28, 0.04, poolWidth + 1));
    }
}

function color(r: number, g: number, b: number, a = 255): Color {
    return new Color(r, g, b, a);
}

function makeMaterial(name: string, albedo: Color): Material {
    const material = new Material();
    material.initialize({ effectName: 'builtin-standard' });
    material.name = name;
    material.setProperty('albedo', albedo);
    material.setProperty('roughness', 0.68);
    return material;
}

function makeWorldNode(name: string, parent: Node): Node {
    const node = new Node(name);
    node.setParent(parent);
    node.layer = Layers.Enum.DEFAULT;
    return node;
}

function addBox(parent: Node, name: string, material: Material, pos: Vec3, scale: Vec3): Node {
    const node = makeWorldNode(name, parent);
    node.setPosition(pos);
    node.setScale(scale);
    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = utils.createMesh(primitives.box());
    renderer.setMaterial(material, 0);
    return node;
}
