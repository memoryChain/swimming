import type { SwimmerMotor } from '../swimmer/SwimmerMotor';
import type { Swimmer } from '../entity/Swimmer';
import type { PlayerBalanceOverrides } from './PlayerBalanceOverrides';
import { resolvePlayerBalance } from './PlayerBalanceOverrides';
import { getProgressionManager } from './ProgressionManager';
import { PROGRESSION_BALANCE } from './ProgressionBalance';
import { findPlayerCharacter, getPlayerCharacterSelection, PlayerCharacterId } from '../app/PlayerCharacterConfig';
import { getUltimateSkillDefinition } from '../skills/SkillRuntime';
import type { UltimateSkillDefinition } from '../skills/SkillRuntime';

// The complete, self-contained set of gameplay-affecting modifiers a player brings
// into a race, resolved ONCE from their local save. Today this is progression-derived
// balance; future 养成 systems (equipment, skills, seasonal buffs, cosmetics that
// affect play) add sibling fields to this container.
//
// This is the SINGLE seam shared by single-player and multiplayer, split into three
// decoupled layers so any new 养成 flows into online for free:
//   1. resolve   — resolveLocalModifierDigest(): save -> compact digest (owner side);
//      resolveModifiersFromDigest(): digest -> full profile (any client, shared config).
//   2. transport — NetRaceModifierCodec + RoomFlow broadcast the tiny DIGEST (not the
//      resolved floats) on the room broadcast channel, so EVERY client receives EVERY
//      player's digest and re-resolves an identical profile. (memberExtInfo is capped at
//      32 bytes — too small for the resolved blob, see NetRaceModifierCodec.)
//   3. apply     — applyRaceModifiers*(): profile -> swimmer, run identically for the
//      local player and each remote human.
//
// Adding a new 养成 modifier is a localized, append-only change: extend RaceModifierDigest
// + RaceModifierProfile, map it in resolveLocalModifierDigest / resolveModifiersFromDigest
// / applyRaceModifiers*, and (if it needs its own wire field) the codec. The transport is
// generic and needs no change.
export interface RaceModifierProfile {
    // Progression-derived movement/condition balance (null = neutral / no character).
    balance: PlayerBalanceOverrides | null;
    // Character id is the stable source of the dedicated ultimate definition.
    // We transmit the id in the existing modifier digest, never runtime skill floats.
    characterId: PlayerCharacterId | null;
    skill: UltimateSkillDefinition | null;
    // Future 养成 fields go here, e.g. startBoost?: number; luckyLaneBias?: number; ...
}

// The compact, transmissible SOURCE of a player's modifiers: the save-derived keys
// needed to re-resolve the profile on any client using shared config + pure functions.
// Tiny on the wire (vs the resolved floats). A future 养成 system adds a key here (e.g.
// equipped item ids) rather than more transmitted values.
export interface RaceModifierDigest {
    characterId: string;
    level: number;
}

// The local player's digest, from their save (selected character + its progression level).
export function resolveLocalModifierDigest(): RaceModifierDigest {
    const characterId = getPlayerCharacterSelection().characterId;
    const level = getProgressionManager().getCharacterLevel(characterId);
    return { characterId, level };
}

// Re-resolve a full profile from a digest using SHARED config (character definitions)
// + the SAME pure resolve function, so every client derives an identical profile for a
// given (characterId, level). Unknown character -> neutral (null balance).
export function resolveModifiersFromDigest(digest: RaceModifierDigest | null): RaceModifierProfile {
    if (!digest) {
        return { balance: null, characterId: null, skill: null };
    }
    const character = findPlayerCharacter(digest.characterId as PlayerCharacterId);
    if (!character) {
        return { balance: null, characterId: null, skill: null };
    }
    const balance = resolvePlayerBalance(
        { stamina: character.stamina, technique: character.technique, burst: character.burst, kick: character.kick },
        digest.level,
        PROGRESSION_BALANCE.maxLevel,
        character.weight,
        character.energyGain,
        character.kick,
    );
    return { balance, characterId: character.id, skill: getUltimateSkillDefinition(character.id) };
}

// Resolve the local player's full profile from their save. Same source single-player
// uses, so what this client applies to its own swimmer matches the digest it publishes.
export function resolveLocalRaceModifiers(): RaceModifierProfile {
    return resolveModifiersFromDigest(resolveLocalModifierDigest());
}

// Apply the movement-affecting part of a profile to a swimmer's motor. Safe for the
// local player AND remote humans: both run a local motor (the player predicts, the
// remote replays input), so applying identical balance keeps their sims — and the
// weight-based collision knockback — consistent across devices. A null profile leaves
// the motor on the raw global constants (neutral).
export function applyRaceModifiersToMotor(motor: SwimmerMotor, profile: RaceModifierProfile | null): void {
    motor.setPlayerBalance(profile?.balance ?? null);
}

// Apply the full profile (motor balance + 蓄气资质) to a swimmer. Use this for
// the local player and remote humans; AI uses CompetitorManager.applyProfile which
// sets weight + energyGain directly from its competitor profile.
export function applyRaceModifiersToSwimmer(swimmer: Swimmer, profile: RaceModifierProfile | null): void {
    applyRaceModifiersToMotor(swimmer.motor, profile);
    swimmer.setEnergyGainAptitude(profile?.balance?.energyGainAptitude ?? 50);
    swimmer.setUltimateSkillDefinition(profile?.skill ?? getUltimateSkillDefinition(null));
}
