// WeChat Game Service implementation of INetRoom, backed by
// wx.getGameServerManager() (room service + lock-step frame sync). Only
// instantiated in a WeChat build; the wx global is touched only inside methods.
//
// SKELETON: payload field names (res.data.accessInfo, res.actionList, etc.) follow
// the WeChat docs but MUST be verified on a real device — adjust the small mapping
// helpers below once tested. No game systems consume this yet.

import {
    CreateRoomOptions,
    INetRoom,
    NetRoomCallbacks,
    NetRoomInfo,
    NetRoomMember,
    NetSyncFrame,
} from './INetRoom';

// Injected by the WeChat mini-game runtime adapter. Untyped on purpose.
declare const wx: any;

// Verbose logging of the raw GameServerManager payloads. Leave on until the field
// mappings below are confirmed on a real device, then flip to false.
const NET_DEBUG = true;

function netLog(tag: string, payload?: any): void {
    if (!NET_DEBUG) {
        return;
    }
    if (payload === undefined) {
        console.log(`[NetWX] ${tag}`);
        return;
    }
    let text = '';
    try {
        text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    } catch (error) {
        text = String(payload);
    }
    if (text && text.length > 900) {
        text = text.slice(0, 900) + '…';
    }
    console.log(`[NetWX] ${tag}: ${text}`);
}

export class WechatGameRoom implements INetRoom {
    readonly name = 'wechat';

    private _gsm: any = null;
    private _callbacks: NetRoomCallbacks = {};
    private _accessInfo = '';
    private _eventsBound = false;
    private _loggedIn = false;

    isSupported(): boolean {
        return typeof wx !== 'undefined' && typeof wx.getGameServerManager === 'function';
    }

    private manager(): any {
        if (!this._gsm) {
            this._gsm = wx.getGameServerManager();
        }
        return this._gsm;
    }

    setCallbacks(callbacks: NetRoomCallbacks): void {
        this._callbacks = callbacks || {};
        // Only bind the platform events once we're logged in. On some devices the
        // GameServerManager's internal emitter doesn't exist until login() runs, so
        // calling gsm.onXxx() before login throws "this.emitter.on is undefined".
        if (this._loggedIn) {
            this.bindEvents();
        }
    }

    // Register the platform event listeners once, forwarding to _callbacks (which
    // can be swapped freely via setCallbacks without re-binding). MUST run after
    // login() so the manager's internal emitter exists.
    private bindEvents(): void {
        if (this._eventsBound || !this.isSupported()) {
            return;
        }
        const gsm = this.manager();
        this._eventsBound = true;
        // Each registration is guarded: a single unsupported/failing event must not
        // abort the whole room setup.
        this.safeOn('onRoomInfoChange', () => gsm.onRoomInfoChange?.((res: any) => {
            netLog('onRoomInfoChange', res);
            this._callbacks.onRoomInfoChange?.(mapRoomInfo(res));
        }));
        this.safeOn('onGameStart', () => gsm.onGameStart?.(() => {
            netLog('onGameStart');
            this._callbacks.onGameStart?.();
        }));
        this.safeOn('onSyncFrame', () => gsm.onSyncFrame?.((res: any) => this._callbacks.onSyncFrame?.(mapSyncFrame(res))));
        this.safeOn('onBroadcast', () => gsm.onBroadcast?.((res: any) => {
            netLog('onBroadcast', res);
            this._callbacks.onBroadcast?.(typeof res?.msg === 'string' ? res.msg : '');
        }));
        this.safeOn('onGameEnd', () => gsm.onGameEnd?.(() => {
            netLog('onGameEnd');
            this._callbacks.onGameEnd?.();
        }));
        this.safeOn('onDisconnect', () => gsm.onDisconnect?.(() => {
            netLog('onDisconnect');
            this._callbacks.onDisconnect?.();
        }));
        this.safeOn('onLogout', () => gsm.onLogout?.(() => {
            netLog('onLogout');
            this._callbacks.onLogout?.();
        }));
    }

    private safeOn(name: string, register: () => void): void {
        try {
            register();
        } catch (error) {
            netLog(`event bind failed: ${name}`, (error as any)?.errMsg || (error as any)?.message || String(error));
        }
    }

    login(): Promise<void> {
        if (!this.isSupported()) {
            return Promise.reject(new Error('game server manager unavailable'));
        }
        return this.manager()
            .login()
            .then(() => {
                netLog('login ok');
                this._loggedIn = true;
                // The emitter is ready now — safe to register room/frame events.
                this.bindEvents();
            })
            .catch((error: any) => {
                netLog('login FAILED', error);
                throw error;
            });
    }

    createRoom(options: CreateRoomOptions): Promise<NetRoomInfo> {
        const payload = {
            maxMemberNum: options.maxMembers,
            startPercent: options.startPercent ?? 100,
            needUserInfo: false,
            roomType: 'swim',
            memberExtInfo: options.memberExtInfo,
        };
        netLog('createRoom ->', payload);
        return this.manager()
            .createRoom(payload)
            .then((res: any) => {
                netLog('createRoom result', res);
                const info = mapRoomInfo(res);
                this._accessInfo = info.accessInfo;
                return info;
            })
            .catch((error: any) => {
                netLog('createRoom FAILED', error);
                throw error;
            });
    }

    joinRoom(accessInfo: string, memberExtInfo?: string): Promise<NetRoomInfo> {
        netLog('joinRoom ->', { accessInfo, memberExtInfo });
        return this.manager()
            .joinRoom({ accessInfo, memberExtInfo })
            .then((res: any) => {
                netLog('joinRoom result', res);
                const info = mapRoomInfo(res);
                this._accessInfo = info.accessInfo || accessInfo;
                return info;
            })
            .catch((error: any) => {
                netLog('joinRoom FAILED', error);
                throw error;
            });
    }

    getRoomInfo(): Promise<NetRoomInfo | null> {
        // getRoomInfo does NOT support promise-style calls on WeChat — it must be
        // called with success/fail callbacks, which we wrap into a Promise here.
        return new Promise((resolve) => {
            const gsm = this.manager();
            if (!gsm || typeof gsm.getRoomInfo !== 'function') {
                resolve(null);
                return;
            }
            try {
                gsm.getRoomInfo({
                    success: (res: any) => {
                        netLog('getRoomInfo result', res);
                        resolve(mapRoomInfo(res));
                    },
                    fail: (error: any) => {
                        netLog('getRoomInfo FAILED', error);
                        resolve(null);
                    },
                });
            } catch (error) {
                netLog('getRoomInfo threw', (error as any)?.errMsg || (error as any)?.message || String(error));
                resolve(null);
            }
        });
    }

    updateReady(ready: boolean): Promise<void> {
        return this.manager().updateReadyStatus({ accessInfo: this._accessInfo, isReady: ready });
    }

    startGame(): void {
        this.manager().startGame();
    }

    uploadFrame(action: string): void {
        this.manager().uploadFrame({ actionList: [action] });
    }

    broadcast(msg: string): void {
        this.manager().broadcastInRoom({ msg });
    }

    reconnect(): Promise<number> {
        return this.manager()
            .reconnect()
            .then((res: any) => (typeof res?.maxFrameId === 'number' ? res.maxFrameId : 0));
    }

    leaveRoom(): Promise<void> {
        const accessInfo = this._accessInfo;
        this._accessInfo = '';
        return this.manager().memberLeaveRoom({ accessInfo });
    }

    logout(): Promise<void> {
        return this.manager().logout();
    }
}

// --- Payload mapping helpers (verify field names on a real device) ---

// Some GameServerManager calls resolve with the payload wrapped in `data`, which is
// occasionally a JSON string. Normalize to a plain object.
function unwrap(res: any): any {
    let data = res && typeof res === 'object' && 'data' in res ? res.data : res;
    if (typeof data === 'string') {
        try {
            data = JSON.parse(data);
        } catch (error) {
            /* leave as string */
        }
    }
    return data ?? {};
}

function mapRoomInfo(res: any): NetRoomInfo {
    const data = unwrap(res);
    const room = data.roomInfo ?? data;
    const rawMembers = room?.memberList ?? room?.members ?? room?.playerList ?? room?.memberInfoList ?? [];
    const members: NetRoomMember[] = Array.isArray(rawMembers)
        ? rawMembers.map((m: any) => ({
            openId: m?.openId ?? m?.openid,
            clientId: m?.clientId ?? m?.posNum,
            ready: m?.readyState === 1 || m?.isReady === true || m?.ready === true,
            extInfo: m?.memberExtInfo ?? m?.extInfo,
        }))
        : [];
    return {
        accessInfo: room?.accessInfo ?? data.accessInfo ?? room?.roomIdStr ?? data.roomIdStr ?? '',
        members,
        ownerOpenId: room?.ownerOpenId ?? room?.owner,
        state: room?.roomState ?? room?.state,
    };
}

function mapSyncFrame(res: any): NetSyncFrame {
    const raw = res?.actionList ?? res?.data?.actionList ?? [];
    const items: string[] = Array.isArray(raw)
        ? raw.map((x: any) => (typeof x === 'string' ? x : '')).filter((x: string) => x.length > 0)
        : [];
    const frameId = typeof res?.frameId === 'number'
        ? res.frameId
        : (typeof res?.data?.frameId === 'number' ? res.data.frameId : 0);
    return { frameId, items };
}
