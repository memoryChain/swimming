'use strict';

const fs = require('fs');
const path = require('path');

const LOGIN_SCENE = {
    url: 'db://assets/scenes/Login.scene',
    uuid: '074665cc-6b6a-4138-bf91-410cd0b70e4d',
};
const RACE_GAME_ENTRY = "'use strict';\nrequire('./index.js');\n";

exports.throwError = true;

exports.onBeforeBuild = async function onBeforeBuild(options) {
    if (options.platform !== 'wechatgame') {
        return;
    }

    // MainGame belongs to the race Bundle and must not also be copied into main.
    options.startScene = LOGIN_SCENE.uuid;
    options.scenes = [LOGIN_SCENE];
    options.mainBundleCompressionType = 'merge_dep';
    const bundleConfigs = Array.isArray(options.bundleConfigs) ? options.bundleConfigs : [];
    options.bundleConfigs = bundleConfigs.filter((bundle) => bundle.root !== 'db://assets/race');
    options.bundleConfigs.push({
        root: 'db://assets/race',
        name: 'race',
        priority: 7,
        compressionType: 'subpackage',
        isRemote: false,
    });
};

exports.onBeforeCompressSettings = async function onBeforeCompressSettings(options, result) {
    if (options.platform !== 'wechatgame') {
        return;
    }
    const assets = result.settings.assets || (result.settings.assets = {});
    const subpackages = Array.isArray(assets.subpackages) ? assets.subpackages : [];
    assets.subpackages = [...new Set([...subpackages, 'race'])];
};

exports.onAfterBuild = async function onAfterBuild(options, result) {
    if (options.platform !== 'wechatgame') {
        return;
    }

    const settingsPath = path.join(result.dest, 'src', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const settingsAssets = settings.assets || (settings.assets = {});
    const cocosSubpackages = Array.isArray(settingsAssets.subpackages) ? settingsAssets.subpackages : [];
    settingsAssets.subpackages = [...new Set([...cocosSubpackages, 'race'])];
    fs.writeFileSync(settingsPath, `${JSON.stringify(settings)}\n`, 'utf8');

    const gameJsonPath = path.join(result.dest, 'game.json');
    const gameConfig = JSON.parse(fs.readFileSync(gameJsonPath, 'utf8'));
    const subpackages = Array.isArray(gameConfig.subpackages) ? gameConfig.subpackages : [];
    const generatedBundleRoot = path.resolve(result.dest, 'assets', 'race');
    const generatedRaceRoot = 'subpackages/race/';
    const raceRoot = path.resolve(result.dest, generatedRaceRoot);
    const outputRoot = path.resolve(result.dest);
    for (const candidate of [generatedBundleRoot, raceRoot]) {
        if (!candidate.startsWith(`${outputRoot}${path.sep}`)) {
            throw new Error(`[wechat-race-subpackage] Refusing to modify path outside build output: ${candidate}`);
        }
    }

    // Creator 3.8.8 may emit the bundle under assets/race even though its
    // runtime loader resolves registered subpackages from subpackages/race.
    // Move instead of copy so the race resources do not remain in the main package.
    if (fs.existsSync(generatedBundleRoot)) {
        fs.mkdirSync(path.dirname(raceRoot), { recursive: true });
        fs.rmSync(raceRoot, { recursive: true, force: true });
        fs.renameSync(generatedBundleRoot, raceRoot);
    }
    if (!fs.existsSync(raceRoot)) {
        throw new Error(`[wechat-race-subpackage] Generated race Asset Bundle root does not exist: ${generatedRaceRoot}`);
    }

    gameConfig.subpackages = [
        { name: 'race', root: generatedRaceRoot },
        ...subpackages.filter((subpackage) => subpackage.name !== 'race'),
    ];
    fs.writeFileSync(gameJsonPath, `${JSON.stringify(gameConfig, null, 4)}\n`, 'utf8');

    for (const requiredFile of ['config.json', 'index.js']) {
        if (!fs.existsSync(path.join(raceRoot, requiredFile))) {
            throw new Error(`[wechat-race-subpackage] race Bundle is missing ${requiredFile}`);
        }
    }
    const raceGameEntryPath = path.join(raceRoot, 'game.js');
    fs.writeFileSync(raceGameEntryPath, RACE_GAME_ENTRY, 'utf8');

    const verifiedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const verifiedGameConfig = JSON.parse(fs.readFileSync(gameJsonPath, 'utf8'));
    const settingsReady = verifiedSettings?.assets?.subpackages?.includes('race');
    const manifestReady = verifiedGameConfig.subpackages?.some(
        (subpackage) => subpackage.name === 'race' && subpackage.root === generatedRaceRoot,
    );
    const bundleMovedOutOfMain = !fs.existsSync(generatedBundleRoot);
    const entryReady = fs.readFileSync(raceGameEntryPath, 'utf8') === RACE_GAME_ENTRY;
    if (!settingsReady || !manifestReady || !bundleMovedOutOfMain || !entryReady) {
        throw new Error('[wechat-race-subpackage] race subpackage verification failed after generation.');
    }
    console.log(`[wechat-race-subpackage] generated and verified race subpackage at ${generatedRaceRoot}`);
};
