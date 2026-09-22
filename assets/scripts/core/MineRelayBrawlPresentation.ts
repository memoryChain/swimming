import { Color, gfx, instantiate, Material, Node, primitives, Quat, Vec3 } from 'cc';
import { findNode, loadSwimmerPrefab, setLayerRecursive } from '../character/CharacterModelLoader';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { RESOURCE_PATHS } from './ResourcePaths';
import { MINE_RELAY_TUNING, type MineRelayArm } from './MineRelayBrawlController';
import { ENTERTAINMENT_SPLASH_OWNER, ENTERTAINMENT_SPLASH_PROFILE, EntertainmentWaterSplashPool } from './EntertainmentWaterSplash';

const PRESENTATION_INTERVAL = 1 / 20;
const TRANSFER_THROW_SECONDS = 0.22;
const TRANSFER_THROW_ARC_HEIGHT = 0.55;
const DEFLATE_SECONDS = 0.28;
const EXPLOSION_SECONDS = 0.95;
const TIMED_BOMB_EXPLOSION_INTENSITY = 1.25;

/** 一份水球实例，只消费现有权威计时与归属；不创建碰撞体或第二套恢复状态。 */
export class MineRelayBrawlPresentation {
    private readonly root: Node;
    private body: Node | null = null;
    private connector: Node | null = null;
    private model: Node | null = null;
    private arm: MineRelayArm | null = null;
    private carrier: Node | null = null;
    private anchor: Node | null = null;
    private remainingSeconds = 0;
    private locked = false;
    private disposed = false;
    private elapsed = PRESENTATION_INTERVAL;
    private throwRemaining = 0;
    private throwDuration = 0;
    private throwArcHeight = 0;
    private deflateRemaining = 0;
    private inflation = 1;
    private readonly source = new Vec3();
    private readonly target = new Vec3();
    private readonly centerLocal = new Vec3();
    private readonly sourceRotation = new Quat();
    private readonly targetRotation = new Quat();
    private readonly rotation = new Quat();
    private readonly resolutionWorldPosition = new Vec3();
    private readonly explosionCoreWorldPosition = new Vec3();

    constructor(
        private readonly worldRoot: Node,
        private readonly course: RaceCourseLayout,
        private readonly waterSplashes: EntertainmentWaterSplashPool | null,
        private readonly resolveAnchor: (carrier: Node) => Node | null = carrier => carrier,
    ) {
        this.root = new Node('TimedWaterBalloonPresentation');
        this.root.setParent(worldRoot);
        this.root.layer = worldRoot.layer;
        this.root.active = false;
        loadSwimmerPrefab((error, result) => {
            if (this.disposed || !this.root.isValid || error || !result) return;
            this.model = instantiate(result.prefab);
            this.model.setParent(this.root);
            setLayerRecursive(this.model, worldRoot.layer);
            this.body = findNode(this.model, 'BalloonBody');
            this.connector = findNode(this.model, 'BalloonConnector');
            // 加载迟到只恢复现在的位置和鼓胀，不补播已经过去的投放／转交。
            this.cancelThrow();
            if (this.arm && this.carrier?.isValid) {
                this.attachCurrent();
                this.presentBody();
            }
        }, RESOURCE_PATHS.timedWaterBalloonPrefabCandidates);
    }

    get visualNode(): Node | null {
        return !this.disposed && this.root.active && this.model ? this.root : null;
    }

    reset(): void {
        this.detachMine();
        this.elapsed = PRESENTATION_INTERVAL;
        this.waterSplashes?.cancelOwner(ENTERTAINMENT_SPLASH_OWNER.TIMED_BOMB);
    }

    attach(arm: MineRelayArm, carrier: Node | null, throwFromStands = false): void {
        if (this.disposed) return;
        this.arm = arm;
        this.carrier = carrier;
        this.remainingSeconds = arm.fuseSeconds;
        this.locked = false;
        this.deflateRemaining = 0;
        this.cancelThrow();
        this.attachCurrent();
        this.presentBody();
        if (!throwFromStands || !this.model || !this.anchor?.isValid) return;
        this.anchor.getWorldPosition(this.target);
        const side = this.target.z >= 0 ? 1 : -1;
        this.source.set(this.target.x - this.course.direction * 1.8,
            this.course.waterY + 4.8, side * (this.course.poolWidth * 0.5 + 3.2));
        this.beginThrow(Math.max(0.2, MINE_RELAY_TUNING.initialTransferCooldownSeconds), 3.6);
    }

    transfer(arm: MineRelayArm, previousCarrier: Node | null, carrier: Node | null): void {
        if (this.disposed) return;
        if (this.root.active) {
            this.root.getWorldPosition(this.source);
            this.root.getWorldRotation(this.sourceRotation);
        } else {
            const oldAnchor = previousCarrier?.isValid ? this.resolveAnchor(previousCarrier) : null;
            if (oldAnchor) oldAnchor.getWorldPosition(this.source);
        }
        const hadVisual = this.root.active;
        this.arm = arm;
        this.carrier = carrier;
        this.deflateRemaining = 0;
        this.cancelThrow();
        this.anchor = carrier?.isValid ? this.resolveAnchor(carrier) : null;
        if (hadVisual && this.anchor?.isValid) this.beginThrow(TRANSFER_THROW_SECONDS, TRANSFER_THROW_ARC_HEIGHT);
        else this.attachCurrent();
    }

    sync(arm: MineRelayArm | null, carrier: Node | null): void {
        if (this.disposed) return;
        if (!arm) {
            if (this.deflateRemaining <= 0 && this.arm) this.detachMine();
            return;
        }
        const changed = this.arm?.roundId !== arm.roundId || this.carrier !== carrier;
        this.arm = arm;
        this.carrier = carrier;
        if (changed) {
            this.deflateRemaining = 0;
            this.cancelThrow();
        }
        if (changed || !this.anchor?.isValid || this.throwRemaining <= 0) this.attachCurrent();
    }

    /** 晚快照恢复当前状态；同归属重复快照不重开演出。 */
    syncSnapshot(arm: MineRelayArm | null, carrier: Node | null, remaining: number, locked: boolean): void {
        this.remainingSeconds = remaining;
        this.locked = locked;
        this.cancelThrow();
        this.sync(arm, carrier);
        this.presentBody();
    }

    showResolution(exploded: boolean, worldPosition: Readonly<Vec3> | null): void {
        if (this.disposed) return;
        const round = this.arm?.roundId ?? 0;
        const visible = !!this.visualNode;
        // 解绑前记录球体真实中心，潜水、空中和转交时都不能用水面根位置替代。
        if (visible) {
            this.centerLocal.set(0, 0.14 + 0.245 * this.inflation, 0);
            Vec3.transformMat4(this.explosionCoreWorldPosition, this.centerLocal, this.root.worldMatrix);
        } else if (worldPosition) this.explosionCoreWorldPosition.set(worldPosition);
        if (!exploded && visible) {
            this.root.getWorldPosition(this.target);
            this.root.getWorldRotation(this.rotation);
            this.root.setParent(this.worldRoot);
            this.root.setWorldPosition(this.target);
            this.root.setWorldRotation(this.rotation);
            this.root.setScale(1, 1, 1);
            this.arm = null;
            this.carrier = this.anchor = null;
            this.cancelThrow();
            this.deflateRemaining = DEFLATE_SECONDS;
            return;
        }
        this.detachMine();
        if (!exploded || !worldPosition) return;
        this.resolutionWorldPosition.set(this.explosionCoreWorldPosition.x,
            this.course.waterY + 0.035, this.explosionCoreWorldPosition.z);
        this.waterSplashes?.play({
            owner: ENTERTAINMENT_SPLASH_OWNER.TIMED_BOMB,
            profile: ENTERTAINMENT_SPLASH_PROFILE.EXPLOSION,
            position: this.resolutionWorldPosition,
            explosionCorePosition: this.explosionCoreWorldPosition,
            yawDegrees: round * 53,
            intensity: TIMED_BOMB_EXPLOSION_INTENSITY,
            duration: EXPLOSION_SECONDS,
            layer: this.worldRoot.layer,
        });
    }

    update(dt: number, arm: MineRelayArm | null, carrier: Node | null, remaining: number, locked: boolean, racing: boolean): void {
        if (this.disposed) return;
        if (!racing) { this.detachMine(); return; }
        this.remainingSeconds = remaining;
        this.locked = locked;
        this.sync(arm, carrier);
        if (!arm && this.deflateRemaining <= 0) return;
        this.elapsed += Number.isFinite(dt) ? Math.max(0, dt) : 0;
        if (this.elapsed < PRESENTATION_INTERVAL) return;
        const step = this.elapsed;
        this.elapsed = 0;
        if (this.deflateRemaining > 0) { this.advanceDeflate(step); return; }
        if (!this.anchor?.isValid || !this.model) return;
        this.advanceThrow(step);
        this.presentBody();
    }

    updateResidualEffects(dt: number, racing: boolean): void {
        if (this.disposed) return;
        if (!racing) { this.reset(); return; }
        if (this.arm) this.detachMine();
        if (this.deflateRemaining > 0) this.advanceDeflate(Math.max(0, dt));
    }

    dispose(): void {
        if (this.disposed) return;
        this.reset();
        this.disposed = true;
        if (this.root.isValid) this.root.destroy();
        this.model = this.body = this.connector = null;
    }

    private attachCurrent(): void {
        this.anchor = this.carrier?.isValid ? this.resolveAnchor(this.carrier) : null;
        if (!this.anchor?.isValid || !this.model) { this.setActive(false); return; }
        // 道具实例始终由世界根持有，角色模型重载不会连带销毁它。
        this.anchor.getWorldPosition(this.target);
        this.anchor.getWorldRotation(this.targetRotation);
        if (!Vec3.equals(this.root.worldPosition, this.target)) this.root.setWorldPosition(this.target);
        if (!Quat.equals(this.root.worldRotation, this.targetRotation)) this.root.setWorldRotation(this.targetRotation);
        this.setActive(true);
        if (this.connector && !this.connector.active) this.connector.active = true;
    }

    private presentBody(): void {
        if (!this.arm || !this.body || !this.root.active) return;
        const age = Math.max(0, this.arm.fuseSeconds - this.remainingSeconds);
        const urgency = Math.max(0, Math.min(1, age / Math.max(0.01, this.arm.fuseSeconds)));
        this.inflation = 1 + urgency * 0.22;
        if (Math.abs(this.body.scale.x - this.inflation) > 0.0001) this.body.setScale(this.inflation, this.inflation, this.inflation);
        // 从本轮计时推导相位；换人和晚快照不从零鼓胀，锁定只增加短促抖动。
        const shake = this.locked ? Math.sin(age * 47) * 4 : Math.sin(age * 3.1) * 2;
        this.body.setRotationFromEuler(shake, 0, Math.sin(age * 2.4) * (this.locked ? 3 : 1.5));
    }

    private beginThrow(duration: number, arcHeight: number): void {
        this.root.getWorldRotation(this.sourceRotation);
        this.root.setParent(this.worldRoot);
        this.root.setScale(1, 1, 1);
        this.root.setWorldPosition(this.source);
        this.root.setWorldRotation(this.sourceRotation);
        this.throwDuration = this.throwRemaining = duration;
        this.throwArcHeight = arcHeight;
        if (this.connector?.active) this.connector.active = false;
        this.setActive(true);
    }

    private advanceThrow(step: number): void {
        if (this.throwRemaining <= 0 || !this.anchor?.isValid) return;
        this.throwRemaining = Math.max(0, this.throwRemaining - step);
        const t = 1 - this.throwRemaining / this.throwDuration;
        this.anchor.getWorldPosition(this.target);
        this.anchor.getWorldRotation(this.targetRotation);
        this.root.setWorldPosition(this.source.x + (this.target.x - this.source.x) * t,
            this.source.y + (this.target.y - this.source.y) * t + Math.sin(t * Math.PI) * this.throwArcHeight,
            this.source.z + (this.target.z - this.source.z) * t);
        Quat.slerp(this.rotation, this.sourceRotation, this.targetRotation, t);
        this.root.setWorldRotation(this.rotation);
        if (this.throwRemaining <= 0) { this.cancelThrow(); this.attachCurrent(); }
    }

    private advanceDeflate(step: number): void {
        this.deflateRemaining = Math.max(0, this.deflateRemaining - step);
        if (this.deflateRemaining <= 0) { this.detachMine(); return; }
        const scale = Math.max(0.02, this.deflateRemaining / DEFLATE_SECONDS);
        if (this.body) this.body.setScale(this.inflation * scale, this.inflation * (0.2 + 0.8 * scale), this.inflation * scale);
        if (this.connector?.active) this.connector.active = false;
    }

    private cancelThrow(): void { this.throwRemaining = this.throwDuration = this.throwArcHeight = 0; }

    private detachMine(): void {
        this.arm = null;
        this.carrier = this.anchor = null;
        this.deflateRemaining = 0;
        this.cancelThrow();
        this.setActive(false);
        if (this.root.isValid && this.root.parent !== this.worldRoot) this.root.setParent(this.worldRoot);
    }

    private setActive(value: boolean): void {
        if (this.root.isValid && this.root.active !== value) this.root.active = value;
    }
}

type ColorTuple = readonly [number, number, number, number];

export function makeMineVertexMaterial(name: string, opaque: boolean): Material {
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

export function buildMineGeometry(): primitives.IGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    appendFacetedMineBody(positions, colors, indices, 0.34);
    // 略微凸出的腰线让深色球体在比赛镜头下仍有层次，并为旋转提供稳定参照。
    appendFacetedCylinder(positions, colors, indices, 0, 0, 0, 0.365, 0.055, [0.08, 0.16, 0.18, 1]);
    const directions: ReadonlyArray<readonly [number, number, number]> = [
        [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
        [0.62, 0.58, 0.53], [-0.62, 0.58, -0.53],
        [0.60, -0.63, -0.49], [-0.60, -0.63, 0.49],
    ];
    for (const direction of directions) appendDetailedMineSpike(positions, colors, indices, direction);

    // 顶部触发器和侧面警示牌打破完全对称轮廓，轻微旋转时也能被读出来。
    appendFacetedCylinder(positions, colors, indices, 0, 0.405, 0, 0.11, 0.075, [0.13, 0.17, 0.17, 1]);
    appendFacetedCylinder(positions, colors, indices, 0, 0.515, 0, 0.052, 0.045, [0.92, 0.38, 0.055, 1]);
    appendBox(positions, colors, indices, -0.15, 0.455, -0.026, 0.15, 0.495, 0.026, [0.24, 0.29, 0.28, 1]);
    appendBox(positions, colors, indices, 0.07, -0.07, 0.305, 0.23, 0.075, 0.355, [0.72, 0.24, 0.055, 1]);
    return geometry(positions, colors, indices, new Vec3(-0.66, -0.66, -0.66), new Vec3(0.66, 0.59, 0.66));
}

function appendFacetedMineBody(
    positions: number[], colors: number[], indices: number[], radius: number,
): void {
    const segments = 10;
    const bands = 6;
    for (let band = 0; band < bands; band++) {
        const theta0 = band / bands * Math.PI;
        const theta1 = (band + 1) / bands * Math.PI;
        const sin0 = Math.sin(theta0), cos0 = Math.cos(theta0);
        const sin1 = Math.sin(theta1), cos1 = Math.cos(theta1);
        for (let segment = 0; segment < segments; segment++) {
            const angle0 = segment / segments * Math.PI * 2;
            const angle1 = (segment + 1) / segments * Math.PI * 2;
            const x00 = Math.cos(angle0) * sin0 * radius;
            const z00 = Math.sin(angle0) * sin0 * radius;
            const x01 = Math.cos(angle1) * sin0 * radius;
            const z01 = Math.sin(angle1) * sin0 * radius;
            const x10 = Math.cos(angle0) * sin1 * radius;
            const z10 = Math.sin(angle0) * sin1 * radius;
            const x11 = Math.cos(angle1) * sin1 * radius;
            const z11 = Math.sin(angle1) * sin1 * radius;
            const shade = 0.9 + ((segment + band * 2) % 3) * 0.055;
            const color: ColorTuple = [0.055 * shade, 0.115 * shade, 0.13 * shade, 1];
            const base = positions.length / 3;
            if (band === 0) {
                positions.push(0, radius, 0, x11, cos1 * radius, z11, x10, cos1 * radius, z10);
                pushColor(colors, color, 3);
                indices.push(base, base + 1, base + 2);
            } else if (band === bands - 1) {
                positions.push(x00, cos0 * radius, z00, x01, cos0 * radius, z01, 0, -radius, 0);
                pushColor(colors, color, 3);
                indices.push(base, base + 1, base + 2);
            } else {
                positions.push(
                    x00, cos0 * radius, z00, x01, cos0 * radius, z01,
                    x10, cos1 * radius, z10, x11, cos1 * radius, z11,
                );
                pushColor(colors, color, 4);
                indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
            }
        }
    }
}

function appendDetailedMineSpike(
    positions: number[], colors: number[], indices: number[],
    direction: readonly [number, number, number],
): void {
    let [dx, dy, dz] = direction;
    const directionLength = Math.max(0.001, Math.hypot(dx, dy, dz));
    dx /= directionLength;
    dy /= directionLength;
    dz /= directionLength;
    const up: readonly [number, number, number] = Math.abs(dy) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let ux = dy * up[2] - dz * up[1];
    let uy = dz * up[0] - dx * up[2];
    let uz = dx * up[1] - dy * up[0];
    const ul = Math.max(0.001, Math.hypot(ux, uy, uz));
    ux /= ul; uy /= ul; uz /= ul;
    const vx = dy * uz - dz * uy;
    const vy = dz * ux - dx * uz;
    const vz = dx * uy - dy * ux;
    const distances = [0.25, 0.37, 0.49];
    const widths = [0.135, 0.105, 0.068];
    const sectionColors: readonly ColorTuple[] = [
        [0.055, 0.08, 0.085, 1],
        [0.12, 0.20, 0.21, 1],
        [0.19, 0.29, 0.30, 1],
    ];
    const base = positions.length / 3;
    for (let section = 0; section < distances.length; section++) {
        const distance = distances[section];
        const half = widths[section];
        const cx = dx * distance, cy = dy * distance, cz = dz * distance;
        positions.push(
            cx + ux * half + vx * half, cy + uy * half + vy * half, cz + uz * half + vz * half,
            cx - ux * half + vx * half, cy - uy * half + vy * half, cz - uz * half + vz * half,
            cx - ux * half - vx * half, cy - uy * half - vy * half, cz - uz * half - vz * half,
            cx + ux * half - vx * half, cy + uy * half - vy * half, cz + uz * half - vz * half,
        );
        pushColor(colors, sectionColors[section], 4);
    }
    const tip = positions.length / 3;
    positions.push(dx * 0.64, dy * 0.64, dz * 0.64);
    pushColor(colors, [0.24, 0.34, 0.34, 1], 1);
    for (let section = 0; section < distances.length - 1; section++) {
        const current = base + section * 4;
        const next = current + 4;
        for (let side = 0; side < 4; side++) {
            const sideNext = (side + 1) % 4;
            indices.push(current + side, current + sideNext, next + sideNext,
                current + side, next + sideNext, next + side);
        }
    }
    const last = base + (distances.length - 1) * 4;
    for (let side = 0; side < 4; side++) {
        indices.push(last + side, last + (side + 1) % 4, tip);
    }
    indices.push(base, base + 3, base + 2, base, base + 2, base + 1);
}

function appendFacetedCylinder(
    positions: number[], colors: number[], indices: number[],
    centerX: number, centerY: number, centerZ: number, radius: number, halfHeight: number, color: ColorTuple,
): void {
    const segments = 8;
    const base = positions.length / 3;
    for (let i = 0; i < segments; i++) {
        const angle = i / segments * Math.PI * 2;
        const x = centerX + Math.cos(angle) * radius;
        const z = centerZ + Math.sin(angle) * radius;
        positions.push(x, centerY - halfHeight, z, x, centerY + halfHeight, z);
        pushColor(colors, color, 2);
    }
    const bottomCenter = positions.length / 3;
    positions.push(centerX, centerY - halfHeight, centerZ, centerX, centerY + halfHeight, centerZ);
    pushColor(colors, color, 2);
    for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        const lower = base + i * 2;
        const upper = lower + 1;
        const nextLower = base + next * 2;
        const nextUpper = nextLower + 1;
        indices.push(lower, upper, nextLower, nextLower, upper, nextUpper);
        indices.push(bottomCenter, lower, nextLower, bottomCenter + 1, nextUpper, upper);
    }
}

function appendBox(
    positions: number[], colors: number[], indices: number[],
    minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, color: ColorTuple,
): void {
    const base = positions.length / 3;
    positions.push(
        minX, minY, minZ, maxX, minY, minZ, maxX, maxY, minZ, minX, maxY, minZ,
        minX, minY, maxZ, maxX, minY, maxZ, maxX, maxY, maxZ, minX, maxY, maxZ,
    );
    pushColor(colors, color, 8);
    const faces = [
        0, 3, 2, 0, 2, 1,
        4, 5, 6, 4, 6, 7,
        0, 4, 7, 0, 7, 3,
        1, 2, 6, 1, 6, 5,
        0, 1, 5, 0, 5, 4,
        3, 7, 6, 3, 6, 2,
    ];
    for (const index of faces) indices.push(base + index);
}

function geometry(positions: number[], colors: number[], indices: number[], minPos: Vec3, maxPos: Vec3): primitives.IGeometry {
    return { positions, colors, indices, minPos, maxPos };
}

function pushColor(colors: number[], color: ColorTuple, count: number): void {
    for (let i = 0; i < count; i++) colors.push(color[0], color[1], color[2], color[3]);
}
