'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawn } = require('node:child_process');
const { readRemoteConfig } = require('./remote-assets');

// Creator 是 Electron 进程；官方 CLI 单独使用 Node 20+，不复用编辑器可执行文件。
function resolveNode({ env = process.env, probe = execFileSync } = {}) {
    const candidates = env.SWIMMING_NODE ? [env.SWIMMING_NODE] : [
        ...(!process.versions.electron ? [process.execPath] : []),
        'node', '/opt/homebrew/bin/node', '/usr/local/bin/node',
        ...(env.ProgramFiles ? [path.join(env.ProgramFiles, 'nodejs', 'node.exe')] : []),
        path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'bin', 'node'),
    ];
    for (const candidate of [...new Set(candidates)]) {
        try {
            const major = Number(String(probe(candidate, ['-p', "process.versions.node.split('.')[0]"], {
                env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000, windowsHide: true,
            })).trim());
            if (Number.isInteger(major) && major >= 20) return candidate;
        } catch { /* 尝试下一处已安装的 Node。 */ }
    }
    throw new Error('[wechat-cdn] 自动上传需要 Node.js 20+；请安装后重试，或通过 SWIMMING_NODE 指定本机 Node 路径。');
}

function preparePublisher(projectRoot) {
    const script = path.join(projectRoot, 'scripts', 'publish-wechat-cdn.cjs');
    const cli = path.join(projectRoot, 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb');
    const sdkPaths = ['manager-node', 'toolbox'].map(name => path.join(projectRoot, 'node_modules', '@cloudbase', name, 'package.json'));
    if (!fs.existsSync(script) || !fs.existsSync(cli) || sdkPaths.some(file => !fs.existsSync(file))) {
        throw new Error('[wechat-cdn] 缺少资源发布工具，请在项目目录执行 pnpm install，再执行 pnpm cdn:login 完成本机授权。');
    }
    return { node: resolveNode(), script };
}

function runPublisher(node, script, buildRoot, projectRoot, { spawnProcess = spawn, timeoutMs = 15 * 60 * 1000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawnProcess(node, [script, buildRoot], {
            cwd: projectRoot, env: process.env, shell: false, windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let settled = false;
        let stderrTail = '';
        const finish = error => {
            if (settled) return;
            settled = true; clearTimeout(timer);
            if (error) reject(error); else resolve();
        };
        const timer = setTimeout(() => {
            child.kill();
            finish(new Error('[wechat-cdn] 上传或校验超过 15 分钟，构建未完成；检查网络后重试。'));
        }, timeoutMs);
        for (const stream of [child.stdout, child.stderr]) {
            stream.setEncoding('utf8');
            stream.on('data', chunk => {
                if (stream === child.stderr) stderrTail = (stderrTail + chunk).slice(-4096);
                if (chunk.trim()) console.log(`[wechat-cdn] ${chunk.trimEnd()}`);
            });
        }
        child.once('error', error => finish(new Error(`[wechat-cdn] 无法启动资源发布：${error.message}`)));
        child.once('close', (code, signal) => finish(code === 0 ? null : new Error(
            `[wechat-cdn] 资源上传或公开下载校验失败（${signal || code}），构建未完成。`
            + (stderrTail.trim() ? `原因：${stderrTail.trim().split(/\r?\n/).pop().slice(0, 600)}` : '请查看上方发布日志中的具体错误。'),
        )));
    });
}

async function publishAfterBuild(projectRoot, buildRoot, { prepare = preparePublisher, run = runPublisher } = {}) {
    const config = readRemoteConfig(projectRoot);
    if (!config.enabled) return;
    if (!config.autoUpload) {
        console.warn('[wechat-cdn] 自动上传已关闭；上传微信代码前请手动执行 pnpm cdn:publish。');
        return;
    }
    const { node, script } = prepare(projectRoot);
    console.log('[wechat-cdn] 本地构建检查通过，开始增量发布远程资源并验证公开下载，请等待完成。');
    await run(node, script, path.resolve(buildRoot), projectRoot);
    console.log('[wechat-cdn] CDN 资源已发布并通过完整校验，现在可以上传微信代码包。');
}

module.exports = { resolveNode, preparePublisher, runPublisher, publishAfterBuild };
