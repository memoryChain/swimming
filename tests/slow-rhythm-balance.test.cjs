const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiHarness } = require('./helpers/ai-race-harness.cjs');
const h = createAiHarness();
const { PLAYER_CHARACTER_DEFINITIONS: characters } = h.load('app/PlayerCharacterConfig');
const { AI_INTELLIGENCE: tiers } = h.load('competitor/AiRaceConfig');
const { setRaceDifficulty, getRaceDistance } = h.load('core/GameBalance');
const { reseedSharedRandom } = h.load('core/SharedRNG');
const { NET_RACE_PROTOCOL_VERSION, isCompatibleProtocolVersion } = h.load('net/NetRaceProtocol');
const { measureCharacter } = require('../scripts/benchmark-character-balance.cjs');
const { runRace } = require('../scripts/benchmark-wild-balance.cjs');
const mean = rows => rows.reduce((sum,r)=>sum+r.seconds,0)/rows.length;

test('0.8节奏四档正式AI在标准与狂野赛程保持整体梯度', () => {
    for (const mode of ['beginner','competitive','championship']) for (const fps of [30,60]) {
        const rows = [];
        for (const character of characters) for (const tier of ['rookie','normal','skilled','expert']) for (const seed of [42,20261001]) {
            setRaceDifficulty(mode); reseedSharedRandom(seed);
            const racer = h.create(character.id,1,tiers[tier].value), distance = getRaceDistance();
            let seconds = 0;
            for (; seconds < 300 && racer.body.distance < distance; seconds += 1/fps) racer.step(1/fps);
            assert.ok(racer.body.distance >= distance, `${mode}/${character.id}/${tier}未完赛`);
            assert.ok(Number.isFinite(racer.condition.energy) && racer.condition.energy >= 0);
            if (!racer.body.motor.ability.allowsDolphin) assert.equal(racer.ai.debugSnapshot().jumps,0);
            rows.push({character:character.id,tier,seconds});
        }
        let previous = Infinity;
        for (const tier of ['rookie','normal','skilled','expert']) {
            const seconds = mean(rows.filter(r=>r.tier===tier));
            assert.ok(seconds < previous - .3, `${mode}/${fps}/${tier}整体难度倒挂`); previous = seconds;
        }
        // 角色主要按多人狂野优势平衡，不能强求单人直游用时接近。
    }
});

test('真实玩家输入保留技能取舍：宽窗口、精准奖励、强腿和禁跳巡航', () => {
    const rows = characters.map(c=>measureCharacter(c,1,60));
    const row = id=>rows.find(r=>r.character===id);
    for (const r of rows) { assert.equal(r.rejected,0); assert.equal(r.perfectRate,1); }
    const base = row('cartonSwimmer16'), leg = row('cartonSwimmer5');
    assert.ok(leg.kickSpeed>base.kickSpeed*1.06&&leg.kickSpeed<base.kickSpeed*1.15);
    assert.ok(leg.speed<base.speed,'强腿仍让出手臂巡航能力');
    assert.ok(row('cartonSwimmer10').speed>row('cartonSwimmer6').speed+.10);
    assert.ok(row('cartonSwimmer13').speed>base.speed,'禁跳潜水哥获得巡航补偿');
    const mixed = id=>measureCharacter(characters.find(c=>c.id===id),1,60,true);
    assert.ok(mixed('cartonSwimmer6').perfectRate>mixed('cartonSwimmer10').perfectRate+.15);
});

test('重平衡版本拒绝旧端，玩家和AI仍由同一角色等级数据解析', () => {
    assert.ok(NET_RACE_PROTOCOL_VERSION>51); assert.equal(isCompatibleProtocolVersion(51),false);
    for (const c of characters) for (const level of [1,15,30]) {
        const rookie=h.create(c.id,level,tiers.rookie.value),expert=h.create(c.id,level,tiers.expert.value);
        assert.deepEqual(rookie.profile,expert.profile);
        assert.equal(expert.condition.energyTotal,c.stamina+level-1);
    }
});


test('主要按八人狂野碰撞表现平衡，轮换阵容和泳道后没有压倒性角色', () => {
    const rows=[];
    for(const mode of ['competitive','championship'])for(const seed of [42,2468,20261001])for(let rotation=0;rotation<12;rotation++) {
        const ids=Array.from({length:8},(_,i)=>characters[(i+rotation)%characters.length].id);
        rows.push(...runRace(ids,{mode,seed:seed+rotation*101,level:15,tier:'skilled'}));
    }
    assert.ok(rows.reduce((sum,r)=>sum+r.contacts,0)>500,'必须实际发生碰撞，不能退化成独立泳道测试');
    for(const c of characters) {
        const samples=rows.filter(r=>r.character===c.id);
        assert.equal(samples.length,48);
        assert.ok(samples.filter(r=>r.rank===1).length/samples.length<.4,`${c.name}测试胜率压倒性领先`);
        assert.ok(samples.reduce((sum,r)=>sum+r.rank,0)/samples.length<7,`${c.name}在狂野模式明显不可用`);
    }
    assert.ok(rows.some(r=>r.character==='cartonSwimmer13'&&r.submergedSeconds>1));
});

test('潜航AI只为实际接触风险停手，不为并排或不接近的邻道浪费划水', () => {
    const {AIRaceObserver}=h.load('competitor/AIRaceObserver');
    setRaceDifficulty('competitive');
    const diver=h.create('cartonSwimmer13',15,.75),other=h.create('cartonSwimmer16',15,.75);
    diver.ai.raceObserver=new AIRaceObserver(null,[diver.body,other.body]);
    const p=diver.body.node.position;
    other.body.node.setPosition(p.x+3,p.y,p.z+1.5);diver.ai.observe();
    assert.equal(diver.ai._observation.nearbyThreat,false,'同向且不在接触距离内');
    other.body.node.setPosition(p.x+1.5,p.y,p.z);diver.ai.observe();
    assert.equal(diver.ai._observation.nearbyThreat,true,'贴身前人有接触风险');
    other.body.node.setPosition(p.x+1.5,p.y,p.z+2.1);diver.ai.observe();
    assert.equal(diver.ai._observation.nearbyThreat,false,'侧向距离足够安全');
});


test('变态AI在0.8节奏的低频与33ms固定步长不跳过忍者真实窄窗', () => {
    for (const mode of ['beginner','competitive','championship']) for (const fps of [30, 1/.033, 60]) {
        setRaceDifficulty(mode); reseedSharedRandom(20261001);
        const racer = h.create('cartonSwimmer10',1,tiers.extreme.value);
        for (let time=0; time<300 && racer.body.distance<getRaceDistance(); time+=1/fps) racer.step(1/fps);
        assert.ok(racer.body.distance>=getRaceDistance(), `${mode}/${fps}未完赛`);
        const stats=racer.body.rhythmStats;
        assert.ok(stats.perfectCount>20);
        assert.equal(stats.goodCount+stats.missCount,0,`${mode}/${fps}合法松手仍错过窄窗`);
    }
});
