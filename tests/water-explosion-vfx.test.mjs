import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sharedSplash = readFileSync(new URL('../assets/scripts/core/EntertainmentWaterSplash.ts', import.meta.url), 'utf8');
const cannon = readFileSync(new URL('../assets/scripts/core/CannonBrawlPresentation.ts', import.meta.url), 'utf8');
const minefield = readFileSync(new URL('../assets/scripts/core/MinefieldBrawlPresentation.ts', import.meta.url), 'utf8');
const timedBomb = readFileSync(new URL('../assets/scripts/core/MineRelayBrawlPresentation.ts', import.meta.url), 'utf8');
const stimulant = readFileSync(new URL('../assets/scripts/core/StimulantBrawlController.ts', import.meta.url), 'utf8');
const litter = readFileSync(new URL('../assets/scripts/core/LitterBrawlPresentation.ts', import.meta.url), 'utf8');
const shark = readFileSync(new URL('../assets/scripts/core/SharkEntryPresentation.ts', import.meta.url), 'utf8');
const gameManager = readFileSync(new URL('../assets/scripts/core/GameManager.ts', import.meta.url), 'utf8');
const eventCamera = readFileSync(new URL('../assets/scripts/camera/RaceEventPictureInPictureCamera.ts', import.meta.url), 'utf8');

test('娱乐水花按轻落水、重落水和爆炸三档共用固定池', () => {
    assert.match(sharedSplash, /LIGHT_ENTRY: 'light-entry'/);
    assert.match(sharedSplash, /HEAVY_ENTRY: 'heavy-entry'/);
    assert.match(sharedSplash, /EXPLOSION: 'explosion'/);
    assert.match(sharedSplash, /LIGHT_POOL_SIZE = 4/);
    assert.match(sharedSplash, /HEAVY_POOL_SIZE = 3/);
    assert.match(sharedSplash, /EXPLOSION_POOL_SIZE = 3/);
    assert.match(sharedSplash, /private acquire\(profile: EntertainmentSplashProfile\)/);
    assert.match(sharedSplash, /slot\.remaining < candidate\.remaining/);
});

test('共享水花使用预建低模网格、单材质和二十赫兹变换更新', () => {
    assert.match(sharedSplash, /PRESENTATION_INTERVAL = 1 \/ 20/);
    assert.match(sharedSplash, /buildLightEntryGeometry\(\)/);
    assert.match(sharedSplash, /buildHeavyEntryBodyGeometry\(\)/);
    assert.match(sharedSplash, /buildExplosionBodyGeometry\(\)/);
    assert.match(sharedSplash, /buildHeavyImpactRingGeometry\(\)/);
    assert.match(sharedSplash, /buildExplosionImpactRingGeometry\(\)/);
    assert.match(sharedSplash, /appendBrokenRing/);
    assert.match(sharedSplash, /appendWaterCrown/);
    assert.match(sharedSplash, /appendCurvedWaterJet/);
    assert.match(sharedSplash, /appendWaterDroplet/);
    assert.match(sharedSplash, /renderer\.setMaterial\(this\.material, 0\)/);
    assert.doesNotMatch(sharedSplash, /Graphics|\.clear\(\)|ParticleSystem|RenderTexture|RagingPoolWater/);
});

test('共享水花空闲时跳过扫描且纯水纹不写入隐藏的水花本体', () => {
    assert.match(sharedSplash, /private activeCount = 0/);
    assert.match(sharedSplash, /if \(this\.disposed \|\| this\.activeCount <= 0\) return/);
    assert.match(sharedSplash, /for \(let index = 0; index < this\.slots\.length; index\+\+\)/);
    assert.match(sharedSplash, /if \(!slot\.rippleOnly\) \{[\s\S]*?slot\.body\.setScale/);
    assert.match(sharedSplash, /this\.activeCount = Math\.max\(0, this\.activeCount - 1\)/);
});

test('轻落水用于苏打和软垃圾，重落水用于水雷入场、硬垃圾和鲨鱼入场', () => {
    assert.match(stimulant, /owner: ENTERTAINMENT_SPLASH_OWNER\.STIMULANT[\s\S]*profile: ENTERTAINMENT_SPLASH_PROFILE\.LIGHT_ENTRY/);
    assert.match(litter, /ENTERTAINMENT_SPLASH_PROFILE\.HEAVY_ENTRY[\s\S]*ENTERTAINMENT_SPLASH_PROFILE\.LIGHT_ENTRY/);
    assert.match(minefield, /ENTERTAINMENT_SPLASH_PROFILE\.HEAVY_ENTRY/);
    assert.match(minefield, /ENTRY_DISTURB_VISUAL_SECONDS,[\s\S]*?true,/);
    assert.match(shark, /owner: ENTERTAINMENT_SPLASH_OWNER\.SHARK_ENTRY[\s\S]*profile: ENTERTAINMENT_SPLASH_PROFILE\.HEAVY_ENTRY/);
    assert.match(shark, /yawDegrees: shark\.node\.eulerAngles\.y/);
    assert.match(shark, /layer: this\.splashLayer/);
});

test('炮火、水雷和定时炸弹使用爆炸档并保留各自强度', () => {
    assert.match(cannon, /CANNON_EXPLOSION_INTENSITY = 1\.08/);
    assert.match(minefield, /MINEFIELD_EXPLOSION_INTENSITY = 1/);
    assert.match(timedBomb, /TIMED_BOMB_EXPLOSION_INTENSITY = 1\.25/);
    for (const source of [cannon, timedBomb]) {
        assert.match(source, /profile: ENTERTAINMENT_SPLASH_PROFILE\.EXPLOSION/);
        assert.doesNotMatch(source, /Graphics|\.clear\(\)|buildWaterExplosionGeometry|applyWaterExplosionPhase/);
    }
    assert.match(minefield, /ENTERTAINMENT_SPLASH_PROFILE\.EXPLOSION,[\s\S]*?MINEFIELD_EXPLOSION_INTENSITY/);
    assert.doesNotMatch(minefield, /Graphics|\.clear\(\)|buildWaterExplosionGeometry|applyWaterExplosionPhase/);
    assert.match(timedBomb, /this\.course\.waterY \+ 0\.035/);
});

test('爆炸冲击波使用立体波峰并让水柱先于水面余波结束', () => {
    assert.match(sharedSplash, /EXPLOSION_DEFAULT_SECONDS = 0\.95/);
    assert.match(sharedSplash, /EXPLOSION_BODY_END_PHASE = 0\.62/);
    assert.match(sharedSplash, /appendBrokenWaveCrest/);
    assert.match(sharedSplash, /this\.heavyRingMesh = utils\.createMesh\(buildHeavyImpactRingGeometry\(\)\)/);
    assert.match(sharedSplash, /this\.explosionRingMesh = utils\.createMesh\(buildExplosionImpactRingGeometry\(\)\)/);
    assert.match(sharedSplash, /crestY: number/);
    assert.match(sharedSplash, /bodyFinished/);
    assert.match(sharedSplash, /slot\.ring\.setScale\(ringScale, Math\.max\(0\.18, ringHeightScale\), ringScale\)/);
    assert.match(cannon, /IMPACT_SECONDS = 0\.95/);
    assert.match(minefield, /EXPLOSION_SECONDS = 0\.95/);
    assert.match(timedBomb, /EXPLOSION_SECONDS = 0\.95/);
});

test('游戏管理器只持有一个共享水花池并统一推进生命周期', () => {
    assert.match(gameManager, /private _entertainmentWaterSplashes: EntertainmentWaterSplashPool \| null = null/);
    assert.match(gameManager, /new EntertainmentWaterSplashPool\(this\._worldRoot\)/);
    assert.match(gameManager, /this\._entertainmentWaterSplashes\?\.update\(dt\)/);
    assert.match(gameManager, /this\._entertainmentWaterSplashes\?\.reset\(\)/);
    assert.match(gameManager, /this\._entertainmentWaterSplashes\?\.dispose\(\)/);
    assert.ok((gameManager.match(/this\.entertainmentWaterSplashes\(\)/g) ?? []).length >= 6);
});

test('联机定时炸弹水花使用可靠结算携带的权威坐标', () => {
    assert.match(gameManager, /this\.applyMineRelayExplosion\([\s\S]*?event\.carrierLane,[\s\S]*?event\.distance,[\s\S]*?event\.lateral,[\s\S]*?event\.revision/);
    assert.match(gameManager, /COURSE_LAYOUT\.distanceToWorldX\(distance\)/);
    assert.match(gameManager, /COURSE_LAYOUT\.waterY \+ 0\.035,[\s\S]*?lateral/);
    assert.match(gameManager, /else \{[\s\S]*?swimmer\.node\.getWorldPosition\(this\._mineExplosionWorldPosition\)/);
});

test('定时炸弹结算画中画复用权威爆心并切换到水面俯角', () => {
    assert.match(gameManager, /showTimedBombResolution\([\s\S]*?this\._mineExplosionWorldPosition/);
    assert.match(eventCamera, /private readonly timedBombBlastPosition = new Vec3\(\)/);
    assert.match(eventCamera, /this\.timedBombBlastPosition\.set\(blastPosition\)/);
    assert.match(eventCamera, /this\.timedBombBlastPosition\.x - this\.options\.course\.direction \* 2\.8/);
    assert.match(eventCamera, /this\.options\.course\.waterY \+ 6\.4/);
    assert.match(eventCamera, /this\.applyCameraPose\(56\)/);
    assert.match(eventCamera, /camera\.visibility = Layers\.Enum\.DEFAULT \| SWIMMER_LAYER \| UNDERWATER_LAYER \| VENUE_CEILING_LAYER/);
});

test('娱乐模式定时炸弹保留精修炸药束、切角计时器和连续导线并保持单网格', () => {
    const start = timedBomb.indexOf('export function buildTimedBombGeometry');
    const end = timedBomb.indexOf('function buildLowPolyLampGeometry', start);
    const model = start >= 0 && end > start ? timedBomb.slice(start, end) : '';
    assert.match(model, /appendFacetedBundleBand/);
    assert.match(model, /appendChamferedBox/);
    assert.match(model, /appendFacetedCable/);
    assert.match(timedBomb, /this\.mineMesh = utils\.createMesh\(buildTimedBombGeometry\(\)\)/);
    assert.doesNotMatch(model, /resources\.load|assetManager\.load|new Material/);
});

test('障碍水雷使用分层不对称模型并保持轻微三轴漂转', () => {
    assert.match(timedBomb, /appendFacetedMineBody/);
    assert.match(timedBomb, /appendDetailedMineSpike/);
    assert.match(minefield, /MINE_ROTATION_Y_DEGREES = 14/);
    assert.match(minefield, /MINE_TILT_X_DEGREES = 9/);
    assert.match(minefield, /MINE_TILT_Z_DEGREES = 7/);
    assert.match(minefield, /rotationPhase/);
});

test('定时炸弹事件切换后由共享池继续播完已触发水花', () => {
    assert.match(timedBomb, /updateResidualEffects\(dt: number, racing: boolean\)/);
    assert.doesNotMatch(timedBomb, /advanceExplosion/);
    assert.match(gameManager, /this\._mineRelayPresentation\?\.updateResidualEffects\(dt, this\._state === GameState\.RACING\)/);
    assert.match(gameManager, /this\._entertainmentWaterSplashes\?\.update\(dt\)/);
});
