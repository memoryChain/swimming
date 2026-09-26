const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { build } = require('../scripts/build-wechat-cloud.cjs');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'swimming-cloud-'));
build(output);
test.after(() => fs.rmSync(output, { recursive: true, force: true }));
const { createService } = require(path.join(output, 'swimming-player/service.cjs'));
const { createDefaultProfile } = require(path.join(output, 'swimming-player/rules/backend/PlayerProfile.js'));
const characterId = Object.keys(createDefaultProfile().characters)[0];
const copy = value => JSON.parse(JSON.stringify(value));

class Database {
    data = new Map([['counters/playerUid', { lastUid: 9999 }]]); queue = Promise.resolve(); fail = false; retry = false;
    collection(name) {
        let filter = {}, offset = 0, limit = 20; const orders = [];
        const query = {
            where(value) { filter = value; return query; },
            orderBy(key, direction) { orders.push([key, direction]); return query; },
            skip(value) { offset = value; return query; },
            limit(value) { limit = value; return query; },
            get: async () => {
                const valueAt = (row, key) => key.split('.').reduce((value, part) => value?.[part], row);
                const rows = [...this.data].filter(([key]) => key.startsWith(`${name}/`))
                    .map(([key, value]) => ({ ...copy(value), _id: key.slice(name.length + 1) }))
                    .filter(row => Object.entries(filter).every(([key, value]) => valueAt(row, key) === value));
                rows.sort((a, b) => {
                    for (const [key, direction] of orders) {
                        const av = valueAt(a, key), bv = valueAt(b, key);
                        if (av !== bv) return (av < bv ? -1 : 1) * (direction === 'desc' ? -1 : 1);
                    }
                    return 0;
                });
                return { data: rows.slice(offset, offset + limit) };
            },
        };
        return query;
    }
    runTransaction(work) {
        const task = this.queue.then(async () => {
            if (this.fail) throw Error('数据库暂不可用');
            const run = async () => {
                const snapshot = new Map([...this.data].map(([k, v]) => [k, copy(v)]));
                const tx = { collection: name => ({ doc: id => ({
                    get: async () => ({ data: snapshot.has(`${name}/${id}`) ? { ...copy(snapshot.get(`${name}/${id}`)), _id: id } : null }),
                    set: async ({ data }) => { assert.equal(Object.hasOwn(data, '_id'), false); snapshot.set(`${name}/${id}`, copy(data)); },
                }) }) };
                return { snapshot, result: await work(tx) };
            };
            if (this.retry) { this.retry = false; await run(); }
            const { snapshot, result } = await run(); this.data = snapshot; return copy(result);
        });
        this.queue = task.catch(() => {}); return task;
    }
}
function harness() {
    const db = new Database(); let time = 1800000000000, sequence = 0;
    const admins = [], context = { APPID: 'wx-test', OPENID: 'user-a' };
    const service = createService({ db, appId: context.APPID, adminPlayerIds: admins,
        now: () => time, uuid: () => `ticket-${++sequence}`, seed: () => 123 });
    const request = (action = 'load', data = {}, revision = 0, extra = {}) => ({ protocol: 1, rulesVersion: 1,
        action, data, writerId: 'device-00001', expectedRevision: revision, requestId: `request-${++sequence}`, ...extra });
    const player = e => service.player(e, context);
    async function load() { return player(request()); }
    async function compensate(amount = 10000) {
        const p = await load(); admins.push(p.playerId);
        return service.admin(request('coins', { playerId: p.playerId, delta: amount, reason: '测试补偿' }, p.revision), context);
    }
    return { db, context, service, admins, request, player, load, compensate, advance: ms => { time += ms; } };
}
const beginData = { type: 'begin', characterId, source: 'quick', tier: 0, distance: 200, rule: 'standard', seed: 999 };
const settlement = ticket => ({ type: 'settle', ticketId: ticket.id, finished: true, placement: 1,
    racerCount: (ticket.ai.opponentCount ?? ticket.ai.intelligence.length) + 1,
    perfectCount: 80, goodCount: 10, missCount: 10, maxCombo: 80, time: 82 });

test('可信账号建档隔离、并发首次建档、数据库失败不创建默认档', async () => {
    const h = harness();
    const [a, b] = await Promise.all([h.load(), h.load()]);
    assert.equal(a.playerId, b.playerId); assert.equal(a.profile.coins, 0); assert.equal(h.db.data.size, 2);
    const other = await h.service.player(h.request('load', { openid: h.context.OPENID }), { ...h.context, OPENID: 'user-b' });
    assert.notEqual(a.playerId, other.playerId);
    assert.equal((await h.service.player(h.request(), {})).code, 'AUTH');
    assert.equal((await h.service.player(h.request(), { ...h.context, APPID: 'wrong' })).code, 'AUTH');
    h.db.fail = true; assert.equal((await h.load()).code, 'INTERNAL'); assert.equal(h.db.data.size, 3);
});

test('重试同一升级只扣一次；两台设备的旧版本升级不覆盖新余额', async () => {
    const h = harness(), initial = await h.compensate();
    const request = h.request('level', { characterId, requestedLevels: 1 }, initial.revision);
    h.db.retry = true;
    const result = await h.player(request), repeat = await h.player(copy(request));
    assert.equal(result.profile.coins, 9200); assert.equal(repeat.profile.coins, 9200);
    assert.equal(result.revision, repeat.revision); assert.equal(result.profile.characters[characterId].level, 2);
    const changed = copy(request); changed.data.requestedLevels = 2;
    assert.equal((await h.player(changed)).code, 'REUSED_ID');
    const concurrent = await Promise.all([1, 2].map(i => h.player(h.request('level', { characterId, requestedLevels: 1 }, result.revision,
        { writerId: `device-0000${i}` }))));
    assert.equal(concurrent.filter(x => x.ok).length, 1); assert.equal(concurrent.filter(x => x.code === 'CONFLICT').length, 1);
    assert.equal((await h.load()).profile.characters[characterId].level, 3);
});

test('客户端整档覆盖、调试发币、未验证广告发币和畸形参数均拒绝', async () => {
    const h = harness(); await h.load();
    for (const action of ['saveProfile', 'debug', 'ad', 'coins']) assert.equal((await h.player(h.request(action, { coins: 999 }))).code, 'FORBIDDEN');
    assert.equal((await h.player(h.request('level', { characterId: '__proto__', requestedLevels: 1 }))).code, 'INPUT');
    assert.equal((await h.player(h.request('level', { characterId, requestedLevels: -1 }))).code, 'INPUT');
    assert.equal((await h.player(h.request('identity', { nickName: '自由输入的昵称' }))).code, 'INPUT');
    assert.equal((await h.player(h.request('selection', { characterId, skinToneId: 'wrong', colorSchemeId: 'wrong' }))).code, 'INPUT');
    assert.equal((await h.player({ ...h.request(), rulesVersion: 999 })).code, 'VERSION');
    assert.equal((await h.load()).profile.coins, 0);
});

test('云端比赛种子和凭据、重复结算、伪造结果、跨设备赛事冲突', async () => {
    const h = harness(); await h.load();
    const first = await h.player(h.request('career', beginData)); assert.equal(first.ok, true);
    assert.equal(first.result.ticket.seed, 123); assert.match(first.result.ticket.id, /^race-ticket-/);
    assert.equal((await h.player(h.request('career', beginData, first.revision, { writerId: 'another-device' }))).code, 'BUSY');
    const bad = settlement(first.result.ticket); bad.maxCombo = 9999;
    assert.equal((await h.player(h.request('career', bad, first.revision))).code, 'INPUT');
    h.advance(90000);
    const request = h.request('career', settlement(first.result.ticket), first.revision);
    const result = await h.player(request), repeat = await h.player(copy(request));
    assert.equal(result.ok, true); assert.equal(result.profile.coins, 480);
    assert.deepEqual(repeat, result); assert.equal(result.profile.career.pending, null);
    assert.equal((await h.player(h.request('career', settlement(first.result.ticket), result.revision))).code, 'TICKET');
});

test('管理员校验、审计、版本冲突、重试幂等、撤销管理修改且版本递增', async () => {
    const h = harness(), p = await h.load();
    const request = h.request('coins', { playerId: p.playerId, delta: 500, reason: '用户补偿' }, p.revision);
    assert.equal((await h.service.admin(request, h.context)).code, 'FORBIDDEN');
    h.admins.push(p.playerId);
    const modified = await h.service.admin(request, h.context);
    assert.equal(modified.profile.coins, 500); assert.equal(modified.revision, 1);
    assert.deepEqual(await h.service.admin(copy(request), h.context), modified);
    assert.equal((await h.player(h.request('identity', { avatarId: 'coral' }, 0))).code, 'CONFLICT');
    const audit = h.db.data.get(`adminAudit/${modified.result.auditId}`);
    assert.equal(audit.before.coins, 0); assert.equal(audit.after.coins, 500); assert.equal(audit.actor, p.playerId);
    const restored = await h.service.admin(h.request('restore', { playerId: p.playerId,
        auditId: modified.result.auditId, reason: '撤销误操作' }, modified.revision), h.context);
    assert.equal(restored.profile.coins, 0); assert.equal(restored.revision, 2);
});

test('管理员修改取消未结算赛事，旧赛果不能在回档后领奖', async () => {
    const h = harness(); await h.load();
    const started = await h.player(h.request('career', beginData)); h.advance(90000);
    const changed = await h.compensate(500);
    const rejected = await h.player(h.request('career', settlement(started.result.ticket), changed.revision));
    assert.equal(rejected.code, 'TICKET'); assert.equal(rejected.profile.coins, 500);
});

test('管理面板身份、查人和审计查询须鉴权，支持准确查询及分页', async () => {
    const h = harness(), p = await h.load();
    for (const action of ['me', 'search', 'history']) {
        assert.equal((await h.service.admin(h.request(action, { playerId: p.playerId }), h.context)).code, 'FORBIDDEN');
    }
    h.admins.push(p.playerId);
    const call = (action, data = {}) => h.service.admin(h.request(action, data), h.context);
    assert.equal((await call('me')).actor, p.playerId);
    assert.equal((await call('search', { term: p.playerId })).items[0].playerId, p.playerId);
    assert.equal((await call('search', { term: String(p.uid) })).items[0].uid, 10000);
    assert.equal((await call('search', { term: '99999999999999999999' })).code, 'INPUT');
    assert.equal((await call('search', { term: p.profile.nickName })).items.length, 1);
    assert.equal((await call('search', { term: '不存在的玩家' })).items.length, 0);
    assert.equal((await call('search', { term: { $ne: null } })).code, 'INPUT');
    assert.equal((await call('search', { offset: -1 })).code, 'INPUT');
    const changed = await h.compensate(500);
    const audit = (await call('history', { playerId: p.playerId })).items[0];
    assert.equal(audit.auditId, changed.result.auditId);
    assert.equal(audit.before.coins, 0); assert.equal(audit.after.coins, 500);
    assert.equal(audit.fingerprint, undefined);
    for (let i = 0; i < 24; i++) {
        await h.service.player(h.request(), { ...h.context, OPENID: `page-${i}` });
    }
    const first = await call('search'), second = await call('search', { offset: first.nextOffset });
    assert.equal(first.items.length, 20); assert.equal(second.items.length, 5);
    assert.equal(second.nextOffset, null);
    assert.equal(new Set([...first.items, ...second.items].map(item => item.playerId)).size, 25);
});

test('网页管理员只接受服务端可信 UID，不相信请求伪造身份，审计注明来源', async () => {
    const h = harness(), p = await h.load();
    const web = createService({ db: h.db, appId: h.context.APPID, adminWebUserIds: ['operator-1'] });
    assert.equal((await web.admin(h.request('me', { uid: 'operator-1' }), {})).code, 'AUTH');
    assert.equal((await web.admin(h.request('me'), {}, { uid: 'stranger' })).code, 'FORBIDDEN');
    assert.equal((await web.admin(h.request('me'), {}, { uid: 'operator-1' })).actor, 'web:operator-1');
    const changed = await web.admin(h.request('coins', { playerId: p.playerId, delta: 100, reason: '网页补偿' }), {}, { uid: 'operator-1' });
    assert.equal(changed.ok, true);
    assert.equal(h.db.data.get(`adminAudit/${changed.result.auditId}`).actor, 'web:operator-1');
});

function client(h, storage = new Map(), options = {}) {
    const ts = process.env.TYPESCRIPT_PATH ? require(process.env.TYPESCRIPT_PATH) : (() => {
        for (const item of process.env.PATH.split(path.delimiter)) {
            const file = path.resolve(item, '../typescript/lib/typescript.js'); if (fs.existsSync(file)) return require(file);
        }
        return require('typescript');
    })();
    let drop = 0, offline = false, account = h.context, calls = 0;
    const localStorage = { getItem: k => storage.get(k) ?? null,
        setItem: (k, v) => { if (options.failWrite && k.endsWith('.pending')) throw Error('本地空间不足'); storage.set(k, v); },
        removeItem: k => storage.delete(k) };
    const wx = { cloud: { init() {}, callFunction({ data, success, fail }) {
        calls++; if (offline) { queueMicrotask(() => fail({})); return; }
        h.service.player(copy(data), account).then(result => {
            if (data.action !== 'load' && drop > 0) { drop--; fail({}); } else success({ result });
        }, fail);
    } } };
    const cache = new Map();
    let activeBackend;
    const sandbox = vm.createContext({ console, wx, setTimeout, clearTimeout });
    function load(file) {
        if (cache.has(file)) return cache.get(file).exports;
        const module = { exports: {} }; cache.set(file, module);
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
            target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
        } }).outputText;
        const requireLocal = id => {
            if (id === 'cc') return { sys: { localStorage } };
            if (id === './BackendManager') return { backend: () => activeBackend };
            if (id === './WechatCloudConfig') return { WECHAT_CLOUD_CONFIG: { environmentId: options.noEnv ? '' : 'test-env', functionName: 'swimming-player', timeoutMs: 1000 } };
            return load(path.resolve(path.dirname(file), id + '.ts'));
        };
        vm.runInContext(`(function(require,module,exports){${code}\n})`, sandbox)(requireLocal, module, module.exports);
        return module.exports;
    }
    const { WechatCloudBackend } = load(path.resolve(__dirname, '../assets/scripts/backend/WechatCloudBackend.ts'));
    activeBackend = new WechatCloudBackend();
    return { backend: activeBackend, data: () => load(path.resolve(__dirname, '../assets/scripts/backend/PlayerData.ts')).PlayerData, storage, options, calls: () => calls, drop: n => { drop = n; }, offline: v => { offline = v; },
        account: value => { account = value; } };
}

test('响应丢失自动重试只升级一次，原本地测试档保持不变', async () => {
    const h = harness(); await h.compensate();
    const original = JSON.stringify({ coins: 99999 }), storage = new Map([['swimming.player-profile', original]]);
    const c = client(h, storage); await c.backend.loadProfile(); c.drop(1);
    const result = await c.backend.spendCoinsForLevel(characterId, 1);
    assert.equal(result.profile.coins, 9200); assert.equal(result.levelsGained, 1);
    assert.equal(storage.get('swimming.player-profile'), original);
    assert.equal([...storage.keys()].some(k => k.endsWith('.pending')), false);
});

test('两次响应丢失后重启恢复原请求，云端故障不退回本地档', async () => {
    const h = harness(); await h.compensate(); const c = client(h); await c.backend.loadProfile(); c.drop(2);
    await assert.rejects(c.backend.spendCoinsForLevel(characterId, 1));
    assert.equal([...c.storage.keys()].some(k => k.endsWith('.pending')), true);
    const restarted = client(h, c.storage), profile = await restarted.backend.loadProfile();
    assert.equal(profile.coins, 9200); assert.equal(profile.characters[characterId].level, 2);
    // 玩家点击重试同一升级，应拿到恢复的结果，不再次扣钱。
    const retried = await restarted.backend.spendCoinsForLevel(characterId, 1);
    assert.equal(retried.profile.coins, 9200);
    restarted.offline(true); await assert.rejects(restarted.backend.loadProfile());
    assert.equal((await h.load()).profile.coins, 9200);
});

test('先写持久化请求才发送；缺云环境不能悄悄创建本地经济档', async () => {
    const h = harness(); await h.compensate(); const options = { failWrite: true }, c = client(h, new Map(), options);
    await c.backend.loadProfile(); const calls = c.calls();
    await assert.rejects(c.backend.spendCoinsForLevel(characterId, 1)); assert.equal(c.calls(), calls);
    const unconfigured = client(h, new Map(), { noEnv: true }); await assert.rejects(unconfigured.backend.loadProfile());
    assert.equal(unconfigured.calls(), 0);
});

test('云端新档不继承本地作弊金币，不同账号不重放旧账号待发送操作', async () => {
    const h = harness(), c = client(h, new Map([['swimming.player-profile', '{"coins":99999}']]));
    assert.equal((await c.backend.loadProfile()).coins, 0);
    c.offline(true); await assert.rejects(c.backend.saveIdentity({ avatarId: 'coral' }));
    const other = client(h, c.storage); other.account({ ...h.context, OPENID: 'user-b' });
    const p = await other.backend.loadProfile(); assert.equal(p.coins, 0);
    assert.equal([...c.storage.keys()].filter(k => k.endsWith('.pending')).length, 1);
    c.offline(false); c.account({ ...h.context, OPENID: 'user-b' });
    await assert.rejects(c.backend.loadProfile(), error => error.code === 'ACCOUNT_CHANGED');
});

test('管理员改档后客户端旧请求冲突，重新读取恢复新值', async () => {
    const h = harness(), c = client(h); await c.backend.loadProfile(); await h.compensate(5000);
    await assert.rejects(c.backend.spendCoinsForLevel(characterId, 1), error => error.code === 'CONFLICT');
    assert.equal((await c.backend.loadProfile()).coins, 5000);
    assert.equal((await c.backend.spendCoinsForLevel(characterId, 1)).profile.coins, 4200);
});


test('另一设备修改头像后仍结算原赛事，响应丢失不重复领奖', async () => {
    const h = harness(), c = client(h); await c.backend.loadProfile();
    const started = await c.backend.executeCareer(beginData); h.advance(90000);
    const state = await h.load();
    await h.player(h.request('identity', { avatarId: 'coral' }, state.revision, { writerId: 'other-device' }));
    c.drop(1);
    const result = await c.backend.executeCareer(settlement(started.ticket));
    assert.equal(result.profile.coins, 480); assert.equal(result.profile.avatarId, 'coral');
    assert.equal(result.profile.career.pending, null);
});

test('PlayerData 在云端响应丢失后恢复同一升级，不重新扣款，刷新失败不开放档案', async () => {
    const h = harness(); await h.compensate(); const c = client(h), data = c.data();
    await data.load(); c.drop(2);
    await assert.rejects(data.spendCoinsForLevel(characterId, 1)); assert.equal(data.loaded, false);
    const retry = await data.spendCoinsForLevel(characterId, 1);
    assert.equal(retry.levelsGained, 1); assert.equal(data.coins, 9200); assert.equal(data.loaded, true);
    c.offline(true); await data.load(true); assert.equal(data.loaded, false);
    c.offline(false); await data.load(true); assert.equal(data.loaded, true); assert.equal(data.coins, 9200);
});

test('云端未知 schema 明确拒绝且不重置原档', async () => {
    const h = harness(), p = await h.load();
    const doc = h.db.data.get(`players/${p.playerId}`); doc.profile.schema = 999; doc.profile.coins = 888;
    assert.equal((await h.load()).code, 'SCHEMA'); assert.equal(doc.profile.coins, 888);
});

// 乐观并发替身允许事务读取同一旧值，并在提交冲突后重跑回调。
// 它验证发号逻辑不依赖单进程序列；真实 SDK 冲突策略仍需云端验收。
class ConcurrentDatabase extends Database {
    generation = 0;
    conflicts = 0;
    failPlayerWrite = false;
    async runTransaction(work) {
        for (let attempt = 0; attempt < 100; attempt++) {
            const version = this.generation;
            const snapshot = new Map([...this.data].map(([k, v]) => [k, copy(v)]));
            const tx = { collection: name => ({ doc: id => ({
                get: async () => ({ data: snapshot.has(`${name}/${id}`) ? copy(snapshot.get(`${name}/${id}`)) : null }),
                set: async ({ data }) => {
                    if (this.failPlayerWrite && name === 'players') throw Error('模拟建档写入失败');
                    snapshot.set(`${name}/${id}`, copy(data));
                },
            }) }) };
            const result = await work(tx);
            if (version !== this.generation) { this.conflicts++; continue; }
            this.data = snapshot; this.generation++; return copy(result);
        }
        throw Error('并发事务重试耗尽');
    }
}

test('短 ID 从 10000 开始：不同账号并发不重号，同账号并发及重复登录不重新领号', async () => {
    const db = new ConcurrentDatabase(), h = harness();
    const service = createService({ db, appId: h.context.APPID });
    const calls = Array.from({ length: 24 }, (_, i) => service.player(h.request(), { ...h.context, OPENID: `uid-${i % 12}` }));
    const rows = await Promise.all(calls);
    assert.ok(rows.every(row => row.ok));
    assert.equal(new Set(rows.map(row => row.uid)).size, 12);
    assert.deepEqual([...new Set(rows.map(row => row.uid))].sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => i + 10000));
    for (let i = 0; i < 12; i++) assert.equal(rows[i].uid, rows[i + 12].uid);
    assert.ok(db.conflicts > 0);
    assert.equal(db.data.get('counters/playerUid').lastUid, 10011);
});

test('发号与建档一起回滚，事务重跑及登录响应丢失不消耗额外编号', async () => {
    const db = new ConcurrentDatabase(), h = harness(), service = createService({ db, appId: h.context.APPID });
    db.failPlayerWrite = true;
    assert.equal((await service.player(h.request(), h.context)).code, 'INTERNAL');
    assert.equal(db.data.get('counters/playerUid').lastUid, 9999); assert.equal(db.data.size, 1);
    db.failPlayerWrite = false;
    const first = await service.player(h.request(), h.context);
    const retry = await service.player(h.request(), h.context);
    assert.equal(first.uid, 10000); assert.equal(retry.uid, first.uid);
    h.db.retry = true;
    assert.equal((await h.load()).uid, 10000);
    assert.equal(h.db.data.get('counters/playerUid').lastUid, 10000);
});

test('旧玩家补号不重置存档、赛事或版本；管理员改档和回档保持编号', async () => {
    const h = harness(), p = await h.load();
    const started = await h.player(h.request('career', beginData));
    const original = h.db.data.get(`players/${p.playerId}`); delete original.uid;
    original.profile.coins = 3456;
    const before = copy(original); h.db.data.get('counters/playerUid').lastUid = 10000;
    const migrated = await h.load();
    assert.equal(migrated.uid, 10001); assert.equal(migrated.revision, started.revision);
    assert.deepEqual(migrated.profile, before.profile);
    const after = copy(h.db.data.get(`players/${p.playerId}`)); delete after.uid;
    assert.deepEqual(after, before);
    const changed = await h.compensate(20);
    assert.equal(changed.uid, migrated.uid);
    const restored = await h.service.admin(h.request('restore', { playerId: p.playerId,
        auditId: changed.result.auditId, reason: '测试撤销' }, changed.revision), h.context);
    assert.equal(restored.uid, migrated.uid);
    assert.equal((await h.player(h.request('identity', { uid: 99999 }, restored.revision))).code, 'INPUT');
    assert.equal((await h.load()).uid, migrated.uid);
});

test('计数器缺失、非法或溢出时拒绝发号，不重置已有编号', async () => {
    for (const counter of [null, { lastUid: 99 }, { lastUid: Number.MAX_SAFE_INTEGER }, { lastUid: '10000' }]) {
        const h = harness();
        if (counter) h.db.data.set('counters/playerUid', counter); else h.db.data.delete('counters/playerUid');
        assert.equal((await h.load()).code, 'UID_UNAVAILABLE');
        assert.equal([...h.db.data.keys()].some(key => key.startsWith('players/')), false);
    }
    const h = harness(), first = await h.load(); h.db.data.delete('counters/playerUid');
    assert.equal((await h.load()).uid, first.uid);
});

test('客户端只显示服务端编号，重启后稳定，本地旧档和请求参数不能指定编号', async () => {
    const h = harness(), c = client(h), data = c.data();
    assert.equal(data.uid, null);
    await data.load(); assert.equal(data.uid, 10000); assert.equal(c.backend.uid, 10000);
    assert.equal((await h.player(h.request('load', { uid: 23456 }))).uid, 10000);
    const restarted = client(h, c.storage); await restarted.backend.loadProfile();
    assert.equal(restarted.backend.uid, 10000);
    const loaded = await h.load();
    const doc = h.db.data.get(`players/${loaded.playerId}`); doc.uid = 10002;
    await assert.rejects(restarted.backend.loadProfile(), error => error.code === 'BAD_PROFILE');
});
