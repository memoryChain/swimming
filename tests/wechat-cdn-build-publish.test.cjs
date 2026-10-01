'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { resolveNode, runPublisher, publishAfterBuild } = require('../extensions/wechat-race-subpackage/cdn-publish');
const vm = require('node:vm');

test('微信远程构建在准备发布前拒绝未开启 MD5 的旧任务，不假装修改参数生效', async () => {
    const source = fs.readFileSync('extensions/wechat-race-subpackage/hooks.js', 'utf8');
    for (const md5Cache of [false, undefined, true]) {
        const calls = [];
        const sandbox = {
            exports: {}, __dirname: path.resolve('extensions/wechat-race-subpackage'),
            require(id) {
                if (id === 'path') return path;
                if (id === './remote-assets') return {
                    readRemoteConfig: () => ({ enabled: true, autoUpload: true }),
                    readClientVersion: () => '1.0.0',
                };
                if (id === './cdn-publish') return {
                    preparePublisher() { calls.push('prepare'); throw new Error('测试终点：发布准备'); },
                };
                return {};
            },
        };
        vm.runInNewContext(source, sandbox);
        const options = Object.freeze({ platform: 'wechatgame', md5Cache });
        await assert.rejects(sandbox.exports.onBeforeBuild(options), md5Cache === true ? /测试终点/ : /当前微信构建任务未开启 MD5 Cache/);
        assert.deepEqual(calls, md5Cache === true ? ['prepare'] : []);
        assert.equal(options.md5Cache, md5Cache);
        await sandbox.exports.onBeforeBuild({ platform: 'web-mobile' });
    }
});

function fixture(t, patch = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cdn-build-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'config/build'), { recursive: true });
    fs.writeFileSync(path.join(root, 'config/build/wechat-remote-assets.json'), JSON.stringify({
        enabled: true, autoUpload: true, origin: 'https://assets.example.com', prefix: 'game-assets', bundles: ['ui'], ...patch,
    }));
    return root;
}

test('自动发布使用本次构建目录，必须等上传及校验完成才返回成功', async t => {
    const root = fixture(t), build = path.join(root, 'build/custom game'); let complete, calls = 0, done = false;
    const pending = publishAfterBuild(root, build, {
        prepare: value => { assert.equal(value, root); return { node: '/node path/node', script: '/publish script.cjs' }; },
        run: (node, script, dest, cwd) => { calls++; assert.deepEqual([node, script, dest, cwd], ['/node path/node', '/publish script.cjs', build, root]); return new Promise(resolve => complete = resolve); },
    }).then(() => { done = true; });
    await Promise.resolve(); assert.equal(calls, 1); assert.equal(done, false);
    complete(); await pending; assert.equal(done, true);
});

test('上传/校验失败向 Creator 传播，关闭远程包或显式关闭自动发布不启动进程', async t => {
    const root = fixture(t);
    await assert.rejects(publishAfterBuild(root, '/build', { prepare: () => ({}), run: async () => { throw new Error('公开校验失败'); } }), /公开校验失败/);
    for (const patch of [{ enabled: false }, { autoUpload: false }]) {
        const root = fixture(t, patch);
        await publishAfterBuild(root, '/build', { prepare: () => { throw new Error('不应启动'); } });
    }
    await assert.rejects(publishAfterBuild(fixture(t, { autoUpload: 'true' }), '/build'), /远程配置/);
});

test('仅接受有效 Node 20+，显式路径不静默回退到其他解释器', () => {
    const env = { SWIMMING_NODE: '/custom node/node' };
    assert.equal(resolveNode({ env, probe: (exe, args, options) => {
        assert.equal(exe, env.SWIMMING_NODE); assert.equal(args[0], '-p'); assert.equal(options.timeout, 5000); return '22\n';
    } }), env.SWIMMING_NODE);
    for (const result of ['18', 'not-node']) assert.throws(() => resolveNode({ env, probe: () => result }), /Node.js 20/);
    assert.throws(() => resolveNode({ env, probe: () => { throw new Error('missing'); } }), /SWIMMING_NODE/);
});

test('发布子进程参数按数组传递，禁止 shell，退出失败/启动失败/超时都拒绝放行', async () => {
    for (const scenario of ['success', 'failed', 'error', 'timeout']) {
        let child;
        const waiting = runPublisher('/node', '/project with spaces/publish.cjs', '/build with spaces', '/project', {
            timeoutMs: 10,
            spawnProcess(exe, args, options) {
                assert.equal(exe, '/node'); assert.deepEqual(args, ['/project with spaces/publish.cjs', '/build with spaces']);
                assert.equal(options.shell, false); assert.equal(options.cwd, '/project'); assert.equal(options.stdio[0], 'ignore');
                child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
                child.kill = () => { child.killed = true; };
                if (scenario !== 'timeout') setImmediate(() => scenario === 'error' ? child.emit('error', new Error('无法运行')) : child.emit('close', scenario === 'success' ? 0 : 1));
                return child;
            },
        });
        if (scenario === 'success') await waiting;
        else await assert.rejects(waiting, /wechat-cdn/);
        if (scenario === 'timeout') assert.equal(child.killed, true);
    }
});

test('真实构建钩子只在微信出口、完成包体审计后等待自动发布，并开启错误传播', () => {
    const source = fs.readFileSync('extensions/wechat-race-subpackage/hooks.js', 'utf8');
    const after = source.slice(source.indexOf('exports.onAfterBuild ='));
    assert.match(after, /if \(options.platform !== 'wechatgame'\)/);
    assert.ok(after.indexOf('await publishAfterBuild(PROJECT_ROOT, result.dest)') > after.indexOf('auditWechatPackageOutput(result.dest)'));
    assert.match(source, /exports.throwError = true/);
});

test('钩子失败摘要保留发布子进程的具体原因', async () => {
    const waiting = runPublisher('/node', '/script', '/build', '/project', {
        spawnProcess() {
            const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
            setImmediate(() => {
                child.stderr.write('发布清单文件条目');
                child.stderr.write('无效：remote/race/font.ttf\n');
                child.emit('close', 1);
            });
            return child;
        },
    });
    await assert.rejects(waiting, /原因：发布清单文件条目无效：remote\/race\/font.ttf/);
});

test('构建覆盖旧任务的 Bundle 设置，UI 嵌套包独立导出且角色和音乐保持微信分包', async () => {
    const sandbox = {
        exports: {}, __dirname: path.resolve('extensions/wechat-race-subpackage'), console: { log() {} },
        require(id) {
            if (id === 'path') return path;
            return {
                readRemoteConfig: () => ({ enabled: true, autoUpload: false }), readClientVersion: () => '1.0.0',
                applyWechatProjectConfig() {}, assertStartupSceneEntry() {},
                assertTextureCompressionPolicy: () => ({}), assertUiFontPolicy: () => ({}), assertUiAtlasPolicy: () => ({groups:[]}),
            };
        },
    };
    vm.runInNewContext(fs.readFileSync('extensions/wechat-race-subpackage/hooks.js', 'utf8'), sandbox);
    const options = { platform: 'wechatgame', md5Cache: true, packAutoAtlas:true, bundleConfigs: [
        { root: 'db://assets/race', isRemote: true }, { root: 'db://assets/race/ui', isRemote: true },
    ] };
    await sandbox.exports.onBeforeBuild(options);
    for (const name of ['ui', 'race', 'music', 'gameplay', 'startup-ui']) {
        const found = options.bundleConfigs.filter(bundle => bundle.name === name);
        assert.equal(found.length, 1); assert.equal(found[0].compressionType, 'subpackage');
        assert.equal(found[0].isRemote, false);
    }
    const ui = options.bundleConfigs.find(b => b.name === 'ui');
    assert.equal(ui.root, 'db://assets/race/ui'); assert.equal(ui.priority, 8);
});
