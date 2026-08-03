'use strict';

const fs = require('fs');
const path = require('path');
const { assertTextureCompressionPolicy } = require('./texture-compression-policy');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const LOGIN_SCENE = {
    url: 'db://assets/scenes/Login.scene',
    uuid: '074665cc-6b6a-4138-bf91-410cd0b70e4d',
};
const SUBPACKAGE_GAME_ENTRY = "'use strict';\nrequire('./index.js');\n";
const SUBPACKAGE_BUNDLES = [
    { name: 'race', root: 'db://assets/race', priority: 7 },
    { name: 'music', root: 'db://assets/music', priority: 6 },
];
const MAX_WECHAT_MAIN_SOURCE_BYTES = 4 * 1024 * 1024;
const FORBIDDEN_TEXTURE_EXTENSIONS = new Set(['.pvr', '.pkm']);

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

    // Do not silently publish newly imported large images or GLB-embedded images
    // without the project's tiered ASTC policy. The fixer must run before this
    // build so Creator has time to re-import the changed .meta files.
    const textureAudit = assertTextureCompressionPolicy(PROJECT_ROOT);
    console.log(
        `[texture-policy] verified ${textureAudit.eligible} compressed textures; `
        + `${textureAudit.mipmapSamplersDisabled} GLB texture samplers have mip filtering disabled; `
        + `${textureAudit.ignoredMainPackage} main-package UI textures and `
        + `${textureAudit.ignoredSmall} small textures intentionally remain original.`,
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

    const settingsPath = path.join(result.dest, 'src', 'settings.json');
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
        for (const requiredFile of ['config.json', 'index.js']) {
            if (!fs.existsSync(path.join(subpackageRoot, requiredFile))) {
                throw new Error(`[wechat-race-subpackage] ${bundle.name} Bundle is missing ${requiredFile}`);
            }
        }
        const gameEntryPath = path.join(subpackageRoot, 'game.js');
        fs.writeFileSync(gameEntryPath, SUBPACKAGE_GAME_ENTRY, 'utf8');
        generatedSubpackages.push({
            name: bundle.name,
            root: generatedSubpackageRoot,
            generatedBundleRoot,
            gameEntryPath,
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
    fs.writeFileSync(gameJsonPath, `${JSON.stringify(gameConfig, null, 4)}\n`, 'utf8');

    const verifiedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const verifiedGameConfig = JSON.parse(fs.readFileSync(gameJsonPath, 'utf8'));
    for (const generated of generatedSubpackages) {
        const settingsReady = verifiedSettings?.assets?.subpackages?.includes(generated.name);
        const manifestReady = verifiedGameConfig.subpackages?.some(
            (subpackage) => subpackage.name === generated.name && subpackage.root === generated.root,
        );
        const bundleMovedOutOfMain = !fs.existsSync(generated.generatedBundleRoot);
        const entryReady = fs.readFileSync(generated.gameEntryPath, 'utf8') === SUBPACKAGE_GAME_ENTRY;
        if (!settingsReady || !manifestReady || !bundleMovedOutOfMain || !entryReady) {
            throw new Error(
                `[wechat-race-subpackage] ${generated.name} subpackage verification failed after generation.`,
            );
        }
    }
    const packageAudit = auditWechatPackageOutput(result.dest);
    console.log(
        `[wechat-race-subpackage] generated and verified race/music subpackages; `
        + `main package ${(packageAudit.mainBytes / 1024).toFixed(1)} KiB.`,
    );
};

function auditWechatPackageOutput(outputRoot) {
    const resolvedRoot = path.resolve(outputRoot);
    const files = [];
    visitOutputFiles(resolvedRoot, files);

    const forbidden = files.filter((filePath) => FORBIDDEN_TEXTURE_EXTENSIONS.has(path.extname(filePath).toLowerCase()));
    if (forbidden.length > 0) {
        const examples = forbidden.slice(0, 8)
            .map((filePath) => path.relative(resolvedRoot, filePath).replace(/\\/g, '/'))
            .join(', ');
        throw new Error(
            `[texture-policy] Build emitted ${forbidden.length} unexpected PVR/PKM textures (${examples}). `
            + 'Creator is using stale/default compression presets. Close and reopen the Creator project, '
            + 'run npm run textures:check, then rebuild. Do not upload this oversized package.',
        );
    }

    let mainBytes = 0;
    for (const filePath of files) {
        const relative = path.relative(resolvedRoot, filePath).replace(/\\/g, '/');
        if (!relative.startsWith('subpackages/')) {
            mainBytes += fs.statSync(filePath).size;
        }
    }
    if (mainBytes > MAX_WECHAT_MAIN_SOURCE_BYTES) {
        throw new Error(
            `[wechat-package] Main package is ${(mainBytes / 1024).toFixed(1)} KiB, `
            + `exceeding the 4096 KiB limit. Move new race-only assets into a subpackage `
            + 'or remove duplicated main-package variants before upload.',
        );
    }
    return { mainBytes };
}

function visitOutputFiles(directory, files) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            visitOutputFiles(target, files);
        } else if (entry.isFile()) {
            files.push(target);
        }
    }
}
