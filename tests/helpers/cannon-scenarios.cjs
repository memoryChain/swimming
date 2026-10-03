// 固定选手输入轨迹；预期记录由 butterfly 源码产生，不能从新实现重生成。
function runCannonScenario(make, seed, length, raceDistance, fps) {
    const racers = Array.from({length: 4}, (_, lane) => ({active:true,finished:false,damageable:true,distance:0,lateral:(lane-1.5)*2.5,speed:1.8+lane*.55}));
    const world = distance => {const section=Math.floor(distance/length),phase=distance%length;return section%2 ? length-phase : phase;};
    const events=[],targets=[];
    const c=make(racers,world,e=>events.push(['launch',{...e}]),e=>events.push(['impact',{...e}]));
    for(let frame=0;frame<fps*130;frame++){
        const time=frame/fps;
        for(let lane=0;lane<4;lane++){
            const r=racers[lane];r.distance=Math.min(raceDistance,time*r.speed);r.finished=r.distance>=raceDistance;
            r.lateral=(lane-1.5)*2.5+Math.sin(time*.37+lane)*.35;
            r.damageable=!(lane===2&&time>24&&time<28);r.active=!(lane===3&&time>36&&time<42);
        }
        c.step(1/fps);
        if(frame%fps===0)targets.push(racers.map((r,i)=>c.ai(r.distance,r.lateral,.25+i*.2)));
    }
    return {seed,length,raceDistance,fps,events,targets};
}
module.exports={runCannonScenario};
