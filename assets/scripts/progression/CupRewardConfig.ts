import { DYE_ITEM, UNIVERSAL_SIGN_CARD, ItemGrant } from './ItemConfig';

export interface CupDrop { itemId: string | 'random-sign-card'; count: number; weight: number; }
export interface CupRewardConfig {
    championCoins: number;
    /** 该角色首次夺得本级别杯赛冠军时发放。 */
    firstChampionGems: number;
    firstChampion: readonly ItemGrant[];
    /** 夺冠每次抽取一项，首次也抽；未夺冠不掉落。 */
    drops: readonly CupDrop[];
}
/** 道具 firstChampion 与 drops 仍是设计草案；金币和首次夺冠突破宝石已接入。 */
export const CUP_REWARDS: readonly CupRewardConfig[] = [
    { championCoins: 60, firstChampionGems: 1, firstChampion: [{itemId: UNIVERSAL_SIGN_CARD, count: 1}], drops: [{itemId: DYE_ITEM, count: 1, weight: 80}, {itemId: 'random-sign-card', count: 1, weight: 20}] },
    { championCoins: 70, firstChampionGems: 2, firstChampion: [{itemId: UNIVERSAL_SIGN_CARD, count: 1}], drops: [{itemId: DYE_ITEM, count: 1, weight: 75}, {itemId: 'random-sign-card', count: 1, weight: 25}] },
    { championCoins: 80, firstChampionGems: 3, firstChampion: [{itemId: UNIVERSAL_SIGN_CARD, count: 1}], drops: [{itemId: DYE_ITEM, count: 1, weight: 70}, {itemId: 'random-sign-card', count: 1, weight: 30}] },
    { championCoins: 90, firstChampionGems: 4, firstChampion: [{itemId: UNIVERSAL_SIGN_CARD, count: 1}], drops: [{itemId: DYE_ITEM, count: 2, weight: 65}, {itemId: 'random-sign-card', count: 1, weight: 35}] },
    { championCoins: 100, firstChampionGems: 5, firstChampion: [{itemId: UNIVERSAL_SIGN_CARD, count: 1}], drops: [{itemId: DYE_ITEM, count: 2, weight: 60}, {itemId: 'random-sign-card', count: 1, weight: 40}] },
    { championCoins: 120, firstChampionGems: 6, firstChampion: [{itemId: UNIVERSAL_SIGN_CARD, count: 2}], drops: [{itemId: DYE_ITEM, count: 2, weight: 50}, {itemId: 'random-sign-card', count: 1, weight: 50}] },
];
