import { Material, Mesh, MeshRenderer, Node, Quat, Vec3, utils } from 'cc';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { TURTLE_BUS_GEOMETRY } from './TurtleBusGeometry';
import { TURTLE_BUS_LAYOUT as L } from './TurtleBusLayout';
import { TURTLE_BUS_CONFIG, turtleBusPositionAt, turtleBusUnloadingAge, type TurtleBusDirection } from './TurtleBusRules';
import { TurtleBusOutline } from './TurtleBusOutline';

/** Blender 网格共享实例；四鳍绕肩根摆动，空圈逐个下潜，绳端始终连住系绳眼。 */
export class TurtleBusVisual {
    readonly node: Node;
    private readonly body: Node;
    private readonly fins: Node[] = [];
    private readonly rings: Node[] = [];
    private readonly ropes: Node[] = [];
    private readonly meshes: Mesh[] = [];
    private readonly material = new Material();
    private readonly outline: TurtleBusOutline;
    private readonly anchor = new Vec3();
    private readonly end = new Vec3();
    private readonly vector = new Vec3();
    private readonly rotation = new Quat();
    private lastDirection = 1;
    private lastSample = -1;

    constructor(parent: Node, layer: number, private readonly course: RaceCourseLayout) {
        this.node = new Node('TurtleBus'); this.node.setParent(parent); this.node.layer = layer;
        this.material.initialize({ effectName: 'builtin-unlit', defines: { USE_VERTEX_COLOR: true } });
        this.body = new Node('TurtleBody'); this.body.setParent(this.node); this.body.layer = layer;
        this.add('Carapace', this.mesh(TURTLE_BUS_GEOMETRY.body), this.body);
        for (const data of [TURTLE_BUS_GEOMETRY.frontLeft, TURTLE_BUS_GEOMETRY.frontRight,
            TURTLE_BUS_GEOMETRY.rearLeft, TURTLE_BUS_GEOMETRY.rearRight]) {
            const fin = this.add('Flipper', this.mesh(data), this.body);
            fin.setPosition(data.pivot[0], data.pivot[1], data.pivot[2]); this.fins.push(fin);
        }
        const ringMesh = this.mesh(TURTLE_BUS_GEOMETRY.ring), ropeMesh = this.mesh(TURTLE_BUS_GEOMETRY.rope);
        for (let i = 0; i < 4; i++) {
            this.rings.push(this.add('TowRing' + i, ringMesh, this.node));
            this.ropes.push(this.add('TowRope' + i, ropeMesh, this.node));
        }
        this.hide();
        this.outline = new TurtleBusOutline(this.node, [this.body, ...this.fins]);
    }

    update(age: number, direction: TurtleBusDirection, routeZ: number, startOffset = TURTLE_BUS_CONFIG.startOffset as number,
        cancelAge?: number): void {
        if (!this.node.active) this.node.active = true;
        if (direction !== this.lastDirection) {
            this.node.setRotationFromEuler(0, direction === 1 ? 0 : 180, 0); this.lastDirection = direction;
        }
        const scale = Math.abs(this.course.finishX - this.course.startX) / this.course.courseLength;
        const origin = direction === this.course.direction ? this.course.startX : this.course.finishX;
        this.node.setPosition(origin + direction * (cancelAge === undefined ? turtleBusPositionAt(age, startOffset) : startOffset) * scale,
            this.course.waterY - 0.06, routeZ);
        const sample = Math.floor(age * 20);
        if (sample === this.lastSample) return;
        this.lastSample = sample;
        const t = sample / 20;
        const sinkAge = t - (cancelAge ?? (turtleBusUnloadingAge(startOffset) + TURTLE_BUS_CONFIG.unloadSeconds));
        const sink = this.smooth(sinkAge / TURTLE_BUS_CONFIG.submergeSeconds);
        const riseTime = cancelAge === undefined ? t : Math.min(t, cancelAge);
        const rise = this.smooth(riseTime / TURTLE_BUS_CONFIG.riseSeconds);
        this.body.setPosition(sink * .35, -(1 - rise) * 1.05 - sink * 1.15, 0);
        this.body.setRotationFromEuler(0, 0, -sink * 14);
        const flap = Math.sin(t * Math.PI * 0.9);
        for (let i = 0; i < 4; i++) this.fins[i].setRotationFromEuler(
            (i % 2 ? -1 : 1) * (i < 2 ? 9 : 5) * flap, 0, 0);
        for (let i = 0; i < 4; i++) {
            // 海龟先完整浮起，再放出拖圈，避免整组同时从水中冒出。
            const ringRise = this.smooth((riseTime - TURTLE_BUS_CONFIG.riseSeconds - i * .12) / .6);
            const ringSink = this.smooth((sinkAge - i * .12) / .95);
            const bob = Math.sin(t * 1.7 + i * .7) * .018;
            this.rings[i].setPosition(L.ringForward[i] + ringSink * .35,
                -(1 - ringRise) * .75 - ringSink * 1.1 + bob, L.ringLateral[i] * (1 - ringSink * .13));
            this.anchor.set(L.harnessForward, L.harnessHeight, Math.sign(L.ringLateral[i]) * L.harnessLateral);
            Vec3.transformMat4(this.anchor, this.anchor, this.body.worldMatrix);
            this.node.inverseTransformPoint(this.anchor, this.anchor);
            const p = this.rings[i].position;
            this.end.set(p.x + .71, p.y + .15, p.z);
            Vec3.subtract(this.vector, this.end, this.anchor);
            const length = this.vector.length(); Vec3.normalize(this.vector, this.vector);
            Quat.rotationTo(this.rotation, Vec3.UNIT_X, this.vector);
            this.ropes[i].setPosition(this.anchor); this.ropes[i].setRotation(this.rotation);
            this.ropes[i].setScale(length, 1, 1);
        }
    }

    ringWorld(ring: number, out: Vec3): void { this.rings[ring].getWorldPosition(out); }
    hide(): void { if (this.node.active) this.node.active = false; }
    reset(): void { this.hide(); this.lastSample = -1; }
    setOutlineVisible(visible: boolean): void { this.outline.setVisible(visible); }
    dispose(): void { this.outline.dispose(); this.node.destroy(); for (const mesh of this.meshes) mesh.destroy(); this.material.destroy(); }
    private smooth(value: number): number { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); }
    private mesh(data: typeof TURTLE_BUS_GEOMETRY.body): Mesh {
        const mesh = utils.createMesh(data); this.meshes.push(mesh); return mesh;
    }
    private add(name: string, mesh: Mesh, parent: Node): Node {
        const node = new Node(name); node.setParent(parent); node.layer = this.node.layer;
        const renderer = node.addComponent(MeshRenderer); renderer.mesh = mesh; renderer.setMaterial(this.material, 0);
        return node;
    }
}
