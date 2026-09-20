import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

import RecoveryModule from '../assets/scripts/core/EntertainmentRecoveryController.ts';
import RecoveryCopyModule from '../assets/scripts/ui/EntertainmentRecoveryCopy.ts';

const { EntertainmentRecoveryController, ENTERTAINMENT_RECOVERY_TUNING } = RecoveryModule;
const {
    ENTERTAINMENT_RECOVERY_COPY_POOLS,
    recoveryCopyTierForText,
    selectEntertainmentRecoveryCopy,
} = RecoveryCopyModule;
const ACTIVE = 0;
const KNOCKED = 1;
const INVULNERABLE = 2;
const SHARK = 1;
const CANNON = 2;
const TIMED_BOMB = 3;
const MINEFIELD = 4;

function fixture(lanes = 4) {
    const events = [];
    const controller = new EntertainmentRecoveryController(lanes, {
        onKnocked: (lane, state) => events.push(['knocked', lane, state.distance]),
        onRespawn: (lane, state) => events.push(['respawn', lane, state.distance]),
        onRecovered: lane => events.push(['recovered', lane]),
    });
    return { controller, events };
}

test('急救文案按正式、通用幽默和受击原因分池，并按长度使用三档字号', () => {
    assert.ok(ENTERTAINMENT_RECOVERY_COPY_POOLS.formal.includes('急救中'));
    for (const pool of Object.values(ENTERTAINMENT_RECOVERY_COPY_POOLS)) {
        assert.ok(pool.length >= 3);
        for (const copy of pool) {
            const length = Array.from(copy).length;
            assert.ok(length >= 3 && length <= 10, `${copy} 长度应在三到十字之间`);
        }
    }
    assert.equal(recoveryCopyTierForText('急救中'), 'large');
    assert.equal(recoveryCopyTierForText('队医冲刺中'), 'medium');
    assert.equal(recoveryCopyTierForText('泳帽还在问题不大'), 'small');
});

test('同一次权威击倒固定同一句急救文案，不新增玩法随机或联机字段', () => {
    const first = selectEntertainmentRecoveryCopy(SHARK, 2, 17);
    assert.deepEqual(selectEntertainmentRecoveryCopy(SHARK, 2, 17), first);
    const sharkSpecific = new Set(ENTERTAINMENT_RECOVERY_COPY_POOLS.shark);
    const cannonSpecific = new Set(ENTERTAINMENT_RECOVERY_COPY_POOLS.cannon);
    const sharkSeen = new Set();
    const cannonSeen = new Set();
    for (let revision = 1; revision <= 80; revision++) {
        sharkSeen.add(selectEntertainmentRecoveryCopy(SHARK, 2, revision).text);
        cannonSeen.add(selectEntertainmentRecoveryCopy(CANNON, 2, revision).text);
    }
    assert.ok([...sharkSeen].some(copy => sharkSpecific.has(copy)));
    assert.ok([...cannonSeen].some(copy => cannonSpecific.has(copy)));
    assert.ok([...sharkSeen].some(copy => !cannonSeen.has(copy)));
});

test('击倒后按等待、无敌、恢复三个阶段推进并保留权威距离', () => {
    const f = fixture();
    assert.equal(ENTERTAINMENT_RECOVERY_TUNING.knockedSeconds, 3.5);
    const savedTuning = JSON.parse(readFileSync(new URL('../assets/resources/config/tuning.json', import.meta.url), 'utf8'));
    assert.equal(savedTuning.values['recovery.knockedSeconds'], 3.5);
    const event = f.controller.tryKnockDown(2, SHARK, 54.32);
    assert.deepEqual(event, { lane: 2, reason: SHARK, distance: 54.32, revision: 1 });
    assert.equal(f.controller.stateForLane(2).phase, KNOCKED);
    assert.equal(f.controller.isDamageable(2), false);
    assert.equal(f.controller.tryKnockDown(2, CANNON, 60), null);

    f.controller.update(ENTERTAINMENT_RECOVERY_TUNING.knockedSeconds - 0.01);
    assert.equal(f.controller.stateForLane(2).phase, KNOCKED);
    f.controller.update(0.02);
    assert.equal(f.controller.stateForLane(2).phase, INVULNERABLE);
    assert.deepEqual(f.events.slice(0, 2), [['knocked', 2, 54.32], ['respawn', 2, 54.32]]);

    f.controller.update(ENTERTAINMENT_RECOVERY_TUNING.invulnerableSeconds);
    assert.equal(f.controller.stateForLane(2).phase, ACTIVE);
    assert.equal(f.controller.isDamageable(2), true);
    assert.deepEqual(f.events.at(-1), ['recovered', 2]);
});

test('恢复快照可补回丢失事件，且同版本旧阶段不能倒退本地状态', () => {
    const host = fixture(3);
    const guest = fixture(3);
    host.controller.applyKnockDown({ lane: 1, reason: CANNON, distance: 88.75, revision: 4 });
    assert.equal(guest.controller.applySnapshot(host.controller.snapshot()), true);
    assert.equal(guest.controller.stateForLane(1).phase, KNOCKED);

    host.controller.update(ENTERTAINMENT_RECOVERY_TUNING.knockedSeconds);
    assert.equal(guest.controller.applySnapshot(host.controller.snapshot()), true);
    assert.equal(guest.controller.stateForLane(1).phase, INVULNERABLE);

    assert.equal(guest.controller.applySnapshot({
        revision: 4,
        lanes: [
            { phase: ACTIVE, reason: 0, remainingSeconds: 0, distance: 0, revision: 0 },
            { phase: KNOCKED, reason: CANNON, remainingSeconds: 1, distance: 88.75, revision: 4 },
            { phase: ACTIVE, reason: 0, remainingSeconds: 0, distance: 0, revision: 0 },
        ],
    }), true);
    assert.equal(guest.controller.stateForLane(1).phase, INVULNERABLE);
});

test('定时炸弹致命命中复用同一套原进度重生和无敌流程', () => {
    const f = fixture();
    assert.equal(f.controller.applyKnockDown({
        lane: 0,
        reason: TIMED_BOMB,
        distance: 72.45,
        revision: 6,
    }), true);
    assert.equal(f.controller.stateForLane(0).phase, KNOCKED);
    assert.equal(f.controller.stateForLane(0).reason, TIMED_BOMB);
    f.controller.update(ENTERTAINMENT_RECOVERY_TUNING.knockedSeconds);
    assert.equal(f.controller.stateForLane(0).phase, INVULNERABLE);
    assert.deepEqual(f.events.slice(0, 2), [['knocked', 0, 72.45], ['respawn', 0, 72.45]]);
});

test('六合一水雷命中进入同一急救流程，恢复序号跨事件单调递增', () => {
    const f = fixture();
    const first = f.controller.tryKnockDown(0, MINEFIELD, 42.5);
    assert.equal(first.revision, 1);
    f.controller.update(ENTERTAINMENT_RECOVERY_TUNING.knockedSeconds + ENTERTAINMENT_RECOVERY_TUNING.invulnerableSeconds);
    const second = f.controller.tryKnockDown(1, SHARK, 67.25);
    assert.equal(second.revision, 2);
    assert.equal(f.controller.stateForLane(0).phase, ACTIVE);
    assert.equal(f.controller.stateForLane(1).reason, SHARK);
});

test('鲨鱼、炮火、定时炸弹和独立／六合一水雷接入复用泳者节点，不走永久淘汰', () => {
    const source = readFileSync(new URL('../assets/scripts/core/GameManager.ts', import.meta.url), 'utf8');
    assert.match(source, /respawnAfterEntertainmentHit/);
    assert.match(source, /setSharkKnockdownListener/);
    assert.match(source, /setEntertainmentKnockdownListener/);
    assert.match(source, /enqueueEntertainmentKnockdown/);
    assert.match(source, /stateForLane\(lane\)[\s\S]*?EntertainmentRecoveryPhase\.KNOCKED/);
    assert.doesNotMatch(source, /!this\._netRaceController\.isHost\) return false/);
    assert.match(source, /knockDownCannonHitLane/);
    assert.match(source, /EntertainmentRecoveryReason\.TIMED_BOMB/);
    assert.match(source, /EntertainmentRecoveryReason\.MINEFIELD/);
    const recoverySetup = source.match(/private setupEntertainmentRecovery[\s\S]*?\n    }/)?.[0] ?? '';
    assert.match(recoverySetup, /isMinefieldBrawlMode\(\)/);
    const minefieldImpact = source.match(/private handleMinefieldImpact[\s\S]*?\n    }/)?.[0] ?? '';
    assert.match(minefieldImpact, /applyEventKnockdown\([\s\S]*?EntertainmentRecoveryReason\.MINEFIELD/);
    assert.doesNotMatch(minefieldImpact, /if \(isEntertainmentBrawlMode\(\)\)/);
    assert.match(source, /isDamageable\(lane\)/);
    assert.match(source, /recovery\?\.phase === EntertainmentRecoveryPhase\.KNOCKED/);
    assert.doesNotMatch(source, /eliminateCannonHitLane|handleSharkElimination|enqueueSharkElimination/);
    const knockoutPresentation = source.match(/private presentEntertainmentKnockout[\s\S]*?\n    }/)?.[0] ?? '';
    assert.match(knockoutPresentation, /setEntertainmentKnocked\(0\.18\)/);
    assert.match(knockoutPresentation, /syncEntertainmentKnockoutPresentation/);
    assert.match(knockoutPresentation, /knockedSeconds - remainingSeconds/);
    assert.match(knockoutPresentation, /configureEntertainmentKnockoutLaunch/);
    assert.doesNotMatch(knockoutPresentation, /setFinishFloating\(/);
    assert.doesNotMatch(knockoutPresentation, /reason === EntertainmentRecoveryReason\.SHARK/);
    const swimmer = readFileSync(new URL('../assets/scripts/entity/Swimmer.ts', import.meta.url), 'utf8');
    assert.match(swimmer, /suspendForEntertainmentKnockout/);
    assert.match(swimmer, /resumeAfterEntertainmentHit/);
    assert.match(swimmer, /prepareEntertainmentKnockoutLanding\(\)/);
    assert.match(swimmer, /syncEntertainmentKnockoutPresentation\(elapsedSeconds: number\)/);
    assert.match(swimmer, /Math\.max\(0, elapsed - duration\)/);
    assert.match(swimmer, /entertainmentKnockoutLandingSplashScale/);
    assert.match(swimmer, /configureEntertainmentKnockoutLaunch/);
    assert.match(swimmer, /const impactArc = 4 \* t \* \(1 - t\)/);
    assert.match(swimmer, /syncEntertainmentKnockoutElapsed\(Math\.max\(0, elapsed - duration\)\)/);
    assert.doesNotMatch(swimmer.match(/respawnAfterEntertainmentHit[\s\S]*?\n    }/)?.[0] ?? '', /\.startRace\(/);
    const cannonKnockdown = source.match(/private knockDownCannonHitLane[\s\S]*?\n    }/)?.[0] ?? '';
    assert.doesNotMatch(cannonKnockdown, /tween\(swimmer\.node\)|position\.y \+ 0\.55/);
});

test('本地击倒使用独占急救遮罩，重生后再显示无敌状态条', () => {
    const hud = readFileSync(new URL('../assets/scripts/ui/EntertainmentRecoveryHud.ts', import.meta.url), 'utf8');
    const statusStrip = readFileSync(new URL('../assets/scripts/ui/EntertainmentStatusStrip.ts', import.meta.url), 'utf8');
    const manager = readFileSync(new URL('../assets/scripts/core/GameManager.ts', import.meta.url), 'utf8');
    assert.match(hud, /EMERGENCY_DOT_TEXTS = \['\.', '\.\.', '\.\.\.'\]/);
    assert.match(hud, /EMERGENCY_DOT_SECONDS = 0\.35/);
    assert.match(hud, /EMERGENCY_IMPACT_HOLD_SECONDS = 0\.45/);
    assert.match(hud, /EMERGENCY_DIM_DELAY_SECONDS = EMERGENCY_IMPACT_HOLD_SECONDS/);
    assert.match(hud, /EmergencyDim/);
    assert.match(hud, /emergencyCardOpacity/);
    assert.match(hud, /delay\(EMERGENCY_IMPACT_HOLD_SECONDS\)/);
    assert.match(hud, /EMERGENCY_CARD_WIDTH = 980/);
    assert.match(hud, /EMERGENCY_CARD_Y = 42/);
    assert.match(hud, /EmergencyCardLayout/);
    assert.match(hud, /EmergencyStatusLabel/);
    assert.match(hud, /紧急救援/);
    assert.match(hud, /'紧急救援', 34/);
    assert.match(hud, /'急救中', 74/);
    assert.match(hud, /EMERGENCY_COPY_LAYOUTS/);
    assert.match(hud, /lastRecoveryCopyRevision = -1/);
    assert.match(hud, /selectEntertainmentRecoveryCopy\(reason, lane, revision\)/);
    assert.match(hud, /this\.emergencyLabel\.fontSize !== layout\.fontSize/);
    assert.match(manager, /playerState\?\.reason \?\? EntertainmentRecoveryReason\.NONE/);
    assert.match(manager, /playerState\?\.revision \?\? 0/);
    assert.match(manager, /this\._playerLaneIndex/);
    assert.doesNotMatch(hud, /makeLabel\('EmergencyDots'/);
    assert.match(hud, /this\.emergencyLabel\.horizontalAlign = Label\.HorizontalAlign\.LEFT/);
    assert.match(hud, /const combined = `\$\{this\.emergencyCopyText\}\$\{text\}`/);
    assert.match(hud, /this\.emergencyLabel\.string = combined/);
    assert.match(hud, /medium: \{ fontSize: 60, lineHeight: 72, width: 570, left: -170 \}/);
    assert.match(hud, /EMERGENCY_CARD_ENTRY_X = -160/);
    assert.match(hud, /EMERGENCY_CARD_OVERSHOOT_X = 12/);
    assert.match(hud, /position: new Vec3\(EMERGENCY_CARD_OVERSHOOT_X, 0, 0\)[\s\S]*?easing: 'cubicOut'/);
    assert.match(hud, /EMERGENCY_CARD_EXIT_X = 140/);
    assert.match(hud, /position: new Vec3\(EMERGENCY_CARD_EXIT_X, 18, 0\)/);
    assert.match(hud, /EmergencyProgressTrack/);
    assert.match(hud, /EmergencyProgressFill/);
    assert.match(hud, /EMERGENCY_PROGRESS_X = 64/);
    assert.match(hud, /EMERGENCY_PROGRESS_DANGER = new Color\(238, 67, 49, 255\)/);
    assert.match(hud, /EMERGENCY_PROGRESS_STABLE = new Color\(255, 196, 52, 255\)/);
    assert.match(hud, /EMERGENCY_PROGRESS_READY = new Color\(72, 210, 105, 255\)/);
    assert.match(hud, /updateEmergencyProgress\(dt, remainingSeconds\)/);
    assert.match(hud, /ENTERTAINMENT_RECOVERY_TUNING\.knockedSeconds/);
    assert.match(hud, /setEmergencyProgressStep\(Math\.round\(progress \* EMERGENCY_PROGRESS_STEPS\)\)/);
    assert.match(hud, /private updateEmergencyProgressColor\(ratio: number\)/);
    assert.match(hud, /ratio < 0\.5 \? EMERGENCY_PROGRESS_DANGER : EMERGENCY_PROGRESS_STABLE/);
    assert.match(hud, /ratio < 0\.5 \? EMERGENCY_PROGRESS_STABLE : EMERGENCY_PROGRESS_READY/);
    assert.match(hud, /this\.emergencyProgressFillGraphics\.clear\(\)/);
    assert.match(hud, /this\.inputBlocker\.enabled = false;[\s\S]*?this\.playInvulnerabilityEntry\(\)/);
    assert.match(hud, /INVULNERABLE_ENTER_SECONDS/);
    assert.doesNotMatch(hud, /startEmergencyBreathing|repeatForever/);
    assert.match(hud, /RESOURCE_PATHS\.entertainmentRecoveryUi\.rescueCard/);
    assert.match(hud, /Sprite\.SizeMode\.CUSTOM/);
    assert.match(hud, /EmergencyCardMotion/);
    assert.match(hud, /BlockInputEvents/);
    assert.match(hud, /phase === EntertainmentRecoveryPhase\.KNOCKED/);
    assert.match(hud, /phase === EntertainmentRecoveryPhase\.INVULNERABLE/);
    assert.match(hud, /无敌保护/);
    assert.match(hud, /new EntertainmentStatusStrip\(this\.root, 'InvulnerabilityStatus'\)/);
    assert.match(hud, /this\.statusStrip\.setContent\('无敌保护', `\$\{seconds\}秒`, 'protect'\)/);
    assert.match(statusStrip, /makeLabel\('Message'/);
    assert.match(statusStrip, /makeLabel\('Value'/);
    assert.doesNotMatch(statusStrip, /makeUiNode\('Icon'/);
    const card = statSync(new URL('../assets/race/ui/entertainment-recovery-v1/rescue-card.png', import.meta.url));
    assert.ok(card.size > 0 && card.size < 512 * 1024);
});

test('旁观击倒使用独立漂浮姿态和低频头顶眩晕星，不新增联机字段', () => {
    const poseState = readFileSync(
        new URL('../assets/scripts/character/CharacterPoseStateController.ts', import.meta.url),
        'utf8',
    );
    assert.match(poseState, /EntertainmentKnocked = 'entertainment-knocked'/);
    assert.match(poseState, /applyEntertainmentKnockoutPose\(0, 0\)/);
    assert.match(poseState, /entertainmentKnockoutSinkSeconds/);
    assert.match(poseState, /entertainmentKnockoutSinkDepth \* sinkRatio/);
    assert.match(poseState, /baseY - sink \+ bob/);
    assert.match(poseState, /applyEntertainmentKnockoutPose\(phase, elapsed\)/);
    assert.match(poseState, /entertainmentKnockoutRollDegrees/);
    assert.match(poseState, /syncEntertainmentKnockoutElapsed\(elapsedSeconds: number\)/);
    assert.match(poseState, /const elapsed = this\._entertainmentKnockoutElapsedSeconds/);
    assert.doesNotMatch(poseState, /getSelfTime\(\) - this\._entertainmentKnockoutStartTime/);
    assert.doesNotMatch(
        poseState.match(/private applyEntertainmentKnockoutSetup[\s\S]*?\n    }/)?.[0] ?? '',
        /applyBreaststrokePose/,
    );

    const overlay = readFileSync(
        new URL('../assets/scripts/ui/SwimmerNameOverlay.ts', import.meta.url),
        'utf8',
    );
    const pose = readFileSync(
        new URL('../assets/scripts/character/FreestylePoseController.ts', import.meta.url),
        'utf8',
    );
    const tuning = readFileSync(
        new URL('../assets/scripts/character/CharacterMotionTuning.ts', import.meta.url),
        'utf8',
    );
    assert.match(overlay, /DIZZY_SAMPLE_SECONDS = 1 \/ 20/);
    assert.match(overlay, /DIZZY_STAR_COUNT = 3/);
    assert.match(overlay, /DIZZY_OFFSET_Y = 24/);
    assert.match(overlay, /DIZZY_STAR_SIZE = 36/);
    assert.match(overlay, /DIZZY_ORBIT_RADIUS_X = 38/);
    assert.match(overlay, /DIZZY_ORBIT_RADIUS_Y = 14/);
    assert.match(overlay, /DIZZY_TRAIL_SEGMENT_COUNT = 2/);
    assert.match(overlay, /RESOURCE_PATHS\.softSpeedStreak/);
    assert.match(overlay, /DizzyTrail_/);
    assert.match(overlay, /leadPhase = phase - segment \* DIZZY_TRAIL_PHASE_STEP/);
    assert.match(overlay, /tailPhase = phase - \(segment \+ 1\) \* DIZZY_TRAIL_PHASE_STEP/);
    assert.match(overlay, /trail\.root\.setRotationFromEuler\(0, 0, angle\)/);
    assert.match(overlay, /trail\.opacity\.opacity = trailAlpha/);
    assert.match(overlay, /i \* FULL_CIRCLE_RADIANS \/ DIZZY_STAR_COUNT/);
    assert.match(overlay, /const depth = \(1 - sin\) \* 0\.5/);
    assert.match(overlay, /star\.root\.setPosition\(x, y, 0\)/);
    assert.match(overlay, /star\.root\.setScale\(scale, scale, 1\)/);
    assert.match(overlay, /star\.opacity\.opacity = alpha/);
    assert.match(overlay, /isEntertainmentKnocked/);
    assert.match(overlay, /EntertainmentDizzyStars/);
    assert.match(overlay, /makeUiNode\('EntertainmentDizzyStars', this\._root\)/);
    assert.match(overlay, /entry\.swimmer\.getNameTagWorldPosition\(this\._worldPos\)/);
    assert.doesNotMatch(overlay, /Vec3\.copy\(this\._worldPos, swimmerNode\.worldPosition\)/);
    const dizzyAnchorUpdate = overlay.match(
        /if \(wantsDizzy && \(advanceDizzy \|\| enteredDizzy\)\) \{[\s\S]*?const dizzyX/,
    )?.[0] ?? '';
    assert.doesNotMatch(dizzyAnchorUpdate, /worldToScreen|screenToWorld|convertToNodeSpaceAR/);
    assert.match(overlay, /RESOURCE_PATHS\.entertainmentKnockoutUi\.dizzyStars/);
    assert.doesNotMatch(overlay, /ParticleSystem|Graphics\.clear\(\)/);
    assert.doesNotMatch(overlay, /dizzyRoot\.setRotationFromEuler|DIZZY_ROTATION_DEGREES_PER_SECOND/);
    assert.match(pose, /applyEntertainmentKnockoutPose\(phase: number, elapsedSeconds: number\)/);
    assert.match(pose, /this\.applyFinishFloatingPose\(\)/);
    assert.match(pose, /Vec3\.UNIT_Y/);
    assert.match(pose, /applyEntertainmentLimbBuoyancy/);
    assert.match(pose, /entertainmentLimbDirectionInRoot/);
    assert.match(pose, /this\.applyCurrentBoneOffset\(this\._leftArm/);
    assert.match(pose, /this\.applyCurrentBoneOffset\(this\._rightLeg/);
    assert.match(tuning, /entertainmentKnockoutSinkDepth: 0\.34/);
    assert.match(tuning, /entertainmentKnockoutSinkSeconds: 3\.0/);
    assert.match(tuning, /entertainmentKnockoutAirborneThreshold: 0\.06/);
    assert.match(tuning, /entertainmentKnockoutLandingMaxSeconds: 0\.62/);
    assert.match(tuning, /entertainmentKnockoutImpactFlightSeconds: 0\.58/);
    assert.match(tuning, /entertainmentKnockoutLandingSplashScale: 1\.65/);
    assert.match(tuning, /entertainmentKnockoutLimbFloatRiseSeconds: 1\.4/);
    assert.match(tuning, /entertainmentKnockoutUpperArmBuoyancy: 0\.55/);
    assert.match(tuning, /entertainmentKnockoutForeArmBuoyancy: 0\.85/);
    assert.match(tuning, /entertainmentKnockoutThighBuoyancy: 0\.14/);
    assert.match(tuning, /entertainmentKnockoutCalfBuoyancy: 0\.36/);
    assert.match(tuning, /entertainmentKnockoutLimbSwayDegrees: 8/);

    const star = statSync(new URL(
        '../assets/race/ui/entertainment-knockout-v1/dizzy-stars.png',
        import.meta.url,
    ));
    assert.ok(star.size > 0 && star.size < 128 * 1024);

    const protocol = readFileSync(
        new URL('../assets/scripts/net/NetRaceProtocol.ts', import.meta.url),
        'utf8',
    );
    assert.match(protocol, /NET_RACE_PROTOCOL_VERSION = 89/);

    const manager = readFileSync(new URL('../assets/scripts/core/GameManager.ts', import.meta.url), 'utf8');
    const recoveryUpdate = manager.match(/private updateEntertainmentRecovery[\s\S]*?const playerState/)?.[0] ?? '';
    assert.match(recoveryUpdate, /state\?\.phase !== EntertainmentRecoveryPhase\.KNOCKED/);
    assert.match(recoveryUpdate, /knockedSeconds - state\.remainingSeconds/);
    assert.match(recoveryUpdate, /syncEntertainmentKnockoutPresentation/);
});

test('离开比赛状态时立即清理急救遮罩、无敌表现和娱乐画中画', () => {
    const source = readFileSync(new URL('../assets/scripts/core/GameManager.ts', import.meta.url), 'utf8');
    const transition = source.match(/previousState === GameState\.RACING[\s\S]*?\n                }/)?.[0] ?? '';
    assert.match(transition, /_entertainmentRecovery\?\.reset\(\)/);
    assert.match(transition, /_entertainmentRecoveryHud\?\.reset\(\)/);
    assert.match(transition, /clearEntertainmentRecoveryPresentation\(\)/);
    assert.match(transition, /_eventPictureInPicture\?\.reset\(\)/);
    assert.match(transition, /_sharkLockOnOverlay\.hide\(\)/);
});

test('娱乐身体反馈保留角色原贴图材质，不再替换蒙皮材质', () => {
    const rig = readFileSync(
        new URL('../assets/scripts/entity/CartoonSwimmerRig.ts', import.meta.url),
        'utf8',
    );
    const start = rig.indexOf('private updatePerfectGlowMaterial()');
    const end = rig.indexOf('private currentCollisionFlashIntensity()', start);
    const bodyFeedback = rig.slice(start, end);
    assert.ok(start >= 0 && end > start);
    assert.match(bodyFeedback, /applyBodyMaterialGlow/);
    assert.match(bodyFeedback, /setProperty\('chargeParams'/);
    assert.doesNotMatch(bodyFeedback, /setMaterial\(/);
    assert.doesNotMatch(rig, /SwimmerBodyFlashUnlit|_perfectGlowRestoreSlots/);
    const swimmer = readFileSync(
        new URL('../assets/scripts/entity/Swimmer.ts', import.meta.url),
        'utf8',
    );
    assert.match(swimmer, /presentStanding[\s\S]*?clearTransientBodyFeedback\(\)/);
});
