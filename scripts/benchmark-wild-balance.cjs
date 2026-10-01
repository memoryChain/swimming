// 狂野多人回放：真实AI观察/输入、潜航免碰撞、体重击退、姿态恢复、侧滚与折返。
// 从水面起步，不包含Creator出发飞行、模型骨骼或真人操作；胜率仅描述此测试阵容。
const fs = require('node:fs');
const path = require('node:path');
const { createAiHarness } = require('../tests/helpers/ai-race-harness.cjs');
const h = createAiHarness();
const { PLAYER_CHARACTER_DEFINITIONS: characters } = h.load('app/PlayerCharacterConfig');
const { AI_INTELLIGENCE: tiers } = h.load('competitor/AiRaceConfig');
const { AIRaceObserver } = h.load('competitor/AIRaceObserver');
const { resolveSwimmerCollisions, SWIMMER_COLLISION } = h.load('entity/SwimmerCollisionResolver');
const { setRaceDifficulty, getRaceDistance, FINISH_STRAGGLER_COUNTDOWN_SECONDS } = h.load('core/GameBalance');
const { reseedSharedRandom, SeededRandom } = h.load('core/SharedRNG');
const args = process.argv.slice(2);
const option = (name, fallback) => {const i=args.indexOf('--'+name);return i<0?fallback:args[i+1];};
const profilePath = option('profile',null);
if (profilePath) {
    const profile=JSON.parse(fs.readFileSync(profilePath,'utf8'));
    for(const c of characters)Object.assign(c,profile.characters?.[c.id]);
    Object.assign(h.load('core/CharacterAbilityConfig').CHARACTER_ABILITY_TUNING,profile.abilities);
    for(const id in profile.tiers)Object.assign(tiers[id],profile.tiers[id]);
    const strategies=h.load('competitor/AiRaceConfig').AI_CHARACTER_STRATEGIES;
    for(const id in profile.strategies)Object.assign(strategies[id],profile.strategies[id]);
}

function runRace(ids, {mode='competitive',level=1,tier='skilled',seed=42,fps=30,spacing=2.625,collisions=true,disableTraits=[]}={}) {
    setRaceDifficulty(mode);reseedSharedRandom(seed);
    SWIMMER_COLLISION.enabled=false;resolveSwimmerCollisions([]);SWIMMER_COLLISION.enabled=collisions;
    const distance=getRaceDistance();
    const racers=ids.map((id,lane)=>h.create(id,level,tiers[tier].value,0,(lane-(ids.length-1)/2)*spacing));
    // 消融只用于离线量化固有优势，保留相同输入规则和原属性，不写运行时配置。
    for(const r of racers) {
        if(disableTraits.includes('diver')&&r.body.motor.ability.id==='kickDive')
            Object.defineProperty(r.body.motor.ability,'ignoresSwimmers',{get:()=>false});
        if(disableTraits.includes('cat')&&r.body.motor.ability.id==='catBalance')
            Object.defineProperty(r.body.motor.ability,'recoveryScale',{get:()=>1});
        if(disableTraits.includes('weight')&&r.ai.characterId==='muscleMan')r.body.motor.setWeight(1);
    }
    const bodies=racers.map(r=>r.body),observer=new AIRaceObserver(null,bodies);
    const stats=racers.map((r,lane)=>({character:ids[lane],lane,seconds:null,contacts:0,submergedSeconds:0,
        collisionSeconds:0,heartSeconds:0,budgetSeconds:0,evadeSeconds:0,energy:0,finished:false,rank:0,perfectRate:0}));
    for(let i=0;i<racers.length;i++) {
        const r=racers[i];r.ai.raceObserver=observer;
        const collision=r.body.addCollisionEnergyBonus.bind(r.body);
        r.body.addCollisionEnergyBonus=impulse=>{stats[i].contacts++;return collision(impulse);};
    }
    let firstFinish=null,seconds=0;
    for(;seconds<300&&stats.some(s=>s.seconds===null);seconds+=1/fps) {
        for(let i=0;i<racers.length;i++)if(stats[i].seconds===null) {
            const r=racers[i];r.step(1/fps);
            if(r.body.motor.ability.ignoresSwimmers)stats[i].submergedSeconds+=1/fps;
            if(r.body.motor.needsCollisionRecovery)stats[i].collisionSeconds+=1/fps;
            if(r.ai.planner.reason==='heart')stats[i].heartSeconds+=1/fps;
            if(r.ai.planner.reason==='budget')stats[i].budgetSeconds+=1/fps;
            if(r.ai.planner.reason==='contact')stats[i].evadeSeconds+=1/fps;
        }
        resolveSwimmerCollisions(bodies);
        for(let i=0;i<racers.length;i++)if(stats[i].seconds===null&&bodies[i].distance>=distance) {
            stats[i].seconds=seconds+1/fps;stats[i].finished=true;
            firstFinish ??= seconds+1/fps;
            // 正式完赛退出竞赛碰撞/观察，不能让已完赛模型继续堵终点。
            racers[i].ai.stopSwimming();bodies[i].stopRace();
        }
        if(firstFinish!==null&&seconds+1/fps>=firstFinish+FINISH_STRAGGLER_COUNTDOWN_SECONDS)break;
    }
    const ordered=stats.map((s,i)=>({s,distance:bodies[i].distance})).sort((a,b)=>
        (a.s.seconds??Infinity)-(b.s.seconds??Infinity)||b.distance-a.distance||a.s.lane-b.s.lane);
    ordered.forEach((r,i)=>r.s.rank=i+1);
    for(let i=0;i<stats.length;i++) {
        const s=stats[i],r=racers[i],rhythm=r.body.rhythmStats;
        s.distance=r.body.distance;s.energy=r.condition.energy;
        s.perfectRate=rhythm.perfectCount/Math.max(1,rhythm.perfectCount+rhythm.goodCount+rhythm.missCount);
        s.jumps=r.ai.debugSnapshot().jumps;
        s.seconds=s.seconds??seconds+1/fps;
    }
    SWIMMER_COLLISION.enabled=false;resolveSwimmerCollisions([]);SWIMMER_COLLISION.enabled=true;
    return stats;
}

if(require.main===module) {
    const results=[];
    const modes=option('modes','competitive,championship').split(',');
    const levels=option('levels','1,30').split(',').map(Number);
    const intelligence=option('tiers','normal,skilled,expert').split(',');
    const seeds=option('seeds','42,2468,20261001').split(',').map(Number);
    const fps=Number(option('fps','30'));
    const spacing=Number(option('spacing','2.625'));
    const collisionModes=option('collisions','on,off').split(',');
    const disableTraits=option('disable-traits','').split(',').filter(Boolean);
    const rotations=Number(option('rotations','12'));
    for(const mode of modes)for(const level of levels)for(const tier of intelligence)for(const seed of seeds) {
        // 独立阵容流避免测试抽签改变运行时SharedRNG消费顺序。每轮八人、12轮各角色出现八次。
        const roster=characters.map(c=>c.id);new SeededRandom(seed).shuffle(roster);
        for(let rotation=0;rotation<rotations;rotation++) {
            const ids=Array.from({length:8},(_,i)=>roster[(rotation+i)%roster.length]);
            for(const collisionMode of collisionModes) {
                const rows=runRace(ids,{mode,level,tier,seed:seed+rotation*101,fps,spacing,collisions:collisionMode==='on',disableTraits});
                results.push(...rows.map(r=>({...r,mode,level,tier,seed,rotation,fps,spacing,collisions:collisionMode==='on',disableTraits})));
            }
        }
    }
    const output=option('output','.cache/wild-balance.json');
    fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({
        note:'八人水面起步、真实碰撞/潜航/姿态/折返/10秒末位淘汰；不含Creator出发飞行、骨骼或真人操作。',results},null,2));
    console.log(JSON.stringify({output,races:results.length/8,entries:results.length,
        contacts:results.reduce((sum,r)=>sum+r.contacts,0),dnf:results.filter(r=>!r.finished).length}));
    for(const c of characters){const rows=results.filter(r=>r.character===c.id&&r.collisions);
        console.log(c.name,JSON.stringify({races:rows.length,rank:rows.reduce((s,r)=>s+r.rank,0)/rows.length,
            winRate:rows.filter(r=>r.rank===1).length/rows.length,dnf:rows.filter(r=>!r.finished).length,
            contacts:rows.reduce((s,r)=>s+r.contacts,0)/rows.length,
            submergedSeconds:rows.reduce((s,r)=>s+r.submergedSeconds,0)/rows.length}));}
}
module.exports={runRace};
