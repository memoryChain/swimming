// 真实输入、运动、体力、心率、实体奖励和赛程阶段的离线回放。模型转身接触偏移用固定值。
const fs=require('node:fs'),path=require('node:path');
const {createBody,load}=require('../tests/helpers/butterfly-race-harness.cjs');
const {InputRouter}=load('core/InputRouter');
const {StrokeType,Rating}=load('core/GameConstants');
const {setSoloRaceDistance}=load('core/GameBalance');
const {resolveModifiersFromDigest}=load('progression/RaceModifiers');

function race({butterfly=true,distance=200,fps=120,characterId,level=1,quality='perfect',gap=.02,dolphin=false,pressKicks=false,mixed=false,pulse,kickHz=0,dolphinMinClearance=0,modeId='competitive'}={}){
    if(pulse!==undefined)load('core/ButterflyTuning').BUTTERFLY_TUNING.pulseEnabled=pulse?1:0;
    setSoloRaceDistance(distance);
    load('core/GameBalance').setRaceMode(modeId);
    const profile=resolveModifiersFromDigest(characterId?{characterId,level}:null);
    const f=createBody(profile.abilityId??'none',profile.balance),b=f.body,m=b.motor;
    const phases=b._phases,dt=1/fps;
    let time=0,pressed=false,nextPress=0,side=StrokeType.LEFT,index=0,currentQuality=quality;
    let depletedAt=null,firstDolphin=null,jumps=0,turns=0,oldTurn=false,peakHeart=80,firstCharge=null;
    let mode=butterfly,previousMode=mode;
    let nextKick=0,extraKicks=0,butterflyStarts=0,fallbackArms=0;
    const trace=[];
    const phaseEvents=[];
    const router=new InputRouter({}, {
        butterfly:{admission:()=>b.butterflyAdmission,interruptionVersion:()=>b.butterflyInterruptionVersion,
            begin:()=>{const ok=b.beginButterfly();if(ok)butterflyStarts++;return ok;},
            release:()=>b.releaseButterfly(),cancel:()=>b.cancelButterfly()},
        onStrokeHeld:(s,held,pre)=>{if(held&&!b.canUseArmStroke)return false;f.settle(m.setStrokeHeld(s,held,pre));return true;},
        onStroke:s=>{if(m.recordStroke(s)&&mode)fallbackArms++;},
        onKickStroke:s=>{if(pressKicks)m.recordKickTap(s,false);},
        onKickConfirmed:()=>{if(pressKicks)m.confirmKickAbility();},
    });
    const oldNow=Date.now;Date.now=()=>1000+time*1000;
    try{
        while(time<900&&m.isRacing){
            if(mixed)mode=Math.floor(m.distance/25)%2===0?butterfly:!butterfly;
            if(mode!==previousMode&&!pressed&&!m.isArmStrokeActive){side=StrokeType.LEFT;previousMode=mode;}
            else if(mode!==previousMode)mode=previousMode;
            f.flush();f.updateCondition();
            if(firstCharge===null&&b._ultimate.canAffordDolphin)firstCharge=time;
            // 已松手即可按真实按钮规则用大招，不必等自由泳交错的两臂同时回收。
            const wallDistance=b.courseLayout.nextInternalTurnDistance(m.distance,distance)??distance;
            if(dolphin&&wallDistance-m.distance>=dolphinMinClearance&&!pressed&&!m.isActiveStrokeHeld(StrokeType.LEFT)
                &&!m.isActiveStrokeHeld(StrokeType.RIGHT)&&b.tryDolphinJump()){
                jumps++;if(firstDolphin===null)firstDolphin=time;
                phaseEvents.push({event:'dolphin',time,distance:m.distance,speed:m.currentSpeed});
                router.resetStrokeInput();nextPress=time+gap;f.updateCondition();
            }
            const scripted=phases.isFlipTurnActive||phases.isDolphinJumpActive||phases.isUnderwater;
            if(kickHz>0&&time>=nextKick){
                if(!scripted&&!pressed&&!m.isActiveStrokeHeld(StrokeType.LEFT)&&!m.isActiveStrokeHeld(StrokeType.RIGHT))
                    if(m.recordKickTap(StrokeType.LEFT))extraKicks++;
                nextKick=time+1/kickHz;
            }
            if(scripted){if(pressed){router.resetStrokeInput();pressed=false;}nextPress=time+gap;}
            if(!scripted&&!pressed&&time>=nextPress&&(!mode?m.canRecordStroke(side):!m.isArmStrokeActive)){
                currentQuality=quality==='mixed'?(['perfect','perfect','perfect','good','perfect','perfect','bad','perfect','perfect','perfect'][index%10]):quality;
                if(mode)side=StrokeType.LEFT;
                router.handleScreenStroke(side);if(mode)router.handleScreenStroke(StrokeType.RIGHT);
                pressed=true;index++;
            }
            router.tick();
            if(pressed&&m.isActiveStrokeHeld(side)){
                const guide=m.strokeTimingGuideForSide(side),zone=guide.intervals.find(i=>i.rating===Rating.PERFECT);
                const target=currentQuality==='perfect'?(zone.startRatio+zone.endRatio)/2
                    :currentQuality==='good'?Math.max(.17,zone.startRatio-.025):.05;
                if(guide.currentRatio>=target){
                    router.handleScreenStrokeEnd(side);if(mode)router.handleScreenStrokeEnd(StrokeType.RIGHT);
                    else side=side===StrokeType.LEFT?StrokeType.RIGHT:StrokeType.LEFT;
                    pressed=false;nextPress=time+gap;
                }
            }
            f.flush();f.updateCondition();
            b.stepSimulation(dt);
            if(!phases.isFlipTurnActive&&!phases.isDolphinJumpActive)
                b.node.setPosition(b.courseLayout.distanceToWorldX(m.distance),phases.visualSwimY(),m.lateralOffset);
            m.setCourseDirection(b.courseLayout.directionAtDistance(m.distance));
            if(phases.isFlipTurnActive&&!oldTurn){turns++;phaseEvents.push({event:'turn',time,distance:m.distance,speed:m.currentSpeed});}
            oldTurn=phases.isFlipTurnActive;
            f.flush();f.updateCondition();
            if(f.condition.energyDepleted&&depletedAt===null)depletedAt=m.distance;
            peakHeart=Math.max(peakHeart,m.heartRate);
            if(Math.floor(time)!==Math.floor(time+dt))trace.push([+time.toFixed(2),+m.distance.toFixed(3),+f.condition.energy.toFixed(2),+m.heartRate.toFixed(2)]);
            time+=dt;
        }
    }finally{Date.now=oldNow;}
    if(m.distance<distance-1e-5)throw new Error('回放未完赛');
    return {stroke:mixed?'混合':butterfly?'蝶泳':'自由泳',characterId:characterId??'neutral',level,distance,fps,modeId,quality,gap,dolphin,pressKicks,kickHz,extraKicks,pulse,dolphinMinClearance,butterflyStarts,fallbackArms,
        seconds:time,meanSpeed:distance/time,energyRemaining:f.condition.energy,nominalStrokeCost:b.settledStrokeEnergy,
        skillCost:f.skillCost,depletedAt,firstCharge,firstDolphin,jumps,turns,peakHeart,
        perfect:b._perfectStrokeQualityCount,good:b._goodStrokeQualityCount,bad:b._missStrokeQualityCount,phaseEvents,trace};
}
if(require.main===module){
    const results=[];
    const characters=process.argv.includes('--characters'),sweep=process.argv.includes('--sweep');
    const formal=process.argv.includes('--formal');
    const scenarios=[];
    if(formal){
        // 标准与狂野的无碰撞赛程基线；娱乐事件另由组合规则回放验证。
        for(const c of load('app/PlayerCharacterConfig').PLAYER_CHARACTER_DEFINITIONS)
            for(const level of [1,30])for(const distance of [200,400])
                for(const modeId of ['beginner','competitive'])for(const strategy of ['free','butterfly','mixed'])
                    scenarios.push({characterId:c.id,level,distance,modeId,fps:60,dolphin:true,pressKicks:true,
                        dolphinMinClearance:12,butterfly:strategy!=='free',mixed:strategy==='mixed'});
        for(const fps of [15,30,60])for(const distance of [200,400])for(const mixed of [false,true])
            scenarios.push({modeId:'entertainment-brawl',fps,distance,mixed,dolphin:true,pressKicks:true,dolphinMinClearance:12});
        for(const c of load('app/PlayerCharacterConfig').PLAYER_CHARACTER_DEFINITIONS
            .filter(c=>['powerKick','perfectChain','kickDive','frogHop'].includes(c.abilityId)))for(const distance of [200,400])
            for(const mixed of [false,true])scenarios.push({characterId:c.id,distance,mixed,quality:'mixed',fps:60,
                dolphin:true,pressKicks:true,kickHz:4.8,dolphinMinClearance:12});
    }else if(characters){
        for(const c of load('app/PlayerCharacterConfig').PLAYER_CHARACTER_DEFINITIONS)for(const butterfly of [false,true])
            scenarios.push({characterId:c.id,distance:200,fps:60,dolphin:true,pressKicks:true,butterfly});
        for(const fps of [15,30,60])for(const mixed of [false,true])
            scenarios.push({distance:200,fps,butterfly:true,dolphin:true,pressKicks:true,mixed});
    }else if(sweep){
        for(const gap of [.02,.2,.4])for(const quality of ['perfect','good','mixed'])for(const butterfly of [false,true])
            scenarios.push({distance:200,fps:60,gap,quality,butterfly});
    }else{
        for(const distance of [200,400])for(const dolphin of [false,true])for(const quality of ['perfect','mixed'])for(const butterfly of [false,true])
            scenarios.push({distance,dolphin,quality,butterfly});
    }
    for(const options of scenarios){
        const r=race(options);results.push(r);const {trace,...summary}=r;console.log(JSON.stringify(summary));
    }
    fs.mkdirSync(path.resolve('.cache/butterfly-balance'),{recursive:true});
    const output=process.argv.slice(2).find(arg=>!arg.startsWith('--'))
        ||`.cache/butterfly-balance/${formal?'local-formal':characters?'characters':sweep?'sweep':'race'}.json`;
    fs.writeFileSync(path.resolve(output),JSON.stringify(results,null,2));
}
module.exports={race};
