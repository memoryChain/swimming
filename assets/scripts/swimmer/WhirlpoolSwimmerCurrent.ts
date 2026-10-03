import { WHIRLPOOL_BRAWL_TUNING } from '../core/EntertainmentBalance';
import { resetWhirlpoolInfluence, sampleWhirlpoolInfluence, WhirlpoolInfluence, WhirlpoolSpawn } from '../entertainment/WhirlpoolBrawlRules';

/** 水流独立于碰撞缓冲；只有漩涡调试选手拥有此对象。 */
export class WhirlpoolSwimmerCurrent {
    active = false;
    readonly influence: WhirlpoolInfluence = { forwardAcceleration: 0, lateralAcceleration: 0,
        yawAcceleration: 0, rollAcceleration: 0, intensity: 0, coreIntensity: 0, captureIntensity: 0,
        captureDrag: 0, whirlpoolId: -1, maxFlowSpeed: 0 };
    forwardDelta = 0;
    lateralDelta = 0;
    private forwardVelocity = 0;
    private lateralVelocity = 0;
    constructor(private readonly spawns: readonly WhirlpoolSpawn[], private readonly poolWidth: number,
        private readonly laneZ: number) {}
    matches(spawns: readonly WhirlpoolSpawn[], poolWidth: number, laneZ: number) {
        return this.spawns === spawns && this.poolWidth === poolWidth && this.laneZ === laneZ;
    }
    reset() {
        this.forwardVelocity = this.lateralVelocity = this.forwardDelta = this.lateralDelta = 0;
        resetWhirlpoolInfluence(this.influence);
    }
    advance(distance: number, lateralOffset: number, speed: number, heading: number, submerged: boolean, dt: number) {
        if (!Number.isFinite(dt) || dt <= 0) { this.forwardDelta = this.lateralDelta = 0; return; }
        const f = sampleWhirlpoolInfluence(distance, this.laneZ + lateralOffset, this.poolWidth, this.influence, this.spawns);
        const scale = submerged ? WHIRLPOOL_BRAWL_TUNING.submergedInfluenceScale : 1;
        f.yawAcceleration *= scale; f.rollAcceleration *= scale;
        const capture = Math.max(0, speed) * f.captureDrag * scale;
        const forward = f.forwardAcceleration * scale - Math.cos(heading) * capture;
        const lateral = f.lateralAcceleration * scale - Math.sin(heading) * capture;
        const tau = Math.max(.01, WHIRLPOOL_BRAWL_TUNING.flowDecaySeconds);
        const decay = Math.exp(-dt / tau), integral = tau * (1 - decay);
        const cap = Math.max(.1, f.maxFlowSpeed);
        // 常量水流的解析积分，避免以表现的 20Hz 或截断帧时计费。
        this.forwardDelta = clamp(this.forwardVelocity * integral + forward * tau * (dt - integral), cap * dt);
        this.lateralDelta = clamp(this.lateralVelocity * integral + lateral * tau * (dt - integral), cap * dt);
        this.forwardVelocity = clamp(this.forwardVelocity * decay + forward * integral, cap);
        this.lateralVelocity = clamp(this.lateralVelocity * decay + lateral * integral, cap);
    }
}
function clamp(value: number, cap: number) { return Math.max(-cap, Math.min(cap, value)); }
