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

function readGlbJson(buffer) {
    assert.equal(buffer.toString('ascii', 0, 4), 'glTF');
    const jsonLength = buffer.readUInt32LE(12);
    const jsonChunkType = buffer.toString('ascii', 16, 20);
    assert.equal(jsonChunkType, 'JSON');
    return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
}

function animationMaxTime(gltf, name) {
    const animation = gltf.animations.find(candidate => candidate.name === name);
    assert.ok(animation, `missing animation ${name}`);
    return Math.max(...animation.samplers.map(sampler => gltf.accessors[sampler.input].max[0]));
}

test('鲨鱼大乱斗固定进行三轮追猎并在第三轮后退场', () => {
    assert.deepEqual(SHARK_TUNING.hungerSchedule, [15, 35, 55]);
    assert.ok(SHARK_TUNING.warningSeconds > 0);
    assert.ok(SHARK_TUNING.huntOpeningGraceSeconds > 0);
    assert.ok(SHARK_TUNING.huntSeconds > 0);
    assert.equal(SHARK_TUNING.biteAnticipationSeconds, 0.09);
    assert.ok(SHARK_TUNING.biteAnticipationSeconds < SHARK_TUNING.bitePresentationSeconds);
    assert.ok(SHARK_TUNING.biteLungeSpeed <= 1);
    assert.equal(SharkState.WANDER, 4);
    assert.equal(SharkState.SATIATED, 5);
    assert.equal(SharkState.PATROL_BITE, 6);
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

test('巡游补咬先进入独立咬合节奏，结束后不推进正式追猎轮次', () => {
    const controller = readFileSync(
        new URL('../assets/scripts/entity/SharkController.ts', import.meta.url),
        'utf8',
    );
    const obstacleIndex = controller.indexOf('updateObstacleBites(swimmers: readonly Swimmer[], dt: number)');
    const finishPatrolIndex = controller.indexOf('private finishPatrolBite(): void', obstacleIndex);
    const obstacleSource = controller.slice(obstacleIndex, finishPatrolIndex);
    const finishHuntIndex = controller.indexOf('private finishHunt(): void', finishPatrolIndex);
    const finishPatrolSource = controller.slice(finishPatrolIndex, finishHuntIndex);
    assert.match(obstacleSource, /this\._target = swimmer/);
    assert.match(obstacleSource, /this\._remainingSeconds = Math\.max\(0\.05, SHARK_TUNING\.bitePresentationSeconds\)/);
    assert.match(obstacleSource, /this\.setState\(SharkState\.PATROL_BITE\)/);
    assert.doesNotMatch(obstacleSource, /this\._opts\.onKnockDown\(swimmer\)/);
    assert.match(finishPatrolSource, /this\.setState\(SharkState\.WANDER\)/);
    assert.doesNotMatch(finishPatrolSource, /_huntIndex\+\+/);
    assert.match(controller, /this\._state === SharkState\.BITE \|\| this\._state === SharkState\.PATROL_BITE/);
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

test('充气玩具鲨使用兼容骨架、闭合嘴与分段接触动作', () => {
    const gltf = readGlbJson(readFileSync(new URL('../assets/race/models/SharkModel.glb', import.meta.url)));
    const art = readFileSync(new URL('../assets/scripts/core/SharkArtPresentation.ts', import.meta.url), 'utf8');
    const source = JSON.parse(readFileSync(new URL('../art/shark-animation/source-audit.json', import.meta.url), 'utf8'));
    assert.equal(gltf.skins.length, 1);
    assert.equal(gltf.skins[0].joints.length, 7);
    assert.equal(gltf.meshes.length, 1);
    assert.equal(gltf.meshes[0].primitives.length, 1);
    assert.equal(gltf.materials.length, 1);
    assert.equal(gltf.images?.length ?? 0, 0);
    assert.ok(gltf.nodes.some(node => node.name === 'Shark_Jaw'));
    assert.ok(Math.abs(animationMaxTime(gltf, 'Shark_Bite') - 10 / 24) < 1e-6);
    assert.ok(Math.abs(animationMaxTime(gltf, 'Shark_Swim_Loop') - 1) < 1e-6);
    assert.ok(source.jaw_weighted_vertices > 0);
    assert.equal(source.rest_matrices_unchanged, true);
    assert.match(art, /sharkContactClipTime/);
    assert.match(art, /AnimationClip.WrapMode.Loop/);
    assert.doesNotMatch(art, /biteDrop|tween\(/);
});

test('正式咬合先停顿蓄势，再在闭合节点结算击倒并开始前扑', () => {
    const controller = readFileSync(
        new URL('../assets/scripts/entity/SharkController.ts', import.meta.url),
        'utf8',
    );
    const resourcePaths = readFileSync(
        new URL('../assets/scripts/core/ResourcePaths.ts', import.meta.url),
        'utf8',
    );
    const biteIndex = controller.indexOf(
        'if (this._state === SharkState.BITE || this._state === SharkState.PATROL_BITE)',
    );
    const warningIndex = controller.indexOf('if (this._state === SharkState.WARNING)', biteIndex);
    const biteTick = controller.slice(biteIndex, warningIndex);
    const catchIndex = controller.indexOf('if (mouthDistanceSq <=');
    const chaseIndex = controller.indexOf('const distance = Math.sqrt', catchIndex);
    const catchTransition = controller.slice(catchIndex, chaseIndex);
    assert.match(biteTick, /SHARK_TUNING\.biteAnticipationSeconds/);
    assert.match(biteTick, /if \(!this\._biteResolved && elapsed >= anticipation\)/);
    assert.match(biteTick, /this\._opts\.onKnockDown\(target\)/);
    assert.match(biteTick, /const lungeSeconds = Math\.max\(0, elapsed - Math\.max\(previousElapsed, anticipation\)\)/);
    assert.match(catchTransition, /this\._biteResolved = false/);
    assert.doesNotMatch(catchTransition, /onKnockDown/);
    assert.match(controller, /const authoritativeResolved = duration - this\._remainingSeconds \+ 0\.001 >= anticipation/);
    assert.match(resourcePaths, /biteSplashDelaySeconds: 0\.04/);
});

test('两条接触与可靠命中共用表现，晚加载补当前状态而非重新蓄势', () => {
    const manager = readFileSync(new URL('../assets/scripts/core/GameManager.ts', import.meta.url), 'utf8');
    const art = readFileSync(new URL('../assets/scripts/core/SharkArtPresentation.ts', import.meta.url), 'utf8');
    assert.match(manager, /state === SharkState\.BITE \|\| state === SharkState\.PATROL_BITE/);
    assert.match(manager, /_sharkArtPresentation\.bind\(model, animation, this\._shark\)/);
    assert.match(manager, /_sharkArtPresentation\.notifyContact\(revision, shark, swimmer.node, elapsedSinceHit\)/);
    assert.match(manager, /revision <= this\._lastSharkBitePresentationSequence/);
    assert.match(art, /revision <= this.lastSequence/);
    assert.match(art, /duration - shark.remainingSeconds/);
    assert.match(manager, /previousState !== SharkState\.PATROL_BITE/);
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

test('玩具顶推复用现有大水花与 B1 恢复', () => {
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
    assert.match(knockdownSource, /const splashPosition = this\._sharkBiteWorldPosition\.clone\(\)/);
    assert.match(knockdownSource, /this\.scheduleOnce\(\(\) =>/);
    assert.match(knockdownSource, /triggerBigSplashAt\(splashPosition, 3\.1\)/);
    assert.match(knockdownSource, /SHARK_MODEL_PRESENTATION\.biteSplashDelaySeconds/);
    assert.match(manager, /swimmer === sharkFeedTarget/);
    assert.match(knockdownSource, /setSplashCulled\(false\)/);
    assert.match(knockdownSource, /_sharkSplashFocusSeconds = Math\.max\(1, SHARK_TUNING\.biteCameraHoldSeconds\)/);
    assert.match(manager, /setEntertainmentKnocked\(CHARACTER_POSE_TUNING.recoveryFloatEnterSeconds\)/);
    assert.match(rig, /triggerBigSplashAt\(point: Vec3, scale = 2\.6\)/);
    assert.match(rig, /triggerTakeoffSurfaceBurst\(scale, point\)/);
    assert.match(rig, /transitionTo\(CharacterPoseState\.TreadWater, transitionSeconds\)/);
    assert.doesNotMatch(manager, /SharkBiteOcclusion|_sharkBiteOcclusion/);
    assert.equal(existsSync(new URL('../assets/scripts/entity/SharkBiteOcclusionEffect.ts', import.meta.url)), false);
});

test('鲨鱼锁定只使用分阶段池化追踪箭头', () => {
    const overlay = readFileSync(
        new URL('../assets/scripts/ui/SharkLockOnOverlay.ts', import.meta.url),
        'utf8',
    );
    assert.match(overlay, /const UPDATE_INTERVAL = 1 \/ 30;/);
    assert.match(overlay, /buildHuntRippleGeometry\(\)/);
    assert.match(overlay, /const TRAIL_COUNT = 3;/);
    assert.match(overlay, /state === SharkState\.WARNING \|\| state === SharkState\.HUNT/);
    assert.match(overlay, /state === SharkState\.HUNT \? HUNT_ARROW_COLOR : WARNING_ARROW_COLOR/);
    assert.match(overlay, /const speed = hunting \? 0\.82 : 0\.38/);
    assert.match(overlay, /const spacing = hunting \? 0\.22 : 1 \/ this\._trails\.length/);
    assert.doesNotMatch(overlay, /TargetReticle|buildLockReticleGeometry|updateReticle/);
    assert.doesNotMatch(overlay, /Graphics|worldToScreen|screenToWorld|UITransform/);
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
