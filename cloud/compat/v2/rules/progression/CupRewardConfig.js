"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CUP_REWARDS = void 0;
const ItemConfig_1 = require("./ItemConfig");
/** 仅 championCoins 已接入；firstChampion 与 drops 是设计草案，目前不掉落、不发首奖。 */
exports.CUP_REWARDS = [
    { championCoins: 60, firstChampion: [{ itemId: ItemConfig_1.UNIVERSAL_SIGN_CARD, count: 1 }], drops: [{ itemId: ItemConfig_1.DYE_ITEM, count: 1, weight: 80 }, { itemId: 'random-sign-card', count: 1, weight: 20 }] },
    { championCoins: 70, firstChampion: [{ itemId: ItemConfig_1.UNIVERSAL_SIGN_CARD, count: 1 }], drops: [{ itemId: ItemConfig_1.DYE_ITEM, count: 1, weight: 75 }, { itemId: 'random-sign-card', count: 1, weight: 25 }] },
    { championCoins: 80, firstChampion: [{ itemId: ItemConfig_1.UNIVERSAL_SIGN_CARD, count: 1 }], drops: [{ itemId: ItemConfig_1.DYE_ITEM, count: 1, weight: 70 }, { itemId: 'random-sign-card', count: 1, weight: 30 }] },
    { championCoins: 90, firstChampion: [{ itemId: ItemConfig_1.UNIVERSAL_SIGN_CARD, count: 1 }], drops: [{ itemId: ItemConfig_1.DYE_ITEM, count: 2, weight: 65 }, { itemId: 'random-sign-card', count: 1, weight: 35 }] },
    { championCoins: 100, firstChampion: [{ itemId: ItemConfig_1.UNIVERSAL_SIGN_CARD, count: 1 }], drops: [{ itemId: ItemConfig_1.DYE_ITEM, count: 2, weight: 60 }, { itemId: 'random-sign-card', count: 1, weight: 40 }] },
    { championCoins: 120, firstChampion: [{ itemId: ItemConfig_1.UNIVERSAL_SIGN_CARD, count: 2 }], drops: [{ itemId: ItemConfig_1.DYE_ITEM, count: 2, weight: 50 }, { itemId: 'random-sign-card', count: 1, weight: 50 }] },
];
