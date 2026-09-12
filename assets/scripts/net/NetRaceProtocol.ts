// 版本 38：按强化耗尽惩罚重分配角色体力为80～150，保留每级加1与其他属性。
// 版本 37：耗尽划水推进保留15%、动作轮速60%；体力仍不恢复。
// 版本 36：角色体力按爆发和体型取舍，初始 55～145 点；每级仍加 1。
// 版本 35：蹬墙独立爆发增幅 1.8%，跳水与海豚跳保留 0.6%。
// 版本 34：AI 发令同帧提交跳水；统一离台准备时长，移除随机反应延迟。
// 版本 33：角色初始爆发力分化为 45～100，每点起跳增幅 0.6%，三种起跳共享新倍率。
// 版本 32：爆发力仅缩放跳水、海豚跳与翻滚蹬墙初速，普通游速及推进衰减统一基准。
// 版本 31：成功海豚跳额外扣普通体力，不足扣至零；同帧刷新耗尽倍率，远端不重复扣费。
// 版本 30：成功海豚跳一次性增加心率负担，起跳至落水冻结心率；远端真人只消费 owner 权威结果。
// 版本 29：心率升温与恢复采用角色固有特性，玩家和 AI 统一按角色配置解析。
// 版本 28：真实划频心率、每划锁定 PERFECT（最低 30%）、划水事件携带心率、踢腿恢复速度。
// 版本 27：统一各入口划水轮速，修复续划长按计时，移除依赖显示的隐藏判定宽容。
// 版本 26：体力、技巧、爆发力每级各加 1 点，赛内参数统一从成长后的属性解析。
// 版本 25：角色等级上限统一为 30，旧高等级档案按新上限计算。
// 版本 24：角色面板体力直接等于赛内上限，双方按角色与等级解析相同点数。
// 版本 23：体力按划扣除，耗尽后固定减弱整划推进，心率仅显示；AI 同规则。
// Lobby-level protocol gate. Wire codecs remain append-compatible, but gameplay
// semantics are not safe across versions that disagree on owner condition/order.

// v22：GOOD 质量推进倍率与标准输入周期补偿，保证完美区中后段的推进收益。
// 保留 v21 直线划水首版手感的推进分配、水阻、按住轮速和低速动作节奏。
// 保留 v20 首入口无转向、所有入口 AI 共用世锦赛档的规则。
// 保留 v19 按住划水预支基础推进、松手扣除已支付部分的规则。
// 保留 v18 碰撞放大体重差异、AI 体重与外形一致的规则。
// 保留 v17 按角色体型设置的固定体重。
// 保留 v16 取消角色踢腿资质与等级加成的规则。
// 保留 v15 的泳道方向与网络字段布局。
// 版本39：技巧统一增强完整手臂推进，移除技巧连击超速映射，重分配角色技巧。
// 版本40：技巧初始档位拉开为84～114，成长曲线和其他角色属性不变。
// 版本41：三个入口依次为标准竞速200米、狂野200米、狂野400米，统一最高档AI。
export const NET_RACE_PROTOCOL_VERSION = 41;
const PROTOCOL_TAG = 'PV|';
const PROTOCOL_REQUEST_TAG = 'PVQ|';

export interface NetRaceProtocolHello {
    pos: number;
    version: number;
}

export interface NetRaceProtocolRequest {
    requesterPos: number;
}

export function encodeProtocolHello(pos: number): string {
    return `${PROTOCOL_TAG}${Math.floor(pos)}|${NET_RACE_PROTOCOL_VERSION}`;
}

export function decodeProtocolHello(message: string): NetRaceProtocolHello | null {
    if (typeof message !== 'string' || message.slice(0, PROTOCOL_TAG.length) !== PROTOCOL_TAG) {
        return null;
    }
    const parts = message.slice(PROTOCOL_TAG.length).split('|');
    if (parts.length !== 2) {
        return null;
    }
    const pos = parseInt(parts[0], 10);
    const version = parseInt(parts[1], 10);
    if (!Number.isFinite(pos) || pos < 0 || !Number.isFinite(version) || version < 0) {
        return null;
    }
    return { pos: Math.floor(pos), version: Math.floor(version) };
}

// Best-effort room broadcasts can lose a member's first PV| declaration. A peer
// that is still missing declarations sends PVQ|; every other modern client answers
// once with its ordinary PV| hello. Keeping request and response tags distinct
// avoids the unbounded hello echo loop that "reply to every PV|" would create.
export function encodeProtocolRequest(requesterPos: number): string {
    return `${PROTOCOL_REQUEST_TAG}${Math.floor(requesterPos)}`;
}

export function decodeProtocolRequest(message: string): NetRaceProtocolRequest | null {
    if (typeof message !== 'string'
        || message.slice(0, PROTOCOL_REQUEST_TAG.length) !== PROTOCOL_REQUEST_TAG) {
        return null;
    }
    const body = message.slice(PROTOCOL_REQUEST_TAG.length);
    if (!body || body.indexOf('|') >= 0) {
        return null;
    }
    const requesterPos = Number(body);
    if (!Number.isInteger(requesterPos) || requesterPos < 0) {
        return null;
    }
    return { requesterPos };
}

export function hasCompatibleProtocol(
    memberPositions: readonly number[],
    versions: Readonly<Record<number, number>>,
): boolean {
    if (memberPositions.length === 0) {
        return false;
    }
    for (const pos of memberPositions) {
        if (pos < 0 || versions[pos] !== NET_RACE_PROTOCOL_VERSION) {
            return false;
        }
    }
    return true;
}

export function isCompatibleProtocolVersion(value: unknown): boolean {
    return value === NET_RACE_PROTOCOL_VERSION;
}
