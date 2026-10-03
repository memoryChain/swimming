// 固定时间轨迹由输入生成，预期只从审查提交冻结，迁移实现不能重写预期。
function runWaterBalloonScenario(create,seed,length,raceDistance,fps) {
    const racers=Array.from({length:4},()=>({active:true,recovering:false,finished:false,distance:0,lateral:0,speed:0}));
    const world=d=>{const lap=Math.floor(d/length),x=d%length;return lap%2?length-x:x;},direction=d=>Math.floor(d/length)%2?-1:1;
    const events=[],samples=[],c=create(racers,world,direction,e=>events.push({...e}));
    const frames=fps*Math.ceil((raceDistance+10)/1.5);
    for(let frame=0;frame<frames;frame++) {
        const time=frame/fps;
        for(let lane=0;lane<4;lane++) {
            const r=racers[lane];r.distance=Math.min(raceDistance,time*(1.5+lane*.035));r.speed=1.5+lane*.035;
            r.finished=r.distance>=raceDistance;r.lateral=Math.sin(time*.32+lane*.8)*1.5+lane*.5;
            r.recovering=lane===2&&time>=35&&time<37;r.active=!(lane===3&&time>=68&&time<72);
        }
        c.step(1/fps);
        if(frame%fps===0)samples.push([c.rules.currentCarrierLane(),c.rules.currentRemainingSeconds(),c.rules.isLocked(),c.rules.isPaused(),c.rules.remainingRoundCount(),...racers.map((_,lane)=>c.rules.targetZForAi(lane,.7))]);
    }
    return {seed,length,raceDistance,fps,events,samples};
}
module.exports={runWaterBalloonScenario};
