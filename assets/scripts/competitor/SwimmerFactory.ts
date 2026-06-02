import { Color, Layers, Node } from 'cc';
import { RhythmEvaluator } from '../core/RhythmEvaluator';
import { CartoonSwimmerRig } from '../entity/CartoonSwimmerRig';
import { Swimmer } from '../entity/Swimmer';

export type CreateSwimmerOptions = {
    name: string;
    x: number;
    z: number;
    isAI: boolean;
    suitColor?: Color;
    capColor?: Color;
};

export class SwimmerFactory {
    constructor(private readonly _debug?: (message: string) => void) {}

    create(parent: Node, options: CreateSwimmerOptions): Swimmer {
        const node = makeWorldNode(options.name, parent);
        node.setPosition(options.x, 0.22, options.z);

        const rig = node.addComponent(CartoonSwimmerRig);
        const sharedSkin = color(246, 176, 118);
        rig.build(
            sharedSkin,
            options.suitColor || (options.isAI ? color(58, 92, 128) : color(245, 42, 64)),
            options.capColor || (options.isAI ? color(110, 230, 248) : color(255, 220, 72)),
            options.isAI,
            !options.isAI,
        );
        const swimmer = node.addComponent(Swimmer);
        swimmer.cartoonRig = rig;
        swimmer.splashNode = rig.splashNode;
        swimmer.rhythmEvaluator = node.addComponent(RhythmEvaluator);
        swimmer.isAI = options.isAI;
        swimmer.swimmerName = options.isAI ? 'AI' : 'Player';
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
