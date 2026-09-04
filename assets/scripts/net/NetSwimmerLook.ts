// Deterministic swimmer appearance for a networked human, derived purely from the
// member's shared lobby avatarId. Because avatarId travels in the race roster, every
// client computes the SAME look for a given player — so what you see of yourself
// matches what your opponents see of you.
//
// COMPATIBILITY: only used in a networked race (GameManager, net-gated). Single-player
// keeps its locally-chosen character look untouched.

import { Color } from 'cc';
import { avatarSwimmerLookOf } from '../backend/IdentityConfig';
import { PLAYER_SKIN_TONES } from '../app/PlayerCharacterConfig';
import { CartoonSwimmerRig } from '../entity/CartoonSwimmerRig';

export interface NetSwimmerLook {
    modelVariantId: string;
    colorVariantId: string;
    skinColor: readonly [number, number, number];
}

// Resolve every field through stable IDs. No appearance depends on the position
// of an avatar, model, color, or skin tone in a catalog.
export function netSwimmerLook(avatarId: string): NetSwimmerLook {
    const definition = avatarSwimmerLookOf(avatarId);
    const skin = PLAYER_SKIN_TONES.find((tone) => tone.id === definition.skinToneId)?.color
        ?? ([255, 226, 191] as const);
    return {
        modelVariantId: definition.modelVariantId,
        colorVariantId: definition.colorVariantId,
        skinColor: skin,
    };
}

// Apply the avatar-derived look to a built swimmer rig. Safe to call after the factory
// has built the body (re-sets model/color; CartoonSwimmerRig handles re-application).
export function applyNetSwimmerLook(rig: CartoonSwimmerRig | null, avatarId: string): void {
    if (!rig) {
        return;
    }
    const look = netSwimmerLook(avatarId);
    rig.setModelVariant(look.modelVariantId);
    rig.setColorVariant(look.colorVariantId);
    rig.setColorOverride({ skin: new Color(look.skinColor[0], look.skinColor[1], look.skinColor[2]) });
}
