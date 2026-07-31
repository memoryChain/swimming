// Deterministic swimmer appearance for a networked human, derived purely from the
// member's shared lobby avatarId. Because avatarId travels in the race roster, every
// client computes the SAME look for a given player — so what you see of yourself
// matches what your opponents see of you.
//
// COMPATIBILITY: only used in a networked race (GameManager, net-gated). Single-player
// keeps its locally-chosen character look untouched.

import { Color } from 'cc';
import { AVATARS } from '../backend/IdentityConfig';
import { PLAYER_SKIN_TONES } from '../app/PlayerCharacterConfig';
import {
    defaultSwimmerColorVariant,
    defaultSwimmerModelVariant,
    SWIMMER_COLOR_VARIANTS,
    SWIMMER_MODEL_VARIANTS,
} from '../core/ResourcePaths';
import { CartoonSwimmerRig } from '../entity/CartoonSwimmerRig';

export interface NetSwimmerLook {
    modelVariantId: string;
    colorVariantId: string;
    skinColor: readonly [number, number, number];
}

function avatarIndex(avatarId: string): number {
    const i = AVATARS.findIndex((a) => a.id === avatarId);
    return i >= 0 ? i : 0;
}

// Map a lobby avatarId to a stable, distinct in-race look. All fields index shared,
// order-stable lists so the result is identical on every client.
export function netSwimmerLook(avatarId: string): NetSwimmerLook {
    const idx = avatarIndex(avatarId);
    const models = SWIMMER_MODEL_VARIANTS.filter((v) => !v.debugOnly);
    const model = models[idx % models.length] ?? defaultSwimmerModelVariant();
    const colorVariant = SWIMMER_COLOR_VARIANTS[idx % SWIMMER_COLOR_VARIANTS.length] ?? defaultSwimmerColorVariant();
    const skinTones = PLAYER_SKIN_TONES;
    const skin = skinTones[idx % skinTones.length]?.color ?? ([246, 176, 118] as const);
    return {
        modelVariantId: model.id,
        colorVariantId: colorVariant.id,
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
