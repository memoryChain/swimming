import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const cameraUrl = new URL('../assets/scripts/camera/RaceEventPictureInPictureCamera.ts', import.meta.url);
const camera = readFileSync(cameraUrl, 'utf8');
const gameManager = readFileSync(
    new URL('../assets/scripts/core/GameManager.ts', import.meta.url),
    'utf8',
);
const runtimeScene = readFileSync(
    new URL('../assets/scripts/app/RuntimeSceneBuilder.ts', import.meta.url),
    'utf8',
);

test('娱乐玩法共用一套低分辨率事件镜头', () => {
    assert.equal((camera.match(/new RenderTexture/g) ?? []).length, 1);
    assert.match(camera, /const FEED_WIDTH = 224/);
    assert.match(camera, /const FEED_HEIGHT = 126/);
    assert.match(camera, /const RENDER_INTERVAL_SECONDS = 1 \/ 30/);
    assert.match(camera, /const TIMED_BOMB_ARM_PREVIEW_SECONDS = 1\.2/);
    assert.match(camera, /const TIMED_BOMB_TRANSFER_PREVIEW_SECONDS = 0\.8/);
    assert.match(camera, /const TIMED_BOMB_REOPEN_COOLDOWN_SECONDS = 1/);
    assert.match(camera, /const TIMED_BOMB_RESOLUTION_HOLD_SECONDS = 1/);
    assert.match(camera, /camera\.visibility = Layers\.Enum\.DEFAULT \| SWIMMER_LAYER \| UNDERWATER_LAYER \| VENUE_CEILING_LAYER/);
    assert.match(runtimeScene, /SPECTATOR_LAYER \| VENUE_CEILING_LAYER/);
    assert.doesNotMatch(camera, /Graphics|setInterval|setTimeout/);
    assert.equal(existsSync(new URL('../assets/scripts/camera/SharkPictureInPictureCamera.ts', import.meta.url)), false);
});

test('共用事件镜头只在高空俯拍阶段排除顶棚', () => {
    assert.match(camera, /showWhirlpoolPreview[\s\S]*?this\.setCeilingVisible\(false\)/);
    assert.match(camera, /showCannonLaunch[\s\S]*?this\.setCeilingVisible\(true\)/);
    assert.match(camera, /this\.setCeilingVisible\(shark\.state !== SharkState\.WARNING\)/);
    assert.match(camera, /private setCeilingVisible\(visible: boolean\)[\s\S]*?if \(this\.ceilingVisible === visible\) return/);
    assert.doesNotMatch(gameManager, /_eventPictureInPicture\?\.showMine|_eventPictureInPicture\?\.showStimulant/);
});

test('炮火、首个漩涡、鲨鱼和定时炸弹复用事件镜头，障碍水雷不接入', () => {
    assert.match(gameManager, /updateShark\(this\._shark, dt\)/);
    assert.match(gameManager, /showCannonLaunch\(launch\)/);
    assert.match(gameManager, /showCannonImpact\(impact\)/);
    assert.doesNotMatch(gameManager, /showMineFloating\(|showMineCarrier\(|showMineExplosion\(|updateMine\(/);
    assert.match(gameManager, /showTimedBombCarrier\(/);
    assert.match(gameManager, /updateTimedBomb\(/);
    assert.match(gameManager, /showTimedBombResolution\(/);
    assert.match(gameManager, /clearTimedBombTracking\(\)/);
    assert.match(gameManager, /isWhirlpoolBrawlMode\(\) \|\| isTimedBombBrawlMode\(\)/);
    assert.match(gameManager, /featuredIndex >= 0 \? featuredIndex : 0/);
    assert.match(gameManager, /showWhirlpoolPreview\(/);
    assert.match(camera, /this\.whirlpoolSuper \? 18\.5 : 13\.5/);
    assert.match(camera, /this\.mode === 'shark' \|\| this\.mode === 'cannon' \|\| this\.mode === 'timed-bomb'/);
    assert.doesNotMatch(camera, /Stimulant|心跳苏打/);
});

test('定时炸弹仅写共享事件画中画，障碍水雷仍只使用世界表现', () => {
    assert.doesNotMatch(gameManager, /_raceCameraDirector\.[^\n]*Mine/);
    assert.doesNotMatch(gameManager, /_eventPictureInPicture\?\.showMine/);
    assert.match(camera, /type FeedMode = [^\n]*'timed-bomb'/);
    assert.match(camera, /private timedBombCarrier: Node \| null/);
    assert.match(camera, /Math\.ceil\(this\.timedBombRemainingSeconds\)/);
    assert.match(camera, /wholeSeconds === this\.lastTimedBombCopySeconds/);
    assert.match(camera, /if \(this\.mode === 'timed-bomb'\) this\.hide\(\)/);
    assert.match(camera, /this\.timedBombLocked[\s\S]*?this\.setCopy\('炸弹追踪'/);
});

test('比赛更新路径不为相机采样创建逐帧回调闭包', () => {
    assert.match(camera, /private shouldRender\(dt: number\): boolean/);
    assert.match(camera, /private finishRender\(\): void/);
    assert.doesNotMatch(camera, /renderIfDue\([^\n]*=>/);
});
