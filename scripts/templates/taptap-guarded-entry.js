var bootModule = require('./tap-startup-guard');
var boot = bootModule.create(globalThis, { version: '__VERSION__', signature: '__SIGNATURE__' });
var tapStartupDiagnostic = boot.auxiliary('render-diagnostic', function () {
  return require('./tap-startup-diagnostic');
}, { ready: function () {}, failed: function () {} });
globalThis.__swimmingTapEvents = bootModule.noopEvents(boot);

function initializeGame() {
  return boot.step('adapter-import', function () { return require('./web-adapter'); });
}
function __initApp() {
  try {
    globalThis.__wxRequire = require;
    initializeGame();
    boot.attachHost(typeof tap !== 'undefined' ? tap : wx);
    var firstScreen = boot.step('first-screen-import', function () { return require('./first-screen'); });
    boot.step('polyfills', function () { require('src/polyfills.bundle.js'); });
    boot.step('systemjs', function () { require('src/system.bundle.js'); });
    boot.auxiliary('event-test', function () {
      // 初始化移至适配器与 polyfill 后；失败时已存在完整的无操作接口。
      var root = globalThis, fallback = root.__swimmingTapEvents;
      delete root.__swimmingTapEvents;
      try {
        return require('./tap-event-test').install(root, require('./tap-event-config.json'));
      } catch (error) { root.__swimmingTapEvents = fallback; throw error; }
    });
    var info = boot.step('screen-info', function () { return wx.getSystemInfoSync(); });
    if (canvas) {
      var width = canvas.width, height = canvas.height;
      if ((info.screenWidth < info.screenHeight && width > height)
          || (info.screenWidth >= info.screenHeight && width < height)) {
        var swap = width; width = height; height = swap;
      }
      canvas.width = width; canvas.height = height;
      if (window.devicePixelRatio >= 2) {
        canvas.width *= info.devicePixelRatio; canvas.height *= info.devicePixelRatio;
      }
      boot.note('canvas', { width: canvas.width, height: canvas.height, pixelRatio: info.devicePixelRatio });
    }
    boot.step('system-warmup', function () {
      System.warmup({ importMap: require('src/import-map.js')['default'], importMapUrl: 'src/import-map.js',
        defaultHandler: function (url) { require('.' + url); },
        handlers: { 'plugin:': function (url) { requirePlugin(url); }, 'project:': function (url) { require(url); } } });
    });
    boot.step('first-screen-start', function () { return firstScreen.start('default', 'default', 'false'); })
      .then(function () { return boot.step('application-import', function () { return System['import']('./application.js'); }); })
      .then(function (module) {
        return boot.step('progress-20', function () { return firstScreen.setProgress(0.2); })
          .then(function () { return new module.Application(); });
      }).then(function (application) {
        return boot.step('progress-40', function () { return firstScreen.setProgress(0.4); })
          .then(function () { return application; });
      }).then(function (application) {
        return boot.step('engine-import', function () { return System['import']('cc'); })
          .then(function (cc) {
            return boot.step('progress-60', function () { return firstScreen.setProgress(0.6); })
              .then(function () { return cc; });
          }).then(function (cc) {
            boot.auxiliary('render-diagnostic-before', function () { tapStartupDiagnostic.ready(cc, 'before-adapter'); });
            boot.auxiliary('font-diagnostic', function () { require('./tap-font-diagnostic').install(cc); });
            boot.step('engine-adapter', function () { require('./engine-adapter'); });
            boot.auxiliary('render-diagnostic-after', function () { tapStartupDiagnostic.ready(cc, 'after-adapter'); });
            boot.auxiliary('engine-diagnostic-hooks', function () { boot.attachEngine(cc); });
            return boot.step('application-init', function () { return application.init(cc); });
          }).then(function () {
            return boot.step('first-screen-end', function () { return firstScreen.end(); });
          }).then(function () {
            return boot.step('application-start', function () { return application.start(); });
          });
      }).then(function () { boot.mark('awaiting-lobby'); })
      ['catch'](function (error) { boot.failed(error, 'startup-chain'); console.error(error); });
  } catch (error) { boot.failed(error, 'init-app-sync'); throw error; }
}

try {
  boot.attachHost(typeof tap !== 'undefined' ? tap : wx);
  boot.step('converter-environment', function () {
    Error.stackTraceLimit = Infinity;
    // 保留官方转换器对 fetch 的要求；不伪造接口或忽略必要环境缺失。
    GameGlobal.oldFetch = GameGlobal.fetch;
    if (!GameGlobal.oldFetch) throw new Error('fetch is not defined');
    GameGlobal.fetch = undefined;
  });
  var sysInfo = boot.step('host-system-info', function () { return wx.getSystemInfoSync(); });
  if (sysInfo.platform.toLocaleLowerCase() === 'android') {
    boot.mark('android-first-frame');
    GameGlobal.requestAnimationFrame(__initApp);
  } else { __initApp(); }
} catch (error) { boot.failed(error, 'entry-sync'); throw error; }
