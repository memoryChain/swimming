import type { Node } from 'cc';
import type { Swimmer } from '../entity/Swimmer';
import type { ForcedLaunchStart } from '../swimmer/ForcedLaunchModel';
import { emptyGeyserBodyPose, emptyGeyserContact, sampleGeyserBodyContact, geyserBodyClearance } from '../swimmer/GeyserBodyContact';
import type { GeyserReactionStart } from '../swimmer/GeyserReactionModel';
import type { GeyserWorldState } from '../net/NetGeyserSnapshot';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { GEYSER_TUNING, geyserBurstOverlap, geyserPhaseAt, geyserSpec, geyserPulseStart, geyserHitId,
    planGeyserVents, type GeyserHitStrength,
    type GeyserTuning, type GeyserIntensity, type GeyserVent } from './GeyserBrawlRules';
import { GeyserBrawlPresentation } from './GeyserBrawlPresentation';
import { applyGeyserSizes, geyserLargeMask, geyserRadiusScale, geyserWarningSeconds, geyserPulseIndex } from './GeyserBrawlRules';
import { selectGeyserLargeMask, type GeyserDanger, type GeyserSafetyResult } from './GeyserBrawlSafety';

/** 喷口时钟和权威命中；画面从相同时钟重建，不参与判定。 */
export class GeyserBrawlController {
    private _vents: readonly GeyserVent[];
    readonly safety: GeyserSafetyResult;
    private sizesReady: boolean;
    readonly spec;
    private readonly visual: GeyserBrawlPresentation;
    private readonly previousDistance: Float64Array;
    private readonly previousLateral: Float64Array;
    private readonly previousBodies;
    private readonly currentBody = emptyGeyserBodyPose();
    private readonly contact = emptyGeyserContact();
    private readonly bestContact = emptyGeyserContact();
    private age = 0;
    private stoppedAt = Number.POSITIVE_INFINITY;
    private authoritative = true;

    constructor(parent: Node, private readonly course: RaceCourseLayout,
        private readonly swimmers: readonly (Swimmer | null)[], seed: number,
        private readonly serial: number, readonly intensity: GeyserIntensity,
        private readonly anchorDistance: number,
        private readonly onHit?: (lane: number, hitId: number, strength: 1 | 2,
            age: number, start: ForcedLaunchStart | null, reaction?: GeyserReactionStart | null, lateSeconds?: number) => void,
        private readonly tuning: GeyserTuning = GEYSER_TUNING,
        options: { waitForAuthority?: boolean; dangers?: readonly GeyserDanger[] } = {},
    ) {
        this.spec = geyserSpec(intensity, tuning);
        for (const swimmer of swimmers) if (swimmer) swimmer.geyserTuning = tuning;
        // 首排完整预警后可达，后排沿前进方向展开，不能固定往世界坐标正向排。
        const futureDistance = anchorDistance + 6;
        const anchorX = course.distanceToWorldX(futureDistance);
        const minX = Math.min(course.startX, course.finishX) + 5;
        const maxX = Math.max(course.startX, course.finishX) - 5;
        const direction = Math.sign(course.distanceToWorldX(futureDistance + 0.5) - anchorX) || course.direction;
        const extent = Math.floor((this.spec.ventCount - 1) / 4) * 3.4 + 0.2;
        const centerX = Math.max(minX + (direction < 0 ? extent : 0),
            Math.min(maxX - (direction > 0 ? extent : 0), anchorX));
        this._vents = planGeyserVents(seed, serial, intensity, centerX, 0,
            Math.abs(course.finishX - course.startX) * 0.5, course.poolWidth * 0.5, direction);
        this.sizesReady = !options.waitForAuthority;
        const racers = swimmers.filter(s => s?.motor.isRacing && s.node.active).map(s => {
            const x = course.distanceToWorldX(s!.distance);
            const step = course.distanceToWorldX(s!.distance + 0.5) - x;
            s!.sampleGeyserBody(this.currentBody);
            return { x: this.currentBody.x, z: this.currentBody.z,
                speed: Math.max(0, s!.motor.currentSpeed) * Math.abs(step * 2),
                direction: Math.sign(step) || course.direction, heading: s!.motor.heading,
                turnRate: s!.motor.headingTurnRate || 0, roll: s!.netAxialRoll || 0, bodyScale: s!.geyserBodyScale };
        });
        this.safety = this.sizesReady ? selectGeyserLargeMask(seed, serial, intensity, this.vents,
            course.poolWidth * 0.5, racers, options.dangers ?? [], tuning)
            : { mask: 0, rejectedSpace: 0, rejectedRoute: 0 };
        this._vents = applyGeyserSizes(this.vents, this.safety.mask, this.spec.largeCount > 0);
        this.previousDistance = new Float64Array(swimmers.length);
        this.previousLateral = new Float64Array(swimmers.length);
        this.previousBodies = swimmers.map(() => emptyGeyserBodyPose());
        this.capturePositions();
        this.visual = new GeyserBrawlPresentation(parent, course.swimY, this.spec.ventCount, course.waterY);
    }

    get vents(): readonly GeyserVent[] { return this._vents; }
    get elapsedSeconds(): number { return this.age; }
    get isDone(): boolean { return this.age >= this.spec.actionSeconds; }
    get hasAuthoritativeSizes(): boolean { return this.sizesReady; }
    get largeCount(): number {
        let count = 0;
        for (const vent of this.vents) if (vent.size === 'large') count++;
        return count;
    }
    setAuthority(authoritative: boolean): void {
        if (authoritative && !this.authoritative && !this.sizesReady) {
            // 从未收到本片世界包就接管时不能临时造口；结束这片，等下一次正常排期。
            this.sizesReady = true;
            this.age = this.spec.actionSeconds;
            this.stoppedAt = 0;
        }
        this.authoritative = authoritative;
    }
    stopNewPulses(): void { this.stoppedAt = Math.min(this.stoppedAt, this.age); }

    snapshotWorld(active = true): GeyserWorldState {
        return { serial: this.serial, intensity: this.intensity, anchorDistance: this.anchorDistance,
            age: this.age, stoppedAt: Number.isFinite(this.stoppedAt) ? this.stoppedAt : -1, active,
            largeVentMask: geyserLargeMask(this.vents) };
    }

    restoreWorld(state: GeyserWorldState, lateSeconds: number): void {
        if (state.serial !== this.serial) return;
        if (!this.sizesReady) {
            this._vents = applyGeyserSizes(this.vents, state.largeVentMask, this.spec.largeCount > 0);
            this.sizesReady = true;
        }
        if (state.stoppedAt >= 0) this.stoppedAt = Math.min(this.stoppedAt, state.stoppedAt);
        // 恢复只推进表现和采样基线，不能补算断流期间经过的历史喷口。
        this.age = Math.min(this.spec.actionSeconds, Math.max(this.age, state.age + Math.max(0, lateSeconds)));
        this.visual.update(this.vents, this.age, this.spec.pulseCount, this.stoppedAt, this.tuning);
        this.capturePositions();
    }

    update(dt: number, authoritativeAge?: number): void {
        const previousAge = this.age;
        this.age = Math.min(this.spec.actionSeconds,
            Number.isFinite(authoritativeAge) ? Math.max(this.age, authoritativeAge!)
                : this.age + Math.max(0, Number.isFinite(dt) ? dt : 0));
        if (this.sizesReady) this.visual.update(this.vents, this.age, this.spec.pulseCount, this.stoppedAt, this.tuning);
        if (this.authoritative && this.sizesReady) this.resolveHits(previousAge, this.age);
        this.capturePositions();
    }

    dispose(): void { this.visual.dispose(); }

    targetZForAi(swimmer: Swimmer | null): number | null {
        if (!swimmer || !this.sizesReady || this.isDone || swimmer.isForcedLaunchActive) return null;
        const rootX = this.course.distanceToWorldX(swimmer.distance);
        const direction = Math.sign(this.course.distanceToWorldX(swimmer.distance + 0.5) - rootX) || 1;
        swimmer.sampleGeyserBody(this.currentBody);
        const x = this.currentBody.x, z = this.currentBody.z;
        let nearest = 8;
        let target: number | null = null;
        for (const vent of this.vents) {
            if (geyserPulseStart(vent, geyserPulseIndex(vent, this.age, this.tuning), this.tuning) > this.stoppedAt) continue;
            const phase = geyserPhaseAt(vent, this.age, this.spec.pulseCount, this.tuning);
            if (phase !== 'warning' && phase !== 'burst') continue;
            if ((vent.x - x) * direction < -0.5) continue;
            const distance = Math.abs(x - vent.x);
            const clearance = this.tuning.edgeRadius * geyserRadiusScale(vent, this.tuning)
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
                    if (geyserPulseStart(other, geyserPulseIndex(other, this.age, this.tuning), this.tuning) > this.stoppedAt) continue;
                    const phase = geyserPhaseAt(other, this.age, this.spec.pulseCount, this.tuning);
                    if (phase !== 'warning' && phase !== 'burst') continue;
                    if (Math.abs(candidate - other.z) < this.tuning.edgeRadius * geyserRadiusScale(other, this.tuning) + 0.5) score += 100;
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
        }
    }

    private resolveHits(fromAge: number, toAge: number): void {
        if (toAge <= fromAge) return;
        for (let lane = 0; lane < this.swimmers.length; lane++) {
            const swimmer = this.swimmers[lane];
            if (!swimmer?.geyserHitEligible) continue;
            swimmer.sampleGeyserBody(this.currentBody);
            if (swimmer.netCatchingUp) {
                Object.assign(this.previousBodies[lane], this.currentBody);
                this.previousDistance[lane] = swimmer.distance;
                this.previousLateral[lane] = swimmer.motor.lateralOffset;
            }
            let best: GeyserHitStrength = 0;
            let bestId = -1;
            let bestLarge = false;
            for (const vent of this.vents) {
                for (let pulse = 0; pulse < this.spec.pulseCount; pulse++) {
                    if (geyserPulseStart(vent, pulse, this.tuning) > this.stoppedAt) continue;
                    if (geyserBurstOverlap(vent, pulse, fromAge, toAge, this.tuning) <= 0) continue;
                    const burstStart = geyserPulseStart(vent, pulse, this.tuning) + geyserWarningSeconds(vent, this.tuning);
                    const overlapStart = Math.max(fromAge, burstStart);
                    const overlapEnd = Math.min(toAge, burstStart + this.tuning.burstSeconds);
                    const strength = sampleGeyserBodyContact(vent, pulse, this.previousBodies[lane],
                        this.currentBody, fromAge, toAge, overlapStart, overlapEnd,
                        this.course.swimY, this.course.waterY ?? this.course.swimY + .055,
                        this.contact, this.tuning).strength;
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
                    duration: (hitY < this.course.swimY - .08 ? this.tuning.submergedFlightSeconds : this.tuning.flightSeconds)
                        + (bestLarge ? this.tuning.largeFlightExtraSeconds : 0),
                    peakHeight: this.tuning.peakHeight * (bestLarge ? this.tuning.largePeakHeightScale : 1)
                        * (this.tuning.bodyHitLiftMinScale + (1 - this.tuning.bodyHitLiftMinScale) * this.bestContact.coverage),
                    entryScale: this.tuning.entrySpeedScale, exitScale: this.tuning.exitSpeedScale,
                } : undefined;
                if (swimmer.applyGeyserHit(bestId, best, late, start, false, bestLarge, this.bestContact))
                    this.onHit?.(lane, bestId, best, toAge, swimmer.forcedLaunchStart, swimmer.geyserReactionStart, late);
            }
        }
    }
}
