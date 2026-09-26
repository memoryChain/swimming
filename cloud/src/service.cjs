'use strict';

const crypto = require('node:crypto');
const { createDefaultProfile, PLAYER_PROFILE_SCHEMA } = require('./rules/backend/PlayerProfile');
const { executeCareer } = require('./rules/progression/CareerRules');
const { coinCostForLevel, PROGRESSION_BALANCE } = require('./rules/progression/ProgressionBalance');
const { AVATARS } = require('./rules/backend/IdentityConfig');
const { normalizePlayerCharacterSelection } = require('./rules/app/PlayerCharacterConfig');
const { CLOUD_PROTOCOL } = require('./rules/backend/CloudProtocol');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const token = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(value);
const MAX_COINS = 1000000000;
const TICKET_TTL = 24 * 60 * 60 * 1000;

class Rejected extends Error {
    constructor(code, message) { super(message); this.code = code; }
}
function requireValue(condition, code, message) { if (!condition) throw new Rejected(code, message); }
function checkDocument(doc) {
    requireValue(doc?.profile?.schema === PLAYER_PROFILE_SCHEMA && integer(doc.revision, 0, Number.MAX_SAFE_INTEGER)
        && integer(doc.profile.coins, 0, MAX_COINS) && doc.profile.characters && doc.profile.career,
    'SCHEMA', '存档版本不兼容，请联系管理员');
}
function envelope(doc, result = {}) {
    return { ok: true, playerId: doc.playerId, uid: doc.uid, revision: doc.revision, profile: doc.profile, result };
}
function failed(error, doc) {
    return { ...(doc ? envelope(doc) : {}), ok: false, code: error.code, message: error.message };
}

/** 注入数据库与时钟，测试执行真实规则和事务流程，不连接线上环境。 */
function createService({ db, appId, adminPlayerIds = [], adminWebUserIds = [], now = Date.now, uuid = crypto.randomUUID,
    seed = () => crypto.randomInt(0x100000000) }) {
    async function read(tx, collection, id) {
        // 入口必须使用 throwOnNotFound:false；其他数据库错误直接失败，不能误判新账号。
        const data = (await tx.collection(collection).doc(id).get()).data;
        if (!data) return null;
        // SDK 读出 _id，但 set 的 data 不能包含系统主键。
        const { _id, ...document } = data;
        return document;
    }
    const write = (tx, collection, id, data) => tx.collection(collection).doc(id).set({ data });
    async function assignUid(tx, doc) {
        if (doc.uid !== undefined) {
            requireValue(integer(doc.uid, 10000, Number.MAX_SAFE_INTEGER), 'SCHEMA', '玩家编号异常，请联系管理员');
            return;
        }
        // 计数器必须预先初始化；丢失时拒绝发号，避免从头分配重复编号。
        const counter = await read(tx, 'counters', 'playerUid');
        requireValue(counter && integer(counter.lastUid, 9999, Number.MAX_SAFE_INTEGER - 1),
            'UID_UNAVAILABLE', '玩家编号服务暂不可用，请联系管理员');
        doc.uid = counter.lastUid + 1;
        await write(tx, 'counters', 'playerUid', { lastUid: doc.uid });
        // 与计数器更新处于同一事务；事务重试时重新读取，不在事务外缓存编号。
        await write(tx, 'players', doc.playerId, doc);
    }
    function authenticate(context) {
        requireValue(appId && context.APPID === appId && typeof context.OPENID === 'string' && context.OPENID.length > 0,
            'AUTH', '账号验证失败，请重新进入游戏');
        return hash(`${appId}:${context.OPENID}`);
    }
    function protocol(event) {
        requireValue(event && event.protocol === CLOUD_PROTOCOL.version && event.rulesVersion === CLOUD_PROTOCOL.rulesVersion,
            'VERSION', '游戏版本已更新，请重新进入游戏');
        requireValue(event.data && typeof event.data === 'object' && !Array.isArray(event.data)
            && Buffer.byteLength(JSON.stringify(event)) <= 16000, 'INPUT', '请求参数无效');
    }
    function validateMutation(event) {
        requireValue(token(event.requestId) && token(event.writerId) && integer(event.expectedRevision, 0, Number.MAX_SAFE_INTEGER),
            'INPUT', '请求参数无效');
    }
    function applyPlayer(doc, event, time) {
        const p = doc.profile, data = event.data;
        if (event.action === 'identity') {
            requireValue(Object.keys(data).length > 0 && Object.keys(data).every(k => ['nickName', 'avatarId'].includes(k)),
                'INPUT', '身份参数无效');
            if (data.nickName !== undefined) {
                // 当前产品只有随机昵称；限制为同一生成语法，任意自由文本需另接内容审核。
                requireValue(typeof data.nickName === 'string' && /^小(?:鸡|鸭|猫|狗|兔|熊|猪|鹅|鱼|虾|龟|鹿|象|狮|虎|豹|猴|羊|牛|马|蛙|鲸|海豚|水獭)[1-9][0-9]{3}$/.test(data.nickName),
                    'INPUT', '昵称无效');
                p.nickName = data.nickName;
            }
            if (data.avatarId !== undefined) {
                requireValue(AVATARS.some(a => a.id === data.avatarId), 'INPUT', '头像无效'); p.avatarId = data.avatarId;
            }
            return {};
        }
        if (event.action === 'selection') {
            const selection = normalizePlayerCharacterSelection(data);
            requireValue(Object.keys(data).length === 3 && Object.keys(selection).every(k => data[k] === selection[k])
                && owns(p.characters, selection.characterId), 'INPUT', '角色外观无效');
            p.characterSelection = selection; return {};
        }
        if (event.action === 'level') {
            requireValue(typeof data.characterId === 'string' && owns(p.characters, data.characterId)
                && integer(data.requestedLevels, 1, PROGRESSION_BALANCE.maxLevel), 'INPUT', '升级参数无效');
            const progress = p.characters[data.characterId];
            let levelsGained = 0, coinsSpent = 0;
            const maxed = progress.level >= PROGRESSION_BALANCE.maxLevel;
            while (levelsGained < data.requestedLevels && progress.level < PROGRESSION_BALANCE.maxLevel) {
                const cost = coinCostForLevel(progress.level);
                if (p.coins < cost) break;
                p.coins -= cost; coinsSpent += cost; progress.level++; levelsGained++;
            }
            return { ok: levelsGained > 0, levelsGained, coinsSpent,
                ...(levelsGained ? {} : { reason: maxed ? 'maxed' : 'insufficient' }) };
        }
        requireValue(event.action === 'career', 'FORBIDDEN', '不支持此存档操作');
        requireValue(['begin', 'settle', 'abandon'].includes(data.type), 'INPUT', '比赛操作无效');
        const command = clone(data);
        if (command.type === 'begin') {
            requireValue(owns(p.characters, command.characterId) && integer(command.tier, 0, 5)
                && ['quick', 'league', 'cup'].includes(command.source)
                && [200, 400].includes(command.distance) && ['standard', 'wild'].includes(command.rule), 'INPUT', '比赛参数无效');
            requireValue(!p.career.pending || doc.pendingWriter === event.writerId || time - doc.pendingAt > TICKET_TTL,
                'BUSY', '其他设备有未结束比赛，请先完成或联系管理员');
            command.seed = seed();
        } else if (command.type === 'settle') {
            const ticket = p.career.pending;
            requireValue(ticket && ticket.id === command.ticketId && doc.pendingWriter === event.writerId
                && time - doc.pendingAt <= TICKET_TTL, 'TICKET', '比赛记录已失效');
            requireValue(typeof command.finished === 'boolean' && integer(command.racerCount, 2, 8)
                && integer(command.placement, 1, command.racerCount)
                && ['perfectCount', 'goodCount', 'missCount', 'maxCombo'].every(k => integer(command[k], 0, 100000))
                && command.maxCombo <= command.perfectCount + command.goodCount + command.missCount
                && Number.isFinite(command.time) && command.time >= 0 && command.time <= 7200,
            'INPUT', '比赛结果无效');
            const racers = (ticket.ai.opponentCount ?? ticket.ai.intelligence.length) + 1;
            requireValue(command.racerCount === racers, 'INPUT', '参赛人数不匹配');
            // 只做保守合理性检查，不把客户端结果当作已完成强反作弊验证。
            if (command.finished) requireValue(command.time >= ticket.distance / 50
                && command.time * 1000 <= time - doc.pendingAt + 10000, 'RESULT', '比赛耗时无效');
        } else {
            requireValue(owns(p.characters, command.characterId), 'INPUT', '角色不存在');
            requireValue(!p.career.pending || doc.pendingWriter === event.writerId, 'BUSY', '其他设备有未结束比赛');
        }
        const result = executeCareer(p, command);
        requireValue(result.ok, 'CAREER', result.message);
        if (command.type === 'begin') {
            // 随机凭据不会因回档或本地 serial 重置而复用。
            result.ticket.id = `race-${uuid()}`;
            doc.pendingWriter = event.writerId; doc.pendingAt = time;
        } else if (!p.career.pending) { doc.pendingWriter = ''; doc.pendingAt = 0; }
        const { profile: _profile, ...payload } = result;
        requireValue(integer(p.coins, 0, MAX_COINS), 'LIMIT', '金币余额超出限制');
        return payload;
    }

    async function player(event, context) {
        let playerId;
        try {
            playerId = authenticate(context); protocol(event);
            requireValue(['load', 'identity', 'selection', 'level', 'career'].includes(event.action), 'FORBIDDEN', '不支持此存档操作');
            if (event.action !== 'load') validateMutation(event);
            const time = now();
            return await db.runTransaction(async tx => {
                let doc = await read(tx, 'players', playerId);
                if (!doc) {
                    requireValue(event.action === 'load', 'MISSING', '请先读取存档');
                    doc = { playerId, profile: createDefaultProfile(), revision: 0, createdAt: time, updatedAt: time,
                        pendingWriter: '', pendingAt: 0 };
                }
                checkDocument(doc);
                await assignUid(tx, doc);
                if (event.action === 'load') return envelope(doc);
                const before = clone(doc);
                try {
                    const operationId = hash(`${playerId}:${event.requestId}`);
                    const fingerprint = hash(JSON.stringify(event));
                    const previous = await read(tx, 'operations', operationId);
                    if (previous) {
                        requireValue(previous.fingerprint === fingerprint, 'REUSED_ID', '请求标识已用于其他操作');
                        if (previous.result.ticket) requireValue(doc.profile.career.pending?.id === previous.result.ticket.id,
                            'TICKET', '比赛记录已失效');
                        return envelope(doc, previous.result);
                    }
                    requireValue(event.expectedRevision === doc.revision, 'CONFLICT', '存档已更新，请重试当前操作');
                    const result = applyPlayer(doc, event, time);
                    doc.revision++; doc.updatedAt = time;
                    await write(tx, 'players', playerId, doc);
                    await write(tx, 'operations', operationId, { playerId, requestId: event.requestId,
                        fingerprint, result, revision: doc.revision, createdAt: time });
                    return envelope(doc, result);
                } catch (error) {
                    if (error instanceof Rejected) return failed(error, before);
                    throw error;
                }
            });
        } catch (error) {
            if (error instanceof Rejected) return failed(error);
            // 不输出档案、令牌或 OPENID。
            console.error('[cloud-player]', error.code || 'DATABASE_ERROR');
            return { ok: false, code: 'INTERNAL', message: '存档服务暂不可用，请重试' };
        }
    }

    // webIdentity 只能由服务端 SDK 提供；绝不从 event 接受网页身份。
    async function admin(event, context, webIdentity = {}) {
        try {
            let actor;
            if (webIdentity.uid) {
                requireValue(typeof webIdentity.uid === 'string' && adminWebUserIds.includes(webIdentity.uid), 'FORBIDDEN', '无管理权限');
                actor = `web:${webIdentity.uid}`;
            } else {
                actor = authenticate(context);
                requireValue(adminPlayerIds.includes(actor), 'FORBIDDEN', '无管理权限');
            }
            protocol(event);
            if (event.action === 'me') return { ok: true, actor };
            if (event.action === 'search' || event.action === 'history') {
                const offset = event.data.offset ?? 0;
                requireValue(integer(offset, 0, 10000), 'INPUT', '分页参数无效');
                let query;
                if (event.action === 'search') {
                    const term = event.data.term ?? '';
                    requireValue(typeof term === 'string' && term.length <= 64, 'INPUT', '请输入玩家 ID 或完整昵称');
                    query = db.collection('players');
                    if (term) {
                        if (/^[a-f0-9]{64}$/.test(term)) query = query.where({ playerId: term });
                        else if (/^[0-9]+$/.test(term)) {
                            requireValue(integer(Number(term), 10000, Number.MAX_SAFE_INTEGER), 'INPUT', '玩家编号无效');
                            query = query.where({ uid: Number(term) });
                        } else query = query.where({ 'profile.nickName': term });
                    }
                } else {
                    requireValue(typeof event.data.playerId === 'string' && /^[a-f0-9]{64}$/.test(event.data.playerId),
                        'INPUT', '玩家标识无效');
                    query = db.collection('adminAudit').where({ playerId: event.data.playerId });
                }
                const rows = (await query.orderBy('createdAt', 'desc').orderBy('_id', 'desc').skip(offset).limit(21).get()).data;
                const items = rows.slice(0, 20).map(doc => event.action === 'search' ? {
                    playerId: doc.playerId, uid: doc.uid, nickName: doc.profile.nickName, coins: doc.profile.coins,
                    revision: doc.revision, updatedAt: doc.updatedAt,
                } : {
                    auditId: doc._id, actor: doc.actor, action: doc.action, reason: doc.reason,
                    revision: doc.revision, createdAt: doc.createdAt,
                    before: { coins: doc.before.coins, characters: doc.before.characters },
                    after: { coins: doc.after.coins, characters: doc.after.characters },
                });
                return { ok: true, items, nextOffset: rows.length > 20 ? offset + 20 : null };
            }
            const { playerId, reason } = event.data;
            requireValue(typeof playerId === 'string' && /^[a-f0-9]{64}$/.test(playerId), 'INPUT', '玩家标识无效');
            requireValue(['inspect', 'coins', 'level', 'clearPending', 'restore'].includes(event.action), 'INPUT', '管理操作无效');
            if (event.action !== 'inspect') {
                validateMutation(event);
                requireValue(typeof reason === 'string' && reason.trim().length >= 2 && reason.length <= 200, 'INPUT', '请填写修改原因');
            }
            const time = now();
            return await db.runTransaction(async tx => {
                const doc = await read(tx, 'players', playerId);
                requireValue(doc, 'MISSING', '玩家不存在'); checkDocument(doc);
                if (event.action === 'inspect') return envelope(doc);
                const id = hash(`admin:${actor}:${event.requestId}`), fingerprint = hash(JSON.stringify(event));
                const prior = await read(tx, 'adminAudit', id);
                if (prior) {
                    requireValue(prior.fingerprint === fingerprint, 'REUSED_ID', '请求标识已用于其他操作');
                    return envelope(doc, { auditId: id });
                }
                requireValue(event.expectedRevision === doc.revision, 'CONFLICT', '存档已更新，请重新查看后修改');
                const before = clone(doc.profile);
                if (event.action === 'coins') {
                    const { delta } = event.data;
                    requireValue(integer(delta, -1000000, 1000000) && delta !== 0
                        && integer(doc.profile.coins + delta, 0, MAX_COINS), 'INPUT', '金币调整无效');
                    doc.profile.coins += delta;
                } else if (event.action === 'level') {
                    const { characterId, level } = event.data;
                    requireValue(owns(doc.profile.characters, characterId) && integer(level, 1, PROGRESSION_BALANCE.maxLevel),
                        'INPUT', '等级调整无效');
                    doc.profile.characters[characterId].level = level;
                } else if (event.action === 'restore') {
                    requireValue(typeof event.data.auditId === 'string' && /^[a-f0-9]{64}$/.test(event.data.auditId), 'INPUT', '备份标识无效');
                    const source = await read(tx, 'adminAudit', event.data.auditId);
                    requireValue(source?.playerId === playerId && source.before?.schema === PLAYER_PROFILE_SCHEMA, 'INPUT', '备份不可用');
                    doc.profile = clone(source.before);
                    doc.profile.career.serial = Math.max(before.career.serial, doc.profile.career.serial);
                }
                // 管理操作撤销未结算赛事，避免旧成绩按已被修改的经济状态继续领奖。
                doc.profile.career.pending = null; doc.pendingWriter = ''; doc.pendingAt = 0;
                doc.revision++; doc.updatedAt = time;
                await write(tx, 'players', playerId, doc);
                await write(tx, 'adminAudit', id, { playerId, actor, fingerprint, requestId: event.requestId,
                    action: event.action, reason: reason.trim(), before, after: clone(doc.profile),
                    revision: doc.revision, createdAt: time });
                return envelope(doc, { auditId: id });
            });
        } catch (error) {
            if (error instanceof Rejected) return failed(error);
            console.error('[cloud-admin]', error.code || 'DATABASE_ERROR');
            return { ok: false, code: 'INTERNAL', message: '管理操作失败，请使用原请求标识重试' };
        }
    }
    return { player, admin };
}
module.exports = { createService };
