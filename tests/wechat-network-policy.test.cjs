const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function source(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('微信构建以单一开关同步高性能与高性能＋策略', () => {
    const hook = source('extensions/wechat-race-subpackage/hooks.js');
    assert.match(hook, /const IOS_HIGH_PERFORMANCE_ENABLED = true;/);
    assert.match(hook, /gameConfig\.iOSHighPerformance = IOS_HIGH_PERFORMANCE_ENABLED;/);
    assert.match(hook, /gameConfig\['iOSHighPerformance\+'\] = IOS_HIGH_PERFORMANCE_ENABLED;/);
    assert.match(hook, /gameConfig\.lockStepOptions = LOCK_STEP_OPTIONS;/);
});

test('iOS 帧通道失败会锁存并通知全房切到广播降级', () => {
    const room = source('assets/scripts/net/WechatGameRoom.ts');
    const controller = source('assets/scripts/net/NetRaceController.ts');
    const manager = source('assets/scripts/core/GameManager.ts');

    assert.match(room, /markFrameSyncUnavailable\('onSyncFrame-bind'\)/);
    assert.match(room, /markFrameSyncUnavailable\('uploadFrame', error\)/);
    assert.match(room, /!msg\.startsWith\('G\|'\)/, '带比赛身份的高频广播不能进入 vConsole 日志');
    assert.match(controller, /const NEED_BROADCAST_TAG = 'NB\|';/);
    assert.match(controller, /const BROADCAST_INPUT_TAG = 'IN\|';/);
    assert.match(controller, /this\.broadcastRaceMessage\(`\$\{NEED_BROADCAST_TAG\}\$\{this\._session\.localPos\}`\)/);
    assert.match(controller, /this\.processAuthoritativeEvents\(decoded\.senderPos, decoded\.events\);/);
    assert.match(controller, /this\.processRemotePacket\(decoded\.senderPos, decoded\.inputSeq, decoded\.events, decoded\.self\);/);
    assert.match(manager, /this\._netRaceController\.maybeAnnounceBroadcastNeed\(\);/);
    assert.match(manager, /if \(this\._netRaceController\.broadcastSyncRequired\)[\s\S]*?this\._netRaceController\.sendSelfSnapshot\(self\);/);
});

test('联机说明与当前高性能广播降级策略一致', () => {
    const notes = source('docs/平台能力/realtime-multiplayer-notes.zh.md');
    assert.doesNotMatch(notes, /联机必须关闭 iOS 高性能模式/);
    assert.match(notes, /当前项目保留高性能并自动降级/);
    assert.match(notes, /`NB\|` 通知全房切到 `IN\|` 输入事件＋`P\|` 自身状态广播/);
});
