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
const room = { setCallbacks() {}, isSupported: () => true, broadcast: msg => broadcasts.push(msg) };
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
    return vm.runInNewContext(js, globals).prototype[methodName];
}
const { StimulantBrawlController } = load('assets/scripts/core/StimulantBrawlController.ts');
for (const name of ['createProgramVisuals', 'createBeaconVisuals', 'loadModelVisuals']) {
    StimulantBrawlController.prototype[name] = () => {};
}
const { NetRaceController } = load('assets/scripts/net/NetRaceController.ts');
const { encodeRaceSnapshot, decodeRaceSnapshot } = load('assets/scripts/net/NetRaceSnapshot.ts');
const { encodeInputFrame, decodeInputFrame } = load('assets/scripts/net/NetRaceInput.ts');
const { CannonBrawlController } = load('assets/scripts/core/CannonBrawlController.ts');
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
function net() {
    const instance = new NetRaceController({ localIsHost: false, localPos: 1, seed: 7, members: [{ pos: 0 }, { pos: 1 }] });
    instance._activeHostPos = 0;
    return instance;
}

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
        receiver.onBroadcast(payload);
        receiver.onBroadcast(payload);
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
    receiver.onBroadcast(snapshot(1, 1, { ...fresh, revision: 4, completedStrikeMask: 3 }));
    const launch = { kind: 'l', cannonStrikeId: 0, targetDistance: 105, targetZ: 0, warningSeconds: 2, revision: 1, eventEpoch: 2 };
    receiver.processAuthoritativeEvents(0, [launch, launch]);
    assert.equal(receiver._deferredGameplayEvents.length, 1);
    receiver.onBroadcast(snapshot(2, 2, fresh));
    assert.equal(cannon.currentLaunch().targetDistance, 105);
    receiver.onBroadcast(snapshot(1, 1, { ...fresh, revision: 4, completedStrikeMask: 3 }));
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
    receiver.onBroadcast(encodeRaceSnapshot(0, [], null, null, null, null, null, null, null, [7, 8, 9]));
    receiver.processAuthoritativeEvents(0, [{ kind: 'e', sharkSequence: 1, targetLane: 0, knockedDistance: 20, eventEpoch: 10 }]);
    receiver.promoteToHost();
    receiver.flushDeferredGameplayEvents();
    assert.equal(receiver._deferredGameplayEvents.length, 0);
    receiver.enqueueCannonLaunch(0, 10, 0, 2, 1);
    receiver.enqueueMineRelayArm(0, 1, 8, 1);
    receiver.enqueueSharkKnockdown(1, 2, 20);
    assert.deepEqual(decodeInputFrame(encodeInputFrame(1, receiver._authoritativeEvents)).events.map(event => event.eventEpoch), [7, 8, 9]);
    broadcasts.length = 0; receiver.sendSnapshot([]);
    assert.deepEqual(decodeRaceSnapshot(broadcasts[0]).eventEpochs, [7, 8, 9]);
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
        receiver.onBroadcast(encodeRaceSnapshot(0, [], host.controller.snapshotState()));
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
    receiver.onSyncFrame({ frameId: 20, items: [encodeInputFrame(0, [{ kind: 'H', side: 0 }], undefined, undefined, 20)] });
    const late = { frameId: 19, items: [encodeInputFrame(0, [
        { kind: 'h', side: 0 },
        { kind: 'i', mineId: 0, mineHitLane: 0, mineDistance: 20, mineLateral: 0, hitMask: 1, revision: 1 },
    ], undefined, undefined, 19)] };
    receiver.onSyncFrame(late); receiver.onSyncFrame(late);
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
    const retry = broadcasts.find(message => message.startsWith('IN|'));
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
    assert.equal(broadcasts.filter(message => message.startsWith('IN|')).length, 0);
    host._peerNeedsBroadcast = true;
    const seen = new Set();
    for (let i = 0; i < 8; i++) {
        broadcasts.length = 0; host.sendSnapshot([]);
        const retry = broadcasts.find(message => message.startsWith('IN|'));
        const frame = decodeInputFrame(retry.slice(3));
        assert.equal(frame.events.length, 4);
        assert.ok(Buffer.byteLength(retry) < 1536);
        for (const event of frame.events) seen.add(event.revision);
    }
    assert.equal(seen.size, 32);
    for (const pending of host._contactRecoveryEvents) pending.expiresAt = 0;
    broadcasts.length = 0; host.sendSnapshot([]);
    assert.equal(host._contactRecoveryEvents.length, 0);
    assert.equal(broadcasts.filter(message => message.startsWith('IN|')).length, 0);
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
