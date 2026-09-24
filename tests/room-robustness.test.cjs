const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
const root = path.resolve(__dirname, '..');
function compiler() {
    if (process.env.TYPESCRIPT_PATH) return require(process.env.TYPESCRIPT_PATH);
    try { return require('typescript'); } catch {}
    for (const directory of process.env.PATH.split(path.delimiter)) {
        const file = path.resolve(directory, '../typescript/lib/typescript.js');
        if (fs.existsSync(file)) return require(file);
    }
    throw new Error('需要 TypeScript 5.4.5');
}
const ts = compiler();
const flush = async () => { for (let i = 0; i < 45; i++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
class Node { isValid = true; constructor(name) { this.name = name; } destroy() { this.isValid = false; } }
class Color { constructor(r, g, b) { Object.assign(this, { r, g, b }); } }

function harness({ loaded = true, supported = true } = {}) {
    const calls = [], broadcasts = [], sessions = [], views = [], timers = new Map(), cache = new Map();
    let nextTimer = 0, access = '';
    const player = { loaded, avatarId: 'lime', nickName: '测试玩家', profile: { career: { league: 0 } },
        load: async () => player.profile };
    let digest = { characterId: 'cartonSwimmer6', level: 1, skinToneId: 'warm', colorSchemeId: 'red' };
    const info = () => ({ accessInfo: access, localPos: 2, localClientId: 22, members: [
        { clientId: 11, pos: 0, owner: true, ready: true, extInfo: 'coral|房主' },
        { clientId: 22, pos: 2, owner: false, ready: false, extInfo: `lime|${player.nickName}` },
    ] });
    const net = {
        callbacks: {}, isSupported: () => supported, isOwner: () => false,
        setCallbacks: callbacks => { net.callbacks = callbacks; }, currentAccessInfo: () => access,
        login: async () => { calls.push('login'); },
        joinRoom: async (room, identity) => { calls.push(['join', room, identity]); access = room; return info(); },
        createRoom: async options => { calls.push(['create', options]); access = 'created'; return info(); },
        leaveRoom: async () => { calls.push(['leave', access]); access = ''; },
        updateReady: async ready => { calls.push(['ready', ready]); },
        getRoomInfo: async () => info(), broadcast: message => broadcasts.push(message),
        startGame: async () => { calls.push('start'); }, endGame: () => { throw new Error('不得结束保活会话'); },
    };
    const timer = (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; };
    const mocks = {
        cc: { Node, Color }, 'cc/env': { WECHAT: false },
        '../progression/CareerRules': { LEAGUES: Array(8) },
        '../core/GameBalance': { setRaceDifficulty() {} },
        '../backend/PlayerData': { PlayerData: player },
        '../progression/RaceModifiers': { resolveLocalModifierDigest: () => ({ ...digest }) },
        '../net/NetRaceSession': { setNetRaceSession: value => sessions.push(value) },
        '../platform/PlatformManager': { platform: () => ({ share() {} }) },
        './OnlineRoomView': { ROOM_MODES: [{ id: 'competitive' }, { id: 'beginner' }, { id: 'championship' }],
            OnlineRoomView: class {
                root = new Node('房间'); states = [];
                constructor(parent, callbacks) { this.callbacks = callbacks; views.push(this); }
                update(state) { this.states.push(state); this.state = state; }
                showUnavailable(message) { this.unavailable = message; }
            } },
        './DefaultNetRoom': { DefaultNetRoom: class {} }, './WechatGameRoom': { WechatGameRoom: class {} },
    };
    function load(relative) {
        const file = path.resolve(root, relative);
        if (cache.has(file)) return cache.get(file);
        const exports = {}; cache.set(file, exports);
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
            target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
        } }).outputText;
        new Function('require', 'exports', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'console', code)(
            id => mocks[id] ?? load(path.resolve(path.dirname(file), `${id}.ts`)), exports, timer, id => timers.delete(id), timer, id => timers.delete(id), { log() {}, warn() {} });
        return exports;
    }
    const { serializeRoomOperation } = load('assets/scripts/net/NetManager.ts');
    mocks['../net/NetManager'] = { netRoom: () => net, serializeRoomOperation };
    const { RoomFlow } = load('assets/scripts/ui/RoomFlow.ts');
    const flows = [];
    const create = (join = 'friend', reconnect = false) => {
        const flow = new RoomFlow(new Node('Canvas'), 1280, 720,
            { onExit: () => calls.push('exit'), onStartLocalRace: () => calls.push('local'), onStartNetRace: () => calls.push('race') }, join, reconnect);
        flows.push(flow); return flow;
    };
    return { calls, broadcasts, sessions, views, timers, net, player, load, create, info,
        setDigest: value => { digest = value; }, setAccess: value => { access = value; },
        tick: ms => { for (const [id, item] of [...timers]) if (item.ms === ms) { timers.delete(id); item.fn(); } },
        close: async () => { flows.forEach(flow => flow.dispose()); await flush(); },
    };
}

test('首次玩家必须等真实存档就绪才发布身份，失败可以重试且连点只进房一次', async t => {
    const h = harness({ loaded: false }); t.after(h.close);
    const profile = deferred(); h.player.load = () => profile.promise;
    const flow = h.create(); await flush();
    assert.deepEqual(h.calls, []); assert.equal(flow._view.state.members.length, 0);
    profile.resolve(); await flush();
    assert.equal(flow._entryFailed, true); assert.equal(flow._view.state.primaryText, '重试连接');
    h.player.load = async () => { h.player.loaded = true; h.player.nickName = '持久昵称'; };
    flow._view.callbacks.primary(); flow._view.callbacks.primary(); await flush();
    assert.equal(h.calls.filter(call => Array.isArray(call) && call[0] === 'join').length, 1);
    assert.deepEqual(h.calls.find(call => Array.isArray(call) && call[0] === 'join'), ['join', 'friend', 'lime|持久昵称']);
    assert.equal(flow._localPos, 2); assert.equal(flow._entryFailed, false);
});

test('退出后的迟到进房先清理，后续新邀请才加入，旧回调不覆盖新界面', async t => {
    const h = harness(); t.after(h.close);
    const pending = deferred(), realJoin = h.net.joinRoom;
    h.net.joinRoom = async (room, identity) => room === 'old' ? pending.promise : realJoin(room, identity);
    const old = h.create('old'); await flush(); const oldCallbacks = h.net.callbacks;
    assert.equal(await old.leaveForInvite(), true); old.dispose();
    const fresh = h.create('new'); await flush();
    assert.equal(h.calls.filter(call => Array.isArray(call) && call[0] === 'join').length, 0);
    h.setAccess('old'); pending.resolve({ ...h.info(), accessInfo: 'old' }); await flush();
    const leave = h.calls.findIndex(call => Array.isArray(call) && call[0] === 'leave');
    const join = h.calls.findIndex(call => Array.isArray(call) && call[0] === 'join');
    assert.ok(leave >= 0 && leave < join); assert.equal(fresh._accessInfo, 'new');
    const count = fresh._view.states.length;
    oldCallbacks.onRoomInfoChange(h.info()); oldCallbacks.onGameStart(); oldCallbacks.onKicked();
    assert.equal(fresh._view.states.length, count); assert.equal(h.sessions.length, 0);
});

test('连接超时可返回大厅，迟到成功仍清理且不会自动进入房间或比赛', async t => {
    const h = harness(); t.after(h.close); const pending = deferred();
    h.net.joinRoom = () => pending.promise;
    const flow = h.create(); await flush(); h.tick(15000);
    assert.equal(flow._view.state.primaryText, '返回大厅'); assert.equal(flow._view.state.busy, false);
    await flow.exit(); assert.ok(h.calls.includes('exit')); flow.dispose();
    h.setAccess('friend'); pending.resolve(h.info()); await flush();
    assert.equal(h.net.currentAccessInfo(), ''); assert.equal(h.sessions.length, 0);
});

test('断网不会伪装成本地房间或解散，退出失败保留当前房间', async t => {
    const h = harness(); t.after(h.close); h.net.login = async () => { throw new Error('断网'); };
    const flow = h.create(); await flush();
    assert.equal(flow._entryFailed, true); assert.equal(flow._view.unavailable, undefined);
    assert.match(flow._statusHint, /网络/); assert.equal(h.calls.includes('local'), false);
    h.net.login = async () => {}; flow.setupNet(); await flush();
    h.net.leaveRoom = async () => { throw new Error('退出失败'); };
    assert.equal(await flow.leaveForInvite(), false); assert.equal(flow._leaving, false);
    assert.equal(flow._disposed, false); assert.equal(h.net.currentAccessInfo(), 'friend');
});

test('用平台座位和客户端编号识别自己，同头像昵称不会误认房主', async t => {
    const h = harness(); t.after(h.close); const flow = h.create(); await flush();
    const members = flow.membersFromInfo({ localPos: 2, localClientId: 22, accessInfo: 'friend', members: [
        { clientId: 11, pos: 0, owner: true, extInfo: 'lime|测试玩家' },
        { clientId: 22, pos: 2, owner: false, extInfo: 'lime|测试玩家' },
    ] });
    assert.equal(members[0].self, false); assert.equal(members[1].self, true); assert.equal(flow._isHost, false);
});

test('长中文和表情昵称符合 32 字节限制，不截断表情代理对', async t => {
    const h = harness(); t.after(h.close);
    h.player.avatarId = 'lifeguard'; h.player.nickName = '🏊🏊🏊超长昵称超长昵称';
    h.create(); await flush();
    const payload = h.calls.find(call => Array.isArray(call) && call[0] === 'join')[2];
    assert.ok(Buffer.byteLength(payload) <= 32); assert.ok(payload.includes('🏊'));
    assert.equal(Buffer.from(payload).toString(), payload);
});

test('所有角色外观与存档一致，暖肤色保留原贴图；摘要拒绝非法值和缺失外观', () => {
    const h = harness(), config = h.load('assets/scripts/app/PlayerCharacterConfig.ts');
    const codec = h.load('assets/scripts/net/NetRaceModifierCodec.ts');
    const look = h.load('assets/scripts/net/NetSwimmerLook.ts');
    for (const character of config.PLAYER_CHARACTER_DEFINITIONS) for (const skin of config.PLAYER_SKIN_TONES) {
        const digest = { characterId: character.id, level: 7, skinToneId: skin.id, colorSchemeId: 'soft-lilac' };
        const decoded = codec.decodeModifierDigest(codec.encodeModifierDigest(digest));
        assert.deepEqual(decoded, digest);
        const visual = look.netSwimmerLook(decoded);
        assert.equal(visual.modelVariantId, character.modelVariantId);
        assert.deepEqual(visual.suitColor, config.PLAYER_COLOR_SCHEMES.find(color => color.id === 'soft-lilac').suit);
        if (skin.preserveOriginal || character.supportsSkinTone === false) assert.equal(visual.skinColor, undefined);
        const rig = { setModelVariant: value => { rig.model = value; }, setColorVariant() {}, setColorOverride: value => { rig.colors = value; } };
        look.applyNetSwimmerLook(rig, decoded); assert.equal(rig.model, character.modelVariantId);
    }
    for (const bad of ['bad,1,warm,red', 'cartonSwimmer6,NaN,warm,red', 'cartonSwimmer6,31,warm,red', 'cartonSwimmer6,1junk,warm,red', 'cartonSwimmer6,1,warm,missing']) assert.equal(codec.decodeModifierDigest(bad), null);
    assert.equal(codec.hasCompleteModifierDigest('cartonSwimmer6,1'), false);
});

function prepare(h, flow, host = false) {
    const { NET_RACE_PROTOCOL_VERSION } = h.load('assets/scripts/net/NetRaceProtocol.ts');
    flow._isHost = host; flow._localPos = host ? 0 : 2;
    flow._members = [
        { clientId: 11, pos: 0, self: host, owner: true, ready: true, avatarId: 'coral', nickName: '房主' },
        { clientId: 22, pos: 2, self: !host, owner: false, ready: true, avatarId: 'lime', nickName: '测试玩家' },
    ];
    flow.reconcileProtocolRoster();
    flow._memberProtocolVersions[0] = flow._memberProtocolVersions[2] = NET_RACE_PROTOCOL_VERSION;
    flow._memberModifiers[0] = flow._memberModifiers[2] = 'cartonSwimmer6,1,warm,red';
    flow._rulesId = '1800000000000'; flow._rulesRevision = 1;
    flow._localReady = true; flow._localReadyRule = flow.ruleKey();
    flow._ruleReady[2] = flow.ruleKey(); flow._ruleReadyModifiers[2] = flow._memberModifiers[2];
    return { t: 'start', pv: NET_RACE_PROTOCOL_VERSION, owner: 0, seed: 123, mode: flow._mode, rules: flow.ruleKey(),
        roster: flow._members.map(member => flow.memberKey(member)), mods: { ...flow._memberModifiers } };
}

test('未收齐角色不能开始，丢失的摘要会低频重发；换座位后旧成员消息无效', async t => {
    const h = harness(); t.after(h.close); const flow = h.create(); await flush(); prepare(h, flow, true);
    delete flow._memberModifiers[2]; flow.startRace(); assert.equal(h.calls.includes('start'), false);
    h.tick(1500); assert.ok(h.broadcasts.some(message => message.startsWith('MOD|')));
    const old = flow.memberKey(flow._members[1]); flow._members[1].clientId = 33; flow.reconcileProtocolRoster();
    flow.collectMemberModifiers(`MOD|2|${encodeURIComponent(old)}|cartonSwimmer6,1,warm,red`);
    assert.equal(flow._memberModifiers[2], undefined);
    flow.collectMemberModifiers(`MOD|2|${encodeURIComponent(flow.memberKey(flow._members[1]))}|cartonSwimmer6,1,warm,red`);
    assert.equal(flow._memberModifiers[2], 'cartonSwimmer6,1,warm,red');
    flow.handleRules({ t: 'rulesReady', pos: 2, member: old, key: flow.ruleKey(), seq: 99, ready: true, mods: flow._memberModifiers[2] });
    assert.equal(flow.allMembersReady(), false);
    flow.handleRules({ t: 'rulesReady', pos: 2, member: flow.memberKey(flow._members[1]), key: flow.ruleKey(), seq: 1, ready: true, mods: flow._memberModifiers[2] });
    assert.equal(flow.allMembersReady(), true);
});

test('房主开赛有限补发跨过场景销毁，好友丢失首包仍能进入，换房后停止补发', async t => {
    const host = harness(), guest = harness(); t.after(host.close); t.after(guest.close);
    const h = host.create(), g = guest.create(); await flush(); prepare(host, h, true); prepare(guest, g);
    h.startRace(); assert.equal(host.calls.filter(call => call === 'start').length, 1);
    const first = host.broadcasts.filter(msg => msg.startsWith('{"t":"start"'))[0]; assert.ok(first);
    h.onNetGameStart(); h.dispose(); host.tick(300);
    const retry = host.broadcasts.filter(msg => msg.startsWith('{"t":"start"'))[1]; assert.equal(retry, first);
    g.handleBroadcast(retry); g.handleBroadcast(retry); g.onNetGameStart();
    assert.equal(guest.calls.filter(call => call === 'start').length, 1);
    assert.equal(guest.sessions[0].seed, host.sessions[0].seed);
    host.setAccess('another'); host.tick(900); host.tick(1800);
    assert.equal(host.broadcasts.filter(msg => msg.startsWith('{"t":"start"')).length, 2);
});

function inviteHarness() {
    const file = path.join(root, 'assets/scripts/app/LoginManager.ts');
    const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const cls = ast.statements.find(item => ts.isClassDeclaration(item) && item.name.text === 'LoginManager');
    const methods = ['handleAppShowInvite', 'followLatestInvite'].map(name => cls.members.find(item => item.name?.getText(ast) === name).getText(ast)).join('\n');
    const code = ts.transpileModule(`return class { ${methods} };`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const Manager = new Function(code)(), manager = new Manager(), opened = [];
    manager._canvasNode = new Node('Canvas');
    manager.openRoom = target => { opened.push(target); manager._roomFlow = { matchesRoom: value => value === target, leaveForInvite: async () => true, dispose() {} }; };
    return { manager, opened };
}

test('热启动连续邀请只跟随最新房号，同房不重进，退出失败及销毁不创建新房', async () => {
    const { manager, opened } = inviteHarness(), pending = deferred(); let leaves = 0, disposes = 0;
    manager._roomFlow = { matchesRoom: room => room === 'old', leaveForInvite: () => { leaves++; return pending.promise; }, dispose: () => disposes++ };
    manager.handleAppShowInvite({ room: 'old' }); await flush(); assert.equal(leaves, 0);
    manager.handleAppShowInvite({ room: 'first' }); manager.handleAppShowInvite({ room: 'latest' });
    assert.equal(leaves, 1); pending.resolve(true); await flush(); assert.deepEqual(opened, ['latest']); assert.equal(disposes, 1);
    manager.handleAppShowInvite({ room: 'latest' }); await flush(); assert.equal(opened.length, 1);
    const current = manager._roomFlow; current.leaveForInvite = async () => false;
    manager.handleAppShowInvite({ room: 'failed' }); await flush(); assert.equal(manager._roomFlow, current); assert.equal(opened.length, 1);
    const last = deferred(); current.leaveForInvite = () => last.promise;
    manager.handleAppShowInvite({ room: 'cancelled' }); manager._destroyed = true; last.resolve(true); await flush(); assert.equal(opened.length, 1);
});

test('开赛包缺失角色、改变本人配置或名单不一致时拒绝；有效包冻结快照且只进场一次', async t => {
    const h = harness(); t.after(h.close); const flow = h.create(); await flush(); const start = prepare(h, flow);
    for (const invalid of [ { ...start, mods: { 0: start.mods[0] } }, { ...start, mods: { ...start.mods, 2: 'muscleMan,9,deep,blue' } },
        { ...start, roster: [] }, { ...start, pv: 45 }, { ...start, seed: 0 }, { ...start, owner: 2 } ]) {
        flow.handleBroadcast(JSON.stringify(invalid)); assert.equal(flow._startRequested, false);
    }
    // 旧版本消息会主动取消准备；玩家重新准备后才接受正确的开赛消息。
    assert.equal(flow._localReady, false);
    flow._localReady = true; flow._localReadyRule = flow.ruleKey();
    flow.handleBroadcast(JSON.stringify(start)); flow.handleBroadcast(JSON.stringify({ ...start, seed: 999 }));
    assert.equal(flow._pendingSeed, 123);
    flow._memberModifiers[2] = 'muscleMan,9,deep,blue';
    flow.onNetGameStart(); flow.onNetGameStart();
    assert.equal(h.sessions.length, 1); assert.equal(h.sessions[0].members[1].modifiersBlob, 'cartonSwimmer6,1,warm,red');
});

test('重赛保留同一会话，直接进入且不调用 create/join/start/endGame', async t => {
    const h = harness(); t.after(h.close); h.setAccess('kept');
    const flow = h.create(null, true); await flush(); const start = prepare(h, flow);
    flow.handleBroadcast(JSON.stringify(start));
    assert.equal(h.sessions.length, 1);
    assert.equal(h.calls.some(call => call === 'login' || call === 'start' || ['join', 'create', 'leave'].includes(call[0])), false);
});

test('首次本地存档及旧存档恢复角色和配色，不把临时身份当作最终身份', async () => {
    const h = createHarness(); const storage = new Map();
    h.cc.sys = { localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } };
    const data = h.load(path.join(root, 'assets/scripts/backend/PlayerData.ts')).PlayerData;
    await data.load(); assert.equal(data.loaded, true);
    assert.equal(data.profile.characterSelection.characterId, 'cartonSwimmer6');
    assert.equal(data.profile.characters.cartonSwimmer6.level, 1);
    assert.equal(JSON.parse(storage.get('swimming.player-profile')).nickName, data.nickName);
    const saved = JSON.parse(storage.get('swimming.player-profile'));
    saved.characterSelection = { characterId: 'cartonSwimmer14', skinToneId: 'deep', colorSchemeId: 'lake-teal' };
    storage.set('swimming.player-profile', JSON.stringify(saved));
    const second = createHarness(); second.cc.sys = h.cc.sys;
    await second.load(path.join(root, 'assets/scripts/backend/PlayerData.ts')).PlayerData.load();
    assert.deepEqual(second.load(path.join(root, 'assets/scripts/app/PlayerCharacterConfig.ts')).getPlayerCharacterSelection(), saved.characterSelection);
});
