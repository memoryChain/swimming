'use strict';
// 在 game.js 第一行执行；只保留复访判定字段，不缓存 query、登录凭证或用户资料。
(function () {
    var root = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;
    if (root.__swimmingDouyinLaunch || typeof tt === 'undefined') return;
    var listeners = [];
    var bridge = {
        startedAt: Date.now(), latest: {}, sequence: 0,
        subscribe: function (callback) {
            listeners.push(callback);
            return function () {
                var index = listeners.indexOf(callback);
                if (index >= 0) listeners.splice(index, 1);
            };
        }
    };
    function sanitize(info) {
        info = info || {};
        return { scene: String(info.scene || ''), launch_from: info.launch_from,
            location: info.location, showFrom: info.showFrom };
    }
    root.__swimmingDouyinLaunch = bridge;
    // 原生适配前后全局对象可能不同，两个入口指向同一份记录。
    globalThis.__swimmingDouyinLaunch = bridge;
    try {
        if (typeof tt.onShow === 'function') tt.onShow(function (info) {
            bridge.latest = sanitize(info);
            bridge.sequence += 1;
            listeners.slice().forEach(function (callback) {
                try { callback(bridge.latest, bridge.sequence); } catch (_) {}
            });
        });
        // 监听注册必须先于同步获取；后者仅作为没有初始回调时的冷启动兜底。
        if (bridge.sequence === 0 && typeof tt.getLaunchOptionsSync === 'function') {
            bridge.latest = sanitize(tt.getLaunchOptionsSync());
        }
    } catch (_) {}
})();
