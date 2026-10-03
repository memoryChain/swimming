// 冻结明确提交的来源规则，只用于评审证据；不切换分支、不修改来源工作树。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {createHarness}=require('../tests/helpers/cocos-math-harness.cjs');
const {runCannonScenario}=require('../tests/helpers/cannon-scenarios.cjs');
const source=path.resolve(process.argv[2]||'');
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),'e5dca0327ed8d5e70bf5f38d39489022491e8e4b');
const h=createHarness(),C=h.load(path.join(source,'assets/scripts/core/CannonBrawlController.ts')).CannonBrawlController;
const state=h.load(path.join(source,'assets/scripts/core/GameConstants.ts')).GameState;
const fixtures=[];
for(const seed of [1,42,20260913])for(const length of [25,50,75])for(const distance of [200,400])for(const fps of [30,60]){
    fixtures.push(runCannonScenario((racers,world,launch,impact)=>{
        const c=new C(4,seed,24,l=>racers[l],launch,impact,undefined,distance-20,world);
        return {step:dt=>c.update(dt,state.RACING,true),ai:(...args)=>c.targetZForAi(...args)};
    },seed,length,distance,fps));
}
fs.writeFileSync(path.resolve(__dirname,'../tests/fixtures/butterfly-cannon.json'),JSON.stringify({sourceCommit:'e5dca0327ed8d5e70bf5f38d39489022491e8e4b',fixtures}));
console.log(`已冻结 ${fixtures.length} 组原分支炮击记录。`);
