const test=require('node:test'),assert=require('node:assert/strict');
const {makeRecovery,SWIMMER_MODEL_FILES}=require('./helpers/recovery-body-contact-harness.cjs');

for(const file of SWIMMER_MODEL_FILES)test(`${file}：搭稳后的真实胸腹三角面与浮圈保持间隙`,()=>{
    const r=makeRecovery(file);let worst=Infinity;
    r.controller._recoverySequence.apply(r.wrapper,1.12,0);
    assert.ok(r.clearance(r.pose.recoveryFloat).minimum>=.004,'双臂刚完成搭圈时也必须分离胸腹');
    for(const yaw of [0,180]){
        r.parent.setRotationFromEuler(0,yaw,0);
        for(let sample=0;sample<=46;sample++){
            const elapsed=1.15+sample*.05;
            r.controller._recoverySequence.apply(r.wrapper,elapsed,0);
            const result=r.clearance(r.pose.recoveryFloat);
            worst=Math.min(worst,result.minimum);
            assert.ok(result.minimum>=.004,`${file} ${elapsed.toFixed(2)}秒胸腹间隙 ${(result.minimum*1000).toFixed(1)}mm，不能穿圈`);
        }
    }
    // 空中恢复较晚扶稳；同一动作直接按当前时间采样，不补播。
    r.controller._recoverySequence.apply(r.wrapper,1.3,.62);
    assert.ok(r.clearance(r.pose.recoveryFloat).minimum>=.004);
    assert.ok(Number.isFinite(worst));
});


// 使用真正的浮圈网格，验证不同身材下的缩放与旋转仍有水上、水下部分。
test('所有角色扶稳后，实际浮圈网格在完整起伏周期持续穿过水面',()=>{
    const {readGlbGeometry}=require('./helpers/glb-geometry.cjs');
    const {Vec3,root}=require('./helpers/recovery-body-contact-harness.cjs');
    const positions=readGlbGeometry(require('node:path').join(root,'assets/race/items/RecoveryFloatRing.glb')).geometry.positions;
    const point=new Vec3(),local=new Vec3();
    for(const file of SWIMMER_MODEL_FILES){
        const r=makeRecovery(file);
        for(const yaw of [0,180]){r.parent.setRotationFromEuler(0,yaw,0);
            for(let sample=0;sample<=120;sample++){
                r.controller._recoverySequence.apply(r.wrapper,1.15+sample*.05,0);const ring=r.pose.recoveryFloat;let min=Infinity,max=-Infinity;
                for(let i=0;i<positions.length;i+=3){point.set(positions[i]*ring.radius,positions[i+1]*ring.radius,positions[i+2]*ring.radius);Vec3.transformQuat(local,point,ring.rotation);Vec3.add(local,local,ring.position);const y=local.y-.055;min=Math.min(min,y);max=Math.max(max,y);}
                assert.ok(min<-.001&&max>.001,`${file}第${sample}次采样浮圈离开水面：${min}/${max}`);
            }
        }
    }
});
