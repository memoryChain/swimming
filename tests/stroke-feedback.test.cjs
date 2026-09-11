const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');
const audio=[],network=[];
const { load, Vec3, root } = createHarness({
 './StrokeSfxManager': { StrokeSfxManager: { playStroke: perfect=>audio.push(perfect) } },
 '../net/NetInputCapture': { captureNetInput: event=>network.push(event) },
});
const { GameFlowController }=load(root+'/assets/scripts/app/GameFlowController.ts');
const { GameState, Rating, StrokeType }=load(root+'/assets/scripts/core/GameConstants.ts');
const { RaceCameraDirector, RaceCameraMode, RACE_CAMERA_TUNING }=load(root+'/assets/scripts/camera/RaceCameraDirector.ts');

test('开始划水不提前报成功，即时与延迟结算使用同一反馈入口，失误和结束后不播放成功反馈',()=>{
 audio.length=network.length=0;let state=GameState.RACING;const ui=[],camera=[];
 const good={rating:Rating.GOOD,combo:0,strokeSide:StrokeType.LEFT};
 const refs={getState:()=>state,handleModelDebugStroke:()=>false,handleModelDebugStrokeHeld:()=>false,
  playerSwimmer:{distance:10,canUseArmStroke:true,handleStroke:()=>null,handleStrokeHeld:(_,held)=>held?null:good},
  uiFlow:{showRating:(...args)=>ui.push(args)},raceCameraDirector:{notifyStrokeSettled:p=>camera.push(p)}};
 const flow=new GameFlowController(refs);
 flow.handlePlayerStroke(StrokeType.LEFT);assert.equal(audio.length,0);assert.equal(network.length,1);
 flow.handlePlayerStrokeHeld(StrokeType.LEFT,false);assert.deepEqual(audio,[false]);assert.equal(ui.length,1);
 flow.presentStrokeResult({...good,rating:Rating.PERFECT});assert.deepEqual(audio,[false,true]);assert.deepEqual(camera,[false,true]);
 flow.presentStrokeResult({...good,rating:Rating.BAD});assert.equal(audio.length,2);
 flow._cameraFollowAi=true;flow.presentStrokeResult(good);assert.equal(camera.length,2,'观看AI不响应本地划水镜头');
 state=GameState.FINISHED;flow.presentStrokeResult(good);assert.equal(audio.length,3);
 state=GameState.RACING;refs.playerSwimmer.distance=100000;flow.presentStrokeResult(good);assert.equal(audio.length,3);
});

test('划水镜头双向有界，普通弱于完美，连续触发不累加，停止后恢复原机位',()=>{
 for(const direction of [1,-1]){
  const d=new RaceCameraDirector(0,{waterY:0,directionAtDistance:()=>direction});
  d.bindCamera({setPosition(){},lookAt(){},getComponent(){return {};}});
  d.selectMode(RaceCameraMode.Sprint);
  const s={playerX:15,playerY:.2,playerDistance:15,playerArmStrokeActive:true,playerUnderwater:false};
  d.updateSprintCamera(0,s,true);const original=d._cameraPos.x;
  d.notifyStrokeSettled(false);d._strokeFeedbackTime=RACE_CAMERA_TUNING.strokeFeedbackSeconds/2;d.updateSprintCamera(.016,s,true);
  const ordinary=Math.abs(d._cameraPos.x-original);
  for(let i=0;i<50;i++)d.notifyStrokeSettled(true);
  d._strokeFeedbackTime=RACE_CAMERA_TUNING.strokeFeedbackSeconds/2;d.updateSprintCamera(.016,s,true);
  const perfect=(original-d._cameraPos.x)*direction;assert.ok(perfect>ordinary);assert.ok(perfect<=.160001);
  d.update(1,s);d.updateSprintCamera(1,s,true);assert.ok(Math.abs(d._cameraPos.x-original)<1e-6);
  d.notifyStrokeSettled(true);d.update(.01,{...s,playerUnderwater:true});assert.equal(d._strokeFeedbackTime,0);
  d.notifyStrokeSettled(true);d.resetRaceTimers();assert.equal(d._strokeFeedbackTime,0);
 }
});
