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

function influence() {
    return {
        forwardAcceleration: 0,
        lateralAcceleration: 0,
        yawAcceleration: 0,
        rollAcceleration: 0,
        intensity: 0,
        coreIntensity: 0,
        whirlpoolId: -1,
    };
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
    assert.match(controllerSource, /this\.meshes\.push\(flowMesh, coreMesh, afterglowMesh\)/);
    assert.match(controllerSource, /const PRESENTATION_INTERVAL = 1 \/ 20/);
    assert.doesNotMatch(controllerSource, /Graphics|ParticleSystem/);
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
