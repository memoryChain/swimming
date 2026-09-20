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
    '急救中',
    '正在抢救',
    '状态恢复中',
] as const;

const GENERAL_COPY = [
    '先躺会儿',
    '队医冲刺中',
    '救生员已接单',
    '氧气正在充值',
    '正在重新开机',
    '泳帽还在问题不大',
    '正在把姿势摆正',
    '请勿催促救援人员',
] as const;

const SHARK_COPY = [
    '鲨口余生',
    '正在检查牙印',
    '这口有点狠',
    '被当成了加餐',
    '今日不宜喂鲨鱼',
    '队医正在数牙印',
    '正在与鲨鱼和解',
    '鲨鱼表示很满意',
] as const;

const CANNON_COPY = [
    '炮弹已签收',
    '落点过于精准',
    '正在掸灰',
    '泳道临时维修',
    '这发有点响',
    '正在回收冲击力',
    '礼炮方向似乎反了',
    '队医已抵达爆点',
] as const;

const TIMED_BOMB_COPY = [
    '正在重新组装',
    '零件正在归位',
    '烟散了继续游',
    '拆弹稍微晚了一步',
    '刚才是不是响了',
    '正在确认完整度',
    '下次记得轻拿轻放',
    '倒计时有点认真',
] as const;

const MINEFIELD_COPY = [
    '水雷表示很抱歉',
    '这一脚非常精准',
    '正在检查落脚点',
    '泳道里不该有这个',
    '触雷姿势很标准',
    '正在重新找平衡',
    '这颗水雷有脾气',
    '下次记得绕过去',
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
