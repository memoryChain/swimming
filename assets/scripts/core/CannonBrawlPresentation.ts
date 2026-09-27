import { Color, gfx, Material, Mesh, MeshRenderer, Node, primitives, utils, Vec3 } from 'cc';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { CANNON_BRAWL_TUNING, CannonImpact, CannonLaunch } from './CannonBrawlController';
import { RESOURCE_PATHS } from './ResourcePaths';
import { WaterPlayObstacleModels, WATER_CANNON_MUZZLE, WATER_CANNON_PIVOT, WATER_CANNON_REST_PITCH } from './WaterPlayObstacleModel';
import {
    ENTERTAINMENT_SPLASH_OWNER,
    ENTERTAINMENT_SPLASH_PROFILE,
    EntertainmentWaterSplashPool,
} from './EntertainmentWaterSplash';

const PRESENTATION_INTERVAL = 1 / 20;
const CANNON_EDGE_OFFSET = 1.4;
const CANNON_STAND_TRAVEL = 4.2;
const CANNON_ENTRANCE_SECONDS = 1.8;
const CANNON_EXIT_SECONDS = 1.2;
const PROJECTILE_ARC_HEIGHT = 5.8;
const IMPACT_SECONDS = 0.95;
const CANNON_EXPLOSION_INTENSITY = 1.08;

const enum CannonDeploymentPhase {
    DEPLOYED,
    ENTERING,
    EXITING,
    STOWED,
}

/** 固定网格、共享材质的炮台／炮弹／水面预警表现；只消费权威规则状态。 */
export class CannonBrawlPresentation {
    private readonly cannons: Node[] = [];
    private marker: Node | null = null;
    private projectile: Node | null = null;
    private secondMarker: Node | null = null;
    private secondProjectile: Node | null = null;
    private secondStrikeId = -1;
    private secondTargetX = 0;
    private secondTargetZ = 0;
    private secondSourceX = 0;
    private secondSourceY = 0;
    private secondSourceZ = 0;
    private models: WaterPlayObstacleModels | null = null;
    private projectileModels: WaterPlayObstacleModels | null = null;
    private readonly nozzles: (Node | null)[] = [];
    private readonly recoilElapsed = [1, 1];
    private readonly nozzleSin = [0, 0];
    private readonly nozzleCos = [1, 1];
    private markerMesh: Mesh | null = null;
    private markerMaterial: Material | null = null;
    private activeStrikeId = -1;
    private lastStrikeId = -1;
    private lastImpactStrikeId = -1;
    private activeCannonIndex = 0;
    private targetX = 0;
    private targetZ = 0;
    private sourceX = 0;
    private sourceY = 0;
    private sourceZ = 0;
    private elapsed = PRESENTATION_INTERVAL;
    private clock = 0;
    private disposed = false;
    private deploymentPhase = CannonDeploymentPhase.DEPLOYED;
    private deploymentElapsed = 0;
    private deploymentTravelProgress = 0;
    private exitStartTravelProgress = 0;
    private standWorldX = 0;
    private readonly impactWorldPosition = new Vec3();
    private readonly muzzleLocal = new Vec3(WATER_CANNON_MUZZLE.x, WATER_CANNON_MUZZLE.y, WATER_CANNON_MUZZLE.z);
    private readonly muzzleWorld = new Vec3();
    private readonly primaryLaunchSource = new Vec3();
    private readonly secondLaunchSource = new Vec3();

    constructor(
        private readonly parent: Node,
        private readonly course: RaceCourseLayout,
        private readonly waterSplashes: EntertainmentWaterSplashPool | null,
        private readonly startStowed = false,
        private readonly allowDual = false,
    ) {
        if (startStowed) this.deploymentPhase = CannonDeploymentPhase.STOWED;
        this.build();
    }

    reset(): void {
        if (this.disposed) return;
        this.activeStrikeId = -1;
        this.secondStrikeId = -1;
        this.lastStrikeId = -1;
        this.lastImpactStrikeId = -1;
        this.elapsed = PRESENTATION_INTERVAL;
        this.clock = 0;
        this.clearRecoil();
        for (let i = 0; i < this.nozzles.length; i++) this.setNozzlePitch(i, WATER_CANNON_REST_PITCH * Math.PI / 180);
        this.setActive(this.marker, false);
        this.setActive(this.projectile, false);
        this.setActive(this.secondMarker, false);
        this.setActive(this.secondProjectile, false);
        this.waterSplashes?.cancelOwner(ENTERTAINMENT_SPLASH_OWNER.CANNON);
        if (this.startStowed) {
            this.deploymentPhase = CannonDeploymentPhase.STOWED;
            this.deploymentElapsed = 0;
            this.applyDeploymentProgress(0, false);
            for (const cannon of this.cannons) this.setActive(cannon, false);
        } else {
            this.snapDeployed();
        }
    }

    /** 娱乐事件预告开始时，把两侧礼炮从观众席深处推到池边。 */
    beginEntrance(): void {
        if (this.disposed) return;
        this.deploymentPhase = CannonDeploymentPhase.ENTERING;
        this.deploymentElapsed = 0;
        this.applyDeploymentProgress(0, false);
        for (const cannon of this.cannons) this.setActive(cannon, true);
    }

    /** 权威状态已经进入炮击阶段时直接就位，避免晚加入客户端补播整段进场。 */
    snapDeployed(): void {
        if (this.disposed) return;
        this.deploymentPhase = CannonDeploymentPhase.DEPLOYED;
        this.deploymentElapsed = 0;
        this.applyDeploymentProgress(1, false);
        for (const cannon of this.cannons) this.setActive(cannon, true);
    }

    /** 炮火事件结束后退回观众席深处，完成后关闭节点。 */
    beginExit(): void {
        if (this.disposed || this.deploymentPhase === CannonDeploymentPhase.STOWED
            || this.deploymentPhase === CannonDeploymentPhase.EXITING) return;
        this.exitStartTravelProgress = this.deploymentTravelProgress;
        this.deploymentPhase = CannonDeploymentPhase.EXITING;
        this.deploymentElapsed = 0;
        this.syncLaunch(null);
        this.secondStrikeId = -1;
        this.setActive(this.secondMarker, false);
        this.setActive(this.secondProjectile, false);
        this.lastImpactStrikeId = this.lastStrikeId;
        this.clearRecoil();
    }

    sourceWorldX(): number {
        return this.standWorldX;
    }

    get projectileNode(): Node | null {
        return this.projectile?.active ? this.projectile
            : this.secondProjectile?.active ? this.secondProjectile : null;
    }

    get launchSource(): Readonly<Vec3> { return this.muzzleWorld; }
    launchSourceFor(strikeId: number): Readonly<Vec3> {
        return strikeId === this.secondStrikeId ? this.secondLaunchSource : this.primaryLaunchSource;
    }
    projectileNodeFor(strikeId: number): Node | null {
        return strikeId === this.secondStrikeId ? this.secondProjectile : this.projectile;
    }

    showLaunch(launch: CannonLaunch): void {
        if (this.disposed || !launch || launch.strikeId <= this.lastStrikeId) return;
        if (this.allowDual && this.activeStrikeId >= 0 && this.activeStrikeId !== launch.strikeId) {
            this.showSecondLaunch(launch);
            return;
        }
        if (this.deploymentPhase !== CannonDeploymentPhase.DEPLOYED) this.snapDeployed();
        this.activeStrikeId = launch.strikeId;
        this.lastStrikeId = launch.strikeId;
        this.activeCannonIndex = launch.strikeId & 1;
        const target = this.course.swimPosition(launch.targetDistance, launch.targetZ);
        this.targetX = target.x;
        this.targetZ = target.z;
        const side = this.activeCannonIndex === 0 ? -1 : 1;
        const edgeZ = side * (this.course.poolWidth * 0.5 + CANNON_EDGE_OFFSET);
        const cannon = this.cannons[this.activeCannonIndex];
        if (cannon?.isValid) {
            this.setActive(cannon, true);
            cannon.setRotationFromEuler(0, Math.atan2(target.x - this.sourceWorldX(), target.z - edgeZ) * 180 / Math.PI, 0);
            const nozzle = this.nozzles[this.activeCannonIndex];
            if (nozzle?.isValid) {
                // 原弧线在起点的切线：dy/dp = 目标高 - 炮口高 + πH。
                // 炮口沿轴线偏移项抵消，直接由转轴到目标解出仰角。
                const distance = Math.hypot(target.x - this.sourceWorldX(), target.z - edgeZ);
                const rise = Math.PI * PROJECTILE_ARC_HEIGHT - WATER_CANNON_PIVOT.y;
                this.setNozzlePitch(this.activeCannonIndex, Math.atan2(rise, distance));
                Vec3.transformMat4(this.muzzleWorld, this.muzzleLocal, nozzle.worldMatrix);
            }
        }
        // 底座水平转向，喷管抬头；已发水球不再跟随喷管回弹。
        this.sourceX = this.muzzleWorld.x;
        this.sourceY = this.muzzleWorld.y;
        this.sourceZ = this.muzzleWorld.z;
        this.primaryLaunchSource.set(this.sourceX, this.sourceY, this.sourceZ);
        this.recoilElapsed[this.activeCannonIndex] = 0;
        this.marker?.setWorldPosition(target.x, this.course.waterY + 0.045, target.z);
        this.marker?.setScale(1, 1, 1);
        this.projectile?.setWorldPosition(this.sourceX, this.sourceY, this.sourceZ);
        this.projectile?.setScale(1, 1, 1);
        this.setActive(this.marker, true);
        this.setActive(this.projectile, true);
    }

    private showSecondLaunch(launch: CannonLaunch): void {
        if (!this.allowDual || !this.secondMarker || !this.secondProjectile || this.secondStrikeId >= 0) return;
        this.secondStrikeId = launch.strikeId;
        this.lastStrikeId = launch.strikeId;
        const target = this.course.swimPosition(launch.targetDistance, launch.targetZ);
        this.secondTargetX = target.x;
        this.secondTargetZ = target.z;
        const cannonIndex = launch.strikeId & 1;
        const side = cannonIndex === 0 ? -1 : 1;
        const edgeZ = side * (this.course.poolWidth * 0.5 + CANNON_EDGE_OFFSET);
        const cannon = this.cannons[cannonIndex];
        if (cannon?.isValid) {
            cannon.setRotationFromEuler(0,
                Math.atan2(target.x - this.sourceWorldX(), target.z - edgeZ) * 180 / Math.PI, 0);
            const nozzle = this.nozzles[cannonIndex];
            if (nozzle?.isValid) {
                const distance = Math.hypot(target.x - this.sourceWorldX(), target.z - edgeZ);
                this.setNozzlePitch(cannonIndex,
                    Math.atan2(Math.PI * PROJECTILE_ARC_HEIGHT - WATER_CANNON_PIVOT.y, distance));
                Vec3.transformMat4(this.muzzleWorld, this.muzzleLocal, nozzle.worldMatrix);
            }
        }
        this.secondSourceX = this.muzzleWorld.x;
        this.secondSourceY = this.muzzleWorld.y;
        this.secondSourceZ = this.muzzleWorld.z;
        this.secondLaunchSource.set(this.secondSourceX, this.secondSourceY, this.secondSourceZ);
        this.recoilElapsed[cannonIndex] = 0;
        this.secondMarker.setWorldPosition(target.x, this.course.waterY + 0.045, target.z);
        this.secondProjectile.setWorldPosition(this.secondSourceX, this.secondSourceY, this.secondSourceZ);
        this.setActive(this.secondMarker, true);
        this.setActive(this.secondProjectile, true);
    }

    showImpact(impact: CannonImpact): void {
        if (this.disposed || !impact) return;
        if (impact.strikeId === this.secondStrikeId) {
            this.secondStrikeId = -1;
            this.setActive(this.secondMarker, false);
            this.setActive(this.secondProjectile, false);
            this.impactWorldPosition.set(this.secondTargetX, this.course.waterY + 0.035, this.secondTargetZ);
            this.waterSplashes?.play({ owner: ENTERTAINMENT_SPLASH_OWNER.CANNON,
                profile: ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION, position: this.impactWorldPosition,
                yawDegrees: impact.strikeId * 53, intensity: CANNON_EXPLOSION_INTENSITY,
                duration: IMPACT_SECONDS, layer: this.parent.layer });
            return;
        }
        if (this.disposed || !impact || impact.strikeId <= this.lastImpactStrikeId
            || (impact.strikeId !== this.activeStrikeId && impact.strikeId !== this.lastStrikeId)) return;
        this.lastImpactStrikeId = impact.strikeId;
        this.setActive(this.marker, false);
        this.setActive(this.projectile, false);
        this.impactWorldPosition.set(this.targetX, this.course.waterY + 0.035, this.targetZ);
        this.waterSplashes?.play({
            owner: ENTERTAINMENT_SPLASH_OWNER.CANNON,
            profile: ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION,
            position: this.impactWorldPosition,
            yawDegrees: impact.strikeId * 53,
            intensity: CANNON_EXPLOSION_INTENSITY,
            duration: IMPACT_SECONDS,
            layer: this.parent.layer,
        });
        this.activeStrikeId = -1;
    }

    syncLaunch(launch: CannonLaunch | null): void {
        if (launch?.strikeId === this.secondStrikeId) {
            this.activeStrikeId = -1;
            this.setActive(this.marker, false);
            this.setActive(this.projectile, false);
            return;
        }
        if (!launch) {
            if (this.activeStrikeId >= 0) {
                this.activeStrikeId = -1;
                this.setActive(this.marker, false);
                this.setActive(this.projectile, false);
            }
            return;
        }
        if (launch.strikeId !== this.activeStrikeId) this.showLaunch(launch);
    }

    update(dt: number, launch: CannonLaunch | null, remainingSeconds: number, racing: boolean,
        secondaryLaunch: CannonLaunch | null = null, secondaryRemainingSeconds = 0): void {
        if (this.disposed) return;
        if (!racing) {
            this.setActive(this.marker, false);
            this.setActive(this.projectile, false);
            this.setActive(this.secondMarker, false);
            this.setActive(this.secondProjectile, false);
            return;
        }
        if (!launch && !secondaryLaunch && this.deploymentPhase === CannonDeploymentPhase.STOWED) return;
        if (this.allowDual) {
            const primaryStillActive = this.activeStrikeId >= 0
                && (this.activeStrikeId === launch?.strikeId || this.activeStrikeId === secondaryLaunch?.strikeId);
            const secondStillActive = this.secondStrikeId >= 0
                && (this.secondStrikeId === launch?.strikeId || this.secondStrikeId === secondaryLaunch?.strikeId);
            if (!primaryStillActive) {
                this.activeStrikeId = -1;
                this.setActive(this.marker, false);
                this.setActive(this.projectile, false);
            }
            if (!secondStillActive) {
                this.secondStrikeId = -1;
                this.setActive(this.secondMarker, false);
                this.setActive(this.secondProjectile, false);
            }
            if (launch && launch.strikeId !== this.activeStrikeId && launch.strikeId !== this.secondStrikeId) {
                this.showLaunch(launch);
            }
            if (secondaryLaunch && secondaryLaunch.strikeId !== this.activeStrikeId
                && secondaryLaunch.strikeId !== this.secondStrikeId) this.showLaunch(secondaryLaunch);
        } else {
            this.syncLaunch(launch);
        }
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        this.elapsed += step;
        if (this.elapsed < PRESENTATION_INTERVAL) return;
        const presentationStep = this.elapsed;
        this.elapsed = 0;
        this.clock += presentationStep;
        this.updateDeployment(presentationStep);
        if (launch) {
            // 晚快照恢复当前飞行阶段，不再补播已过去的短回弹。
            const shotAge = Math.max(0, launch.warningSeconds - remainingSeconds);
            this.recoilElapsed[this.activeCannonIndex] = Math.max(this.recoilElapsed[this.activeCannonIndex], shotAge - presentationStep);
            if (shotAge >= 0.28 && this.nozzles[this.activeCannonIndex]?.position.z !== 0) {
                this.setNozzleRecoil(this.activeCannonIndex, 0);
            }
        }
        for (let i = 0; i < this.nozzles.length; i++) {
            if (this.recoilElapsed[i] >= 0.28) continue;
            this.recoilElapsed[i] = Math.min(0.28, this.recoilElapsed[i] + presentationStep);
            const t = this.recoilElapsed[i] / 0.28;
            this.setNozzleRecoil(i, t >= 1 ? 0 : -Math.sin(t * Math.PI) * 0.10);
        }

        const primaryLaunch = this.activeStrikeId === launch?.strikeId ? launch
            : this.activeStrikeId === secondaryLaunch?.strikeId ? secondaryLaunch : null;
        if (primaryLaunch) {
            const primaryRemaining = primaryLaunch === launch ? remainingSeconds : secondaryRemainingSeconds;
            const total = Math.max(0.01, CANNON_BRAWL_TUNING.warningSeconds);
            const progress = Math.max(0, Math.min(1, 1 - primaryRemaining / total));
            const x = this.sourceX + (this.targetX - this.sourceX) * progress;
            const z = this.sourceZ + (this.targetZ - this.sourceZ) * progress;
            const y = this.sourceY + (this.course.waterY + 0.12 - this.sourceY) * progress
                + Math.sin(progress * Math.PI) * PROJECTILE_ARC_HEIGHT;
            this.projectile?.setWorldPosition(x, y, z);
            const markerPulse = 1 + Math.sin(this.clock * 10) * 0.055;
            this.marker?.setScale(markerPulse, 1, markerPulse);
        }
        const secondActive = this.secondStrikeId >= 0
            && (this.secondStrikeId === launch?.strikeId || this.secondStrikeId === secondaryLaunch?.strikeId);
        if (secondActive) {
            const remaining = secondaryLaunch?.strikeId === this.secondStrikeId
                ? secondaryRemainingSeconds : remainingSeconds;
            const progress = Math.max(0, Math.min(1, 1 - remaining / CANNON_BRAWL_TUNING.warningSeconds));
            this.secondProjectile?.setWorldPosition(
                this.secondSourceX + (this.secondTargetX - this.secondSourceX) * progress,
                this.secondSourceY + (this.course.waterY + 0.12 - this.secondSourceY) * progress
                    + Math.sin(progress * Math.PI) * PROJECTILE_ARC_HEIGHT,
                this.secondSourceZ + (this.secondTargetZ - this.secondSourceZ) * progress);
            const pulse = 1 + Math.sin(this.clock * 10) * 0.055;
            this.secondMarker?.setScale(pulse, 1, pulse);
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.waterSplashes?.cancelOwner(ENTERTAINMENT_SPLASH_OWNER.CANNON);
        for (const cannon of this.cannons) if (cannon?.isValid) cannon.destroy();
        this.cannons.length = 0;
        if (this.marker?.isValid) this.marker.destroy();
        if (this.projectile?.isValid) this.projectile.destroy();
        if (this.secondMarker?.isValid) this.secondMarker.destroy();
        if (this.secondProjectile?.isValid) this.secondProjectile.destroy();
        this.marker = this.projectile = null;
        this.models?.dispose();
        this.projectileModels?.dispose();
        this.markerMesh?.destroy();
        this.markerMaterial?.destroy();
    }

    private build(): void {
        if (!this.parent?.isValid) return;
        this.markerMesh = utils.createMesh(buildMarkerGeometry());
        this.markerMaterial = makeVertexMaterial('CannonBrawlMarkerMaterial', false);

        const midpoint = (this.course.startX + this.course.finishX) * 0.5;
        this.standWorldX = midpoint;
        for (let i = 0; i < 2; i++) {
            const side = i === 0 ? -1 : 1;
            const cannon = new Node(`PoolsideCannon_${i + 1}`);
            cannon.setParent(this.parent);
            cannon.layer = this.parent.layer;
            this.setActive(cannon, !this.startStowed);
            cannon.setWorldPosition(midpoint, this.course.waterY + 0.12, side * (this.course.poolWidth * 0.5 + CANNON_EDGE_OFFSET));
            cannon.setRotationFromEuler(0, side > 0 ? 180 : 0, 0);
            this.cannons.push(cannon);
        }
        this.models = new WaterPlayObstacleModels('WaterBallCannon', this.cannons, RESOURCE_PATHS.waterBallCannonPrefabCandidates);
        for (let i = 0; i < this.cannons.length; i++) {
            this.nozzles.push(this.models.part(i, 'CannonNozzle'));
            this.setNozzlePitch(i, WATER_CANNON_REST_PITCH * Math.PI / 180);
        }
        this.marker = this.makeMeshNode('CannonImpactWarning', this.markerMesh, this.markerMaterial);
        if (this.allowDual) this.secondMarker = this.makeMeshNode('CannonImpactWarning2', this.markerMesh, this.markerMaterial);
        this.projectile = new Node('CannonProjectile');
        this.projectile.setParent(this.parent);
        this.projectile.layer = this.parent.layer;
        if (this.allowDual) {
            this.secondProjectile = new Node('CannonProjectile2');
            this.secondProjectile.setParent(this.parent);
            this.secondProjectile.layer = this.parent.layer;
        }
        this.projectileModels = new WaterPlayObstacleModels('CannonWaterBall',
            this.secondProjectile ? [this.projectile, this.secondProjectile] : [this.projectile],
            RESOURCE_PATHS.cannonWaterBallPrefabCandidates);
        this.marker.active = false;
        if (this.secondMarker) this.secondMarker.active = false;
        this.projectile.active = false;
        if (this.secondProjectile) this.secondProjectile.active = false;
    }

    private clearRecoil(): void {
        for (let i = 0; i < this.nozzles.length; i++) {
            if (this.recoilElapsed[i] < 0.28) this.setNozzleRecoil(i, 0);
            this.recoilElapsed[i] = 1;
        }
    }

    private setNozzlePitch(index: number, radians: number): void {
        this.nozzleSin[index] = Math.sin(radians);
        this.nozzleCos[index] = Math.cos(radians);
        this.nozzles[index]?.setRotationFromEuler(-radians * 180 / Math.PI, 0, 0);
        this.setNozzleRecoil(index, 0);
    }

    private setNozzleRecoil(index: number, distance: number): void {
        const nozzle = this.nozzles[index];
        if (!nozzle?.isValid) return;
        const y = WATER_CANNON_PIVOT.y + this.nozzleSin[index] * distance;
        const z = WATER_CANNON_PIVOT.z + this.nozzleCos[index] * distance;
        if (nozzle.position.x !== WATER_CANNON_PIVOT.x || nozzle.position.y !== y || nozzle.position.z !== z) {
            nozzle.setPosition(WATER_CANNON_PIVOT.x, y, z);
        }
    }

    private makeMeshNode(name: string, mesh: Mesh, material: Material): Node {
        const node = new Node(name);
        node.setParent(this.parent);
        node.layer = this.parent.layer;
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = mesh;
        renderer.setMaterial(material, 0);
        return node;
    }

    private setActive(node: Node | null, active: boolean): void {
        if (node?.isValid && node.active !== active) node.active = active;
    }

    private updateDeployment(dt: number): void {
        if (this.deploymentPhase !== CannonDeploymentPhase.ENTERING
            && this.deploymentPhase !== CannonDeploymentPhase.EXITING) return;
        this.deploymentElapsed += dt;
        const entering = this.deploymentPhase === CannonDeploymentPhase.ENTERING;
        const duration = entering ? CANNON_ENTRANCE_SECONDS : CANNON_EXIT_SECONDS;
        const progress = Math.min(1, this.deploymentElapsed / duration);
        // 进场末段柔和减速，退场逐渐加速；全程只移动现有两个合并网格节点。
        const eased = entering
            ? 1 - Math.pow(1 - progress, 3)
            : progress * progress;
        this.applyDeploymentProgress(eased, !entering);
        if (progress < 1) return;
        this.deploymentElapsed = 0;
        this.deploymentPhase = entering
            ? CannonDeploymentPhase.DEPLOYED
            : CannonDeploymentPhase.STOWED;
        if (!entering) {
            for (const cannon of this.cannons) this.setActive(cannon, false);
        }
    }

    private applyDeploymentProgress(progress: number, exiting: boolean): void {
        // 预告可能在进场途中取消，退场必须从最后显示的位置开始。
        const travelProgress = exiting
            ? this.exitStartTravelProgress + (1 - this.exitStartTravelProgress) * progress
            : 1 - progress;
        this.deploymentTravelProgress = travelProgress;
        for (let i = 0; i < this.cannons.length; i++) {
            const side = i === 0 ? -1 : 1;
            const edgeZ = side * (this.course.poolWidth * 0.5 + CANNON_EDGE_OFFSET);
            const z = edgeZ + side * CANNON_STAND_TRAVEL * travelProgress;
            const cannon = this.cannons[i];
            if (cannon?.isValid) cannon.setWorldPosition(this.standWorldX, this.course.waterY + 0.12, z);
        }
    }
}

function makeVertexMaterial(name: string, opaque: boolean): Material {
    const material = new Material();
    material.initialize({
        effectName: 'builtin-unlit',
        technique: opaque ? 0 : 1,
        defines: { USE_VERTEX_COLOR: true },
        states: opaque ? undefined : {
            rasterizerState: { cullMode: gfx.CullMode.NONE },
            depthStencilState: { depthTest: true, depthWrite: false },
        },
    });
    material.name = name;
    material.setProperty('mainColor', Color.WHITE);
    return material;
}

function buildMarkerGeometry(): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    appendDisc(positions, colors, indices, CANNON_BRAWL_TUNING.coreAlongRadius,
        CANNON_BRAWL_TUNING.coreLateralRadius, [1, 0.12, 0.04, 0.54], [1, 0.22, 0.03, 0.18], 0);
    appendRing(positions, colors, indices,
        CANNON_BRAWL_TUNING.coreAlongRadius * 1.12,
        CANNON_BRAWL_TUNING.coreLateralRadius * 1.12,
        CANNON_BRAWL_TUNING.splashAlongRadius,
        CANNON_BRAWL_TUNING.splashLateralRadius,
        [1, 0.57, 0.05, 0.34], [1, 0.77, 0.18, 0.05], 0.002);
    return geometry(
        positions, colors, indices,
        new Vec3(-CANNON_BRAWL_TUNING.splashAlongRadius, -0.01, -CANNON_BRAWL_TUNING.splashLateralRadius),
        new Vec3(CANNON_BRAWL_TUNING.splashAlongRadius, 0.01, CANNON_BRAWL_TUNING.splashLateralRadius),
    );
}

type ColorTuple = readonly [number, number, number, number];

function geometry(positions: number[], colors: number[], indices: number[], minPos: Vec3, maxPos: Vec3): primitives.IGeometry {
    return { positions, colors, indices, minPos, maxPos };
}

function pushColor(colors: number[], color: ColorTuple, count: number): void {
    for (let i = 0; i < count; i++) colors.push(color[0], color[1], color[2], color[3]);
}

function appendDisc(
    positions: number[], colors: number[], indices: number[],
    radiusX: number, radiusZ: number, centerColor: ColorTuple, edgeColor: ColorTuple, y: number,
): void {
    const segments = 24;
    const base = positions.length / 3;
    positions.push(0, y, 0);
    pushColor(colors, centerColor, 1);
    for (let i = 0; i <= segments; i++) {
        const a = i / segments * Math.PI * 2;
        positions.push(Math.cos(a) * radiusX, y, Math.sin(a) * radiusZ);
        pushColor(colors, edgeColor, 1);
    }
    for (let i = 0; i < segments; i++) indices.push(base, base + i + 1, base + i + 2);
}

function appendRing(
    positions: number[], colors: number[], indices: number[],
    innerX: number, innerZ: number, outerX: number, outerZ: number,
    innerColor: ColorTuple, outerColor: ColorTuple, y: number,
): void {
    const segments = 24;
    const base = positions.length / 3;
    for (let i = 0; i <= segments; i++) {
        const a = i / segments * Math.PI * 2;
        positions.push(Math.cos(a) * innerX, y, Math.sin(a) * innerZ,
            Math.cos(a) * outerX, y, Math.sin(a) * outerZ);
        pushColor(colors, innerColor, 1);
        pushColor(colors, outerColor, 1);
    }
    for (let i = 0; i < segments; i++) {
        const lower = base + i * 2;
        indices.push(lower, lower + 2, lower + 1, lower + 1, lower + 2, lower + 3);
    }
}
