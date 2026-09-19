import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cannon = readFileSync(new URL('../assets/scripts/core/CannonBrawlPresentation.ts', import.meta.url), 'utf8');
const minefield = readFileSync(new URL('../assets/scripts/core/MinefieldBrawlPresentation.ts', import.meta.url), 'utf8');
const timedBomb = readFileSync(new URL('../assets/scripts/core/MineRelayBrawlPresentation.ts', import.meta.url), 'utf8');
const gameManager = readFileSync(new URL('../assets/scripts/core/GameManager.ts', import.meta.url), 'utf8');

test('炮火、水雷和定时炸弹复用立体水爆网格', () => {
    assert.match(cannon, /buildWaterExplosionGeometry/);
    assert.match(minefield, /buildWaterExplosionGeometry/);
    assert.match(timedBomb, /buildWaterExplosionGeometry/);
    assert.match(timedBomb, /appendWaterCrown/);
    assert.match(timedBomb, /appendCurvedWaterJet/);
    assert.match(timedBomb, /appendWaterDroplet/);
});

test('正式爆炸表现不再使用交叉透明薄片并保持低频变换动画', () => {
    for (const source of [cannon, minefield, timedBomb]) {
        assert.doesNotMatch(source, /appendRibbon/);
        assert.match(source, /PRESENTATION_INTERVAL = 1 \/ 20/);
        assert.doesNotMatch(source, /Graphics|\.clear\(\)/);
    }
    assert.match(timedBomb, /applyWaterExplosionPhase/);
    assert.match(timedBomb, /node\.setScale/);
});

test('扩大后的爆炸范围使用原有池化网格增强体量', () => {
    assert.match(cannon, /CANNON_EXPLOSION_INTENSITY = 1\.08/);
    assert.match(minefield, /MINEFIELD_EXPLOSION_INTENSITY = 1/);
    assert.match(timedBomb, /TIMED_BOMB_EXPLOSION_INTENSITY = 1\.25/);
    assert.match(cannon, /applyWaterExplosionPhase[\s\S]*CANNON_EXPLOSION_INTENSITY/);
    assert.match(minefield, /applyWaterExplosionPhase[\s\S]*MINEFIELD_EXPLOSION_INTENSITY/);
    assert.match(timedBomb, /applyWaterExplosionPhase[\s\S]*TIMED_BOMB_EXPLOSION_INTENSITY/);
});

test('娱乐模式定时炸弹使用精修炸药束、切角计时器和连续导线并保持单网格', () => {
    const start = timedBomb.indexOf('export function buildTimedBombGeometry');
    const end = timedBomb.indexOf('function buildLowPolyLampGeometry', start);
    const model = start >= 0 && end > start ? timedBomb.slice(start, end) : '';
    assert.match(model, /appendFacetedBundleBand/);
    assert.match(model, /appendChamferedBox/);
    assert.match(model, /appendFacetedCable/);
    assert.match(model, /中央引信座与警示灯共轴/);
    assert.match(timedBomb, /this\.mineMesh = utils\.createMesh\(buildTimedBombGeometry\(\)\)/);
    assert.doesNotMatch(model, /resources\.load|assetManager\.load|new Material/);
});

test('障碍水雷使用分层不对称模型并保持轻微三轴漂转', () => {
    assert.match(timedBomb, /appendFacetedMineBody/);
    assert.match(timedBomb, /appendDetailedMineSpike/);
    assert.match(timedBomb, /顶部触发器和侧面警示牌/);
    assert.match(minefield, /MINE_ROTATION_Y_DEGREES = 14/);
    assert.match(minefield, /MINE_TILT_X_DEGREES = 9/);
    assert.match(minefield, /MINE_TILT_Z_DEGREES = 7/);
    assert.match(minefield, /rotationPhase/);
});

test('定时炸弹事件切换后仍会播完已触发的水花', () => {
    assert.match(timedBomb, /updateResidualEffects\(dt: number, racing: boolean\)/);
    assert.match(timedBomb, /private advanceExplosion\(step: number\)/);
    assert.match(gameManager, /this\._mineRelayPresentation\?\.updateResidualEffects\(dt, this\._state === GameState\.RACING\)/);
});
