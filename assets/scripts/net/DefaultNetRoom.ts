// Default / stub INetRoom for the editor, browser, and any platform without a
// managed game service. Real-time multiplayer is unavailable here, so every method
// is a safe no-op / rejection. Lets the game reference net code locally without
// crashing; isSupported() returns false so callers can hide multiplayer entry points.

import {
    CreateRoomOptions,
    INetRoom,
    NetRoomCallbacks,
    NetRoomInfo,
} from './INetRoom';

export class DefaultNetRoom implements INetRoom {
    readonly name = 'default';

    isSupported(): boolean {
        return false;
    }

    isFrameSyncAvailable(): boolean {
        // No real networking here; value is never meaningfully consulted (isSupported
        // is false), but keep the optimistic default so no broadcast-only path triggers.
        return true;
    }

    setCallbacks(_callbacks: NetRoomCallbacks): void {
        // no-op
    }

    login(): Promise<void> {
        return Promise.reject(new Error('[Net] multiplayer unavailable on this platform'));
    }

    createRoom(_options: CreateRoomOptions): Promise<NetRoomInfo> {
        return Promise.reject(new Error('[Net] createRoom unavailable'));
    }

    joinRoom(_accessInfo: string, _memberExtInfo?: string): Promise<NetRoomInfo> {
        return Promise.reject(new Error('[Net] joinRoom unavailable'));
    }

    getRoomInfo(): Promise<NetRoomInfo | null> {
        return Promise.resolve(null);
    }

    updateReady(_ready: boolean): Promise<void> {
        return Promise.resolve();
    }

    startGame(): Promise<void> {
        return Promise.reject(new Error('game server manager unavailable'));
    }

    kickMember(_pos: number): Promise<void> {
        return Promise.reject(new Error('当前平台不支持踢出成员'));
    }

    uploadFrame(_action: string): void {
        // no-op
    }

    broadcast(_msg: string): void {
        // no-op
    }

    reconnect(): Promise<number> {
        return Promise.resolve(0);
    }

    leaveRoom(): Promise<void> {
        return Promise.resolve();
    }

    endGame(): Promise<void> {
        return Promise.resolve();
    }

    resetGameStartedLatch(): void {
        // no-op
    }

    isOwner(): boolean {
        return false;
    }

    currentAccessInfo(): string {
        return '';
    }

    logout(): Promise<void> {
        return Promise.resolve();
    }
}
