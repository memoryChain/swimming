'use strict';
const cloud = require('wx-server-sdk');
const cloudbase = require('@cloudbase/node-sdk');
const { createService } = require('./service.cjs');
const { scopeDatabase } = require('./deployment.cjs');
const deployment = require('./deployment-target.json');
const legacyRules = require('./legacy-rules.cjs');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const webApp = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const service = createService({ db: scopeDatabase(cloud.database({ throwOnNotFound: false }), deployment.collectionPrefix),
    appId: process.env.WECHAT_APP_ID, legacyRules, allowLegacyClients: deployment.compatibility === true,
    adminPlayerIds: (process.env.ADMIN_PLAYER_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
    adminWebUserIds: (process.env.ADMIN_WEB_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean) });
exports.main = event => {
    const context = cloud.getWXContext();
    // 小游戏保持原有鉴权；Web SDK 身份来自受信调用上下文。
    const identity = context.APPID && context.OPENID ? {} : webApp.auth().getUserInfo();
    return service.admin(event, context, { uid: identity.uid });
};
