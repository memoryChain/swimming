const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { build } = require('../scripts/build-wechat-cloud.cjs');
const suppliedOutput = process.env.SWIMMING_CLOUD_TEST_OUTPUT;
const output = suppliedOutput ? path.resolve(suppliedOutput) : fs.mkdtempSync(path.join(os.tmpdir(), 'swimming-cloud-'));
if (!suppliedOutput) build(output, { target: 'production' });
test.after(() => { if (!suppliedOutput) fs.rmSync(output, { recursive: true, force: true }); });
const playerDirectory = process.env.SWIMMING_CLOUD_TEST_FUNCTION || (suppliedOutput ? 'swimming-player' : 'swimming-player-v3');
const { createService } = require(path.join(output, playerDirectory, 'service.cjs'));
const { createDefaultProfile } = require(path.join(output, playerDirectory, 'rules/backend/PlayerProfile.js'));
const { CLOUD_PROTOCOL } = require(path.join(output, playerDirectory, 'rules/backend/CloudProtocol.js'));
const characterId = Object.keys(createDefaultProfile().characters)[0];
const copy = value => JSON.parse(JSON.stringify(value));

class Database {
    data = new Map([['counters/playerUid', { lastUid: 9999 }]]); queue = Promise.resolve(); fail = false; retry = false;
    configFailure = false; configHang = false; configReads = 0;
    collection(name) {
        let filter = {}, offset = 0, limit = 20; const orders = [];
        const query = {
            doc: id => ({ get: async () => {
                if (name === 'gameConfig') {
                    this.configReads++;
                    if (this.configFailure) throw Error('配置暂不可用');
                    if (this.configHang) return new Promise(() => {});
                }
                const value = this.data.get(`${name}/${id}`);
                return { data: value ? { ...copy(value), _id: id } : null };
            } }),
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
    const request = (action = 'load', data = {}, revision = 0, extra = {}) => ({ protocol: CLOUD_PROTOCOL.version, rulesVersion: CLOUD_PROTOCOL.rulesVersion,
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
    racerCount: (ticket.ai.opponentCount ?? 7) + 1,
    perfectCount: 80, goodCount: 10, missCount: 10, maxCombo: 80, time: 82 });

test('全局教学开关覆盖所有账号，切换不修改档案、版本或教学完成状态', async () => {
    const h = harness(), a = await h.load();
    const contextB = { ...h.context, OPENID: 'user-b' };
    const b = await h.service.player(h.request(), contextB);
    h.db.data.set('gameConfig/global', { tutorialEnabled: false, internalNote: '不下发管理字段' });
    for (const context of [h.context, contextB]) {
        const disabled = await h.service.player(h.request('load', { tutorialEnabled: true }), context);
        assert.deepEqual(disabled.featureFlags, { tutorialEnabled: false });
        const before = context === h.context ? a : b;
        assert.equal(disabled.revision, before.revision); assert.deepEqual(disabled.profile, before.profile);
    }
    const reads = h.db.configReads;
    const done = await h.player(h.request('tutorialComplete', {}, a.revision));
    assert.equal(done.profile.tutorialCompleted, true, '关闭期间仍可补传真实完成记录');
    assert.equal(h.db.configReads, reads, '写档不增加配置查询');
    h.db.data.set('gameConfig/global', { tutorialEnabled: true });
    assert.equal((await h.load()).featureFlags.tutorialEnabled, true);
    assert.equal((await h.load()).profile.tutorialCompleted, true);
    const untouched = await h.service.player(h.request(), contextB);
    assert.equal(untouched.profile.tutorialCompleted, false);
    assert.equal(untouched.revision, b.revision);
});

test('配置缺失或非法采用默认开启，配置查询失败与超时不阻塞存档', async () => {
    const h = harness();
    assert.equal((await h.load()).featureFlags.tutorialEnabled, true);
    for (const value of [undefined, 'false', 0, null, {}, []]) {
        h.db.data.set('gameConfig/global', value === undefined ? {} : { tutorialEnabled: value });
        assert.equal((await h.load()).featureFlags.tutorialEnabled, true);
    }
    h.db.configFailure = true;
    const failed = await h.load(); assert.equal(failed.ok, true); assert.equal(failed.featureFlags, undefined);
    h.db.configFailure = false; h.db.configHang = true;
    const slow = await h.load(); assert.equal(slow.ok, true); assert.equal(slow.featureFlags, undefined);
    assert.deepEqual(slow.profile, failed.profile);
    assert.equal(slow.revision, failed.revision);
});

test('未认证和不兼容的请求不读取全局配置', async () => {
    const h = harness();
    await h.service.player(h.request(), {});
    await h.player(h.request('load', {}, 0, { protocol: -1 }));
    assert.equal(h.db.configReads, 0);
});

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
    assert.equal(result.profile.coins, 9500); assert.equal(repeat.profile.coins, 9500);
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

test('云端比赛种子和凭据、重复结算、伪造结果', async () => {
    const h = harness(); await h.load();
    const first = await h.player(h.request('career', beginData)); assert.equal(first.ok, true);
    assert.equal(first.result.ticket.seed, 123); assert.match(first.result.ticket.id, /^race-ticket-/);
    const bad = settlement(first.result.ticket); bad.maxCombo = 9999;
    assert.equal((await h.player(h.request('career', bad, first.revision))).code, 'INPUT');
    h.advance(90000);
    const request = h.request('career', settlement(first.result.ticket), first.revision);
    const result = await h.player(request), repeat = await h.player(copy(request));
    assert.equal(result.ok, true); assert.equal(result.profile.coins, 480);
    assert.deepEqual(repeat, result); assert.equal(result.profile.career.pending, null);
    assert.equal((await h.player(h.request('career', settlement(first.result.ticket), result.revision))).code, 'TICKET');
});

test('快速比赛按实际八人结算，未完赛零奖励且正常清理票据', async () => {
    for (const finished of [false, true]) {
        const h = harness(); await h.load();
        const started = await h.player(h.request('career', beginData));
        assert.equal(started.ok, true);
        assert.equal(started.result.ticket.ai.opponentCount, undefined);
        assert.equal(started.result.ticket.ai.intelligence.length, 4, '难度候选数量不是实际对手人数');
        h.advance(100000);
        const data = { ...settlement(started.result.ticket), racerCount: 8, finished,
            placement: finished ? 1 : 8, time: finished ? 82 : 0,
            perfectCount: 1, goodCount: 0, missCount: 3, maxCombo: 1 };
        const invalid = await h.player(h.request('career', { ...data, placement: 1, racerCount: 5 }, started.revision));
        assert.equal(invalid.code, 'INPUT'); assert.equal(invalid.message, '参赛人数不匹配');
        const request = h.request('career', data, started.revision);
        const result = await h.player(request);
        assert.equal(result.ok, true, result.message);
        assert.equal(result.profile.career.pending, null);
        assert.equal(result.profile.career.receipts.length, 1);
        if (finished) assert.ok(result.result.receipt.coinsGained > 0);
        else {
            assert.equal(result.result.receipt.message, '未完赛，本场无奖励');
            assert.equal(result.result.receipt.coinsGained, 0);
            assert.equal(result.profile.coins, started.profile.coins);
        }
        assert.deepEqual(await h.player(copy(request)), result);
    }
});

test('固定对手人数的联赛继续按票据人数校验', async () => {
    const h = harness(); await h.load();
    const started = await h.player(h.request('career', { ...beginData, source: 'league' }));
    assert.equal(started.ok, true);
    const racers = (started.result.ticket.ai.opponentCount ?? 7) + 1;
    const data = { ...settlement(started.result.ticket), finished: false, placement: racers, racerCount: racers, time: 0 };
    const wrong = racers === 8 ? 5 : 8;
    assert.equal((await h.player(h.request('career', { ...data, racerCount: wrong, placement: 1 }, started.revision))).code, 'INPUT');
    const result = await h.player(h.request('career', data, started.revision));
    assert.equal(result.ok, true, result.message); assert.equal(result.profile.career.pending, null);
});

test('云端八人新秀预赛垫底可晋级、决赛第五达标，首通幂等且伪造条款无效', async () => {
    const h = harness(), initial = await h.load();
    h.db.data.get(`players/${initial.playerId}`).profile.career.points = 100;
    const pre = await h.player(h.request('career', { ...beginData, source: 'cup' }));
    h.advance(90000);
    assert.equal(pre.result.ticket.ai.opponentCount, 7);
    assert.equal(pre.result.ticket.rule, 'wild');
    const preliminary = await h.player(h.request('career', { ...settlement(pre.result.ticket), placement: 8 }, pre.revision));
    assert.equal(preliminary.ok, true); assert.equal(preliminary.result.receipt.coinsGained, 320);
    const final = await h.player(h.request('career', { ...beginData, source: 'cup' }, preliminary.revision));
    assert.equal(final.result.ticket.rule, 'wild');
    h.advance(90000);
    const request = h.request('career', { ...settlement(final.result.ticket), placement: 5,
        terms: { firstClearCoins: 9999999 } }, final.revision);
    const result = await h.player(request);
    assert.equal(result.ok, true, result.message);
    assert.equal(result.profile.career.league, 1);
    assert.equal(result.profile.career.cups[characterId].state, 'passed');
    assert.equal(result.result.receipt.first, 600); assert.equal(result.result.receipt.podium, 0);
    assert.equal(result.profile.coins, 1240);
    assert.deepEqual(await h.player(copy(request)), result);
});

test('旧经济版本只接受有效旧票据补结算，不能新开赛或按新价格执行旧升级', async () => {
    const h = harness(), initial = await h.compensate();
    const refused = await h.player(h.request('level', { characterId, requestedLevels: 1 }, initial.revision, { rulesVersion: 2 }));
    assert.equal(refused.code, 'VERSION'); assert.equal((await h.load()).profile.coins, 10000);
    const start = await h.player(h.request('career', { ...beginData, source: 'league' }, initial.revision));
    assert.equal((await h.player(h.request('career', settlement(start.result.ticket), start.revision, { rulesVersion: 2 }))).code, 'VERSION');
    const doc = h.db.data.get(`players/${start.playerId}`);
    delete doc.profile.career.pending.terms;
    delete doc.profile.career.pending.rulesVersion;
    h.advance(90000);
    const request = h.request('career', settlement(start.result.ticket), start.revision, { rulesVersion: 2 });
    const settled = await h.player(request);
    assert.equal(settled.ok, true, settled.message); assert.equal(settled.result.receipt.points, 20);
    assert.deepEqual(await h.player(copy(request)), settled);
    assert.equal((await h.player(h.request('career', beginData, settled.revision, { rulesVersion: 2 }))).code, 'VERSION');
});

test('云端按赛事段位发奖，高等级回打不减奖，高等级培养使用新成本', async () => {
    const h = harness(), initial = await h.compensate(50000);
    const profile = h.db.data.get(`players/${initial.playerId}`).profile;
    profile.characters[characterId].level = 29; profile.career.league = 5;
    const high = await h.player(h.request('career', { ...beginData, source: 'league', tier: 5 }, initial.revision));
    assert.equal(high.ok, true); assert.equal(high.result.ticket.terms.factor, 7.5);
    h.advance(90000);
    const highResult = await h.player(h.request('career', settlement(high.result.ticket), high.revision));
    assert.equal(highResult.result.receipt.coinsGained, 3600);
    const low = await h.player(h.request('career', { ...beginData, source: 'league', tier: 0 }, highResult.revision));
    assert.equal(low.result.ticket.terms.factor, 1);
    h.advance(90000);
    const lowResult = await h.player(h.request('career', settlement(low.result.ticket), low.revision));
    assert.equal(lowResult.result.receipt.coinsGained, 480);
    const request = h.request('level', { characterId, requestedLevels: 1 }, lowResult.revision);
    const upgraded = await h.player(request);
    assert.equal(upgraded.ok, true); assert.equal(upgraded.result.coinsSpent, 42300);
    assert.equal(upgraded.profile.characters[characterId].level, 30);
    assert.equal(upgraded.profile.coins, 11780);
    assert.deepEqual(await h.player(copy(request)), upgraded);
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
    const requests = [];
    const localStorage = { getItem: k => storage.get(k) ?? null,
        setItem: (k, v) => {
            if (options.failWrite && k.endsWith('.pending') || options.failTutorialWrite && /\.tutorial-/.test(k)
                || options.failConfigWrite && k.endsWith('.tutorial-enabled')) throw Error('本地空间不足');
            storage.set(k, v);
        },
        removeItem: k => storage.delete(k) };
    const wx = { cloud: { init() {}, callFunction({ data, success, fail }) {
        calls++; requests.push(copy(data)); if (offline) { queueMicrotask(() => fail({})); return; }
        const run = () => h.service.player(copy(data), account);
        Promise.resolve(options.respond ? options.respond(copy(data), run) : run()).then(result => {
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
            if (id === './WechatCloudConfig') return { WECHAT_CLOUD_CONFIG: { environmentId: options.noEnv ? '' : options.environmentId || 'test-env',
                functionName: options.functionName || 'swimming-player-v3', storageNamespace: options.storageNamespace || '', buildStamp: 'test-build', timeoutMs: 1000 } };
            return load(path.resolve(path.dirname(file), id + '.ts'));
        };
        vm.runInContext(`(function(require,module,exports){${code}\n})`, sandbox)(requireLocal, module, module.exports);
        return module.exports;
    }
    const { WechatCloudBackend } = load(path.resolve(__dirname, '../assets/scripts/backend/WechatCloudBackend.ts'));
    activeBackend = options.local
        ? new (load(path.resolve(__dirname, '../assets/scripts/backend/MockBackend.ts')).MockBackend)()
        : new WechatCloudBackend();
    return { backend: activeBackend, data: () => load(path.resolve(__dirname, '../assets/scripts/backend/PlayerData.ts')).PlayerData, storage, options, requests, calls: () => calls, drop: n => { drop = n; }, offline: v => { offline = v; },
        config: () => load(path.resolve(__dirname, '../assets/scripts/app/PlayerCharacterConfig.ts')),
        mock: () => new (load(path.resolve(__dirname, '../assets/scripts/backend/MockBackend.ts')).MockBackend)(),
        account: value => { account = value; } };
}

test('客户端登录与回前台刷新应用总开关，恢复后仍按账号完成状态引导', async () => {
    const h = harness(), c = client(h), data = c.data();
    assert.equal(data.tutorialRequired, false, '尚未读档不触发教学');
    await data.load(); assert.equal(data.tutorialRequired, true);
    const before = copy(data.profile); let changes = 0;
    data.onChange(() => changes++);
    h.db.data.set('gameConfig/global', { tutorialEnabled: false });
    await data.load(true);
    assert.equal(data.loaded, true); assert.equal(data.tutorialEnabled, false); assert.equal(data.tutorialRequired, false);
    assert.equal(changes, 1); assert.deepEqual(copy(data.profile), before);
    const calls = c.calls();
    for (let i = 0; i < 30; i++) { assert.equal(data.tutorialRequired, false); await data.loadForNavigation(); }
    assert.equal(c.calls(), calls, '大厅读取状态不发网络轮询');
    h.db.data.set('gameConfig/global', { tutorialEnabled: true });
    await data.load(true); assert.equal(data.tutorialRequired, true);
    await data.completeTutorial(); assert.equal(data.tutorialRequired, false);
    await c.backend.syncTutorialCompletion();
    for (const enabled of [false, true]) {
        h.db.data.set('gameConfig/global', { tutorialEnabled: enabled });
        await data.load(true); assert.equal(data.tutorialRequired, false); assert.equal(data.profile.tutorialCompleted, true);
    }
    const local = client(h, new Map(), { local: true }).data();
    await local.load(); assert.equal(local.tutorialEnabled, true); assert.equal(local.tutorialRequired, true);
});

test('配置读取失败、旧响应或非法响应沿用环境缓存，正常缺失文档恢复默认开启', async () => {
    const h = harness(), storage = new Map();
    h.db.data.set('gameConfig/global', { tutorialEnabled: false });
    await client(h, storage).data().load();
    h.db.configFailure = true;
    const restarted = client(h, storage); await restarted.data().load();
    assert.equal(restarted.data().loaded, true); assert.equal(restarted.data().tutorialRequired, false);
    h.db.configFailure = false;
    for (const featureFlags of [undefined, { tutorialEnabled: 'false' }]) {
        const older = client(h, storage, { respond: async (_request, run) => ({ ...await run(), featureFlags }) });
        await older.data().load(); assert.equal(older.data().tutorialEnabled, false);
    }
    const otherEnvironment = client(h, storage, { environmentId: 'other-env' });
    assert.equal(otherEnvironment.backend.tutorialEnabled, true, '不同云环境不共用配置缓存');
    h.db.data.delete('gameConfig/global'); await restarted.data().load(true);
    assert.equal(restarted.data().tutorialRequired, true);
    assert.equal(restarted.data().profile.tutorialCompleted, false);
});

test('配置缓存写入失败仍立即应用开关；迟到的旧读档不覆盖较新开关', async () => {
    const h = harness(), c = client(h, new Map(), { failConfigWrite: true });
    h.db.data.set('gameConfig/global', { tutorialEnabled: false });
    await c.data().load(); assert.equal(c.data().loaded, true); assert.equal(c.data().tutorialRequired, false);
    let release, held = false;
    c.options.respond = async (_request, run) => {
        const response = await run();
        if (!held) { held = true; return new Promise(resolve => { release = () => resolve(response); }); }
        return response;
    };
    const previous = c.backend.loadProfile();
    while (!release) await new Promise(resolve => setImmediate(resolve));
    h.db.data.set('gameConfig/global', { tutorialEnabled: true });
    await c.backend.loadProfile(); assert.equal(c.backend.tutorialEnabled, true);
    release(); await previous; assert.equal(c.backend.tutorialEnabled, true);
});

test('两个角色外观独立入云，试穿保存不改变出场角色，重登与联机快照保持一致', async () => {
    const h = harness(), c = client(h), data = c.data(), config = c.config();
    await data.load();
    const a = { characterId: 'cartonSwimmer14', skinToneId: 'deep', colorSchemeId: 'blue' };
    const b = { characterId: 'cartonSwimmer16', skinToneId: 'warm', colorSchemeId: 'purple' };
    await data.setCharacterSelection(a);
    await data.setCharacterAppearance(b);
    assert.deepEqual(copy(data.profile.characterSelection), a);
    assert.deepEqual(copy(config.getPlayerCharacterSelection(b.characterId)), b);
    await data.setCharacterSelection(b);
    const restarted = client(h); await restarted.data().load();
    assert.deepEqual(copy(restarted.config().getPlayerCharacterSelection()), b);
    restarted.config().selectPlayerCharacter(a.characterId);
    assert.deepEqual(copy(restarted.config().getPlayerCharacterSelection()), a);
    assert.equal(restarted.config().selectedPlayerColorScheme(b.characterId).id, 'purple');
    assert.equal(restarted.config().selectedPlayerSkinTone(b.characterId).id, 'warm');
    const stored = (await h.load()).profile;
    assert.deepEqual(stored.characterAppearances[a.characterId], { skinToneId: 'deep', colorSchemeId: 'blue' });
    assert.deepEqual(stored.characterAppearances[b.characterId], { skinToneId: 'warm', colorSchemeId: 'purple' });
});

test('试选只保留每角色末次值，改回原色零请求，确认出场不重复提交配色', async () => {
    const h = harness(), c = client(h), data = c.data(); await data.load();
    const original = copy(data.profile.characterSelection), before = c.calls();
    for (let i = 0; i < 100; i++) data.stageCharacterAppearance({ ...original, colorSchemeId: i % 2 ? 'blue' : 'purple' });
    assert.equal(c.calls(), before);
    await data.flushCharacterAppearances();
    assert.equal(c.calls(), before + 1);
    data.stageCharacterAppearance({ ...original, colorSchemeId: 'purple' });
    data.stageCharacterAppearance({ ...original, colorSchemeId: 'blue' });
    await data.flushCharacterAppearances();
    assert.equal(c.calls(), before + 1);
    const selected = { characterId: 'cartonSwimmer14', skinToneId: 'deep', colorSchemeId: 'purple' };
    data.stageCharacterAppearance(selected);
    await data.setCharacterSelection(selected);
    await data.flushCharacterAppearances();
    assert.equal(c.calls(), before + 2);
    assert.deepEqual(copy(data.profile.characterSelection), selected);
});

test('慢响应不盖掉新试选，排队过期颜色不发送，失败后保留末次选择供重试', async () => {
    const h = harness(), c = client(h), data = c.data(), config = c.config(); await data.load();
    const original = copy(data.profile.characterSelection);
    const stage = (id, color) => {
        config.setPlayerColorScheme(color, id);
        data.stageCharacterAppearance(config.getPlayerCharacterSelection(id));
    };
    const save = c.backend.saveCharacterAppearance.bind(c.backend);
    let release, called;
    const started = new Promise(resolve => { called = resolve; });
    c.backend.saveCharacterAppearance = async value => {
        called(); await new Promise(resolve => { release = resolve; });
        return save(value);
    };
    stage(original.characterId, 'blue');
    const first = data.flushCharacterAppearances(); await started;
    stage(original.characterId, 'purple');
    const obsolete = data.flushCharacterAppearances();
    stage(original.characterId, 'green'); stage('cartonSwimmer14', 'yellow');
    release(); await first; await obsolete;
    assert.equal(config.getPlayerCharacterSelection().colorSchemeId, 'green');
    assert.equal(config.getPlayerCharacterSelection('cartonSwimmer14').colorSchemeId, 'yellow');
    assert.equal((await h.load()).profile.characterAppearances[original.characterId].colorSchemeId, 'blue');
    c.backend.saveCharacterAppearance = save;
    const before = c.calls();
    await data.flushCharacterAppearances();
    assert.equal(c.calls(), before + 2);
    const persisted = (await h.load()).profile.characterAppearances;
    assert.equal(persisted[original.characterId].colorSchemeId, 'green');
    assert.equal(persisted.cartonSwimmer14.colorSchemeId, 'yellow');
    stage(original.characterId, 'orange'); c.offline(true);
    await assert.rejects(data.flushCharacterAppearances());
    assert.equal(config.getPlayerCharacterSelection().colorSchemeId, 'orange');
    c.offline(false); await data.flushCharacterAppearances();
    assert.equal((await h.load()).profile.characterAppearances[original.characterId].colorSchemeId, 'orange');
});

test('旧 schema 6 外观定向迁移一次，保留金币等级、赛事凭据和其他元数据', async () => {
    const h = harness(), loaded = await h.compensate(12345);
    const started = await h.player(h.request('career', beginData, loaded.revision));
    const doc = h.db.data.get(`players/${loaded.playerId}`);
    doc.profile.schema = 6;
    delete doc.profile.characterAppearances;
    doc.profile.characterSelection = { characterId: 'cartonSwimmer14', skinToneId: 'deep', colorSchemeId: 'blue' };
    delete doc.profile.characters.cartonSwimmer16;
    const before = copy(doc), migrated = await h.load(), again = await h.load();
    assert.equal(migrated.profile.schema, 7);
    assert.equal(migrated.revision, before.revision + 1);
    assert.equal(again.revision, migrated.revision);
    assert.equal(migrated.profile.coins, before.profile.coins);
    assert.deepEqual(migrated.profile.career, before.profile.career);
    assert.equal(migrated.profile.career.pending.id, started.result.ticket.id);
    for (const id of Object.keys(before.profile.characters)) assert.deepEqual(migrated.profile.characters[id], before.profile.characters[id]);
    assert.deepEqual(migrated.profile.characterAppearances.cartonSwimmer14, { skinToneId: 'deep', colorSchemeId: 'blue' });
    assert.deepEqual(migrated.profile.characterAppearances.cartonSwimmer16, { skinToneId: 'warm', colorSchemeId: 'red' });
    assert.equal(migrated.profile.characters.cartonSwimmer16.level, 1);
    const after = h.db.data.get(`players/${loaded.playerId}`);
    for (const key of ['uid', 'playerId', 'pendingWriter', 'pendingAt', 'createdAt']) assert.deepEqual(after[key], before[key]);
});

test('旧管理备份恢复时迁移外观，不支持肤色的角色保持当前快照一致', async () => {
    const h = harness(), p = await h.compensate(100);
    const audit = h.db.data.get(`adminAudit/${p.result.auditId}`);
    audit.before.schema = 6;
    delete audit.before.characterAppearances;
    audit.before.characterSelection = { characterId: 'cartonSwimmer15', skinToneId: 'deep', colorSchemeId: 'blue' };
    const restored = await h.service.admin(h.request('restore', {
        playerId: p.playerId, auditId: p.result.auditId, reason: '恢复旧备份',
    }, p.revision), h.context);
    assert.equal(restored.ok, true);
    assert.equal(restored.profile.schema, 7);
    assert.equal(restored.profile.coins, 0);
    assert.equal(restored.profile.characterSelection.skinToneId, 'warm');
    assert.deepEqual(restored.profile.characterAppearances.cartonSwimmer15, { skinToneId: 'warm', colorSchemeId: 'blue' });
});

test('外观请求校验、重复提交及跨设备冲突不会覆盖其他角色', async () => {
    const h = harness(), initial = await h.load();
    const a = { characterId: 'cartonSwimmer14', skinToneId: 'deep', colorSchemeId: 'blue' };
    const request = h.request('appearance', a, initial.revision);
    const saved = await h.player(request), repeated = await h.player(copy(request));
    assert.equal(saved.ok, true); assert.equal(repeated.revision, saved.revision);
    const b = { characterId: 'cartonSwimmer16', skinToneId: 'warm', colorSchemeId: 'purple' };
    assert.equal((await h.player(h.request('appearance', b, initial.revision))).code, 'CONFLICT');
    assert.equal((await h.player(h.request('appearance', b, saved.revision))).ok, true);
    assert.deepEqual((await h.load()).profile.characterAppearances[a.characterId], { skinToneId: 'deep', colorSchemeId: 'blue' });
    const latest = await h.load();
    for (const invalid of [{ ...a, characterId: 'unknown' }, { ...a, colorSchemeId: 'invalid' },
        { ...a, characterId: 'cartonSwimmer15' }, { ...a, coins: 99999 }, { ...a, characterId: '__proto__' }]) {
        assert.equal((await h.player(h.request('appearance', invalid, latest.revision))).code, 'INPUT');
    }
    assert.equal((await h.player(h.request('load', {}, 0, { rulesVersion: 1 }))).code, 'VERSION');
});

test('外观保存失败回退确认值，响应丢失重登恢复同一请求', async () => {
    const h = harness(), c = client(h), data = c.data(), config = c.config();
    await data.load();
    const original = copy(config.getPlayerCharacterSelection());
    config.setPlayerColorScheme('blue'); c.offline(true);
    await assert.rejects(data.setCharacterAppearance(config.getPlayerCharacterSelection()));
    assert.deepEqual(copy(config.getPlayerCharacterSelection()), original);
    c.offline(false); await data.load(true);
    assert.equal(config.getPlayerCharacterSelection().colorSchemeId, 'blue');
    c.drop(2);
    await assert.rejects(data.setCharacterAppearance({ ...original, colorSchemeId: 'purple' }));
    const restarted = client(h); await restarted.data().load();
    assert.equal(restarted.config().getPlayerCharacterSelection().colorSchemeId, 'purple');
    assert.equal([...c.storage.keys()].some(k => k.endsWith('.pending')), true);
    const recovered = client(h, c.storage); await recovered.data().load();
    assert.equal([...c.storage.keys()].some(k => k.endsWith('.pending')), false);
    assert.equal(recovered.config().getPlayerCharacterSelection().colorSchemeId, 'purple');
});

test('本地模拟档与云端采用相同独立外观结构，旧档迁移后可再次保存', async () => {
    const h = harness(), c = client(h), mock = c.mock();
    const legacy = createDefaultProfile(); legacy.schema = 6; delete legacy.characterAppearances;
    legacy.characterSelection = { characterId: 'cartonSwimmer14', skinToneId: 'deep', colorSchemeId: 'blue' };
    c.storage.set('swimming.player-profile', JSON.stringify(legacy));
    const migrated = await mock.loadProfile();
    assert.equal(migrated.characterAppearances.cartonSwimmer14.colorSchemeId, 'blue');
    await mock.saveCharacterAppearance({ characterId: 'cartonSwimmer16', skinToneId: 'warm', colorSchemeId: 'purple' });
    const saved = await mock.loadProfile();
    assert.equal(saved.characterSelection.characterId, 'cartonSwimmer14');
    assert.equal(saved.characterAppearances.cartonSwimmer14.colorSchemeId, 'blue');
    assert.equal(saved.characterAppearances.cartonSwimmer16.colorSchemeId, 'purple');
});

test('响应丢失自动重试只升级一次，原本地测试档保持不变', async () => {
    const h = harness(); await h.compensate();
    const original = JSON.stringify({ coins: 99999 }), storage = new Map([['swimming.player-profile', original]]);
    const c = client(h, storage); await c.backend.loadProfile(); c.drop(1);
    const result = await c.backend.spendCoinsForLevel(characterId, 1);
    assert.equal(result.profile.coins, 9500); assert.equal(result.levelsGained, 1);
    assert.equal(storage.get('swimming.player-profile'), original);
    assert.equal([...storage.keys()].some(k => k.endsWith('.pending')), false);
});

test('两次响应丢失后重启恢复原请求，云端故障不退回本地档', async () => {
    const h = harness(); await h.compensate(); const c = client(h); await c.backend.loadProfile(); c.drop(2);
    await assert.rejects(c.backend.spendCoinsForLevel(characterId, 1));
    assert.equal([...c.storage.keys()].some(k => k.endsWith('.pending')), true);
    const restarted = client(h, c.storage), profile = await restarted.backend.loadProfile();
    assert.equal(profile.coins, 9500); assert.equal(profile.characters[characterId].level, 2);
    // 玩家点击重试同一升级，应拿到恢复的结果，不再次扣钱。
    const retried = await restarted.backend.spendCoinsForLevel(characterId, 1);
    assert.equal(retried.profile.coins, 9500);
    restarted.offline(true); await assert.rejects(restarted.backend.loadProfile());
    assert.equal((await h.load()).profile.coins, 9500);
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
    assert.equal((await c.backend.spendCoinsForLevel(characterId, 1)).profile.coins, 4500);
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
    assert.equal(retry.levelsGained, 1); assert.equal(data.coins, 9500); assert.equal(data.loaded, true);
    c.offline(true); await data.load(true); assert.equal(data.loaded, false);
    c.offline(false); await data.load(true); assert.equal(data.loaded, true); assert.equal(data.coins, 9500);
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


test('中途退出后任意设备可重新开赛，旧赛果和旧开赛重试不能替换新比赛', async () => {
    for (const writerId of ['device-00001', 'another-device']) {
        const h = harness(); await h.load();
        const firstRequest = h.request('career', beginData);
        const first = await h.player(firstRequest);
        const nextRequest = h.request('career', beginData, first.revision, { writerId });
        const next = await h.player(nextRequest);
        assert.equal(next.ok, true); assert.notEqual(next.result.ticket.id, first.result.ticket.id);
        assert.equal(next.profile.coins, first.profile.coins);
        assert.equal(next.profile.career.points, first.profile.career.points);
        assert.deepEqual(next.profile.characters, first.profile.characters);
        assert.equal((await h.player(firstRequest)).code, 'TICKET');
        h.advance(90000);
        const stale = await h.player(h.request('career', settlement(first.result.ticket), next.revision));
        assert.equal(stale.code, 'TICKET'); assert.equal(stale.profile.career.pending.id, next.result.ticket.id);
        const finish = h.request('career', settlement(next.result.ticket), next.revision, { writerId });
        const result = await h.player(finish);
        assert.equal(result.ok, true); assert.equal(result.profile.coins, 480);
        assert.deepEqual(await h.player(finish), result);
    }
});

test('两台设备同时重新开赛仍由版本与事务保护，只创建一场新比赛', async () => {
    const h = harness(); await h.load();
    const old = await h.player(h.request('career', beginData));
    const results = await Promise.all(['device-a', 'device-b'].map(writerId =>
        h.player(h.request('career', beginData, old.revision, { writerId }))));
    assert.equal(results.filter(r => r.ok).length, 1);
    assert.equal(results.filter(r => r.code === 'CONFLICT').length, 1);
    assert.equal((await h.load()).profile.career.pending.id, results.find(r => r.ok).result.ticket.id);
});

test('教学完成按账号永久保存、跨设备读取、重复提交不发奖励', async () => {
    const h = harness(); const fresh = await h.load();
    assert.equal(fresh.profile.tutorialCompleted, false);
    const request = h.request('tutorialComplete', {}, fresh.revision);
    const done = await h.player(request);
    assert.equal(done.ok, true); assert.equal(done.profile.tutorialCompleted, true);
    assert.deepEqual(done.profile.career, fresh.profile.career);
    assert.equal(done.profile.coins, fresh.profile.coins);
    const retry = await h.player(request);
    assert.equal(retry.revision, done.revision);
    const device = await h.player(h.request('load', {}, 0, { writerId: 'device-00002' }));
    assert.equal(device.profile.tutorialCompleted, true);
    h.context.OPENID = 'user-b';
    assert.equal((await h.load()).profile.tutorialCompleted, false);
    h.context.OPENID = 'user-a';
    assert.equal((await h.load()).profile.tutorialCompleted, true);
    const reset = await h.player(h.request('tutorialComplete', { tutorialCompleted: false }, done.revision));
    assert.equal(reset.ok, false);
    assert.equal((await h.load()).profile.tutorialCompleted, true);
});

test('旧账号免教学定向迁移，保留资产与赛事状态；数据库失败不标记完成', async () => {
    const h = harness(); const fresh = await h.load();
    const doc = h.db.data.get(`players/${fresh.playerId}`);
    delete doc.profile.tutorialCompleted;
    const before = copy(doc.profile);
    const migrated = await h.load();
    assert.equal(migrated.profile.tutorialCompleted, true);
    assert.deepEqual(migrated.profile.career, before.career);
    assert.equal(migrated.profile.coins, before.coins);
    assert.equal((await h.load()).revision, migrated.revision);
    h.context.OPENID = 'user-new'; const newAccount = await h.load();
    h.db.fail = true;
    assert.equal((await h.player(h.request('tutorialComplete', {}, newAccount.revision))).ok, false);
    h.db.fail = false;
    assert.equal((await h.load()).profile.tutorialCompleted, false);
});


test('本地教学重置保留其余存档并可反复完成重置；云端入口直接拒绝', async () => {
    const c = client(harness(), new Map(), { local: true });
    const profile = await c.backend.loadProfile();
    profile.coins = 1357;
    profile.tutorialCompleted = true;
    await c.backend.saveProfile(profile);
    const data = c.data(); await data.load();
    const expected = copy(data.profile); expected.tutorialCompleted = false;
    for (let i = 0; i < 3; i++) {
        await data.resetTutorialForLocalTesting();
        assert.deepEqual(copy(data.profile), expected);
        assert.deepEqual(JSON.parse(c.storage.get('swimming.player-profile')), expected);
        await data.completeTutorial();
    }
    const cloud = client(harness());
    await assert.rejects(cloud.data().resetTutorialForLocalTesting(), /仅本地预览/);
    assert.equal(cloud.calls(), 0);
});

test('教学完成先写账号本地标记，云请求不返回时仍可导航且不占经济队列', async () => {
    const h = harness(); let release, hold = true;
    const c = client(h, new Map(), { respond(request, run) {
        return request.action === 'tutorialComplete' && hold ? new Promise(resolve => { release = () => { hold = false; run().then(resolve); }; }) : run();
    } });
    const data = c.data(); await data.load();
    const before = copy(data.profile);
    await data.completeTutorial();
    assert.equal(data.loaded, true); assert.equal(data.profile.tutorialCompleted, true);
    assert.deepEqual(copy(data.profile), { ...before, tutorialCompleted: true });
    assert.ok([...c.storage.keys()].some(key => key.endsWith('.tutorial-completed') && c.storage.get(key) === '1'));
    assert.ok(![...c.storage.keys()].some(key => key.endsWith('.pending')));
    assert.equal((await data.loadForNavigation()).tutorialCompleted, true);
    await data.executeCareer({ ...beginData, type: 'begin' });
    assert.equal(data.profile.tutorialCompleted, true); assert.ok(data.profile.career.pending);
    release(); await c.backend.syncTutorialCompletion();
    assert.equal((await h.load()).profile.tutorialCompleted, true);
    assert.ok(data.profile.career.pending, '后台教学响应不能替换前台比赛票据');
});

test('断网完成教学仍保持 loaded，本地重启恢复并在云读取恢复后补传', async () => {
    const h = harness(), storage = new Map(), c = client(h, storage), data = c.data();
    await data.load(); c.offline(true); await data.completeTutorial(); await c.backend.syncTutorialCompletion();
    assert.equal(data.loaded, true); assert.equal(data.profile.tutorialCompleted, true);
    assert.equal((await data.loadForNavigation()).tutorialCompleted, true);
    assert.equal((await h.load()).profile.tutorialCompleted, false);
    const restarted = client(h, storage); await restarted.data().load();
    assert.equal(restarted.data().profile.tutorialCompleted, true, '云端旧值不能再次触发教学');
    await restarted.backend.syncTutorialCompletion();
    assert.equal((await h.load()).profile.tutorialCompleted, true);
    assert.ok(![...storage.keys()].some(key => key.endsWith('.tutorial-pending')));
    const other = client(h, new Map()); await other.data().load();
    assert.equal(other.data().profile.tutorialCompleted, true, '同账号换设备由云端恢复');
});

test('旧云函数拒绝教学写入时不阻塞大厅/正常存档，更新后沿用本地记录补传', async () => {
    const h = harness(); let old = true;
    const c = client(h, new Map(), { respond(request, run) {
        return old && request.action === 'tutorialComplete'
            ? { ok: false, code: 'FORBIDDEN', message: '不支持此存档操作' } : run();
    } });
    const data = c.data(); await data.load(); await data.completeTutorial(); await c.backend.syncTutorialCompletion();
    assert.equal(data.loaded, true); assert.equal((await data.loadForNavigation()).tutorialCompleted, true);
    await data.setIdentity({ avatarId: 'coral' });
    await c.backend.syncTutorialCompletion();
    assert.equal(data.profile.tutorialCompleted, true); assert.equal(data.avatarId, 'coral');
    old = false; await data.load(true); await c.backend.syncTutorialCompletion();
    assert.equal((await h.load()).profile.tutorialCompleted, true);
});

test('数据库错误及响应丢失保留教学请求，恢复补传不重复写进度或发奖', async () => {
    for (const failure of ['database', 'response']) {
        const h = harness(), c = client(h), data = c.data(); await data.load();
        if (failure === 'database') h.db.fail = true; else c.drop(2);
        await data.completeTutorial(); await c.backend.syncTutorialCompletion();
        assert.equal(data.loaded, true); assert.equal(data.profile.tutorialCompleted, true);
        const failedRequests = c.requests.filter(r => r.action === 'tutorialComplete');
        assert.equal(failedRequests.length, failure === 'database' ? 1 : 2);
        if (failedRequests.length > 1) assert.equal(failedRequests[0].requestId, failedRequests[1].requestId);
        h.db.fail = false; await data.load(true); await c.backend.syncTutorialCompletion();
        const confirmed = await h.load();
        assert.equal(confirmed.profile.tutorialCompleted, true); assert.equal(confirmed.profile.coins, 0);
        assert.equal(confirmed.revision, 1);
    }
});

test('旧版经济 outbox 中的失败教学请求在读取时迁移，不再锁住登录', async () => {
    const h = harness(), storage = new Map(), c = client(h, storage); const initial = await c.backend.loadProfile();
    const profileKey = [...storage.keys()].find(k => k.endsWith('.cache'));
    const pendingKey = profileKey.replace(/\.cache$/, '.pending');
    storage.set(pendingKey, JSON.stringify(h.request('tutorialComplete', {}, 0)));
    const restarted = client(h, storage, { respond(request, run) {
        return request.action === 'tutorialComplete' ? { ok: false, code: 'FORBIDDEN' } : run();
    } });
    await restarted.data().load(); await restarted.backend.syncTutorialCompletion();
    assert.equal(restarted.data().loaded, true); assert.equal(restarted.data().profile.tutorialCompleted, true);
    assert.equal(storage.has(pendingKey), false);
    assert.deepEqual(copy(restarted.data().profile.career), copy(initial.career));
    await restarted.data().setIdentity({ avatarId: 'coral' });
    assert.equal(restarted.data().avatarId, 'coral');
});

test('本地教学标记按环境与账号隔离，另一账号不会读取或重放', async () => {
    const h = harness(), storage = new Map(), c = client(h, storage); await c.data().load();
    c.offline(true); await c.data().completeTutorial(); await c.backend.syncTutorialCompletion();
    h.context = { ...h.context, OPENID: 'user-b' };
    const other = client(h, storage); await other.data().load(); await other.backend.syncTutorialCompletion();
    assert.equal(other.data().profile.tutorialCompleted, false);
    assert.equal(other.requests.filter(r => r.action === 'tutorialComplete').length, 0);
    const wrongEnv = new Map(Array.from(storage, ([k, v]) => [k.replace('test-env', 'another-env'), v]));
    const fresh = client(h, wrongEnv); await fresh.data().load();
    assert.equal(fresh.data().profile.tutorialCompleted, false);
});

test('教学补传版本冲突自动更新版本，经济改动仍保留', async () => {
    const h = harness(), c = client(h); await c.data().load(); await h.compensate(1234);
    await c.data().completeTutorial(); await c.backend.syncTutorialCompletion();
    const requests = c.requests.filter(r => r.action === 'tutorialComplete');
    assert.equal(requests.length, 2); assert.equal(requests[0].requestId, requests[1].requestId);
    const saved = await h.load(); assert.equal(saved.profile.tutorialCompleted, true); assert.equal(saved.profile.coins, 1234);
    await c.data().load(true); assert.equal(c.data().coins, 1234);
});

test('后台教学先提交时前台存档自动恢复仅教学标记引起的冲突', async () => {
    const h = harness(); let release;
    const c = client(h, new Map(), { respond(request, run) {
        if (request.action === 'tutorialComplete') return run().then(result => new Promise(resolve => { release = () => resolve(result); }));
        return run();
    } });
    await c.data().load(); await c.data().completeTutorial();
    await new Promise(resolve => setImmediate(resolve));
    await c.data().setIdentity({ avatarId: 'coral' });
    const currentRevision = c.backend.revision;
    release(); await c.backend.syncTutorialCompletion();
    assert.equal(c.backend.revision, currentRevision, '迟到教学响应不能倒退版本');
    assert.equal(c.data().avatarId, 'coral'); assert.equal(c.data().profile.tutorialCompleted, true);
    assert.equal(c.requests.filter(r => r.action === 'identity').length, 2);
});

test('本地空间不足也能结束当前教学并补传，正常云存档仍不允许无持久化扣费', async () => {
    const h = harness(), c = client(h), data = c.data(); await data.load(); c.options.failTutorialWrite = true;
    await data.completeTutorial(); await c.backend.syncTutorialCompletion();
    assert.equal(data.loaded, true); assert.equal(data.profile.tutorialCompleted, true);
    assert.equal((await h.load()).profile.tutorialCompleted, true);
});

test('同一云环境的开发与正式缓存隔离，开发登录不重放正式待发送请求或教学状态', async () => {
    const prod = harness(), dev = harness(), storage = new Map();
    await prod.compensate(); const c = client(prod, storage); await c.backend.loadProfile();
    c.drop(2); await assert.rejects(c.backend.spendCoinsForLevel(characterId, 1));
    const pending = [...storage].find(([key]) => key.endsWith('.pending'));
    assert.ok(pending); const saved = pending[1];
    const d = client(dev, storage, { storageNamespace: 'dev_', functionName: 'swimming-player-dev-v3' });
    assert.equal((await d.backend.loadProfile()).coins, 0);
    assert.equal(d.requests.every(req => req.action === 'load'), true);
    assert.equal(storage.get(pending[0]), saved, '开发登录不删除或重放正式订单');
    assert.equal((await client(prod, storage).backend.loadProfile()).coins, 9500);
    assert.ok([...storage.keys()].some(key => key.includes('.dev_.writer')));
});
