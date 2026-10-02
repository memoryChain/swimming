'use strict';

// 开发包恢复诊断：只观察生命周期边沿与每次两秒窗口，不调用 pause/resume，不创建渲染上下文。
exports.create = function (options) {
    options = options || {};
    var now = options.now || Date.now, schedule = options.schedule || setTimeout;
    var cancel = options.cancel || clearTimeout, output = options.log || console.log;
    var started = now(), records = [], cleanups = [], cc = null, host = null;
    var stopped = false, count = 0, windows = 0, generation = 0, timer = null, frame = null, draw = null;
    var hidden = false, hideAt = null, seenRaf = false, seenDraw = false;
    function safe(fn) { try { return fn(); } catch (_) { return null; } }
    function emit(name, data) {
        if (stopped || count >= 100) return;
        var row = { seq: ++count, timestamp_ms: now(), since_entry_ms: now() - started,
            version: options.version || 'unknown', name: name, data: data || {} };
        records.push(row); if (records.length > 80) records.shift();
        safe(function () { output('[TapLife] ' + JSON.stringify(row)); });
    }
    function state() {
        return { engine_attached: !!cc,
            game_paused: safe(function () { return cc.game.isPaused(); }),
            director_paused: safe(function () { return cc.director.isPaused(); }),
            scene: safe(function () { return cc.director.getScene().name; }),
            context_lost: safe(function () { return cc.director.root.device.gl.isContextLost(); }),
            canvas: safe(function () { var c = options.canvas(); return { width: c.width, height: c.height }; }) };
    }
    function stopWindow() {
        generation++;
        if (timer !== null) { safe(function () { cancel(timer); }); timer = null; }
        if (frame !== null && options.cancelFrame) safe(function () { options.cancelFrame(frame); });
        frame = null;
        if (draw && cc) safe(function () { cc.director.off(cc.Director.EVENT_AFTER_DRAW, draw); });
        draw = null;
    }
    function probe(reason) {
        stopWindow();
        if (stopped || hidden || windows >= 8) return;
        windows++; seenRaf = false; seenDraw = false;
        var token = generation, at = now();
        emit('probe_begin', { reason: reason, state: state() });
        if (options.requestFrame) safe(function () {
            frame = options.requestFrame(function () {
                if (stopped || token !== generation) return;
                frame = null; seenRaf = true;
                emit('host_frame', { reason: reason, elapsed_ms: now() - at });
            });
        });
        if (cc && cc.Director && cc.Director.EVENT_AFTER_DRAW) safe(function () {
            draw = function () {
                if (stopped || token !== generation) return;
                cc.director.off(cc.Director.EVENT_AFTER_DRAW, draw); draw = null; seenDraw = true;
                emit('engine_draw', { reason: reason, elapsed_ms: now() - at });
            };
            cc.director.on(cc.Director.EVENT_AFTER_DRAW, draw);
        });
        timer = schedule(function () {
            timer = null;
            if (stopped || token !== generation) return;
            emit('probe_result', { reason: reason, elapsed_ms: now() - at,
                host_frame_seen: seenRaf, engine_draw_seen: seenDraw, state: state() });
            stopWindow();
        }, 2000);
    }
    function subscribe(owner, on, off, fn) {
        if (!owner || typeof owner[on] !== 'function' || typeof owner[off] !== 'function') return false;
        owner[on](fn); cleanups.push(function () { owner[off](fn); }); return true;
    }
    var api = {
        attachHost: function (value) {
            if (host || !value || stopped) return;
            host = value;
            var hides = safe(function () { return subscribe(host, 'onHide', 'offHide', function () {
                if (stopped) return; hidden = true; hideAt = now(); stopWindow(); emit('host_hide', { state: state() });
            }); });
            var shows = safe(function () { return subscribe(host, 'onShow', 'offShow', function () {
                if (stopped) return; hidden = false;
                emit('host_show', { background_ms: hideAt === null ? null : now() - hideAt, state: state() });
                hideAt = null; probe('host_show');
            }); });
            emit('host_attached', { on_show: !!shows, on_hide: !!hides });
        },
        attachEngine: function (value) {
            if (cc || !value || stopped) return;
            cc = value;
            ['EVENT_HIDE', 'EVENT_SHOW', 'EVENT_PAUSE', 'EVENT_RESUME'].forEach(function (key) {
                safe(function () {
                    var event = cc.Game[key]; if (!event) return;
                    var listener = function () { if (!stopped) emit('engine_' + key.toLowerCase(), { state: state() }); };
                    cc.game.on(event, listener); cleanups.push(function () { cc.game.off(event, listener); });
                });
            });
            emit('engine_attached', { state: state() });
            probe('engine_attach');
        },
        reentry: function () { emit('entry_reused', { state: state() }); probe('entry_reused'); },
        dump: function () { return { version: options.version, observed_from: 'game_entry', records: records.slice() }; },
        dispose: function () {
            if (stopped) return; stopWindow(); stopped = true;
            for (var i = cleanups.length - 1; i >= 0; i--) safe(cleanups[i]);
            cleanups.length = 0;
        }
    };
    emit('entry', { observation_boundary: 'game_entry' });
    return api;
};

exports.install = function (root, config) {
    if (root.__swimmingTapLife) { root.__swimmingTapLife.reentry(); return root.__swimmingTapLife; }
    var frames = typeof GameGlobal !== 'undefined' ? GameGlobal : root;
    var observer = exports.create({ version: config.version,
        canvas: function () { return root.canvas || frames.canvas || frames.screencanvas; },
        requestFrame: typeof frames.requestAnimationFrame === 'function' ? frames.requestAnimationFrame.bind(frames) : null,
        cancelFrame: typeof frames.cancelAnimationFrame === 'function' ? frames.cancelAnimationFrame.bind(frames) : null });
    root.__swimmingTapLife = observer;
    return observer;
};
