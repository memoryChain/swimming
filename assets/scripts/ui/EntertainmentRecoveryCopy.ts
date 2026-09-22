import { EntertainmentRecoveryReason } from '../core/EntertainmentRecoveryController';

export type EntertainmentRecoveryCopyTier = 'large' | 'medium' | 'small';

export type EntertainmentRecoveryCopy = Readonly<{
    text: string;
    tier: EntertainmentRecoveryCopyTier;
}>;

const FORMAL_BUCKET_COUNT = 3;
const GENERAL_BUCKET_COUNT = 4;
const TOTAL_BUCKET_COUNT = 10;

const FORMAL_COPY = [
    '正在找回方向',
    '正在稳住身体',
    '正在摆正姿势',
] as const;

const GENERAL_COPY = [
    '泳帽扶正中',
    '脑袋还在转弯',
    '浮圈先借一下',
    '手脚正在对齐',
    '方向感加载中',
    '让我先扶稳',
    '水花有点热情',
    '马上找回节奏',
] as const;

const SHARK_COPY = [
    '挨了一口缓缓',
    '玩具也咬人啊',
    '这口有点认真',
    '先借浮圈缓缓',
    '泳裤应该还在',
    '刚才躲慢了点',
    '等我扶稳再游',
    '这玩具太调皮',
] as const;

const CANNON_COPY = [
    '落点确实很准',
    '水花抢先到了',
    '刚才浪有点大',
    '泳帽差点歪了',
    '先把方向找回',
    '这一浪挺热情',
    '正在结束转圈',
    '让我缓一小会',
] as const;

const TIMED_BOMB_COPY = [
    '刚才谁传给我',
    '接得有点太稳',
    '倒计时跑得快',
    '下次传快一点',
    '水花先到终点',
    '交接慢了半拍',
    '这回轮到我了',
    '刚才差一点点',
] as const;

const MINEFIELD_COPY = [
    '拐弯晚了半拍',
    '下次留点距离',
    '这条路有点挤',
    '正在重新导航',
    '刚才靠得太近',
    '这边需要绕行',
    '绕路也能到达',
    '先扶稳再转弯',
] as const;

export const ENTERTAINMENT_RECOVERY_COPY_POOLS = {
    formal: FORMAL_COPY,
    general: GENERAL_COPY,
    shark: SHARK_COPY,
    cannon: CANNON_COPY,
    timedBomb: TIMED_BOMB_COPY,
    minefield: MINEFIELD_COPY,
} as const;

/**
 * 纯表现用的确定性文案选择，不消耗玩法随机数，也不增加联机字段。
 * 十个槽位维持约 30% 正式、40% 通用幽默、30% 受击原因专属。
 */
export function selectEntertainmentRecoveryCopy(
    reason: EntertainmentRecoveryReason,
    lane: number,
    revision: number,
): EntertainmentRecoveryCopy {
    const seed = recoveryCopySeed(reason, lane, revision);
    const bucket = seed % TOTAL_BUCKET_COUNT;
    let pool: readonly string[];
    if (bucket < FORMAL_BUCKET_COUNT) {
        pool = FORMAL_COPY;
    } else if (bucket < FORMAL_BUCKET_COUNT + GENERAL_BUCKET_COUNT) {
        pool = GENERAL_COPY;
    } else {
        pool = reasonCopyPool(reason);
    }
    const text = pool[Math.floor(seed / TOTAL_BUCKET_COUNT) % pool.length];
    return { text, tier: recoveryCopyTierForText(text) };
}

export function recoveryCopyTierForText(text: string): EntertainmentRecoveryCopyTier {
    const length = Array.from(text).length;
    if (length <= 4) return 'large';
    if (length <= 6) return 'medium';
    return 'small';
}

function reasonCopyPool(reason: EntertainmentRecoveryReason): readonly string[] {
    switch (reason) {
        case EntertainmentRecoveryReason.SHARK:
            return SHARK_COPY;
        case EntertainmentRecoveryReason.CANNON:
            return CANNON_COPY;
        case EntertainmentRecoveryReason.TIMED_BOMB:
            return TIMED_BOMB_COPY;
        case EntertainmentRecoveryReason.MINEFIELD:
            return MINEFIELD_COPY;
        default:
            return GENERAL_COPY;
    }
}

function recoveryCopySeed(reason: EntertainmentRecoveryReason, lane: number, revision: number): number {
    let value = Math.imul(Math.max(0, Math.floor(revision)) + 1, 0x45d9f3b);
    value ^= Math.imul(Math.max(0, Math.floor(lane)) + 1, 0x27d4eb2d);
    value ^= Math.imul(reason + 1, 0x165667b1);
    value ^= value >>> 16;
    return value >>> 0;
}
