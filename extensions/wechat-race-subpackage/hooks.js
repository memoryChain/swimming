'use strict';
const { settingsFile } = require('./build-layout');

const fs = require('fs');
const path = require('path');
const { assertTextureCompressionPolicy } = require('./texture-compression-policy');
const { assertBuildMipmaps } = require('./texture-mipmap-policy');
const { assertUiFontPolicy } = require('../../scripts/ui-font-policy');
const { applyWechatProjectConfig, assertWechatProjectOutput } = require('./wechat-project-config');
const { compactBuiltMotions, assertBuiltMotionRuntime } = require('./sampled-motion-storage');
const { auditWechatPackageOutput } = require('./wechat-package-budget');
const { readClientVersion, readRemoteConfig, exportRemoteAssets, assertRemoteOutput } = require('./remote-assets');
const { assertStartupCodeOutput, assertStartupSceneEntry } = require('./startup-code-policy');
const { applyWechatIosDpr } = require('./wechat-ios-dpr');
const { applyWechatFirstScreen } = require('./wechat-first-screen');
const { preparePublisher, publishAfterBuild } = require('./cdn-publish');
const { assertUiAtlasPolicy, assertBuiltUiAtlases } = require('../../scripts/ui-atlas-policy.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const LOGIN_SCENE = {
    url: 'db://assets/scenes/Login.scene',
    uuid: '074665cc-6b6a-4138-bf91-410cd0b70e4d',
};
const SUBPACKAGE_BUNDLES = [
    { name: 'ui', root: 'db://assets/race/ui', priority: 8 },
    { name: 'race', root: 'db://assets/race', priority: 7 },
    { name: 'music', root: 'db://assets/music', priority: 6 },
    { name: 'gameplay', root: 'db://assets/scripts', priority: 5 },
    { name: 'startup-ui', root: 'db://assets/race/fonts/startup', priority: 9 },
];

// WeChat lock-step (帧同步) options for wx.getGameServerManager(). gameTick is the
// logical frame interval in ms (33ms ≈ 30 logical frames/sec). Matches the official
// minigame-lockstep-demo game.json. Without this, WeChat warns "lockStepOptions is
// not an Object, using default options".
const LOCK_STEP_OPTIONS = {
    gameTick: 33,
    heartBeatTick: 2000,
    // Cross-network diagnosis (2026-08): a remote friend's frame channel connected
    // then stalled after ~5s while broadcastInRoom delivered nothing. Raising these
    // two makes the managed frame channel more tolerant of packet loss and stops the
    // server from dropping a laggy cross-network client too early. Both are reversible.
    offlineTimeLength: 60000,
    UDPReliabilityStrategy: 5,
    // actionList element type. Explicit "String" avoids the runtime warning
    // 'lockStepOptions.dataType ... is invalid, using default value "String"'.
    dataType: 'String',
};

exports.throwError = true;

exports.onBeforeBuild = async function onBeforeBuild(options) {
    if (options.platform !== 'wechatgame') {
        return;
    }

    const remoteConfig = readRemoteConfig(PROJECT_ROOT);
    if (remoteConfig.enabled) {
        readClientVersion(PROJECT_ROOT);
        // 编辑器已有任务使用自己的配置；修改钩子参数不能保证影响 Bundle 构建。
        // 必须在耗时审计和发布准备之前检查，不能等导出时才发现缺少缓存标识。
        if (options.md5Cache !== true) {
            throw new Error('[remote-assets] 当前微信构建任务未开启 MD5 Cache。请在 Creator「项目 → 构建发布」中编辑当前任务，勾选「MD5 Cache」并保存后重新构建；也可导入 config/build/wechatgame.json。共享配置不会自动覆盖已有任务。');
        }
    }
    if (remoteConfig.enabled && remoteConfig.autoUpload) preparePublisher(PROJECT_ROOT);
    if (options.packAutoAtlas !== true) throw new Error('[ui-atlas] 当前构建任务必须开启「合并自动图集」，请导入 config/build/wechatgame.json 或修改任务设置。');
    const atlasAudit = assertUiAtlasPolicy(PROJECT_ROOT);
    console.log(`[ui-atlas] 已检查 ${atlasAudit.groups.length} 组图集。`);

    applyWechatProjectConfig(options);
    assertStartupSceneEntry(PROJECT_ROOT);

    // Do not silently publish newly imported large images or GLB-embedded images
    // without the project's tiered ASTC policy. The fixer must run before this
    // build so Creator has time to re-import the changed .meta files.
    const textureAudit = assertTextureCompressionPolicy(PROJECT_ROOT);
    console.log(
        `[texture-policy] verified ${textureAudit.eligible} compressed textures; `
        + `${textureAudit.mipmapSamplersEnabled} texture samplers use mipmaps; `
        + `${textureAudit.mipmapSamplersDisabled} texture samplers remain single-level; `
        + `${textureAudit.ignoredMainPackage} main-package UI textures and `
        + `${textureAudit.ignoredSmall} small textures intentionally remain original.`,
    );

    // Static UI copy must be covered by the committed project fonts. This is a
    // read-only guard: font generation is explicit so Creator can import the
    // changed TTF files before building.
    const fontAudit = assertUiFontPolicy(PROJECT_ROOT);
    console.log(
        `[ui-font-policy] verified ${fontAudit.glyphCount} glyphs from `
        + `${fontAudit.scannedFiles} project text files.`,
    );

    // MainGame belongs to the race Bundle and must not also be copied into main.
    options.startScene = LOGIN_SCENE.uuid;
    options.scenes = [LOGIN_SCENE];
    options.mainBundleCompressionType = 'merge_dep';
    const bundleConfigs = Array.isArray(options.bundleConfigs) ? options.bundleConfigs : [];
    const configuredRoots = new Set(SUBPACKAGE_BUNDLES.map((bundle) => bundle.root));
    options.bundleConfigs = bundleConfigs.filter((bundle) => !configuredRoots.has(bundle.root));
    for (const bundle of SUBPACKAGE_BUNDLES) {
        options.bundleConfigs.push({
            ...bundle,
            compressionType: 'subpackage',
            isRemote: false,
        });
    }
};

exports.onBeforeCompressSettings = async function onBeforeCompressSettings(options, result) {
    if (options.platform !== 'wechatgame') {
        return;
    }
    const assets = result.settings.assets || (result.settings.assets = {});
    const subpackages = Array.isArray(assets.subpackages) ? assets.subpackages : [];
    assets.subpackages = [...new Set([...subpackages, ...SUBPACKAGE_BUNDLES.map((bundle) => bundle.name)])];
};

exports.onAfterBuild = async function onAfterBuild(options, result) {
    if (options.platform !== 'wechatgame') {
        return;
    }

    // 在任何适配层和引擎初始化之前限制 iOS 渲染像素比。
    applyWechatIosDpr(result.dest);
    applyWechatFirstScreen(PROJECT_ROOT, result.dest);

    // 在搬移 Bundle 之前使用 Creator 返回的原生文件路径，兼容 MD5 文件名。
    const mipmapAudit = assertBuildMipmaps(PROJECT_ROOT, result);
    console.log(`[texture-mipmap] 已验证 ${mipmapAudit.compressedImages} 张 ASTC 完整 mip 链及回退图片。`);

    const settingsPath = settingsFile(result.dest);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const settingsAssets = settings.assets || (settings.assets = {});
    const cocosSubpackages = Array.isArray(settingsAssets.subpackages) ? settingsAssets.subpackages : [];
    settingsAssets.subpackages = [
        ...new Set([...cocosSubpackages, ...SUBPACKAGE_BUNDLES.map((bundle) => bundle.name)]),
    ];
    fs.writeFileSync(settingsPath, `${JSON.stringify(settings)}\n`, 'utf8');

    const gameJsonPath = path.join(result.dest, 'game.json');
    const gameConfig = JSON.parse(fs.readFileSync(gameJsonPath, 'utf8'));
    const subpackages = Array.isArray(gameConfig.subpackages) ? gameConfig.subpackages : [];
    const outputRoot = path.resolve(result.dest);
    const generatedSubpackages = [];
    for (const bundle of SUBPACKAGE_BUNDLES) {
        const generatedBundleRoot = path.resolve(result.dest, 'assets', bundle.name);
        const generatedSubpackageRoot = `subpackages/${bundle.name}/`;
        const subpackageRoot = path.resolve(result.dest, generatedSubpackageRoot);
        for (const candidate of [generatedBundleRoot, subpackageRoot]) {
            if (!candidate.startsWith(`${outputRoot}${path.sep}`)) {
                throw new Error(`[wechat-race-subpackage] Refusing to modify path outside build output: ${candidate}`);
            }
        }

        // Creator 3.8.8 can emit subpackage Bundles under assets/<name>.
        // Move instead of copy so no duplicate remains in the main package.
        if (fs.existsSync(generatedBundleRoot)) {
            fs.mkdirSync(path.dirname(subpackageRoot), { recursive: true });
            fs.rmSync(subpackageRoot, { recursive: true, force: true });
            fs.renameSync(generatedBundleRoot, subpackageRoot);
        }
        if (!fs.existsSync(subpackageRoot)) {
            throw new Error(
                `[wechat-race-subpackage] Generated ${bundle.name} Asset Bundle root does not exist: ${generatedSubpackageRoot}`,
            );
        }
        const bundleVersion = settingsAssets.bundleVers?.[bundle.name];
        const suffix = bundleVersion ? `${bundleVersion}.` : '';
        const gameEntry = `'use strict';\nrequire('./index.${suffix}js');\n`;
        for (const requiredFile of [`config.${suffix}json`, `index.${suffix}js`]) {
            if (!fs.existsSync(path.join(subpackageRoot, requiredFile))) {
                throw new Error(`[wechat-race-subpackage] ${bundle.name} Bundle is missing ${requiredFile}`);
            }
        }
        const gameEntryPath = path.join(subpackageRoot, 'game.js');
        fs.writeFileSync(gameEntryPath, gameEntry, 'utf8');
        generatedSubpackages.push({
            name: bundle.name,
            root: generatedSubpackageRoot,
            generatedBundleRoot,
            gameEntryPath, gameEntry,
        });
    }

    const generatedNames = new Set(generatedSubpackages.map((subpackage) => subpackage.name));
    gameConfig.subpackages = [
        ...generatedSubpackages.map(({ name, root }) => ({ name, root })),
        ...subpackages.filter((subpackage) => !generatedNames.has(subpackage.name)),
    ];
    // Configure lock-step so wx.getGameServerManager() stops falling back to defaults
    // (the "lockStepOptions is not an Object" runtime warning) and uses our gameTick.
    gameConfig.lockStepOptions = LOCK_STEP_OPTIONS;
    // Cocos Creator's build panel exposes "高性能模式(iOS)" (iOSHighPerformance) but NOT the
    // newer 高性能+ flag, so inject it here on every WeChat build. iOSHighPerformance+ requires
    // iOSHighPerformance to also be true (WeChat: "要开通高性能+模式请先保证游戏已经在高性能模式下"),
    // so force both. NOTE: '+' is part of the key, so it needs bracket notation. To disable
    // high-performance mode (e.g. to A/B test framerate), flip these to false here and rebuild —
    // do NOT hand-edit build/wechatgame/game.json, a rebuild overwrites it.
    gameConfig.iOSHighPerformance = true;
    gameConfig['iOSHighPerformance+'] = true;
    fs.writeFileSync(gameJsonPath, `${JSON.stringify(gameConfig, null, 4)}\n`, 'utf8');

    const verifiedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const verifiedGameConfig = JSON.parse(fs.readFileSync(gameJsonPath, 'utf8'));
    for (const generated of generatedSubpackages) {
        const settingsReady = verifiedSettings?.assets?.subpackages?.includes(generated.name);
        const manifestReady = verifiedGameConfig.subpackages?.some(
            (subpackage) => subpackage.name === generated.name && subpackage.root === generated.root,
        );
        const bundleMovedOutOfMain = !fs.existsSync(generated.generatedBundleRoot);
        const entryReady = fs.readFileSync(generated.gameEntryPath, 'utf8') === generated.gameEntry;
        if (!settingsReady || !manifestReady || !bundleMovedOutOfMain || !entryReady) {
            throw new Error(
                `[wechat-race-subpackage] ${generated.name} subpackage verification failed after generation.`,
            );
        }
    }
    assertWechatProjectOutput(result.dest);
    const builtAtlasAudit = assertBuiltUiAtlases(PROJECT_ROOT, result.dest);
    console.log(`[ui-atlas] 已验证 ${builtAtlasAudit.groups} 组构建图集，无重复散图纹理路径。`);
    const startupAudit = assertStartupCodeOutput(result.dest);
    console.log(`[startup-code] 主包脚本 ${(startupAudit.mainJsBytes / 1024).toFixed(1)} KiB；延迟业务脚本 ${(startupAudit.gameplayJsBytes / 1024).toFixed(1)} KiB。`);
    assertBuiltMotionRuntime(result.dest);
    const motionAudit = compactBuiltMotions(PROJECT_ROOT, result.dest);
    console.log(`[motion-storage] 无损压缩 ${motionAudit.motions} 个动作，节省 ${(motionAudit.savedBytes / 1024).toFixed(1)} KiB。`);
    const remoteConfig = readRemoteConfig(PROJECT_ROOT);
    if (remoteConfig.enabled) {
        const release = exportRemoteAssets(PROJECT_ROOT, result.dest, remoteConfig);
        assertRemoteOutput(result.dest);
        console.log(`[remote-assets] 远程资源 ${release.files.length} 个文件；发布目录 ${release.publishRoot}；服务器 ${release.server}`);
    }
    const packageAudit = auditWechatPackageOutput(result.dest);
    console.log(
        `[wechat-race-subpackage] generated and verified resource bundles; `
        + `main package ${(packageAudit.mainBytes / 1024).toFixed(1)} KiB; `
        + `total ${(packageAudit.totalBytes / 1024).toFixed(1)} / 30720 KiB.`,
    );
    // 必须放在所有本地审计之后，并等待发布和校验结束才允许 Creator 显示成功。
    await publishAfterBuild(PROJECT_ROOT, result.dest);
};
