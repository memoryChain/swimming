'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../scripts/build-wechat-cloud.cjs');
const { configure } = require('../scripts/configure-wechat-cloud.cjs');
const { readTarget, assertClientConfig, writeClientRelease, assertClientRelease } = require('../scripts/wechat-cloud-target.cjs');
const { scopeDatabase } = require('../cloud/src/deployment.cjs');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'swimming-cloud-compat-'));
const built = build(output, { target: 'production', compatibility: true });
test.after(() => fs.rmSync(output, { recursive: true, force: true }));
const directory = path.join(output, built.functionName);
const { createService } = require(path.join(directory, 'service.cjs'));
const legacyRules = require(path.join(directory, 'legacy-rules.cjs'));
const { createDefaultProfile } = require(path.join(directory, 'rules/backend/PlayerProfile.js'));
const { coinCostForLevel } = require(path.join(directory, 'rules/progression/ProgressionBalance.js'));
const characterId = Object.keys(createDefaultProfile().characters)[0];
const copy = value => JSON.parse(JSON.stringify(value));
class Database {
    data = new Map(); queue = Promise.resolve();
    collection(name) { return { doc: id => ({ get: async () => ({ data: copy(this.data.get(`${name}/${id}`) ?? null) }) }) }; }
    runTransaction(work) {
        const task = this.queue.then(async () => {
            const snapshot = new Map([...this.data].map(([key, value]) => [key, copy(value)]));
            const tx = { collection: name => ({ doc: id => ({
                get: async () => ({ data: copy(snapshot.get(`${name}/${id}`) ?? null) }),
                set: async ({ data }) => { snapshot.set(`${name}/${id}`, copy(data)); },
            }) }) };
            const result = await work(tx); this.data = snapshot; return copy(result);
        });
        this.queue = task.catch(() => {}); return task;
    }
}
function harness() {
    const db = new Database(); db.data.set('counters/playerUid', { lastUid: 9999 }); db.data.set('dev_counters/playerUid', { lastUid: 9999 });
    let sequence = 0, time = 1800000000000;
    const context = { APPID: 'wx-test', OPENID: 'account-a' };
    const params = { appId: context.APPID, now: () => time, seed: () => 123, uuid: () => `uuid-${++sequence}`, legacyRules };
    const current = createService({ ...params, db: scopeDatabase(db, '') });
    const compatibility = createService({ ...params, db: scopeDatabase(db, ''), allowLegacyClients: true });
    const development = createService({ ...params, db: scopeDatabase(db, 'dev_') });
    const request = (version, action = 'load', data = {}, revision = 0, extra = {}) => ({ protocol: 1, rulesVersion: version, action, data,
        writerId: 'device-00001', requestId: `request-${++sequence}`, expectedRevision: revision, ...extra });
    const call = (service, req) => service.player(req, context);
    const load = version => call(version === 2 ? compatibility : current, request(version));
    return { db, context, current, compatibility, development, request, call, load, advance: ms => { time += ms; } };
}
const begin = { type: 'begin', characterId, source: 'league', tier: 0, distance: 200, rule: 'wild', seed: 999 };
const settlement = ticket => ({ type: 'settle', ticketId: ticket.id, finished: true, placement: 1,
    racerCount: (ticket.ai.opponentCount ?? 7) + 1, perfectCount: 80, goodCount: 10, missCount: 10, maxCombo: 80, time: 82 });
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swimming-target-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const file of ['config/cloud-environments.json', 'config/build/wechatgame.json', 'assets/scripts/backend/CloudProtocol.ts']) {
        const dest = path.join(root, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(path.resolve(file), dest);
    }
    return root;
}

test('同一云环境内开发函数、集合和本地命名空间隔离，正式名称保持原存档', async () => {
    const h = harness(), prod = await h.load(3);
    h.db.data.get(`players/${prod.playerId}`).profile.coins = 4567;
    h.db.data.set('gameConfig/global', { tutorialEnabled: false });
    h.db.data.set('dev_gameConfig/global', { tutorialEnabled: true });
    const dev = await h.call(h.development, h.request(3, 'load', { collectionPrefix: '', target: 'production' }));
    assert.equal(dev.ok, true); assert.equal(dev.playerId, prod.playerId); assert.equal(dev.profile.coins, 0);
    assert.equal(dev.featureFlags.tutorialEnabled, true); assert.equal((await h.load(3)).featureFlags.tutorialEnabled, false);
    const changed = await h.call(h.development, h.request(3, 'identity', { avatarId: dev.profile.avatarId }, dev.revision));
    assert.equal(changed.ok, true); assert.equal((await h.load(3)).revision, prod.revision);
    assert.equal((await h.load(3)).profile.coins, 4567);
    assert.equal(h.db.data.has(`dev_players/${prod.playerId}`), true);
    assert.equal([...h.db.data.keys()].filter(key => key.startsWith('operations/')).length, 0);
    assert.equal([...h.db.data.keys()].filter(key => key.startsWith('dev_operations/')).length, 1);
    assert.throws(() => scopeDatabase(h.db, 'players'), /前缀无效/);
    assert.throws(() => scopeDatabase(h.db, 'dev_').collection('../players'), /未知云集合/);
});

test('旧客户端继续读档与升级，旧价格与新价格分别执行，重复请求跨入口只扣一次', async () => {
    const h = harness(), loaded = await h.load(2);
    assert.equal(loaded.ok, true); assert.equal((await h.load(3)).playerId, loaded.playerId);
    const doc = h.db.data.get(`players/${loaded.playerId}`); doc.profile.coins = 100000; doc.profile.characters[characterId].level = 10;
    doc.profile.career.firstClearPrizes = [0];
    const req = h.request(2, 'level', { characterId, requestedLevels: 1 }, loaded.revision);
    const old = await h.call(h.compatibility, req);
    assert.equal(old.result.coinsSpent, legacyRules.coinCostForLevel(10));
    assert.equal(old.profile.coins, 100000 - old.result.coinsSpent);
    assert.deepEqual(old.profile.career.firstClearPrizes, [0], '旧操作保留新版可选字段');
    const recovered = await h.call(h.current, copy(req));
    assert.equal(recovered.ok, true); assert.equal(recovered.revision, old.revision); assert.equal(recovered.profile.coins, old.profile.coins);
    const next = await h.call(h.current, h.request(3, 'level', { characterId, requestedLevels: 1 }, old.revision));
    assert.equal(next.result.coinsSpent, coinCostForLevel(11));
    assert.equal(next.profile.coins, old.profile.coins - next.result.coinsSpent);
    assert.equal((await h.call(h.current, h.request(2))).code, 'VERSION', '版本入口不能变成旧版新操作入口');
    assert.equal((await h.call(h.compatibility, h.request(1))).code, 'VERSION');
});

test('旧客户端正常开赛结算，新客户端补结算旧票据按旧规则且不会重复发奖', async () => {
    const h = harness(), initial = await h.load(2);
    const started = await h.call(h.compatibility, h.request(2, 'career', begin, initial.revision));
    assert.equal(started.ok, true); assert.equal(started.result.ticket.rulesVersion, 2); assert.equal(started.result.ticket.terms, undefined);
    h.advance(100000);
    const req = h.request(2, 'career', settlement(started.result.ticket), started.revision);
    const settled = await h.call(h.current, req);
    assert.equal(settled.ok, true); assert.equal(settled.result.receipt.points, 20);
    const repeated = await h.call(h.compatibility, copy(req)); assert.deepEqual(repeated, settled);
    assert.equal((await h.load(2)).profile.coins, settled.profile.coins);
    const another = await h.call(h.compatibility, h.request(2, 'career', begin, settled.revision));
    h.advance(100000);
    const byNew = await h.call(h.current, h.request(3, 'career', settlement(another.result.ticket), another.revision));
    assert.equal(byNew.ok, true); assert.equal(byNew.result.receipt.points, 20);
});

test('新票据拒绝旧版结算，旧版重新开赛后新票据失效；篡改版本不改变条款', async () => {
    const h = harness(), initial = await h.load(3);
    const started = await h.call(h.current, h.request(3, 'career', { ...begin, rulesVersion: 2 }, initial.revision));
    assert.equal(started.result.ticket.rulesVersion, 3); assert.ok(started.result.ticket.terms);
    h.advance(100000);
    const rejected = await h.call(h.compatibility, h.request(2, 'career', settlement(started.result.ticket), started.revision));
    assert.equal(rejected.code, 'VERSION'); assert.equal((await h.load(3)).revision, started.revision);
    const replaced = await h.call(h.compatibility, h.request(2, 'career', begin, started.revision));
    assert.equal(replaced.ok, true); assert.notEqual(replaced.result.ticket.id, started.result.ticket.id);
    const stale = await h.call(h.current, h.request(3, 'career', settlement(started.result.ticket), replaced.revision));
    assert.equal(stale.code, 'TICKET'); assert.equal((await h.load(3)).profile.coins, 0);
});

test('同账号跨版本并发由同一事务版本保护，不覆盖另一设备的新余额', async () => {
    const h = harness(), initial = await h.load(3); h.db.data.get(`players/${initial.playerId}`).profile.coins = 10000;
    const rows = await Promise.all([h.call(h.current, h.request(3, 'level', { characterId, requestedLevels: 1 })),
        h.call(h.compatibility, h.request(2, 'level', { characterId, requestedLevels: 1 }, 0, { writerId: 'device-00002' }))]);
    assert.equal(rows.filter(row => row.ok).length, 1); assert.equal(rows.filter(row => row.code === 'CONFLICT').length, 1);
    assert.equal((await h.load(2)).profile.characters[characterId].level, 2);
});

test('配置切换生成独立微信输出与函数目录，缺配置及非法参数拒绝静默连接正式数据', t => {
    const root = fixture(t);
    const dev = configure('development', undefined, root);
    assert.equal(dev.functionName, 'swimming-player-dev-v3'); assert.equal(dev.collectionPrefix, 'dev_');
    assert.equal(assertClientConfig(root).target, 'development');
    const clientFile = path.join(root, 'assets/scripts/backend/WechatCloudConfig.ts');
    fs.writeFileSync(clientFile, fs.readFileSync(clientFile, 'utf8').replace(/\n/g, '\r\n'));
    assert.equal(assertClientConfig(root, 'development').target, 'development', 'Windows换行不应误报配置改变');
    const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json')));
    assert.equal(project.miniprogramRoot, 'build/wechatgame-development/'); assert.equal(project.cloudfunctionRoot, 'cloud/functions/development/');
    const prod = configure('production', undefined, root);
    assert.equal(prod.functionName, 'swimming-player-v3'); assert.equal(prod.collectionPrefix, ''); assert.equal(prod.environmentId, dev.environmentId);
    assert.throws(() => assertClientConfig(root, 'development'), /配置与构建目标不一致/);
    const before = fs.readFileSync(path.join(root, 'config/cloud-environments.json'), 'utf8');
    assert.throws(() => configure('development', 'bad id', root), /ID 无效/); assert.equal(fs.readFileSync(path.join(root, 'config/cloud-environments.json'), 'utf8'), before);
    const config = JSON.parse(before); config.environments.development.environmentId = ''; fs.writeFileSync(path.join(root, 'config/cloud-environments.json'), JSON.stringify(config));
    assert.throws(() => readTarget('development', root), /尚未配置/);
    config.environments.development.environmentId = prod.environmentId; config.environments.development.collectionPrefix = '';
    fs.writeFileSync(path.join(root, 'config/cloud-environments.json'), JSON.stringify(config));
    assert.throws(() => readTarget('development', root), /测试集合必须/);
});

test('打包明确目标并核对冻结规则，普通新版包不会生成原线上入口', t => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'swimming-dev-package-')); t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    const dev = build(temp, { target: 'development' });
    assert.deepEqual(dev.functions, ['swimming-player-dev-v3', 'swimming-admin-dev-v3']);
    assert.equal(fs.existsSync(path.join(temp, 'swimming-player')), false);
    const target = JSON.parse(fs.readFileSync(path.join(temp, dev.functionName, 'deployment-target.json')));
    assert.equal(target.collectionPrefix, 'dev_'); assert.equal(target.compatibility, false);
    assert.throws(() => build(temp, { target: 'development', compatibility: true }), /只能为 production/);
    const legacy = JSON.parse(fs.readFileSync(path.join(output, 'swimming-player/deployment-target.json')));
    assert.equal(legacy.compatibility, true); assert.equal(legacy.collectionPrefix, '');
});

test('客户端发布审计检查实际编译标识和脚本摘要，拒绝测试包提审与构建后篡改', t => {
    const root = fixture(t), info = configure('development', undefined, root);
    const dest = path.join(root, 'build/wechatgame-development'); fs.mkdirSync(path.join(dest, 'subpackages/gameplay'), { recursive: true });
    const file = path.join(dest, 'subpackages/gameplay/index.js'); fs.writeFileSync(file, `console.info('${info.buildStamp}')`);
    writeClientRelease(root, dest); assert.equal(assertClientRelease(root, dest, 'development').target, 'development');
    assert.throws(() => assertClientRelease(root, dest, 'production'), /配置与目标不一致/);
    fs.appendFileSync(file, '\nchanged'); assert.throws(() => assertClientRelease(root, dest, 'development'), /脚本已改变/);
    fs.writeFileSync(file, 'old-client'); assert.throws(() => writeClientRelease(root, dest), /旧构建/);
});

test('部署检查拒绝目标混用、覆盖旧入口的普通部署和变动源码', t => {
    const { checkServerRelease } = require('../scripts/deploy-wechat-cloud.cjs');
    assert.equal(checkServerRelease('production', { compatibility: true, directory: output }).info.collectionPrefix, '');
    assert.throws(() => checkServerRelease('development', { directory: output }), /目标不匹配/);
    assert.throws(() => checkServerRelease('production', { directory: output }), /错误入口/);
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'swimming-deploy-guard-')); t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    fs.cpSync(output, temp, { recursive: true });
    fs.appendFileSync(path.join(temp, built.functionName, 'service.cjs'), '\nchanged');
    assert.throws(() => checkServerRelease('production', { compatibility: true, directory: temp }), /部署源码已改变/);
});
