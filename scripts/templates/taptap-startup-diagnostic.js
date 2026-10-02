'use strict';

// 仅用于开发包启动诊断；不读取账号、密钥或存档，不加入赛中更新。
var signature = '__DIAGNOSTIC_SIGNATURE__';
var wrapped = false;
var records = 0;
function log(stage, state) {
    if (records++ >= 16) return;
    console.log('[TapStartup] ' + stage + ' ' + JSON.stringify(state));
}
log('package', { signature: signature, version: '0.0.3' });

exports.ready = function (cc, stage) {
    var legacy = cc.cclegacy || {};
    log(stage, {
        signature: signature,
        engine: cc.ENGINE_VERSION,
        exportedWebgl: typeof cc.WebGLDevice,
        legacyWebgl: typeof legacy.WebGLDevice,
        legacyWebgl2: typeof legacy.WebGL2Device,
        globalLegacyMatches: typeof window !== 'undefined' && window.cc === legacy,
        manager: typeof (cc.gfx && cc.gfx.DeviceManager)
    });
    if (wrapped || !cc.gfx || !cc.gfx.DeviceManager) return;
    wrapped = true;
    var prototype = cc.gfx.DeviceManager.prototype;
    var originalInit = prototype.init;
    prototype.init = function () {
        log('device-init', { webgl: typeof legacy.WebGLDevice, webgl2: typeof legacy.WebGL2Device });
        try {
            return originalInit.apply(this, arguments);
        } catch (error) {
            log('device-failed', { message: String(error), device: typeof this._gfxDevice, initialized: this._deviceInitialized, renderType: this._renderType });
            throw error;
        }
    };
    var originalTry = prototype._tryInitializeDeviceSync;
    if (typeof originalTry === 'function') prototype._tryInitializeDeviceSync = function (constructor, info) {
        log('backend-enter', { constructor: typeof constructor, initialized: this._deviceInitialized });
        var result = originalTry.call(this, constructor, info);
        log('backend-result', { result: result, device: typeof this._gfxDevice });
        return result;
    };
};
exports.failed = function (error) {
    log('startup-failed', { signature: signature, message: String(error), stack: error && error.stack });
};
