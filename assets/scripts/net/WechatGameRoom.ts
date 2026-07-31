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
    private _roomEventsBound = false;
    private _gameEventsBound = false;
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
            this.bindRoomEvents();
        }
    }

    // Room-level events, bindable after login(). NOTE: onSyncFrame / onDisconnect are
    // FRAME-level and are bound separately in bindGameEvents() — on some devices their
    // internal emitter only exists once the lock-step game is starting, so binding
    // them here throws "this.emitter.on is undefined".
    private bindRoomEvents(): void {
        if (this._roomEventsBound || !this.isSupported()) {
            return;
        }
        const gsm = this.manager();
        this._roomEventsBound = true;
        this.safeOn('onRoomInfoChange', () => gsm.onRoomInfoChange?.((res: any) => {
            netLog('onRoomInfoChange', res);
            this._callbacks.onRoomInfoChange?.(mapRoomInfo(res));
        }));
        this.safeOn('onGameStart', () => gsm.onGameStart?.(() => {
            netLog('onGameStart');
            // The frame emitter exists now — (re)bind onSyncFrame/onDisconnect.
            this.bindGameEvents();
            this._callbacks.onGameStart?.();
        }));
        this.safeOn('onBroadcast', () => gsm.onBroadcast?.((res: any) => {
            netLog('onBroadcast', res);
            this._callbacks.onBroadcast?.(typeof res?.msg === 'string' ? res.msg : '');
        }));
        this.safeOn('onGameEnd', () => gsm.onGameEnd?.(() => {
            netLog('onGameEnd');
            this._callbacks.onGameEnd?.();
        }));
        this.safeOn('onLogout', () => gsm.onLogout?.(() => {
            netLog('onLogout');
            this._callbacks.onLogout?.();
        }));
    }

    // Frame-level events, bindable once the lock-step game is starting (startGame /
    // onGameStart). Idempotent + retried, since their emitter may not be ready on the
    // first attempt.
    private bindGameEvents(): void {
        if (this._gameEventsBound || !this.isSupported()) {
            return;
        }
        const gsm = this.manager();
        const syncOk = this.safeOn('onSyncFrame', () => gsm.onSyncFrame?.((res: any) => {
            this._callbacks.onSyncFrame?.(mapSyncFrame(res));
        }));
        this.safeOn('onDisconnect', () => gsm.onDisconnect?.(() => {
            netLog('onDisconnect');
            this._callbacks.onDisconnect?.();
        }));
        // Only latch as bound if the critical frame event actually attached; otherwise
        // leave it unbound so a later startGame/onGameStart retries.
        if (syncOk) {
            this._gameEventsBound = true;
            netLog('game events bound');
        }
    }

    private safeOn(name: string, register: () => void): boolean {
        try {
            register();
            return true;
        } catch (error) {
            netLog(`event bind failed: ${name}`, (error as any)?.errMsg || (error as any)?.message || String(error));
            return false;
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
                // The room emitter is ready now — safe to register room events.
                this.bindRoomEvents();
            })
            .catch((error: any) => {
                netLog('login FAILED', error);
                throw error;
            });
    }

    createRoom(options: CreateRoomOptions): Promise<NetRoomInfo> {
        const payload = {
            maxMemberNum: options.maxMembers,
            // startPercent = how many members must have called startGame before the
            // game actually starts (onGameStart fires). 0 = a single startGame (the
            // host's) starts it for the whole room; 100 = ALL must call startGame.
            // We use 0 so a host-initiated start reliably fires onGameStart even if a
            // guest's startGame is late/dropped.
            startPercent: options.startPercent ?? 0,
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
        // updateReadyStatus does NOT support promise-style calls — use success/fail.
        return new Promise((resolve, reject) => {
            const gsm = this.manager();
            if (!gsm || typeof gsm.updateReadyStatus !== 'function') {
                resolve();
                return;
            }
            try {
                gsm.updateReadyStatus({
                    accessInfo: this._accessInfo,
                    isReady: ready,
                    success: () => {
                        netLog('updateReady ok', ready);
                        resolve();
                    },
                    fail: (error: any) => {
                        netLog('updateReady FAILED', error);
                        reject(error);
                    },
                });
            } catch (error) {
                netLog('updateReady threw', (error as any)?.errMsg || (error as any)?.message || String(error));
                reject(error);
            }
        });
    }

    startGame(): Promise<void> {
        const gsm = this.manager();
        // The frame emitter should exist once we're starting — bind onSyncFrame now.
        this.bindGameEvents();
        // startGame does NOT support promise-style calls — wrap success/fail. The
        // resolution is THIS member's "game started" cue (the caller does not receive
        // onGameStart; other members do).
        return new Promise((resolve, reject) => {
            try {
                gsm.startGame({
                    success: () => {
                        netLog('startGame ok');
                        this.bindGameEvents();
                        resolve();
                    },
                    fail: (error: any) => {
                        netLog('startGame FAILED', error);
                        reject(error);
                    },
                });
            } catch (error) {
                netLog('startGame threw', (error as any)?.errMsg || (error as any)?.message || String(error));
                reject(error);
            }
        });
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
            owner: m?.role === 1 || m?.owner === true,
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
