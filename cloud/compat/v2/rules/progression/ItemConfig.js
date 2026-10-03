"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findItem = exports.ITEMS = exports.signingCardId = exports.DYE_ITEM = exports.UNIVERSAL_SIGN_CARD = void 0;
const PlayerCharacterConfig_1 = require("../app/PlayerCharacterConfig");
exports.UNIVERSAL_SIGN_CARD = 'sign_universal';
exports.DYE_ITEM = 'dye';
function signingCardId(characterId) { return `sign_${characterId}`; }
exports.signingCardId = signingCardId;
/** 设计阶段，未接入库存、掉落或消费。道具表：稳定ID用于存档与掉落引用；一张签约卡永久开启培养资格。 */
exports.ITEMS = [
    { id: exports.UNIVERSAL_SIGN_CARD, name: '万能签约卡', description: '为任意一个角色永久开启培养资格', kind: 'universal-sign', maxStack: 9999 },
    { id: exports.DYE_ITEM, name: '染色剂', description: '永久解锁额外配色，已有免费配色不受影响', kind: 'dye', maxStack: 9999 },
    ...PlayerCharacterConfig_1.PLAYER_CHARACTER_DEFINITIONS.map(character => ({ id: signingCardId(character.id), name: `${character.name}签约卡`,
        description: `为${character.name}永久开启培养资格`, kind: 'character-sign', characterId: character.id, maxStack: 9999 })),
];
function findItem(id) { return exports.ITEMS.find(item => item.id === id); }
exports.findItem = findItem;
