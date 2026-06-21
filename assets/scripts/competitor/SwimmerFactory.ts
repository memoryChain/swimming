import { Color, Layers, Node } from 'cc';
import { CartoonSwimmerRig } from '../entity/CartoonSwimmerRig';
import { Swimmer } from '../entity/Swimmer';
import { defaultSwimmer0621ColorVariant } from '../core/ResourcePaths';

const SWIMMER_MODEL_VARIANT = 'swimmer0621_2';

export type CreateSwimmerOptions = {
    name: string;
    x: number;
    y?: number;
    z: number;
    isAI: boolean;
    colorVariantId?: string;
    displayName?: string;
};

export class SwimmerFactory {
    constructor(private readonly _debug?: (message: string) => void) {}

    create(parent: Node, options: CreateSwimmerOptions): Swimmer {
        const node = makeWorldNode(options.name, parent);
        node.setPosition(options.x, options.y ?? 0.22, options.z);

        const rig = node.addComponent(CartoonSwimmerRig);
        const sharedSkin = color(246, 176, 118);
        rig.setModelVariant(SWIMMER_MODEL_VARIANT);
        rig.setColorVariant(options.colorVariantId ?? defaultSwimmer0621ColorVariant().id);
        rig.build(
            sharedSkin,
            color(245, 42, 64),
            color(255, 220, 72),
            options.isAI,
            !options.isAI,
        );
        rig.setSkinOutfit('trunksA');
        const swimmer = node.addComponent(Swimmer);
        swimmer.cartoonRig = rig;
        swimmer.splashNode = rig.splashNode;
        swimmer.isAI = options.isAI;
        swimmer.swimmerName = options.displayName || (options.isAI ? 'AI' : 'YOU');
        this._debug?.(`${options.name} uses CartoonSwimmerRig`);
        return swimmer;
    }
}

function color(r: number, g: number, b: number, a = 255): Color {
    return new Color(r, g, b, a);
}

function makeWorldNode(name: string, parent: Node): Node {
    const node = new Node(name);
    node.setParent(parent);
    node.layer = Layers.Enum.DEFAULT;
    return node;
}
