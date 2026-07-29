// In-game player identity options: a small set of selectable avatars and a random
// nickname generator. We deliberately DON'T use the real WeChat avatar/nickname
// (privacy-restricted + often anonymized); the player picks an avatar and gets a
// random swim-themed nickname, both stored in the player profile.
//
// Randomness here is cosmetic (does not affect race outcome), so it uses Math.random
// on purpose — it is not part of the deterministic SharedRNG stream.

export interface AvatarOption {
    id: string;
    // RGB used to draw the circular avatar placeholder (no art assets needed yet).
    color: readonly [number, number, number];
}

export const AVATARS: readonly AvatarOption[] = [
    { id: 'aqua', color: [86, 196, 236] },
    { id: 'coral', color: [244, 122, 108] },
    { id: 'lime', color: [138, 210, 96] },
    { id: 'gold', color: [246, 200, 90] },
    { id: 'violet', color: [176, 130, 230] },
    { id: 'rose', color: [240, 138, 190] },
    { id: 'teal', color: [72, 196, 176] },
    { id: 'sky', color: [120, 168, 240] },
];

export function defaultAvatarId(): string {
    return AVATARS[Math.floor(Math.random() * AVATARS.length)].id;
}

export function avatarColorOf(id: string): readonly [number, number, number] {
    return (AVATARS.find((a) => a.id === id) ?? AVATARS[0]).color;
}

const NICK_PREFIX = [
    '飞驰的', '无敌', '闪电', '疾风', '深海', '浪花', '金牌', '冠军',
    '快乐', '咸鱼', '摸鱼', '躺平', '暴走', '佛系', '钢铁', '迷你',
];

const NICK_CORE = [
    '海豚', '飞鱼', '蛟龙', '鲨鱼', '旗鱼', '水母', '企鹅', '河马',
    '鸭子', '泳者', '劈波者', '浪里白条', '锦鲤', '章鱼', '海星', '龙王',
];

export function generateRandomNickName(): string {
    const prefix = NICK_PREFIX[Math.floor(Math.random() * NICK_PREFIX.length)];
    const core = NICK_CORE[Math.floor(Math.random() * NICK_CORE.length)];
    return `${prefix}${core}`;
}
