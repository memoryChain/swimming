// 执行真实控制器与编解码器；只替换引擎资源和平台 IO。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map();
const broadcasts = [];
const frames = [];
const room = { setCallbacks() {}, isSupported: () => true, broadcast: msg => broadcasts.push(msg), uploadFrame: msg => frames.push(msg) };
const RACE_ID = '0.review1';
const wire = (payload, raceId = RACE_ID) => `G|${raceId}|${payload}`;
function body(message) {
    assert.ok(message.startsWith(`G|${RACE_ID}|`));
    return message.slice(`G|${RACE_ID}|`.length);
}
function receiveFrame(receiver, frame) {
    receiver.onSyncFrame({ ...frame, items: frame.items.map(item => wire(item)) });
}
const overrides = {
    './NetManager': { netRoom: () => room },
    './NetInputCapture': { setNetInputCaptureActive() {}, drainNetInput: () => [] },
    '../entity/RemoteSwimmerController': {}, '../ui/RuntimeUiFactory': {},
    './EntertainmentWaterSplash': {}, './RaceBundleLoader': {}, './ResourcePaths': {},
};
function load(relative) {
    const file = path.resolve(root, relative);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const localRequire = id => {
        if (id in overrides) return overrides[id];
        if (id === 'cc') return { Color: class {}, Vec3: class {}, sys: { localStorage: { getItem() { return null; } } } };
        return load(path.relative(root, path.resolve(path.dirname(file), id + '.ts')));
    };
    vm.runInThisContext(`(function(require,module,exports){${js}\n})`, { filename: file })(localRequire, module, module.exports);
    return module.exports;
}
function method(file, className, methodName, globals = {}) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
    const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === className);
    const member = cls.members.find(n => n.name?.getText(source) === methodName);
    const js = ts.transpileModule(`class Fixture { ${member.getText(source)} }; Fixture`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText;
    return vm.runInNewContext(js, { ...globals }).prototype[methodName];
}
const { StimulantBrawlController } = load('assets/scripts/core/StimulantBrawlController.ts');
for (const name of ['createProgramVisuals', 'createBeaconVisuals', 'loadModelVisuals']) {
    StimulantBrawlController.prototype[name] = () => {};
}
const { NetRaceController } = load('assets/scripts/net/NetRaceController.ts');
const { encodeRaceSnapshot, decodeRaceSnapshot } = load('assets/scripts/net/NetRaceSnapshot.ts');
const { encodeInputFrame, decodeInputFrame } = load('assets/scripts/net/NetRaceInput.ts');
const { CannonBrawlController } = load('assets/scripts/core/CannonBrawlController.ts');
const { MineRelayBrawlController } = load('assets/scripts/core/MineRelayBrawlController.ts');
const { EntertainmentModeDirector } = load('assets/scripts/core/EntertainmentModeDirector.ts');
const { LitterBrawlController, LITTER_BRAWL_TUNING } = load('assets/scripts/core/LitterBrawlController.ts');
const { MinefieldBrawlController } = load('assets/scripts/core/MinefieldBrawlController.ts');
const { GameState } = load('assets/scripts/core/GameConstants.ts');

function pickups(kind = 'stimulant', kinds = [kind]) {
    const result = { gains: 0, effects: 0, feedback: 0, order: [], heartRate: 160, calm: false };
    const racer = {
        swimmer: {
            node: { active: true, worldPosition: { x: 10, z: 0 } }, heartRate: 160,
            motor: { ability: {},
                applyHeartbeatSoda() { result.effects++; result.order.push('soda'); result.heartRate = Math.min(180, result.heartRate + 40); result.calm = false; },
                applyCalmSlush() { result.effects++; result.order.push('slush'); result.heartRate = Math.max(80, result.heartRate - 60); result.calm = true; },
            },
            triggerStimulantReaction() {}, triggerCalmSlushReaction() {},
        },
        condition: { energyRatio: .2, restoreEnergyRatio() { result.gains++; return 30; }, syncHeartRate() {} },
    };
    const controller = new StimulantBrawlController({}, 1, { laneCount: 8, centerZ: () => 0 },
        { waterY: 0, swimPosition: (x, z) => ({ x, z }) }, () => racer, () => {},
        () => result.feedback++, () => {}, () => 0, null,
        kinds.map((kind, id) => ({ id, wave: 1, laneIndex: 0, distance: 10, lateralOffset: 0, kind })));
    return { controller, result };
}
function net(raceId = RACE_ID) {
    const instance = new NetRaceController({ raceId, localIsHost: false, localPos: 1, seed: 7, members: [{ pos: 0 }, { pos: 1 }] });
    instance._activeHostPos = 0;
    return instance;
}

function bombFixture() {
    const racers = [30, 31].map((distance, lane) => ({ active: true, finished: false, distance, lateral: lane }));
    const events = [];
    const controller = new MineRelayBrawlController(2, 7, 20, lane => racers[lane], () => {}, () => {}, event => events.push(event));
    return { racers, controller, events };
}

test('保活重赛拒绝上一局完成快照及高代次，本局低修订仍能恢复', () => {
    const old = new EntertainmentModeDirector(7, 200);
    old.update(100, 40, true); old.update(100, 60, true);
    old.lockAfterFirstFinish(); old.update(100, 200, true);
    const current = new EntertainmentModeDirector(7, 200); // 相同 seed 也必须隔离。
    const fresh = current.snapshot();
    const receiver = net(); const accepted = [];
    receiver.setEntertainmentDirectorStateListener(state => {
        const result = current.applySnapshot(state).snapshotAccepted;
        accepted.push(result); return result;
    });
    receiver.setGameplayEventEpochListener((slot, epoch) => receiver.setGameplayEventEpoch(slot, epoch));
    const snapshot = (state, epochs) => encodeRaceSnapshot(0, [], null, null, null, null, null, null, state, epochs);
    receiver.onBroadcast(wire(snapshot(old.snapshot(), [90, 90, 90]), '0.previous'));
    receiver.onBroadcast(snapshot(old.snapshot(), [90, 90, 90])); // 无身份的旧协议同样拒绝。
    assert.equal(receiver._snapRecv, 0);
    assert.deepEqual(receiver._eventEpochs, [0, 0, 0]);
    receiver.onBroadcast(wire(snapshot(fresh, [0, 0, 0])));
    assert.deepEqual(accepted, [true]);
    assert.equal(current.snapshot().phase, fresh.phase);
    assert.equal(current.snapshot().revision, fresh.revision);
    receiver.dispose();
});

test('旧可靠帧和降级广播不能触发命中、输入或污染本局序号', () => {
    const receiver = net(); let hits = 0; const inputs = [];
    receiver.setMinefieldImpactListener(() => hits++);
    receiver.processRemotePacket = (sender, seq) => inputs.push(seq);
    const payload = seq => encodeInputFrame(0, [
        { kind: 'H', side: 0 },
        { kind: 'i', mineId: 0, mineHitLane: 0, mineDistance: 20, mineLateral: 0, hitMask: 1, revision: 1 },
    ], undefined, undefined, seq);
    receiver.onSyncFrame({ frameId: 999, items: [wire(payload(999), '0.previous'), payload(999)] });
    receiver.onBroadcast(wire('IN|' + payload(999), '0.previous'));
    assert.equal(receiver._recvFrames, 0); assert.equal(hits, 0); assert.deepEqual(inputs, []);
    // 同一服务帧可能混有两局的 action，逐项过滤后仍处理本局。
    receiver.onSyncFrame({ frameId: 1, items: [wire(payload(999), '0.previous'), wire(payload(1))] });
    assert.equal(hits, 1); assert.deepEqual(inputs, [1]);
    receiver.dispose();
});

test('旧局退赛、成绩、倒计时及降级通知不影响新局，接管房主保持比赛身份', () => {
    const receiver = net(); let quits = 0, results = 0, starts = 0;
    receiver.setPlayerQuitListener(() => quits++);
    receiver.setAuthResultListener(() => results++);
    receiver.setCountdownStartListener(() => starts++);
    const { encodeRaceResult } = load('assets/scripts/net/NetRaceResult.ts');
    for (const payload of ['Q|0', 'GO|', 'NB|0', encodeRaceResult([])]) receiver.onBroadcast(wire(payload, '0.previous'));
    assert.equal(quits + results + starts, 0); assert.equal(receiver.broadcastSyncRequired, false);
    receiver.onBroadcast(wire('Q|0')); receiver.onBroadcast(wire('GO|')); receiver.onBroadcast(wire('NB|0'));
    assert.equal(quits, 1); assert.equal(starts, 1); assert.equal(receiver.broadcastSyncRequired, true);
    receiver.promoteToHost(); broadcasts.length = 0; receiver.sendSnapshot([]);
    assert.ok(broadcasts.length); for (const payload of broadcasts) body(payload);
    receiver.dispose();
});

test('可靠帧实际发送携带比赛身份，销毁取消旧倒计时且拒绝排队回调', () => {
    const sender = net(); frames.length = 0; sender.tick(.04);
    assert.equal(frames.length, 1); assert.equal(decodeInputFrame(body(frames[0])).senderPos, 1);
    let starts = 0; sender.setCountdownStartListener(() => starts++); sender.reportRaceReady();
    assert.ok(sender._goTimeoutHandle);
    sender.dispose(); assert.equal(sender._goTimeoutHandle, null);
    broadcasts.length = 0;
    sender.triggerCountdownFromGo(); sender.broadcastGo(); sender.onBroadcast(wire('GO|'));
    assert.equal(starts, 0); assert.equal(broadcasts.length, 0);
});

test('炸弹爆炸快照与事件交换到达顺序，携带者和外围各执行一次', () => {
    const host = bombFixture();
    host.controller.applyArm({ roundId: 0, carrierLane: 0, fuseSeconds: .1, revision: 1 });
    host.controller.update(.2, GameState.RACING, true);
    const event = host.events[0];
    const file = 'assets/scripts/core/GameManager.ts';
    for (const snapshotFirst of [true, false]) {
        let resolutionListener, snapshotListener, carrierHits = 0, peripheralHits = 0;
        const gm = {
            _raceManager: {}, _cannonRacerStates: [], _mineRelayRacerStates: [{}, {}],
            swimmerForLane: lane => ({ node: { active: true, position: { z: lane } }, distance: 30 + lane }),
            _entertainmentRecovery: { stateForLane: () => ({ phase: 1, reason: 2 }) },
            _netRaceController: {
                setMineRelayArmListener() {}, setMineRelayTransferListener() {},
                setMineRelayResolutionListener(fn) { resolutionListener = fn; },
                setMineRelayStateListener(fn) { snapshotListener = fn; },
            },
            applyMineRelayExplosion() { carrierHits++; },
            applyExplosionShockwaveHit() { peripheralHits++; },
        };
        const globals = {
            MineRelayBrawlController, LANE_LAYOUT: { laneCount: 2, centerZ: lane => lane },
            COURSE_LAYOUT: { poolWidth: 20, distanceToWorldX: d => d }, getSharedRandomSeed: () => 7,
            isTimedBombBrawlMode: () => true, isEntertainmentBrawlMode: () => false,
            MINE_RELAY_ROUNDS: [{}, {}, {}, {}, {}, {}],
            EntertainmentRecoveryPhase: { KNOCKED: 1 }, EntertainmentRecoveryReason: { TIMED_BOMB: 2 },
        };
        gm.handleMineRelayResolution = method(file, 'GameManager', 'handleMineRelayResolution', globals);
        method(file, 'GameManager', 'setupMineRelayBrawl', globals).call(gm);
        const deliver = () => resolutionListener(event.roundId, event.carrierLane, event.exploded,
            event.distance, event.lateral, event.hitMask, event.revision);
        if (snapshotFirst) snapshotListener(host.controller.snapshotState());
        deliver(); snapshotListener(host.controller.snapshotState()); deliver();
        assert.equal(carrierHits, 1);
        assert.equal(peripheralHits, 1);
    }
});

test('下一轮快照先到时补收上一轮爆炸，不回拨新炸弹及倒计时', () => {
    const f = bombFixture();
    f.controller.applyArm({ roundId: 0, carrierLane: 0, fuseSeconds: .1, revision: 1 });
    f.controller.update(.2, GameState.RACING, true);
    const guest = bombFixture().controller;
    guest.applySnapshotState({ ...f.controller.snapshotState(), revision: 3,
        activeRoundId: 1, carrierLane: 1, remainingSeconds: 6, recoverySeconds: 0 });
    const before = guest.snapshotState();
    assert.equal(guest.applyResolution(f.events[0]), true);
    assert.deepEqual(guest.snapshotState(), before);
    assert.equal(guest.applyResolution(f.events[0]), false);
});

test('下一发炮火快照先到时上一发仍补命中，使用该发爆心且不覆盖当前预警', () => {
    const c = new CannonBrawlController(2, 7, 20, () => null, () => {}, () => {});
    c.applySnapshotState({ revision: 3, completedStrikeMask: 1, activeStrikeId: 1,
        targetDistance: 35, targetZ: -5, remainingSeconds: .8 });
    const impact = { strikeId: 0, hitMask: 2, knockedLane: -1, knockedDistance: 0,
        revision: 2, targetDistance: 30, targetZ: 5 };
    assert.equal(c.applyImpact(impact), true);
    assert.equal(c.currentLaunch().strikeId, 1);
    assert.equal(c.currentRemainingSeconds(), .8);
    const hits = [], displays = [];
    const gm = { _cannonBrawl: c, _lastCannonTargetZ: -5,
        _cannonBrawlPresentation: { showImpact() { displays.push('world'); } },
        _eventPictureInPicture: { showCannonImpact() { displays.push('pip'); } },
        applyExplosionShockwaveHit: (lane, z) => hits.push([lane, z]) };
    method('assets/scripts/core/GameManager.ts', 'GameManager', 'handleCannonImpact',
        { LANE_LAYOUT: { laneCount: 2 } }).call(gm, impact, false);
    assert.deepEqual(hits, [[1, 5]]);
    assert.deepEqual(displays, []);
    assert.equal(c.applyImpact(impact), false);
});

test('炮火和炸弹按场景折返坐标命中，预警与 AI 躲避一致', () => {
    // 50 米赛程对应 45 米实际池内长度；30 米和70 米都位于池内同一点。
    const worldX = distance => { const d = distance % 100; return 10 + (d <= 50 ? d : 100 - d) * .9; };
    const racers = [30, 70, 90].map((distance, lane) => ({ active: true, finished: false,
        damageable: true, speed: 0, distance, lateral: lane * .5 }));
    const impacts = [], resolutions = [];
    const cannon = new CannonBrawlController(3, 7, 20, lane => racers[lane], () => {}, e => impacts.push(e),
        undefined, undefined, worldX);
    cannon.applyLaunch({ strikeId: 0, targetDistance: 30, targetZ: 0, warningSeconds: 1, revision: 1 });
    cannon.update(.4, GameState.RACING, false);
    assert.equal(cannon.threatForRacer(70, .5), 'core');
    assert.notEqual(cannon.targetZForAi(70, .5, 1), null);
    cannon.update(1, GameState.RACING, true);
    assert.equal(impacts[0].hitMask, 3);
    const bomb = new MineRelayBrawlController(3, 7, 20, lane => racers[lane], () => {}, () => {},
        e => resolutions.push(e), undefined, null, worldX);
    bomb.applyArm({ roundId: 0, carrierLane: 0, fuseSeconds: .1, revision: 1 });
    bomb.update(.2, GameState.RACING, true);
    assert.equal(resolutions[0].hitMask, 3);
});

test('补给站已打开或正在入场时接受邀请，返回后入口恢复且旧回调无效', () => {
    const file = 'assets/scripts/app/LoginManager.ts';
    for (const interruptTransition of [true, false]) {
        let reveal, visible = false, supply = true;
        const gm = { _canvasNode: { isValid: true }, _shopTransitioning: false, _shopNavigationVersion: 0,
            _shopPanel: { show() { visible = true; }, hide() { visible = false; }, isVisible: () => visible },
            _headBar: { setVisible() {}, setBack() {}, setIdentityVisible() {}, isIdentityVisible: () => true,
                setSupplyEntryVisible(value) { supply = value; } },
            _prepareRaceFlow: { transitionOutForOverlay(fn) { reveal = fn; return true; }, dispose() {} },
            openPrepareRace() {},
        };
        const globals = { RoomFlow: class { dispose() {} }, getUILayer() {}, UILayer: { Screen: 0 },
            setRoomMode() {}, console: { log() {} } };
        for (const name of ['openShop', 'closeShop', 'openRoom', 'exitRoom']) gm[name] = method(file, 'LoginManager', name, globals);
        gm.openShop();
        if (!interruptTransition) reveal();
        gm.openRoom('friend');
        reveal(); // 模拟在取消边界已经进入任务队列的回调。
        assert.equal(visible, false);
        assert.equal(gm._shopTransitioning, false);
        gm.exitRoom();
        assert.equal(supply, true);
        gm.openShop();
        assert.equal(visible, true);
    }
});

test('炸弹已完成快照先到后补事件，不重新延长爆炸恢复冷却', () => {
    const host = bombFixture();
    host.controller.applyArm({ roundId: 0, carrierLane: 0, fuseSeconds: .1, revision: 1 });
    host.controller.update(.2, GameState.RACING, true);
    const guest = bombFixture().controller;
    guest.applySnapshotState(host.controller.snapshotState());
    guest.update(1, GameState.RACING, false);
    const before = guest.snapshotState();
    assert.equal(guest.applyResolution(host.events[0]), true);
    assert.deepEqual(guest.snapshotState(), before);
});

test('炮火和炸弹广播首包丢失后有界补发，爆心及时钟穿过真实编解码与监听', () => {
    const host = net(); host._session.localPos = 0; host.promoteToHost(); host._peerNeedsBroadcast = true;
    host.enqueueCannonImpact(0, 3, 0, 30, 2, -4.625, 20);
    host.enqueueMineRelayResolution(0, 0, true, 30, 1, 3, 2, 20);
    host._authoritativeEvents.length = 0;
    broadcasts.length = 0; host.sendSnapshot([]);
    const retry = broadcasts.find(message => body(message).startsWith('IN|'));
    assert.ok(retry); assert.ok(Buffer.byteLength(retry) < 1536);
    const guest = net(); let cannonHits = 0, bombHits = 0;
    const cannon = new CannonBrawlController(2, 7, 20, () => null, () => {}, () => {});
    const bomb = bombFixture().controller;
    guest.setCannonImpactListener((strikeId, hitMask, knockedLane, knockedDistance, revision, targetZ, elapsedSeconds) => {
        assert.equal(targetZ, -4.625); assert.equal(elapsedSeconds, 20);
        if (cannon.applyImpact({ strikeId, hitMask, knockedLane, knockedDistance, revision, targetZ, elapsedSeconds }, 21)) cannonHits++;
    });
    guest.setMineRelayResolutionListener((roundId, carrierLane, exploded, distance, lateral, hitMask, revision, elapsedSeconds) => {
        assert.equal(elapsedSeconds, 20);
        if (bomb.applyResolution({ roundId, carrierLane, exploded, distance, lateral, hitMask, revision, elapsedSeconds }, 21)) bombHits++;
    });
    guest.onBroadcast(retry); guest.onBroadcast(retry);
    assert.equal(cannonHits, 1); assert.equal(bombHits, 1);
    for (const entry of host._contactRecoveryEvents) entry.expiresAt = 0;
    broadcasts.length = 0; host.sendSnapshot([]);
    assert.equal(broadcasts.some(message => body(message).startsWith('IN|')), false);
    host.dispose(); guest.dispose();
});

test('炮火和炸弹不补播超过三秒的旧冲击，三秒边界内仍能恢复', () => {
    for (const age of [3, 3.01]) {
        const cannon = new CannonBrawlController(2, 7, 20, () => null, () => {}, () => {});
        const bomb = bombFixture().controller;
        assert.equal(cannon.applyImpact({ strikeId: 0, hitMask: 3, knockedLane: 0,
            knockedDistance: 30, revision: 2, targetZ: 2, elapsedSeconds: 20 }, 20 + age), age === 3);
        assert.equal(bomb.applyResolution({ roundId: 0, carrierLane: 0, exploded: true,
            distance: 30, lateral: 0, hitMask: 3, revision: 2, elapsedSeconds: 20 }, 20 + age), age === 3);
    }
});

test('补给站退场被邀请隐藏时取消待导航和奖励弹窗，旧回调不返回大厅', () => {
    const file = 'assets/scripts/ui/ShopDailySupplyPanel.ts';
    let completion, backs = 0, cancelled = 0, popupHidden = 0;
    const panel = { _root: { isValid: true, active: true }, _closing: false,
        _motion: { exit(fn) { completion = fn; }, cancel() { cancelled++; } },
        _rewardPopup: { hideImmediately() { popupHidden++; } },
        refresh() {}, _onBack() { backs++; } };
    const globals = { PlayerData: { profile: {} } };
    panel.hide = method(file, 'ShopDailySupplyPanel', 'hide', globals);
    panel.beginClose = method(file, 'ShopDailySupplyPanel', 'beginClose', globals);
    panel.beginClose(); panel.hide(); completion();
    assert.equal(backs, 0); assert.equal(cancelled, 1); assert.equal(popupHidden, 1);
    assert.equal(panel._closing, false); assert.equal(panel._root.active, false);
    panel._root.active = true; panel.beginClose(); completion();
    assert.equal(backs, 1);
});

function outlineRig() {
    const file = 'assets/scripts/entity/CartoonSwimmerRig.ts';
    class SkinnedMeshRenderer {}
    const body = { isValid: true, enabled: false };
    const shells = [];
    const rig = {
        _skinnedRenderers: [body], _model: { isValid: true }, _loaded: true,
        _rendererRevealFramesRemaining: 2, _outlineVisible: true, _recoveryBlinkVisible: true,
        _outlineRoot: { isValid: true, active: true, children: shells },
    };
    for (const name of ['setSkinnedRenderersEnabled', 'lateUpdate', 'setRecoveryBlinkVisible', 'applyOutlineVisibility', 'setOutlineVisible']) {
        rig[name] = method(file, 'CartoonSwimmerRig', name, { SkinnedMeshRenderer });
    }
    function attachShell() {
        // 与 CharacterSkinApplier 一致：创建时继承身体的 enabled 状态。
        const shell = { isValid: true, enabled: body.enabled };
        shells.push({ getComponent: type => type === SkinnedMeshRenderer ? shell : null });
        return shell;
    }
    return { rig, body, attachShell };
}

test('描边材质先到或后到，首帧姿态预热后身体和描边都恢复显示', () => {
    for (const early of [true, false]) {
        const { rig, body, attachShell } = outlineRig();
        let shell = early ? attachShell() : null;
        rig.lateUpdate();
        assert.equal(body.enabled, false);
        if (shell) assert.equal(shell.enabled, false);
        rig.lateUpdate();
        if (!shell) shell = attachShell();
        assert.equal(body.enabled, true);
        assert.equal(shell.enabled, true, '不能只恢复身体而把缓存命中的描边永久留在禁用态');
    }
});

test('描边在重生灭灯时异步到达，亮灯后恢复，距离裁剪仍独立生效', () => {
    const { rig, body, attachShell } = outlineRig();
    rig.lateUpdate(); rig.lateUpdate();
    rig.setRecoveryBlinkVisible(false);
    const shell = attachShell();
    assert.equal(shell.enabled, false);
    rig.setRecoveryBlinkVisible(true);
    assert.equal(body.enabled, true);
    assert.equal(shell.enabled, true);
    rig.setOutlineVisible(false);
    for (let i = 0; i < 3; i++) {
        rig.setRecoveryBlinkVisible(false);
        assert.equal(body.enabled, false);
        assert.equal(rig._outlineRoot.active, false);
        rig.setRecoveryBlinkVisible(true);
        assert.equal(body.enabled, true);
        assert.equal(shell.enabled, true);
        assert.equal(rig._outlineRoot.active, false, '重生不能强行打开远处对手的描边');
    }
    rig.setOutlineVisible(true);
    assert.equal(rig._outlineRoot.active, true);
});

test('角色尚未完成姿态预热时，重生亮灯不能提前显示身体或描边', () => {
    const { rig, body, attachShell } = outlineRig();
    const shell = attachShell();
    rig.setRecoveryBlinkVisible(false); rig.setRecoveryBlinkVisible(true);
    assert.equal(body.enabled, false); assert.equal(shell.enabled, false);
    rig.lateUpdate(); rig.lateUpdate();
    assert.equal(body.enabled, true); assert.equal(shell.enabled, true);
});

for (const kind of ['stimulant', 'calm-slush']) {
    test(`${kind} 快照先到或事件先到均只结算一次`, () => {
        for (const snapshotFirst of [true, false]) {
            const { controller, result } = pickups(kind);
            const state = { revision: 1, collectedMask: 1 };
            const event = { itemId: 0, collectorLane: 0, revision: 1 };
            if (snapshotFirst) controller.applySnapshotState(state);
            assert.equal(controller.applyPickup(event), true);
            controller.applySnapshotState(state);
            assert.equal(controller.applyPickup(event), false);
            assert.equal(result.effects, 1);
            assert.equal(result.gains, kind === 'stimulant' ? 1 : 0);
        }
    });
    test(`${kind} 丢失领取事件后由周期快照恢复，重复快照和迁移不重复收益`, () => {
        const host = pickups(kind);
        host.controller.applyPickup({ itemId: 0, collectorLane: 7, revision: 1 });
        const payload = encodeRaceSnapshot(0, [], host.controller.snapshotState());
        const guest = pickups(kind);
        const receiver = net();
        receiver.setStimulantStateListener(state => guest.controller.applySnapshotState(state));
        receiver.onBroadcast(wire(payload));
        receiver.onBroadcast(wire(payload));
        assert.equal(guest.result.effects, 1);
        assert.equal(guest.controller.snapshotState().collectorLanes[0], 7);
        const restored = decodeRaceSnapshot(encodeRaceSnapshot(1, [], guest.controller.snapshotState()));
        assert.equal(restored.stimulantCollectors[0], 7);
        guest.controller.applySnapshotState({ revision: 1, collectedMask: 1, collectorLanes: restored.stimulantCollectors });
        assert.equal(guest.result.effects, 1);
        receiver.dispose();
    });
}

test('娱乐 400 米档案往返和合法规则均保留距离，非法距离回退', () => {
    const { createDefaultProfile, normalizeProfile } = load('assets/scripts/backend/PlayerProfile.ts');
    for (const rule of ['standard', 'wild', 'entertainment']) {
        const profile = createDefaultProfile();
        profile.career.quick = { distance: 400, rule };
        const restored = normalizeProfile(JSON.parse(JSON.stringify(profile)));
        assert.equal(restored.career.quick.distance, 400);
        restored.career.quick.distance = 401;
        assert.equal(normalizeProfile(restored).career.quick.distance, 200);
    }
    for (const rule of ['stimulant', 'shark', 'whirlpool', 'cannon', 'timed-bomb', 'minefield']) {
        const profile = createDefaultProfile(); profile.career.quick = { distance: 400, rule };
        assert.equal(normalizeProfile(profile).career.quick.distance, 200, '独立玩法仍保持原有短赛程约束');
    }
});

test('倒地时跳水兜底不重启 motor，正常丢失跳水仍可恢复', () => {
    const force = method('assets/scripts/entity/Swimmer.ts', 'Swimmer', 'forceEnterRaceAt', { Tween: { stopAllByTarget() {} } });
    const swimmer = { _entertainmentKnocked: true, _motor: { isRacing: false }, node: {}, startRace() { this._motor.isRacing = true; } };
    force.call(swimmer, 60);
    assert.equal(swimmer._motor.isRacing, false);
    swimmer._entertainmentKnocked = false;
    force.call(swimmer, 60);
    assert.equal(swimmer._motor.isRacing, true);
});

test('炸弹画中画只为当前可见携带者保活动作，不受渲染隔帧影响', () => {
    const keeps = method('assets/scripts/camera/RaceEventPictureInPictureCamera.ts', 'RaceEventPictureInPictureCamera', 'keepsSwimmerAnimated');
    const carrier = { isValid: true };
    const other = { isValid: true };
    const pip = { active: true, mode: 'timed-bomb', timedBombCarrier: carrier, camera: { enabled: false } };
    assert.equal(keeps.call(pip, carrier), true);
    assert.equal(keeps.call(pip, other), false);
    pip.timedBombCarrier = other;
    assert.equal(keeps.call(pip, carrier), false);
    assert.equal(keeps.call(pip, other), true);
    pip.active = false;
    assert.equal(keeps.call(pip, other), false);
    pip.active = true; pip.mode = 'shark';
    assert.equal(keeps.call(pip, other), false);
});

test('真实垃圾碰撞被快照抢先后仍补结算一次，轨迹不回拨', () => {
    const racers = Array.from({ length: 8 }, (_, lane) => ({ active: true, finished: false, distance: 0, lateral: -7 + lane * 2 }));
    const contacts = [];
    const make = fn => new LitterBrawlController(8, 49, 20, lane => racers[lane], () => {}, () => {}, { waveDistances: [0], landingLeadDistance: 7 }, undefined, fn);
    const host = make(contact => contacts.push(contact));
    host.update(LITTER_BRAWL_TUNING.fallingSeconds + .1, GameState.RACING);
    const rigid = host.clusters().find(slot => slot.active && slot.kind === 'rigid');
    racers[0].distance = rigid.courseX; racers[0].lateral = rigid.lateral;
    host.update(.05, GameState.RACING);
    assert.equal(contacts.length, 1);
    const guest = make(() => {});
    guest.applySnapshotState(host.snapshotState());
    const before = JSON.stringify(guest.snapshotState());
    assert.equal(guest.applyContact(contacts[0]), true);
    assert.equal(guest.applyContact(contacts[0]), false);
    assert.equal(JSON.stringify(guest.snapshotState()), before);
    const late = make(() => {});
    late.applySnapshotState({ ...host.snapshotState(), elapsedSeconds: contacts[0].elapsedSeconds + 4 });
    assert.equal(late.applyContact(contacts[0]), false);
});

test('水雷快照不吞外围冲击，重复与超过三秒的迟到冲量被拒绝', () => {
    const make = () => new MinefieldBrawlController(1, 2026, 20, () => ({ active: true, finished: false, distance: 0, lateral: 0 }), () => {});
    const host = make(), guest = make();
    const impact = { mineId: 0, hitLane: 0, hitMask: 1, courseX: 30, lateral: 0, revision: 1, elapsedSeconds: 0 };
    assert.equal(host.applyImpact(impact), true);
    guest.applySnapshotState(host.snapshotState());
    assert.equal(guest.applyImpact(impact), true);
    assert.equal(guest.applyImpact(impact), false);
    const late = make(); late.applySnapshotState({ ...host.snapshotState(), elapsedSeconds: 4 });
    assert.equal(late.applyImpact(impact), false);
});

test('跨通道编码保留返场代次和接触时钟，普通输入不添加元数据', () => {
    const events = [{ kind: 'l', cannonStrikeId: 0, targetDistance: 80, targetZ: 0, warningSeconds: 2, revision: 1, eventEpoch: 9 },
        { kind: 'i', mineId: 0, mineHitLane: 0, mineDistance: 20, mineLateral: 0, hitMask: 1, revision: 3, effectTime: 4.125 }];
    const decoded = decodeInputFrame(encodeInputFrame(0, events)).events;
    assert.equal(decoded[0].eventEpoch, 9);
    assert.equal(decoded[1].effectTime, 4.125);
    assert.equal(encodeInputFrame(0, [{ kind: 's', side: 0 }]).includes('~'), false);
});

test('旧轮整包和旧轮事件不能覆盖返场炮火，新轮先到事件等待控制器重置', () => {
    const receiver = net();
    const cannon = new CannonBrawlController(1, 10, 16, () => ({ active: true, finished: false, distance: 50, lateral: 0 }), () => {}, () => {});
    let directorRevision = 0;
    receiver.setEntertainmentDirectorStateListener(state => {
        if (state.revision < directorRevision) return false;
        directorRevision = state.revision; return true;
    });
    receiver.setGameplayEventEpochListener((slot, epoch) => { cannon.restart([100, 110]); receiver.setGameplayEventEpoch(slot, epoch); });
    receiver.setCannonStateListener(state => cannon.applySnapshotState(state));
    receiver.setCannonLaunchListener((strikeId, targetDistance, targetZ, warningSeconds, revision) => cannon.applyLaunch({ strikeId, targetDistance, targetZ, warningSeconds, revision }));
    const director = new EntertainmentModeDirector(123, 200).snapshot();
    const fresh = { revision: 0, completedStrikeMask: 0, activeStrikeId: -1, targetDistance: 0, targetZ: 0, remainingSeconds: 0 };
    const snapshot = (rev, epoch, state) => encodeRaceSnapshot(0, [], null, null, state, null, null, null, { ...director, revision: rev }, [epoch, 0, 0]);
    receiver.onBroadcast(wire(snapshot(1, 1, { ...fresh, revision: 4, completedStrikeMask: 3 })));
    const launch = { kind: 'l', cannonStrikeId: 0, targetDistance: 105, targetZ: 0, warningSeconds: 2, revision: 1, eventEpoch: 2 };
    receiver.processAuthoritativeEvents(0, [launch, launch]);
    assert.equal(receiver._deferredGameplayEvents.length, 1);
    receiver.onBroadcast(wire(snapshot(2, 2, fresh)));
    assert.equal(cannon.currentLaunch().targetDistance, 105);
    receiver.onBroadcast(wire(snapshot(1, 1, { ...fresh, revision: 4, completedStrikeMask: 3 })));
    receiver.processAuthoritativeEvents(0, [{ ...launch, eventEpoch: 1, targetDistance: 999, revision: 99 }]);
    assert.equal(cannon.currentLaunch().targetDistance, 105);
    assert.equal(cannon.remainingStrikeCount(), 2);
    assert.equal(receiver._deferredGameplayEvents.length, 0);
    receiver.dispose();
});

test('导演实际拒绝旧修订和非法状态，并明确通知调用方不要灌入子状态', () => {
    const director = new EntertainmentModeDirector(123, 400);
    const initial = director.snapshot();
    assert.equal(director.applySnapshot({ ...initial, revision: 2 }).snapshotAccepted, true);
    assert.equal(director.applySnapshot(initial).snapshotAccepted, false);
    assert.equal(director.applySnapshot({ ...initial, revision: 3, eventCount: 99 }).snapshotAccepted, false);
    assert.equal(director.snapshot().revision, 2);
});

test('炸弹和鲨鱼按各自代次隔离，驻留水雷及全局急救不因其他事件返场被丢弃', () => {
    const receiver = net();
    const hits = [];
    receiver.setGameplayEventEpoch(1, 8); receiver.setGameplayEventEpoch(2, 9);
    receiver.setMineRelayArmListener((round, lane) => hits.push(['bomb', lane]));
    receiver.setSharkKnockdownListener((seq, lane) => hits.push(['shark', lane]));
    receiver.setMinefieldImpactListener(() => hits.push(['mine']));
    receiver.setEntertainmentKnockdownListener(() => hits.push(['recovery']));
    const bomb = { kind: 'm', mineRoundId: 0, mineCarrierLane: 1, fuseSeconds: 8, revision: 1, eventEpoch: 7 };
    const shark = { kind: 'e', sharkSequence: 1, targetLane: 2, knockedDistance: 20, eventEpoch: 8 };
    receiver.processAuthoritativeEvents(0, [bomb, shark]);
    assert.equal(hits.length, 0);
    receiver.processAuthoritativeEvents(0, [{ ...bomb, eventEpoch: 8 }, { ...shark, eventEpoch: 9 },
        { kind: 'i', mineId: 0, mineHitLane: 0, mineDistance: 20, mineLateral: 0, hitMask: 1, revision: 1 },
        { kind: 'u', recoveryLane: 0, recoveryReason: 4, knockedDistance: 20, revision: 1 }]);
    assert.deepEqual(hits, [['bomb', 1], ['shark', 2], ['mine'], ['recovery']]);
    receiver.dispose();
});

test('迁移后的新房主沿用三类代次发送事件与快照，旧房主待收事件不回放', () => {
    const receiver = net();
    receiver.setGameplayEventEpochListener((slot, epoch) => receiver.setGameplayEventEpoch(slot, epoch));
    receiver.onBroadcast(wire(encodeRaceSnapshot(0, [], null, null, null, null, null, null, null, [7, 8, 9])));
    receiver.processAuthoritativeEvents(0, [{ kind: 'e', sharkSequence: 1, targetLane: 0, knockedDistance: 20, eventEpoch: 10 }]);
    receiver.promoteToHost();
    receiver.flushDeferredGameplayEvents();
    assert.equal(receiver._deferredGameplayEvents.length, 0);
    receiver.enqueueCannonLaunch(0, 10, 0, 2, 1);
    receiver.enqueueMineRelayArm(0, 1, 8, 1);
    receiver.enqueueSharkKnockdown(1, 2, 20);
    assert.deepEqual(decodeInputFrame(encodeInputFrame(1, receiver._authoritativeEvents)).events.map(event => event.eventEpoch), [7, 8, 9]);
    broadcasts.length = 0; receiver.sendSnapshot([]);
    assert.deepEqual(decodeRaceSnapshot(body(broadcasts[0])).eventEpochs, [7, 8, 9]);
    receiver.dispose();
});

test('接触结算窗口允许不同事件乱序，但保持有界并拒绝重复', () => {
    const { ContactEventWindow } = load('assets/scripts/core/RaceContactGeometry.ts');
    const window = new ContactEventWindow();
    assert.equal(window.accept(4), true);
    assert.equal(window.accept(2), true);
    assert.equal(window.accept(2), false);
    for (let revision = 5; revision < 500; revision++) window.accept(revision);
    assert.ok(window.seen.size <= 128);
    assert.equal(window.accept(2), false);
    window.reset(); assert.equal(window.accept(2), true);
});

test('多次补给快照补账按实际领取顺序，乱序可靠事件也不能颠倒苏打与冰沙', () => {
    const kinds = ['calm-slush', 'stimulant'];
    const first = { itemId: 1, collectorLane: 0, revision: 1 };
    const second = { itemId: 0, collectorLane: 0, revision: 2 };
    const host = pickups('stimulant', kinds);
    host.controller.applyPickup(first); host.controller.applyPickup(second);
    for (const eventFirst of [false, true]) {
        const guest = pickups('stimulant', kinds);
        if (eventFirst) guest.controller.applyPickup(second);
        const receiver = net();
        receiver.setStimulantStateListener(state => guest.controller.applySnapshotState(state));
        receiver.onBroadcast(wire(encodeRaceSnapshot(0, [], host.controller.snapshotState())));
        guest.controller.applyPickup(first); guest.controller.applyPickup(second);
        assert.deepEqual(guest.result.order, host.result.order);
        assert.equal(guest.result.heartRate, 120);
        assert.equal(guest.result.calm, true);
        receiver.dispose();
    }
});

test('迟到可靠帧仍结算独立命中事件，但不重放旧普通输入', () => {
    const receiver = net();
    const { ContactEventWindow } = load('assets/scripts/core/RaceContactGeometry.ts');
    const effects = new ContactEventWindow();
    let hitCount = 0;
    const inputs = [];
    receiver.setMinefieldImpactListener((id, lane, x, z, mask, revision) => { if (effects.accept(revision)) hitCount++; });
    receiver.processRemotePacket = (sender, seq) => inputs.push(seq);
    receiveFrame(receiver, { frameId: 20, items: [encodeInputFrame(0, [{ kind: 'H', side: 0 }], undefined, undefined, 20)] });
    const late = { frameId: 19, items: [encodeInputFrame(0, [
        { kind: 'h', side: 0 },
        { kind: 'i', mineId: 0, mineHitLane: 0, mineDistance: 20, mineLateral: 0, hitMask: 1, revision: 1 },
    ], undefined, undefined, 19)] };
    receiveFrame(receiver, late); receiveFrame(receiver, late);
    assert.equal(hitCount, 1);
    assert.deepEqual(inputs, [20]);
    receiver.dispose();
});

test('权威事件先于玩法监听创建时保留，绑定后恰好补结算一次', () => {
    const receiver = net();
    const guest = pickups();
    const event = { kind: 'p', itemId: 0, collectorLane: 0, revision: 1 };
    receiver.processAuthoritativeEvents(0, [event, event]);
    receiver.setStimulantPickupListener((itemId, collectorLane, revision) => guest.controller.applyPickup({ itemId, collectorLane, revision }));
    receiver.flushDeferredGameplayEvents();
    assert.equal(guest.result.effects, 1);
    assert.equal(receiver._deferredGameplayEvents.length, 0);
    receiver.dispose();
});

test('垃圾接触先于首次槽位快照时等待，同代快照到达后补结算一次', () => {
    const racers = Array.from({ length: 8 }, (_, lane) => ({ active: true, finished: false, distance: 0, lateral: -7 + lane * 2 }));
    const contacts = [];
    const host = new LitterBrawlController(8, 49, 20, lane => racers[lane], () => {}, () => {},
        { waveDistances: [0], landingLeadDistance: 7 }, undefined, contact => contacts.push(contact));
    host.update(LITTER_BRAWL_TUNING.fallingSeconds + .1, GameState.RACING);
    const rigid = host.clusters().find(slot => slot.active && slot.kind === 'rigid');
    racers[0].distance = rigid.courseX; racers[0].lateral = rigid.lateral;
    host.update(.05, GameState.RACING);
    let impacts = 0;
    const guest = new LitterBrawlController(8, 49, 20, lane => racers[lane], () => {}, () => impacts++,
        { waveDistances: [0], landingLeadDistance: 7 });
    assert.equal(guest.applyContact(contacts[0]), false);
    assert.equal(guest.applyContact(contacts[0]), false);
    guest.applySnapshotState(host.snapshotState());
    guest.applySnapshotState(host.snapshotState());
    assert.equal(impacts, 1);
    assert.equal(guest.applyContact(contacts[0]), false);
});

test('广播降级丢失首次接触事件后有限重发，重复包不重复冲击', () => {
    const host = net(); host._session.localPos = 0; host.promoteToHost(); host._peerNeedsBroadcast = true;
    host.enqueueMinefieldImpact(0, 0, 20, 0, 1, 1, 0);
    host._authoritativeEvents.length = 0; // 首次帧与广播均未抵达。
    broadcasts.length = 0; host.sendSnapshot([]);
    const retry = broadcasts.find(message => body(message).startsWith('IN|'));
    assert.ok(retry, '周期发送应保留短期接触恢复副本');
    const guest = net();
    const { ContactEventWindow } = load('assets/scripts/core/RaceContactGeometry.ts');
    const window = new ContactEventWindow(); let hits = 0;
    guest.setMinefieldImpactListener((id, lane, x, z, mask, revision) => { if (window.accept(revision)) hits++; });
    guest.onBroadcast(retry); guest.onBroadcast(retry);
    assert.equal(hits, 1);
    host.dispose(); guest.dispose();
});

test('冲击重发限制缓存、单包与期限，正常可靠模式不增加广播', () => {
    const host = net(); host._session.localPos = 0; host.promoteToHost();
    for (let revision = 1; revision <= 100; revision++) host.enqueueMinefieldImpact(0, 0, 20, 0, 1, revision, 0);
    assert.equal(host._contactRecoveryEvents.length, 32);
    broadcasts.length = 0; host.sendSnapshot([]);
    assert.equal(broadcasts.filter(message => body(message).startsWith('IN|')).length, 0);
    host._peerNeedsBroadcast = true;
    const seen = new Set();
    for (let i = 0; i < 8; i++) {
        broadcasts.length = 0; host.sendSnapshot([]);
        const retry = broadcasts.find(message => body(message).startsWith('IN|'));
        const frame = decodeInputFrame(body(retry).slice(3));
        assert.equal(frame.events.length, 4);
        assert.ok(Buffer.byteLength(retry) < 1536);
        for (const event of frame.events) seen.add(event.revision);
    }
    assert.equal(seen.size, 32);
    for (const pending of host._contactRecoveryEvents) pending.expiresAt = 0;
    broadcasts.length = 0; host.sendSnapshot([]);
    assert.equal(host._contactRecoveryEvents.length, 0);
    assert.equal(broadcasts.filter(message => body(message).startsWith('IN|')).length, 0);
    host.enqueueMinefieldImpact(0, 0, 20, 0, 1, 101, 0);
    host.dispose(); assert.equal(host._contactRecoveryEvents.length, 0);
});

test('不同补给编号和领取顺序经过缺序快照及逆序事件后仍与房主一致', () => {
    const kinds = ['calm-slush', 'stimulant', 'calm-slush', 'stimulant'];
    function permutations(values) {
        if (!values.length) return [[]];
        return values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index)).map(tail => [value, ...tail]));
    }
    for (const order of permutations([0, 1, 2, 3])) {
        const host = pickups('stimulant', kinds);
        const guest = pickups('stimulant', kinds);
        const events = order.map((itemId, i) => ({ itemId, collectorLane: 0, revision: i + 1 }));
        for (const event of events) host.controller.applyPickup(event);
        guest.controller.applyPickup(events[3]);
        const partial = decodeRaceSnapshot(encodeRaceSnapshot(0, [], guest.controller.snapshotState()));
        assert.equal(partial.stimulantPickupRevisions[events[3].itemId], 4);
        const restored = pickups('stimulant', kinds);
        restored.controller.applySnapshotState({ revision: 4, collectedMask: partial.stimulantMask,
            collectorLanes: partial.stimulantCollectors, pickupRevisions: partial.stimulantPickupRevisions });
        assert.equal(restored.result.effects, 0);
        for (const event of [...events].reverse()) restored.controller.applyPickup(event);
        restored.controller.applySnapshotState(host.controller.snapshotState());
        assert.deepEqual(restored.result.order, host.result.order);
        assert.equal(restored.result.heartRate, host.result.heartRate);
        assert.equal(restored.result.calm, host.result.calm);
    }
});
