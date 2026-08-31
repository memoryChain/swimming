// Online room screen: an 8-slot lobby where the player and invited friends gather
// before a networked race. The local player takes one slot; empty slots show a "+"
// that invites a friend (WeChat share). The host can start once there are ≥2 humans;
// remaining slots are filled with AI at race time.
//
// Backed by the net layer (netRoom()). In the editor/web build the game service is
// unavailable, so it falls back to a LOCAL preview room (just you) that is still
// fully viewable/clickable. The actual networked race (frame sync + AI fill +
// return-to-room after finishing) is phase 2B and needs on-device testing.

import { Graphics, Label, Node, UITransform, view } from 'cc';
import { fitFullScreenBackgroundCover, makeButton, makeLabel, makeRect, makeUiNode, uiColor } from './RuntimeUiFactory';
import { HEADBAR_TOP_SAFE_AREA } from './ResourceHeadBar';
import { avatarColorOf } from '../backend/IdentityConfig';
import { PlayerData } from '../backend/PlayerData';
import { netRoom } from '../net/NetManager';
import { NetRoomInfo } from '../net/INetRoom';
import { NetRaceMember, setNetRaceSession } from '../net/NetRaceSession';
import { SeededRandom } from '../core/SharedRNG';
import { platform } from '../platform/PlatformManager';
import { resolveLocalModifierDigest } from '../progression/RaceModifiers';
import { encodeModifierDigest } from '../net/NetRaceModifierCodec';
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

type SlotMember = {
    self: boolean;
    avatarId: string;
    nickName: string;
    ready: boolean;
    owner: boolean;
    pos: number;
};

export class RoomFlow {
    private _root: Node | null = null;
    private _content: Node | null = null;
    private _hintLabel: Label | null = null;
    private _roomLabel: Label | null = null;
    private _startButton: Node | null = null;
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
        const root = makeUiNode('RoomFlow', this._parent);
        this._root = root;
        const backdrop = makeRect('Backdrop', root, this._width, this._height, uiColor(6, 18, 32, 255));
        fitFullScreenBackgroundCover(backdrop);

        const titleY = this._height / 2 - HEADBAR_TOP_SAFE_AREA - 30;
        makeLabel('RoomTitle', root, '联机房间', 40, uiColor(240, 250, 255)).setPosition(0, titleY, 0);
        // Room number so both players can verify they are in the SAME room (the #1
        // source of confusion: "am I even with my friend?"). Filled once the room
        // info arrives; hidden in local-preview mode.
        const roomLabel = makeLabel('RoomNumber', root, '', 24, uiColor(255, 224, 150));
        roomLabel.getComponent(UITransform)!.setContentSize(560, 30);
        roomLabel.setPosition(0, titleY - 40, 0);
        this._roomLabel = roomLabel.getComponent(Label);
        const hint = makeLabel('RoomHint', root, '', 20, uiColor(180, 210, 232));
        hint.getComponent(UITransform)!.setContentSize(560, 28);
        hint.setPosition(0, titleY - 74, 0);
        this._hintLabel = hint.getComponent(Label);

        this._content = makeUiNode('Slots', root);

        const bottomY = -this._height / 2 + 70;
        const exit = makeButton('ExitRoom', root, 220, 60, uiColor(90, 96, 104, 235), '退出房间');
        exit.setPosition(-150, bottomY, 0);
        exit.on(Node.EventType.TOUCH_END, () => this.exit());
        // Host gets the start button; guests get a ready toggle. (_isHost is set before
        // build() runs.)
        const action = makeButton('StartRoomRace', root, 260, 60, uiColor(38, 150, 96, 245), this._isHost ? '开始比赛' : '准备');
        action.setPosition(160, bottomY, 0);
        action.on(Node.EventType.TOUCH_END, () => (this._isHost ? this.startRace() : this.toggleReady()));
        this._startButton = action;
    }

    private setupNet() {
        const self = this.selfMember();
        // Show yourself immediately so the lobby is NEVER blank, no matter whether the
        // game service connects, hangs, or throws synchronously on this device. On a
        // real phone the async login/createRoom below may take a moment (or fail if the
        // 联机对战 service is not enabled) — the grid must still render first.
        this._members = [self];
        this.render();

        const net = netRoom();
        let supported = false;
        try {
            supported = net.isSupported();
        } catch (error) {
            supported = false;
        }
        this._netReal = supported;
        if (!supported) {
            // Editor / web / unsupported: stay in the local preview room (just you).
            return;
        }

        // Any of setCallbacks/login/createRoom can throw synchronously if the game
        // service is unavailable; keep it from breaking the whole screen.
        try {
            net.setCallbacks({
                onRoomInfoChange: (info) => {
                    this._members = this.membersFromInfo(info);
                    this.reconcileProtocolRoster();
                    this.render();
                    // Roster changed (e.g. a newcomer joined): re-broadcast our digest so
                    // they collect it too.
                    this.broadcastSelfModifiers();
                },
                onBroadcast: (msg) => this.handleBroadcast(msg),
                onGameStart: () => this.onNetGameStart(),
            });
            const extInfo = encodeIdentity(self.avatarId, self.nickName);
            if (this._reconnect) {
                // Returning after a race: the WeChat room still exists and we are still
                // a member — do NOT create/join a new one (that would fork the room, so
                // the host ends up alone while the guest sees a stale roster). Re-attach
                // callbacks (they were replaced by NetRaceController during the race),
                // have the owner END the previous game so the room returns to the lobby,
                // reset our ready flag, and re-pull the roster.
                this._accessInfo = net.currentAccessInfo();
                // KEEP-ALIVE rematch (WeChat rooms are strictly one-game): do NOT endGame.
                // PROVEN on device — after endGame the room is stuck at roomState=3
                // (gameEnd); a second startGame returns 4014 for a member and a fake "ok"
                // (no real start) for the owner, so the room can never be reused. Instead
                // we keep the ORIGINAL lock-step session alive (the server heartbeat keeps
                // it running while we sit in the lobby) and enter the next race DIRECTLY
                // (see startRace / handleBroadcast). Just re-attach callbacks (done above),
                // reset our ready flag, and re-pull the roster.
                this._localReady = false;
                net.updateReady(false).catch(() => undefined);
                this.refreshRoomInfo(0);
                this.render();
                return;
            }
            const enter = this._joinRoomId
                ? net.login().then(() => net.joinRoom(this._joinRoomId!, extInfo))
                : net.login().then(() => net.createRoom({ maxMembers: MAX_SLOTS, memberExtInfo: extInfo }));
            enter
                .then((info) => {
                    this._accessInfo = info.accessInfo || this._joinRoomId || this._accessInfo;
                    this._statusHint = null;
                    // WeChat's joinRoom result is just { myPos, clientId } with NO
                    // roster, so mapping it yields a self-only list. Don't let it
                    // clobber the fuller roster we may already have received via
                    // onRoomInfoChange (which DOES reach the joiner on device).
                    const mapped = this.membersFromInfo(info);
                    if (mapped.length >= this._members.length) {
                        this._members = mapped;
                        this.reconcileProtocolRoster();
                    }
                    this.render();
                    // Backup pull of the authoritative roster (a few retries) in case
                    // onRoomInfoChange didn't reach us on this device.
                    this.refreshRoomInfo(0);
                    // The host auto-readies: the official demo requires ALL members
                    // (including the owner) to be ready before starting, and unready
                    // members don't seem to receive onGameStart. Guests ready manually.
                    if (this._isHost) {
                        this._localReady = true;
                        netRoom().updateReady(true).catch(() => undefined);
                    }
                    this.broadcastSelfModifiers();
                })
                .catch((error) => {
                    const reason = (error && (error.errMsg || error.message)) || String(error);
                    console.warn('[Room] net enter failed:', reason, error);
                    if (this._joinRoomId) {
                        // A guest tapping an invite whose room no longer accepts us: the
                        // host left and dissolved it, or the race already started (WeChat
                        // returns "invalid room state"). Don't drop into a fake local room
                        // with a raw error — show a clean "dissolved" notice + back button.
                        this.showRoomUnavailable('房间已解散或已开始比赛');
                        return;
                    }
                    // Host create failed (editor / service down): local preview fallback.
                    this._netReal = false;
                    this._statusHint = `建房失败：${reason}`;
                    this._members = [self];
                    this.render();
                });
        } catch (error) {
            const reason = (error && ((error as any).errMsg || (error as any).message)) || String(error);
            console.warn('[Room] game service threw, local preview:', reason, error);
            this._netReal = false;
            this._statusHint = `联机服务异常：${reason}`;
            this._members = [self];
            this.render();
        }
    }

    private selfMember(): SlotMember {
        return {
            self: true,
            avatarId: PlayerData.avatarId,
            nickName: PlayerData.nickName,
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
        this._memberProtocolVersions[this._localPos] = NET_RACE_PROTOCOL_VERSION;
        netRoom().broadcast(encodeProtocolHello(this._localPos));
        const payload = this.storeSelfModifiers();
        if (!payload) {
            return;
        }
        netRoom().broadcast(`MOD|${this._localPos}|${payload}`);
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
        // "MOD|<pos>|<payload>"
        const body = msg.slice(4);
        const sep = body.indexOf(IDENTITY_SEP);
        if (sep < 0) {
            return;
        }
        const pos = parseInt(body.slice(0, sep), 10);
        const payload = body.slice(sep + 1);
        if (Number.isFinite(pos) && payload) {
            this._memberModifiers[pos] = payload;
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
            const fingerprint = `${member.avatarId}|${member.nickName}`;
            if (this._memberProtocolFingerprints[member.pos] !== fingerprint) {
                delete this._memberProtocolVersions[member.pos];
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
    private mergeBroadcastModifiers(mods: unknown) {
        if (!mods || typeof mods !== 'object') {
            return;
        }
        const map = mods as Record<string, unknown>;
        for (const key of Object.keys(map)) {
            const pos = parseInt(key, 10);
            const payload = map[key];
            if (Number.isFinite(pos) && typeof payload === 'string' && payload) {
                this._memberModifiers[pos] = payload;
            }
        }
    }

    private membersFromInfo(info: NetRoomInfo): SlotMember[] {
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
        const selfId = PlayerData.avatarId;
        const selfName = PlayerData.nickName;
        let mine = this._localPos >= 0 ? list.find((m) => m.pos === this._localPos) : undefined;
        if (!mine) {
            mine = list.find((m) => m.avatarId === selfId && m.nickName === selfName);
        }
        if (mine) {
            mine.self = true;
            // Trust the server's ready state + seat index for our own slot.
            this._localReady = mine.ready;
            if (mine.pos >= 0) {
                this._localPos = mine.pos;
            }
            // Ownership can transfer to us mid-lobby (the host left, so WeChat's
            // assignToMinPosNum handed ownership to the lowest-seat member). Promote to
            // the host view (start button + auto-ready) so the room stays controllable.
            if (mine.owner && !this._isHost) {
                this._isHost = true;
                this._localReady = true;
                mine.ready = true;
                netRoom().updateReady(true).catch(() => undefined);
            }
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
        if (!this._netReal || !this._root?.isValid) {
            return;
        }
        netRoom()
            .getRoomInfo()
            .then((info) => {
                if (!this._root?.isValid || !this._netReal) {
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
                    setTimeout(() => this.refreshRoomInfo(attempt + 1), 700);
                }
            })
            .catch(() => {
                if (attempt < 4) {
                    setTimeout(() => this.refreshRoomInfo(attempt + 1), 700);
                }
            });
    }

    // A guest's invited room is gone (host dissolved it) or already in a race, so joining
    // failed. Replace the lobby with a clean centered notice + a back button instead of
    // leaving them in a fake room showing a raw "invalid room state" error.
    private showRoomUnavailable(message: string) {
        this._netReal = false;
        this._roomUnavailable = true;
        this.clearStartTimeout();
        if (!this._root?.isValid) {
            return;
        }
        this._content?.removeAllChildren();
        if (this._startButton?.isValid) {
            this._startButton.active = false;
        }
        this.setHint('');
        this._root.getChildByName('RoomUnavailable')?.destroy();
        const panel = makeUiNode('RoomUnavailable', this._root);
        makeLabel('Notice', panel, message, 32, uiColor(240, 224, 200)).setPosition(0, 40, 0);
        const back = makeButton('BackFromDissolved', panel, 260, 62, uiColor(60, 130, 90, 245), '返回大厅');
        back.setPosition(0, -50, 0);
        back.on(Node.EventType.TOUCH_END, () => this.exit());
    }

    private render() {
        if (this._roomUnavailable) {
            return;
        }
        const content = this._content;
        if (!content?.isValid) {
            return;
        }        content.removeAllChildren();
        // Fixed landscape layout (the game is locked to landscape). Deliberately NOT
        // based on the live viewport: during a share the viewport briefly flips to
        // portrait, and reacting to it left the grid stuck in a narrow layout after
        // returning from the share sheet.
        const cols = 4;
        const gapX = 168;
        const rowY = [40, -150];
        const vs = view.getVisibleSize();
        console.log(`[Room] render members=${this._members.length} view=${Math.round(vs.width)}x${Math.round(vs.height)} netReal=${this._netReal} host=${this._isHost}`);
        for (let i = 0; i < MAX_SLOTS; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const cx = (col - (cols - 1) / 2) * gapX;
            const cy = rowY[row];
            const member = this._members[i];
            if (member) {
                this.buildFilledSlot(content, cx, cy, member);
            } else {
                this.buildEmptySlot(content, cx, cy, i);
            }
        }
        const humanCount = this._members.length;
        // Count ALL members (the host auto-readies too), matching the demo's allReady.
        const readyCount = this._members.filter((m) => m.ready).length;
        const allReady = humanCount >= 2 && readyCount === humanCount;
        if (this._roomLabel?.isValid) {
            if (!this._netReal) {
                this._roomLabel.string = '本地预览房间（真机联机才有房间号）';
            } else if (this._roomId) {
                this._roomLabel.string = `房间号 ${this._roomId}（与好友核对是否一致）`;
            } else {
                this._roomLabel.string = '房间号 获取中…';
            }
        }
        if (this._hintLabel?.isValid) {
            if (this._statusHint) {
                this._hintLabel.string = this._statusHint;
            } else if (!this._netReal) {
                this._hintLabel.string = '本地预览房间（真机联机才能邀请好友） · 空位由 AI 补齐';
            } else if (this._isHost) {
                this._hintLabel.string = humanCount < 2
                    ? '邀请好友加入 · 至少 2 人可开始'
                    : `${readyCount}/${humanCount} 名玩家已准备${allReady ? ' · 可以开始' : '，等待全部准备'}`;
            } else {
                this._hintLabel.string = this._localReady ? '已准备 · 等待房主开始' : '点“准备”后等待房主开始';
            }
        }
        if (this._startButton?.isValid) {
            const label = this._startButton.getChildByName('Label')?.getComponent(Label);
            if (label) {
                if (!this._isHost && this._netReal) {
                    label.string = this._localReady ? '取消准备' : '准备';
                    label.color = this._localReady ? uiColor(255, 214, 140, 235) : uiColor(255, 255, 255, 235);
                } else {
                    const canStart = !this._netReal || allReady;
                    label.string = '开始比赛';
                    label.color = canStart ? uiColor(255, 255, 255, 235) : uiColor(160, 176, 190, 200);
                }
            }
        }
    }

    private buildFilledSlot(content: Node, cx: number, cy: number, member: SlotMember) {
        const [r, g, b] = avatarColorOf(member.avatarId);
        const ring = makeUiNode('SlotRing', content);
        ring.setPosition(cx, cy + 26, 0);
        const gfx = ring.addComponent(Graphics);
        if (member.self) {
            gfx.fillColor = uiColor(20, 205, 229, 255);
            gfx.circle(0, 0, 50);
            gfx.fill();
        }
        gfx.fillColor = uiColor(r, g, b, 255);
        gfx.circle(0, 0, 44);
        gfx.fill();
        const name = makeLabel('SlotName', content, member.self ? `${member.nickName}(你)` : member.nickName, 20, uiColor(240, 250, 255));
        name.getComponent(UITransform)!.setContentSize(150, 28);
        name.setPosition(cx, cy - 40, 0);
        // Ready / owner badge under the name so the host can see who is ready.
        let badgeText: string;
        let badgeColor;
        if (member.owner) {
            badgeText = '房主';
            badgeColor = uiColor(246, 205, 110);
        } else if (member.ready) {
            badgeText = '已准备';
            badgeColor = uiColor(88, 214, 141);
        } else {
            badgeText = '未准备';
            badgeColor = uiColor(150, 170, 188);
        }
        const badge = makeLabel('SlotReady', content, badgeText, 16, badgeColor);
        badge.getComponent(UITransform)!.setContentSize(120, 22);
        badge.setPosition(cx, cy - 64, 0);
    }

    private buildEmptySlot(content: Node, cx: number, cy: number, index: number) {
        const plus = makeButton(`AddSlot_${index}`, content, 92, 92, uiColor(18, 44, 70, 235), '+');
        const label = plus.getChildByName('Label')?.getComponent(Label);
        if (label) {
            label.fontSize = 48;
        }
        plus.setPosition(cx, cy + 26, 0);
        plus.on(Node.EventType.TOUCH_END, () => this.invite());
        const tip = makeLabel(`AddTip_${index}`, content, '邀请好友', 16, uiColor(150, 178, 200));
        tip.getComponent(UITransform)!.setContentSize(120, 22);
        tip.setPosition(cx, cy - 40, 0);
    }

    private invite() {
        if (this._netReal && this._accessInfo) {
            platform().share({ title: '一起来游泳对战！', query: `room=${encodeURIComponent(this._accessInfo)}` });
        } else {
            console.log('[Room] invite friend (real device only)');
            if (this._hintLabel?.isValid) {
                this._hintLabel.string = '邀请好友需真机联机（分享房间给好友加入）';
            }
        }
    }

    private allMembersReady(): boolean {
        // The host readies implicitly by pressing 开始, so only non-host members must be
        // ready. (After a race everyone returns not-ready, so this also prevents the
        // host from starting a rematch until the guest is genuinely back and readied.)
        return this._members.length >= 2 && this._members.every((m) => m.owner || m.ready);
    }

    // Guest toggles their own ready state (shown on every client's avatar badge via
    // updateReadyStatus -> onRoomInfoChange).
    private toggleReady() {
        if (!this._localReady && !this.protocolCompatible()) {
            this.requestProtocolDeclarations();
            this.setHint('玩家版本不一致或仍在确认，暂时不能准备');
            return;
        }
        this._localReady = !this._localReady;
        this.render();
        if (this._netReal) {
            netRoom().updateReady(this._localReady).catch((error) => {
                console.warn('[Room] updateReady failed', error);
            });
        }
    }

    private startRace() {
        if (!this._netReal) {
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
        if (this._startRequested) {
            return;
        }
        this._startRequested = true;
        // Follow the WeChat lock-step demo: the host broadcasts a START signal carrying
        // the shared seed; EVERY member — INCLUDING the host — then calls startGame. The
        // host used to skip startGame and rely on passive roomState detection, but that
        // poll returned undefined on device, leaving the host stuck at 开始中 while the
        // guest started and timed out into becoming host. onGameStart / roomState / the
        // startGame-success fallback (WechatGameRoom) then delivers the start signal.
        this._pendingSeed = SeededRandom.entropySeed();
        this.setHint('开始中…');
        // Consolidated start: carry the shared seed AND the full 养成 digest map (collected
        // from lobby broadcasts, plus our own) in ONE message. This removes the seed-vs-
        // digest broadcast race and per-peer drop — every client adopts the SAME map
        // atomically with the seed. Since the start message is a precondition for entering,
        // a swimmer can never slip in with the wrong balance. Host-authoritative + consistent.
        this.storeSelfModifiers();
        netRoom().broadcast(JSON.stringify({
            t: 'start',
            pv: NET_RACE_PROTOCOL_VERSION,
            seed: this._pendingSeed,
            mods: this._memberModifiers,
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

    // The host broadcasts START; guests call startGame on receiving it. The HOST
    // (room owner) does NOT call startGame: on device the owner that calls startGame
    // never becomes a real frame participant (uploadFrame's nativeInstance is never
    // created), while a guest that calls startGame works. Mirroring the official demo
    // (where the owner doesn't receive its own broadcast and so never calls startGame),
    // only guests call startGame; the host enters via game-start detection (roomState).
    private handleBroadcast(msg: string) {
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
            if (data && data.t === 'start' && typeof data.seed === 'number') {
                if (!isCompatibleProtocolVersion(data.pv)) {
                    if (this._localReady && !this._isHost) {
                        this._localReady = false;
                        netRoom().updateReady(false).catch(() => undefined);
                    }
                    this.setHint('房主版本与当前客户端不兼容，请更新后重试');
                    return;
                }
                this._pendingSeed = data.seed >>> 0;
                // Adopt the host's consolidated 养成 digest map (authoritative + identical on
                // every client) BEFORE entering, so all clients apply the same balance.
                this.mergeBroadcastModifiers(data.mods);
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
        if (this._raceEntered) {
            return;
        }
        if (this._pendingSeed !== 0 && this._gameStartConfirmed) {
            this.enterNetRace();
        }
    }

    // Lock-step has begun on every client: hand the agreed seed + roster to the race.
    private enterNetRace() {
        if (this._raceEntered) {
            return;
        }
        this._raceEntered = true;
        this.clearStartTimeout();
        // Clear our ready as the race begins so the server doesn't carry a stale
        // isReady=true through the race — otherwise a member who returns to the lobby
        // FIRST sees the still-racing member as "ready" until they get back. Best-effort
        // (may be rejected mid-game); returning to the lobby also resets it.
        this._localReady = false;
        netRoom().updateReady(false).catch(() => undefined);
        const members: NetRaceMember[] = this._members.map((m) => ({
            avatarId: m.avatarId,
            nickName: m.nickName,
            self: m.self,
            pos: typeof m.pos === 'number' ? m.pos : -1,
            // 养成 digest collected from the lobby broadcasts (empty if it never arrived,
            // e.g. an old client or a dropped broadcast -> that swimmer stays neutral).
            modifiersBlob: this._memberModifiers[typeof m.pos === 'number' ? m.pos : -1] ?? '',
        }));
        setNetRaceSession({
            seed: (this._pendingSeed >>> 0) || SeededRandom.entropySeed(),
            members,
            localIsHost: this._isHost,
            localPos: this._localPos >= 0 ? this._localPos : (this._isHost ? 0 : 0),
        });
        this._callbacks.onStartNetRace();
    }

    private setHint(text: string) {
        if (this._hintLabel?.isValid) {
            this._hintLabel.string = text;
        }
    }

    private exit() {
        netRoom().leaveRoom().catch(() => undefined);
        this._callbacks.onExit();
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
        this.clearStartTimeout();
        netRoom().setCallbacks({});
        if (this._root?.isValid) {
            this._root.destroy();
        }
        this._root = null;
        this._content = null;
        this._hintLabel = null;
        this._startButton = null;
    }
}

function encodeIdentity(avatarId: string, nickName: string): string {
    return `${avatarId}${IDENTITY_SEP}${nickName}`;
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
