'use strict';

// 仅用于开发包：入口事件触发有限采样，不加入比赛帧循环。
var installed = false;
var entries = 0;
var knownFamilies = {};
var records = 0;
function log(stage, data) {
    if (records++ >= 24) return;
    console.log('[TapFont] ' + stage + ' ' + JSON.stringify(data));
}
function pageOf(node) {
    while (node) {
        if (node.name === 'CareerEventPage') return node;
        node = node.parent;
    }
    return null;
}
function canvasPixels(label) {
    try {
        var data = label.assemblerData;
        var canvas = data && data.canvas;
        var context = data && data.context;
        if (!canvas || !context || typeof context.getImageData !== 'function') return 'unavailable';
        var width = canvas.width, height = canvas.height;
        if (!width || !height || width * height > 512000) return 'skipped';
        var pixels = context.getImageData(0, 0, width, height).data;
        var visible = 0;
        for (var i = 3; i < pixels.length; i += 4) if (pixels[i]) visible++;
        return { width: width, height: height, nonTransparent: visible };
    } catch (error) { return String(error); }
}
function snapshot(root, entry, delay, cc) {
    if (!root.isValid || !root.activeInHierarchy) return;
    var labels = [];
    function visit(node) {
        if (!node.activeInHierarchy) return;
        var label = node.getComponent(cc.Label);
        // 固定 8 个可见文字样本，避免打印整页及玩家个人信息。
        if (label && labels.length < 8 && label.string) {
            var transform = node.getComponent(cc.UITransform);
            var frame = label.ttfSpriteFrame;
            var texture = frame && frame.texture;
            var gpu = texture && texture.getGFXTexture && texture.getGFXTexture();
            var font = label.font;
            labels.push({ node: node.name, textLength: label.string.length,
                system: label.useSystemFont, nativeFamily: font && font._nativeAsset,
                size: transform && { width: transform.width, height: transform.height },
                fontSize: label.fontSize, actualFontSize: label.actualFontSize,
                cacheMode: label.cacheMode, renderData: !!label.renderData,
                texture: texture && { width: texture.width, height: texture.height, gpu: !!gpu },
                canvas: labels.length < 2 ? canvasPixels(label) : 'not-sampled' });
        }
        for (var i = 0; i < node.children.length; i++) visit(node.children[i]);
    }
    visit(root);
    log('page', { entry: entry, delayMs: delay, labels: labels });
}
exports.install = function (cc) {
    if (installed) return;
    installed = true;
    log('installed', { version: '0.0.4' });
    var adapter = typeof window !== 'undefined' && window.__globalAdapter;
    if (adapter && typeof adapter.loadFont === 'function') {
        var load = adapter.loadFont;
        adapter.loadFont = function (url) {
            var family = load.apply(this, arguments);
            log('native-load', { file: String(url).split('/').pop(), resultType: typeof family, family: family });
            return family;
        };
    }
    var descriptor = Object.getOwnPropertyDescriptor(cc.Label.prototype, 'font');
    if (descriptor && descriptor.set && descriptor.configurable) {
        Object.defineProperty(cc.Label.prototype, 'font', {
            configurable: descriptor.configurable, enumerable: descriptor.enumerable, get: descriptor.get,
            set: function (value) {
                descriptor.set.call(this, value);
                if (value && !knownFamilies[value._nativeAsset]) {
                    knownFamilies[value._nativeAsset] = true;
                    log('assigned', { family: value._nativeAsset, system: this.useSystemFont });
                }
            }
        });
    }
    var enable = cc.Label.prototype.onEnable;
    cc.Label.prototype.onEnable = function () {
        var result = enable.apply(this, arguments);
        if (this.node.name !== 'PageTitle' || entries >= 3) return result;
        var page = pageOf(this.node);
        if (!page) return result;
        var entry = ++entries;
        log('entered', { entry: entry });
        [500, 3000, 12000].forEach(function (delay) {
            setTimeout(function () { snapshot(page, entry, delay, cc); }, delay);
        });
        return result;
    };
};
