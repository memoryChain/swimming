// 对实际 build() 做节点生命周期检查；不替代 Creator 的渲染管线验证。
const assert = require('node:assert/strict');
module.exports = function auditRuntime(cc, current, poolScene, expectedFlashPositions) {
    class Node {
        constructor(name) { this.name=name; this.children=[]; this.components=[]; this.position=new cc.Vec3(); this.active=true; this.isValid=true; this.writes=0; }
        setParent(parent) { this.parent=parent; parent.children.push(this); }
        get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
        getChildByName(name) { return this.children.find(n=>n.name===name); }
        addComponent(Type) { const component=new Type(); component.node=this; this.components.push(component); return component; }
        setPosition(x,y,z) { this.position.set(x,y,z); this.writes++; }
        destroy() { for (const n of [...this.children]) n.destroy(); this.isValid=false; if(this.parent) this.parent.children.splice(this.parent.children.indexOf(this),1); }
    }
    class MeshRenderer { setMaterial(material) { this.material=material; } }
    class Material { initialize(options) { this.options=options; } setProperty() {} }
    Object.assign(cc,{Node,MeshRenderer,Material,Layers:{Enum:{DEFAULT:1}},gfx:{CullMode:{NONE:0}},utils:{createMesh:g=>g}});
    const root=new Node('root');
    const nodesOf=n=>[n,...n.children.flatMap(nodesOf)];
    let previous, expectedCount;
    for (let rebuild=0;rebuild<3;rebuild++) {
        const emitter=new current.SpectatorCrowdBuilder().build(root,poolScene);
        assert(emitter,'闪光组件应创建成功');
        assert.deepEqual(emitter.positions,expectedFlashPositions,'闪光候选与顺序保持');
        if(previous) assert.equal(previous.isValid,false);
        const crowd=root.getChildByName('SpectatorCrowd'); previous=crowd;
        const nodes=nodesOf(crowd), renderers=nodes.flatMap(n=>n.components.filter(c=>c instanceof MeshRenderer));
        assert(nodes.every(n=>n.layer===current.SPECTATOR_LAYER),'延迟创建的所有观众节点必须在专用层');
        const animations=nodes.flatMap(n=>n.components.filter(c=>c instanceof current.SpectatorGroupWobble));
        assert.equal(renderers.length,18); assert.equal(animations.length,2);
        assert.equal(new Set(renderers.map(r=>r.material)).size,1);
        assert.equal(renderers.reduce((n,r)=>n+r.mesh.indices.length/3,0),15280);
        assert.equal(nodes.filter(n=>n.name.startsWith('SpectatorRegion')).length,18);
        if(expectedCount===undefined) expectedCount=nodes.length;
        assert.equal(nodes.length,expectedCount,'重建后节点数不增长');
        for(const animation of animations) {
            animation.start(); for(let i=0;i<120;i++) animation.update(1/60);
            assert(animation.node.writes>0 && animation.node.writes<=48);
        }
        const writes=animations.map(a=>a.node.writes);
        crowd.active=false; for(const a of animations) a.update(1);
        assert.deepEqual(animations.map(a=>a.node.writes),writes,'关闭观众后不更新动画');
        crowd.active=true; for(const a of animations) a.update(0);
        assert.deepEqual(animations.map(a=>a.node.writes),writes,'暂停后不更新动画');
    }
    return {renderers:18,materials:1,animationComponents:2,rebuilds:3,nodes:expectedCount};
};
