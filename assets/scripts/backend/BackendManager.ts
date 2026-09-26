import { IBackend } from './IBackend';
import { MockBackend } from './MockBackend';
import { WECHAT } from 'cc/env';
import { WechatCloudBackend } from './WechatCloudBackend';

let _backend: IBackend | null = null;

export function backend(): IBackend {
    if (_backend) {
        return _backend;
    }
    // 微信端失败不回退到本地经济档，避免形成无法合并的两份进度。
    _backend = WECHAT ? new WechatCloudBackend() : new MockBackend();
    return _backend;
}
