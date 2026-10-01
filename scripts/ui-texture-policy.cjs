'use strict';
// 日常维护仍使用原纹理命令，顺序完成压缩策略与静态图集策略。
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const mode = process.argv.includes('--fix') ? '--fix' : '--check';
for (const file of ['extensions/wechat-race-subpackage/texture-compression-policy.js', 'scripts/ui-atlas-policy.cjs']) {
    const result = spawnSync(process.execPath, [path.join(root, file), mode], { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = 1;
}
