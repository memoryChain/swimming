import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import Rules from '../assets/scripts/swimmer/CollisionSplashRules.ts';
import Collision from '../assets/scripts/entity/SwimmerCollisionResolver.ts';

const {
    COLLISION_SPLASH_MODE,
    COLLISION_SPLASH_TIER,
    collisionSplashModeForRace,
    collisionSplashTierForImpact,
    collisionSplashVisualScale,
    collisionSplashYawRadians,
} = Rules;
const { SWIMMER_COLLISION, resolveSwimmerCollisions } = Collision;

const presentation = readFileSync(
    new URL('../assets/scripts/swimmer/SwimmerCollisionSplash.ts', import.meta.url),
    'utf8',
);
const resolver = readFileSync(
    new URL('../assets/scripts/entity/SwimmerCollisionResolver.ts', import.meta.url),
    'utf8',
);
const gameManager = readFileSync(
    new URL('../assets/scripts/core/GameManager.ts', import.meta.url),
    'utf8',
);

test('标准、狂野和娱乐模式共用分级规则但保持不同可见强度', () => {
    assert.equal(collisionSplashModeForRace('standard', 'competitive'), COLLISION_SPLASH_MODE.STANDARD);
    assert.equal(collisionSplashModeForRace('wild', 'competitive'), COLLISION_SPLASH_MODE.WILD);
    assert.equal(collisionSplashModeForRace('shark', 'entertainment'), COLLISION_SPLASH_MODE.ENTERTAINMENT);
    assert.equal(collisionSplashTierForImpact(1, COLLISION_SPLASH_MODE.STANDARD), COLLISION_SPLASH_TIER.NONE);
    assert.equal(collisionSplashTierForImpact(1, COLLISION_SPLASH_MODE.WILD), COLLISION_SPLASH_TIER.MEDIUM);
    assert.equal(collisionSplashTierForImpact(1, COLLISION_SPLASH_MODE.ENTERTAINMENT), COLLISION_SPLASH_TIER.MEDIUM);
    assert.equal(collisionSplashTierForImpact(2.2, COLLISION_SPLASH_MODE.STANDARD), COLLISION_SPLASH_TIER.STRONG);
    assert.equal(collisionSplashTierForImpact(2.1, COLLISION_SPLASH_MODE.WILD), COLLISION_SPLASH_TIER.STRONG);
    assert.ok(
        collisionSplashVisualScale(1, COLLISION_SPLASH_MODE.ENTERTAINMENT)
        > collisionSplashVisualScale(1, COLLISION_SPLASH_MODE.WILD),
    );
    assert.ok(collisionSplashVisualScale(4, COLLISION_SPLASH_MODE.ENTERTAINMENT) <= 1.21);
    assert.equal(collisionSplashTierForImpact(Number.NaN, COLLISION_SPLASH_MODE.WILD), COLLISION_SPLASH_TIER.NONE);
});

test('碰撞中心线按共同流向稳定选边，交换法线方向不翻转水花', () => {
    const yaw = collisionSplashYawRadians(0.6, 0.8, 4, 1);
    const reversedYaw = collisionSplashYawRadians(-0.6, -0.8, 4, 1);
    assert.equal(yaw, reversedYaw);
    const localXWorldX = Math.cos(yaw);
    const localXWorldZ = -Math.sin(yaw);
    assert.ok(localXWorldX * -4 + localXWorldZ * -1 >= -1e-9);
    assert.equal(collisionSplashYawRadians(Number.NaN, Number.NaN, 0, 0), 0);
});

test('碰撞水花使用独立四槽、两段错峰渲染和二十赫兹固定更新', () => {
    assert.match(presentation, /POOL_SIZE = 4/);
    assert.match(presentation, /PRESENTATION_INTERVAL = 1 \/ 20/);
    assert.match(presentation, /impactNode\.addComponent\(MeshRenderer\)/);
    assert.match(presentation, /residualNode\.addComponent\(MeshRenderer\)/);
    assert.match(presentation, /buildCompressionGeometry\(/);
    assert.match(presentation, /buildSurfaceShearGeometry\(/);
    assert.match(presentation, /buildStrongImpactGeometry\(/);
    assert.match(presentation, /buildResidualGeometry\(/);
    assert.match(presentation, /appendCrescentWave/);
    assert.match(presentation, /appendCentralSqueezeSeam/);
    assert.match(presentation, /appendSurfaceShear/);
    assert.match(presentation, /appendLateralSheet/);
    assert.match(presentation, /MEDIUM_SECONDS = 0\.34/);
    assert.match(presentation, /STRONG_SECONDS = 0\.46/);
    assert.match(presentation, /COMPRESSION_SECONDS = 0\.08/);
    assert.match(presentation, /slot\.impactRenderer\.mesh = slot\.secondaryMesh/);
    assert.match(presentation, /slot\.residualNode\.active = true/);
    assert.match(presentation, /private activeCount = 0/);
    assert.match(presentation, /if \(this\.disposed \|\| this\.activeCount <= 0\) return/);
    assert.match(presentation, /slot\.remaining < candidate\.remaining/);
    assert.doesNotMatch(presentation, /Graphics|ParticleSystem|RenderTexture|Math\.random|new Vec3\(\)/);
});

test('游戏管理器预热、推进、重置和销毁专用碰撞水花池', () => {
    assert.match(gameManager, /new SwimmerCollisionSplashPool\(/);
    assert.match(gameManager, /collisionSplashModeForRace\(collisionSplashRace\.ruleset, collisionSplashRace\.category\)/);
    assert.match(gameManager, /this\._collisionWaterSplashes\?\.update\(dt\)/);
    assert.match(gameManager, /this\._collisionWaterSplashes\?\.reset\(\)/);
    assert.match(gameManager, /this\._collisionWaterSplashes\?\.dispose\(\)/);
    assert.match(gameManager, /resolveSwimmerCollisions\(this\._collisionSwimmers, this\._onSwimmerCollisionImpact\)/);
    assert.doesNotMatch(gameManager, /setCollisionSplashListener|broadcastCollisionSplash|collisionSplashRevision/);
});

function swimmer(x, z, direction, speed = 5, heading = 0) {
    return {
        node: { position: { x, y: 0, z } },
        isCollisionActive: true,
        weight: 1,
        raceDirection: direction,
        startPosition: { x: 0, y: 0, z },
        currentSpeed: speed,
        movementHeading: heading,
        applyCollisionPush(dx, dz) {
            this.node.position.x += dx;
            this.node.position.z += dz;
        },
        applyCollisionImpulse() {},
        addCollisionEnergyBonus() {},
        applyCollisionSoftnessImpulse() {},
        applyCollisionAxialImpulse() {},
        applyCollisionPitchImpulse() {},
    };
}

function clearContacts() {
    resolveSwimmerCollisions([]);
}

test('碰撞事件使用共同强度和原始中点，持续贴靠不重播且分离后可再次触发', () => {
    clearContacts();
    const left = swimmer(-0.85, 0, 1);
    const right = swimmer(0.85, 0, -1);
    const impacts = [];
    const listener = (x, z, nx, nz, flowX, flowZ, tangentialSpeed, magnitude) => {
        impacts.push({ x, z, nx, nz, flowX, flowZ, tangentialSpeed, magnitude });
    };
    resolveSwimmerCollisions([left, right], listener);
    assert.equal(impacts.length, 1);
    assert.equal(impacts[0].x, 0);
    assert.equal(impacts[0].z, 0);
    assert.equal(impacts[0].magnitude, SWIMMER_COLLISION.knockbackMaxImpulse);
    assert.equal(impacts[0].flowX, 0);
    assert.equal(impacts[0].flowZ, 0);
    assert.equal(impacts[0].tangentialSpeed, 0);
    resolveSwimmerCollisions([left, right], listener);
    assert.equal(impacts.length, 1);
    right.node.position.x = left.node.position.x + SWIMMER_COLLISION.radius * 2 + 0.2;
    resolveSwimmerCollisions([left, right], listener);
    right.node.position.x = left.node.position.x + SWIMMER_COLLISION.radius * 2 - 0.1;
    resolveSwimmerCollisions([left, right], listener);
    assert.equal(impacts.length, 2);
    clearContacts();
});

test('交换泳者遍历顺序不改变碰撞水花的接触点、流向和强度', () => {
    const run = reverse => {
        clearContacts();
        const left = swimmer(-0.85, 0.08, 1);
        const right = swimmer(0.85, -0.08, -1);
        let impact = null;
        resolveSwimmerCollisions(reverse ? [right, left] : [left, right], (
            x, z, nx, nz, flowX, flowZ, tangentialSpeed, magnitude,
        ) => {
            impact = { x, z, nx, nz, flowX, flowZ, tangentialSpeed, magnitude };
        });
        return impact;
    };
    const normal = run(false);
    const reversed = run(true);
    assert.equal(normal.x, reversed.x);
    assert.equal(normal.z, reversed.z);
    assert.equal(normal.magnitude, reversed.magnitude);
    assert.equal(normal.flowX, reversed.flowX);
    assert.equal(normal.flowZ, reversed.flowZ);
    assert.equal(normal.tangentialSpeed, reversed.tangentialSpeed);
    assert.equal(normal.nx, -reversed.nx);
    assert.equal(normal.nz, -reversed.nz);
    clearContacts();
});

test('侧向擦碰向表现层提交共同流向和相对切向速度', () => {
    clearContacts();
    const upper = swimmer(0, 0.85, 1, 5);
    const lower = swimmer(0, -0.85, 1, 2);
    let impact = null;
    resolveSwimmerCollisions([upper, lower], (
        x, z, nx, nz, flowX, flowZ, tangentialSpeed, magnitude,
    ) => {
        impact = { x, z, nx, nz, flowX, flowZ, tangentialSpeed, magnitude };
    });
    assert.ok(impact);
    assert.equal(impact.flowX, 3.5);
    assert.equal(impact.flowZ, 0);
    assert.equal(impact.tangentialSpeed, 3);
    clearContacts();
});

test('碰撞回调在共同强度拆分体重冲量之前执行且不创建事件对象', () => {
    assert.match(resolver, /onImpact\?\.\([\s\S]*?\(_origX\[i\] \+ _origX\[j\]\) \* 0\.5[\s\S]*?Math\.abs\(\(_velX\[i\] - _velX\[j\]\)/);
    assert.match(resolver, /onImpact\?\.\([\s\S]*?mag,[\s\S]*?\);[\s\S]*?const wi = _weight\[i\]/);
    assert.doesNotMatch(resolver, /onImpact\?\.\(\{/);
});
