'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Creator 场景中的脚本类 ID：保留前五位，其余每三个十六进制位压成两个 Base64 字符。
function scriptClassId(uuid) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
        throw new Error('[startup-entry] 启动脚本 UUID 无效。');
    }
    const hex = uuid.replace(/-/g, '').toLowerCase(), alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = hex.slice(0, 5);
    for (let i = 5; i < 32; i += 3) {
        const value = parseInt(hex.slice(i, i + 3), 16);
        result += alphabet[value >> 6] + alphabet[value & 63];
    }
    return result;
}

function assertStartupSceneEntry(projectRoot) {
    const script = 'assets/startup/StartupManager.ts';
    const { uuid } = JSON.parse(fs.readFileSync(path.join(projectRoot, `${script}.meta`), 'utf8'));
    const classId = scriptClassId(uuid);
    const owners = new Map();
    function visit(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(file);
            else if (entry.isFile() && entry.name.endsWith('.ts.meta')) {
                const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
                const owner = owners.get(meta.uuid);
                if (owner) throw new Error(`[startup-entry] 脚本 UUID 冲突：${owner} 与 ${file}`);
                owners.set(meta.uuid, file);
            }
        }
    }
    visit(path.join(projectRoot, 'assets'));
    const scene = JSON.parse(fs.readFileSync(path.join(projectRoot, 'assets/scenes/Login.scene'), 'utf8'));
    const canvasIndex = scene.findIndex(item => item.__type__ === 'cc.Node' && item._name === 'Canvas');
    const components = (scene[canvasIndex]?._components || []).map(ref => scene[ref.__id__]);
    const scripts = components.filter(item => item && !item.__type__.startsWith('cc.'));
    if (!fs.existsSync(path.join(projectRoot, script)) || scripts.length !== 1 || scripts[0].__type__ !== classId
        || scripts[0]._enabled !== true || scripts[0].node?.__id__ !== canvasIndex) {
        throw new Error(`[startup-entry] Login.scene 的 Canvas 必须绑定当前 StartupManager（${classId}），不能沿用旧脚本 UUID。`);
    }
    return { uuid, classId };
}

// 读取现有 Creator 导入产物，不启动编辑器；确认其实际注册 ID 与场景一致。
function assertStartupPreviewEntry(projectRoot, target = 'preview') {
    const entry = assertStartupSceneEntry(projectRoot);
    const directory = path.join(projectRoot, 'temp/programming/packer-driver/targets', target);
    const imports = JSON.parse(fs.readFileSync(path.join(directory, 'import-map.json'), 'utf8')).imports;
    const modulePath = imports[pathToFileURL(path.join(projectRoot, 'assets/startup/StartupManager.ts')).href];
    if (!modulePath) throw new Error('[startup-entry] Creator 尚未编译 StartupManager。');
    const code = fs.readFileSync(path.resolve(directory, modulePath), 'utf8');
    const registered = /_RF\.push\(\s*\{\},\s*["']([^"']+)["'],\s*["']StartupManager["']/.exec(code)?.[1];
    if (registered !== entry.classId) throw new Error('[startup-entry] Creator 预览产物中的脚本注册 ID 与场景不一致。');
    return entry;
}

// 检查实际模块定义位置，不能仅凭 game.json 声明就认定完成代码分包。
function assertStartupCodeOutput(outputRoot) {
    const locations = new Map();
    let mainJsBytes = 0, gameplayJsBytes = 0;
    function visit(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) { visit(file); continue; }
            if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
            const relative = path.relative(outputRoot, file).split(path.sep).join('/');
            const code = fs.readFileSync(file, 'utf8');
            if (relative.startsWith('subpackages/gameplay/')) gameplayJsBytes += Buffer.byteLength(code);
            else if (!relative.startsWith('subpackages/')) mainJsBytes += Buffer.byteLength(code);
            for (const match of code.matchAll(/System\.register\s*\(\s*["']chunks:\/\/\/_virtual\/([^"']+)["']/g)) {
                const files = locations.get(match[1]) || [];
                files.push(relative);
                locations.set(match[1], files);
            }
        }
    }
    visit(outputRoot);
    for (const name of ['LoginManager.ts', 'GameManager.ts', 'PrepareRaceFlow.ts', 'RoomFlow.ts']) {
        const files = locations.get(name);
        if (!files?.length || files.some(file => !file.startsWith('subpackages/gameplay/'))) {
            throw new Error(`[startup-code] ${name} 必须只存在于 gameplay 分包，请确认扩展已刷新并重新构建。`);
        }
    }
    for (const name of ['StartupManager.ts', 'StartupView.ts', 'DeferredCodeLoader.ts']) {
        const files = locations.get(name);
        if (!files?.length || files.some(file => file.startsWith('subpackages/'))) {
            throw new Error(`[startup-code] 主包缺少独立首屏模块 ${name}，请重新构建。`);
        }
    }
    const settings = JSON.parse(fs.readFileSync(path.join(outputRoot, 'src/settings.json'), 'utf8'));
    if (settings.assets?.preloadBundles?.some(entry => {
        const name = typeof entry === 'string' ? entry : entry.bundle;
        return name === 'gameplay' || name === 'race';
    })) {
        throw new Error('[startup-code] gameplay/race 不能配置为启动预加载包。');
    }
    return { mainJsBytes, gameplayJsBytes };
}

module.exports = { assertStartupCodeOutput, assertStartupSceneEntry, assertStartupPreviewEntry };
