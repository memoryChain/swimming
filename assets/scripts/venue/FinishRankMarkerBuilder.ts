import { Color, Layers, Material, MeshRenderer, Node, primitives, utils, Vec3 } from 'cc';
import { getRaceDistance } from '../core/GameBalance';
import type { RaceFinishResult } from '../core/RaceManager';
import { DEFAULT_RACE_COURSE_LAYOUT, RaceCourseLayout } from './RaceCourseLayout';

const DIGIT_SEGMENTS: Record<string, string[]> = {
    '0': ['a', 'b', 'c', 'd', 'e', 'f'],
    '1': ['b', 'c'],
    '2': ['a', 'b', 'g', 'e', 'd'],
    '3': ['a', 'b', 'g', 'c', 'd'],
    '4': ['f', 'g', 'b', 'c'],
    '5': ['a', 'f', 'g', 'c', 'd'],
    '6': ['a', 'f', 'g', 'e', 'c', 'd'],
    '7': ['a', 'b', 'c'],
    '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    '9': ['a', 'b', 'c', 'd', 'f', 'g'],
};

export class FinishRankMarkerBuilder {
    private _root: Node | null = null;
    private readonly _markers = new Map<Node, Node>();
    private readonly _baseMaterial = makeMaterial('FinishRankBase', color(246, 252, 255, 255));
    private readonly _playerBaseMaterial = makeMaterial('FinishRankPlayerBase', color(255, 234, 106, 255));
    private readonly _digitMaterial = makeMaterial('FinishRankDigit', color(12, 28, 46, 255));

    constructor(private readonly _courseLayout: RaceCourseLayout = DEFAULT_RACE_COURSE_LAYOUT) {}

    bind(parent: Node) {
        if (this._root?.isValid) {
            return;
        }
        this._root = makeWorldNode('FinishRankMarkers', parent);
    }

    clear() {
        if (!this._root?.isValid) {
            this._markers.clear();
            return;
        }
        for (const marker of this._markers.values()) {
            if (marker.isValid) {
                marker.destroy();
            }
        }
        this._markers.clear();
    }

    show(result: RaceFinishResult) {
        if (!this._root?.isValid || !result.swimmer?.node?.isValid || this._markers.has(result.swimmer.node)) {
            return;
        }
        const marker = makeWorldNode(`Rank${result.placement}_${result.name}`, this._root);
        const finishX = this._courseLayout.distanceToWorldX(getRaceDistance());
        const direction = this._courseLayout.finishDirectionAtDistance(getRaceDistance());
        const x = clamp(result.swimmer.node.position.x - 0.25 * direction, finishX - 2.1, finishX + 2.1);
        marker.setPosition(x, 0.9, result.swimmer.node.position.z);
        this._markers.set(result.swimmer.node, marker);

        addBox(
            marker,
            'RankPlate',
            result.isPlayer ? this._playerBaseMaterial : this._baseMaterial,
            new Vec3(0, 0, 0),
            new Vec3(1.05, 0.05, 0.72),
        );
        addDigitNumber(marker, `${result.placement}`, this._digitMaterial);
    }
}

function addDigitNumber(parent: Node, text: string, material: Material) {
    const digits = text.split('');
    const spacing = 0.36;
    const startX = -((digits.length - 1) * spacing) / 2;
    for (let i = 0; i < digits.length; i++) {
        addDigit(parent, digits[i], startX + i * spacing, material);
    }
}

function addDigit(parent: Node, digit: string, xOffset: number, material: Material) {
    const segments = DIGIT_SEGMENTS[digit] ?? DIGIT_SEGMENTS['0'];
    for (const segment of segments) {
        const spec = segmentSpec(segment);
        addBox(
            parent,
            `Seg_${digit}_${segment}`,
            material,
            new Vec3(xOffset + spec.pos.x, 0.055, -spec.pos.z),
            spec.scale,
        );
    }
}

function segmentSpec(segment: string): { pos: Vec3; scale: Vec3 } {
    const horizontal = new Vec3(0.26, 0.035, 0.045);
    const vertical = new Vec3(0.045, 0.035, 0.22);
    if (segment === 'a') {
        return { pos: new Vec3(0, 0, 0.24), scale: horizontal };
    }
    if (segment === 'g') {
        return { pos: new Vec3(0, 0, 0), scale: horizontal };
    }
    if (segment === 'd') {
        return { pos: new Vec3(0, 0, -0.24), scale: horizontal };
    }
    if (segment === 'b') {
        return { pos: new Vec3(0.16, 0, 0.12), scale: vertical };
    }
    if (segment === 'c') {
        return { pos: new Vec3(0.16, 0, -0.12), scale: vertical };
    }
    if (segment === 'f') {
        return { pos: new Vec3(-0.16, 0, 0.12), scale: vertical };
    }
    return { pos: new Vec3(-0.16, 0, -0.12), scale: vertical };
}

function addBox(parent: Node, name: string, material: Material, position: Vec3, scale: Vec3): Node {
    const node = makeWorldNode(name, parent);
    node.setPosition(position);
    node.setScale(scale);
    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = utils.createMesh(primitives.box());
    renderer.setMaterial(material, 0);
    return node;
}

function makeWorldNode(name: string, parent: Node): Node {
    const node = new Node(name);
    node.setParent(parent);
    node.layer = Layers.Enum.DEFAULT;
    return node;
}

function makeMaterial(name: string, albedo: Color): Material {
    const material = new Material();
    material.initialize({ effectName: 'builtin-unlit' });
    material.name = name;
    material.setProperty('mainColor', albedo);
    return material;
}

function color(r: number, g: number, b: number, a = 255): Color {
    return new Color(r, g, b, a);
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}
