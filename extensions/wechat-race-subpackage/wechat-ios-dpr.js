'use strict';

const fs = require('fs');
const path = require('path');

const IOS_MAX_DPR = 2.2;
const START = '// swimming-ios-dpr:start';
const END = '// swimming-ios-dpr:end';

// 此函数会写入微信入口，不能引用构建进程中的变量。
function installIosDpr(api, maxDpr) {
    if (!api) return;
    let device;
    try {
        device = typeof api.getDeviceInfo === 'function' ? api.getDeviceInfo() : api.getSystemInfoSync();
    } catch (_) {
        try { device = api.getSystemInfoSync(); } catch (_) { return; }
    }
    if (!device) return;
    const platformName = String(device.platform).toLowerCase();
    let originalDpr = '未知';
    try {
        originalDpr = (typeof api.getWindowInfo === 'function' ? api.getWindowInfo() : api.getSystemInfoSync()).pixelRatio;
    } catch (_) { /* 诊断读取失败不影响 DPR 策略。 */ }

    // Cocos 3.8.8 的屏幕与触摸适配使用 getWindowInfo；旧基础库回退到
    // getSystemInfoSync。两者必须在 web-adapter 和引擎缓存接口前统一。
    for (const name of ['getWindowInfo', 'getSystemInfoSync']) {
        if (platformName !== 'ios') break;
        const original = api[name];
        if (typeof original !== 'function') continue;
        api[name] = function () {
            const info = original.apply(api, arguments);
            if (!info || !Number.isFinite(info.pixelRatio) || info.pixelRatio <= maxDpr) return info;
            const result = Object.assign({}, info, { pixelRatio: maxDpr });
            // 兼容同时提供浏览器别名的适配层；不更改窗口尺寸与安全区。
            if ('devicePixelRatio' in result) result.devicePixelRatio = maxDpr;
            return result;
        };
    }

    // 仅启动时输出一次，重新读取接口确认实际返回值；不放进接口包装或逐帧路径。
    try {
        const effectiveDpr = (typeof api.getWindowInfo === 'function' ? api.getWindowInfo() : api.getSystemInfoSync()).pixelRatio;
        console.log(`[DPR] 平台=${platformName} 原始=${originalDpr} 生效=${effectiveDpr} iOS上限=${maxDpr}`);
    } catch (_) { /* 诊断或日志不可用时不能阻断游戏启动。 */ }
}

function dprPrelude() {
    return `${START}\n;(${installIosDpr.toString()})(typeof wx === 'undefined' ? null : wx, ${IOS_MAX_DPR});\n${END}\n`.replace(/\r\n/g, '\n');
}

function assertWechatIosDpr(outputRoot) {
    const source = fs.readFileSync(path.join(outputRoot, 'game.js'), 'utf8').replace(/\r\n/g, '\n');
    if (!source.startsWith(dprPrelude())) {
        throw new Error('[wechat-dpr] 构建入口缺少最新 DPR 策略或启动日志，请运行 pnpm wechat:finalize。');
    }
}

function applyWechatIosDpr(outputRoot, options = {}) {
    const entryPath = path.join(outputRoot, 'game.js');
    const source = fs.readFileSync(entryPath, 'utf8');
    // 可重复执行，也允许后续修改上限时替换旧策略。
    const clean = source.replace(/\/\/ swimming-ios-dpr:start[\s\S]*?\/\/ swimming-ios-dpr:end\r?\n?/, '');
    const updated = dprPrelude() + clean;
    const changed = updated !== source;
    if (changed && !options.checkOnly) {
        if (options.backupRoot) {
            fs.mkdirSync(options.backupRoot, { recursive: true });
            fs.copyFileSync(entryPath, path.join(options.backupRoot, 'game.js'));
        }
        fs.writeFileSync(entryPath, updated, 'utf8');
    }
    return { changed };
}

module.exports = { IOS_MAX_DPR, applyWechatIosDpr, assertWechatIosDpr };
