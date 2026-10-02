'use strict';

// 开发包事件采集器。只在业务状态变化时工作，不参与比赛帧循环或同步协议。
// 接收端未配置时只记录本地事件，绝不将日志或 HTTP 200 冒充后台入库。
var NAMES = ['lobby_ready', 'race_start', 'race_end', 'race_again'];
var KEY = 'swimming.tap.event-test.v2';
var SCHEMA_VERSION = 2;
var MAX_EVENTS = 64;
var MAX_AGE = 7 * 24 * 60 * 60 * 1000;
var FIELDS = ['load_ms', 'source', 'race_id', 'mode', 'distance', 'character_id', 'play_type',
    'test_type', 'outcome', 'time_ms', 'placement', 'progress_percent'];
var NUMBERS = ['load_ms', 'distance', 'time_ms', 'placement', 'progress_percent'];

exports.create = function (options) {
    var api = options.api || {}, config = options.config || {};
    var now = options.now || Date.now, schedule = options.schedule || setTimeout;
    var output = options.log || function (line) { console.log(line); };
    var session = 'test-' + now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    var sequence = 0, races = 0, logs = 0, lobby = false, activeRaces = 0;
    var history = [], pending = [], dropped = 0, timer = false, sending = false, retry = 0;
    var startedAt = now(), flowStates = new WeakMap();
    var endpoint = config.endpoint || '';
    // 只能连接开发者明确配置的接收服务，不推测 tap.reportAnalytics 或直接套 APK SDK。
    var network = config.test_transport_enabled === true && /^https:\/\/[^\s]+$/.test(endpoint)
        && typeof api.request === 'function';
    function log(stage, data) {
        if (logs++ >= 48) return;
        try { output('[TapEvents] ' + stage + ' ' + JSON.stringify(data)); } catch (_) { /* 诊断不影响游戏。 */ }
    }
    function clean(fields) {
        var result = {};
        for (var i = 0; i < FIELDS.length; i++) {
            var key = FIELDS[i], value = fields && fields[key];
            if (NUMBERS.indexOf(key) >= 0) {
                if (typeof value === 'number' && Number.isFinite(value)) {
                    result[key] = Math.min(key === 'progress_percent' ? 100 : Number.MAX_SAFE_INTEGER,
                        Math.round(Math.max(0, value)));
                }
            } else if (typeof value === 'string' && value.length <= 80) result[key] = value;
        }
        return result;
    }
    function valid(record) {
        return record && NAMES.indexOf(record.name) >= 0 && typeof record.event_id === 'string'
            && record.event_id.length <= 100 && Number.isFinite(record.timestamp_ms)
            && record.timestamp_ms <= now() && now() - record.timestamp_ms <= MAX_AGE
            && record.is_test === 1 && record.schema_version === SCHEMA_VERSION;
    }
    try {
        var saved = typeof api.getStorageSync === 'function' && api.getStorageSync(KEY);
        if (typeof saved === 'string' && saved.length < 100000) saved = JSON.parse(saved);
        if (saved && Array.isArray(saved.events) && Array.isArray(saved.pending)) {
            saved.events.slice(-MAX_EVENTS).forEach(function (record) {
                if (!valid(record)) return;
                var restored = { event_id: record.event_id, timestamp_ms: record.timestamp_ms,
                    name: record.name, build_version: String(record.build_version).slice(0, 20),
                    schema_version: SCHEMA_VERSION, is_test: 1, channel: 'taptap', session_id: String(record.session_id).slice(0, 100),
                    properties: clean(record.properties) };
                history.push(restored);
                if (saved.pending.indexOf(record.event_id) >= 0) pending.push(record.event_id);
            });
        }
    } catch (_) { log('storage', { result: 'read_failed' }); }
    function persist() {
        if (typeof api.setStorageSync !== 'function') return;
        try { api.setStorageSync(KEY, { events: history, pending: pending }); }
        catch (_) { log('storage', { result: 'write_failed' }); }
    }
    function record(name, fields) {
        if (NAMES.indexOf(name) < 0) return;
        var entry = { event_id: session + '-' + (++sequence), name: name, timestamp_ms: now(),
            session_id: session, build_version: config.version || 'unversioned', schema_version: SCHEMA_VERSION,
            is_test: 1, channel: 'taptap', properties: clean(fields) };
        history.push(entry); pending.push(entry.event_id);
        if (history.length > MAX_EVENTS) {
            var removed = history.shift();
            pending = pending.filter(function (id) { return id !== removed.event_id; });
            dropped++;
        }
        persist();
        log('local', entry);
        requestFlush();
    }
    function requestFlush() {
        if (!network || activeRaces || timer || sending || retry >= 3 || !pending.length) return;
        timer = true;
        schedule(function () { timer = false; flush(); }, retry ? 2000 * retry : 200);
    }
    function flush() {
        if (!network || activeRaces || sending || retry >= 3 || !pending.length) return;
        var batch = history.filter(function (entry) { return pending.indexOf(entry.event_id) >= 0; }).slice(0, 10);
        if (!batch.length) return;
        sending = true;
        var settled = false;
        function finish(response) {
            if (settled) return;
            settled = true; sending = false;
            var ack = response && response.statusCode === 200 && response.data;
            var accepted = ack && Array.isArray(ack.accepted_event_ids) ? ack.accepted_event_ids : [];
            var batchIds = batch.map(function (entry) { return entry.event_id; });
            // 接收端需持久化并按 event_id 去重后确认，未知 ID 和普通 HTTP 200 不算成功。
            accepted = accepted.filter(function (id) { return batchIds.indexOf(id) >= 0; });
            if (accepted.length) {
                pending = pending.filter(function (id) { return accepted.indexOf(id) < 0; });
                retry = 0; persist();
                log('receiver_ack', { count: accepted.length, pending: pending.length });
            } else { retry++; log('send_failed', { attempt: retry, pending: pending.length }); }
            requestFlush();
        }
        // 不依赖宿主一定回调；超时后保留原 ID，下一次重试不会生成新事件。
        schedule(function () { finish(null); }, 6000);
        try {
            api.request({ url: endpoint, method: 'POST', timeout: 5000,
                header: { 'content-type': 'application/json' },
                data: { app_id: '956108', schema_version: SCHEMA_VERSION, is_test: 1, events: batch },
                success: finish, fail: function () { finish(null); } });
        } catch (_) { finish(null); }
    }
    function safe(operation) {
        try { operation(); } catch (_) { log('instrumentation', { result: 'failed_game_continues' }); }
    }
    function state(flow) {
        var value = flowStates.get(flow);
        if (!value) {
            value = { manager: null, context: null, race: null, ended: false, again: false, playing: false };
            flowStates.set(flow, value);
        }
        return value;
    }
    function end(flow, outcome, time, placement, distance) {
        var s = state(flow);
        if (!s.race || s.ended) return;
        s.ended = true;
        var total = Math.max(1, s.race.distance || 1);
        record('race_end', Object.assign({}, s.race, { outcome: outcome,
            time_ms: Math.round((Number.isFinite(time) ? Math.max(0, time) : 0) * 1000),
            placement: Math.max(0, Math.floor(placement || 0)),
            progress_percent: Math.min(100, Math.max(0, Math.round((distance || 0) / total * 100))) }));
    }
    function again(flow) {
        var s = state(flow);
        if (!s.race || !s.ended || s.again) return;
        s.again = true; record('race_again', s.race);
    }
    function idle(flow) {
        var s = state(flow);
        if (s.playing) { s.playing = false; activeRaces = Math.max(0, activeRaces - 1); }
        requestFlush();
    }
    function wrap(prototype, name, after, before) {
        var original = prototype[name];
        if (typeof original !== 'function' || original.__tapEventWrapped) return;
        var wrapped = function () {
            var self = this, args = arguments;
            if (before) safe(function () { before(self, args); });
            var result = original.apply(self, args);
            if (after) safe(function () { after(self, args, result); });
            return result;
        };
        wrapped.__tapEventWrapped = true;
        prototype[name] = wrapped;
    }
    var controller = {
        record: record, flush: flush,
        status: function () { return { version: config.version || 'unversioned', schema_version: SCHEMA_VERSION,
            channel: 'taptap', mode: network ? 'configured_receiver' : 'local_only',
            pending: pending.length, recorded: history.length, dropped: dropped, activeRaces: activeRaces }; },
        dump: function () { return JSON.parse(JSON.stringify(history)); },
        lobbyReady: function () {
            if (lobby) return;
            // TapTap 未验证桌面/扫码来源字段，明确标 unknown，不冒充抖音侧边栏来源。
            lobby = true; record('lobby_ready', { load_ms: Math.max(0, now() - startedAt), source: 'unknown' });
        },
        attachFlow: function (flow, manager, context) {
            if (flow) { var s = state(flow); s.manager = manager; s.context = context; }
            return flow;
        },
        wrapFlow: function (Constructor) {
            var p = Constructor.prototype;
            wrap(p, 'startGame', function (flow) {
                var s = state(flow);
                idle(flow);
                s.race = null; s.ended = false; s.again = false;
            });
            wrap(p, 'restartGame', null, function (flow) { again(flow); });
            wrap(p, 'bindRaceManagerCallbacks', function (flow) {
                var refs = flow._refs, rm = refs && refs.raceManager;
                if (!rm) return;
                wrap(rm, 'onStateChange', function (_, args) {
                    if (args[0] !== 'diving') return;
                    var s = state(flow), m = s.manager;
                    if (s.race || !s.context || !m || m._launchMode !== 'race' || m._aiDebugMode
                        || m._playerAutopilotEnabled || m._playerAutopilotUsedThisRace) return;
                    s.race = clean(s.context()); s.race.race_id = session + '-race-' + (++races);
                    s.playing = true; activeRaces++; record('race_start', s.race);
                });
                wrap(rm, 'onSwimmerFinished', function (_, args) {
                    var row = args[0], s = state(flow);
                    if (row && row.isPlayer && s.race && s.race.play_type === 'local') {
                        end(flow, 'completed', row.time, row.placement, refs.playerSwimmer && refs.playerSwimmer.distance);
                    }
                });
                // 网络成绩必须等原来的权威名次解析完成，不能提前使用本机估算。
                wrap(refs, 'resolveNetLeaderboard', null, function (_, args) {
                    var callback = args[1];
                    if (typeof callback !== 'function') return;
                    var presentationVersion = flow._finishPresentationVersion;
                    args[1] = function (rows) {
                        safe(function () {
                            if (presentationVersion !== flow._finishPresentationVersion) return;
                            var row = rows && rows.find(function (entry) { return entry.isPlayer; });
                            if (!row) return;
                            var outcome = row.quit ? 'quit' : row.eliminated ? 'eliminated' : row.finished ? 'completed' : 'dnf';
                            end(flow, outcome, row.time, row.placement, refs.playerSwimmer && refs.playerSwimmer.distance);
                            idle(flow);
                        });
                        return callback.apply(this, arguments);
                    };
                });
            });
            return Constructor;
        },
        wrapManager: function (Constructor) {
            wrap(Constructor.prototype, 'restartGame', null, function (manager) { if (manager._gameFlow) again(manager._gameFlow); });
            wrap(Constructor.prototype, 'returnToLogin', null, function (manager) {
                if (manager._isReturningToLogin || !manager._gameFlow) return;
                var rm = manager._raceManager, swimmer = manager._playerSwimmer;
                end(manager._gameFlow, 'quit', rm && rm.elapsedSeconds, 0, swimmer && swimmer.distance);
                idle(manager._gameFlow);
            });
            return Constructor;
        }
    };
    log('installed', controller.status());
    return controller;
};

exports.install = function (root, config) {
    if (root.__swimmingTapEvents) return root.__swimmingTapEvents;
    // 小游戏提供 tap 全局对象；不替换宿主 API，也不读取登录凭证或玩家个人信息。
    var controller = exports.create({ api: root.tap || (typeof tap !== 'undefined' ? tap : {}), config: config });
    // 辅助模块不能让类导出、实例创建或大厅加载的原路径失败。
    ['wrapFlow', 'wrapManager', 'attachFlow', 'lobbyReady'].forEach(function (name) {
        var original = controller[name];
        controller[name] = function () {
            var result;
            try { result = original.apply(controller, arguments); }
            catch (_) {
                try { console.log('[TapEvents] instrumentation disabled'); } catch (_) {}
                result = name === 'lobbyReady' ? undefined : arguments[0];
            }
            if (name === 'lobbyReady') {
                try { if (root.__swimmingTapStartup) root.__swimmingTapStartup.complete('lobby-ready'); } catch (_) {}
            }
            return result;
        };
    });
    root.__swimmingTapEvents = controller;
    return controller;
};
