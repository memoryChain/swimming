const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { exportRemoteAssets, assertRemoteOutput } = require('../extensions/wechat-race-subpackage/remote-assets');
const { auditWechatPackageOutput } = require('../extensions/wechat-race-subpackage/wechat-package-budget');
const { validateRelease } = require('../scripts/publish-wechat-cdn.cjs');
const config = { origin: 'https://assets.example.com', prefix: 'game-assets', bundles: ['ui'] };
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swimming-cdn-'));
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.writeFileSync(path.join(root, 'config/game-versions.json'), JSON.stringify({ clientVersion: '1.0.0', quickRankVersion: '1.0', seasonVersion: 'S1' }));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const output = path.join(root, 'build/game');
    function write(relative, content) {
        const file = path.join(output, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content)); return file;
    }
    write('src/settings.json', { assets: { server: '', remoteBundles: [], bundleVers: { ui: 'abc123', race: 'abc123', music: 'abc123' }, subpackages: ['ui', 'race', 'music', 'gameplay', 'startup-ui'] } });
    write('game.json', { subpackages: ['ui', 'race', 'music', 'gameplay', 'startup-ui'].map(name => ({ name, root: `subpackages/${name}/` })) });
    write('game.js', '本地启动入口');
    for (const name of ['ui', 'race', 'music']) {
        write(`subpackages/${name}/config.abc123.json`, { name, deps: ['internal'], importBase: 'import', nativeBase: 'native' });
        write(`subpackages/${name}/index.abc123.js`, `本地脚本-${name}`);
        write(`subpackages/${name}/game.js`, "require('./index.abc123.js');");
        write(`subpackages/${name}/import/ab/data.json`, { name });
        write(`subpackages/${name}/native/ab/data.bin`, `美术-${name}`);
    }
    return { root, output, write };
}

test('远程资源离开上传包，脚本保持本地；原依赖、文件字节与本地代码分包不变', t => {
    const f = fixture(t), release = exportRemoteAssets(f.root, f.output, config);
    assert.equal(assertRemoteOutput(f.output).server, release.server);
    assert.deepEqual(release.bundles, ['ui']);
    assert.equal(release.files.length, 3);
    assert.ok(release.files.every(file => !file.path.endsWith('.js')));
    assert.equal(fs.readFileSync(path.join(f.output, 'src/bundle-scripts/ui/index.abc123.js'), 'utf8'), '本地脚本-ui');
    const remoteConfig = JSON.parse(fs.readFileSync(path.join(release.publishRoot, 'remote/ui/config.abc123.json')));
    assert.deepEqual(remoteConfig.deps, ['internal']);
    assert.equal(fs.readFileSync(path.join(release.publishRoot, 'remote/ui/native/ab/data.bin'), 'utf8'), '美术-ui');
    const game = JSON.parse(fs.readFileSync(path.join(f.output, 'game.json')));
    assert.deepEqual(game.subpackages.map(p => p.name), ['race', 'music', 'gameplay', 'startup-ui']);
    for (const name of ['race', 'music']) {
        assert.equal(fs.readFileSync(path.join(f.output, `subpackages/${name}/native/ab/data.bin`), 'utf8'), `美术-${name}`);
        assert.ok(!release.files.some(file => file.path.startsWith(`remote/${name}/`)));
    }
    assert.ok(auditWechatPackageOutput(f.output).totalBytes < 4096);
    f.write('src/bundle-scripts/ui/index.abc123.js', '本地脚本-ui');
    fs.unlinkSync(path.join(f.output, 'src/bundle-scripts/ui/index.abc123.js'));
    assert.throws(() => assertRemoteOutput(f.output), /本地/);
});

test('clientVersion 唯一决定目录；同号变化只更新资源文件，业务版本不参与', t => {
    const f = fixture(t), second = path.join(f.root, 'build/second'), third = path.join(f.root, 'build/third');
    fs.cpSync(f.output, second, { recursive: true }); fs.cpSync(f.output, third, { recursive: true });
    const a = exportRemoteAssets(f.root, f.output, config), b = exportRemoteAssets(f.root, second, config);
    assert.equal(a.clientVersion, '1.0.0');
    assert.equal(a.contentHash, b.contentHash);
    assert.equal(a.server, 'https://assets.example.com/game-assets/1.0.0/');
    fs.unlinkSync(path.join(third, 'subpackages/ui/native/ab/data.bin'));
    fs.writeFileSync(path.join(third, 'subpackages/ui/native/ab/data.newhash.bin'), '新版美术');
    fs.writeFileSync(path.join(f.root, 'config/game-versions.json'), JSON.stringify({ clientVersion: '1.0.0', quickRankVersion: '2.0', seasonVersion: 'S2' }));
    const c = exportRemoteAssets(f.root, third, config);
    assert.equal(a.clientVersion, c.clientVersion);
    assert.equal(a.publishRoot, c.publishRoot);
    assert.notEqual(a.contentHash, c.contentHash);
    assert.throws(() => exportRemoteAssets(f.root, f.output, config), /重复转换/);
});

test('拒绝脚本混入远程资源、整包 ZIP 和符号链接，验证失败保留本地资源', t => {
    const f = fixture(t);
    const file = f.write('subpackages/ui/native/secret.js', '不能上传');
    assert.throws(() => exportRemoteAssets(f.root, f.output, config), /禁止发布/);
    assert.ok(fs.existsSync(path.join(f.output, 'subpackages/ui/config.abc123.json')));
    fs.unlinkSync(file);
    f.write('subpackages/ui/config.abc123.json', { name: 'ui', isZip: true });
    assert.throws(() => exportRemoteAssets(f.root, f.output, config), /ZIP/);
    f.write('subpackages/ui/config.abc123.json', { name: 'ui' });
    fs.symlinkSync(path.join(f.output, 'game.js'), path.join(f.output, 'subpackages/ui/native/link.bin'));
    assert.throws(() => exportRemoteAssets(f.root, f.output, config), /符号链接/);
});

test('发布前核验完整资源清单、本地脚本和目标环境，拒绝混入额外文件', t => {
    const f = fixture(t);
    fs.mkdirSync(path.join(f.root, 'config/build'), { recursive: true });
    fs.writeFileSync(path.join(f.root, 'config/build/wechat-remote-assets.json'), JSON.stringify({
        ...config, enabled: true, envId: 'test-env', region: 'ap-shanghai',
    }));
    const release = exportRemoteAssets(f.root, f.output, config);
    assert.equal(validateRelease(f.root, f.output).cloudPath, `game-assets/${release.clientVersion}`);
    const extra = path.join(release.publishRoot, 'private.txt');
    fs.writeFileSync(extra, '不应上传');
    assert.throws(() => validateRelease(f.root, f.output), /清单之外/);
    fs.unlinkSync(extra);
    const resource = path.join(release.publishRoot, release.files[0].path);
    const original = fs.readFileSync(resource);
    fs.writeFileSync(resource, '构建后误改');
    assert.throws(() => validateRelease(f.root, f.output), /文件已变化/);
    fs.writeFileSync(resource, original);
    f.write('src/bundle-scripts/ui/index.abc123.js', '其他版本脚本');
    assert.throws(() => validateRelease(f.root, f.output), /文件已变化/);
});

test('仅改变榜单或赛季号不影响 CDN；clientVersion 变化才换发布目录', t => {
    const f = fixture(t), second = path.join(f.root, 'build/second'), third = path.join(f.root, 'build/third');
    fs.cpSync(f.output, second, { recursive: true }); fs.cpSync(f.output, third, { recursive: true });
    const file = path.join(f.root, 'config/game-versions.json');
    const a = exportRemoteAssets(f.root, f.output, config);
    fs.writeFileSync(file, JSON.stringify({ clientVersion: '1.0.0', quickRankVersion: '随意修改', seasonVersion: 'S99' }));
    const b = exportRemoteAssets(f.root, second, config);
    assert.equal(a.server, b.server); assert.equal(a.contentHash, b.contentHash);
    fs.writeFileSync(file, JSON.stringify({ clientVersion: '1.0.1' }));
    const c = exportRemoteAssets(f.root, third, config);
    assert.equal(c.server, 'https://assets.example.com/game-assets/1.0.1/');
    assert.equal(a.contentHash, c.contentHash);
});

test('不推断或自动递增客户端版本，缺配置/非法号直接失败', t => {
    const f = fixture(t), file = path.join(f.root, 'config/game-versions.json');
    for (const clientVersion of ['', 1, '../unsafe', 'a/b', '1?x', 'x'.repeat(33)]) {
        fs.writeFileSync(file, JSON.stringify({ clientVersion }));
        assert.throws(() => exportRemoteAssets(f.root, f.output, config), /clientVersion/);
    }
    fs.unlinkSync(file);
    assert.throws(() => exportRemoteAssets(f.root, f.output, config), /game-versions/);
});

test('MD5 Cache 的 settings 文件名参与实际读写，多个候选拒绝猜测', t => {
    const f = fixture(t), original = path.join(f.output, 'src/settings.json'), hashed = path.join(f.output, 'src/settings.01045.json');
    fs.renameSync(original, hashed);
    const release = exportRemoteAssets(f.root, f.output, config);
    assert.equal(assertRemoteOutput(f.output).clientVersion, '1.0.0');
    assert.equal(JSON.parse(fs.readFileSync(hashed)).assets.server, release.server);
    assert.equal(fs.existsSync(original), false);
    fs.copyFileSync(hashed, original);
    assert.throws(() => assertRemoteOutput(f.output), /settings 文件无法唯一定位/);
});

test('构建后改 clientVersion 必须重新构建，不把旧包发布到新目录', t => {
    const f = fixture(t);
    fs.mkdirSync(path.join(f.root, 'config/build'), { recursive: true });
    fs.writeFileSync(path.join(f.root, 'config/build/wechat-remote-assets.json'), JSON.stringify({ ...config, enabled: true, envId: 'test-env', region: 'ap-shanghai' }));
    exportRemoteAssets(f.root, f.output, config);
    fs.writeFileSync(path.join(f.root, 'config/game-versions.json'), JSON.stringify({ clientVersion: '1.0.1' }));
    assert.throws(() => validateRelease(f.root, f.output), /clientVersion 与构建不一致/);
});

test('拒绝继续发布旧的全远程布局，也拒绝缺失本地角色分包的混合布局', t => {
    const f = fixture(t), settingsFile = path.join(f.output, 'src/settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsFile));
    f.write('src/settings.json', { ...settings, assets: { ...settings.assets, remoteBundles: ['race', 'music'] } });
    assert.throws(() => assertRemoteOutput(f.output), /布局已变更/);
    f.write('src/settings.json', settings);
    exportRemoteAssets(f.root, f.output, config);
    fs.unlinkSync(path.join(f.output, 'subpackages/race/config.abc123.json'));
    assert.throws(() => assertRemoteOutput(f.output), /race 必须保留/);
});
