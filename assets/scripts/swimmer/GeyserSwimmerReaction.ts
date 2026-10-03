import { GEYSER_TUNING, GeyserHitLedger } from '../entertainment/GeyserBrawlRules';
import { ForcedLaunchStart, ForcedLaunchSample, sampleForcedLaunch } from './ForcedLaunchModel';
import { GeyserBodyPose, GeyserContact } from './GeyserBodyContact';
import { createGeyserReaction, GeyserReactionStart, GeyserReactionSample, sampleGeyserReaction } from './GeyserReactionModel';

/** 仅普通喷泉调试选手拥有；飞行、姿态、重击去重与保护期由同一生命周期持有。 */
export class GeyserSwimmerReaction {
    readonly pose: GeyserReactionSample = { pitch: 0, roll: 0, weight: 0, forward: 0, side: 0 };
    readonly sample: ForcedLaunchSample = { distance: 0, lateral: 0, y: 0, speed: 0, done: false };
    private readonly hits = new GeyserHitLedger();
    launch: ForcedLaunchStart | null = null;
    private launchAge = 0;
    private reaction: GeyserReactionStart | null = null;
    private reactionAge = 0;
    private grace = 0;
    private edge = 0;
    get eligible(): boolean { return this.launch === null && this.grace <= 0; }
    reset(): void {
        this.launch = this.reaction = null;
        this.launchAge = this.reactionAge = this.grace = this.edge = 0;
        this.pose.weight = this.pose.forward = this.pose.side = 0;
        this.hits.reset();
    }
    hit(id: number, strength: 1 | 2, late: number, body: GeyserBodyPose,
        pitchVelocity: number, rollVelocity: number, start: ForcedLaunchStart | null, contact: GeyserContact): boolean {
        if (!this.eligible || !this.hits.accepts(id, strength) || (strength === 1 && this.edge > 0)) return false;
        const duration = strength === 1 ? GEYSER_TUNING.edgeSeconds : start?.duration ?? 0;
        if (late >= duration) { this.hits.record(id, strength); return false; }
        if (strength === 2 && !start) return false;
        this.hits.record(id, strength);
        const decay = this.reaction ? Math.exp(-Math.max(.1, GEYSER_TUNING.rotationDamping)
            * Math.min(this.reactionAge, this.reaction.duration)) * this.pose.weight : 0;
        this.reaction = createGeyserReaction(id, strength, duration, body.pitch, body.roll,
            this.reaction ? this.reaction.pitchVelocity * decay : pitchVelocity,
            this.reaction ? this.reaction.rollVelocity * decay : rollVelocity, contact);
        this.reactionAge = Math.max(0, late);
        sampleGeyserReaction(this.reaction, this.reactionAge, this.pose);
        if (strength === 1) this.edge = Math.max(0, duration - late);
        else { this.launch = start; this.launchAge = Math.max(0, late); this.edge = 0; }
        return true;
    }
    tick(dt: number): void {
        if (!Number.isFinite(dt) || dt <= 0) return;
        if (this.grace > 0) this.grace = Math.max(0, this.grace - dt);
        if (this.edge > 0) this.edge = Math.max(0, this.edge - dt);
        if (!this.reaction) return;
        this.reactionAge += dt;
        sampleGeyserReaction(this.reaction, this.reactionAge, this.pose);
        if (this.pose.weight <= 0) this.reaction = null;
    }
    advanceLaunch(dt: number): ForcedLaunchSample {
        this.launchAge = Math.min(this.launch.duration, this.launchAge + Math.max(0, dt));
        return sampleForcedLaunch(this.launch, this.launchAge, this.sample);
    }
    land(): void { this.launch = null; this.launchAge = 0; this.grace = GEYSER_TUNING.rehitGraceSeconds; }
}
