'use strict';
// 生成可审阅的管理请求，不联网、不持有密钥、不自动修改玩家。
const fs = require('node:fs');
const crypto = require('node:crypto');
const { readTarget } = require('./wechat-cloud-target.cjs');
const [file, target] = process.argv.slice(2);
if (!file || process.argv.length > 4) throw Error('用法：pnpm cloud:admin <管理操作JSON文件> [development|production]');
const info = readTarget(target);
const input = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!['inspect', 'coins', 'level', 'clearPending', 'restore'].includes(input.action)) throw Error('管理操作无效');
if (!/^[a-f0-9]{64}$/.test(input.data?.playerId || '')) throw Error('玩家 ID 无效');
if (input.action !== 'inspect' && (!Number.isSafeInteger(input.expectedRevision) || !input.data.reason)) {
    throw Error('修改必须携带从云端读取的版本号和原因');
}
const request = { ...input, protocol: info.protocol, rulesVersion: info.rulesVersion,
    writerId: 'admin-console', requestId: input.requestId || crypto.randomUUID() };
const output = file + '.request.json';
// 为同一操作保存固定 ID；命令再次执行不允许无意换一个新 ID 重复补偿。
if (fs.existsSync(output)) throw Error(`已存在 ${output}，请使用其中原请求重试；新操作请使用新的文件名`);
fs.writeFileSync(output, JSON.stringify(request, null, 2) + '\n', { flag: 'wx' });
console.log(`请求已生成：${output}\n目标：${info.target} / ${info.environmentId} / ${info.adminFunctionName} / 集合前缀 ${info.collectionPrefix || '正式原集合'}\n请核对目标、原因和数值，再在有管理权限账号的微信开发者工具小游戏控制台执行：\n`);
console.log(`wx.cloud.callFunction({name:${JSON.stringify(info.adminFunctionName)},config:{env:${JSON.stringify(info.environmentId)}},data:${JSON.stringify(request)}}).then(res => console.log(res.result))`);
