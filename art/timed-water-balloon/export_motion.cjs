// 直接采样运行时 presentBody，离线动画不维护第二份运动公式。
const fs=require('node:fs'),path=require('node:path');
const {createHarness}=require('../../tests/helpers/cocos-math-harness.cjs');
const h=createHarness({'../character/CharacterModelLoader':{},'./EntertainmentWaterSplash':{}});
const {MineRelayBrawlPresentation}=h.load(path.join(h.root,'assets/scripts/core/MineRelayBrawlPresentation.ts'));
const p=Object.create(MineRelayBrawlPresentation.prototype);
Object.assign(p,{arm:{fuseSeconds:10},body:new h.Node(),root:{active:true},bodyScale:new h.Vec3(1,1,1),bodyEuler:new h.Vec3()});
const frames=[];
for(let i=0;i<96;i++){
    const remaining=4.8-i*.05;p.remainingSeconds=remaining;p.locked=remaining<=.8;p.presentBody();
    frames.push({remaining,locked:p.locked,scale:[p.body.scale.x,p.body.scale.y,p.body.scale.z],
        quaternion:[p.body.rotation.w,p.body.rotation.x,-p.body.rotation.z,p.body.rotation.y]});
}
fs.writeFileSync(path.join(__dirname,'animation-samples.json'),JSON.stringify({fps:20,fuseSeconds:10,frames},null,2)+'\n');
console.log('已从真实表现方法采样最后 4.8 秒，共 96 帧。');
