import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cannon = readFileSync(new URL('../assets/scripts/core/CannonBrawlPresentation.ts', import.meta.url), 'utf8');
const minefield = readFileSync(new URL('../assets/scripts/core/MinefieldBrawlPresentation.ts', import.meta.url), 'utf8');
const timedBomb = readFileSync(new URL('../assets/scripts/core/MineRelayBrawlPresentation.ts', import.meta.url), 'utf8');

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
