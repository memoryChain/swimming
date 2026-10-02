import type { AISwimmerController } from '../entity/AISwimmerController';
import type { Swimmer } from '../entity/Swimmer';
import { AI_CHARACTER_STRATEGIES, AiCharacterStrategy } from './AiRaceConfig';
import type { BossPreset, BossRole } from './BossAiConfig';

export interface BossAiOrder {
    readonly style: AiCharacterStrategy; readonly role: BossRole;
    targetZ: number | null; preferKick: boolean; allowJump: boolean; phase: string;
}

/** 调试专用赛事战术层，只产生输入意图；不改身体、资源、速度或判定。 */
export class BossAiDirector {
    readonly orders: BossAiOrder[];
    phase: 'rest' | 'prepare' | 'press' = 'rest';
    pressureSamples = 0;
    contactBreaks = 0;
    diveDecisions = 0;
    readonly pressureBySlot: number[];
    private readonly _withdrawUntil: number[];
    private _running = false;
    private _decisionClock = 0;
    private _clock = 0;
    private _phaseClock = 0;
    private readonly _selected: number[] = [];
    private _lastSelected = -1;

    constructor(readonly preset: BossPreset, private readonly _player: Swimmer,
        private readonly _controllers: readonly AISwimmerController[]) {
        if (_controllers.length !== preset.roster.length) throw new Error('Boss阵容与战术席位不一致');
        this.pressureBySlot = preset.roster.map(() => 0);
        this._withdrawUntil = preset.roster.map(() => 0);
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
            return { style, role: s.role, targetZ: null, preferKick: false, allowJump: true, phase: '竞速' };
        });
        this.reset();
    }

    reset(): void {
        this.phase = 'rest'; this._clock = this._decisionClock = 0;
        this._phaseClock = Math.max(0, this.preset.restSeconds - 2);
        this._selected.length = 0; this._lastSelected = -1;
        this._running = false;
        this.pressureSamples = this.contactBreaks = this.diveDecisions = 0;
        this.pressureBySlot.fill(0); this._withdrawUntil.fill(0);
        this.clearOrders();
    }

    update(dt: number): void {
        if (!(dt > 0) || !Number.isFinite(dt)) return;
        if (!this._player.isRacing) {
            if (this._running) { this.clearOrders(); this._selected.length = 0; this._running = false; }
            return;
        }
        this._running = true;
        this._clock += dt; this._phaseClock += dt; this._decisionClock += dt;
        if (this._decisionClock + 1e-8 < 0.25) return;
        this._decisionClock %= 0.25;
        this.clearOrders();
        const p = this._player;
        const wall = p.courseLayout.nextInternalTurnDistance(p.distance, this.preset.distance) - p.distance;
        const unsafe = p.isFlipTurning || p.isDolphinJumpActive || p.isUnderwater || p.motor.needsCollisionRecovery
            || wall < 4 || Math.abs(p.node.position.z) > p.courseLayout.poolWidth * 0.5 - 1.5;
        let contact = false;
        for (let i = 0; i < this._selected.length; i++) {
            const b = this._controllers[this._selected[i]].swimmer;
            if (b.isCollisionActive && b.motor.needsCollisionRecovery) contact = true;
        }
        if ((unsafe || contact) && this.phase !== 'rest') {
            this.phase = 'rest'; this._phaseClock = 0;
            if (contact) this.contactBreaks++;
            // 先让接触后的双方恢复，拉开意图也仍需真实转向。
            this.withdrawSelected();
        }
        const wallWindow = this.preset.policy !== 'wall' || wall <= 12;
        if (!unsafe && wallWindow && this.preset.pressureCount > 0 && p.distance < this.preset.distance - 20) {
            if (this.phase === 'rest' && this._phaseClock >= this.preset.restSeconds) {
                this.selectNearby();
                if (this._selected.length) { this.phase = 'prepare'; this._phaseClock = 0; }
            } else if (this.phase === 'prepare' && this._phaseClock >= this.preset.prepareSeconds) {
                this.phase = 'press'; this._phaseClock = 0;
            } else if (this.phase === 'press' && this._phaseClock >= this.preset.pressSeconds) {
                this.phase = 'rest'; this._phaseClock = 0;
                this.withdrawSelected();
            }
        } else if (this.phase !== 'rest') {
            this.phase = 'rest'; this._phaseClock = 0; this.withdrawSelected();
        }
        for (let i = 0; i < this._selected.length; i++) {
            const index = this._selected[i], b = this._controllers[index].swimmer, o = this.orders[index];
            // 已经靠近的队员允许真实偏航，不因转向动作本身不断取消再发起。
            if (!this.canAssist(index, false) || unsafe || this.phase === 'rest') continue;
            const side = b.node.position.z >= p.node.position.z ? 1 : -1;
            const offset = this.phase === 'prepare' ? 1.8 : this.preset.policy === 'endurance' ? 1.1 : i === 0 ? 0.1 : 0.9;
            o.targetZ = this.safeZ(p.node.position.z + side * offset);
            o.allowJump = false; o.phase = this.phase === 'prepare' ? '靠近预备' : '协作争位';
            if (this.phase === 'press') { this.pressureSamples++; this.pressureBySlot[index]++; }
        }
        for (let i = 0; i < this.orders.length; i++) if (this._withdrawUntil[i] > this._clock) this.setAway(i);
        this.routePolicies(unsafe);
        this.separateFriends();
    }

    private clearOrders(): void {
        for (const o of this.orders) { o.targetZ = null; o.preferKick = false; o.allowJump = true; o.phase = '竞速'; }
    }
    private safeZ(z: number): number {
        const half = this._player.courseLayout.poolWidth * 0.5 - 1.2;
        return Math.max(-half, Math.min(half, z));
    }
    private canAssist(index: number, recruiting = true): boolean {
        const c = this._controllers[index], b = c.swimmer, p = this._player;
        return b.node.active && b.isRacing && !c.remoteDriven && !b.isFlipTurning && !b.isDolphinJumpActive
            && !b.isUnderwater && !b.motor.needsCollisionRecovery && b.raceDirection === p.raceDirection
            && Math.abs(b.node.position.x - p.node.position.x) < 5
            && Math.abs(b.distance - p.distance) < 6 && (!recruiting || Math.abs(b.steeringHeadingRatio) < 0.3)
            && (b.motor.ability.infiniteStamina || (c.condition?.energy ?? c.energyTotal) > Math.max(12, c.energyTotal * 0.18));
    }
    private selectNearby(): void {
        this._selected.length = 0;
        for (let n = 0; n < this.preset.pressureCount; n++) {
            let best = -1, score = Infinity;
            for (let i = 0; i < this._controllers.length; i++) {
                const role = this.preset.roster[i].role;
                const eligible = role === 'guard' || (this.preset.policy === 'allstar' && role === 'wall'
                    && this._player.courseLayout.nextInternalTurnDistance(this._player.distance, this.preset.distance) - this._player.distance <= 12);
                if (!eligible || this._selected.indexOf(i) >= 0 || !this.canAssist(i)) continue;
                const b = this._controllers[i].swimmer;
                const first = this._selected.length ? this._controllers[this._selected[0]].swimmer : null;
                const sameSide = first && (first.node.position.z - this._player.node.position.z)
                    * (b.node.position.z - this._player.node.position.z) >= 0;
                const metric = Math.abs(b.node.position.x - this._player.node.position.x)
                    + Math.abs(b.node.position.z - this._player.node.position.z) * 0.4
                    + (i === this._lastSelected ? 2 : 0) + (sameSide ? 10 : 0);
                if (metric < score) { best = i; score = metric; }
            }
            if (best >= 0) this._selected.push(best);
        }
        if (this._selected.length) this._lastSelected = this._selected[0];
    }
    private setAway(index: number): void {
        const b = this._controllers[index].swimmer, p = this._player;
        if (!b.isRacing || this._controllers[index].remoteDriven || b.raceDirection !== p.raceDirection
            || b.isFlipTurning || b.isUnderwater || b.isDolphinJumpActive
            || Math.abs(b.node.position.x - p.node.position.x) > 6 || b.motor.needsCollisionRecovery) return;
        const side = b.node.position.z >= p.node.position.z ? 1 : -1;
        this.orders[index].targetZ = this.safeZ(p.node.position.z + side * 2.2);
        this.orders[index].phase = '拉开换班';
    }
    private withdrawSelected(): void {
        for (const index of this._selected) this._withdrawUntil[index] = this._clock + 2;
        this._selected.length = 0;
    }
    private routePolicies(unsafe: boolean): void {
        for (let i = 0; i < this.orders.length; i++) {
            const o = this.orders[i], c = this._controllers[i], b = c.swimmer;
            if (!b.isRacing || c.remoteDriven) continue;
            if (this.preset.policy === 'dive' || this.preset.policy === 'allstar') {
                const dx = Math.abs(b.node.position.x - this._player.node.position.x);
                const wave = Math.floor(this._clock / 2) % 4;
                const dive = b.motor.ability.id === 'kickDive' && (o.role === 'diver' || this.preset.policy === 'dive');
                if (dive && !unsafe && dx < 6 && Math.abs(b.distance - this._player.distance) < 7
                    && (wave === i % 3 || b.motor.ability.ignoresSwimmers) && !b.motor.needsCollisionRecovery) {
                    // 最长约两秒的轮流潜航，之后通过真实手划自然上浮。
                    o.preferKick = wave === i % 3; o.phase = o.preferKick ? '潜航让线' : '上浮竞速';
                    if (o.preferKick) { this.diveDecisions++; o.targetZ = this.safeZ(b.node.position.z + (i % 2 ? 1 : -1) * 0.8); }
                }
                if (o.role === 'hopper') { o.allowJump = wave === 3 || dx > 6; o.phase = o.allowJump ? '小跳穿行' : '积气待机'; }
            }
            if (this.preset.policy === 'combo') o.phase = b.heartRate > 165 ? '心率恢复' : '保护连击';
            if (this.preset.policy === 'duel') o.phase = this.preset.distance - b.distance < 35 ? '末程发力' : '稳准配速';
            if (this.preset.policy === 'endurance' && o.role === 'leader') o.phase = '呼吸配速';
            if (this.preset.policy === 'wall' && (o.role === 'wall' || o.role === 'leader')) o.phase = '折返追击';
            if (this.preset.policy === 'allstar' && o.role === 'chaser') {
                o.phase = this.preset.distance - b.distance <= 55 ? '末程追逐' : '积力追赶';
            }
        }
    }
    private separateFriends(): void {
        // 未参与施压的队员避开队友，不赋予友军碰撞免疫。
        for (let i = 0; i < this.orders.length; i++) {
            const o = this.orders[i], b = this._controllers[i].swimmer;
            if (o.targetZ !== null || !b.isRacing || this._controllers[i].remoteDriven || b.isUnderwater
                || b.isFlipTurning || b.isDolphinJumpActive || b.motor.needsCollisionRecovery) continue;
            for (let j = 0; j < i; j++) {
                const other = this._controllers[j].swimmer;
                if (!other.isRacing || other.isUnderwater || other.raceDirection !== b.raceDirection
                    || Math.abs(other.node.position.x - b.node.position.x) > 2
                    || Math.abs(other.node.position.z - b.node.position.z) > 1.4) continue;
                o.targetZ = this.safeZ(b.node.position.z + (b.node.position.z >= other.node.position.z ? 1 : -1) * 1.5);
                break;
            }
        }
    }
}
