// Net-room factory + singleton. Game code calls netRoom() and gets the right
// INetRoom for the current build. Selection uses the compile-time WECHAT constant
// from 'cc/env', so non-WeChat builds tree-shake the WeChat implementation out.
//
// Douyin has a similar real-time service but a different API — add a DouyinGameRoom
// under a BYTEDANCE branch when needed; for now non-WeChat falls back to the stub.

import { WECHAT } from 'cc/env';
import { INetRoom } from './INetRoom';
import { DefaultNetRoom } from './DefaultNetRoom';
import { WechatGameRoom } from './WechatGameRoom';

let _netRoom: INetRoom | null = null;

export function netRoom(): INetRoom {
    if (_netRoom) {
        return _netRoom;
    }
    if (WECHAT) {
        _netRoom = new WechatGameRoom();
    } else {
        _netRoom = new DefaultNetRoom();
    }
    return _netRoom;
}
