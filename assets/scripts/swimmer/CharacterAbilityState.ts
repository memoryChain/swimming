import { abilityValue, CharacterAbilityId, validAbilityId } from '../core/CharacterAbilityConfig';

const boundedStateValue = (value: number, max: number) => Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0;

export interface CharacterAbilitySnapshot {
    depth: number;
    kickRemaining: number;
    stacks: number;
    idleRemaining: number;
}

// 每个 Motor 持有一个实例，无逐帧分配；四个状态量一起走 owner/房主权威快照。
export class CharacterAbilityState implements CharacterAbilitySnapshot {
    id: CharacterAbilityId = 'none';
    depth = 0;
    kickRemaining = 0;
    stacks = 0;
    idleRemaining = 0;
    private remote = false;
    private lastSnapshot: Readonly<CharacterAbilitySnapshot> | undefined;

    configure(id: CharacterAbilityId) {
        const next = validAbilityId(id);
        if (this.id === next) return;
        this.id = next;
        this.reset();
    }

    reset() {
        this.depth = this.kickRemaining = this.stacks = this.idleRemaining = 0;
        this.remote = false;
        this.lastSnapshot = undefined;
    }

    get infiniteStamina(): boolean { return this.id === 'exoskeleton'; }
    // 角色资格与临时状态分开，联机回放也必须遵守固有禁跳规则。
    get supportsDolphin(): boolean { return this.id !== 'exoskeleton' && this.id !== 'kickDive'; }
    get allowsDolphin(): boolean { return this.supportsDolphin && this.depth <= 0.001; }
    get ignoresSwimmers(): boolean {
        return this.id === 'kickDive' && this.depth >= Math.min(abilityValue('diverDepth', 0.1, 2), abilityValue('diverCollisionDepth', 0.05, 2));
    }
    get strokePower(): number {
        return this.id === 'powerKick' ? abilityValue('legStrokePower', 0.1, 2)
            : this.id === 'wallKick' ? abilityValue('wallStrokePower', 0.1, 2) : 1;
    }
    get perfectWidth(): number {
        return this.id === 'frogSense' ? abilityValue('frogPerfectWidth', 0.1, 3)
            : this.id === 'precision' ? abilityValue('ninjaPerfectWidth', 0.1, 3) : 1;
    }
    qualityReward(quality: number): number {
        if (this.id === 'frogSense' && quality >= 1) return abilityValue('frogPerfectReward', 0, 3);
        if (this.id === 'precision') return quality >= 1
            ? abilityValue('ninjaPerfectReward', 0, 3) : abilityValue('ninjaOtherReward', 0, 3);
        return 1;
    }
    get recoveryScale(): number { return this.id === 'catBalance' ? abilityValue('catRecovery', 1, 3) : 1; }

    kick() {
        if (!this.remote && this.id === 'kickDive') this.kickRemaining = abilityValue('diverKickHoldSeconds', 0.05, 2);
    }
    armStart() { if (!this.remote) this.kickRemaining = 0; }

    settle(quality: number, intervalSeconds: number) {
        if (this.remote || this.id !== 'perfectChain') return;
        this.stacks = quality >= 1 ? Math.min(this.stacks + 1, Math.floor(abilityValue('chainMaxStacks', 1, 10))) : 0;
        this.idleRemaining = this.stacks > 0
            ? Math.max(0.1, Math.min(10, (Number.isFinite(intervalSeconds) ? intervalSeconds : 0.5) * abilityValue('chainIdleCycles', 1, 5))) : 0;
    }

    tick(dt: number, armActive: boolean) {
        if (this.remote || !(dt > 0) || !Number.isFinite(dt)) return;
        if (this.id === 'perfectChain' && this.stacks > 0) {
            this.idleRemaining = Math.max(0, this.idleRemaining - dt);
            if (this.idleRemaining <= 0) this.stacks = 0;
        }
        if (this.id !== 'kickDive') return;
        if (armActive) this.kickRemaining = 0;
        // 跨过踢腿保持时限的大帧分段处理，避免帧率改变下潜距离。
        const downSeconds = Math.min(dt, this.kickRemaining);
        const maxDepth = abilityValue('diverDepth', 0.1, 2);
        this.depth = Math.min(maxDepth, this.depth + downSeconds * abilityValue('diverDescentSpeed', 0.1, 4));
        this.kickRemaining = Math.max(0, this.kickRemaining - dt);
        this.depth = Math.max(0, this.depth - (dt - downSeconds) * abilityValue('diverAscentSpeed', 0.1, 4));
    }

    // 脚本化跳水/转身接管位置；连击计时暂停，普通下潜不与其叠加。
    suspend() {
        // 远端阶段可能落后于 owner，不允许本地阶段覆盖已接收的权威深度。
        if (!this.remote) this.depth = this.kickRemaining = 0;
    }

    applySnapshot(state: Readonly<CharacterAbilitySnapshot> | undefined, remoteHuman: boolean) {
        this.remote = remoteHuman;
        if (!state || state === this.lastSnapshot) return;
        this.lastSnapshot = state;
        this.depth = this.id === 'kickDive' ? boundedStateValue(state.depth, abilityValue('diverDepth', 0.1, 2)) : 0;
        this.kickRemaining = this.id === 'kickDive' ? boundedStateValue(state.kickRemaining, 2) : 0;
        this.stacks = this.id === 'perfectChain' ? Math.floor(boundedStateValue(state.stacks, abilityValue('chainMaxStacks', 1, 10))) : 0;
        this.idleRemaining = this.stacks > 0 ? boundedStateValue(state.idleRemaining, 10) : 0;
    }
}
