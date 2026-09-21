'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assertWechatProjectOutput } = require('../extensions/wechat-race-subpackage/wechat-project-config');
const { assertBuiltMotionRuntime, compactBuiltMotions, assertBuiltMotionStorage } = require('../extensions/wechat-race-subpackage/sampled-motion-storage');
const { auditWechatPackageOutput } = require('../extensions/wechat-race-subpackage/wechat-package-budget');

const projectRoot = path.resolve(__dirname, '..');
try {
    const args = process.argv.slice(2);
    if (args.length > 1 || args[0]?.startsWith('-')) {
        throw new Error('用法：pnpm wechat:finalize [构建目录]');
    }
    const outputRoot = path.resolve(projectRoot, args[0] || 'build/wechatgame');
    // 仅接受项目内已有的独立构建目录，不改动 assets、源动作或其他工程。
    const relative = path.relative(projectRoot, outputRoot);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
        || relative.split(path.sep)[0] === 'assets') {
        throw new Error('构建目录必须位于当前工程内，且不能是工程根目录或 assets。');
    }
    assertWechatProjectOutput(outputRoot);
    assertBuiltMotionRuntime(outputRoot);
    const preview = compactBuiltMotions(projectRoot, outputRoot, { checkOnly: true });
    let backupRoot;
    if (preview.files) {
        const backupParent = path.join(projectRoot, 'temp', 'wechat-finalize-backups');
        fs.mkdirSync(backupParent, { recursive: true });
        backupRoot = fs.mkdtempSync(path.join(backupParent, 'before-'));
    }
    const motions = compactBuiltMotions(projectRoot, outputRoot, { backupRoot });
    assertBuiltMotionStorage(projectRoot, outputRoot);
    const budget = auditWechatPackageOutput(outputRoot);
    console.log(`[wechat-finalize] 已核验 ${motions.motions} 个动作；本次修改 ${motions.files} 个文件，无损减少 ${(motions.savedBytes / 1024).toFixed(1)} KiB。`);
    if (backupRoot) console.log(`[wechat-finalize] 原构建数据备份：${path.relative(projectRoot, backupRoot)}。`);
    console.log(`[wechat-finalize] 主包 ${(budget.mainBytes / 1024).toFixed(1)} / 4096 KiB；总包 ${(budget.totalBytes / 1024).toFixed(1)} / 30720 KiB，余量 ${(budget.remainingBytes / 1024).toFixed(1)} KiB。`);
    console.log('[wechat-finalize] 后处理和包体检查完成；此命令不会上传或发布。');
} catch (error) {
    console.error(`[wechat-finalize] ${error.message}`);
    process.exitCode = 1;
}
