"use strict";
// In-game player identity options: a small set of selectable avatars and a random
// nickname generator. We deliberately DON'T use the real WeChat avatar/nickname
// (privacy-restricted + often anonymized); the player picks an avatar and gets a
// random swim-themed nickname, both stored in the player profile.
//
// Randomness here is cosmetic (does not affect race outcome), so it uses Math.random
// on purpose — it is not part of the deterministic SharedRNG stream.
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRandomNickName = exports.avatarColorOf = exports.defaultAvatarId = exports.avatarSwimmerLookOf = exports.AVATAR_SWIMMER_LOOK_BY_ID = exports.AVATARS = void 0;
// Keep the original eight ids and ordering stable so existing local profiles and
// multiplayer identity payloads continue to resolve to the same deterministic slot.
exports.AVATARS = [
    { id: 'aqua', color: [86, 196, 236] },
    { id: 'coral', color: [244, 122, 108] },
    { id: 'lime', color: [138, 210, 96] },
    { id: 'gold', color: [246, 200, 90] },
    { id: 'violet', color: [176, 130, 230] },
    { id: 'rose', color: [240, 138, 190] },
    { id: 'teal', color: [72, 196, 176] },
    { id: 'sky', color: [120, 168, 240] },
    { id: 'frog-lime', color: [132, 211, 72] },
    { id: 'lifeguard', color: [255, 126, 72] },
];
// Stable ID mapping used by networked races. Never derive these looks from an
// avatar/model array index: adding, deleting, or reordering either catalog must
// not change an existing avatar's in-race appearance.
exports.AVATAR_SWIMMER_LOOK_BY_ID = {
    aqua: { modelVariantId: 'muscleMan', colorVariantId: 'redBlue', skinToneId: 'warm' },
    coral: { modelVariantId: 'cartonSwimmer5', colorVariantId: 'blueWhite', skinToneId: 'deep' },
    lime: { modelVariantId: 'cartonSwimmer6', colorVariantId: 'blackYellow', skinToneId: 'warm' },
    gold: { modelVariantId: 'cartonSwimmer8', colorVariantId: 'greenOrange', skinToneId: 'deep' },
    violet: { modelVariantId: 'cartonSwimmer9', colorVariantId: 'purpleCyan', skinToneId: 'warm' },
    rose: { modelVariantId: 'cartonSwimmer10', colorVariantId: 'orangeNavy', skinToneId: 'deep' },
    teal: { modelVariantId: 'muscleMan', colorVariantId: 'pinkMint', skinToneId: 'warm' },
    sky: { modelVariantId: 'cartonSwimmer5', colorVariantId: 'cyanRed', skinToneId: 'deep' },
    'frog-lime': { modelVariantId: 'cartonSwimmer8', colorVariantId: 'greenOrange', skinToneId: 'warm' },
    lifeguard: { modelVariantId: 'cartonSwimmer6', colorVariantId: 'orangeNavy', skinToneId: 'deep' },
};
function avatarSwimmerLookOf(avatarId) {
    return exports.AVATAR_SWIMMER_LOOK_BY_ID[avatarId] ?? exports.AVATAR_SWIMMER_LOOK_BY_ID.aqua;
}
exports.avatarSwimmerLookOf = avatarSwimmerLookOf;
function defaultAvatarId() {
    return exports.AVATARS[Math.floor(Math.random() * exports.AVATARS.length)].id;
}
exports.defaultAvatarId = defaultAvatarId;
function avatarColorOf(id) {
    return (exports.AVATARS.find((a) => a.id === id) ?? exports.AVATARS[0]).color;
}
exports.avatarColorOf = avatarColorOf;
// Human-player nicknames use a cute "小 + 动物 + 随机数字" style (e.g. 小鸡1024,
// 小鸭7788). This is deliberately DISTINCT from the surname-style AI opponent names
// (王划水 / 浪里白条 …) so players and AI are easy to tell apart, and the numeric
// suffix keeps repeats between players unlikely.
const CUTE_ANIMALS = [
    '鸡', '鸭', '猫', '狗', '兔', '熊', '猪', '鹅',
    '鱼', '虾', '龟', '鹿', '象', '狮', '虎', '豹',
    '猴', '羊', '牛', '马', '蛙', '鲸', '海豚', '水獭',
];
function generateRandomNickName() {
    const animal = CUTE_ANIMALS[Math.floor(Math.random() * CUTE_ANIMALS.length)];
    // 4-digit suffix (1000–9999): 9000 numbers × the animal pool make collisions
    // between two randomly-generated player names rare.
    const number = 1000 + Math.floor(Math.random() * 9000);
    return `小${animal}${number}`;
}
exports.generateRandomNickName = generateRandomNickName;
