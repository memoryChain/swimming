import type { Node } from 'cc';
import type { Swimmer } from '../entity/Swimmer';
import type { ForcedLaunchStart } from '../swimmer/ForcedLaunchModel';
import { emptyGeyserBodyPose, emptyGeyserContact, sampleGeyserBodyContact, geyserBodyClearance } from '../swimmer/GeyserBodyContact';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { GEYSER_TUNING, geyserBurstOverlap, geyserPhaseAt, geyserSpec, geyserPulseStart, geyserHitId,
    planGeyserVents, geyserRadiusScale, geyserPulseIndex, geyserWarningSeconds, type GeyserHitStrength, type GeyserVent } from './GeyserBrawlRules';
import { GeyserBrawlPresentation } from './GeyserBrawlPresentation';
import type { FloatingItemLayers } from './FloatingItemRenderer';
import type { GeyserMeshes } from './EntertainmentItemAssets';

type Patch = { serial: number; anchorDistance: number; endDistance: number; vents: readonly GeyserVent[] };
const EMPTY_VENTS: readonly GeyserVent[] = [];

/** 普通喷泉独立调试：赛前冻结排布，两个表现槽位反复使用；不承担联机或导演混排。 */
export class GeyserRaceController {
    readonly spec = geyserSpec(1);
    private readonly patches: readonly Patch[];
    private readonly visual: GeyserBrawlPresentation;
    private readonly previousDistance: Float64Array;
    private readonly previousLateral: Float64Array;
    private readonly previousBodies;
    private readonly baseline: Uint8Array;
    private readonly currentBody = emptyGeyserBodyPose();
    private readonly contact = emptyGeyserContact();
    private readonly bestContact = emptyGeyserContact();
    private nextPatch = 0;
    private serial = 0;
    private age = 0;
    private stoppedAt = Number.POSITIVE_INFINITY;
    private stopped = false;
    private disposed = false;
    private active = false;
    private _vents: readonly GeyserVent[] = EMPTY_VENTS;
    constructor(parent: Node, private readonly course: RaceCourseLayout,
        private readonly swimmers: readonly Swimmer[], seed: number, raceDistance: number,
        meshes: GeyserMeshes, layers: FloatingItemLayers | null = null) {
        const patches: Patch[] = [];
        const extent = Math.max(0, Math.abs(course.finishX - course.startX) * .5);
        for (let lap = 0; lap < Math.min(8, Math.ceil(raceDistance / course.courseLength)); lap++) {
            const start = lap * course.courseLength, end = Math.min(raceDistance, start + course.courseLength);
            if (end - start < 24) continue;
            const anchorDistance = start + 10;
            const x = course.distanceToWorldX(anchorDistance + 7);
            const direction = course.directionAtDistance(anchorDistance + 7);
            const vents = planGeyserVents(seed, lap + 1, 1, x, 0, extent, course.poolWidth * .5, direction);
            patches.push({ serial: lap + 1, anchorDistance, endDistance: end - 4, vents });
        }
        this.patches = patches;
        this.previousDistance = new Float64Array(swimmers.length);
        this.previousLateral = new Float64Array(swimmers.length);
        this.baseline = new Uint8Array(swimmers.length);
        this.previousBodies = swimmers.map(() => emptyGeyserBodyPose());
        this.visual = new GeyserBrawlPresentation(parent, course.swimY, 2, meshes, course.waterY, layers);
    }
    get vents(): readonly GeyserVent[] { return this._vents; }
    get elapsedSeconds(): number { return this.age; }
    get isDone(): boolean { return !this.active && (this.stopped || this.nextPatch >= this.patches.length); }
    reset(): void {
        if (this.disposed) return;
        this.nextPatch = this.serial = this.age = 0;
        this.stoppedAt = Number.POSITIVE_INFINITY;
        this.stopped = this.active = false;
        this._vents = EMPTY_VENTS;
        this.baseline.fill(0);
        this.visual.hide();
    }
    stopNewPulses(): void { if (!this.stopped) { this.stopped = true; this.stoppedAt = this.age; } }
    update(dt: number, referenceDistance: number): void {
        if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
        if (!this.active && !this.stopped) {
            while (this.nextPatch < this.patches.length && referenceDistance >= this.patches[this.nextPatch].endDistance) this.nextPatch++;
            const patch = this.patches[this.nextPatch];
            if (patch && referenceDistance >= patch.anchorDistance) {
                this.nextPatch++; this.serial = patch.serial; this._vents = patch.vents;
                this.age = 0; this.stoppedAt = Number.POSITIVE_INFINITY; this.active = true;
                this.capturePositions();
                this.visual.update(this.vents, 0, this.spec.pulseCount);
                return;
            }
        }
        if (!this.active) return;
        const previousAge = this.age;
        this.age = Math.min(this.spec.actionSeconds, this.age + dt);
        this.resolveHits(previousAge, this.age);
        this.capturePositions();
        this.visual.update(this.vents, this.age, this.spec.pulseCount, this.stoppedAt);
        if (this.age >= this.spec.actionSeconds) { this.active = false; this.visual.hide(); }
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true; this.active = false; this._vents = EMPTY_VENTS;
        this.visual.dispose();
    }
    targetZForAi(swimmer: Swimmer | null): number | null {
        if (!swimmer || !this.active || swimmer.isForcedLaunchActive) return null;
        const rootX = this.course.distanceToWorldX(swimmer.distance);
        const direction = Math.sign(this.course.distanceToWorldX(swimmer.distance + 0.5) - rootX) || 1;
        swimmer.sampleGeyserBody(this.currentBody);
        const x = this.currentBody.x, z = this.currentBody.z;
        let nearest = 8;
        let target: number | null = null;
        for (const vent of this.vents) {
            if (geyserPulseStart(vent, geyserPulseIndex(vent, this.age, GEYSER_TUNING), GEYSER_TUNING) > this.stoppedAt) continue;
            const phase = geyserPhaseAt(vent, this.age, this.spec.pulseCount, GEYSER_TUNING);
            if (phase !== 'warning' && phase !== 'burst') continue;
            if ((vent.x - x) * direction < -0.5) continue;
            const distance = Math.abs(x - vent.x);
            const clearance = GEYSER_TUNING.edgeRadius * geyserRadiusScale(vent, GEYSER_TUNING)
                - .2 + geyserBodyClearance(swimmer.motor.heading, swimmer.geyserBodyScale) + .65;
            if (distance >= nearest || Math.abs(z - vent.z) > clearance) continue;
            nearest = distance;
            const away = z >= vent.z ? 1 : -1;
            const bound = this.course.poolWidth * 0.5 - 0.8;
            let bestScore = Number.POSITIVE_INFINITY;
            for (let side = -1; side <= 1; side += 2) {
                const candidate = vent.z + side * clearance;
                if (Math.abs(candidate) > bound) continue;
                let score = Math.abs(candidate - z) + (side === away ? 0 : 0.1);
                for (const other of this.vents) {
                    if (Math.abs(other.x - vent.x) > 3.6) continue;
                    if (geyserPulseStart(other, geyserPulseIndex(other, this.age, GEYSER_TUNING), GEYSER_TUNING) > this.stoppedAt) continue;
                    const phase = geyserPhaseAt(other, this.age, this.spec.pulseCount, GEYSER_TUNING);
                    if (phase !== 'warning' && phase !== 'burst') continue;
                    if (Math.abs(candidate - other.z) < GEYSER_TUNING.edgeRadius * geyserRadiusScale(other, GEYSER_TUNING) + 0.5) score += 100;
                }
                if (score < bestScore) { bestScore = score; target = candidate; }
            }
        }
        return target;
    }

    private capturePositions(): void {
        for (let lane = 0; lane < this.swimmers.length; lane++) {
            const swimmer = this.swimmers[lane];
            if (!swimmer) continue;
            this.previousDistance[lane] = swimmer.distance;
            this.previousLateral[lane] = swimmer.motor.lateralOffset;
            swimmer.sampleGeyserBody(this.previousBodies[lane]);
            this.baseline[lane] = swimmer.geyserHitEligible ? 1 : 0;
        }
    }

    private resolveHits(fromAge: number, toAge: number): void {
        if (toAge <= fromAge) return;
        for (let lane = 0; lane < this.swimmers.length; lane++) {
            const swimmer = this.swimmers[lane];
            if (!swimmer?.geyserHitEligible) { this.baseline[lane] = 0; continue; }
            swimmer.sampleGeyserBody(this.currentBody);
            if (!this.baseline[lane] || swimmer.netCatchingUp) {
                Object.assign(this.previousBodies[lane], this.currentBody);
                this.previousDistance[lane] = swimmer.distance;
                this.previousLateral[lane] = swimmer.motor.lateralOffset;
            }
            let best: GeyserHitStrength = 0;
            let bestId = -1;
            let bestLarge = false;
            for (const vent of this.vents) {
                for (let pulse = 0; pulse < this.spec.pulseCount; pulse++) {
                    if (geyserPulseStart(vent, pulse, GEYSER_TUNING) > this.stoppedAt) continue;
                    if (geyserBurstOverlap(vent, pulse, fromAge, toAge, GEYSER_TUNING) <= 0) continue;
                    const burstStart = geyserPulseStart(vent, pulse, GEYSER_TUNING) + geyserWarningSeconds(vent, GEYSER_TUNING);
                    const overlapStart = Math.max(fromAge, burstStart);
                    const overlapEnd = Math.min(toAge, burstStart + GEYSER_TUNING.burstSeconds);
                    const strength = sampleGeyserBodyContact(vent, pulse, this.previousBodies[lane],
                        this.currentBody, fromAge, toAge, overlapStart, overlapEnd,
                        this.course.swimY, this.course.waterY ?? this.course.swimY + .055,
                        this.contact, GEYSER_TUNING).strength;
                    if (strength > best || (strength > 0 && strength === best && !bestLarge && vent.size === 'large')) {
                        best = strength;
                        bestLarge = vent.size === 'large';
                        bestId = geyserHitId(this.serial, pulse, vent.id, lane);
                        Object.assign(this.bestContact, this.contact);
                    }
                }
            }
            if (best && bestId > 0) {
                const late = Math.max(0, toAge - this.bestContact.time);
                const teleported = Math.hypot(this.currentBody.x - this.previousBodies[lane].x,
                    this.currentBody.z - this.previousBodies[lane].z) > 4;
                const ratio = teleported ? 1 : Math.max(0, Math.min(1, (this.bestContact.time - fromAge) / (toAge - fromAge)));
                const hitY = swimmer.node.position.y;
                const start: ForcedLaunchStart | undefined = best === 2 ? {
                    distance: this.previousDistance[lane] + (swimmer.distance - this.previousDistance[lane]) * ratio,
                    lateral: this.previousLateral[lane] + (swimmer.motor.lateralOffset - this.previousLateral[lane]) * ratio,
                    y: hitY, surfaceY: this.course.swimY, speed: swimmer.motor.currentSpeed,
                    heading: this.course.finishDirectionAtDistance(swimmer.distance) > 0 ? this.currentBody.yaw : Math.PI - this.currentBody.yaw,
                    duration: (hitY < this.course.swimY - .08 ? GEYSER_TUNING.submergedFlightSeconds : GEYSER_TUNING.flightSeconds)
                        + (bestLarge ? GEYSER_TUNING.largeFlightExtraSeconds : 0),
                    peakHeight: GEYSER_TUNING.peakHeight * (bestLarge ? GEYSER_TUNING.largePeakHeightScale : 1)
                        * (GEYSER_TUNING.bodyHitLiftMinScale + (1 - GEYSER_TUNING.bodyHitLiftMinScale) * this.bestContact.coverage),
                    entryScale: GEYSER_TUNING.entrySpeedScale, exitScale: GEYSER_TUNING.exitSpeedScale,
                } : undefined;
                swimmer.applyGeyserHit(bestId, best, late, start ?? null, this.bestContact);
            }
        }
    }
}
