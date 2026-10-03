'use strict';
// 已发布规则 2 的不可变规则快照，只用于旧入口和旧赛事结算。
const { executeCareer } = require('./compat/v2/rules/progression/CareerRules');
const { coinCostForLevel } = require('./compat/v2/rules/progression/ProgressionBalance');
module.exports = { version: 2, executeCareer, coinCostForLevel };
