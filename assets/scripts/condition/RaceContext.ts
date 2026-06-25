// RaceContext: lightweight shared context for the current race (doc 3 / 20 / 28.7).
// Holds the player condition model and a few read-helpers, NOT a state container
// for every swimmer. AI condition lives in GameManager, not here (doc 28.7).
// Keep it a thin field container with only small, phase/readability helpers.

import { PlayerConditionModel } from './PlayerConditionModel';
import { RacePhase } from './ConditionTypes';
import { DiveResult } from '../core/DiveResult';

export class RaceContext {
    phase: RacePhase = RacePhase.START;
    latestDiveResult: DiveResult | null = null;
    sprintActive = false;

    constructor(readonly playerCondition: PlayerConditionModel) {}

    reset() {
        this.phase = RacePhase.START;
        this.latestDiveResult = null;
        this.sprintActive = false;
    }

    setPhase(phase: RacePhase) {
        this.phase = phase;
        this.sprintActive = phase === RacePhase.SPRINT;
    }

    // --- Small phase-semantics helpers (doc 20.5) ---
    isStart(): boolean {
        return this.phase === RacePhase.START;
    }

    isPace(): boolean {
        return this.phase === RacePhase.PACE;
    }

    isSprint(): boolean {
        return this.phase === RacePhase.SPRINT;
    }

    hasDiveResult(): boolean {
        return this.latestDiveResult !== null;
    }
}
