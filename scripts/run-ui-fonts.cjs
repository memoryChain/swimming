// 固定工具安装到项目隔离环境，避免依赖设计师电脑的系统字体或 Python 包。
const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const venv = path.join(root, '.cache', 'ui-font-venv');
const python = path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python3');
function run(command, args) {
    const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}
if (process.argv[2] === 'setup') {
    const source = process.env.UI_FONT_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    if (!existsSync(python)) {
        run(source, ['-c', 'import sys; assert sys.version_info >= (3, 10), "需要 Python 3.10 或更新版本，可用 UI_FONT_PYTHON 指定解释器"']);
        run(source, ['-m', 'venv', venv]);
    }
    run(python, ['-m', 'pip', 'install', 'fonttools==4.64.0']);
} else if (process.argv[2] === 'build') {
    if (!existsSync(python)) throw new Error('请先运行 pnpm fonts:setup');
    run(python, ['scripts/build-ui-fonts.py']);
} else throw new Error('用法：node scripts/run-ui-fonts.cjs setup|build');
