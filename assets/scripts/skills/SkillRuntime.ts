import type { PlayerCharacterId } from '../app/PlayerCharacterConfig';
import { Rating } from '../core/GameConstants';

// Pure per-swimmer ultimate state. Definitions live with the runtime so tuning,
// local prediction and network reconciliation use exactly the same rules.
export type UltimateSkillKind = 'instant' | 'charges' | 'pulses' | 'drag';

export type UltimateSkillDefinition = {
    characterId: PlayerCharacterId;
    id: string;
    name: string;
    kind: UltimateSkillKind;
    durationSeconds: number;
    maxCharges?: number;
    pulseCount?: number;
};

export const ULTIMATE_SKILL_BALANCE = {
    sharkImpulseSpeed: 1.05,
    sharkImpulseCapBonus: 0.42,
    fishDurationSeconds: 5,
    fishCharges: 3,
    fishBonusQualityAccelScale: 1,
    novaDurationSeconds: 2,
    novaPulseSpeed: 0.48,
    novaPulseCapBonus: 0.2,
    diverDurationSeconds: 5,
    diverSurfaceDragScale: 0.42,
    // Kept only so old saved tuning entries load harmlessly. Dedicated skills no
    // longer read these prototype fields.
    durationSeconds: 4,
    strokeAccelScale: 1.15,
    speedCapScale: 1.08,
};

const SKILL_DEFINITIONS: Record<PlayerCharacterId, UltimateSkillDefinition> = {
    muscleMan: { characterId: 'muscleMan', id: 'skill.shark.tailSlam', name: '鲨尾重击', kind: 'instant', durationSeconds: 0 },
    women2: { characterId: 'women2', id: 'skill.fish.rhythmLine', name: '律动水线', kind: 'charges', durationSeconds: 5, maxCharges: 3 },
    lowPolyHuman2: { characterId: 'lowPolyHuman2', id: 'skill.nova.waveChase', name: '踏浪追击', kind: 'pulses', durationSeconds: 2, pulseCount: 3 },
    diver: { characterId: 'diver', id: 'skill.diver.deepTrail', name: '深海航迹', kind: 'drag', durationSeconds: 5 },
};

const PULSE_RATIOS = [0, 0.325, 0.65];

export function getUltimateSkillDefinition(characterId: PlayerCharacterId | null | undefined): UltimateSkillDefinition {
    return SKILL_DEFINITIONS[characterId ?? 'muscleMan'];
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export class SkillRuntime {
    private _definition: UltimateSkillDefinition = SKILL_DEFINITIONS.muscleMan;
    private _remainingSeconds = 0;
    private _charges = 0;
    private _pulsesTriggered = 0;
    private _pendingImpulseCount = 0;

    get definition(): UltimateSkillDefinition { return this._definition; }
    get remainingSeconds(): number { return this._remainingSeconds; }
    get charges(): number { return this._charges; }
    get pulsesTriggered(): number { return this._pulsesTriggered; }
    get pulseCount(): number { return this._definition.pulseCount ?? 0; }
    get active(): boolean { return this._remainingSeconds > 0 || this._charges > 0; }
    get normalizedRemaining(): number {
        return clamp(this._remainingSeconds / Math.max(0.001, this.durationSeconds), 0, 1);
    }
    get durationSeconds(): number {
        switch (this._definition.kind) {
            case 'charges': return Math.max(0.001, ULTIMATE_SKILL_BALANCE.fishDurationSeconds);
            case 'pulses': return Math.max(0.001, ULTIMATE_SKILL_BALANCE.novaDurationSeconds);
            case 'drag': return Math.max(0.001, ULTIMATE_SKILL_BALANCE.diverDurationSeconds);
            default: return 0;
        }
    }
    get surfaceDragScale(): number {
        return this._definition.kind === 'drag' && this.active
            ? clamp(ULTIMATE_SKILL_BALANCE.diverSurfaceDragScale, 0.05, 1)
            : 1;
    }

    setDefinition(definition: UltimateSkillDefinition): void {
        if (this._definition.id === definition.id) return;
        this._definition = definition;
        this.reset();
    }

    reset(): void {
        this._remainingSeconds = 0;
        this._charges = 0;
        this._pulsesTriggered = 0;
        this._pendingImpulseCount = 0;
    }

    activate(): boolean {
        if (this.active) return false;
        switch (this._definition.kind) {
            case 'instant':
                this._pendingImpulseCount = 1;
                return true;
            case 'charges':
                this._remainingSeconds = this.durationSeconds;
                this._charges = Math.max(1, Math.round(ULTIMATE_SKILL_BALANCE.fishCharges));
                return true;
            case 'pulses':
                this._remainingSeconds = this.durationSeconds;
                this._pulsesTriggered = 1;
                this._pendingImpulseCount = 1;
                return true;
            case 'drag':
                this._remainingSeconds = this.durationSeconds;
                return true;
        }
    }

    // Timers always elapse. Pulses that occur in an ineligible phase are consumed
    // without an impulse, which is the intended "no pause, no make-up" behavior.
    tick(dt: number, canAffectSurface: boolean): void {
        if (!this.active || !Number.isFinite(dt) || dt <= 0) return;
        const previous = this._remainingSeconds;
        this._remainingSeconds = Math.max(0, previous - dt);
        if (this._definition.kind !== 'pulses') {
            if (this._remainingSeconds <= 0) this._charges = 0;
            return;
        }
        const duration = this.durationSeconds;
        const elapsed = duration - this._remainingSeconds;
        const max = Math.max(0, this._definition.pulseCount ?? 0);
        while (this._pulsesTriggered < max && elapsed + 1e-6 >= duration * PULSE_RATIOS[this._pulsesTriggered]) {
            this._pulsesTriggered += 1;
            if (canAffectSurface) this._pendingImpulseCount += 1;
        }
    }

    consumePendingImpulseCount(): number {
        const count = this._pendingImpulseCount;
        this._pendingImpulseCount = 0;
        return count;
    }

    // Returns true only for GOOD/PERFECT strokes while the finite rhythm window
    // remains. The caller promotes the rating and adds the physical quality delta.
    consumeRhythmUpgrade(rating: Rating, canAffectSurface: boolean): boolean {
        if (!canAffectSurface || this._definition.kind !== 'charges' || !this.active || this._charges <= 0) return false;
        if (rating !== Rating.GOOD && rating !== Rating.PERFECT) return false;
        this._charges -= 1;
        if (this._charges <= 0) this._remainingSeconds = 0;
        return true;
    }

    applyNetState(remainingSeconds: number, charges: number, pulsesTriggered: number): void {
        if (!Number.isFinite(remainingSeconds) || remainingSeconds < 0) return;
        this._remainingSeconds = clamp(remainingSeconds, 0, this.durationSeconds);
        if (this._definition.kind === 'charges') {
            this._charges = clamp(Math.round(charges), 0, Math.max(1, Math.round(ULTIMATE_SKILL_BALANCE.fishCharges)));
            if (this._remainingSeconds <= 0) this._charges = 0;
        }
        if (this._definition.kind === 'pulses') {
            this._pulsesTriggered = clamp(Math.round(pulsesTriggered), 0, this.pulseCount);
        }
    }

    get impulseSpeed(): number {
        return this._definition.kind === 'instant' ? ULTIMATE_SKILL_BALANCE.sharkImpulseSpeed : ULTIMATE_SKILL_BALANCE.novaPulseSpeed;
    }
    get impulseCapBonus(): number {
        return this._definition.kind === 'instant' ? ULTIMATE_SKILL_BALANCE.sharkImpulseCapBonus : ULTIMATE_SKILL_BALANCE.novaPulseCapBonus;
    }
    get rhythmBonusQualityAccelScale(): number { return Math.max(0, ULTIMATE_SKILL_BALANCE.fishBonusQualityAccelScale); }
}
