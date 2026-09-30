// 相同策略下比较集中发力开关；输出真实评价和阶段数据，不把脚本目标评价当成实测比例。
const fs=require('node:fs');
const {race}=require('./analyze-butterfly-race.cjs');
const {load}=require('./analyze-stroke-efficiency.cjs');
const cases=[];
for(const distance of [200,400])for(const quality of ['perfect','mixed'])for(const dolphin of [false,true])for(const kickHz of [0,4.8])
    cases.push({distance,quality,dolphin,kickHz});
for(const c of load('app/PlayerCharacterConfig').PLAYER_CHARACTER_DEFINITIONS)for(const level of [1,30])
    cases.push({characterId:c.id,level,distance:200,dolphin:true,kickHz:4.8});
for(const fps of [15,30,60])for(const mixed of [false,true])cases.push({fps,mixed,distance:200,dolphin:true,kickHz:4.8});
const rows=[];
for(const options of cases){
    const before=race({...options,pulse:false}),after=race({...options,pulse:true});
    rows.push({before,after});
    console.log(JSON.stringify({options,secondsBefore:before.seconds,secondsAfter:after.seconds,
        difference:100*(after.seconds/before.seconds-1),jumps:[before.jumps,after.jumps],turns:[before.turns,after.turns]}));
}
fs.mkdirSync('.cache/butterfly-pulse',{recursive:true});
fs.writeFileSync('.cache/butterfly-pulse/races.json',JSON.stringify(rows,null,2));
const followups=[
    {characterId:'cartonSwimmer11',level:30,distance:200,dolphin:true,kickHz:4.8,dolphinMinClearance:12},
    {fps:15,mixed:true,distance:200,dolphin:false,kickHz:4.8},
].map(o=>({before:race({...o,pulse:false}),after:race({...o,pulse:true})}));
fs.writeFileSync('.cache/butterfly-pulse/race-followups.json',JSON.stringify(followups,null,2));
