import { Color, Layers, Node } from 'cc';
import { CartoonSwimmerRig } from '../entity/CartoonSwimmerRig';
import { Swimmer } from '../entity/Swimmer';
import { defaultSwimmerColorVariant, defaultSwimmerModelVariant } from '../core/ResourcePaths';
import { findPlayerCharacter, selectedPlayerColorScheme, selectedPlayerSkinTone } from '../app/PlayerCharacterConfig';

export type CreateSwimmerOptions = {
    name: string;
    x: number;
    y?: number;
    z: number;
    isAI: boolean;
    colorVariantId?: string;
    skinColor?: readonly [number, number, number];
    displayName?: string;
};

export class SwimmerFactory {
    constructor(private readonly _debug?: (message: string) => void) {}

    create(parent: Node, options: CreateSwimmerOptions): Swimmer {
        const node = makeWorldNode(options.name, parent);
        node.setPosition(options.x, options.y ?? 0.22, options.z);

        const rig = node.addComponent(CartoonSwimmerRig);
        const sharedSkin = color(246, 176, 118);
        const selectedPlayer = options.isAI ? null : findPlayerCharacter();
        const modelVariantId = selectedPlayer?.modelVariantId ?? defaultSwimmerModelVariant().id;
        const robotStyle = selectedPlayer?.robotStyle === true;
        rig.setModelVariant(modelVariantId);
        rig.setColorVariant(options.colorVariantId ?? defaultSwimmerColorVariant().id);
        rig.build(
            sharedSkin,
            color(245, 42, 64),
            color(255, 220, 72),
            robotStyle,
            !options.isAI,
            options.isAI,
        );
        if (selectedPlayer) {
            const skinTone = selectedPlayerSkinTone();
            const colorScheme = selectedPlayerColorScheme();
            rig.setColorOverride({
                skin: skinTone.preserveOriginal ? undefined : color(...skinTone.color),
                suit: color(...colorScheme.suit),
                cap: color(...colorScheme.cap),
            });
        } else if (options.skinColor) {
            rig.setColorOverride({
                skin: color(...options.skinColor),
            });
        }
        rig.setSkinOutfit('trunksA');
        const swimmer = node.addComponent(Swimmer);
        swimmer.cartoonRig = rig;
        swimmer.isAI = options.isAI;
        swimmer.swimmerName = options.displayName || (selectedPlayer?.name ?? (options.isAI ? 'AI' : 'YOU'));
        this._debug?.(`${options.name} uses CartoonSwimmerRig model=${modelVariantId}`);
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
