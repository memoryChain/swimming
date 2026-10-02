'use strict';

// 仅用于开发包。记录状态边沿和异步任务，不挂接 update，不改变玩法或同步。
// 游戏入口执行前的下载/宿主等待不在本模块可观测范围内。
exports.create = function (options) {
    options = options || {};
    var root = options.root || {}, now = options.now || Date.now;
    var schedule = options.schedule || setTimeout, cancel = options.cancel || clearTimeout;
    var output = options.log || function (line) { console.log(line); };
    var start = now(), version = options.version || 'unknown', session = 'timing-' + start;
    var records = [], active = [], completed = [], bootStages = [], cleanups = [], serial = 0, logs = 0, dropped = 0;
    var api = {}, engineAttached = false, hostAttached = false, busy = false, hidden = false;
    var watchTimer = null, saveTimer = null, watchStart = start, expected = start, samples = 0;
    var operations = 0, frames = 0, scene = 'unknown', phase = 'entry', disabled = false;
    var storageKey = 'swimming.tap.timing.v1';
    function safe(fn) { try { return fn(); } catch (_) {} }
    function clean(value) {
        return String(value || '').replace(/https?:\/\/\S+/g, '[url]')
            .replace(/[\r\n]+/g, ' ').slice(0, 120);
    }
    function emit(name, data) {
        if (disabled) return;
        var item = { seq: ++serial, timestamp_ms: now(), since_entry_ms: Math.max(0, now() - start),
            name: name, properties: data || {} };
        records.push(item);
        if (records.length > 180) { records.shift(); dropped++; }
        // 等待/异常与摘要不受普通任务日志额度影响，仍由采样和任务总数限制。
        if (logs++ < 100 || /waiting|failed|summary|ready|race_/.test(name)) {
            safe(function () { output('[TapTiming] ' + JSON.stringify(item)); });
        }
        return item;
    }
    function stopWatch() {
        if (watchTimer !== null) { safe(function () { cancel(watchTimer); }); watchTimer = null; }
    }
    function watch() {
        stopWatch();
        if (disabled || hidden || busy || samples >= 60) return;
        expected = now() + 2000;
        watchTimer = schedule(function () {
            watchTimer = null;
            if (disabled || hidden || busy) return;
            samples++;
            var lag = Math.max(0, now() - expected);
            if (lag >= 1000) emit('event_loop_waiting', { delay_ms: lag, phase: phase });
            if (samples === 5 || samples === 15 || samples === 30 || samples === 60) {
                emit('startup_waiting', { phase: phase, window_ms: now() - watchStart,
                    pending: active.length, frames_since_scene: frames });
                summary('waiting');
            }
            for (var i = 0; i < active.length; i++) {
                var task = active[i], elapsed = now() - task.started;
                if (!task.warned && elapsed >= 10000) {
                    task.warned = true;
                    emit('operation_waiting', { id: task.id, operation: task.operation, label: task.label, elapsed_ms: elapsed });
                }
            }
            watch();
        }, 2000);
    }
    function begin(operation, label) {
        if (disabled || operations++ >= 96 || active.length >= 24) return null;
        var task = { id: 'op-' + operations, operation: operation, label: clean(label), started: now(), warned: false };
        active.push(task);
        emit('operation_begin', { id: task.id, operation: operation, label: task.label });
        return task;
    }
    function end(task, error) {
        if (!task || task.ended) return;
        task.ended = true;
        var index = active.indexOf(task); if (index >= 0) active.splice(index, 1);
        var result = { id: task.id, operation: task.operation, label: task.label,
            elapsed_ms: Math.max(0, now() - task.started), result: error ? 'failed' : 'completed' };
        if (error) result.error = clean(error.message || error.errMsg || error);
        completed.push(result); if (completed.length > 96) completed.shift();
        emit(error ? 'operation_failed' : 'operation_end', result);
    }
    function snapshot(reason) {
        var slow = completed.slice().sort(function (a, b) { return b.elapsed_ms - a.elapsed_ms; }).slice(0, 10);
        return { schema_version: 1, is_test: 1, build_version: version, session_id: session,
            reason: clean(reason), observed_from: 'game_entry', entry_timestamp_ms: start, elapsed_ms: Math.max(0, now() - start),
            phase: phase, dropped: dropped, slowest: slow,
            boot_stages: bootStages.slice(),
            pending: active.map(function (t) { return { operation: t.operation, label: t.label, elapsed_ms: now() - t.started }; }),
            events: records.slice() };
    }
    function save(reason) {
        if (disabled || busy || saveTimer !== null) return;
        saveTimer = schedule(function () {
            saveTimer = null;
            if (disabled || busy) return;
            safe(function () {
                if (typeof api.setStorageSync === 'function') api.setStorageSync(storageKey, snapshot(reason));
            });
        }, 0);
    }
    function summary(reason) {
        var report = snapshot(reason);
        emit('summary', { reason: clean(reason), elapsed_ms: report.elapsed_ms,
            pending: report.pending.length, slowest: report.slowest, boot_stages: report.boot_stages });
        save(reason);
    }
    function wrap(owner, name, operation, callbackIndex, getLabel, progress) {
        if (!owner || typeof owner[name] !== 'function' || owner[name].__tapTiming) return;
        var original = owner[name];
        var wrapped = function () {
            if (disabled || busy || operations >= 96) return original.apply(this, arguments);
            var self = this, args = Array.prototype.slice.call(arguments);
            if (operation === 'race_scene_request') controller.transition('race_scene_request');
            var task = begin(operation, getLabel ? safe(function () { return getLabel(self, args); }) : name);
            var index = callbackIndex === 'last' ? args.length - 1 : callbackIndex;
            var callback = args[index], hasCallback = typeof callback === 'function';
            if (hasCallback) args[index] = function (error) {
                end(task, error); return callback.apply(this, arguments);
            };
            // 只包装明确的 (path, type, progress, complete) 四参签名，不能误包资产类型构造器。
            if (progress && task && args.length === 4 && index === 3 && typeof args[2] === 'function') {
                var onProgress = args[2], bucket = -1;
                args[2] = function (finished, total) {
                    var next = total > 0 ? Math.floor(finished / total * 4) : -1;
                    if (!task.ended && next >= 0 && next !== bucket) {
                        bucket = next;
                        emit('operation_progress', { id: task.id, completed: finished, total: total,
                            elapsed_ms: Math.max(0, now() - task.started) });
                    }
                    return onProgress.apply(this, arguments);
                };
            }
            try {
                var result = original.apply(self, args);
                // 回调式任务保留原返回对象/Promise 身份，不额外改变其消费方式。
                if (!hasCallback) end(task, null);
                return result;
            } catch (error) { end(task, error); throw error; }
        };
        wrapped.__tapTiming = true;
        owner[name] = wrapped;
        cleanups.push(function () { if (owner[name] === wrapped) owner[name] = original; });
    }
    function subscribe(owner, on, off, fn) {
        if (!owner || typeof owner[on] !== 'function' || typeof owner[off] !== 'function') return;
        owner[on](fn); cleanups.push(function () { owner[off](fn); });
    }
    function sceneName(cc) {
        return safe(function () { return cc.director.getScene().name; }) || 'unknown';
    }
    var controller = {
        record: function (name, data) { safe(function () { emit(name, data); }); },
        dump: function () { return JSON.parse(JSON.stringify(snapshot('manual_export'))); },
        exportLog: function () {
            safe(function () { output('[TapTimingReport] ' + JSON.stringify(snapshot('manual_export'))); });
        },
        captureBoot: function (name, data) {
            safe(function () {
                if (name === 'begin' && data.phase) phase = data.phase;
                if (name === 'done' && bootStages.length < 32) bootStages.push({ phase: data.phase, elapsed_ms: data.elapsed_ms });
                if (name === 'background') { hidden = true; stopWatch(); }
                if (name === 'foreground') { hidden = false; watch(); }
                emit('boot_' + name, data);
                if (name === 'failed') summary('startup_failed');
                if (name === 'ready') {
                    var alreadyReady = phase === 'lobby_ready';
                    phase = 'lobby_ready'; stopWatch(); if (!alreadyReady) summary('lobby_ready');
                }
            });
        },
        attachHost: function (host) {
            safe(function () {
                if (hostAttached || !host) return; hostAttached = true; api = host;
                subscribe(host, 'onHide', 'offHide', function () { hidden = true; stopWatch(); });
                subscribe(host, 'onShow', 'offShow', function () { hidden = false; if (phase !== 'lobby_ready') watch(); });
                subscribe(host, 'onError', 'offError', function (error) {
                    emit('host_failed', { error: clean(error && (error.message || error.errMsg) || error) });
                    summary('host_error');
                });
                // 不采集账号、完整 URL 或完整系统信息，只记录判断启动环境所需字段。
                var info = typeof host.getSystemInfoSync === 'function' && host.getSystemInfoSync();
                if (info) emit('environment', { platform: clean(info.platform), system: clean(info.system),
                    model: clean(info.model), SDKVersion: clean(info.SDKVersion), pixel_ratio: info.devicePixelRatio });
            });
        },
        attachEngine: function (cc) {
            safe(function () {
                if (engineAttached || !cc) return; engineAttached = true;
                function bundleLabel(owner, args) {
                    var type = args[1] && args[1].name;
                    return (owner.name || 'bundle') + '/' + (/^(Font|TTFFont|Texture2D|SpriteFrame|Prefab|JsonAsset|AudioClip|Mesh|Material)$/.test(type) ? type : 'Asset');
                }
                wrap(cc.assetManager, 'loadBundle', 'bundle_load', 'last', function (_, args) {
                    return /^(race|music|main|resources|internal)$/.test(args[0]) ? args[0] : 'custom_bundle';
                });
                var p = cc.AssetManager && cc.AssetManager.Bundle && cc.AssetManager.Bundle.prototype;
                wrap(p, 'load', 'asset_load', 'last', bundleLabel, true);
                wrap(p, 'loadDir', 'asset_directory', 'last', bundleLabel, true);
                wrap(p, 'loadScene', 'scene_asset_load', 'last', function (_, args) { return args[0]; });
                wrap(cc.director, 'loadScene', 'scene_load', 1, function (_, args) { return args[0]; });
                var director = cc.director, D = cc.Director || {}, launches = 0;
                if (!director || typeof director.on !== 'function' || typeof director.off !== 'function') return;
                if (D.EVENT_AFTER_SCENE_LAUNCH) {
                    var launch = function () {
                        scene = sceneName(cc); frames = 0;
                        emit('scene_launched', { scene: clean(scene) });
                        // 每个场景只观察一次绘制事件，最多五次，不能把它当可操作界面验收。
                        if (++launches > 5 || !D.EVENT_AFTER_DRAW) return;
                        var draw = function () {
                            director.off(D.EVENT_AFTER_DRAW, draw); frames++;
                            emit('scene_first_draw', { scene: clean(scene) });
                        };
                        director.on(D.EVENT_AFTER_DRAW, draw);
                        cleanups.push(function () { director.off(D.EVENT_AFTER_DRAW, draw); });
                    };
                    director.on(D.EVENT_AFTER_SCENE_LAUNCH, launch);
                    cleanups.push(function () { director.off(D.EVENT_AFTER_SCENE_LAUNCH, launch); });
                }
            });
        },
        wrapLogin: function (Constructor) {
            safe(function () {
                var p = Constructor.prototype;
                wrap(p, 'onLoad', 'login_onload', -1);
                wrap(p, 'openPrepareRace', 'selection_open', -1);
                wrap(p, 'launchMainGame', 'race_scene_request', -1);
            });
            return Constructor;
        },
        wrapManager: function (Constructor) {
            safe(function () {
                var p = Constructor.prototype;
                wrap(p, 'onLoad', 'race_onload_dispatch', -1);
                wrap(p, 'buildScene', 'race_scene_build', 0);
            });
            return Constructor;
        },
        wrapFlow: function (Constructor) {
            safe(function () { wrap(Constructor.prototype, 'startGame', 'race_flow_setup', -1); });
            return Constructor;
        },
        business: function (name) {
            safe(function () {
                if (name === 'lobby_ready' && phase === 'lobby_ready') return;
                phase = name;
                emit(name, {});
                if (name === 'race_start') { busy = true; stopWatch(); }
                else if (name === 'race_end') { busy = false; summary('race_end'); }
                else if (name === 'lobby_ready') { stopWatch(); summary('lobby_ready'); }
            });
        },
        transition: function (name) {
            safe(function () { phase = name; busy = false; samples = 0; watchStart = now(); emit(name, {}); watch(); });
        },
        dispose: function () {
            disabled = true; stopWatch();
            if (saveTimer !== null) { safe(function () { cancel(saveTimer); }); saveTimer = null; }
            for (var i = cleanups.length - 1; i >= 0; i--) safe(cleanups[i]);
            cleanups.length = 0;
        }
    };
    root.__swimmingTapTiming = controller;
    emit('entry', { version: version, observation_boundary: 'game_entry' });
    watch();
    return controller;
};

exports.install = function (root, config) {
    if (root.__swimmingTapTiming) return root.__swimmingTapTiming;
    return exports.create({ root: root, version: config.version });
};
