import type { RaceModifierProfile } from '../progression/RaceModifiers';
import type { PlayerBalanceOverrides } from '../progression/PlayerBalanceOverrides';

// Compact, versioned codec for a RaceModifierProfile carried in the net roster
// (memberExtInfo). This is NOT the per-frame hot path — it is a one-time, static-per-
// race handshake — but it is kept compact anyway because WeChat's memberExtInfo is
// size-limited.
//
// Wire form: "M!<ver>,<f0>,<f1>,..." — the PROFILE_MARK sentinel, a version int, then
// each balance field quantized to an integer (x1000). The scheme is APPEND-ONLY: to
// carry a new 养成 field, append a new index at the END and keep VERSION bumping for
// documentation. Never reorder or reuse indices. This makes mixed client versions
// degrade gracefully instead of desyncing:
//   - a NEW decoder reading an OLD (shorter) blob defaults the missing trailing fields;
//   - an OLD decoder reading a NEW (longer) blob ignores the extra trailing fields.
export const PROFILE_MARK = 'M!';
const VERSION = 1;
const Q = 1000;
// v1 field count after the version token: maxSpeed, energyTotal, perfectComboMaxOvercap,
// strokeQualityAccel, kickMaxSpeed, diveMaxLaunchSpeed, weight.
const V1_FIELD_COUNT = 7;

// Encode a profile into its roster blob. Returns '' when there is nothing to carry
// (no character / neutral), so the roster identity stays a plain avatarId|nickName.
export function encodeRaceModifiers(profile: RaceModifierProfile | null): string {
    const b = profile?.balance;
    if (!b) {
        return '';
    }
    const q = (n: number) => Math.round(n * Q);
    // APPEND-ONLY field order (v1). Add future fields AFTER weight.
    const fields = [
        VERSION,
        q(b.maxSpeed),
        q(b.energyTotal),
        q(b.perfectComboMaxOvercap),
        q(b.strokeQualityAccel),
        q(b.kickMaxSpeed),
        q(b.diveMaxLaunchSpeed),
        q(b.weight),
    ];
    return PROFILE_MARK + fields.join(',');
}

// Decode a roster blob back into a profile, or null when the blob is absent/malformed
// (consumer falls back to neutral balance). Tolerant of extra trailing fields from a
// newer encoder.
export function decodeRaceModifiers(blob: string | undefined | null): RaceModifierProfile | null {
    if (!blob || blob.slice(0, PROFILE_MARK.length) !== PROFILE_MARK) {
        return null;
    }
    const parts = blob.slice(PROFILE_MARK.length).split(',');
    // parts[0] is the version (reserved for future field-set changes). Require a full
    // v1 record (version + 7 fields) before trusting it.
    if (parts.length < V1_FIELD_COUNT + 1) {
        return null;
    }
    const at = (i: number, fallback: number) => {
        const v = parseInt(parts[i], 10);
        return Number.isFinite(v) ? v / Q : fallback;
    };
    const balance: PlayerBalanceOverrides = {
        maxSpeed: at(1, 0),
        energyTotal: at(2, 0),
        perfectComboMaxOvercap: at(3, 0),
        strokeQualityAccel: at(4, 0),
        kickMaxSpeed: at(5, 0),
        diveMaxLaunchSpeed: at(6, 0),
        weight: at(7, 1),
    };
    return { balance };
}
