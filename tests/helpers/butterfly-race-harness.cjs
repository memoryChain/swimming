// 复用真实实体结算和比赛阶段；仅替换渲染及转身模型接触采样。
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { load } = require('../../scripts/analyze-stroke-efficiency.cjs');
const { createHarness } = require('./cocos-math-harness.cjs');
const h = createHarness();
const tsPath = process.env.PATH.split(path.delimiter).map(dir => path.resolve(dir,'../typescript/lib/typescript.js')).find(p=>fs.existsSync(p));
const ts = require(tsPath);
const file = path.join(h.root,'assets/scripts/entity/Swimmer.ts');
const source = ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
const decl = source.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='Swimmer');
const names = ['makeStrokeQualityResult','updatePerfectComboIdle','tryDolphinJump','canUseDolphinAbility',
    'enableButterfly','enableFreestylePresentation','enableFreestyleBodyRollTest','_freestylePresentationEnabled',
    'motor','courseLayout','startPosition','canUseArmStroke','butterflyAdmission','butterflyInterruptionVersion',
    'beginButterfly','releaseButterfly','cancelButterfly','butterflyPhaseReady','butterflyPoseAllowed',
    'canContinueButterfly','interruptButterflyIfNeeded','isButterflyRecoveryLocked','stepSimulation',
    'distance','rhythmStats','beginEntertainmentKnockout','respawnAfterEntertainmentHit','endEntertainmentInvulnerability',
    'resetEntertainmentKnockoutPresentation','syncEntertainmentRecoveryBodyVisibility','clearForcedLaunch','finishGeyserLaunch',
    'geyserHitEligible','applyGeyserHit','geyserBodyScale','sampleGeyserBody','emitGeyserContact',
    'restoreGeyserReaction','updateGeyserReaction','updateGeyserLanding',
    'canRideGiantWave','clearGiantWave','sampleGiantWave',
    'playFinishTouch','finishFloatX'];
const members = decl.members.filter(n=>names.includes(n.name?.getText(source)));
if(members.length!==names.length)throw new Error('实体测试入口缺失');
const js = ts.transpileModule(`class Body {${members.map(n=>n.getText(source)).join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
const Body = vm.runInNewContext(js+';Body',{
    ...load('core/StrokeQualityScoring'), ...load('core/GameConstants'), ...load('core/ConditionBalance'),
    ...load('core/CharacterAbilityConfig'), ...load('core/DolphinJumpConfig'), ...load('core/ButterflyTuning'),
    ...load('core/GameBalance'), PERFECT_COMBO_IDLE_SECONDS:1,
    ...load('core/GeyserBrawlRules'), ...load('swimmer/ForcedLaunchModel'), ...load('swimmer/GeyserReactionModel'),
    ...load('core/GiantWaveRules'), ...load('net/NetGiantWaveCodec'), ...load('core/WhirlpoolBrawlRules'),
    ...load('character/CharacterMotionTuning'),
    Tween:{stopAllByTarget(){}},
});

function createBody(id='none', balance=null) {
    const body = new Body();
    body._motor = new (load('swimmer/SwimmerMotor').SwimmerMotor)();
    body.motor.setCharacterAbility(id);body.motor.setPlayerBalance(balance);body.motor.startRace(0,.8);
    body.motor.setSteeringEnabled(false);body.motor.enableButterflyTest(true);
    body.node=new h.Node();body.node.active=true;
    // 对应 RaceManager 的冲线接触回调，执行真实实体完赛清理。
    body.finishedEvents=0;body.node.emit=event=>{if(event==='swimmer-finished'){
        body.finishedEvents++;body.playFinishTouch();
    }};
    body._courseLayout=load('venue/RaceCourseLayout').DEFAULT_RACE_COURSE_LAYOUT;
    body._startPosition=new h.Vec3();body._forcedLaunch=null;
    body._forcedLaunchAge=body._forcedLaunchGrace=body._forcedLaunchEdge=body._forcedLaunchHitId=0;
    body._forcedLaunchSample={distance:0,lateral:0,y:0,speed:0,done:false};
    body._geyserHits=new (load('core/GeyserBrawlRules').GeyserHitLedger)();
    body._geyserReaction=null;body._geyserReactionAge=0;
    body._geyserPose={pitch:0,roll:0,weight:0,forward:0,side:0};
    body._geyserBodyScratch=load('swimmer/GeyserBodyContact').emptyGeyserBodyPose();
    body._geyserLandingArmed=false;body._geyserLandingPlayed=true;
    body._geyserPreviousFootX=body._geyserPreviousFootY=body._geyserPreviousFootZ=0;
    body.geyserTuning=load('core/GeyserBrawlRules').GEYSER_TUNING;
    body._entertainmentKnocked=body._entertainmentInvulnerable=false;
    body.giantWaveState=null;body.giantWaveTuning=null;body._waveX=NaN;body._waveZ=0;
    body._waveRiding=body._waveOpposed=false;body._netGiantWaveCode=-1;
    body._whirlpoolInfluence={};load('core/WhirlpoolBrawlRules').resetWhirlpoolInfluence(body._whirlpoolInfluence);
    body._strokeQualityCombo=body._maxStrokeQualityCombo=body._perfectComboIdleSeconds=0;
    body._perfectComboIdleLimit=1;
    body._perfectStrokeQualityCount=body._goodStrokeQualityCount=body._missStrokeQualityCount=0;
    body.settledStrokeEnergy=0;body._pendingConditionInputs=[];body._pendingRhythmResults=[];
    body._strokeMetrics={effortScore:0,update(){}};
    const pose=load('character/CharacterMotionTuning').CHARACTER_POSE_TUNING;
    let elapsed=0;
    body.cartoonRig={
        triggerStrokeFeedback(){},setDiveStreamlinePose(){},setLegSplashSuppressed(){},setPerfectGlowActive(){},
        updateUnderwaterBubbles(){},applyCollisionPitchPivotCompensation(){},
        setRecoveryBlinkVisible(){},setGiantWaveLift(){},setDiveReady(){},finishDiveChargeEffect(){},resetPose(){},
        clearTransientBodyFeedback(){},setFinishFloating(){},setGeyserLimbLag(){},setTurtleBusGripHands(){},
        triggerSplashBurst(){},triggerTakeoffSplash(){},triggerBigSplash(){},setActiveSwimming(){},setStrokeHeld(){},finishRaceFlipTurn(){},
        startRaceFlipTurn(){elapsed=0;return .2;},
        updateRaceFlipTurn(dt){
            elapsed+=dt;const approach=pose.flipTurnToKeyframe1Seconds+pose.flipTurnToKeyframe2Seconds;
            return {keyframe2Reached:elapsed>=approach,approachTimeRatio:elapsed/approach,
                returnTimeRatio:Math.min(1,(elapsed-approach)/pose.flipTurnReturnToSwimSeconds),
                complete:elapsed>=approach+pose.flipTurnReturnToSwimSeconds};
        },
    };
    body.updateBodyMotion=()=>{};
    // 仅替代击倒落水和模型复位表现，命中、阶段接管及马达状态执行实际实体方法。
    body.prepareEntertainmentKnockoutLanding=body.resetPose=()=>{};
    // 普通模拟步的空间展示与池边接触独立于本组输入/结算检查。
    body.applyCoursePosition=body.updateMovementSpeed=body.updatePerfectZoneGlow=body.enforcePoolWallBoundary=()=>{};
    body._ultimate=new (load('condition/UltimateEnergyModel').UltimateEnergyModel)();
    body._ultimate.setGainAptitude(balance?.energyGainAptitude??50);
    body._ultimate.setAbilityGainScale(id==='frogHop'?load('core/CharacterAbilityConfig').abilityValue('frogEnergyGain',.1,3):1);
    body._phases=new (load('entity/SwimmerRacePhases').SwimmerRacePhases)(body);
    const condition=new (load('condition/PlayerConditionModel').PlayerConditionModel)();
    condition.setProgressionOverrides(balance?{energyTotal:balance.energyTotal}:null);
    condition.setInfiniteStamina(body.motor.ability.infiniteStamina);condition.reset();
    let skillCost=0;
    body.onDolphinJumpEnergyCost=cost=>{skillCost+=cost;condition.consumeEnergy(cost);};
    const consumeCondition=()=>{
        for(const input of body._pendingConditionInputs.splice(0))condition.updateFromStroke(input);
    };
    const settle=result=>{
        if(!result)return;
        body.makeStrokeQualityResult(result.type,result);
        consumeCondition();
    };
    const flush=()=>{for(const r of body.motor.consumeStrokeQualityResults())settle(r);consumeCondition();};
    const updateCondition=()=>{
        condition.syncHeartRate(body.motor.heartRate);condition.tick(0);
        body.motor.setConditionSpeedScale(condition.efficiencyModifier);
        body.motor.setConditionCadenceScale(condition.strokeCadenceScale);
    };
    return {body,condition,settle,flush,updateCondition,get skillCost(){return skillCost;}};
}
module.exports={createBody,load};
