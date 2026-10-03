import { Color, gfx, Material, Mesh, MeshRenderer, Node, Vec3 } from 'cc';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';
import type { CannonImpact, CannonLaunch } from './CannonBrawlController';
import { FloatingItemLayers, FloatingItemRenderer } from './FloatingItemRenderer';
import { ENTERTAINMENT_SPLASH_PROFILE, SprayBuoySplashPool } from './SprayBuoySplashPool';

const INTERVAL = 1 / 20, EDGE_OFFSET = 1.4, PIVOT_Y = 1.04, MUZZLE_Z = 1.02, ARC_HEIGHT = 5.8;
/** 全部网格来自已导入 Blender GLB；比赛中只改固定节点变换。 */
export class CannonBrawlPresentation {
    private readonly cannons: Node[] = [];
    private readonly nozzles: Node[] = [];
    private readonly releases: (() => void)[] = [];
    private readonly roots: Node[] = [];
    private readonly bodyMaterial: Material;
    private readonly warningMaterial: Material;
    private marker: Node | null = null;
    private projectile: Node | null = null;
    private readonly muzzle = new Vec3(0, 0, MUZZLE_Z);
    private readonly source = new Vec3();
    private readonly target = new Vec3();
    private readonly impactPosition = new Vec3();
    private readonly recoil = [1, 1];
    private readonly sine = [0, 0];
    private readonly cosine = [1, 1];
    private activeStrikeId = -1;
    private activeCannon = 0;
    private elapsed = INTERVAL;
    private clock = 0;
    private disposed = false;
    constructor(private readonly world: Node, private readonly course: RaceCourseLayout,
        meshes: readonly Mesh[], private readonly splashes: SprayBuoySplashPool,
        private readonly rendering: FloatingItemRenderer, layers: FloatingItemLayers | null) {
        this.bodyMaterial = vertexMaterial('CannonBody', false);
        this.warningMaterial = vertexMaterial('CannonWarning', true);
        try {
            const midpoint = (course.startX + course.finishX) * .5;
            for (let i = 0; i < 2; i++) {
                const side = i === 0 ? -1 : 1;
                const root = this.root(`PoolsideCannon_${i + 1}`);
                root.setWorldPosition(midpoint, course.waterY + .12, side * (course.poolWidth * .5 + EDGE_OFFSET));
                root.setRotationFromEuler(0, side > 0 ? 180 : 0, 0);
                this.cannons.push(root);
                this.meshNode('CannonBase', root, meshes[0], this.bodyMaterial);
                this.nozzles.push(this.meshNode('CannonNozzle', root, meshes[1], this.bodyMaterial));
                this.setPitch(i, 40 * Math.PI / 180);
                const release = layers?.registerFloatingObject(root); if (release) this.releases.push(release);
            }
            this.marker = this.root('CannonImpactWarning');
            this.marker.addComponent(MeshRenderer).mesh = meshes[3];
            this.marker.getComponent(MeshRenderer)!.setMaterial(this.warningMaterial, 0);
            const release = layers?.registerFloatingObject(this.marker); if (release) this.releases.push(release);
            this.projectile = this.root('CannonProjectile');
            this.projectile.addComponent(MeshRenderer).mesh = meshes[2]; this.rendering.bind(this.projectile);
        } catch (error) { this.dispose(); throw error; }
    }
    reset(): void {
        if (this.disposed) return;
        this.activeStrikeId = -1; this.elapsed = INTERVAL; this.clock = 0;
        for (let i = 0; i < 2; i++) { this.recoil[i] = 1; this.setPitch(i, 40 * Math.PI / 180); this.setActive(this.cannons[i], true); }
        this.setActive(this.marker, false); this.setActive(this.projectile, false);
    }
    showLaunch(launch: CannonLaunch): void {
        if (this.disposed) return;
        this.activeStrikeId = launch.strikeId; this.activeCannon = launch.strikeId & 1;
        const target = this.course.swimPosition(launch.targetDistance, launch.targetZ);
        this.target.set(target.x, this.course.waterY + .12, target.z);
        const cannon = this.cannons[this.activeCannon], edge = cannon.worldPosition;
        cannon.setRotationFromEuler(0, Math.atan2(target.x - edge.x, target.z - edge.z) * 180 / Math.PI, 0);
        this.setPitch(this.activeCannon, Math.atan2(Math.PI * ARC_HEIGHT - PIVOT_Y, Math.hypot(target.x - edge.x, target.z - edge.z)));
        Vec3.transformMat4(this.source, this.muzzle, this.nozzles[this.activeCannon].worldMatrix);
        this.recoil[this.activeCannon] = 0;
        this.marker!.setWorldPosition(target.x, this.course.waterY + .045, target.z);
        // 模型保持原版形状，比赛中只做原有轻微呼吸缩放。
        this.projectile!.setWorldPosition(this.source);
        for (const cannon of this.cannons) this.setActive(cannon, true);
        this.setActive(this.marker, true); this.setActive(this.projectile, true);
        this.applyFlight(launch, launch.warningSeconds);
    }
    showImpact(impact: CannonImpact): void {
        if (this.disposed || impact.strikeId !== this.activeStrikeId) return;
        this.activeStrikeId = -1; this.setActive(this.marker, false); this.setActive(this.projectile, false);
        this.impactPosition.set(this.target.x, this.course.waterY + .035, this.target.z);
        this.splashes.play({ owner: 'cannon', profile: ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION,
            position: this.impactPosition, yawDegrees: impact.strikeId * 53, intensity: 1.08, duration: .95, layer: this.world.layer });
    }
    update(dt: number, launch: CannonLaunch | null, remaining: number): void {
        if (this.disposed || (!launch && this.recoil[0] >= .28 && this.recoil[1] >= .28)) return;
        this.elapsed += dt; if (this.elapsed < INTERVAL) return;
        const step = this.elapsed; this.elapsed = 0; this.clock += step;
        for (let i = 0; i < 2; i++) if (this.recoil[i] < .28) {
            this.recoil[i] = Math.min(.28, this.recoil[i] + step);
            const t = this.recoil[i] / .28; this.setRecoil(i, t >= 1 ? 0 : -Math.sin(t * Math.PI) * .1);
        }
        if (launch) this.applyFlight(launch, remaining);
    }
    hide(): void {
        if (this.disposed) return;
        this.activeStrikeId = -1;
        for (let i = 0; i < 2; i++) { this.recoil[i] = 1; this.setRecoil(i, 0); this.setActive(this.cannons[i], false); }
        this.setActive(this.marker, false); this.setActive(this.projectile, false);
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.projectile) this.rendering.unbind(this.projectile);
        for (const release of this.releases) release();
        for (const root of this.roots) if (root.isValid) root.destroy();
        this.bodyMaterial.destroy(); this.warningMaterial.destroy();
    }
    private applyFlight(launch: CannonLaunch, remaining: number): void {
        const progress = Math.max(0, Math.min(1, 1 - remaining / Math.max(.01, launch.warningSeconds)));
        this.projectile!.setWorldPosition(this.source.x + (this.target.x - this.source.x) * progress,
            this.source.y + (this.target.y - this.source.y) * progress + Math.sin(progress * Math.PI) * ARC_HEIGHT,
            this.source.z + (this.target.z - this.source.z) * progress);
        const pulse = 1 + Math.sin(this.clock * 10) * .055;
        this.marker!.setScale(pulse, 1, pulse);
    }
    private setPitch(i: number, angle: number): void {
        this.sine[i] = Math.sin(angle); this.cosine[i] = Math.cos(angle);
        this.nozzles[i].setRotationFromEuler(-angle * 180 / Math.PI, 0, 0); this.setRecoil(i, 0);
    }
    private setRecoil(i: number, distance: number): void {
        const n = this.nozzles[i], y = PIVOT_Y + this.sine[i] * distance, z = this.cosine[i] * distance;
        if (n.position.x !== 0 || n.position.y !== y || n.position.z !== z) n.setPosition(0, y, z);
    }
    private root(name: string): Node {
        const n = new Node(name); this.roots.push(n); n.active = false; n.setParent(this.world); n.layer = this.world.layer; return n;
    }
    private meshNode(name: string, parent: Node, mesh: Mesh, material: Material): Node {
        const n = new Node(name); n.setParent(parent); n.layer = parent.layer;
        const r = n.addComponent(MeshRenderer); r.mesh = mesh; r.setMaterial(material, 0); return n;
    }
    private setActive(n: Node | null, active: boolean): void { if (n?.isValid && n.active !== active) n.active = active; }
}
function vertexMaterial(name: string, transparent: boolean): Material {
    const material = new Material();
    material.initialize({ effectName: 'builtin-unlit', technique: transparent ? 1 : 0,
        defines: { USE_VERTEX_COLOR: true }, states: {
            // 炮台与原版一致：反绕序描边已并进网格，必须背面剔除。
            rasterizerState: { cullMode: transparent ? gfx.CullMode.NONE : gfx.CullMode.BACK },
            depthStencilState: { depthTest: true, depthWrite: !transparent },
        } });
    material.name = name; material.setProperty('mainColor', Color.WHITE); return material;
}
