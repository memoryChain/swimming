'use strict';
// 在 Creator 重新构建后运行；拒绝把不含新功能的旧包当成平台接入测试版。
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'build/bytedance-mini-game');
function scripts(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? scripts(file) : entry.name.endsWith('.js') ? [file] : [];
    });
}
const code = scripts(source).map(file => fs.readFileSync(file, 'utf8')).join('\n');
for (const token of ['SidebarReturnPanel', 'douyin-platform-test-2', 'time_ms', 'sidebar_jump_result', 'race_start']) {
    if (!code.includes(token)) throw new Error('新功能尚未编进抖音包，请先在 Cocos 当前抖音构建任务点击“构建”。缺少：' + token);
}
const python = process.env.UI_FONT_PYTHON || path.join(root, '.cache/ui-font-venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python3');
if (!fs.existsSync(python)) throw new Error('缺少项目 Python 环境，请先运行 fonts:setup。');
const output = process.argv[2] || 'build/douyin-platform-preview';
const result = spawnSync(python, ['scripts/prepare-douyin-local-preview.py', '--output', output],
    { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const check = spawnSync(process.execPath, ['scripts/check-douyin-local-preview.cjs', output],
    { cwd: root, stdio: 'inherit', windowsHide: true });
if (check.error) throw check.error;
process.exit(check.status ?? 1);
