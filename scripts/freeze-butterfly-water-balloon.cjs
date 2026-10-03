// 只读固定来源，不切换分支，不改变工作区预期来源。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {createHarness}=require('../tests/helpers/cocos-math-harness.cjs');
const {runWaterBalloonScenario}=require('../tests/helpers/water-balloon-scenarios.cjs');
const source=path.resolve(process.argv[2]||'');
const commit='e5dca0327ed8d5e70bf5f38d39489022491e8e4b';
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),commit);
const h=createHarness(),C=h.load(path.join(source,'assets/scripts/core/MineRelayBrawlController.ts')).MineRelayBrawlController;
const state=h.load(path.join(source,'assets/scripts/core/GameConstants.ts')).GameState, fixtures=[];
for(const seed of [1,42,20260913])for(const length of [25,50,75])for(const distance of [200,400])for(const fps of [30,60]) {
    fixtures.push(runWaterBalloonScenario((racers,world,direction,event)=>{
        const rules=new C(4,seed,24,l=>racers[l],event,event,event,undefined,null,world,direction);
        return {rules,step:dt=>rules.update(dt,state.RACING,true)};
    },seed,length,distance,fps));
}
fs.writeFileSync(path.resolve(__dirname,'../tests/fixtures/butterfly-water-balloon.json'),JSON.stringify({sourceCommit:commit,fixtures}));
console.log(`已冻结 ${fixtures.length} 组原分支水球发放、转交、爆开及AI记录。`);
