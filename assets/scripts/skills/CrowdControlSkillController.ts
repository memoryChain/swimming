import { Color, Material, MeshRenderer, Node, utils, primitives } from 'cc';
import type { Swimmer } from '../entity/Swimmer';
import { ULTIMATE_SKILL_BALANCE } from './SkillRuntime';
import { SWIMMER_LAYER } from '../venue/WaterSurfaceBinder';

type CharmState = {
    active: boolean;
    caster: Swimmer | null;
    x: number;
    z: number;
    dx: number;
    dz: number;
    traveled: number;
    node: Node;
};

type SirenState = {
    active: boolean;
    caster: Swimmer | null;
    elapsed: number;
    hitMask: number;
    node: Node;
};

export type CrowdControlSkillControllerOptions = {
    root: Node;
    waterY: number;
    swimmers: () => readonly Swimmer[];
    laneFor: (swimmer: Swimmer) => number;
    onControlApplied?: (target: Swimmer, seconds: number) => void;
};

const MAX_SIMULTANEOUS_CASTS = 4;

// Race-level owner of the two interaction skills. Dynamic state is fixed-size and
// all visual nodes are built once, keeping race updates allocation-free.
export class CrowdControlSkillController {
    private readonly _charms: CharmState[] = [];
    private readonly _sirens: SirenState[] = [];
    private readonly _heartMaterial: Material;
    private readonly _heartHighlightMaterial: Material;
    private readonly _sirenOuterMaterial: Material;
    private readonly _sirenInnerMaterial: Material;

    constructor(private readonly _opts: CrowdControlSkillControllerOptions) {
        this._heartMaterial = this.createUnlitMaterial(new Color(255, 52, 164, 255));
        this._heartHighlightMaterial = this.createUnlitMaterial(new Color(255, 190, 234, 255));
        this._sirenOuterMaterial = this.createUnlitMaterial(new Color(68, 232, 255, 255));
        this._sirenInnerMaterial = this.createUnlitMaterial(new Color(150, 102, 255, 255));
        for (let index = 0; index < MAX_SIMULTANEOUS_CASTS; index++) {
            this._charms.push(this.createCharm(index));
            this._sirens.push(this.createSiren(index));
        }
    }

    reset(): void {
        for (const state of this._charms) this.endCharm(state);
        for (const state of this._sirens) this.endSiren(state);
    }

    activate(caster: Swimmer): void {
        if (!caster?.node?.active) return;
        if (caster.skill.definition.kind === 'charm') this.startCharm(caster);
        if (caster.skill.definition.kind === 'siren') this.startSiren(caster);
    }

    // Only the host (or the single-player race) calls this with authoritative=true.
    // Guests still advance visuals locally, but never decide a hit or control state.
    tick(dt: number, authoritative: boolean): void {
        if (!Number.isFinite(dt) || dt <= 0) return;
        for (const state of this._charms) this.tickCharm(state, dt, authoritative);
        for (const state of this._sirens) this.tickSiren(state, dt, authoritative);
    }

    private createCharm(index: number): CharmState {
        const node = this.createRoot(`CharmHeart_${index}`);
        this.buildHeartVisual(node);
        return { active: false, caster: null, x: 0, z: 0, dx: 1, dz: 0, traveled: 0, node };
    }

    private createSiren(index: number): SirenState {
        const node = this.createRoot(`SirenSongRing_${index}`);
        this.buildSirenRingVisual(node);
        return { active: false, caster: null, elapsed: 0, hitMask: 0, node };
    }

    private createRoot(name: string): Node {
        const node = new Node(name);
        node.parent = this._opts.root;
        node.layer = SWIMMER_LAYER;
        node.active = false;
        return node;
    }

    private buildHeartVisual(root: Node): void {
        this.addMesh(root, 'LeftLobe', primitives.sphere(0.23, { segments: 8 }), this._heartMaterial, 0.16, 0.13, 0);
        this.addMesh(root, 'RightLobe', primitives.sphere(0.23, { segments: 8 }), this._heartMaterial, -0.16, 0.13, 0);
        const point = this.addMesh(root, 'HeartPoint', primitives.box(), this._heartMaterial, 0, -0.13, 0);
        point.setScale(0.34, 0.34, 0.14);
        point.setRotationFromEuler(0, 0, 45);
        this.addMesh(root, 'HeartGlow', primitives.sphere(0.075, { segments: 6 }), this._heartHighlightMaterial, 0, 0.02, 0.13);
    }

    private buildSirenRingVisual(root: Node): void {
        // Two low-poly torus meshes read as a physical water-borne sound wave,
        // avoiding a fullscreen translucent decal and its fill-rate cost.
        this.addMesh(root, 'OuterWave', primitives.torus(1, 0.045, { radialSegments: 18, tubularSegments: 6 }), this._sirenOuterMaterial, 0, 0, 0);
        this.addMesh(root, 'InnerWave', primitives.torus(0.70, 0.026, { radialSegments: 18, tubularSegments: 6 }), this._sirenInnerMaterial, 0, 0.015, 0);
    }

    private createUnlitMaterial(color: Color): Material {
        const material = new Material();
        material.initialize({ effectName: 'builtin-unlit', defines: { USE_COLOR: true } });
        material.setProperty('mainColor', color);
        return material;
    }

    private addMesh(root: Node, name: string, geometry: ReturnType<typeof primitives.box>, material: Material, x: number, y: number, z: number): Node {
        const node = new Node(name);
        node.parent = root;
        node.layer = SWIMMER_LAYER;
        node.setPosition(x, y, z);
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = utils.createMesh(geometry);
        renderer.setMaterial(material, 0);
        return node;
    }

    private startCharm(caster: Swimmer): void {
        const state = this._charms.find((entry) => !entry.active);
        if (!state) return;
        const pos = caster.node.position;
        state.active = true;
        state.caster = caster;
        state.x = pos.x;
        state.z = pos.z;
        state.dx = caster.raceDirection * Math.cos(caster.movementHeading);
        state.dz = Math.sin(caster.movementHeading);
        state.traveled = 0;
        state.node.setPosition(state.x, this._opts.waterY + 0.28, state.z);
        state.node.setRotationFromEuler(0, Math.atan2(-state.dx, -state.dz) * 180 / Math.PI, 0);
        state.node.setScale(0.62, 0.62, 0.62);
        if (!state.node.active) state.node.active = true;
    }

    private tickCharm(state: CharmState, dt: number, authoritative: boolean): void {
        if (!state.active) return;
        const step = Math.max(0, ULTIMATE_SKILL_BALANCE.charmSpeed) * dt;
        state.x += state.dx * step;
        state.z += state.dz * step;
        state.traveled += step;
        state.node.setPosition(state.x, this._opts.waterY + 0.28, state.z);
        if (authoritative) {
            const radius = Math.max(0.05, ULTIMATE_SKILL_BALANCE.charmHitRadius);
            const radiusSq = radius * radius;
            for (const target of this._opts.swimmers()) {
                if (target === state.caster || !target.isCrowdControlTargetable) continue;
                const targetPos = target.node.position;
                const dx = targetPos.x - state.x;
                const dz = targetPos.z - state.z;
                if (dx * dx + dz * dz > radiusSq) continue;
                this.applyControl(target, ULTIMATE_SKILL_BALANCE.charmControlSeconds);
                this.endCharm(state);
                return;
            }
        }
        if (state.traveled >= Math.max(0.5, ULTIMATE_SKILL_BALANCE.charmRange)) this.endCharm(state);
    }

    private startSiren(caster: Swimmer): void {
        const state = this._sirens.find((entry) => !entry.active);
        if (!state) return;
        state.active = true;
        state.caster = caster;
        state.elapsed = 0;
        state.hitMask = 0;
        const pos = caster.node.position;
        state.node.setPosition(pos.x, this._opts.waterY + 0.025, pos.z);
        const radius = Math.max(0.5, ULTIMATE_SKILL_BALANCE.sirenRadius);
        state.node.setScale(radius, 1, radius);
        if (!state.node.active) state.node.active = true;
    }

    private tickSiren(state: SirenState, dt: number, authoritative: boolean): void {
        if (!state.active) return;
        const caster = state.caster;
        if (!caster?.node?.active || !caster.isRacing) {
            this.endSiren(state);
            return;
        }
        state.elapsed += dt;
        const pos = caster.node.position;
        state.node.setPosition(pos.x, this._opts.waterY + 0.025, pos.z);
        if (authoritative && state.elapsed >= Math.max(0, ULTIMATE_SKILL_BALANCE.sirenWindupSeconds)) {
            const radius = Math.max(0.1, ULTIMATE_SKILL_BALANCE.sirenRadius);
            const radiusSq = radius * radius;
            for (const target of this._opts.swimmers()) {
                if (target === caster || !target.isCrowdControlTargetable) continue;
                const lane = this._opts.laneFor(target);
                const bit = lane >= 0 && lane < 31 ? (1 << lane) : 0;
                if (bit !== 0 && (state.hitMask & bit) !== 0) continue;
                const targetPos = target.node.position;
                const dx = targetPos.x - pos.x;
                const dz = targetPos.z - pos.z;
                if (dx * dx + dz * dz > radiusSq) continue;
                if (bit !== 0) state.hitMask |= bit;
                this.applyControl(target, ULTIMATE_SKILL_BALANCE.sirenControlSeconds);
            }
        }
        if (state.elapsed >= Math.max(0.1, ULTIMATE_SKILL_BALANCE.sirenDurationSeconds)) this.endSiren(state);
    }

    private applyControl(target: Swimmer, seconds: number): void {
        target.applyCrowdControl(seconds);
        this._opts.onControlApplied?.(target, seconds);
    }

    private endCharm(state: CharmState): void {
        state.active = false;
        state.caster = null;
        if (state.node.active) state.node.active = false;
    }

    private endSiren(state: SirenState): void {
        state.active = false;
        state.caster = null;
        if (state.node.active) state.node.active = false;
    }
}
