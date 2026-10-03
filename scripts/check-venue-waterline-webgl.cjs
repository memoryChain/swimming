'use strict';

// 输入为 Cocos buildEffect() 输出或已导入的 library EffectAsset JSON；不启动 Creator 或截取预览。
// node scripts/check-venue-waterline-webgl.cjs <compiled-effect.json>
// Playwright 可通过 NODE_PATH 提供；已有浏览器通过 CHROME_EXECUTABLE 指定。
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function checkVariants(effect) {
    assert.ok(effect.shaders?.length === 1, '需要单个场馆水线着色器的编译输出');
    const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.CHROME_EXECUTABLE || undefined,
        args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    try {
        const page = await browser.newPage();
        return await page.evaluate(effect => {
            const results = [];
            const shaderInfo = effect.shaders[0];
            for (const [version, context] of [['glsl1', 'webgl'], ['glsl3', 'webgl2']]) {
                const gl = document.createElement('canvas').getContext(context);
                if (!gl) throw new Error(`${context} 不可用`);
                let passed = 0;
                const failures = [];
                try {
                    for (const instancing of [0, 1]) for (const texture of [0, 1])
                        for (const poolside of [0, 1]) for (const floating of [0, 1]) {
                            const macros = Object.fromEntries(shaderInfo.defines.map(d => [d.name, 0]));
                            Object.assign(macros, {
                                USE_INSTANCING: instancing, USE_TEXTURE: texture,
                                USE_POOLSIDE_WATERLINE: poolside, USE_FLOATING_VERTEX_COLOR: floating,
                                CC_DEVICE_SUPPORT_FLOAT_TEXTURE: 1,
                                CC_DEVICE_MAX_FRAGMENT_UNIFORM_VECTORS: 1024,
                                CC_DEVICE_MAX_VERTEX_UNIFORM_VECTORS: 1024,
                                CC_EFFECT_USED_VERTEX_UNIFORM_VECTORS: 128,
                                CC_EFFECT_USED_FRAGMENT_UNIFORM_VECTORS: 128,
                            });
                            const prefix = (version === 'glsl3' ? '#version 300 es\n' : '#version 100\n')
                                + Object.entries(macros).map(([key, value]) => `#define ${key} ${value}`).join('\n') + '\n';
                            const shaders = [];
                            let error = '';
                            for (const [stage, type] of [['vert', gl.VERTEX_SHADER], ['frag', gl.FRAGMENT_SHADER]]) {
                                const shader = gl.createShader(type);
                                gl.shaderSource(shader, prefix + shaderInfo[version][stage]);
                                gl.compileShader(shader);
                                shaders.push(shader);
                                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) error += `${stage}: ${gl.getShaderInfoLog(shader)}`;
                            }
                            if (!error) {
                                const program = gl.createProgram();
                                for (const shader of shaders) gl.attachShader(program, shader);
                                gl.linkProgram(program);
                                if (!gl.getProgramParameter(program, gl.LINK_STATUS)) error = gl.getProgramInfoLog(program);
                                gl.deleteProgram(program);
                            }
                            for (const shader of shaders) gl.deleteShader(shader);
                            if (error) failures.push({ instancing, texture, poolside, floating, error });
                            else passed++;
                        }
                } finally {
                    gl.getExtension('WEBGL_lose_context')?.loseContext();
                }
                results.push({ version, passed, failures });
            }
            return results;
        }, effect);
    } finally {
        await browser.close();
    }
}

module.exports = { checkVariants };
if (require.main === module) {
    (async () => {
        assert.ok(process.argv[2], '请提供 buildEffect() 输出或 library EffectAsset JSON 的路径');
        const results = await checkVariants(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
        for (const result of results) console.log(JSON.stringify(result));
        assert.ok(results.every(result => result.passed === 16 && !result.failures.length), '场馆水线 WebGL 宏组合编译／链接失败');
        console.log('场馆水线 WebGL 1／2 的 32 个宏组合编译和链接全部通过。');
    })().catch(error => { console.error(error); process.exitCode = 1; });
}
