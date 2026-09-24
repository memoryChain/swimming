import { Color } from 'cc';
import { findPlayerCharacter, PLAYER_COLOR_SCHEMES, PLAYER_SKIN_TONES } from '../app/PlayerCharacterConfig';
import { defaultSwimmerColorVariant } from '../core/ResourcePaths';
import type { CartoonSwimmerRig } from '../entity/CartoonSwimmerRig';
import type { RaceModifierDigest } from '../progression/RaceModifiers';

// 联机外观与属性消费同一份开赛快照，账号头像只用于二维身份展示。
export function netSwimmerLook(digest: RaceModifierDigest | null) {
    if (!digest) return null;
    const character = findPlayerCharacter(digest.characterId as Parameters<typeof findPlayerCharacter>[0]);
    const skin = PLAYER_SKIN_TONES.find(tone => tone.id === digest.skinToneId);
    const scheme = PLAYER_COLOR_SCHEMES.find(color => color.id === digest.colorSchemeId);
    if (!character || !skin || !scheme) return null;
    return {
        modelVariantId: character.modelVariantId,
        skinColor: skin.preserveOriginal || character.supportsSkinTone === false ? undefined : skin.color,
        suitColor: scheme.suit,
        capColor: scheme.cap,
    };
}

export function applyNetSwimmerLook(rig: CartoonSwimmerRig | null, digest: RaceModifierDigest | null): void {
    const look = netSwimmerLook(digest);
    if (!rig || !look) return;
    rig.setModelVariant(look.modelVariantId);
    rig.setColorVariant(defaultSwimmerColorVariant().id);
    rig.setColorOverride({
        skin: look.skinColor ? new Color(...look.skinColor) : undefined,
        suit: new Color(...look.suitColor), cap: new Color(...look.capColor),
    });
}
