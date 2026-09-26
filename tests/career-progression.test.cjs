const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
const h = createHarness();
const storage = new Map();
let writeFailure = false;
h.cc.sys = { localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { if (writeFailure) throw Error('模拟存储失败'); storage.set(key, value); },
    removeItem: key => storage.delete(key),
} };
const load = name => h.load(path.join(h.root, 'assets/scripts', name + '.ts'));
const { createDefaultProfile, normalizeProfile } = load('backend/PlayerProfile');
const { executeCareer, quickEvent, cupRounds } = load('progression/CareerRules');
const { coinCostForLevel, calculateRaceCoins } = load('progression/ProgressionBalance');
const { MockBackend } = load('backend/MockBackend');
const roster = Object.keys(createDefaultProfile().characters);
const [a, b] = roster;

test('旧档迁移只在本地加载成功后执行，持久化确认前保留旧键，失败不删除', async () => {
    const legacyKey = 'SpeedSwimming.Progression.v2';
    const saved = new Map([[legacyKey, JSON.stringify({ characters: { [a]: { level: 10 } } })]]);
    let resolve, reject, writes = 0;
    const player = { loaded: false, usesCloud: false, profile: createDefaultProfile(),
        persist: () => { writes++; return new Promise((yes, no) => { resolve = yes; reject = no; }); } };
    const fixture = createHarness({ '../backend/PlayerData': { PlayerData: player } });
    fixture.cc.sys = { localStorage: { getItem: key => saved.get(key) ?? null, removeItem: key => saved.delete(key) } };
    const { ProgressionManager } = fixture.load(path.join(fixture.root, 'assets/scripts/progression/ProgressionManager.ts'));
    const manager = new ProgressionManager();
    await manager.migrateLegacySave(); assert.equal(writes, 0);
    player.loaded = true; player.usesCloud = true;
    await manager.migrateLegacySave(); assert.equal(writes, 0); assert.ok(saved.has(legacyKey));
    player.usesCloud = false;
    const failed = manager.migrateLegacySave(); assert.ok(saved.has(legacyKey));
    reject(Error('保存失败')); await assert.rejects(failed); assert.ok(saved.has(legacyKey));
    const success = manager.migrateLegacySave(); assert.ok(saved.has(legacyKey));
    resolve(player.profile); await success; assert.equal(saved.has(legacyKey), false);
    assert.equal(player.profile.characters[a].level, 10);
});
function begin(p, source = 'league', id = a, tier = p.career.league, extra = {}) {
    const r = executeCareer(p, { type: 'begin', source, characterId: id, tier, distance: 200, rule: 'standard', seed: 12345, ...extra });
    assert.equal(r.ok, true, r.message); return r.ticket;
}
function finish(p, ticket, placement = 1, extra = {}) {
    return executeCareer(p, { type: 'settle', ticketId: ticket.id, placement, racerCount: 8,
        finished: true, perfectCount: 80, goodCount: 10, missCount: 10, maxCombo: 80, time: 82, ...extra });
}

test('旧存档保留金币和培养等级，已培养角色免重复签约', () => {
    const p = normalizeProfile({ schema: 4, coins: 999, characters: { [a]: { level: 15 }, [b]: { level: 1 } } });
    assert.equal(p.coins, 999); assert.equal(p.characters[a].level, 15);
    assert.equal(p.characters[a].signed, true); assert.equal(p.characters[b].signed, false);
    assert.equal(p.career.freeSigningUsed, true);
    assert.equal(normalizeProfile({ schema: 4, characters: { [a]: { level: 1 } } }).career.freeSigningUsed, false);
    assert.deepEqual(normalizeProfile(JSON.parse(JSON.stringify(p))).career, p.career);
});

test('联赛进度账号共享，换未培养角色不降固定赛事难度', () => {
    const p = createDefaultProfile(); p.career.league = 3;
    const t = begin(p); finish(p, t, 2);
    assert.equal(p.career.points, 14);
    p.characters[b].level = 30;
    const t2 = begin(p, 'league', b);
    assert.deepEqual(t.ai, t2.ai); assert.equal(p.career.points, 14);
    finish(p, t2, 1); assert.equal(p.career.points, 34);
    finish(p, begin(p, 'league', b, 0), 1); assert.equal(p.career.points, 34);
});

test('杯赛角色独立，轮间升级立即生效，中断重新报名同轮不换难度或种子', () => {
    let p = createDefaultProfile(); p.career.points = 100;
    const t = begin(p, 'cup'); finish(p, t, 2);
    assert.equal(p.career.cups[a].round, 1);
    begin(p, 'cup', b); assert.equal(p.career.cups[b].round, 0);
    p = normalizeProfile(JSON.parse(JSON.stringify(p)));
    const before = begin(p, 'cup', a);
    p.characters[a].level = 20;
    const after = begin(p, 'cup', a);
    assert.equal(after.level, 20); assert.equal(before.seed, after.seed); assert.deepEqual(before.ai, after.ai);
    assert.equal(after.round, 1); assert.equal(p.career.cups[b].round, 0);
    const r = finish(p, after);
    assert.equal(r.receipt.first, 0); assert.equal(r.receipt.podium, 0);
    assert.equal(r.receipt.coinsGained, 60);
    assert.equal(p.career.league, 1); assert.equal(p.career.points, 0);
    assert.ok(p.career.wins[a].indexOf(0) >= 0);
});

test('不同角色重打杯赛不会重复领取账号首次奖励或重复晋级', () => {
    const p = createDefaultProfile(); p.career.points = 100;
    finish(p, begin(p, 'cup')); finish(p, begin(p, 'cup'));
    finish(p, begin(p, 'cup', b, 0));
    const r = finish(p, begin(p, 'cup', b, 0));
    assert.equal(r.receipt.first, 0); assert.equal(r.receipt.podium, 0);
    assert.equal(p.career.league, 1); assert.equal(p.career.wins[b][0], 0);
});

test('三轮杯门槛与400米决赛；未完赛不获奖不晋级，重复结算幂等', () => {
    const p = createDefaultProfile(); p.career.league = 3; p.career.points = 100;
    assert.equal(cupRounds(3), 3);
    finish(p, begin(p, 'cup'), 4); finish(p, begin(p, 'cup'), 3);
    const t = begin(p, 'cup'); assert.equal(t.distance, 400);
    const result = finish(p, t, 1, { finished: false, time: 0 });
    assert.equal(result.receipt.coinsGained, 0); assert.equal(p.career.cups[a].state, 'lost');
    const coins = p.coins; assert.deepEqual(finish(p, t, 1).receipt, result.receipt); assert.equal(p.coins, coins);
});

test('自动适配读取当前角色等级和赛事水平，正式杯赛不读取玩家等级', () => {
    const p = createDefaultProfile(); const initial = quickEvent(p, a, 200, 'standard');
    p.career.league = 5; p.characters[a].level = 30;
    const master = quickEvent(p, a, 200, 'standard'), fresh = quickEvent(p, b, 200, 'standard');
    assert.ok(master.minLevel > fresh.maxLevel); assert.ok(fresh.maxLevel < 10);
    assert.notDeepEqual(initial.intelligence, fresh.intelligence);
    const first = begin(p, 'cup', a, 0); const second = begin(p, 'cup', b, 0);
    assert.deepEqual(first.ai, second.ai);
});

test('四种距离规则组合独立，好友来源拒绝奖励凭据', () => {
    const p = createDefaultProfile();
    for (const distance of [200, 400]) for (const rule of ['standard', 'wild']) {
        const t = begin(p, 'quick', a, 0, { distance, rule });
        assert.equal(t.distance, distance); assert.equal(t.rule, rule);
    }
    const old = JSON.stringify(p);
    assert.equal(executeCareer(p, { type: 'begin', source: 'friend', characterId: a, tier: 0, distance: 200, rule: 'standard', seed: 4 }).ok, false);
    assert.equal(JSON.stringify(p), old);
    const { setSoloRaceDistance, setRaceDifficulty, getRaceDistance, isRaceSteeringEnabled } = load('core/GameBalance');
    setRaceDifficulty('beginner'); setSoloRaceDistance(400);
    assert.equal(getRaceDistance(), 400); assert.equal(isRaceSteeringEnabled(), false);
    assert.equal(getRaceDistance('competitive'), 200, '房间显式模式不受单人距离覆盖');
    setSoloRaceDistance(null); assert.equal(getRaceDistance(), 200);
});

test('奖励有上限、400米倍率准确、升级成本单调且低于旧总成本', () => {
    const input = { finished: true, placement: 1, racerCount: 8, perfectCount: 80, goodCount: 10, missCount: 10, maxCombo: 80 };
    assert.equal(calculateRaceCoins(input), 480);
    assert.equal(calculateRaceCoins({ ...input, distance: 400 }), 1056);
    assert.ok(calculateRaceCoins({ ...input, maxCombo: 999999 }) <= 500);
    let sum = 0;
    for (let level = 1; level < 30; level++) {
        sum += coinCostForLevel(level);
        if (level > 1) assert.ok(coinCostForLevel(level) > coinCostForLevel(level - 1));
    }
    assert.equal(coinCostForLevel(1), 800); assert.ok(sum < 537869); assert.equal(coinCostForLevel(30), 0);
});

test('全部角色直接金币升级并持久化，写失败不能假成功', async () => {
    storage.clear(); const backend = new MockBackend();
    let p = await backend.loadProfile(); p.coins = 10000; await backend.saveProfile(p);
    const result = await backend.spendCoinsForLevel(a, 1);
    assert.equal(result.levelsGained, 1); assert.equal(result.coinsSpent, 800);
    assert.equal((await backend.loadProfile()).characters[a].level, 2);
    writeFailure = true;
    try { assert.throws(() => backend.spendCoinsForLevel(b, 1)); }
    finally { writeFailure = false; }
    assert.equal((await backend.loadProfile()).characters[b].level, 1);
});

test('奖励调用源明确门控联机与调试，旧无凭据发奖入口已移除', () => {
    const gm = fs.readFileSync(path.join(h.root, 'assets/scripts/core/GameManager.ts'), 'utf8');
    const award = gm.slice(gm.indexOf('awardProgression: async'), gm.indexOf('applyPlayerDive: (result)'));
    assert.match(award, /this\._roomMode \|\| this\._netSession/);
    assert.match(award, /if \(!ticket\) return null/);
    assert.doesNotMatch(gm, /progression\.awardRace/);
});

test('角色选择与结算并发不覆盖金币，保存失败后下一次事务先重试结算', async () => {
    storage.clear();
    const { PlayerData: data } = load('backend/PlayerData');
    await data.load();
    const start = { type: 'begin', source: 'league', characterId: a, tier: 0, distance: 200, rule: 'standard', seed: 45 };
    const first = await data.executeCareer(start);
    const result = { type: 'settle', ticketId: first.ticket.id, placement: 1, racerCount: 8, finished: true,
        perfectCount: 80, goodCount: 10, missCount: 10, maxCombo: 80, time: 82 };
    await Promise.all([data.executeCareer(result), data.setCharacterSelection({ ...data.profile.characterSelection, characterId: b })]);
    assert.equal(data.coins, 480); assert.equal(data.profile.characterSelection.characterId, b);
    assert.equal(JSON.parse(storage.get('swimming.player-profile')).coins, 480);
    const next = await data.executeCareer(start);
    writeFailure = true;
    try { await assert.rejects(data.executeCareer({ ...result, ticketId: next.ticket.id })); }
    finally { writeFailure = false; }
    assert.equal(data.coins, 480);
    await data.executeCareer(start);
    assert.equal(data.coins, 960); assert.equal(data.profile.career.points, 40);
});


test('所有级别联赛和杯赛各轮固定狂野，快速比赛仍尊重玩家所选规则', () => {
    assert.equal(createDefaultProfile().career.quick.rule, 'wild');
    for (let tier=0;tier<6;tier++) {
        const p=createDefaultProfile();p.career.league=tier;p.career.points=100;
        const league=begin(p,'league',a,tier,{rule:'standard'});
        assert.equal(league.rule,'wild');finish(p,league);
        for(let round=0;round<cupRounds(tier);round++) {
            const cup=begin(p,'cup',a,tier,{rule:'standard'});
            assert.equal(cup.rule,'wild');assert.equal(cup.round,round);finish(p,cup);
        }
    }
    const p=createDefaultProfile();
    for(const rule of ['standard','wild']) {
        const ticket=begin(p,'quick',a,0,{rule});assert.equal(ticket.rule,rule);finish(p,ticket);
    }
});


test('各级联赛与杯赛逐轮配置独立，开赛凭据复制角色权重且可保存恢复', () => {
    const {CAREER_AI_EVENTS}=load('progression/CareerAiConfig');
    const {eventFor}=load('progression/CareerRules');
    for(let tier=0;tier<6;tier++) {
        assert.equal(CAREER_AI_EVENTS[tier].cup.length,cupRounds(tier));
        assert.deepEqual(eventFor(tier),CAREER_AI_EVENTS[tier].league);
        for(let round=0;round<cupRounds(tier);round++) assert.deepEqual(eventFor(tier,round),CAREER_AI_EVENTS[tier].cup[round]);
    }
    const config=CAREER_AI_EVENTS[0],old=config.cup[1];
    try {
        config.cup[1]={minLevel:7,maxLevel:7,opponentCount:7,intelligence:Array(7).fill('expert'),characterWeights:[{characterId:a,weight:1}]};
        const p=createDefaultProfile();p.career.points=100;
        finish(p,begin(p,'cup'));
        const ticket=begin(p,'cup');assert.equal(ticket.ai.minLevel,7);assert.deepEqual(ticket.ai.characterWeights,[{characterId:a,weight:1}]);
        assert.deepEqual(normalizeProfile(JSON.parse(JSON.stringify(p))).career.pending.ai,ticket.ai);
        config.cup[1].characterWeights[0].weight=99;assert.equal(ticket.ai.characterWeights[0].weight,1);
        assert.notEqual(eventFor(0).minLevel,7);
    } finally {config.cup[1]=old;}
});

test('角色权重抽取可单角色、可重复、零权重不出现，并由种子复现', () => {
    const {setSoloAiEvent,buildRandomizedAiRoster}=load('competitor/CompetitorConfig');
    const {reseedSharedRandom}=load('core/SharedRNG');
    const event={minLevel:3,maxLevel:3,intelligence:['normal'],characterWeights:[{characterId:a,weight:1}]};
    try {
        setSoloAiEvent(event);assert.ok(buildRandomizedAiRoster(8).every(r=>r.profile.characterId===a&&r.profile.level===3));
        event.characterWeights=[{characterId:a,weight:9},{characterId:b,weight:1},{characterId:roster[2],weight:0}];
        reseedSharedRandom(888);const first=buildRandomizedAiRoster(1000);reseedSharedRandom(888);
        assert.deepEqual(buildRandomizedAiRoster(1000),first);
        const count=first.filter(r=>r.profile.characterId===a).length;assert.ok(count>850&&count<950);
        assert.ok(first.every(r=>[a,b].includes(r.profile.characterId)));
        for(const weights of [[],[{characterId:a,weight:0}],[{characterId:a,weight:-1}],[{characterId:a,weight:Infinity}],[{characterId:'不存在',weight:1}]]) {
            event.characterWeights=weights;assert.throws(()=>buildRandomizedAiRoster(count+1));
        }
    } finally {setSoloAiEvent(null);}
});


test('现有配置按实际人数完整分配，配置与生成数量不一致拒绝', () => {
    const {eventFor}=load('progression/CareerRules');
    const {CAREER_AI_EVENTS}=load('progression/CareerAiConfig');
    const {setSoloAiEvent,buildRandomizedAiRoster}=load('competitor/CompetitorConfig');
    try {
        for(let tier=0;tier<6;tier++) for(const event of [eventFor(tier),...CAREER_AI_EVENTS[tier].cup]) {
            const count=event.intelligence.length;setSoloAiEvent(event);
            assert.deepEqual(buildRandomizedAiRoster(count).map(r=>r.profile.intelligence).sort(),[...event.intelligence].sort());
            assert.throws(()=>buildRandomizedAiRoster(count+1));
        }
        const invalid={...eventFor(0),intelligence:['normal']};setSoloAiEvent(invalid);
        assert.throws(()=>buildRandomizedAiRoster(7));
    } finally {setSoloAiEvent(null);}
});


test('实际泳道生成保留全部7个生涯难度名额，不受玩家泳道位置影响', () => {
    const managerHarness=createHarness({'../entity/AISwimmerController':{AISwimmerController:class {}}, './SwimmerFactory':{SwimmerFactory:class {}}, './CompetitorConfig':load('competitor/CompetitorConfig')});
    managerHarness.cc.sys=h.cc.sys;
    const {CompetitorManager}=managerHarness.load(path.join(h.root,'assets/scripts/competitor/CompetitorManager.ts'));
    const {setSoloAiEvent}=load('competitor/CompetitorConfig');
    const event={...load('progression/CareerRules').eventFor(0), opponentCount:7, intelligence:['rookie','rookie','normal','normal','normal','skilled','expert']};
    try {
        setSoloAiEvent(event);
        for(const playerLaneIndex of [0,3,7]) {
            const manager=Object.create(CompetitorManager.prototype), seen=[];
            manager._options={laneLayout:{laneCount:8,centerZ:i=>i},courseLayout:{startX:0,swimY:0},playerLaneIndex,primaryAiLaneIndex:1};
            manager._factory={create:()=>({node:{addComponent:()=>({})},configureCourse(){}})};
            manager.applyProfile=(controller,swimmer,profile)=>seen.push(profile.intelligence);
            const result=manager.populateAiLanes({});assert.equal(result.aiSwimmers.length,7);
            assert.deepEqual(seen.sort(),[...event.intelligence].sort());
        }
    } finally {setSoloAiEvent(null);}
});


test('难度列表决定实际1、3、7名AI，空泳道不生成对手，1v1正确结算', () => {
    const {CAREER_AI_EVENTS}=load('progression/CareerAiConfig');
    const {eventFor}=load('progression/CareerRules');
    const config=CAREER_AI_EVENTS[0],old=config.league;
    const competitor=load('competitor/CompetitorConfig');
    const managerHarness=createHarness({'../entity/AISwimmerController':{AISwimmerController:class {}}, './SwimmerFactory':{SwimmerFactory:class {}}, './CompetitorConfig':competitor});
    managerHarness.cc.sys=h.cc.sys;
    const {CompetitorManager}=managerHarness.load(path.join(h.root,'assets/scripts/competitor/CompetitorManager.ts'));
    try {
        for(const count of [1,3,7]) {
            config.league={...old,opponentCount:count,intelligence:Array(count).fill('normal')};
            const p=createDefaultProfile(),ticket=begin(p);competitor.setSoloAiEvent(ticket.ai);
            const firstLane=Math.floor((8-count-1)/2);
            for(const playerLaneIndex of [firstLane,firstLane+count]) {
                const manager=Object.create(CompetitorManager.prototype),seen=[];
                manager._options={laneLayout:{laneCount:8,centerZ:i=>i},courseLayout:{startX:0,swimY:0},playerLaneIndex,primaryAiLaneIndex:6};
                manager._factory={create:(group,args)=>{seen.push(args.z);return {node:{active:true,addComponent:()=>({})},configureCourse(){}};}};
                manager.applyProfile=()=>{};
                const result=manager.populateAiLanes({});assert.equal(result.aiSwimmers.length,count);
                assert.ok(result.primaryAiController);assert.ok(!seen.includes(playerLaneIndex));assert.equal(new Set(seen).size,count);assert.ok(seen.every(lane=>lane>=firstLane&&lane<=firstLane+count));
            }
            assert.equal(finish(p,ticket,1,{racerCount:count+1}).ok,true);
        }
        for(const count of [0,8]) {config.league={...old,opponentCount:count,intelligence:Array(count).fill('normal')};assert.throws(()=>eventFor(0));}
    } finally {config.league=old;competitor.setSoloAiEvent(null);}
});


test('居中泳道分配：双人占第4、5道；空泳道不映射到AI', () => {
    const {centeredLaneStart,aiIndexInLaneRange}=load('competitor/RaceLaneAllocation');
    assert.equal(centeredLaneStart(8,2),3);
    for(let racers=2;racers<=8;racers++) {
        const start=centeredLaneStart(8,racers);
        for(let player=start;player<start+racers;player++) {
            const indices=[];
            for(let lane=0;lane<8;lane++) {
                const index=aiIndexInLaneRange(lane,player,start,racers);
                if(lane===player||lane<start||lane>=start+racers)assert.equal(index,-1);
                else indices.push(index);
            }
            assert.deepEqual(indices,Array.from({length:racers-1},(_,i)=>i));
        }
    }
});

test('道具停留在配置阶段，旧签约和染色命令不产生交易', () => {
    const p=createDefaultProfile(),before=JSON.stringify(p);
    for(const method of ['free','coins','ad','card','universal']) {
        assert.equal(executeCareer(p,{type:'sign',characterId:a,method}).ok,false);
    }
    assert.equal(executeCareer(p,{type:'unlock-dye',colorId:'cup-gold'}).ok,false);
    assert.equal(JSON.stringify(p),before);
    const {ITEMS}=load('progression/ItemConfig');assert.ok(ITEMS.some(i=>i.id==='dye'));
    assert.ok(ITEMS.some(i=>i.id==='sign_universal'));
    const {PLAYER_COLOR_SCHEMES}=load('app/PlayerCharacterConfig');
    assert.ok(!PLAYER_COLOR_SCHEMES.some(c=>c.id==='cup-gold'));
});

test('杯赛仅冠军少量金币，不掉道具、不占用道具首奖，重复结算不重复发币', () => {
    const p=createDefaultProfile();p.career.points=100;
    const preliminary=finish(p,begin(p,'cup'));assert.equal(preliminary.receipt.coinsGained,0);
    const ticket=begin(p,'cup');ticket.cupRewards={championCoins:999,firstChampion:[{itemId:'sign_universal',count:5}],drops:[{itemId:'dye',count:50,weight:1}]};
    const result=finish(p,ticket);assert.equal(result.receipt.coinsGained,60);
    assert.equal(result.receipt.items,undefined);assert.equal(p.inventory,undefined);
    assert.deepEqual(p.career.firstPrizes,[]);
    const coins=p.coins;finish(p,ticket);assert.equal(p.coins,coins);
});
