import type { PlayerCharacterId } from '../app/PlayerCharacterConfig';
import { Rating } from '../core/GameConstants';

// Pure per-swimmer ultimate state. Definitions live with the runtime so tuning,
// local prediction and network reconciliation use exactly the same rules.
export type UltimateSkillKind = 'shark' | 'instant' | 'charges' | 'dash' | 'drag';

export type UltimateSkillDefinition = {
    characterId: PlayerCharacterId;
    id: string;
    name: string;
    kind: UltimateSkillKind;
    durationSeconds: number;
    maxCharges?: number;
};

export const ULTIMATE_SKILL_BALANCE = {
    sharkImpulseSpeed: 1.05,
    sharkImpulseCapBonus: 0.42,
    fishDurationSeconds: 5,
    fishCharges: 3,
    fishBonusQualityAccelScale: 1,
    // 破浪新星：持续短时的额外前向速度。额外距离 = speed * duration，
    // 因此默认直线无阻挡收益约 2.5m，而不是硬编码位置瞬移。
    novaDashDurationSeconds: 0.6,
    novaDashExtraDistance: 2.5,
    novaDashTurnSafetyPadding: 0.1,
    novaDashYieldPadding: 0.08,
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
    lowPolyHuman2: { characterId: 'lowPolyHuman2', id: 'skill.nova.waveDash', name: '劈波突进', kind: 'dash', durationSeconds: 0.6 },
    diver: { characterId: 'diver', id: 'skill.diver.deepTrail', name: '深海航迹', kind: 'drag', durationSeconds: 5 },
};

// This skill is different from the other per-swimmer runtimes: the actual shark
// is owned by the race-level SharkController. Keep the definition here so the
// character mapping and all existing skill UI still resolve normally.
SKILL_DEFINITIONS.muscleMan = {
    characterId: 'muscleMan', id: 'skill.shark.summon', name: 'Shark Call', kind: 'shark', durationSeconds: 0,
};

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
    private _dashYieldAvailable = false;

    get definition(): UltimateSkillDefinition { return this._definition; }
    get remainingSeconds(): number { return this._remainingSeconds; }
    get charges(): number { return this._charges; }
    get pulsesTriggered(): number { return this._pulsesTriggered; }
    // Kept for the compact existing network/UI wire format. Dash has no pulses.
    get pulseCount(): number { return 0; }
    get isDashActive(): boolean { return this._definition.kind === 'dash' && this._remainingSeconds > 0; }
    get canDashYield(): boolean { return this.isDashActive && this._dashYieldAvailable; }
    get dashExtraSpeed(): number {
        return this.isDashActive
            ? Math.max(0, ULTIMATE_SKILL_BALANCE.novaDashExtraDistance) / Math.max(0.001, this.durationSeconds)
            : 0;
    }
    get active(): boolean { return this._remainingSeconds > 0 || this._charges > 0; }
    get normalizedRemaining(): number {
        return clamp(this._remainingSeconds / Math.max(0.001, this.durationSeconds), 0, 1);
    }
    get durationSeconds(): number {
        switch (this._definition.kind) {
            case 'charges': return Math.max(0.001, ULTIMATE_SKILL_BALANCE.fishDurationSeconds);
            case 'dash': return Math.max(0.001, ULTIMATE_SKILL_BALANCE.novaDashDurationSeconds);
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
        this._dashYieldAvailable = false;
    }

    activate(): boolean {
        if (this.active) return false;
        switch (this._definition.kind) {
            case 'shark':
                return false;
            case 'instant':
                this._pendingImpulseCount = 1;
                return true;
            case 'charges':
                this._remainingSeconds = this.durationSeconds;
                this._charges = Math.max(1, Math.round(ULTIMATE_SKILL_BALANCE.fishCharges));
                return true;
            case 'dash':
                this._remainingSeconds = this.durationSeconds;
                this._dashYieldAvailable = true;
                return true;
            case 'drag':
                this._remainingSeconds = this.durationSeconds;
                return true;
        }
    }

    // Timers always elapse. The caller ends a dash immediately when a scripted
    // movement phase begins, so it never resumes or compensates later.
    tick(dt: number, canAffectSurface: boolean): void {
        if (!this.active || !Number.isFinite(dt) || dt <= 0) return;
        const previous = this._remainingSeconds;
        this._remainingSeconds = Math.max(0, previous - dt);
        if (this._remainingSeconds <= 0) {
            this._charges = 0;
            this._dashYieldAvailable = false;
        }
    }

    consumePendingImpulseCount(): number {
        const count = this._pendingImpulseCount;
        this._pendingImpulseCount = 0;
        return count;
    }

    // A dash can make exactly one same-direction swimmer yield sideways. The
    // collision solver calls this only after it has found a valid free side.
    consumeDashYield(): boolean {
        if (!this.isDashActive || !this._dashYieldAvailable) return false;
        this._dashYieldAvailable = false;
        return true;
    }

    cancel(): void {
        this._remainingSeconds = 0;
        this._charges = 0;
        this._pendingImpulseCount = 0;
        this._dashYieldAvailable = false;
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
        // `pulsesTriggered` remains on the compact wire format for old clients;
        // the dash deliberately has no pulse substate to reconcile.
    }

    get impulseSpeed(): number {
        return ULTIMATE_SKILL_BALANCE.sharkImpulseSpeed;
    }
    get impulseCapBonus(): number {
        return ULTIMATE_SKILL_BALANCE.sharkImpulseCapBonus;
    }
    get rhythmBonusQualityAccelScale(): number { return Math.max(0, ULTIMATE_SKILL_BALANCE.fishBonusQualityAccelScale); }
}
