// Networking abstraction for real-time (lock-step) multiplayer. Game code talks
// ONLY to this interface via netRoom() (see NetManager); it never calls
// wx.getGameServerManager() directly. On WeChat this is backed by the managed Game
// Service (room + matchmaking + frame forwarding + reconnect); other platforms get
// their own implementation, and the editor/web build gets a no-op stub.
//
// Design + flow: see docs/平台能力/realtime-multiplayer-notes.zh.md (section 7).
// Determinism (identical inputs -> identical world) is provided by SharedRNG.
//
// This is a SKELETON: the WeChat payload shapes are best-effort from the docs and
// must be verified on a real device. No game systems are wired to it yet.

export interface NetRoomMember {
    openId?: string;
    // Assigned by the platform on joinRoom; identifies a player within the room.
    clientId?: number;
    // Seat index within the room (WeChat posNum). Used to attribute lock-step frames.
    pos?: number;
    ready?: boolean;
    // True for the room owner (host).
    owner?: boolean;
    // Per-player info set on join (e.g. nickname / avatar / chosen character).
    extInfo?: string;
}

export interface NetRoomInfo {
    // Opaque room id returned by createRoom; pass it to joinRoom.
    accessInfo: string;
    members: NetRoomMember[];
    ownerOpenId?: string;
    // Platform-specific room state code (kept opaque here).
    state?: number;
}

export interface NetSyncFrame {
    frameId: number;
    // One opaque payload per player action uploaded for this frame. The game encodes
    // /decodes its own input strings; include a sender id in the payload if the game
    // needs to attribute actions to players.
    items: string[];
}

export interface CreateRoomOptions {
    maxMembers: number;
    // Percentage of members that must call startGame before the match begins
    // (WeChat startPercent). Default 100 (everyone must be ready).
    startPercent?: number;
    // Per-player info visible to the room (nickname / avatar / character choice).
    memberExtInfo?: string;
}

export interface NetRoomCallbacks {
    onRoomInfoChange?: (info: NetRoomInfo) => void;
    onGameStart?: () => void;
    onSyncFrame?: (frame: NetSyncFrame) => void;
    onBroadcast?: (msg: string) => void;
    onGameEnd?: () => void;
    // Connection dropped mid-game — the caller should reconnect().
    onDisconnect?: () => void;
    // Logged out of the game service — the caller should login() again to recover.
    onLogout?: () => void;
}

export interface INetRoom {
    readonly name: string;

    // Whether real networking is available in this build/runtime.
    isSupported(): boolean;

    // Register event listeners. Call once before login/create/join.
    setCallbacks(callbacks: NetRoomCallbacks): void;

    // Connect to the game service (required before room/lock-step calls).
    login(): Promise<void>;

    // Create a room; resolves with its info (accessInfo = the room id to share).
    createRoom(options: CreateRoomOptions): Promise<NetRoomInfo>;

    // Join an existing room by its accessInfo (room id).
    joinRoom(accessInfo: string, memberExtInfo?: string): Promise<NetRoomInfo>;

    // Fetch the current room info (null if not in a room).
    getRoomInfo(): Promise<NetRoomInfo | null>;

    // Mark this player ready/not-ready in the room.
    updateReady(ready: boolean): Promise<void>;

    // Enter lock-step. Every member may call this; the game starts once startPercent
    // of members have (0 = the first startGame starts it for the room). Resolves when
    // the platform confirms the start command succeeded. NOTE: on WeChat the member
    // that calls startGame does NOT receive onGameStart — use this resolution as that
    // member's own "game started" signal; other members get onGameStart.
    startGame(): Promise<void>;

    // Upload this player's input for the current logical frame (opaque string).
    uploadFrame(action: string): void;

    // Broadcast a room message (e.g. the shared RNG seed before startGame).
    broadcast(msg: string): void;

    // Reconnect after onDisconnect; resolves with the server's current max frame id
    // (missed frames arrive via onSyncFrame).
    reconnect(): Promise<number>;

    // Leave the current room.
    leaveRoom(): Promise<void>;

    // End the current lock-step game (owner only) so the room returns to the lobby
    // state and can be reused for another race. No-op if not in a game.
    endGame(): Promise<void>;

    // Clear the LOCAL "game has started" latch so a NEW game can be detected. Every
    // member must call this when returning to the lobby after a race — otherwise the
    // stale latch makes the next start's onGameStart/roomState detection a no-op and the
    // member hangs at "开始中". (endGame resets it too, but that is owner-only.)
    resetGameStartedLatch(): void;

    // Whether this client currently owns a room (created it and hasn't left).
    isOwner(): boolean;

    // The accessInfo (room id) of the room this client is currently in ('' if none).
    currentAccessInfo(): string;

    // Log out of the game service.
    logout(): Promise<void>;
}
