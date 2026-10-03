import { Color, EffectAsset, gfx, Material, Mesh, MeshRenderer, Node, Vec3 } from 'cc';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';
import type { CannonImpact, CannonLaunch } from './CannonBrawlController';
import { FloatingItemLayers, FloatingItemRenderer } from './FloatingItemRenderer';
import { ENTERTAINMENT_SPLASH_PROFILE, SprayBuoySplashPool } from './SprayBuoySplashPool';

const INTERVAL = 1 / 20, EDGE_OFFSET = 1.4, PIVOT_Y = 1.04, MUZZLE_Z = 1.02, ARC_HEIGHT = 5.8;
type CannonFlight = { strikeId: number; marker: Node; projectile: Node; source: Vec3; target: Vec3 };
/** 全部网格来自已导入 Blender GLB；比赛中只改固定节点变换。 */
export class CannonBrawlPresentation {
    private readonly cannons: Node[] = [];
    private readonly nozzles: Node[] = [];
    private readonly releases: (() => void)[] = [];
    private readonly roots: Node[] = [];
    private readonly bodyMaterial: Material;
    private readonly warningMaterial: Material;
    private readonly flights: CannonFlight[] = [];
    private readonly muzzle = new Vec3(0, 0, MUZZLE_Z);
    private readonly impactPosition = new Vec3();
    private readonly recoil = [1, 1];
    private readonly sine = [0, 0];
    private readonly cosine = [1, 1];
    private elapsed = INTERVAL;
    private clock = 0;
    private disposed = false;
    constructor(private readonly world: Node, private readonly course: RaceCourseLayout,
        meshes: readonly Mesh[], private readonly splashes: SprayBuoySplashPool,
        private readonly rendering: FloatingItemRenderer, layers: FloatingItemLayers | null, flightCount: 1 | 2 = 1) {
        this.bodyMaterial = cannonBodyMaterial(rendering.effect);
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
            for (let i = 0; i < flightCount; i++) {
                const suffix = i ? '_2' : '';
                const marker = this.root(`CannonImpactWarning${suffix}`), projectile = this.root(`CannonProjectile${suffix}`);
                this.flights.push({ strikeId: -1, marker, projectile, source: new Vec3(), target: new Vec3() });
                marker.addComponent(MeshRenderer).mesh = meshes[3];
                marker.getComponent(MeshRenderer)!.setMaterial(this.warningMaterial, 0);
                projectile.addComponent(MeshRenderer).mesh = meshes[2];
                const release = layers?.registerFloatingObject(marker); if (release) this.releases.push(release);
                this.rendering.bind(projectile);
            }
        } catch (error) { this.dispose(); throw error; }
    }
    reset(): void {
        if (this.disposed) return;
        this.elapsed = INTERVAL; this.clock = 0;
        for (let i = 0; i < 2; i++) { this.recoil[i] = 1; this.setPitch(i, 40 * Math.PI / 180); this.setActive(this.cannons[i], true); }
        for (const flight of this.flights) { flight.strikeId = -1; this.setActive(flight.marker, false); this.setActive(flight.projectile, false); }
    }
    showLaunch(launch: CannonLaunch): void {
        if (this.disposed) return;
        const flight = this.flights.find(f => f.strikeId === launch.strikeId) ?? this.flights.find(f => f.strikeId < 0)
            ?? (this.flights.length === 1 ? this.flights[0] : null);
        if (!flight) return;
        flight.strikeId = launch.strikeId;
        const activeCannon = launch.strikeId & 1;
        const target = this.course.swimPosition(launch.targetDistance, launch.targetZ);
        flight.target.set(target.x, this.course.waterY + .12, target.z);
        const cannon = this.cannons[activeCannon], edge = cannon.worldPosition;
        cannon.setRotationFromEuler(0, Math.atan2(target.x - edge.x, target.z - edge.z) * 180 / Math.PI, 0);
        this.setPitch(activeCannon, Math.atan2(Math.PI * ARC_HEIGHT - PIVOT_Y, Math.hypot(target.x - edge.x, target.z - edge.z)));
        Vec3.transformMat4(flight.source, this.muzzle, this.nozzles[activeCannon].worldMatrix);
        this.recoil[activeCannon] = 0;
        flight.marker.setWorldPosition(target.x, this.course.waterY + .045, target.z);
        // 模型保持原版形状，比赛中只做原有轻微呼吸缩放。
        flight.projectile.setWorldPosition(flight.source);
        for (const cannon of this.cannons) this.setActive(cannon, true);
        this.setActive(flight.marker, true); this.setActive(flight.projectile, true);
        this.applyFlight(flight, launch, launch.warningSeconds);
    }
    showImpact(impact: CannonImpact): void {
        if (this.disposed) return;
        const flight = this.flights.find(f => f.strikeId === impact.strikeId);
        if (!flight) return;
        flight.strikeId = -1; this.setActive(flight.marker, false); this.setActive(flight.projectile, false);
        this.impactPosition.set(flight.target.x, this.course.waterY + .035, flight.target.z);
        this.splashes.play({ owner: 'cannon', profile: ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION,
            position: this.impactPosition, yawDegrees: impact.strikeId * 53, intensity: 1.08, duration: .95, layer: this.world.layer });
    }
    update(dt: number, launch: CannonLaunch | null, remaining: number,
        secondary: CannonLaunch | null = null, secondaryRemaining = 0): void {
        if (this.disposed || (!launch && !secondary && this.recoil[0] >= .28 && this.recoil[1] >= .28)) return;
        this.elapsed += dt; if (this.elapsed < INTERVAL) return;
        const step = this.elapsed; this.elapsed = 0; this.clock += step;
        for (let i = 0; i < 2; i++) if (this.recoil[i] < .28) {
            this.recoil[i] = Math.min(.28, this.recoil[i] + step);
            const t = this.recoil[i] / .28; this.setRecoil(i, t >= 1 ? 0 : -Math.sin(t * Math.PI) * .1);
        }
        for (const flight of this.flights) {
            if (flight.strikeId < 0) continue;
            if (launch?.strikeId === flight.strikeId) this.applyFlight(flight, launch, remaining);
            else if (secondary?.strikeId === flight.strikeId) this.applyFlight(flight, secondary, secondaryRemaining);
        }
    }
    hide(): void {
        if (this.disposed) return;
        for (let i = 0; i < 2; i++) { this.recoil[i] = 1; this.setRecoil(i, 0); this.setActive(this.cannons[i], false); }
        for (const flight of this.flights) { flight.strikeId = -1; this.setActive(flight.marker, false); this.setActive(flight.projectile, false); }
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const flight of this.flights) this.rendering.unbind(flight.projectile);
        for (const release of this.releases) release();
        for (const root of this.roots) if (root.isValid) root.destroy();
        this.bodyMaterial.destroy(); this.warningMaterial.destroy();
    }
    private applyFlight(flight: CannonFlight, launch: CannonLaunch, remaining: number): void {
        const progress = Math.max(0, Math.min(1, 1 - remaining / Math.max(.01, launch.warningSeconds)));
        const source = flight.source, target = flight.target;
        flight.projectile.setWorldPosition(source.x + (target.x - source.x) * progress,
            source.y + (target.y - source.y) * progress + Math.sin(progress * Math.PI) * ARC_HEIGHT,
            source.z + (target.z - source.z) * progress);
        const pulse = 1 + Math.sin(this.clock * 10) * .055;
        flight.marker.setScale(pulse, 1, pulse);
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
function cannonBodyMaterial(effect: EffectAsset): Material {
    const material = new Material();
    // 复用已加载的场馆无光照效果。普通分支直接读取线性顶点色，
    // 不启用高度明暗或水线，也不再使用 builtin-unlit 的 sRGB 转换。
    material.initialize({ effectAsset: effect,
        defines: { USE_TEXTURE: false, USE_POOLSIDE_WATERLINE: false, USE_FLOATING_VERTEX_COLOR: false },
        states: { rasterizerState: { cullMode: gfx.CullMode.BACK },
            depthStencilState: { depthTest: true, depthWrite: true } } });
    material.name = 'CannonBody'; material.setProperty('mainColor', Color.WHITE); return material;
}
function vertexMaterial(name: string, transparent: boolean): Material {
    const material = new Material();
    material.initialize({ effectName: 'builtin-unlit', technique: transparent ? 1 : 0,
        defines: { USE_VERTEX_COLOR: true }, states: {
            // 落点提醒沿用原来的双面透明材质和颜色处理。
            rasterizerState: { cullMode: transparent ? gfx.CullMode.NONE : gfx.CullMode.BACK },
            depthStencilState: { depthTest: true, depthWrite: !transparent },
        } });
    material.name = name; material.setProperty('mainColor', Color.WHITE); return material;
}
