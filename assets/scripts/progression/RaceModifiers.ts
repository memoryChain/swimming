import type { SwimmerMotor } from '../swimmer/SwimmerMotor';
import type { PlayerBalanceOverrides } from './PlayerBalanceOverrides';
import { getProgressionManager } from './ProgressionManager';
import { getPlayerCharacterSelection } from '../app/PlayerCharacterConfig';

// The complete, self-contained set of gameplay-affecting modifiers a player brings
// into a race, resolved ONCE from their local save. Today this is progression-derived
// balance; future 养成 systems (equipment, skills, seasonal buffs, cosmetics that
// affect play) add sibling fields to this container.
//
// This is the SINGLE seam shared by single-player and multiplayer, split into three
// decoupled layers so any new 养成 flows into online for free:
//   1. resolve  — resolveLocalRaceModifiers(): save -> profile (owner side).
//   2. transport — NetRaceModifierCodec encodes the profile into the net roster's
//      per-member extInfo, so EVERY client receives EVERY player's profile. The value
//      is resolved on the owner's device and transmitted verbatim, so all clients agree
//      (deterministic; static per race; off the per-frame hot path).
//   3. apply    — applyRaceModifiers*(): profile -> swimmer, run identically for the
//      local player and each remote human, so 养成 affects the networked race the same
//      way it does offline.
//
// Adding a new 养成 modifier is a localized, append-only change: extend this interface,
// map it in resolveLocalRaceModifiers + applyRaceModifiers*, and append it in the codec.
// The transport (roster extInfo) is generic and needs no change.
export interface RaceModifierProfile {
    // Progression-derived movement/condition balance (null = neutral / no character).
    balance: PlayerBalanceOverrides | null;
    // Future 养成 fields go here, e.g. startBoost?: number; luckyLaneBias?: number; ...
}

// Resolve the local player's modifier profile from their save (selected character +
// progression). This is the same source single-player uses, so the profile a client
// publishes to its peers matches what it applies to its own swimmer.
export function resolveLocalRaceModifiers(): RaceModifierProfile {
    const characterId = getPlayerCharacterSelection().characterId;
    const balance = getProgressionManager().resolveBalance(characterId);
    return { balance };
}

// Apply the movement-affecting part of a profile to a swimmer's motor. Safe for the
// local player AND remote humans: both run a local motor (the player predicts, the
// remote replays input), so applying identical balance keeps their sims — and the
// weight-based collision knockback — consistent across devices. A null profile leaves
// the motor on the raw global constants (neutral).
export function applyRaceModifiersToMotor(motor: SwimmerMotor, profile: RaceModifierProfile | null): void {
    motor.setPlayerBalance(profile?.balance ?? null);
}
