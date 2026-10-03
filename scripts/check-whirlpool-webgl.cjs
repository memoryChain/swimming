const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
async function checkWhirlpoolWebgl(effect){
    const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE || undefined,
        args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    try {
        const page=await browser.newPage();
        return await page.evaluate(effect=>{
            const results=[];
            const shaderInfo=effect.shaders[0];
            for(const [version,context] of [['glsl1','webgl'],['glsl3','webgl2']]){
                const gl=document.createElement('canvas').getContext(context);
                if(!gl)throw new Error(`${context} 不可用`);
                let passed=0;const failures=[];
                for(const fog of [0,1,2,3,4])for(const accurate of [0,1])for(const instancing of [0,1]){
                    const macros=Object.fromEntries(shaderInfo.defines.map(d=>[d.name,0]));
                    Object.assign(macros,{CC_USE_FOG:fog,CC_USE_ACCURATE_FOG:accurate,USE_INSTANCING:instancing,CC_DEVICE_SUPPORT_FLOAT_TEXTURE:1,
                        CC_DEVICE_MAX_FRAGMENT_UNIFORM_VECTORS:1024,CC_DEVICE_MAX_VERTEX_UNIFORM_VECTORS:1024,
                        CC_EFFECT_USED_VERTEX_UNIFORM_VECTORS:128,CC_EFFECT_USED_FRAGMENT_UNIFORM_VECTORS:128});
                    const prefix=(version==='glsl3'?'#version 300 es\n':'#version 100\n')
                        +Object.entries(macros).map(([k,v])=>`#define ${k} ${v}`).join('\n')+'\n';
                    const shaders=[];let error='';
                    for(const [stage,type] of [['vert',gl.VERTEX_SHADER],['frag',gl.FRAGMENT_SHADER]]){
                        const shader=gl.createShader(type);shaders.push(shader);
                        gl.shaderSource(shader,prefix+shaderInfo[version][stage]);gl.compileShader(shader);
                        if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))error+=`${stage}: ${gl.getShaderInfoLog(shader)}`;
                    }
                    if(!error){const p=gl.createProgram();for(const s of shaders)gl.attachShader(p,s);gl.linkProgram(p);
                        if(!gl.getProgramParameter(p,gl.LINK_STATUS))error=gl.getProgramInfoLog(p);gl.deleteProgram(p);}
                    for(const s of shaders)gl.deleteShader(s);
                    if(error)failures.push({fog,instancing,error});else passed++;
                }
                gl.getExtension('WEBGL_lose_context')?.loseContext();results.push({version,passed,failures});
            }
            return results;
        },effect);
    }finally{await browser.close();}
}
module.exports={checkWhirlpoolWebgl};
if(require.main===module){
    (async()=>{
        const result=await checkWhirlpoolWebgl(JSON.parse(fs.readFileSync(process.argv[2],'utf8')).WhirlpoolFunnel);
        for(const row of result)console.log(JSON.stringify(row));
        assert.ok(result.every(r=>r.passed===20&&!r.failures.length),'漩涡 WebGL 编译或链接失败');
        console.log('漩涡 WebGL 1／2 的 40 个雾效与实例化组合编译和链接全部通过。');
    })().catch(e=>{console.error(e);process.exitCode=1;});
}
