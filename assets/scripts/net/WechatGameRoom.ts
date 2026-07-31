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

// onGameStart is an UNRELIABLE WeChat API: the official lock-step demo has the same
// bug where some members (often the room owner) never receive it even though
// startGame's success returns 'ok'. The documented community workaround is to detect
// the game start from the room state via getRoomInfo / onRoomInfoChange. Room states:
// 1=inTeam(lobby), 2=gameStart, 3=gameEnd, 4=roomDestroy, and a running game has also
// been reported as 5. Treat 2 or 5 as "the game has started".
function isGameStartedRoomState(state: number | undefined): boolean {
    return state === 2 || state === 5;
}

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

// One-shot device/runtime diagnostic. The frame-sync native module (nativeInstance)
// runs inside a WeChat worker; on some devices the worker fails to spin up
// (`WeixinWorker.createWXLibWorker is not a function`), which correlates with an old
// WeChat client / base-library version. Log both device envs so a failing phone can
// be compared against a working one.
let _deviceEnvLogged = false;
function logDeviceEnv(): void {
    if (_deviceEnvLogged) {
        return;
    }
    _deviceEnvLogged = true;
    try {
        const info: any = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
        const gsm: any = wx.getGameServerManager ? wx.getGameServerManager() : null;
        netLog('device env', {
            wechatVersion: info.version, // 微信客户端版本
            SDKVersion: info.SDKVersion, // 基础库版本 (frame sync needs a recent one)
            platform: info.platform, // ios / android / devtools
            system: info.system,
            brand: info.brand,
            model: info.model,
            hasGSM: !!gsm,
            hasUploadFrame: !!(gsm && typeof gsm.uploadFrame === 'function'),
            hasCreateWorker: typeof (wx as any).createWorker === 'function',
        });
    } catch (error) {
        netLog('device env FAILED', String(error));
    }
}

export class WechatGameRoom implements INetRoom {
    readonly name = 'wechat';

    private _gsm: any = null;
    private _callbacks: NetRoomCallbacks = {};
    private _accessInfo = '';
    private _roomEventsBound = false;
    private _gameEventsBound = false;
    private _loggedIn = false;
    // True once the game has started: only then may we uploadFrame (before that the
    // native frame instance doesn't exist -> 'nativeInstance.uploadFrame' error).
    private _gameStarted = false;
    // Fire the game-start callback exactly once, from whichever signal arrives first
    // (native onGameStart, or roomState->started via onRoomInfoChange / getRoomInfo
    // poll). Needed because onGameStart is unreliable (see note above).
    private _gameStartNotified = false;
    // True for the room creator (owner); owners must leave via ownerLeaveRoom.
    private _isOwner = false;

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
            const info = mapRoomInfo(res);
            this._callbacks.onRoomInfoChange?.(info);
            if (isGameStartedRoomState(info.state)) {
                this.handleGameStarted('roomState');
            }
        }));
        this.safeOn('onGameStart', () => gsm.onGameStart?.(() => {
            this.handleGameStarted('onGameStart');
        }));
        this.safeOn('onBroadcast', () => gsm.onBroadcast?.((res: any) => {
            netLog('onBroadcast', res);
            this._callbacks.onBroadcast?.(typeof res?.msg === 'string' ? res.msg : '');
        }));
        this.safeOn('onGameEnd', () => gsm.onGameEnd?.(() => {
            netLog('onGameEnd');
            this._gameStarted = false;
            this._gameStartNotified = false;
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

    // Fire the game-start callback exactly once (onGameStart / roomState / poll).
    private handleGameStarted(source: string): void {
        if (this._gameStartNotified) {
            return;
        }
        this._gameStartNotified = true;
        this._gameStarted = true;
        netLog(`game started (${source})`);
        this.bindGameEvents();
        this._callbacks.onGameStart?.();
    }

    // Poll the room state after startGame so a member that never receives the native
    // onGameStart still detects the game has started (roomState 2/5). Logs the state
    // so we can see the real value.
    private pollGameStart(attempt: number): void {
        if (this._gameStartNotified || attempt >= 15) {
            return;
        }
        this.getRoomInfo().then((info) => {
            if (this._gameStartNotified) {
                return;
            }
            const state = info ? info.state : undefined;
            netLog(`poll roomState=${state}`);
            if (isGameStartedRoomState(state)) {
                this.handleGameStarted('poll');
            } else {
                setTimeout(() => this.pollGameStart(attempt + 1), 400);
            }
        });
    }

    login(): Promise<void> {
        if (!this.isSupported()) {
            return Promise.reject(new Error('game server manager unavailable'));
        }
        logDeviceEnv();
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
            // startPercent = fraction of members that must have called startGame before
            // the game starts. 0 (the demo default) = the game starts as soon as the
            // members' startGame calls arrive. The official demo requires ALL members
            // (including the owner) to be READY (updateReadyStatus) before the host
            // broadcasts START; every member then calls startGame and receives
            // onGameStart. Readiness — not startPercent — is what makes the owner
            // participate, so we keep 0 and auto-ready the host.
            startPercent: options.startPercent ?? 0,
            needUserInfo: false,
            memberExtInfo: options.memberExtInfo,
        };
        netLog('createRoom ->', payload);
        return this.manager()
            .createRoom(payload)
            .then((res: any) => {
                netLog('createRoom result', res);
                const info = mapRoomInfo(res);
                this._accessInfo = info.accessInfo;
                this._isOwner = true;
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
        // Do NOT bind onSyncFrame here. Before the game has actually started the frame
        // emitter doesn't exist and gsm.onSyncFrame() throws; that premature failed bind
        // appears to leave the CALLER out of the frame loop (uploadFrame's nativeInstance
        // never gets created, so the host — the first startGame caller — gets
        // 'nativeInstance.uploadFrame' errors while the guest works). We bind onSyncFrame
        // ONLY after the game is confirmed started, in handleGameStarted().
        // onGameStart is unreliable; poll the room state to detect the start.
        this.pollGameStart(0);
        // startGame does NOT support promise-style calls — wrap success/fail.
        return new Promise((resolve, reject) => {
            try {
                gsm.startGame({
                    success: () => {
                        netLog('startGame ok');
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
        // Only valid after onGameStart; before that the native frame instance is not
        // ready and uploadFrame throws (unhandled promise rejection).
        if (!this._gameStarted) {
            return;
        }
        try {
            this.manager().uploadFrame({ actionList: [action] });
        } catch (error) {
            netLog('uploadFrame threw', (error as any)?.errMsg || (error as any)?.message || String(error));
        }
    }

    broadcast(msg: string): void {
        this.manager().broadcastInRoom({ msg });
        // The host broadcasts START but does NOT call startGame (see RoomFlow), so it
        // won't poll via startGame(); start watching for the game start here so the
        // owner still detects it (roomState) even without receiving onGameStart.
        this.pollGameStart(0);
    }

    reconnect(): Promise<number> {
        return this.manager()
            .reconnect()
            .then((res: any) => (typeof res?.maxFrameId === 'number' ? res.maxFrameId : 0));
    }

    leaveRoom(): Promise<void> {
        const gsm = this.manager();
        const accessInfo = this._accessInfo;
        const wasOwner = this._isOwner;
        this._accessInfo = '';
        this._gameStarted = false;
        this._gameStartNotified = false;
        this._isOwner = false;
        // The room OWNER must call ownerLeaveRoom (dissolves / reassigns the room) so
        // remaining members get an onRoomInfoChange; guests call memberLeaveRoom.
        if (wasOwner && typeof gsm.ownerLeaveRoom === 'function') {
            return gsm.ownerLeaveRoom({ accessInfo, assignToMinPosNum: true });
        }
        return gsm.memberLeaveRoom({ accessInfo });
    }

    endGame(): Promise<void> {
        const gsm = this.manager();
        // Owner-only; ends the lock-step game so the room returns to the lobby state
        // and can be reused. Wrapped as a callback-style call (no promise support).
        return new Promise((resolve) => {
            try {
                if (typeof gsm.endGame !== 'function') {
                    resolve();
                    return;
                }
                gsm.endGame({
                    accessInfo: this._accessInfo,
                    success: () => {
                        netLog('endGame ok');
                        this._gameStarted = false;
                        this._gameStartNotified = false;
                        resolve();
                    },
                    fail: (error: any) => {
                        netLog('endGame FAILED', (error as any)?.errMsg || String(error));
                        resolve();
                    },
                });
            } catch (error) {
                netLog('endGame threw', (error as any)?.errMsg || String(error));
                resolve();
            }
        });
    }

    isOwner(): boolean {
        return this._isOwner;
    }

    currentAccessInfo(): string {
        return this._accessInfo;
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
            pos: typeof m?.posNum === 'number' ? m.posNum : undefined,
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
