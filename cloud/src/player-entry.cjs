'use strict';
const cloud = require('wx-server-sdk');
const { createService } = require('./service.cjs');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const service = createService({ db: cloud.database({ throwOnNotFound: false }), appId: process.env.WECHAT_APP_ID });
exports.main = event => service.player(event, cloud.getWXContext());
