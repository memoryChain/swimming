import type { AISwimmerController } from '../entity/AISwimmerController';
import type { Swimmer } from '../entity/Swimmer';
import { AI_CHARACTER_STRATEGIES, AiCharacterStrategy } from './AiRaceConfig';
import type { BossPreset, BossRole } from './BossAiConfig';

export type BossTeamTask = 'race' | 'lead' | 'intercept' | 'cover' | 'relay' | 'reserve' | 'yield' | 'dive' | 'pass';
export interface BossAiOrder {
    readonly style: AiCharacterStrategy; readonly role: BossRole;
    task: BossTeamTask; partnerSlot: number;
    targetZ: number | null; targetDistance: number | null; targetSpeed: number | null;
    preferKick: boolean; allowJump: boolean; phase: string;
}

/** 调试专用团队指挥：先统一分工、路线和配速，再按真实到位/技能状态推进战术。 */
export class BossAiDirector {
    readonly orders: BossAiOrder[];
    phase: 'rest' | 'prepare' | 'press' | 'release' = 'rest';
    pressureSamples = 0;
    contactBreaks = 0;
    diveDecisions = 0;
    assemblies = 0;
    engagements = 0;
    handoffs = 0;
    abortedAssemblies = 0;
    pairedPressureSamples = 0;
    divePassSamples = 0;
    formationSamples = 0;
    readonly pressureBySlot: number[];
    readonly assignmentBySlot: number[];
    private readonly _usage: number[];
    private readonly _cooldown: number[];
    private readonly _sides: number[];
    private readonly _homeZ: number[];
    private readonly _selected: number[] = [];
    private _relay = -1;
    private _nextLead = -1;
    private _lastEngagedLead = -1;
    private _diver = -1;
    private _hopper = -1;
    private _leader = -1;
    private _running = false;
    private _decisionClock = 0;
    private _clock = 0;
    private _phaseClock = 0;
    private _attackZ = 0;
    private _playerSpeed = 0;
    private _teamRouteZ = 0;
    private _diveRouteZ = 0;

    constructor(readonly preset: BossPreset, private readonly _player: Swimmer,
        private readonly _controllers: readonly AISwimmerController[]) {
        if (_controllers.length !== preset.roster.length) throw new Error('Boss阵容与战术席位不一致');
        this.pressureBySlot = preset.roster.map(() => 0);
        this.assignmentBySlot = preset.roster.map(() => 0);
        this._usage = preset.roster.map(() => 0);
        this._cooldown = preset.roster.map(() => 0);
        this._sides = preset.roster.map((_, i) => _controllers[i].swimmer.node.position.z >= _player.node.position.z ? 1 : -1);
        this._homeZ = _controllers.map(c => c.swimmer.node.position.z);
        this.orders = preset.roster.map(s => {
            const style = { ...AI_CHARACTER_STRATEGIES[s.characterId] };
            style.contest = false;
            if (preset.policy === 'duel') { style.heartTarget = 128; style.heartRecovery = 104; style.sprint200 = 35; }
            if (preset.policy === 'combo') { style.heartTarget = 150; style.heartRecovery = 122; style.kickBlock = 1; style.sprint400 = 48; }
            if (preset.policy === 'endurance' && s.role === 'leader') { style.budgetExponent = 0.8; style.sprint400 = 46; }
            if (preset.policy === 'wall' && s.characterId === 'cartonSwimmer12') { style.sprint200 = 35; style.kickBlock = 1.2; }
            if (preset.policy === 'allstar' && s.role === 'chaser') {
                style.sprint400 = 55;
                if (s.characterId === 'cartonSwimmer10') { style.heartTarget = 128; style.heartRecovery = 104; }
                if (s.characterId === 'cartonSwimmer14') { style.heartTarget = 150; style.heartRecovery = 122; style.kickBlock = 1; }
            }
            return { style, role: s.role, task: 'race', partnerSlot: -1,
                targetZ: null, targetDistance: null, targetSpeed: null, preferKick: false, allowJump: true, phase: '竞速' };
        });
        this.reset();
    }

    reset(): void {
        this.phase = 'rest'; this._clock = this._decisionClock = 0;
        this._phaseClock = Math.max(0, this.preset.restSeconds - 2);
        this._selected.length = 0; this._relay = this._nextLead = this._diver = this._hopper = -1;
        this._lastEngagedLead = -1;
        this._running = false; this._playerSpeed = this._player.currentSpeed;
        this._leader = this.preset.roster.findIndex(s => s.role === 'leader');
        const leader = this._controllers[this._leader]?.swimmer;
        this._teamRouteZ = this.safeZ(leader?.node.position.z ?? 0);
        this.pressureSamples = this.contactBreaks = this.diveDecisions = this.assemblies = this.engagements = 0;
        this.handoffs = this.abortedAssemblies = this.pairedPressureSamples = this.divePassSamples = this.formationSamples = 0;
        this.pressureBySlot.fill(0); this.assignmentBySlot.fill(0); this._usage.fill(0); this._cooldown.fill(0);
        for (let i = 0; i < this._sides.length; i++) this._sides[i] = this._controllers[i].swimmer.node.position.z >= this._player.node.position.z ? 1 : -1;
        this.clearOrders();
    }

    update(dt: number): void {
        if (!(dt > 0) || !Number.isFinite(dt)) return;
        if (!this._player.isRacing) {
            if (this._running) { this.clearOrders(); this._selected.length = 0; this._running = false; }
            return;
        }
        this._running = true; this._clock += dt; this._phaseClock += dt; this._decisionClock += dt;
        if (this._decisionClock + 1e-8 < 0.25) return;
        this._decisionClock %= 0.25;
        this._playerSpeed += (this._player.currentSpeed - this._playerSpeed) * 0.25;
        this.clearOrders();
        if (this._controllers.length === 1) { this.soloPolicy(); return; }
        const p = this._player;
        const nextWall = p.courseLayout.nextInternalTurnDistance(p.distance, this.preset.distance);
        const wall = (nextWall ?? this.preset.distance) - p.distance;
        const unsafe = p.isFlipTurning || p.motor.needsCollisionRecovery
            || wall < 4 || Math.abs(p.node.position.z) > p.courseLayout.poolWidth * 0.5 - 1.5;
        if ((p.isDolphinJumpActive || p.isUnderwater) && this.phase === 'press' && this.preset.policy !== 'dive') {
            // 玩家暂时离开水面时保持接应阵型，重新就位后再施压，不能攻击空中或水下玩家。
            this.phase = 'prepare'; this._phaseClock = 0;
        }
        const escaped = this.preset.policy !== 'dive' && (this.phase === 'prepare' || this.phase === 'press')
            && Math.abs(p.node.position.z - this._attackZ) > 3;
        let contact = false;
        let unavailable = false;
        for (const index of this._selected) {
            const b = this._controllers[index].swimmer;
            if (b.isCollisionActive && b.motor.needsCollisionRecovery) contact = true;
            if (!this.available(index)) unavailable = true;
        }
        if ((unsafe || escaped || contact || unavailable) && (this.phase === 'prepare' || this.phase === 'press')) {
            if (contact) this.contactBreaks++;
            this.beginRelease();
        }
        this.assignTeamRoutes(unsafe);
        if (!unsafe && this.phase === 'rest' && this._nextLead >= 0 && this.available(this._nextLead)) {
            this.setTask(this._nextLead, 'relay', p.node.position.z + this._sides[this._nextLead] * this.preset.team.stagingWidth,
                this.preset.team.forwardGap, '接班队员保持接应', this._lastEngagedLead);
        }
        if (this.preset.policy === 'dive') this.coordinateDive(unsafe);
        else this.coordinatePressure(unsafe, wall);
        if (!unsafe) this.coordinateSpecialists();
        this.assignRelease();
        this.resolveFriendlyRoutes();
        for (let i = 0; i < this.orders.length; i++) {
            const o = this.orders[i], b = this._controllers[i].swimmer;
            if (o.task !== 'race') this.assignmentBySlot[i]++;
            if (o.targetDistance !== null && o.targetZ !== null
                && Math.abs(b.distance - o.targetDistance) <= 2.5 && Math.abs(b.node.position.z - o.targetZ) <= 1.2) this.formationSamples++;
        }
    }

    private clearOrders(): void {
        for (const o of this.orders) {
            o.task = 'race'; o.partnerSlot = -1; o.targetZ = o.targetDistance = o.targetSpeed = null;
            o.preferKick = false; o.allowJump = true; o.phase = '竞速';
        }
    }
    private safeZ(z: number): number {
        const half = this._player.courseLayout.poolWidth * 0.5 - 1.2;
        return Math.max(-half, Math.min(half, z));
    }
    private available(index: number, range = this.preset.team.joinRange): boolean {
        const c = this._controllers[index], b = c.swimmer;
        return b.node.active && b.isRacing && !c.remoteDriven && !b.isFlipTurning && !b.isDolphinJumpActive
            && !b.motor.needsCollisionRecovery && b.raceDirection === this._player.raceDirection
            && Math.abs(b.distance - this._player.distance) < range
            && Math.abs(b.node.position.x - this._player.node.position.x) < range
            && (b.motor.ability.infiniteStamina || (c.condition?.energy ?? c.energyTotal) > Math.max(8, c.energyTotal * 0.12));
    }
    private setTask(index: number, task: BossTeamTask, z: number, gap: number | null, phase: string, partner = -1): void {
        if (!this.available(index)) return;
        const b = this._controllers[index].swimmer, o = this.orders[index];
        o.task = task; o.partnerSlot = partner; o.targetZ = this.safeZ(z); o.phase = phase;
        if (gap !== null) {
            o.targetDistance = this._player.distance + gap;
            o.targetSpeed = Math.max(0.4, this._playerSpeed
                + Math.max(-1.1, Math.min(1.1, (o.targetDistance - b.distance) * this.preset.team.paceResponse)));
            o.allowJump = false;
        }
    }
    private assignTeamRoutes(unsafe: boolean): void {
        const p = this._player;
        for (let i = 0; i < this.orders.length; i++) {
            const o = this.orders[i], b = this._controllers[i].swimmer;
            if (!this.available(i)) continue;
            if (this.preset.distance - b.distance <= 25 || this.preset.distance - p.distance <= 20) continue;
            if (unsafe) {
                this.setTask(i, 'yield', b.node.position.z + this._sides[i] * 1.2, null, '全队让出恢复线');
                continue;
            }
            if (i === this._leader) {
                this.setTask(i, 'lead', this._teamRouteZ, null, this.preset.policy === 'endurance' ? '领队呼吸配速' : '领队沿通道竞速');
            } else if (o.role === 'guard') {
                // 候补保持自己的巡航通道，接到集结令才靠近。全员挤向玩家同侧会在池边互撞。
                this.setTask(i, 'reserve', this._homeZ[i],
                    null, '侧翼掩护待命', this._leader);
            } else {
                this.setTask(i, 'yield', this._homeZ[i], null,
                    o.role === 'wall' ? '折返侧翼接应' : o.role === 'chaser' ? '王牌侧翼蓄力' : '队友让出竞速通道', this._leader);
            }
            if (this.preset.distance - b.distance <= 30 && o.role !== 'guard') {
                o.allowJump = true; o.phase = '末程沿通道冲刺';
            }
        }
    }
    private guardEligible(index: number, wall: number): boolean {
        const role = this.orders[index].role;
        const wallAssist = role === 'wall' && ((this.preset.policy === 'allstar')
            || (this.preset.policy === 'wall' && (wall <= this.preset.team.wallAssemblyRange
                || this._player.distance % this._player.courseLayout.courseLength < 18)));
        return (role === 'guard' || wallAssist || (this.preset.policy === 'allstar' && role === 'chaser'))
            && this.available(index) && !this._controllers[index].swimmer.isUnderwater && this._cooldown[index] <= this._clock;
    }
    private bestGuard(wall: number, exclude: number, side = 0): number {
        let best = -1, metric = Infinity;
        for (let i = 0; i < this.orders.length; i++) {
            if (i === exclude || this._selected.indexOf(i) >= 0 || !this.guardEligible(i, wall)) continue;
            const b = this._controllers[i].swimmer;
            const currentSide = b.node.position.z >= this._player.node.position.z ? 1 : -1;
            const score = Math.abs(b.distance - this._player.distance) * 0.7
                + Math.abs(b.node.position.z - this._player.node.position.z) * 0.6 + this._usage[i] * 2
                + (side && currentSide !== side ? 1 : 0) - (i === this._nextLead ? 4 : 0);
            if (score < metric) { best = i; metric = score; }
        }
        return best;
    }
    private ready(index: number, range = 7): boolean {
        const o = this.orders[index], b = this._controllers[index].swimmer;
        return this.available(index, range) && o.targetZ !== null && o.targetDistance !== null
            && Math.abs(b.node.position.z - o.targetZ) <= 1.2 && Math.abs(b.distance - o.targetDistance) <= 2.5
            && Math.abs(b.steeringHeadingRatio) < 0.65;
    }
    private coordinatePressure(unsafe: boolean, wall: number): void {
        const p = this._player, count = this.preset.pressureCount;
        const outOfWall = p.distance > 8 && p.distance % p.courseLayout.courseLength < 18;
        const window = this.preset.policy !== 'wall' || wall <= this.preset.team.wallPressRange || outOfWall;
        // 折返侧翼先在池段中段集结，进入出墙/靠墙窗口才进攻，避免集合尚未完成就撞上折返。
        const assemblyWindow = window || (this.preset.policy === 'wall' && wall <= this.preset.team.wallAssemblyRange);
        if (unsafe || !assemblyWindow || count === 0 || p.distance >= this.preset.distance - 20) {
            if (this.phase === 'prepare' || this.phase === 'press') this.beginRelease();
            return;
        }
        if (this.phase === 'rest' && this._phaseClock >= this.preset.restSeconds) {
            this._selected.length = 0;
            if (this._nextLead >= 0 && this.guardEligible(this._nextLead, wall)) this._selected.push(this._nextLead);
            for (let n = this._selected.length; n < count; n++) {
                const first = this._controllers[this._selected[0]]?.swimmer;
                const side = first ? -(first.node.position.z >= p.node.position.z ? 1 : -1) : 0;
                const index = this.bestGuard(wall, -1, side);
                if (index >= 0) this._selected.push(index);
            }
            if (this._selected.length) {
                this._attackZ = p.node.position.z;
                for (const index of this._selected) this._sides[index] = this._controllers[index].swimmer.node.position.z >= this._attackZ ? 1 : -1;
                this.phase = 'prepare'; this._phaseClock = 0; this.assemblies++;
            }
        }
        if (this.phase !== 'prepare' && this.phase !== 'press') return;
        let allReady = true, close = 0;
        for (let n = 0; n < this._selected.length; n++) {
            const index = this._selected[n], partner = this._selected[n ? 0 : 1] ?? this._leader;
            const side = this._sides[index];
            const preparing = this.phase === 'prepare';
            const staging = this.preset.team.stagingWidth + (n && side === this._sides[this._selected[0]] ? 1.1 : 0);
            this.setTask(index, n === 0 ? 'intercept' : 'cover', this._attackZ + side * (preparing ? staging : n === 0 ? 0.15 : 1.05),
                n === 0 ? this.preset.team.forwardGap : -0.4, preparing ? '协同集合就位' : n === 0 ? '前卫拦截' : '侧翼协作封线', partner);
            if (!this.ready(index)) allReady = false;
            if (this.phase === 'press' && this.available(index, 7)) {
                this.pressureSamples++; this.pressureBySlot[index]++;
                const b = this._controllers[index].swimmer;
                if (Math.abs(b.node.position.x - p.node.position.x) < 3 && Math.abs(b.node.position.z - p.node.position.z) < 2.2) close++;
            }
        }
        if (close >= 2) this.pairedPressureSamples++;
        if (this._relay < 0 || !this.guardEligible(this._relay, wall) || this._selected.indexOf(this._relay) >= 0) {
            this._relay = this.bestGuard(wall, -1);
            if (this._relay >= 0) this._sides[this._relay] = this._controllers[this._relay].swimmer.node.position.z >= p.node.position.z ? 1 : -1;
        }
        if (this._relay >= 0) this.setTask(this._relay, 'relay', p.node.position.z + this._sides[this._relay] * this.preset.team.stagingWidth,
            -3.6, '接班队员提前就位', this._selected[0]);
        if (this.phase === 'prepare' && window && allReady && !p.isDolphinJumpActive && !p.isUnderwater
            && this._phaseClock >= this.preset.prepareSeconds) {
            if (this._selected[0] === this._nextLead && this._lastEngagedLead >= 0
                && this._lastEngagedLead !== this._selected[0]) this.handoffs++;
            this._lastEngagedLead = this._selected[0];
            this._nextLead = -1; this.phase = 'press'; this._phaseClock = 0; this.engagements++;
            for (const index of this._selected) this._usage[index]++;
        } else if (this.phase === 'prepare' && this._phaseClock >= this.preset.team.assemblySeconds) {
            this.abortedAssemblies++; this.beginRelease();
        } else if (this.phase === 'press' && this._phaseClock >= this.preset.pressSeconds) this.beginRelease();
    }
    private coordinateDive(unsafe: boolean): void {
        const p = this._player;
        if (unsafe || p.distance >= this.preset.distance - 25) return;
        if (this.phase === 'rest' && this._phaseClock >= this.preset.restSeconds) {
            let diver = -1, hopper = -1, score = Infinity;
            for (let i = 0; i < this.orders.length; i++) {
                if (!this.available(i) || this._cooldown[i] > this._clock) continue;
                const b = this._controllers[i].swimmer;
                if (b.motor.ability.id !== 'kickDive') continue;
                for (let j = 0; j < this.orders.length; j++) {
                    if (this.orders[j].role !== 'hopper' || !this.available(j) || this._cooldown[j] > this._clock) continue;
                    const other = this._controllers[j].swimmer;
                    const metric = Math.abs(b.distance - other.distance) + Math.abs(b.node.position.z - other.node.position.z) * 0.7
                        + Math.abs(b.distance - p.distance) * 0.2 + (this._usage[i] + this._usage[j]) * 1.5;
                    if (metric < score) { score = metric; diver = i; hopper = j; }
                }
            }
            if (diver >= 0 && hopper >= 0) {
                this._diver = diver; this._hopper = hopper; this._selected.length = 0; this._selected.push(diver, hopper);
                this._attackZ = p.node.position.z; this.phase = 'prepare'; this._phaseClock = 0; this.assemblies++;
                this._diveRouteZ = this.safeZ((this._controllers[diver].swimmer.node.position.z + this._controllers[hopper].swimmer.node.position.z) * 0.5);
            }
        }
        if (this.phase !== 'prepare' && this.phase !== 'press') return;
        if (!this.available(this._diver) || !this.available(this._hopper)) { this.beginRelease(); return; }
        const diver = this._controllers[this._diver].swimmer;
        const hopper = this._controllers[this._hopper].swimmer;
        const lane = this._diveRouteZ;
        const anchor = (diver.distance + hopper.distance) * 0.5 - p.distance;
        this.setTask(this._diver, 'dive', lane, anchor + 1.3, '潜航先锋就位', this._hopper);
        this.setTask(this._hopper, 'pass', lane - this._sides[this._diver] * 2.2, anchor - 1.3, '跳跃队员等候潜航', this._diver);
        const d = this.orders[this._diver], h = this.orders[this._hopper];
        const speed = (diver.currentSpeed + hopper.currentSpeed) * 0.5;
        d.targetSpeed = Math.max(0.4, speed + (diver.distance < hopper.distance + 1.3 ? 0.5 : -0.5));
        h.targetSpeed = Math.max(0.4, speed + (hopper.distance < diver.distance - 1.3 ? 0.5 : -0.5));
        if (this.phase === 'prepare' && (this.ready(this._diver, this.preset.team.joinRange) || diver.isUnderwater)
            && this.ready(this._hopper, this.preset.team.joinRange)) {
            d.preferKick = true; d.phase = '先锋下潜开路'; this.diveDecisions++;
            if (diver.isUnderwater) { this.phase = 'press'; this._phaseClock = 0; this.engagements++; this._usage[this._diver]++; this._usage[this._hopper]++; }
        }
        if (this.phase === 'press') {
            d.preferKick = true; d.phase = '水下为队友让线';
            h.allowJump = diver.isUnderwater; h.targetDistance = h.targetSpeed = null; h.targetZ = lane; h.phase = '借潜航空隙穿行';
            if (diver.isUnderwater && Math.abs(diver.distance - this._controllers[this._hopper].swimmer.distance) < 6) this.divePassSamples++;
            if (!diver.isUnderwater || this._phaseClock >= 2) this.beginRelease();
        } else if (this._phaseClock >= this.preset.team.assemblySeconds) { this.abortedAssemblies++; this.beginRelease(); }
    }
    private beginRelease(): void {
        if (this._relay >= 0 && this.available(this._relay, 7)) {
            const b = this._controllers[this._relay].swimmer;
            if (Math.abs(b.node.position.z - this.safeZ(this._player.node.position.z + this._sides[this._relay] * this.preset.team.stagingWidth)) < 2) this._nextLead = this._relay;
        }
        for (const index of this._selected) this._cooldown[index] = this._clock + this.preset.restSeconds + this.preset.team.releaseSeconds;
        this.phase = 'release'; this._phaseClock = 0;
    }
    private assignRelease(): void {
        if (this.phase !== 'release') return;
        const p = this._player;
        for (const index of this._selected) this.setTask(index, 'yield', p.node.position.z + this._sides[index] * this.preset.team.reserveWidth,
            -3, '撤出阵型让位接班', this._nextLead);
        if (this._nextLead >= 0) this.setTask(this._nextLead, 'relay', p.node.position.z + this._sides[this._nextLead] * this.preset.team.stagingWidth,
            -0.5, '接应撤退队友', this._selected[0] ?? -1);
        if (this._phaseClock >= this.preset.team.releaseSeconds) {
            this._selected.length = 0; this._relay = this._diver = this._hopper = -1;
            // 撤退属于原有休整窗口；接班者在这段时间保持集结，不能重新退回散游。
            this.phase = 'rest'; this._phaseClock = this.preset.team.releaseSeconds;
        }
    }
    private resolveFriendlyRoutes(): void {
        // 指挥层预约路线；无碰撞免疫。低优先级队员遇上拦截队、领队或同线队友时主动让位。
        for (let i = 0; i < this.orders.length; i++) {
            const o = this.orders[i], b = this._controllers[i].swimmer;
            if (!this.available(i) || b.isUnderwater || o.task === 'intercept' || o.task === 'cover' || o.task === 'dive' || o.task === 'pass') continue;
            for (let j = 0; j < this.orders.length; j++) {
                if (j === i || !this.available(j)) continue;
                const other = this._controllers[j].swimmer, owner = this.orders[j];
                if (other.isUnderwater || Math.abs(other.distance - b.distance) > 3) continue;
                if (o.targetDistance !== null && owner.targetDistance !== null && Math.abs(o.targetDistance - owner.targetDistance) > 3) continue;
                const priority = owner.task === 'intercept' || owner.task === 'cover' || owner.task === 'lead' || (owner.task === o.task && j < i);
                if (!priority || owner.targetZ === null || o.targetZ === null || Math.abs(owner.targetZ - o.targetZ) >= 2) continue;
                o.targetZ = this.safeZ(owner.targetZ + this._sides[i] * 2.4);
                if (Math.abs(other.node.position.z - b.node.position.z) < 1.8) {
                    o.targetDistance = other.distance - 2.5; o.targetSpeed = Math.max(0.4, other.currentSpeed - 0.5);
                    o.allowJump = false;
                }
            }
        }
    }
    private coordinateSpecialists(): void {
        if (this.preset.policy !== 'allstar' && this.preset.policy !== 'wall') return;
        const leader = this._controllers[this._leader]?.swimmer;
        if (!leader?.isRacing) return;
        // 王牌的技能窗口由同一队伍路线决定；潜航先让领队通过，折返侧翼避开领队出墙线。
        for (let i = 0; i < this.orders.length; i++) {
            if (i === this._leader || !this.available(i)) continue;
            const o = this.orders[i], b = this._controllers[i].swimmer;
            if (o.task === 'intercept' || o.task === 'cover') continue;
            if (o.role === 'diver') {
                let partner = -1, score = Infinity;
                for (let j = 0; j < this.orders.length; j++) {
                    if (j === i || !this.available(j)) continue;
                    const other = this._controllers[j].swimmer, role = this.orders[j].role;
                    if (role !== 'leader' && role !== 'chaser' && this.orders[j].task !== 'intercept') continue;
                    const metric = Math.abs(other.distance - b.distance) + Math.abs(other.node.position.z - b.node.position.z);
                    if (metric < score && Math.abs(other.distance - b.distance) < 5) { partner = j; score = metric; }
                }
                if (partner < 0) continue;
                const runner = this._controllers[partner].swimmer;
                o.task = 'dive'; o.partnerSlot = partner; o.targetZ = this.safeZ(runner.node.position.z);
                if (Math.abs(b.node.position.z - runner.node.position.z) < 1.8 && b.distance >= runner.distance - 1) {
                    o.preferKick = true; o.allowJump = false; o.phase = '潜航为队友开路'; this.diveDecisions++;
                    if (b.isUnderwater) this.divePassSamples++;
                } else o.phase = '潜航王牌接近队友';
            }
            if (o.role === 'wall' && leader.distance % leader.courseLayout.courseLength < 12) {
                o.partnerSlot = this._leader; o.phase = '侧翼护送出墙';
                o.targetZ = this.safeZ(leader.node.position.z + this._sides[i] * 2.6);
            }
        }
    }
    private soloPolicy(): void {
        const b = this._controllers[0].swimmer;
        if (this._controllers[0].remoteDriven || !b.isRacing) return;
        this.orders[0].phase = this.preset.policy === 'combo'
            ? b.heartRate > 165 ? '心率恢复' : '保护连击'
            : this.preset.distance - b.distance < 35 ? '末程发力' : '稳准配速';
    }
}
