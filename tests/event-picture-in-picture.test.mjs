import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const cameraUrl = new URL('../assets/scripts/camera/RaceEventPictureInPictureCamera.ts', import.meta.url);
const camera = readFileSync(cameraUrl, 'utf8');
const gameManager = readFileSync(
    new URL('../assets/scripts/core/GameManager.ts', import.meta.url),
    'utf8',
);

test('娱乐玩法共用一套低分辨率事件镜头', () => {
    assert.equal((camera.match(/new RenderTexture/g) ?? []).length, 1);
    assert.match(camera, /const FEED_WIDTH = 224/);
    assert.match(camera, /const FEED_HEIGHT = 126/);
    assert.match(camera, /const RENDER_INTERVAL_SECONDS = 1 \/ 30/);
    assert.match(camera, /camera\.visibility = Layers\.Enum\.DEFAULT \| SWIMMER_LAYER \| UNDERWATER_LAYER/);
    assert.doesNotMatch(camera, /Graphics|setInterval|setTimeout/);
    assert.equal(existsSync(new URL('../assets/scripts/camera/SharkPictureInPictureCamera.ts', import.meta.url)), false);
});

test('炮火、首个漩涡和鲨鱼使用事件镜头，炸弹与水雷不接入', () => {
    assert.match(gameManager, /updateShark\(this\._shark, dt\)/);
    assert.match(gameManager, /showCannonLaunch\(launch\)/);
    assert.match(gameManager, /showCannonImpact\(impact\)/);
    assert.doesNotMatch(gameManager, /showMineFloating\(|showMineCarrier\(|showMineExplosion\(|updateMine\(/);
    assert.match(gameManager, /featuredIndex >= 0 \? featuredIndex : 0/);
    assert.match(gameManager, /showWhirlpoolPreview\(/);
    assert.match(camera, /this\.whirlpoolSuper \? 18\.5 : 13\.5/);
    assert.match(camera, /this\.mode === 'shark' \|\| this\.mode === 'cannon'/);
    assert.doesNotMatch(camera, /Stimulant|心跳苏打/);
});

test('定时炸弹与障碍水雷只使用世界表现，不写主镜头状态', () => {
    assert.doesNotMatch(gameManager, /_raceCameraDirector\.[^\n]*Mine/);
    assert.doesNotMatch(gameManager, /_eventPictureInPicture\?\.showMine/);
});

test('比赛更新路径不为相机采样创建逐帧回调闭包', () => {
    assert.match(camera, /private shouldRender\(dt: number\): boolean/);
    assert.match(camera, /private finishRender\(\): void/);
    assert.doesNotMatch(camera, /renderIfDue\([^\n]*=>/);
});
