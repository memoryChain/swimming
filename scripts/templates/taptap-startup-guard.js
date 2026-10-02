'use strict';

// 开发包启动保护：只记录阶段和错误，不读取账号或存档，不参与比赛帧循环。
exports.create = function (root, options) {
    options = options || {};
    var clock = options.now || Date.now;
    var schedule = options.schedule || setTimeout, cancel = options.cancel || clearTimeout;
    var output = options.log || function (line) { console.log(line); };
    var phase = 'entry', started = clock(), sequence = 0, records = 0, warnings = 0;
    var closed = false, hidden = false, timer = null, cleanups = [], attached = false;
    function log(name, data) {
        if (records++ >= 80) return;
        try { output('[TapBoot] ' + name + ' ' + JSON.stringify(data)); } catch (_) { /* 日志失败不阻断启动。 */ }
    }
    function errorInfo(error) {
        try { return { message: String(error && (error.message || error.errMsg) || error).slice(0, 500),
            stack: error && error.stack ? String(error.stack).slice(0, 1800) : '' }; }
        catch (_) { return { message: 'error_unreadable', stack: '' }; }
    }
    function clear() { if (timer !== null) { try { cancel(timer); } catch (_) {} timer = null; } }
    function watch() {
        clear();
        if (closed || hidden || warnings >= 2) return;
        timer = schedule(function () {
            timer = null;
            if (closed || hidden) return;
            warnings++;
            log('waiting', { phase: phase, foreground_ms: Math.max(0, clock() - started), notice: warnings });
            watch();
        }, warnings ? 30000 : 15000);
    }
    function mark(name) {
        if (closed) return;
        phase = name; started = clock(); sequence++;
        log('begin', { phase: name }); watch();
    }
    function cleanup() {
        clear();
        for (var i = cleanups.length - 1; i >= 0; i--) { try { cleanups[i](); } catch (_) {} }
        cleanups.length = 0;
    }
    function failed(error, source) {
        log('failed', { phase: phase, source: source || 'startup', error: errorInfo(error) });
        closed = true; cleanup();
    }
    function subscribe(api, on, off, listener) {
        try {
            // 没有取消订阅能力时不添加监听，避免将启动诊断留到比赛中。
            if (typeof api[on] !== 'function' || typeof api[off] !== 'function') return;
            api[on](listener); cleanups.push(function () { api[off](listener); });
        } catch (_) { log('listener-unavailable', { api: on }); }
    }
    var guard = {
        mark: mark, failed: failed,
        note: function (name, data) { if (!closed) log(name, data); },
        status: function () { return { phase: phase, closed: closed, hidden: hidden, warnings: warnings }; },
        complete: function (name) {
            if (closed) return;
            log('ready', { phase: name || 'lobby-ready', version: options.version });
            closed = true; cleanup();
        },
        step: function (name, operation) {
            if (closed) return operation();
            mark(name);
            var begin = clock(), id = sequence, result;
            function done(value) {
                if (!closed) {
                    log('done', { phase: name, elapsed_ms: Math.max(0, clock() - begin) });
                    if (id === sequence) { phase = name + ':done'; started = clock(); }
                }
                return value;
            }
            try {
                result = operation();
                if (result && typeof result.then === 'function') return result.then(done, function (error) {
                    failed(error, name); throw error;
                });
                return done(result);
            } catch (error) { failed(error, name); throw error; }
        },
        auxiliary: function (name, operation, fallback) {
            try { return operation(); }
            catch (error) { log('auxiliary-disabled', { module: name, error: errorInfo(error) }); return fallback; }
        },
        attachHost: function (api) {
            if (attached || !api) return;
            attached = true;
            subscribe(api, 'onError', 'offError', function (error) { failed(error, 'host-error'); });
            subscribe(api, 'onUnhandledRejection', 'offUnhandledRejection', function (event) {
                // reason 可能带业务数据，仅保留 Error 的 message/stack，不序列化整对象。
                failed(event && event.reason instanceof Error ? event.reason : 'unhandled_rejection', 'host-rejection');
            });
            subscribe(api, 'onHide', 'offHide', function () { hidden = true; clear(); log('background', { phase: phase }); });
            subscribe(api, 'onShow', 'offShow', function () {
                if (!hidden || closed) return;
                hidden = false; started = clock(); log('foreground', { phase: phase }); watch();
            });
        },
        attachEngine: function (cc) {
            function wrap(owner, name, stage) {
                if (!owner || typeof owner[name] !== 'function') return;
                var original = owner[name];
                var wrapped = function () {
                    var self = this, args = arguments;
                    return guard.step(stage, function () { return original.apply(self, args); });
                };
                owner[name] = wrapped;
                cleanups.push(function () { if (owner[name] === wrapped) owner[name] = original; });
            }
            wrap(cc.game, 'init', 'engine-init'); wrap(cc.game, 'run', 'engine-run');
            var director = cc.director, event = cc.Director && cc.Director.EVENT_AFTER_SCENE_LAUNCH;
            if (director && event && typeof director.on === 'function' && typeof director.off === 'function') {
                var listener = function () { guard.mark('scene-launched-awaiting-ui'); };
                director.on(event, listener); cleanups.push(function () { director.off(event, listener); });
            }
            var manager = cc.assetManager;
            if (manager && typeof manager.loadBundle === 'function') {
                var originalLoad = manager.loadBundle, loads = 0;
                var wrappedLoad = function () {
                    if (closed || loads++ >= 8) return originalLoad.apply(this, arguments);
                    var args = Array.prototype.slice.call(arguments), name = String(args[0]).split('/').pop().slice(0, 60);
                    var index = args.length - 1, callback = args[index], begin = clock();
                    log('bundle-begin', { bundle: name });
                    if (typeof callback === 'function') args[index] = function (error) {
                        if (!closed) log('bundle-result', { bundle: name, elapsed_ms: clock() - begin,
                            result: error ? 'failed' : 'loaded', error: error ? errorInfo(error) : null });
                        return callback.apply(this, arguments);
                    };
                    return originalLoad.apply(this, args);
                };
                manager.loadBundle = wrappedLoad;
                cleanups.push(function () { if (manager.loadBundle === wrappedLoad) manager.loadBundle = originalLoad; });
            }
        },
    };
    log('package', { version: options.version, signature: options.signature });
    root.__swimmingTapStartup = guard;
    watch();
    return guard;
};

exports.noopEvents = function (guard) {
    function identity(value) { return value; }
    return { wrapFlow: identity, wrapManager: identity, attachFlow: identity,
        lobbyReady: function () { guard.complete('lobby-ready-events-disabled'); },
        record: function () {}, flush: function () {}, dump: function () { return []; },
        status: function () { return { mode: 'disabled', pending: 0, recorded: 0 }; } };
};
