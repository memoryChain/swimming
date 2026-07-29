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

export class WechatGameRoom implements INetRoom {
    readonly name = 'wechat';

    private _gsm: any = null;
    private _callbacks: NetRoomCallbacks = {};
    private _accessInfo = '';
    private _eventsBound = false;

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
        this.bindEvents();
    }

    // Register the platform event listeners once, forwarding to _callbacks (which
    // can be swapped freely via setCallbacks without re-binding).
    private bindEvents(): void {
        if (this._eventsBound || !this.isSupported()) {
            return;
        }
        const gsm = this.manager();
        this._eventsBound = true;
        gsm.onRoomInfoChange?.((res: any) => this._callbacks.onRoomInfoChange?.(mapRoomInfo(res)));
        gsm.onGameStart?.(() => this._callbacks.onGameStart?.());
        gsm.onSyncFrame?.((res: any) => this._callbacks.onSyncFrame?.(mapSyncFrame(res)));
        gsm.onBroadcast?.((res: any) => this._callbacks.onBroadcast?.(typeof res?.msg === 'string' ? res.msg : ''));
        gsm.onGameEnd?.(() => this._callbacks.onGameEnd?.());
        gsm.onDisconnect?.(() => this._callbacks.onDisconnect?.());
        gsm.onLogout?.(() => this._callbacks.onLogout?.());
    }

    login(): Promise<void> {
        if (!this.isSupported()) {
            return Promise.reject(new Error('game server manager unavailable'));
        }
        this.bindEvents();
        return this.manager().login();
    }

    createRoom(options: CreateRoomOptions): Promise<NetRoomInfo> {
        return this.manager()
            .createRoom({
                maxMemberNum: options.maxMembers,
                startPercent: options.startPercent ?? 100,
                needUserInfo: false,
                memberExtInfo: options.memberExtInfo,
            })
            .then((res: any) => {
                const info = mapRoomInfo(res);
                this._accessInfo = info.accessInfo;
                return info;
            });
    }

    joinRoom(accessInfo: string, memberExtInfo?: string): Promise<NetRoomInfo> {
        return this.manager()
            .joinRoom({ accessInfo, memberExtInfo })
            .then((res: any) => {
                const info = mapRoomInfo(res);
                this._accessInfo = info.accessInfo || accessInfo;
                return info;
            });
    }

    getRoomInfo(): Promise<NetRoomInfo | null> {
        return this.manager()
            .getRoomInfo()
            .then((res: any) => mapRoomInfo(res))
            .catch(() => null);
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

function mapRoomInfo(res: any): NetRoomInfo {
    const data = res?.data ?? res ?? {};
    const room = data.roomInfo ?? data;
    const members: NetRoomMember[] = Array.isArray(room?.memberList)
        ? room.memberList.map((m: any) => ({
            openId: m?.openId,
            clientId: m?.clientId,
            ready: m?.readyState === 1 || m?.isReady === true,
            extInfo: m?.memberExtInfo,
        }))
        : [];
    return {
        accessInfo: room?.accessInfo ?? data.accessInfo ?? '',
        members,
        ownerOpenId: room?.ownerOpenId,
        state: room?.roomState ?? room?.state,
    };
}

function mapSyncFrame(res: any): NetSyncFrame {
    const items: string[] = Array.isArray(res?.actionList)
        ? res.actionList.filter((x: unknown): x is string => typeof x === 'string')
        : [];
    return { frameId: typeof res?.frameId === 'number' ? res.frameId : 0, items };
}
