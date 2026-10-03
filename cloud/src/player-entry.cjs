'use strict';
const cloud = require('wx-server-sdk');
const { createService } = require('./service.cjs');
const { scopeDatabase } = require('./deployment.cjs');
const deployment = require('./deployment-target.json');
const legacyRules = require('./legacy-rules.cjs');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const service = createService({ db: scopeDatabase(cloud.database({ throwOnNotFound: false }), deployment.collectionPrefix),
    appId: process.env.WECHAT_APP_ID, legacyRules, allowLegacyClients: deployment.compatibility === true });
exports.main = event => service.player(event, cloud.getWXContext());
