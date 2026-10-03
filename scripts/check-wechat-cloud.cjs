'use strict';
const path = require('node:path');
const { ROOT, readTarget, assertClientConfig, assertClientRelease } = require('./wechat-cloud-target.cjs');
const [target, output] = process.argv.slice(2);
if (process.argv.length > 4) throw Error('用法：pnpm cloud:check [development|production] [微信构建目录]');
const info = readTarget(target);
const result = output ? assertClientRelease(ROOT, path.resolve(ROOT, output), info.target) : assertClientConfig(ROOT, info.target);
console.log(JSON.stringify(result, null, 2));
