// Online room screen: an 8-slot lobby where the player and invited friends gather
// before a networked race. The local player takes one slot; empty slots show a "+"
// that invites a friend (WeChat share). The host can start once there are ≥2 humans;
// remaining slots are filled with AI at race time.
//
// Backed by the net layer (netRoom()). In the editor/web build the game service is
// unavailable, so it falls back to a LOCAL preview room (just you) that is still
// fully viewable/clickable. The actual networked race (frame sync + AI fill +
// return-to-room after finishing) is phase 2B and needs on-device testing.

import { Node } from 'cc';
import { LEAGUES } from '../progression/CareerRules';
import { OnlineRoomView, OnlineMember, ROOM_MODES } from './OnlineRoomView';
import { RaceDifficulty, setRaceDifficulty } from '../core/GameBalance';
import { PLAYER_CHARACTER_DEFINITIONS, getSelectedRaceDifficulty } from '../app/PlayerCharacterConfig';
import { PlayerData } from '../backend/PlayerData';
import { AVATARS } from '../backend/IdentityConfig';
import { netRoom, serializeRoomOperation } from '../net/NetManager';
import { NetRoomInfo } from '../net/INetRoom';
import { NetRaceMember, setNetRaceSession } from '../net/NetRaceSession';
import { SeededRandom } from '../core/SharedRNG';
import { platform } from '../platform/PlatformManager';
import { resolveLocalModifierDigest } from '../progression/RaceModifiers';
import { decodeModifierDigest, encodeModifierDigest, hasCompleteModifierDigest } from '../net/NetRaceModifierCodec';
import {
    NET_RACE_PROTOCOL_VERSION,
    decodeProtocolHello,
    decodeProtocolRequest,
    encodeProtocolHello,
    encodeProtocolRequest,
    hasCompatibleProtocol,
    isCompatibleProtocolVersion,
} from '../net/NetRaceProtocol';

export type RoomFlowCallbacks = {
    onExit: () => void;
    // Editor / local-preview start (no real net): launch a placeholder single race.
    onStartLocalRace: (humanCount: number) => void;
    // Networked start: the shared NetRaceSession has been set; launch the net race.
    onStartNetRace: () => void;
};

const MAX_SLOTS = 8;
const IDENTITY_SEP = '|';
let lastRoomMode: RaceDifficulty | null = null;

type SlotMember = {
    clientId?: number;
    self: boolean;
    avatarId: string;
    nickName: string;
    ready: boolean;
    owner: boolean;
    pos: number;
};

export class RoomFlow {
    private static _networkOwner: RoomFlow | null = null;
    private _disposed = false;
    private _initializing = false;
    private _entryFailed = false;
    private _entryTimedOut = false;
    private _entryTimer: ReturnType<typeof setTimeout> | null = null;
    private _entryTask: Promise<void> | null = null;
    private _joined = false;
    private _localClientId: number | undefined;
    private _refreshTimer: ReturnType<typeof setTimeout> | null = null;
    private _root: Node | null = null;
    private _view: OnlineRoomView | null = null;
    private _readyPending = false;
    private _kickPending = false;
    private _leaving = false;
    private _mode: RaceDifficulty = getSelectedRaceDifficulty();
    private _rulesId = '';
    private _rulesRevision = 0;
    private _rulesOwnerPos = -1;
    private _localReadyRule = '';
    private _readyVersion = 0;
    private readonly _ruleReadyVersions: Record<number, number> = {};
    private readonly _ruleReady: Record<number, string> = {};
    private readonly _ruleReadyModifiers: Record<number, string> = {};
    private _startMembers: NetRaceMember[] | null = null;
    private _lastStartSeed = 0;
    private _rulesTimer: ReturnType<typeof setInterval> | null = null;
    private _members: SlotMember[] = [];
    private _netReal = false;
    private _accessInfo = '';
    // Human-readable room number (WeChat roomIdStr) shown so both players can confirm
    // they are in the same room. Empty until the room info arrives.
    private _roomId = '';
    private _isHost = true;
    private _pendingSeed = 0;
    // Peers' 养成 digests collected from the lobby broadcast channel, keyed by seat
    // (posNum). memberExtInfo is only 32 bytes (too small for a modifier blob), so each
    // client broadcasts its tiny digest instead; consumed into the session at start.
    private readonly _memberCareerLeagues: Record<number, number> = {};
    private readonly _memberModifiers: Record<number, string> = {};
    private readonly _memberProtocolVersions: Record<number, number> = {};
    private readonly _memberProtocolFingerprints: Record<number, string> = {};
    private _statusHint: string | null = null;
    private _startRequested = false;
    private _gameStartCalled = false;
    private _raceEntered = false;
    private _localReady = false;
    private _localPos = -1;
    // Recovery timer for a start that never completes (guest hadn't returned to the
    // lobby yet and missed the START broadcast) so the host can't get stuck at 开始中.
    private _startTimeoutHandle: any = null;
    // The WeChat game-start signal (onGameStart / roomState) has fired. On its own this
    // is NOT enough to enter a race: a fresh JOIN into a keep-alive room sees a stale
    // roomState=started and would auto-enter a phantom race. Entry also requires a real
    // 'start' broadcast (_pendingSeed != 0). See maybeEnterNetRace.
    private _gameStartConfirmed = false;
    // True once we've shown the "room gone" notice (invited room dissolved / in-game), so
    // render() stops repainting the lobby over it.
    private _roomUnavailable = false;

    constructor(
        private readonly _parent: Node,
        private readonly _width: number,
        private readonly _height: number,
        private readonly _callbacks: RoomFlowCallbacks,
        private readonly _joinRoomId: string | null = null,
        // True when RE-entering the room after a race (the WeChat room still exists):
        // reconnect to it instead of creating/joining a fresh one.
        private readonly _reconnect: boolean = false,
    ) {
        if (_reconnect && lastRoomMode) this._mode = lastRoomMode;
        if (_reconnect) {
            // Returning after a race: keep whatever role we had (owner stays owner).
            let owner = false;
            try {
                owner = netRoom().isOwner();
            } catch (error) {
                owner = !_joinRoomId;
            }
            this._isHost = owner;
        } else {
            this._isHost = !_joinRoomId;
        }
        this._localPos = this._isHost ? 0 : -1;
        this.build();
        this.setupNet();
    }

    private build() {
        this._view = new OnlineRoomView(this._parent, {
            exit: () => this.exit(),
            primary: () => this._entryTimedOut ? void this.exit() : this._entryFailed ? this.setupNet() : this._isHost ? this.startRace() : this.toggleReady(),
            invite: () => this.invite(),
            mode: value => this.changeMode(value),
            kick: member => { void this.kickMember(member); },
        });
        this._root = this._view.root;
    }

    private live(): boolean {
        return !this._disposed && !!this._root?.isValid && !this._roomUnavailable && !this._raceEntered;
    }

    private entryActive(): boolean { return this.live() && !this._leaving && !this._entryFailed; }

    private setupNet() {
        if (!this.live() || this._entryTask || this._leaving) return;
        this._initializing = true;
        this._entryFailed = false;
        this._entryTimedOut = false;
        this._statusHint = '正在读取角色资料…';
        this.render();
        // 已加载存档的本地预览不需要任何联机操作。
        if (PlayerData.loaded && !netRoom().isSupported()) {
            this._members = [this.selfMember()];
            this._initializing = false;
            this._statusHint = null;
            this.render();
            return;
        }
        this._entryTimer = setTimeout(() => {
            this._entryTimer = null;
            if (!this.live() || !this._entryTask || this._leaving) return;
            this._entryTimedOut = this._entryFailed = true;
            this._initializing = false;
            this._statusHint = '连接超时，请返回大厅后重试';
            this.render();
        }, 15000);
        this._entryTask = PlayerData.load().then(async () => {
            if (!this.entryActive()) return;
            if (!PlayerData.loaded) throw new Error('角色资料读取失败');
            if (!this._reconnect) { this._localPos = this._isHost ? 0 : -1; this._localClientId = undefined; }
            this._members = [this.selfMember()];
            const net = netRoom();
            this._netReal = net.isSupported();
            if (!this._netReal) return;
            this._statusHint = '正在连接房间…';
            this.render();
            await serializeRoomOperation(async () => {
                if (!this.entryActive()) return;
                // 处理上一次取消后仍留在平台上的房间；重赛保留现有会话。
                if (!this._reconnect && net.currentAccessInfo()) await net.leaveRoom();
                if (!this.entryActive()) return;
                RoomFlow._networkOwner = this;
                net.setCallbacks({
                    onRoomInfoChange: info => {
                        if (!this.entryActive() || this._initializing || this._startRequested) return;
                        this._members = this.membersFromInfo(info);
                        this.reconcileProtocolRoster(); this.render(); this.broadcastSelfModifiers();
                    },
                    onBroadcast: msg => { if (this.entryActive() && !this._initializing) this.handleBroadcast(msg); },
                    onGameStart: () => { if (this.entryActive() && !this._initializing) this.onNetGameStart(); },
                    onKicked: () => { if (this.live()) this.showRoomUnavailable('你已被房主移出房间'); },
                });
                if (this._reconnect) {
                    this._accessInfo = net.currentAccessInfo();
                    if (!this._accessInfo) throw new Error('原房间已不可用');
                    this._joined = true;
                    this._localReady = false;
                    await net.updateReady(false);
                } else {
                    await net.login();
                    if (!this.entryActive()) return;
                    const self = this.selfMember();
                    const extInfo = encodeIdentity(self.avatarId, self.nickName);
                    const info = this._joinRoomId
                        ? await net.joinRoom(this._joinRoomId, extInfo)
                        : await net.createRoom({ maxMembers: MAX_SLOTS, memberExtInfo: extInfo });
                    this._joined = true;
                    this._accessInfo = info.accessInfo || this._joinRoomId || net.currentAccessInfo();
                    this._members = this.membersFromInfo(info);
                    this.reconcileProtocolRoster();
                }
                if (!this.entryActive()) {
                    // 取消时平台请求可能已成功；在新进房开始前清理，不能留下幽灵成员。
                    await net.leaveRoom(); this._joined = false; return;
                }
                this._initializing = false;
                this._statusHint = null;
                if (this._isHost) { await net.updateReady(true); this._localReady = true; }
                if (!this.entryActive()) { await net.leaveRoom(); this._joined = false; return; }
                this.stopRulesTimer();
                this._rulesTimer = setInterval(() => {
                    if (this.live() && !this._leaving) { this.broadcastSelfModifiers(); this.broadcastRules(); }
                }, 1500);
                this.refreshRoomInfo(0);
                this.broadcastSelfModifiers(); this.broadcastRules();
            });
        }).catch(error => {
            if (!this.entryActive()) return;
            this._entryFailed = true;
            this._statusHint = PlayerData.loaded ? '连接房间失败，请检查网络或邀请后重试' : '角色资料读取失败，请重试';
            console.warn('[房间] 初始化失败', error);
        }).then(() => {
            this._entryTask = null;
            if (this._entryTimer !== null) clearTimeout(this._entryTimer);
            this._entryTimer = null;
            this._initializing = false;
            if (this.live() && !this._leaving) { if (!this._netReal && !this._entryFailed) this._statusHint = null; this.render(); }
        });
    }

    private selfMember(): SlotMember {
        const identity = parseIdentity(encodeIdentity(PlayerData.avatarId, PlayerData.nickName));
        return {
            clientId: this._localClientId,
            self: true,
            avatarId: identity.avatarId,
            nickName: identity.nickName,
            ready: this._localReady,
            owner: this._isHost,
            pos: this._localPos,
        };
    }

    // Resolve + store the local player's own 养成 digest into the seat map (no broadcast).
    // Returns the payload ('' if none). Used before a lobby broadcast and before the host
    // consolidates the map into the start message.
    private storeSelfModifiers(): string {
        if (this._localPos < 0) {
            return '';
        }
        let payload = '';
        try {
            payload = encodeModifierDigest(resolveLocalModifierDigest());
        } catch (error) {
            console.warn('[Room] resolve modifiers failed', error);
        }
        if (payload) {
            this._memberModifiers[this._localPos] = payload;
        }
        return payload;
    }

    // Best-effort lobby broadcast of our digest so the HOST collects it while everyone
    // waits in the lobby. The host later consolidates all collected digests into the start
    // message (see startRace), which is the authoritative, race-free delivery to every
    // client — so a lost lobby broadcast only matters if it never reaches the host at all.
    private broadcastSelfModifiers() {
        if (!this._netReal || this._localPos < 0) {
            return;
        }
        this.broadcastSelfCareer();
        this._memberProtocolVersions[this._localPos] = NET_RACE_PROTOCOL_VERSION;
        netRoom().broadcast(encodeProtocolHello(this._localPos));
        const payload = this.storeSelfModifiers();
        if (!payload) {
            return;
        }
        const member = this._members.find(m => m.pos === this._localPos);
        if (member) netRoom().broadcast(`MOD|${this._localPos}|${encodeURIComponent(this.memberKey(member))}|${payload}`);
    }

    // 徽章仅供房间展示，独立于比赛养成摘要；复用房间定时器补偿广播丢包。
    private broadcastSelfCareer(): void {
        if (!this._netReal || this._localPos < 0) return;
        netRoom().broadcast(`CB|${this._localPos}|${PlayerData.profile.career.league}`);
    }

    private collectMemberCareer(msg: string): void {
        const match = /^CB\|([0-7])\|(\d+)$/.exec(msg);
        if (!match) return;
        const pos = Number(match[1]), league = Number(match[2]);
        if (pos === this._localPos || !this._members.some(m => m.pos === pos)
            || league >= LEAGUES.length || this._memberCareerLeagues[pos] === league) return;
        this._memberCareerLeagues[pos] = league;
        this.render();
    }

    // Ask every modern peer to repeat its PV| declaration. This is used only when
    // a user action is blocked by incomplete protocol state, so retries are naturally
    // rate-limited by that action and a lost first declaration cannot deadlock the room.
    private requestProtocolDeclarations() {
        if (!this._netReal || this._localPos < 0) {
            return;
        }
        this.broadcastSelfModifiers();
        netRoom().broadcast(encodeProtocolRequest(this._localPos));
    }

    // Collect a peer's lobby digest broadcast, keyed by seat (the host builds the map here).
    private collectMemberModifiers(msg: string) {
        // MOD|座位|成员标识|角色摘要
        const body = msg.slice(4);
        const sep = body.indexOf(IDENTITY_SEP);
        if (sep < 0) {
            return;
        }
        const pos = Number(body.slice(0, sep));
        const identityEnd = body.indexOf(IDENTITY_SEP, sep + 1);
        if (identityEnd < 0) return;
        const member = this._members.find(m => m.pos === pos);
        const payload = body.slice(identityEnd + 1);
        if (Number.isInteger(pos) && pos !== this._localPos && member && payload) {
            if (body.slice(sep + 1, identityEnd) !== encodeURIComponent(this.memberKey(member)) || !hasCompleteModifierDigest(payload)) return;
            if (this._memberModifiers[pos] === payload) return;
            this._memberModifiers[pos] = payload;
            this.render();
        }
    }

    private collectProtocolHello(msg: string) {
        const hello = decodeProtocolHello(msg);
        if (!hello || !this._members.some((member) => member.pos === hello.pos)) {
            return;
        }
        const firstDeclaration = this._memberProtocolVersions[hello.pos] === undefined;
        this._memberProtocolVersions[hello.pos] = hello.version;
        if (hello.version !== NET_RACE_PROTOCOL_VERSION && this._localReady && !this._isHost) {
            this._localReady = false;
            netRoom().updateReady(false).catch(() => undefined);
        }
        if (firstDeclaration && hello.pos !== this._localPos) {
            // One reply closes the common "new member missed the existing peer's
            // declaration" race without creating a broadcast echo loop.
            this.broadcastSelfModifiers();
        }
        this.render();
    }

    private reconcileProtocolRoster() {
        const active: Record<number, boolean> = {};
        for (const member of this._members) {
            if (member.pos < 0) {
                continue;
            }
            active[member.pos] = true;
            const fingerprint = this.memberKey(member);
            if (this._memberProtocolFingerprints[member.pos] !== fingerprint) {
                delete this._memberProtocolVersions[member.pos];
                delete this._memberModifiers[member.pos];
                delete this._memberCareerLeagues[member.pos];
                delete this._ruleReady[member.pos];
                delete this._ruleReadyModifiers[member.pos];
                delete this._ruleReadyVersions[member.pos];
                this._memberProtocolFingerprints[member.pos] = fingerprint;
            }
            if (member.self) {
                this._memberProtocolVersions[member.pos] = NET_RACE_PROTOCOL_VERSION;
            }
        }
        for (const rawPos of Object.keys(this._memberProtocolVersions)) {
            const pos = Number(rawPos);
            if (!active[pos]) {
                delete this._memberProtocolVersions[pos];
            }
        }
        for (const rawPos of Object.keys(this._memberProtocolFingerprints)) {
            const pos = Number(rawPos);
            if (!active[pos]) {
                delete this._memberProtocolFingerprints[pos];
                delete this._memberModifiers[pos];
                delete this._memberCareerLeagues[pos];
                delete this._ruleReady[pos];
                delete this._ruleReadyModifiers[pos];
                delete this._ruleReadyVersions[pos];
            }
        }
        if (!this.protocolCompatible() && this._localReady && !this._isHost) {
            this._localReady = false;
            netRoom().updateReady(false).catch(() => undefined);
        }
    }

    private protocolCompatible(): boolean {
        return hasCompatibleProtocol(
            this._members.map((member) => member.pos),
            this._memberProtocolVersions,
        );
    }

    // Adopt the host's consolidated digest map from the start message. Authoritative:
    // every client uses the SAME map, so each swimmer's balance is identical everywhere,
    // and it arrives atomically with the seed (no seed-vs-digest broadcast race).
    private mergeBroadcastModifiers(mods: unknown): boolean {
        if (!mods || typeof mods !== 'object' || Array.isArray(mods)) return false;
        const map = mods as Record<string, string>;
        if (Object.keys(map).length !== this._members.length || !this.completeModifiers(map)
            || map[this._localPos] !== encodeModifierDigest(resolveLocalModifierDigest())) return false;
        for (const member of this._members) this._memberModifiers[member.pos] = map[member.pos];
        return true;
    }

    private memberKey(member: SlotMember): string { return `${member.clientId ?? ''}|${member.avatarId}|${member.nickName}`; }

    private completeModifiers(map = this._memberModifiers): boolean {
        return this._members.length >= 2 && new Set(this._members.map(member => member.pos)).size === this._members.length
            && this._members.some(member => member.self && member.pos === this._localPos)
            && this._members.every(member => Number.isInteger(member.pos) && member.pos >= 0 && member.pos < MAX_SLOTS && hasCompleteModifierDigest(map[member.pos]));
    }

    private captureStartMembers(): void {
        this._startMembers = this._members.map(member => ({ avatarId: member.avatarId, nickName: member.nickName,
            self: member.pos === this._localPos, pos: member.pos, modifiersBlob: this._memberModifiers[member.pos] }));
    }

    private membersFromInfo(info: NetRoomInfo): SlotMember[] {
        if (Number.isInteger(info.localPos) && info.localPos! >= 0 && info.localPos! < MAX_SLOTS) this._localPos = info.localPos!;
        if (Number.isInteger(info.localClientId)) this._localClientId = info.localClientId;
        // Capture room metadata (display number + join token) wherever roster info
        // arrives, so the room number stays up to date on every client.
        if (info.roomId) {
            this._roomId = info.roomId;
        }
        // Only adopt an accessInfo we don't already have. The authoritative JOIN TOKEN
        // comes from createRoom/joinRoom (setupNet); room-info payloads don't include it,
        // so never let them overwrite the real token (doing so shared the roomIdStr and
        // made friends fail joinRoom with errCode 4003).
        if (info.accessInfo && !this._accessInfo) {
            this._accessInfo = info.accessInfo;
        }
        const list: SlotMember[] = info.members.map((m) => {
            const parsed = parseIdentity(m.extInfo);
            return {
                clientId: m.clientId,
                self: false,
                avatarId: parsed.avatarId,
                nickName: parsed.nickName,
                ready: m.ready === true,
                owner: m.owner === true,
                pos: typeof m.pos === 'number' ? m.pos : -1,
            };
        });
        // Identify our own slot. Prefer the seat index (posNum) when we know it — two
        // players can roll the SAME random avatar+nickname, so an identity-only match
        // can highlight the wrong person ("房间显示的人不对"). Fall back to identity.
        const localIdentity = this.selfMember();
        const selfId = localIdentity.avatarId;
        const selfName = localIdentity.nickName;
        let mine = this._localClientId !== undefined ? list.find(m => m.clientId === this._localClientId)
            : this._localPos >= 0 ? list.find((m) => m.pos === this._localPos) : undefined;
        if (!mine && this._localClientId === undefined && this._localPos < 0) {
            const matches = list.filter(m => m.avatarId === selfId && m.nickName === selfName);
            if (matches.length === 1) mine = matches[0];
        }
        if (mine) {
            mine.self = true;
            // Trust the server's ready state + seat index for our own slot.
            if (!this._readyPending) this._localReady = mine.ready && (mine.owner || this._localReadyRule === this.ruleKey());
            if (mine.pos >= 0) {
                this._localPos = mine.pos;
            }
            // Ownership can transfer to us mid-lobby (the host left, so WeChat's
            // assignToMinPosNum handed ownership to the lowest-seat member). Promote to
            // the host view (start button + auto-ready) so the room stays controllable.
            if (mine.owner && !this._isHost) {
                this._isHost = true;
                this._rulesId = '';
                this._rulesRevision = 0;
                this._localReady = true;
                mine.ready = true;
                netRoom().updateReady(true).catch(() => undefined);
            }
            if (!mine.owner) this._isHost = false;
        } else if (list.length === 0) {
            list.push(this.selfMember());
        }
        // Stable seat order so every device shows the same roster in the same slots
        // (WeChat can deliver memberList in arbitrary order → "人不对/乱跳").
        list.sort((a, b) => {
            const pa = a.pos >= 0 ? a.pos : MAX_SLOTS + 1;
            const pb = b.pos >= 0 ? b.pos : MAX_SLOTS + 1;
            if (pa !== pb) {
                return pa - pb;
            }
            return a.nickName.localeCompare(b.nickName);
        });
        return list;
    }

    // Pull the authoritative room roster a few times after joining. Bridges the gap
    // where the joiner doesn't get an onRoomInfoChange for their own join, and the
    // roster may take a moment to propagate. Ongoing changes still arrive via
    // onRoomInfoChange once we're an existing member.
    private refreshRoomInfo(attempt: number) {
        if (!this._netReal || !this.live() || this._leaving || this._startRequested) {
            return;
        }
        netRoom()
            .getRoomInfo()
            .then((info) => {
                if (!this.live() || this._leaving || this._startRequested || !this._netReal) {
                    return;
                }
                if (info && info.members.length > 0) {
                    this._members = this.membersFromInfo(info);
                    this.reconcileProtocolRoster();
                    this.render();
                    // The backup roster pull (and the rematch/reconnect path, which enters
                    // through here — NOT onRoomInfoChange) is where a guest often first
                    // learns its own seat. (Re)broadcast our 养成 digest so the host collects
                    // it; idempotent, guarded on a known seat.
                    this.broadcastSelfModifiers();
                }
                if (attempt < 4) {
                    this.scheduleRoomRefresh(attempt + 1);
                }
            })
            .catch(() => {
                if (attempt < 4) {
                    this.scheduleRoomRefresh(attempt + 1);
                }
            });
    }

    private scheduleRoomRefresh(attempt: number): void {
        if (!this.live() || this._leaving || this._startRequested) return;
        if (this._refreshTimer !== null) clearTimeout(this._refreshTimer);
        this._refreshTimer = setTimeout(() => { this._refreshTimer = null; this.refreshRoomInfo(attempt); }, 700);
    }

    // A guest's invited room is gone (host dissolved it) or already in a race, so joining
    // failed. Replace the lobby with a clean centered notice + a back button instead of
    // leaving them in a fake room showing a raw "invalid room state" error.
    private showRoomUnavailable(message: string) {
        if (this._roomUnavailable) return;
        this._netReal = false;
        this._roomUnavailable = true;
        this._startRequested = false;
        this._gameStartCalled = false;
        this.clearStartTimeout();
        this.stopRulesTimer();
        if (this._root?.isValid) this._view?.showUnavailable(message);
    }

    private render() {
        if (this._disposed || this._roomUnavailable || !this._root?.isValid) return;
        const localDigest = resolveLocalModifierDigest();
        const members: OnlineMember[] = this._members.map(m => {
            const digest = m.self ? localDigest : decodeModifierDigest(this._memberModifiers[m.pos]);
            const character = digest ? PLAYER_CHARACTER_DEFINITIONS.find(c => c.id === digest.characterId)?.name : null;
            return {
                ...m, pos: m.pos < 0 ? 0 : m.pos,
                ready: m.owner || (m.self ? this._localReady : m.ready),
                character: character ?? '角色同步中…', level: digest?.level ?? 0,
                careerLeague: m.self ? PlayerData.profile.career.league : this._memberCareerLeagues[m.pos],
            };
        });
        const canStart = !this._initializing && !this._entryFailed && (!this._netReal || (this.allMembersReady() && this.protocolCompatible() && this.completeModifiers()));
        const hint = this._statusHint ?? (!this._netReal
            ? '本地预览 · 真机联机可邀请好友'
            : this._isHost
                ? this._members.length < 2 ? '邀请好友加入 · 至少 2 人可开始' : canStart ? '全部准备就绪 · 空位由 AI 补齐' : '等待成员准备并确认赛制'
                : this._localReady ? '已准备 · 等待房主开始' : '准备好后点击右下方按钮');
        this._view?.update({
            members, isHost: this._isHost, ready: this._localReady,
            busy: this._initializing || this._startRequested || this._readyPending || this._kickPending || this._leaving,
            primaryText: this._entryTimedOut ? '返回大厅' : this._entryFailed ? '重试连接' : undefined,
            canStart, roomNumber: this._netReal ? this._roomId || '获取中…' : '本地预览',
            hint, mode: this._mode,
        });
    }

    private invite() {
        if (this._netReal && this._accessInfo) {
            platform().share({ title: '一起来游泳对战！', query: `room=${encodeURIComponent(this._accessInfo)}` });
        } else this.setHint('邀请好友需真机联机');
    }

    private allMembersReady(): boolean {
        const key = this.ruleKey();
        return this._members.length >= 2 && this._members.every(m =>
            m.owner || (m.ready && this._ruleReady[m.pos] === key && this._ruleReadyModifiers[m.pos] === this._memberModifiers[m.pos]));
    }

    // Guest toggles their own ready state (shown on every client's avatar badge via
    // updateReadyStatus -> onRoomInfoChange).
    private toggleReady() {
        if (!this.live() || this._initializing || this._entryFailed || this._isHost || this._readyPending || this._startRequested || this._leaving) return;
        if (!this._localReady && (!this.protocolCompatible() || !this._rulesId || !this.completeModifiers())) {
            this.requestProtocolDeclarations();
            this.broadcastRules();
            this.setHint('正在同步玩家角色和赛制，请稍后准备');
            return;
        }
        void this.setReady(!this._localReady);
    }

    private async setReady(ready: boolean) {
        if (this._readyPending) return;
        const previous = this._localReady;
        const rules = this.ruleKey();
        this._readyPending = true;
        this._readyVersion++;
        this.broadcastRules();
        this._statusHint = null;
        this.render();
        try {
            await netRoom().updateReady(ready);
            if (!this.live() || this._leaving) return;
            this._localReady = ready && rules === this.ruleKey();
            this._localReadyRule = this._localReady ? rules : '';
            // 请求过程中房主换了赛制，旧的准备确认不能复活。
            if (ready && !this._localReady) await netRoom().updateReady(false);
        } catch {
            if (!this.live() || this._leaving) return;
            this._localReady = rules === this.ruleKey() ? previous : false;
            this._statusHint = '准备状态更新失败，请重试';
        } finally {
            this._readyPending = false;
            this._readyVersion++;
            if (this.live() && !this._leaving) {
                this.broadcastRules();
                this.render();
            }
        }
    }

    private ruleKey(): string { return `${this._rulesId}:${this._rulesRevision}`; }

    private changeMode(mode: RaceDifficulty) {
        if (!this.entryActive() || this._initializing || !this._isHost || this._startRequested || this._kickPending || this._leaving || mode === this._mode) return;
        this._mode = mode;
        this._rulesRevision++;
        for (const pos of Object.keys(this._ruleReady)) delete this._ruleReady[Number(pos)];
        this._statusHint = this._netReal ? '赛制已切换，等待成员重新准备' : null;
        this.broadcastRules();
        this.render();
    }

    private broadcastRules() {
        if (!this._netReal || !this._accessInfo || this._localPos < 0) return;
        this.broadcastSelfCareer();
        if (this._isHost) {
            if (!this._rulesId) this._rulesId = String(Date.now());
            netRoom().broadcast(JSON.stringify({ t: 'rules', owner: this._localPos, id: this._rulesId, rev: this._rulesRevision, mode: this._mode }));
        } else if (this._rulesId) {
            const member = this._members.find(m => m.pos === this._localPos && m.self);
            if (!member) return;
            netRoom().broadcast(JSON.stringify({ t: 'rulesReady', pos: this._localPos, key: this.ruleKey(), seq: this._readyVersion,
                member: this.memberKey(member), mods: this.storeSelfModifiers(), ready: this._localReady && !this._readyPending }));
        }
    }

    private handleRules(data: any): boolean {
        if (data?.t === 'rulesReady') {
            if (this._isHost && this._members.some(m => m.pos === data.pos && !m.owner && data.member === this.memberKey(m)) && data.key === this.ruleKey() &&
                Number.isSafeInteger(data.seq) && data.seq >= (this._ruleReadyVersions[data.pos] ?? -1)) {
                this._ruleReadyVersions[data.pos] = data.seq;
                if (data.ready === true && hasCompleteModifierDigest(data.mods)) {
                    this._ruleReady[data.pos] = data.key;
                    this._ruleReadyModifiers[data.pos] = data.mods;
                } else { delete this._ruleReady[data.pos]; delete this._ruleReadyModifiers[data.pos]; }
                this.render();
            }
            return true;
        }
        if (data?.t !== 'rules') return false;
        const owner = this._members.find(m => m.owner);
        if (this._isHost || !owner || data.owner !== owner.pos || typeof data.id !== 'string' ||
            !Number.isSafeInteger(data.rev) || data.rev < 0 || !ROOM_MODES.some(m => m.id === data.mode)) return true;
        if (!/^\d{13,16}$/.test(data.id)) return true;
        if (this._rulesOwnerPos === owner.pos && Number(data.id) < Number(this._rulesId)) return true;
        if (data.id === this._rulesId && data.rev < this._rulesRevision) return true;
        if (data.id !== this._rulesId || data.rev !== this._rulesRevision) {
            const hadRules = !!this._rulesId;
            this._rulesId = data.id;
            this._rulesOwnerPos = owner.pos;
            this._rulesRevision = data.rev;
            this._mode = data.mode;
            this._localReady = false;
            this._localReadyRule = '';
            this._readyVersion++;
            if (!this._readyPending) void this.setReady(false);
            this._statusHint = hadRules ? '房主更改了赛制，请重新准备' : null;
            this.render();
        }
        this.broadcastRules();
        return true;
    }

    private async kickMember(member: OnlineMember) {
        if (!this.entryActive() || this._initializing || !this._netReal || !this._isHost || member.self || member.owner || this._startRequested || this._kickPending || this._leaving) return;
        this._kickPending = true; this._statusHint = null; this.render();
        try {
            // 弹窗打开后名单可能变化；再查服务端，不能踢掉占用同一座位的新成员。
            const info = await netRoom().getRoomInfo();
            if (!this._root?.isValid || this._leaving) return;
            const target = info?.members.find(m => m.pos === member.pos);
            const identity = target ? parseIdentity(target.extInfo) : null;
            if (!netRoom().isOwner() || !target || target.owner ||
                (member.clientId !== undefined && target.clientId !== member.clientId) ||
                identity?.avatarId !== member.avatarId || identity?.nickName !== member.nickName) {
                this.setHint('成员或房主已变化，请重新选择'); return;
            }
            await netRoom().kickMember(member.pos);
            if (this._root?.isValid) { this.setHint('已移出该成员'); this.refreshRoomInfo(0); }
        } catch { if (this._root?.isValid) this.setHint('踢出失败，请稍后重试'); }
        finally { this._kickPending = false; this.render(); }
    }

    private stopRulesTimer() {
        if (this._rulesTimer !== null) clearInterval(this._rulesTimer);
        this._rulesTimer = null;
        if (this._refreshTimer !== null) clearTimeout(this._refreshTimer);
        this._refreshTimer = null;
    }

    private startRace() {
        if (!this.live() || this._initializing || this._entryFailed || this._startRequested || this._kickPending || this._leaving) return;
        if (!this._netReal) {
            setRaceDifficulty(this._mode);
            lastRoomMode = this._mode;
            this.stopRulesTimer();
            // Editor / local preview: launch the placeholder single-player race.
            this._callbacks.onStartLocalRace(this._members.length);
            return;
        }
        if (!this._isHost) {
            this.setHint('等待房主开始…');
            return;
        }
        if (this._members.length < 2) {
            this.setHint('至少需要 2 名玩家才能开始');
            return;
        }
        if (!this.allMembersReady()) {
            this.setHint('等待所有玩家准备…');
            return;
        }
        if (!this.protocolCompatible()) {
            this.requestProtocolDeclarations();
            this.setHint('玩家版本不一致或仍在确认，无法开始联机比赛');
            return;
        }
        this.storeSelfModifiers();
        if (!this.completeModifiers()) { this.requestProtocolDeclarations(); this.setHint('角色资料尚未同步完整，请稍后开始'); return; }
        if (this._startRequested) {
            return;
        }
        this._startRequested = true;
        setRaceDifficulty(this._mode);
        // Follow the WeChat lock-step demo: the host broadcasts a START signal carrying
        // the shared seed; EVERY member — INCLUDING the host — then calls startGame. The
        // host used to skip startGame and rely on passive roomState detection, but that
        // poll returned undefined on device, leaving the host stuck at 开始中 while the
        // guest started and timed out into becoming host. onGameStart / roomState / the
        // startGame-success fallback (WechatGameRoom) then delivers the start signal.
        this._pendingSeed = SeededRandom.entropySeed() || 1;
        this.setHint('开始中…');
        // Consolidated start: carry the shared seed AND the full 养成 digest map (collected
        // from lobby broadcasts, plus our own) in ONE message. This removes the seed-vs-
        // digest broadcast race and per-peer drop — every client adopts the SAME map
        // atomically with the seed. Since the start message is a precondition for entering,
        // a swimmer can never slip in with the wrong balance. Host-authoritative + consistent.
        this.storeSelfModifiers();
        this.captureStartMembers();
        this.broadcastStart(JSON.stringify({
            t: 'start',
            pv: NET_RACE_PROTOCOL_VERSION,
            seed: this._pendingSeed,
            mods: this._memberModifiers,
            mode: this._mode,
            rules: this.ruleKey(),
            owner: this._localPos,
            roster: this._members.map(member => this.memberKey(member)),
        }));
        if (this._reconnect) {
            // Rematch on the still-alive session: do NOT startGame again (WeChat rooms are
            // one-game — a second startGame returns 4014 / a fake ok with roomState stuck
            // at gameEnd, PROVEN on device). Reuse the running session: the seed is
            // broadcast and we enter directly. Guests enter on the broadcast (handleBroadcast).
            this.enterNetRace();
        } else {
            // First game: the host calls startGame itself (not just the guests) so it
            // becomes a frame participant + gets a reliable start signal; the broadcast
            // makes the guests do the same. requestStartGame arms the recovery timeout.
            this.requestStartGame();
        }
    }

    private broadcastStart(message: string): void {
        const net = netRoom(), accessInfo = this._accessInfo, seed = this._pendingSeed;
        net.broadcast(message);
        // 房间广播可能丢包，有限补发跨过场景切换；换房、取消或新一轮开始后失效。
        for (const delay of [300, 900, 1800]) setTimeout(() => {
            if (net.currentAccessInfo() === accessInfo && this._pendingSeed === seed
                && (this._raceEntered || (this.live() && !this._leaving && this._startRequested))) net.broadcast(message);
        }, delay);
    }

    // Recover from a start that never completes (e.g. the guest hadn't returned to the
    // lobby yet and missed the START broadcast, so nobody's game actually started).
    // After a grace period, clear the pending flags so the host can retry once everyone
    // is genuinely back and ready — instead of being stuck at 开始中 forever.
    private armStartTimeout() {
        this.clearStartTimeout();
        this._startTimeoutHandle = setTimeout(() => {
            this._startTimeoutHandle = null;
            if (this._raceEntered) {
                return;
            }
            this._startRequested = false;
            this._gameStartCalled = false;
            this._pendingSeed = 0;
            this._startMembers = null;
            this._gameStartConfirmed = false;
            this.setHint('开始失败，请确认好友已回到房间并准备后重试');
            this.render();
        }, 8000);
    }

    private clearStartTimeout() {
        if (this._startTimeoutHandle) {
            clearTimeout(this._startTimeoutHandle);
            this._startTimeoutHandle = null;
        }
    }

    // Enter lock-step by calling startGame (once). Host calls this after broadcasting;
    // guests call it on receiving the broadcast. Race entry is driven by onGameStart.
    private requestStartGame() {
        if (this._gameStartCalled) {
            return;
        }
        this._gameStartCalled = true;
        this.setHint('开始中…');
        this.armStartTimeout();
        netRoom().startGame().catch((error) => {
            console.warn('[Room] startGame failed', error);
        });
    }

    // 首局房主和成员都需调用 startGame；重赛继续复用已有会话，不再次调用。
    private handleBroadcast(msg: string) {
        if (typeof msg !== 'string' || !this.live() || this._leaving || this._entryFailed) return;
        if (msg.startsWith('CB|')) { this.collectMemberCareer(msg); return; }
        const protocolRequest = decodeProtocolRequest(msg);
        if (protocolRequest) {
            // RoomFlow owns callbacks only while this client is in the lobby. A
            // request from another current roster seat receives exactly one hello;
            // requests never answer requests, so this cannot form an echo loop.
            if (protocolRequest.requesterPos !== this._localPos
                && this._members.some((member) => member.pos === protocolRequest.requesterPos)) {
                this.broadcastSelfModifiers();
            }
            return;
        }
        if (decodeProtocolHello(msg)) {
            this.collectProtocolHello(msg);
            return;
        }
        // 养成 digest from a peer (lobby broadcast): collect it by seat for race start.
        if (typeof msg === 'string' && msg.slice(0, 4) === 'MOD|') {
            this.collectMemberModifiers(msg);
            return;
        }
        // Only our own room-control messages are JSON objects ('{...}'). The race layer
        // also broadcasts tagged strings (S|, R|, GO|, Q|) that can still arrive at this
        // handler right after returning to the lobby — ignore anything that isn't a JSON
        // object instead of spamming parse errors.
        if (typeof msg !== 'string' || msg.charCodeAt(0) !== 123) {
            return;
        }
        try {
            const data = JSON.parse(msg);
            if (this.handleRules(data)) return;
            if (data && data.t === 'start' && typeof data.seed === 'number') {
                if (this._isHost || this._startRequested || data.seed === this._lastStartSeed
                    || !Number.isInteger(data.seed) || data.seed <= 0 || data.seed > 0xffffffff
                    || data.owner !== this._members.find(member => member.owner)?.pos) return;
                if (!isCompatibleProtocolVersion(data.pv)) {
                    if (this._localReady && !this._isHost) {
                        this._localReady = false;
                        netRoom().updateReady(false).catch(() => undefined);
                    }
                    this.setHint('房主版本与当前客户端不兼容，请更新后重试');
                    return;
                }
                if (!this._isHost && (!this._localReady || data.rules !== this.ruleKey() || data.mode !== this._mode)) {
                    this.setHint('赛制或准备状态未确认，请重新准备'); return;
                }
                if (!ROOM_MODES.some(m => m.id === data.mode)) return;
                if (!Array.isArray(data.roster) || data.roster.length !== this._members.length
                    || data.roster.some((key: unknown, index: number) => key !== this.memberKey(this._members[index]))
                    || !this.mergeBroadcastModifiers(data.mods)) {
                    this.requestProtocolDeclarations(); this.setHint('开赛资料不完整，请重新准备'); return;
                }
                this._lastStartSeed = data.seed;
                this.captureStartMembers();
                this._mode = data.mode;
                setRaceDifficulty(this._mode);
                this._pendingSeed = data.seed >>> 0;
                this._startRequested = true;
                this.setHint('开始中…');
                // Adopt the host's consolidated 养成 digest map (authoritative + identical on
                // every client) BEFORE entering, so all clients apply the same balance.
                if (this._reconnect) {
                    // Rematch: the lock-step session is still alive (we never endGame),
                    // so enter directly instead of calling startGame (which would 4014).
                    this.enterNetRace();
                } else {
                    // First game: EVERY member (host + guests) calls startGame, matching
                    // the official demo. requestStartGame is guarded by _gameStartCalled,
                    // so the host also calling it in startRace is harmless.
                    this.requestStartGame();
                    // We now have the shared seed; enter if the game-start signal already
                    // arrived (or once it does, via onNetGameStart).
                    this.maybeEnterNetRace();
                }
            }
        } catch (error) {
            console.warn('[Room] bad broadcast', error);
        }
    }

    // onGameStart fired (or roomState reached "started"). The HOST always has its own
    // seed, so this completes its entry. A GUEST must ALSO have received the host's
    // 'start' broadcast (the shared seed) before entering: onGameStart alone can come
    // from a STALE roomState when JOINING a keep-alive room (whose session stays
    // "started" between races), and entering off that would start a phantom race with a
    // random seed. maybeEnterNetRace enforces "real start in progress + game started".
    private onNetGameStart() {
        this._gameStartConfirmed = true;
        this.maybeEnterNetRace();
    }

    // Enter the net race only when BOTH conditions hold: a real start is in progress
    // (we have the shared seed from a 'start' broadcast or our own startRace) AND the
    // WeChat game has started (onGameStart / roomState). Prevents a fresh join into an
    // already-started keep-alive room from auto-entering off the stale roomState.
    private maybeEnterNetRace() {
        if (!this.live() || this._leaving) {
            return;
        }
        if (this._pendingSeed !== 0 && this._gameStartConfirmed) {
            this.enterNetRace();
        }
    }

    // Lock-step has begun on every client: hand the agreed seed + roster to the race.
    private enterNetRace() {
        if (!this.live() || this._leaving || !this._startMembers || !this._pendingSeed
            || this._localPos < 0 || !this._startMembers.some(member => member.pos === this._localPos)) {
            return;
        }
        this._raceEntered = true;
        lastRoomMode = this._mode;
        this.stopRulesTimer();
        this.clearStartTimeout();
        // Clear our ready as the race begins so the server doesn't carry a stale
        // isReady=true through the race — otherwise a member who returns to the lobby
        // FIRST sees the still-racing member as "ready" until they get back. Best-effort
        // (may be rejected mid-game); returning to the lobby also resets it.
        this._localReady = false;
        netRoom().updateReady(false).catch(() => undefined);
        const members = this._startMembers;
        setNetRaceSession({
            seed: this._pendingSeed >>> 0,
            members,
            localIsHost: this._isHost,
            localPos: this._localPos,
        });
        this._callbacks.onStartNetRace();
    }

    private setHint(text: string) {
        this._statusHint = text || null;
        this.render();
    }

    private async exit() {
        if (await this.leaveForInvite()) {
            if (!this._disposed && this._root?.isValid) this._callbacks.onExit();
        }
    }

    // 退出和换邀请共用同一事务；退出失败仍保留当前房间供重试。
    async leaveForInvite(): Promise<boolean> {
        if (this._disposed || this._leaving || this._startRequested || this._raceEntered) return false;
        this._leaving = true; this.render();
        // 尚未完成进房时立即允许离开界面；平台迟到的成功会在原队列内清理。
        if (this._entryTask && !this._joined) return true;
        try {
            await serializeRoomOperation(async () => {
                if ((this._joined || RoomFlow._networkOwner === this) && netRoom().currentAccessInfo()) await netRoom().leaveRoom();
                this._joined = false;
            });
            this.stopRulesTimer();
            return true;
        } catch {
            this._leaving = false;
            this.setHint('退出房间失败，请重试');
            return false;
        }
    }

    // Whether this room is the one identified by the given accessInfo (share token).
    // Used to ignore an invite to the SAME room the player is already in (instead of
    // pointlessly leaving and rejoining).
    matchesRoom(accessInfo: string): boolean {
        if (!accessInfo) {
            return false;
        }
        return accessInfo === this._accessInfo || accessInfo === this._joinRoomId;
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        this.stopRulesTimer();
        this.clearStartTimeout();
        if (this._entryTimer !== null) clearTimeout(this._entryTimer);
        this._entryTimer = null;
        if (RoomFlow._networkOwner === this) {
            if (!this._raceEntered) netRoom().setCallbacks({});
            RoomFlow._networkOwner = null;
        }
        if (!this._raceEntered && (this._joined || this._entryTask)) {
            void serializeRoomOperation(async () => {
                // 新房间已接管时不再执行旧界面的清理；待完成的进房在同一队列内先行取消。
                if (RoomFlow._networkOwner && RoomFlow._networkOwner !== this) return;
                if (netRoom().currentAccessInfo()) await netRoom().leaveRoom();
                this._joined = false;
            }).catch(error => console.warn('[房间] 取消连接后的清理失败', error));
        }
        if (this._root?.isValid) {
            this._root.destroy();
        }
        this._root = null;
        this._view = null;
    }
}

function encodeIdentity(avatarId: string, nickName: string): string {
    const avatar = AVATARS.some(item => item.id === avatarId) ? avatarId : 'aqua';
    let remaining = 32 - avatar.length - 1;
    let name = '';
    // memberExtInfo 按 UTF-8 字节限制；不能以 JS 字符数截断中文或表情。
    for (const character of nickName || '玩家') {
        const point = character.codePointAt(0)!;
        const bytes = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
        if (bytes > remaining) break;
        name += character; remaining -= bytes;
    }

    return `${avatar}${IDENTITY_SEP}${name}`;
}

function parseIdentity(extInfo: string | undefined): { avatarId: string; nickName: string } {
    if (!extInfo) {
        return { avatarId: 'aqua', nickName: '玩家' };
    }
    const sep = extInfo.indexOf(IDENTITY_SEP);
    if (sep < 0) {
        return { avatarId: 'aqua', nickName: extInfo };
    }
    return { avatarId: extInfo.slice(0, sep) || 'aqua', nickName: extInfo.slice(sep + 1) || '玩家' };
}
