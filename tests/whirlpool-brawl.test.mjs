import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import Rules from '../assets/scripts/core/WhirlpoolBrawlRules.ts';
import CareerRules from '../assets/scripts/progression/CareerRules.ts';
import PlayerProfile from '../assets/scripts/backend/PlayerProfile.ts';

const {
    WHIRLPOOL_BRAWL_TUNING,
    WHIRLPOOL_SPAWN_BANDS,
    WHIRLPOOL_MAX_CENTER_FRACTION,
    WHIRLPOOL_SUPER_MAX_CENTER_FRACTION,
    WHIRLPOOL_SUPER_TUNING,
    entertainmentWhirlpoolSpawn,
    sampleWhirlpoolInfluence,
    whirlpoolCenterZ,
    whirlpoolSpawnsForSeed,
    whirlpoolTargetZForAi,
    whirlpoolWorldSpin,
} = Rules;
const { executeCareer } = CareerRules;
const { createDefaultProfile, normalizeProfile } = PlayerProfile;
const controllerSource = readFileSync(
    new URL('../assets/scripts/core/WhirlpoolBrawlController.ts', import.meta.url),
    'utf8',
);
const gameManagerSource = readFileSync(
    new URL('../assets/scripts/core/GameManager.ts', import.meta.url),
    'utf8',
);
const tuningSource = readFileSync(
    new URL('../assets/scripts/core/TuningDebugControls.ts', import.meta.url),
    'utf8',
);

function influence() {
    return {
        forwardAcceleration: 0,
        lateralAcceleration: 0,
        yawAcceleration: 0,
        rollAcceleration: 0,
        intensity: 0,
        coreIntensity: 0,
        captureIntensity: 0,
        captureDrag: 0,
        whirlpoolId: -1,
    };
}

function simulateStraightPass(spawn, initialLateral = 0, speed = 3.4) {
    const superVariant = spawn.variant === 'super';
    const alongRadius = WHIRLPOOL_BRAWL_TUNING.alongRadius
        * (superVariant ? WHIRLPOOL_SUPER_TUNING.alongRadiusScale : 1);
    const endDistance = spawn.distance + alongRadius + 1;
    const sample = influence();
    const dt = 1 / 60;
    const flowDecay = Math.exp(-dt / 0.5);
    const turnDecay = Math.exp(-0.6 * dt);
    const maxTurnRate = 95 * Math.PI / 180;
    const maxHeading = 65 * Math.PI / 180;
    let distance = spawn.distance - alongRadius - 1;
    let lateral = initialLateral;
    let flowForward = 0;
    let flowLateral = 0;
    let heading = 0;
    let turnRate = 0;
    let elapsed = 0;
    let maxAbsLateral = Math.abs(lateral);
    let maxAbsHeading = 0;
    let minForwardSpeed = speed;
    let maxCaptureIntensity = 0;
    let maxCoreIntensity = 0;

    for (let frame = 0; frame < 60 * 20 && distance <= endDistance; frame++) {
        sampleWhirlpoolInfluence(distance, lateral, 20, sample, [spawn]);
        const cap = sample.maxFlowSpeed;
        flowForward = clampTest(flowForward + sample.forwardAcceleration * dt, -cap, cap);
        flowLateral = clampTest(flowLateral + sample.lateralAcceleration * dt, -cap, cap);
        if (sample.captureDrag > 0) {
            const cancelledSpeed = speed * (1 - Math.exp(-sample.captureDrag * dt));
            flowForward = clampTest(flowForward - Math.cos(heading) * cancelledSpeed, -cap, cap);
            flowLateral = clampTest(flowLateral - Math.sin(heading) * cancelledSpeed, -cap, cap);
        }
        turnRate = clampTest(turnRate + sample.yawAcceleration * dt, -maxTurnRate, maxTurnRate);
        heading = clampTest(heading + turnRate * dt, -maxHeading, maxHeading);
        turnRate *= turnDecay;
        const forwardSpeed = speed * Math.cos(heading) + flowForward;
        distance += forwardSpeed * dt;
        lateral += (speed * Math.sin(heading) + flowLateral) * dt;
        flowForward *= flowDecay;
        flowLateral *= flowDecay;
        elapsed += dt;
        minForwardSpeed = Math.min(minForwardSpeed, forwardSpeed);
        maxAbsLateral = Math.max(maxAbsLateral, Math.abs(lateral));
        maxAbsHeading = Math.max(maxAbsHeading, Math.abs(heading));
        maxCaptureIntensity = Math.max(maxCaptureIntensity, sample.captureIntensity);
        maxCoreIntensity = Math.max(maxCoreIntensity, sample.coreIntensity);
    }

    return {
        passed: distance > endDistance,
        elapsed,
        finalLateral: lateral,
        maxAbsLateral,
        maxHeadingDegrees: maxAbsHeading * 180 / Math.PI,
        minForwardSpeed,
        maxCaptureIntensity,
        maxCoreIntensity,
    };
}

function clampTest(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

test('漩涡按种子安全随机分布在四个泳段', () => {
    const spawns = whirlpoolSpawnsForSeed(2468);
    const repeated = whirlpoolSpawnsForSeed(2468);
    const different = whirlpoolSpawnsForSeed(8642);
    assert.deepEqual(repeated, spawns);
    assert.notDeepEqual(different, spawns);
    assert.equal(spawns.length, WHIRLPOOL_SPAWN_BANDS.length);
    for (let i = 0; i < spawns.length; i++) {
        const spawn = spawns[i];
        const band = WHIRLPOOL_SPAWN_BANDS[i];
        assert.ok(spawn.distance >= band.minDistance && spawn.distance <= band.maxDistance);
        assert.ok(Math.abs(spawn.centerFraction) <= WHIRLPOOL_MAX_CENTER_FRACTION);
        if (i > 0) assert.equal(spawn.spin, -spawns[i - 1].spin);
    }
});

test('同一随机布局的水流采样可重复', () => {
    const spawns = whirlpoolSpawnsForSeed(2468);
    const spawn = spawns[0];
    const z = whirlpoolCenterZ(spawn, 20);
    assert.deepEqual(
        sampleWhirlpoolInfluence(spawn.distance + 1.2, z + 1.8, 20, influence(), spawns),
        sampleWhirlpoolInfluence(spawn.distance + 1.2, z + 1.8, 20, influence(), spawns),
    );
});

test('独立漩涡局低概率只强化一个中段漩涡并靠近池中线', () => {
    let superCount = 0;
    for (let seed = 0; seed < 400; seed++) {
        const spawns = whirlpoolSpawnsForSeed(seed);
        const supers = spawns.filter(spawn => spawn.variant === 'super');
        assert.ok(supers.length <= 1);
        if (supers.length === 0) continue;
        superCount++;
        assert.ok(supers[0].id === 1 || supers[0].id === 2);
        assert.ok(Math.abs(supers[0].centerFraction) <= WHIRLPOOL_SUPER_MAX_CENTER_FRACTION);
    }
    assert.ok(superCount >= 70 && superCount <= 130);
});

test('模式测试可按同一种子强制小漩涡或一个中段大漩涡', () => {
    const normal = whirlpoolSpawnsForSeed(2468, 'normal');
    const superSpawns = whirlpoolSpawnsForSeed(2468, 'super');
    assert.equal(normal.filter(spawn => spawn.variant === 'super').length, 0);
    const supers = superSpawns.filter(spawn => spawn.variant === 'super');
    assert.equal(supers.length, 1);
    assert.ok(supers[0].id === 1 || supers[0].id === 2);
    assert.ok(Math.abs(supers[0].centerFraction) <= WHIRLPOOL_SUPER_MAX_CENTER_FRACTION);
    assert.deepEqual(whirlpoolSpawnsForSeed(2468, 'normal'), normal);
    assert.deepEqual(whirlpoolSpawnsForSeed(2468, 'super'), superSpawns);
});

test('强制规格只接入本地AI测试，正式与联机仍使用纯随机', () => {
    assert.match(gameManagerSource, /this\._aiDebugMode && !this\._netSession\s*\? getAiDebugSetup\(\)\.whirlpoolSelection\s*:\s*'random'/);
});

test('六合一超级漩涡落在下一处泳池中心，冲刺段不足时安全降级', () => {
    const superSpawn = entertainmentWhirlpoolSpawn(73, 40, 200, true)[0];
    assert.equal(superSpawn.variant, 'super');
    assert.equal(superSpawn.distance, 75);
    assert.ok(Math.abs(superSpawn.centerFraction) <= WHIRLPOOL_SUPER_MAX_CENTER_FRACTION);
    const fallback = entertainmentWhirlpoolSpawn(73, 188, 200, true)[0];
    assert.equal(fallback.variant, 'normal');
    assert.ok(fallback.distance <= 190);
});

test('超级漩涡扩大作用范围并增强吸力、旋转与水流上限', () => {
    const source = whirlpoolSpawnsForSeed(2468)[0];
    const normal = { ...source, variant: 'normal', centerFraction: 0 };
    const superSpawn = { ...source, variant: 'super', centerFraction: 0 };
    const center = whirlpoolCenterZ(superSpawn, 20);
    const normalOutside = sampleWhirlpoolInfluence(
        normal.distance, center + WHIRLPOOL_BRAWL_TUNING.lateralRadius * 1.2, 20, influence(), [normal],
    );
    const superOutside = sampleWhirlpoolInfluence(
        superSpawn.distance, center + WHIRLPOOL_BRAWL_TUNING.lateralRadius * 1.2, 20, influence(), [superSpawn],
    );
    assert.equal(normalOutside.intensity, 0);
    assert.ok(superOutside.intensity > 0);
    const normalCore = sampleWhirlpoolInfluence(normal.distance, center, 20, influence(), [normal]);
    const superCore = sampleWhirlpoolInfluence(superSpawn.distance, center, 20, influence(), [superSpawn]);
    assert.ok(Math.abs(superCore.forwardAcceleration) > Math.abs(normalCore.forwardAcceleration));
    assert.equal(superCore.maxFlowSpeed, WHIRLPOOL_BRAWL_TUNING.maxFlowSpeed * WHIRLPOOL_SUPER_TUNING.maxFlowSpeedScale);
});

test('漩涡外圈给前进收益，核心产生明显回卷惩罚', () => {
    const spawns = whirlpoolSpawnsForSeed(2468);
    const spawn = spawns[0];
    const center = whirlpoolCenterZ(spawn, 20);
    const outer = sampleWhirlpoolInfluence(
        spawn.distance,
        center - spawn.spin * WHIRLPOOL_BRAWL_TUNING.lateralRadius * 0.68,
        20,
        influence(),
        spawns,
    );
    const core = sampleWhirlpoolInfluence(spawn.distance, center, 20, influence(), spawns);
    assert.ok(outer.forwardAcceleration > 0);
    assert.ok(core.forwardAcceleration < 0);
    assert.ok(core.coreIntensity > 0.9);
});

test('漩涡核心保持强向心锁吸并显著压低正向逃离速度', () => {
    const source = whirlpoolSpawnsForSeed(2468)[0];
    const spawn = { ...source, variant: 'normal', centerFraction: 0 };
    const center = whirlpoolCenterZ(spawn, 20);
    const nearCore = sampleWhirlpoolInfluence(
        spawn.distance,
        center + WHIRLPOOL_BRAWL_TUNING.lateralRadius * 0.04,
        20,
        influence(),
        [spawn],
    );
    const eye = sampleWhirlpoolInfluence(spawn.distance, center, 20, influence(), [spawn]);
    assert.ok(nearCore.lateralAcceleration < -5);
    assert.ok(eye.forwardAcceleration <= -5.5);
    assert.equal(eye.maxFlowSpeed, WHIRLPOOL_BRAWL_TUNING.maxFlowSpeed);
    assert.match(tuningSource, /whirlpool\.coreCaptureAcceleration/);
    assert.match(tuningSource, /whirlpool\.capturePropulsionDrag/);
});

test('完整直穿轨迹会被减速并按旋向显著带偏，偏心进入后难以直接脱离', () => {
    const source = whirlpoolSpawnsForSeed(2468)[0];
    const clockwise = { ...source, distance: 30, centerFraction: 0, spin: 1, variant: 'normal' };
    const counterclockwise = { ...clockwise, spin: -1 };
    const straight = simulateStraightPass(clockwise);
    const mirrored = simulateStraightPass(counterclockwise);
    const captured = simulateStraightPass(clockwise, 1.2);

    assert.equal(straight.passed, true);
    assert.ok(straight.maxAbsLateral >= 1.3);
    assert.ok(straight.maxHeadingDegrees >= 18);
    assert.ok(straight.minForwardSpeed <= 2.9);
    assert.ok(straight.maxCaptureIntensity >= 0.6);
    assert.ok(straight.finalLateral < -0.7);
    assert.ok(mirrored.finalLateral > 0.7);
    assert.ok(captured.maxCoreIntensity >= 0.45);
    assert.ok(captured.minForwardSpeed <= 1);
    assert.ok(captured.elapsed >= 5);
});

test('超级漩涡保持相对核心尺寸并用更宽捕获带阻止高速直穿', () => {
    const source = whirlpoolSpawnsForSeed(2468)[0];
    const spawn = { ...source, distance: 30, centerFraction: 0, spin: 1, variant: 'super' };
    const lateralRadius = WHIRLPOOL_BRAWL_TUNING.lateralRadius
        * WHIRLPOOL_SUPER_TUNING.lateralRadiusScale;
    const nearCore = sampleWhirlpoolInfluence(
        spawn.distance,
        lateralRadius * 0.30,
        20,
        influence(),
        [spawn],
    );
    const straight = simulateStraightPass(spawn);

    assert.ok(nearCore.coreIntensity > 0);
    assert.ok(straight.maxCaptureIntensity >= 0.5);
    assert.ok(straight.maxAbsLateral >= 3.5);
    assert.ok(straight.maxHeadingDegrees >= 35);
    assert.ok(straight.minForwardSpeed <= 2.8);
});

test('旋向决定外圈顺流加速侧与逆流受阻侧', () => {
    const source = whirlpoolSpawnsForSeed(2468)[0];
    const clockwise = { ...source, spin: 1 };
    const counterclockwise = { ...source, spin: -1 };
    const center = whirlpoolCenterZ(source, 20);
    const ringOffset = WHIRLPOOL_BRAWL_TUNING.lateralRadius * 0.68;
    const clockwiseUpper = sampleWhirlpoolInfluence(
        source.distance, center + ringOffset, 20, influence(), [clockwise],
    );
    const clockwiseLower = sampleWhirlpoolInfluence(
        source.distance, center - ringOffset, 20, influence(), [clockwise],
    );
    const counterUpper = sampleWhirlpoolInfluence(
        source.distance, center + ringOffset, 20, influence(), [counterclockwise],
    );
    const counterLower = sampleWhirlpoolInfluence(
        source.distance, center - ringOffset, 20, influence(), [counterclockwise],
    );
    assert.ok(clockwiseLower.forwardAcceleration > 0);
    assert.ok(clockwiseUpper.forwardAcceleration < 0);
    assert.ok(counterUpper.forwardAcceleration > 0);
    assert.ok(counterLower.forwardAcceleration < 0);
    assert.ok(clockwiseLower.forwardAcceleration - clockwiseUpper.forwardAcceleration > 4);
    assert.ok(counterUpper.forwardAcceleration - counterLower.forwardAcceleration > 4);
    assert.ok(clockwiseUpper.lateralAcceleration < 0);
    assert.ok(clockwiseLower.lateralAcceleration > 0);
});

test('旋向让入场和离场产生相反的横向环绕推力', () => {
    const source = whirlpoolSpawnsForSeed(2468)[0];
    const clockwise = { ...source, spin: 1 };
    const counterclockwise = { ...source, spin: -1 };
    const center = whirlpoolCenterZ(source, 20);
    const alongOffset = WHIRLPOOL_BRAWL_TUNING.alongRadius * 0.68;
    const clockwiseEntry = sampleWhirlpoolInfluence(
        source.distance - alongOffset, center, 20, influence(), [clockwise],
    );
    const clockwiseExit = sampleWhirlpoolInfluence(
        source.distance + alongOffset, center, 20, influence(), [clockwise],
    );
    const counterEntry = sampleWhirlpoolInfluence(
        source.distance - alongOffset, center, 20, influence(), [counterclockwise],
    );
    assert.ok(clockwiseEntry.lateralAcceleration < 0);
    assert.ok(clockwiseExit.lateralAcceleration > 0);
    assert.ok(counterEntry.lateralAcceleration > 0);
});

test('折返泳段把赛程旋向转换为一致的世界可见旋向', () => {
    const source = whirlpoolSpawnsForSeed(2468)[0];
    assert.equal(whirlpoolWorldSpin({ ...source, spin: 1 }, 1), 1);
    assert.equal(whirlpoolWorldSpin({ ...source, spin: 1 }, -1), -1);
    assert.equal(whirlpoolWorldSpin({ ...source, spin: -1 }, 1), -1);
    assert.equal(whirlpoolWorldSpin({ ...source, spin: -1 }, -1), 1);
});

test('漩涡水流从边缘到核心逐渐增强并在离开时对称减弱', () => {
    const spawns = whirlpoolSpawnsForSeed(2468);
    const spawn = spawns[0];
    const center = whirlpoolCenterZ(spawn, 20);
    const approaching = [5.1, 3.4, 1.7, 0].map(offset => sampleWhirlpoolInfluence(
        spawn.distance - offset, center, 20, influence(), spawns,
    ).intensity);
    assert.ok(approaching[0] < approaching[1]);
    assert.ok(approaching[1] < approaching[2]);
    assert.ok(approaching[2] < approaching[3]);
    for (let i = 0; i < approaching.length; i++) {
        const leaving = sampleWhirlpoolInfluence(
            spawn.distance + [5.1, 3.4, 1.7, 0][i], center, 20, influence(), spawns,
        ).intensity;
        assert.ok(Math.abs(leaving - approaching[i]) < 1e-12);
    }
});

test('AI 目标落在核心外且不越过泳池边界', () => {
    const spawns = whirlpoolSpawnsForSeed(2468);
    for (const spawn of spawns) {
        const target = whirlpoolTargetZForAi(spawn.distance - 10, 0, 20, spawns);
        assert.notEqual(target, null);
        assert.ok(Math.abs(target) <= 9.25);
        assert.ok(Math.abs(target - whirlpoolCenterZ(spawn, 20)) > 2.5);
    }
});

test('漩涡表现拆分方向水流、危险核心和退场余波三层', () => {
    assert.match(controllerSource, /buildWhirlpoolFlowGeometry\(\)/);
    assert.match(controllerSource, /buildWhirlpoolCoreGeometry\(\)/);
    assert.match(controllerSource, /buildWhirlpoolAfterglowGeometry\(\)/);
    assert.match(controllerSource, /DirectionalFlow/);
    assert.match(controllerSource, /DangerCore/);
    assert.match(controllerSource, /ExitAfterglow/);
    assert.match(controllerSource, /Math\.sin\(Math\.PI \* fadeProgress\)/);
    assert.match(controllerSource, /flowRotationDegrees[\s\S]*?- visual\.spin \* rotationSpeed \* step/);
});

test('漩涡美术层复用固定网格且不引入逐帧程序绘制或粒子模拟', () => {
    assert.match(controllerSource, /createWhirlpoolVisualResources/);
    assert.match(controllerSource, /normal: createWhirlpoolVisualResourceSet\(false\)/);
    assert.match(controllerSource, /super: createWhirlpoolVisualResourceSet\(true\)/);
    assert.match(controllerSource, /const arms = superVariant \? 5 : 3/);
    assert.match(controllerSource, /appendCoreSuctionRibbon/);
    assert.match(controllerSource, /const suctionArms = superVariant \? 4 : 3/);
    assert.match(controllerSource, /const PRESENTATION_INTERVAL = 1 \/ 20/);
    assert.doesNotMatch(controllerSource, /Graphics|ParticleSystem/);
});

test('统一娱乐漩涡随第二条广播立即生成并由画中画拍摄入场', () => {
    assert.match(gameManagerSource, /activateEntertainmentEvent\(transition\.activatedEvent, true\)/);
    assert.match(gameManagerSource, /_whirlpoolActivationPreviewPending = true/);
    assert.match(gameManagerSource, /beginActivationEntrance\(previewIndex\)/);
    assert.match(gameManagerSource, /!this\._whirlpoolActivationPreviewPlayed/);
    assert.match(controllerSource, /const ACTIVATION_ENTRANCE_SECONDS = 1\.25/);
    assert.match(controllerSource, /beginActivationEntrance\(index: number\): boolean/);
    assert.match(controllerSource, /activationEntranceElapsed \/ ACTIVATION_ENTRANCE_SECONDS/);
    assert.match(controllerSource, /ahead >= -FADE_BEHIND_START_DISTANCE/);
});

test('漩涡赛只允许快速比赛二百米并可从存档恢复', () => {
    const profile = createDefaultProfile();
    const characterId = Object.keys(profile.characters)[0];
    assert.equal(executeCareer(profile, {
        type: 'begin', source: 'quick', characterId, tier: 0, distance: 200, rule: 'whirlpool', seed: 17,
    }).ok, true);
    assert.equal(normalizeProfile(profile).career.quick.rule, 'whirlpool');
    assert.equal(executeCareer(createDefaultProfile(), {
        type: 'begin', source: 'quick', characterId, tier: 0, distance: 400, rule: 'whirlpool', seed: 17,
    }).ok, false);
});
