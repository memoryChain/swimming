import { DYE_ITEM, UNIVERSAL_SIGN_CARD, ItemGrant } from './ItemConfig';

export interface CupDrop { itemId: string | 'random-sign-card'; count: number; weight: number; }
export interface CupRewardConfig {
    championCoins: number;
    firstChampion: readonly ItemGrant[];
    /** 夺冠每次抽取一项，首次也抽；未夺冠不掉落。 */
    drops: readonly CupDrop[];
}
/** 仅 championCoins 已接入；firstChampion 与 drops 是设计草案，目前不掉落、不发首奖。 */
export const CUP_REWARDS: readonly CupRewardConfig[] = [
    { championCoins: 60, firstChampion: [{itemId: UNIVERSAL_SIGN_CARD, count: 1}], drops: [{itemId: DYE_ITEM, count: 1, weight: 80}, {itemId: 'random-sign-card', count: 1, weight: 20}] },
    { championCoins: 70, firstChampion: [{itemId: UNIVERSAL_SIGN_CARD, count: 1}], drops: [{itemId: DYE_ITEM, count: 1, weight: 75}, {itemId: 'random-sign-card', count: 1, weight: 25}] },
    { championCoins: 80, firstChampion: [{itemId: UNIVERSAL_SIGN_CARD, count: 1}], drops: [{itemId: DYE_ITEM, count: 1, weight: 70}, {itemId: 'random-sign-card', count: 1, weight: 30}] },
    { championCoins: 90, firstChampion: [{itemId: UNIVERSAL_SIGN_CARD, count: 1}], drops: [{itemId: DYE_ITEM, count: 2, weight: 65}, {itemId: 'random-sign-card', count: 1, weight: 35}] },
    { championCoins: 100, firstChampion: [{itemId: UNIVERSAL_SIGN_CARD, count: 1}], drops: [{itemId: DYE_ITEM, count: 2, weight: 60}, {itemId: 'random-sign-card', count: 1, weight: 40}] },
    { championCoins: 120, firstChampion: [{itemId: UNIVERSAL_SIGN_CARD, count: 2}], drops: [{itemId: DYE_ITEM, count: 2, weight: 50}, {itemId: 'random-sign-card', count: 1, weight: 50}] },
];
