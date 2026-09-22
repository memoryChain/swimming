import type { Node } from 'cc';
import type { Swimmer } from '../entity/Swimmer';
import type { NetRaceController } from '../net/NetRaceController';
import { DraftingModel, DRAFTING_SAMPLE_SECONDS, DRAFTING_TUNING } from './DraftingRules';
import { DraftingPresentation } from './DraftingPresentation';

export class DraftingController {
    readonly model: DraftingModel;
    private readonly view: DraftingPresentation;
    private elapsed = 0;
    private host = -1;
    private running = false;
    get active(): boolean { return this.running && DRAFTING_TUNING.enabled; }

    constructor(parent: Node, private readonly swimmers: readonly (Swimmer | null)[],
        private readonly localLane: number, private readonly net: NetRaceController | null, waterY: number) {
        this.model = new DraftingModel(swimmers.length);
        this.view = new DraftingPresentation(parent, this.model, waterY);
        for (let lane = 0; lane < swimmers.length; lane++) {
            const swimmer = swimmers[lane];
            if (swimmer) swimmer.motor.strokeCostScale = () => this.costScale(lane);
        }
    }

    update(dt: number, active: boolean): void {
        if (!active || !DRAFTING_TUNING.enabled) {
            if (this.running) this.reset();
            this.view.hide(); return;
        }
        this.running = true;
        const host = this.net?.activeHostPos ?? -1;
        if (host !== this.host) { this.reset(); this.host = host; this.running = true; }
        this.elapsed += Math.max(0, dt);
        if (this.elapsed < DRAFTING_SAMPLE_SECONDS) return;
        // 卡顿／后台恢复不能补出不存在的整段水纹。
        if (this.elapsed > 0.3) this.model.reset();
        const step = this.elapsed; this.elapsed = 0;
        for (let lane = 0; lane < this.swimmers.length; lane++) this.read(lane);
        this.model.step(step);
        for (let lane = 0; lane < this.swimmers.length; lane++) {
            const s = this.swimmers[lane];
            if (!s) continue;
            const owns = !this.net || lane === this.localLane || (!s.collisionRemoteHuman && this.net.isHost);
            if (owns) s.draftingSource = this.model.costScale(lane) < 1 ? this.model.source[lane] : -1;
            else if (!this.model.racers[lane].eligible) s.draftingSource = -1;
            // 本地玩家托管也消费此目标；远端真人输入始终不由本机 AI 接管。
            const target = !s.collisionRemoteHuman ? this.model.targetLane(lane) : -1;
            s.draftingTargetZ = target >= 0 ? this.model.racers[target].z : null;
            s.draftingTargetSpeed = target >= 0 ? this.model.racers[target].speed : 0;
        }
        this.view.update();
    }

    private read(lane: number): void {
        const s = this.swimmers[lane], r = this.model.racers[lane];
        if (!s) { r.eligible = false; return; }
        let distance = s.distance, lateral = s.netLateralOffset, heading = s.netHeading, speed = s.netSpeed;
        r.eligible = s.draftingEligible;
        if (this.net && lane !== this.localLane && (s.collisionRemoteHuman || !this.net.isHost)) {
            const entry = this.net.draftingSnapshot(lane, s.collisionRemoteHuman);
            if (!entry) { r.eligible = false; return; }
            distance = entry.distance; lateral = entry.lateral; heading = entry.heading; speed = entry.speed;
            r.eligible = r.eligible && !entry.finished && entry.draftingEligible === true;
        }
        const direction = s.courseLayout.directionAtDistance(distance);
        r.x = s.courseLayout.distanceToWorldX(distance); r.z = s.startPosition.z + lateral;
        r.dx = direction * Math.cos(heading); r.dz = Math.sin(heading);
        r.leg = Math.floor(Math.max(0, distance) / s.courseLayout.courseLength);
        r.speed = Math.max(0, speed); r.epoch = s.draftingEpoch;
    }

    private costScale(lane: number): number {
        if (!this.running || !DRAFTING_TUNING.enabled) return 1;
        // 房主可能在两次尾迹更新之间切换；起划也要撤销旧任期的确认。
        if (this.net && this.host !== this.net.activeHostPos) {
            this.reset(); this.host = this.net.activeHostPos;
            return 1;
        }
        const s = this.swimmers[lane];
        if (!s?.draftingEligible) return 1;
        // 客机 AI 的预测采用房主确认状态；远端真人的结算不进入本机体力模型。
        if (this.net && lane !== this.localLane && !this.net.isHost) {
            const e = this.net.draftingSnapshot(lane, s.collisionRemoteHuman);
            const source = e?.draftingSource ?? -1;
            if (!e?.draftingEligible || e.finished || !Number.isInteger(source)
                || source < 0 || source >= this.swimmers.length || source === lane) return 1;
            // 保留房主的空间判定，但已知离房、断流或离水不能继续批准新优惠。
            this.read(source);
            return this.model.racers[source].eligible
                ? 1 - Math.max(0, Math.min(0.5, DRAFTING_TUNING.energySavingRatio)) : 1;
        }
        this.read(lane);
        const source = this.model.source[lane];
        if (source >= 0) this.read(source);
        return this.model.costScale(lane);
    }

    reset(): void {
        this.model.reset(); this.elapsed = 0; this.running = false;
        for (const s of this.swimmers) if (s) { s.draftingSource = -1; s.draftingTargetZ = null; }
        this.view.hide();
    }
    dispose(): void {
        this.reset();
        for (const s of this.swimmers) if (s) s.motor.strokeCostScale = null;
        this.view.dispose();
    }
}
