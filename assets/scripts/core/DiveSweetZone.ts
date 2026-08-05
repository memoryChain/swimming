// DiveSweetZone: 起跳蓄力的甜区机制。把「蓄力值越高越好」的线性映射，改成「离随机甜区
// 中心越近，起跳力度越接近 100%」的距离衰减映射。甜区中心每局由 SharedRNG 随机，
// 玩家无法背时间卡固定顶点。纯函数、无 Cocos 依赖，本地与远端共用同一套映射。
//
// 三档结果沿用 DiveResolver 既有的质量分档：PERFECT->CLEAN/HIGH、GOOD->NORMAL/OK、
// MISS->MESSY/LOW。弱起与凌乱入水的代价由 DiveResult 既有字段(初速/心率抖动/进区划数)兑现，
// 不新增抢跑/DQ 概念。

import { DIVE_BALANCE } from './GameBalance';
import { randomRange } from './SharedRNG';

export interface DiveSweetZone {
    // 甜区中心在 0..1 蓄力轴上的位置（每局随机）。
    center: number;
    // PERFECT 带半宽：落在此范围内为干净入水。
    perfectHalf: number;
    // GOOD 带半宽(>=perfectHalf)：落在此范围内为普通入水，之外为凌乱入水。
    goodHalf: number;
}

export type DiveSweetRating = 'PERFECT' | 'GOOD' | 'MISS';

// 每局开始时调用一次，用共享随机流生成甜区中心(主机种子确定，跨端一致)。
export function rollDiveSweetZone(): DiveSweetZone {
    const cfg = DIVE_BALANCE.sweetZone;
    return {
        center: randomRange(cfg.centerMin, cfg.centerMax),
        perfectHalf: cfg.perfectHalfWidth,
        goodHalf: cfg.goodHalfWidth,
    };
}

export function diveSweetRating(charge: number, zone: DiveSweetZone): DiveSweetRating {
    const dist = Math.abs(clamp01(charge) - zone.center);
    if (dist <= zone.perfectHalf) {
        return 'PERFECT';
    }
    if (dist <= zone.goodHalf) {
        return 'GOOD';
    }
    return 'MISS';
}

// 蓄力值(0..1) -> 起跳力度(0..1)：按到甜区中心的距离分段衰减。
//   中心               -> perfectPower(满力)
//   PERFECT 带边缘      -> perfectEdgePower
//   GOOD 带边缘         -> goodEdgePower
//   更远(饱和于 missSpan)-> minPower
export function resolveDivePower(charge: number, zone: DiveSweetZone): number {
    const cfg = DIVE_BALANCE.sweetZone;
    const dist = Math.abs(clamp01(charge) - zone.center);
    if (dist <= zone.perfectHalf) {
        const t = zone.perfectHalf > 0 ? dist / zone.perfectHalf : 0;
        return lerp(cfg.perfectPower, cfg.perfectEdgePower, t);
    }
    if (dist <= zone.goodHalf) {
        const span = zone.goodHalf - zone.perfectHalf;
        const t = span > 0 ? (dist - zone.perfectHalf) / span : 0;
        return lerp(cfg.perfectEdgePower, cfg.goodEdgePower, t);
    }
    const over = clamp01((dist - zone.goodHalf) / cfg.missSpan);
    return lerp(cfg.goodEdgePower, DIVE_BALANCE.minPower, over);
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}
