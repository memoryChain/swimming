const {test}=require('node:test');
const assert=require('node:assert/strict');
const api=require('../scripts/templates/taptap-texture-probe.js');

function harness({blank=false,fail=false,incomplete=false,unwritten=false}={}) {
    const source=new Uint8Array(4*20);for(let i=3;i<source.length;i+=4)source[i]=255;
    const state={binding:{name:'原FBO'},uploads:0,reads:0,deleted:0,pixels:blank?new Uint8Array(source.length):source};
    const original=state.binding;
    const gl={FRAMEBUFFER:1,FRAMEBUFFER_BINDING:2,COLOR_ATTACHMENT0:3,TEXTURE_2D:4,RGBA:5,UNSIGNED_BYTE:6,FRAMEBUFFER_COMPLETE:7,
        getParameter:()=>state.binding,createFramebuffer:()=>({name:'临时FBO'}),
        bindFramebuffer:(_,value)=>{state.binding=value;},framebufferTexture2D:()=>{},
        checkFramebufferStatus:()=>incomplete?9:7,
        readPixels:(_x,_y,_w,_h,_fmt,_type,target)=>{state.reads++;if(fail)throw Error('读取失败');if(!unwritten)target.set(state.pixels);},
        deleteFramebuffer:()=>{state.deleted++;}};
    const native={glTexture:{},glTarget:4,glFormat:5,glType:6};
    const texture={width:20,height:1,getGFXTexture:()=>({gpuTexture:native}),uploadData:data=>{state.uploads++;state.pixels=data;}};
    class Label {}
    const root={isValid:true,activeInHierarchy:true,children:[],getComponent:()=>null};
    const label=new Label();const node={name:'PageTitle',activeInHierarchy:true,children:[],getComponent:()=>label};
    Object.assign(label,{node,string:'测试',cacheMode:0,ttfSpriteFrame:{texture},
        assemblerData:{canvas:{width:20,height:1},context:{getImageData:()=>({data:source})}}});
    root.children.push(node);
    return {state,original,gl,native,root,label,cc:{Label,director:{root:{device:{gl}}}}};
}
function capture(run) {const original=console.log,rows=[];console.log=line=>rows.push(JSON.parse(line.slice('[TapTexture] '.length)));try{run();}finally{console.log=original;}return rows;}

test('CPU有字而GPU全透明时才补传，并校验补传后像素',()=>{
    const h=harness({blank:true});const inspect=api.create(h.cc,{repairConfirmedBlank:true});
    const rows=capture(()=>inspect(h.root,1));
    assert.equal(rows[0].status,'gpu-empty-with-cpu-ink');assert.equal(rows[0].repair,'alpha-match');
    assert.equal(h.state.uploads,1);assert.equal(h.state.reads,2);assert.equal(h.state.binding,h.original);assert.equal(h.state.deleted,2);
});
test('纹理已有字形时保持原样，同次进入不重复检测，隐藏与第四次进入不工作',()=>{
    const h=harness();const inspect=api.create(h.cc,{repairConfirmedBlank:true});
    capture(()=>{inspect(h.root,1);inspect(h.root,1);h.root.activeInHierarchy=false;inspect(h.root,2);h.root.activeInHierarchy=true;inspect(h.root,4);});
    assert.equal(h.state.uploads,0);assert.equal(h.state.reads,1);
    capture(()=>inspect(h.root,2));assert.equal(h.state.reads,2);
});
test('未开启修复模式只读观察',()=>{
    const h=harness({blank:true});capture(()=>api.create(h.cc)(h.root,1));assert.equal(h.state.uploads,0);
});
test('宿主读回异常、不完整或未写缓冲区不能触发补传，且恢复FBO',()=>{
    for(const options of [{blank:true,fail:true},{blank:true,incomplete:true},{blank:true,unwritten:true}]) {
        const h=harness(options);capture(()=>api.create(h.cc,{repairConfirmedBlank:true})(h.root,1));
        assert.equal(h.state.uploads,0);assert.equal(h.state.binding,h.original);assert.equal(h.state.deleted,1);
    }
});
test('尺寸不符、动态合图或超过预算不读取也不写纹理',()=>{
    for(const change of [h=>h.label.ttfSpriteFrame.texture.width=21,h=>h.label.cacheMode=1,h=>h.label.assemblerData.canvas.width=1000000]) {
        const h=harness({blank:true});change(h);capture(()=>api.create(h.cc,{repairConfirmedBlank:true})(h.root,1));
        assert.equal(h.state.uploads,0);assert.equal(h.state.reads,0);
    }
});
test('极低透明度底色不计入明显字形',()=>{
    const result=api.stats(new Uint8Array([0,0,0,1,255,255,255,255]));
    assert.equal(result.strongAlpha,1);assert.equal(result.maxAlpha,255);
});
