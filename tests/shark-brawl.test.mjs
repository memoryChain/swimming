import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import SharkTuning from '../assets/scripts/entity/SharkTuning.ts';
import SharkObstacleBiteRules from '../assets/scripts/entity/SharkObstacleBiteTracker.ts';
import CareerRules from '../assets/scripts/progression/CareerRules.ts';
import PlayerProfile from '../assets/scripts/backend/PlayerProfile.ts';

const { SHARK_TUNING, SharkState } = SharkTuning;
const { SharkObstacleBiteTracker } = SharkObstacleBiteRules;
const { executeCareer } = CareerRules;
const { createDefaultProfile, normalizeProfile } = PlayerProfile;

test('鲨鱼大乱斗固定进行三轮追猎并在第三轮后退场', () => {
    assert.deepEqual(SHARK_TUNING.hungerSchedule, [15, 35, 55]);
    assert.ok(SHARK_TUNING.warningSeconds > 0);
    assert.ok(SHARK_TUNING.huntOpeningGraceSeconds > 0);
    assert.ok(SHARK_TUNING.huntSeconds > 0);
    assert.equal(SharkState.WANDER, 4);
    assert.equal(SharkState.SATIATED, 5);
});

test('巡游鲨鱼只会处决持续逆向纠缠的选手', () => {
    const tracker = new SharkObstacleBiteTracker({
        blockedSeconds: SHARK_TUNING.obstacleBiteBlockedSeconds,
        reverseDistance: SHARK_TUNING.obstacleBiteReverseDistance,
        forwardSpeedTolerance: SHARK_TUNING.obstacleBiteForwardSpeedTolerance,
        sameTargetCooldownSeconds: SHARK_TUNING.obstacleBiteSameTargetCooldownSeconds,
        globalCooldownSeconds: SHARK_TUNING.obstacleBiteGlobalCooldownSeconds,
    });
    const sample = (overrides = {}) => ({
        lane: 2,
        contact: true,
        opposing: true,
        damageable: true,
        distance: 50,
        ...overrides,
    });
    const advance = value => tracker.sample(
        value.lane,
        value.contact,
        value.opposing,
        value.damageable,
        value.distance,
        tracker.beginFrame(0.1),
    );

    assert.equal(advance(sample()), false);
    let triggered = false;
    for (let i = 0; i < 17; i++) triggered ||= advance(sample());
    assert.equal(triggered, true);

    tracker.reset();
    for (let i = 0; i < 20; i++) assert.equal(advance(sample({ opposing: false })), false);
    for (let i = 0; i < 20; i++) {
        assert.equal(advance(sample({ distance: 50 + i * 0.1 })), false);
    }
});

test('巡游鲨鱼被反向推走八十厘米时会提前处决，短暂分离会重置计时', () => {
    const tracker = new SharkObstacleBiteTracker({
        blockedSeconds: SHARK_TUNING.obstacleBiteBlockedSeconds,
        reverseDistance: SHARK_TUNING.obstacleBiteReverseDistance,
        forwardSpeedTolerance: SHARK_TUNING.obstacleBiteForwardSpeedTolerance,
        sameTargetCooldownSeconds: SHARK_TUNING.obstacleBiteSameTargetCooldownSeconds,
        globalCooldownSeconds: SHARK_TUNING.obstacleBiteGlobalCooldownSeconds,
    });
    const advance = (distance, contact = true) => tracker.sample(
        1,
        contact,
        true,
        true,
        distance,
        tracker.beginFrame(0.1),
    );

    assert.equal(advance(30), false);
    for (let i = 0; i < 8; i++) assert.equal(advance(30), false);
    assert.equal(advance(30, false), false);
    for (let i = 0; i < 8; i++) assert.equal(advance(30), false);

    let triggered = false;
    for (let distance = 29.8; distance >= 29; distance -= 0.2) triggered ||= advance(distance);
    assert.equal(triggered, true);
    assert.equal(advance(28), false);
});

test('鲨鱼模式使用固定场景控制器而非角色技能召唤', () => {
    const controller = readFileSync(
        new URL('../assets/scripts/entity/SharkController.ts', import.meta.url),
        'utf8',
    );
    assert.match(controller, /hungerSchedule/);
    assert.match(controller, /beginHuntBeat/);
    assert.match(controller, /resolveObstacleCollisions/);
    assert.match(controller, /updateObstacleBites/);
    assert.match(controller, /onKnockDown/);
    assert.match(controller, /knockedLane/);
    assert.doesNotMatch(controller, /eliminatedMask|applyElimination/);
    assert.doesNotMatch(controller, /trySummon|ownerLane/);
    assert.equal(existsSync(new URL('../assets/race/models/SharkModel.glb', import.meta.url)), true);
});

test('鲨鱼首次现身会先激活节点再启动警告动画', () => {
    const controller = readFileSync(
        new URL('../assets/scripts/entity/SharkController.ts', import.meta.url),
        'utf8',
    );
    const beginIndex = controller.indexOf('private beginHuntBeat(): void');
    const activateIndex = controller.indexOf(
        'if (!this._opts.node.active) this._opts.node.active = true;',
        beginIndex,
    );
    const warningIndex = controller.indexOf('this.setState(SharkState.WARNING);', beginIndex);
    assert.ok(beginIndex >= 0);
    assert.ok(activateIndex > beginIndex);
    assert.ok(warningIndex > activateIndex);
});

test('鲨鱼首轮从水下上浮且上浮完成前不参与碰撞', () => {
    assert.ok(SHARK_TUNING.entryRiseSeconds > 0);
    assert.ok(SHARK_TUNING.entryRiseSeconds < SHARK_TUNING.warningSeconds);
    assert.ok(SHARK_TUNING.entryStartDepth > 0);
    assert.ok(SHARK_TUNING.entrySplashProgress > 0 && SHARK_TUNING.entrySplashProgress < 1);

    const controller = readFileSync(
        new URL('../assets/scripts/entity/SharkController.ts', import.meta.url),
        'utf8',
    );
    const presentation = readFileSync(
        new URL('../assets/scripts/core/SharkEntryPresentation.ts', import.meta.url),
        'utf8',
    );
    assert.match(controller, /get entryProgress\(\): number/);
    assert.match(controller, /if \(this\.entryActive \|\| \(this\._state !== SharkState\.WANDER/);
    assert.match(presentation, /shark\.sequence === 1/);
    assert.match(presentation, /owner: ENTERTAINMENT_SPLASH_OWNER\.SHARK_ENTRY/);
    assert.match(presentation, /profile: ENTERTAINMENT_SPLASH_PROFILE\.HEAVY_ENTRY/);
    assert.match(presentation, /layer: this\.splashLayer/);
    assert.doesNotMatch(presentation, /Graphics|ParticleSystem/);
});

test('鲨鱼咬伤只复用画中画可见的大水花进行遮挡', () => {
    const manager = readFileSync(
        new URL('../assets/scripts/core/GameManager.ts', import.meta.url),
        'utf8',
    );
    const rig = readFileSync(
        new URL('../assets/scripts/entity/CartoonSwimmerRig.ts', import.meta.url),
        'utf8',
    );
    const knockdownIndex = manager.indexOf('private applySharkKnockDown(');
    const knockdownEnd = manager.indexOf('private activeSharkSwimmers()', knockdownIndex);
    const knockdownSource = manager.slice(knockdownIndex, knockdownEnd);
    assert.match(knockdownSource, /setLayerRecursive\(splashNode, SWIMMER_LAYER\)/);
    assert.match(knockdownSource, /getWorldPosition\(this\._sharkBiteWorldPosition\)/);
    assert.match(knockdownSource, /triggerBigSplashAt\(this\._sharkBiteWorldPosition, 3\.1\)/);
    assert.match(manager, /swimmer === sharkFeedTarget/);
    assert.match(knockdownSource, /setSplashCulled\(false\)/);
    assert.match(knockdownSource, /_sharkSplashFocusSeconds = Math\.max\(1, SHARK_TUNING\.biteCameraHoldSeconds\)/);
    assert.match(manager, /setEntertainmentKnocked\(0\.18\)/);
    assert.match(rig, /triggerBigSplashAt\(point: Vec3, scale = 2\.6\)/);
    assert.match(rig, /triggerTakeoffSurfaceBurst\(scale, point\)/);
    assert.match(rig, /transitionTo\(CharacterPoseState\.TreadWater, transitionSeconds\)/);
    assert.doesNotMatch(manager, /SharkBiteOcclusion|_sharkBiteOcclusion/);
    assert.equal(existsSync(new URL('../assets/scripts/entity/SharkBiteOcclusionEffect.ts', import.meta.url)), false);
});

test('鲨鱼锁定标记缓存投影组件并只在量化结果变化时写变换', () => {
    const overlay = readFileSync(
        new URL('../assets/scripts/ui/SharkLockOnOverlay.ts', import.meta.url),
        'utf8',
    );
    assert.match(overlay, /const UPDATE_INTERVAL_MS = 34;/);
    assert.match(overlay, /private _hudTransform: UITransform \| null = null;/);
    assert.match(overlay, /if \(x !== this\._lastX \|\| y !== this\._lastY\)/);
    assert.match(overlay, /if \(pulse !== this\._lastPulse\)/);
    const updateIndex = overlay.indexOf('update(shark: SharkController');
    const hideIndex = overlay.indexOf('hide(): void', updateIndex);
    const updateSource = overlay.slice(updateIndex, hideIndex);
    assert.doesNotMatch(updateSource, /getComponent\(UITransform\)/);
    assert.doesNotMatch(updateSource, /Graphics\.clear|\.clear\(\)/);
});

test('鲨鱼规则只允许快速比赛二百米并可从存档恢复', () => {
    const profile = createDefaultProfile();
    const characterId = Object.keys(profile.characters)[0];
    const ok = executeCareer(profile, {
        type: 'begin', source: 'quick', characterId, tier: 0, distance: 200, rule: 'shark', seed: 17,
    });
    assert.equal(ok.ok, true);
    assert.equal(normalizeProfile(profile).career.quick.rule, 'shark');
    assert.equal(executeCareer(createDefaultProfile(), {
        type: 'begin', source: 'quick', characterId, tier: 0, distance: 400, rule: 'shark', seed: 17,
    }).ok, false);
    assert.equal(executeCareer(createDefaultProfile(), {
        type: 'begin', source: 'league', characterId, tier: 0, distance: 200, rule: 'shark', seed: 17,
    }).ok, false);
});
