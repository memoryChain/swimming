import { DYE_ITEM, UNIVERSAL_SIGN_CARD, ItemGrant } from './ItemConfig';

export interface CupDrop { itemId: string | 'random-sign-card'; count: number; weight: number; }
export interface CupRewardConfig {
    championCoins: number;
    /** 账号每级首次通过杯赛的金币，与未来道具首奖分开记账。 */
    firstClearCoins: number;
    firstChampion: readonly ItemGrant[];
    /** 夺冠每次抽取一项，首次也抽；未夺冠不掉落。 */
    drops: readonly CupDrop[];
}
/** championCoins 与 firstClearCoins 已接入；firstChampion 与 drops 仍是未开放的道具草案。 */
export const CUP_REWARDS: readonly CupRewardConfig[] = [
    { championCoins: 300, firstClearCoins: 600, firstChampion: [{itemId: UNIVERSAL_SIGN_CARD, count: 1}], drops: [{itemId: DYE_ITEM, count: 1, weight: 80}, {itemId: 'random-sign-card', count: 1, weight: 20}] },
    { championCoins: 600, firstClearCoins: 1200, firstChampion: [{itemId: UNIVERSAL_SIGN_CARD, count: 1}], drops: [{itemId: DYE_ITEM, count: 1, weight: 75}, {itemId: 'random-sign-card', count: 1, weight: 25}] },
    { championCoins: 1000, firstClearCoins: 2200, firstChampion: [{itemId: UNIVERSAL_SIGN_CARD, count: 1}], drops: [{itemId: DYE_ITEM, count: 1, weight: 70}, {itemId: 'random-sign-card', count: 1, weight: 30}] },
    { championCoins: 1800, firstClearCoins: 4000, firstChampion: [{itemId: UNIVERSAL_SIGN_CARD, count: 1}], drops: [{itemId: DYE_ITEM, count: 2, weight: 65}, {itemId: 'random-sign-card', count: 1, weight: 35}] },
    { championCoins: 3000, firstClearCoins: 6500, firstChampion: [{itemId: UNIVERSAL_SIGN_CARD, count: 1}], drops: [{itemId: DYE_ITEM, count: 2, weight: 60}, {itemId: 'random-sign-card', count: 1, weight: 40}] },
    { championCoins: 4800, firstClearCoins: 10000, firstChampion: [{itemId: UNIVERSAL_SIGN_CARD, count: 2}], drops: [{itemId: DYE_ITEM, count: 2, weight: 50}, {itemId: 'random-sign-card', count: 1, weight: 50}] },
];
