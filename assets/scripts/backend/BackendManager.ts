// Backend factory + singleton. Callers use PlayerData; PlayerData asks backend()
// for the active IBackend. Today only the local MockBackend exists (phase 1). When
// the WeChat Cloud backend is ready, gate it here on the WECHAT constant — callers
// won't change.

import { IBackend } from './IBackend';
import { MockBackend } from './MockBackend';

let _backend: IBackend | null = null;

export function backend(): IBackend {
    if (_backend) {
        return _backend;
    }
    // TODO(阶段1C): if (WECHAT) _backend = new WechatCloudBackend(); (wx.cloud.callFunction)
    // For now every build uses the local mock so the养成 data flow is testable in the editor.
    _backend = new MockBackend();
    return _backend;
}
