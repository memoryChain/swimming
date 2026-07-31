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
import { makeButton, makeLabel, makeRect, makeUiNode, uiColor } from './RuntimeUiFactory';
import { HEADBAR_TOP_SAFE_AREA } from './ResourceHeadBar';
import { avatarColorOf } from '../backend/IdentityConfig';
import { PlayerData } from '../backend/PlayerData';
import { netRoom } from '../net/NetManager';
import { NetRoomInfo } from '../net/INetRoom';
import { NetRaceMember, setNetRaceSession } from '../net/NetRaceSession';
import { SeededRandom } from '../core/SharedRNG';
import { platform } from '../platform/PlatformManager';

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
    private _startButton: Node | null = null;
    private _members: SlotMember[] = [];
    private _netReal = false;
    private _accessInfo = '';
    private _isHost = true;
    private _pendingSeed = 0;
    private _statusHint: string | null = null;
    private _startRequested = false;
    private _gameStartCalled = false;
    private _raceEntered = false;
    private _localReady = false;
    private _localPos = -1;

    constructor(
        private readonly _parent: Node,
        private readonly _width: number,
        private readonly _height: number,
        private readonly _callbacks: RoomFlowCallbacks,
        private readonly _joinRoomId: string | null = null,
    ) {
        this._isHost = !_joinRoomId;
        this._localPos = this._isHost ? 0 : -1;
        this.build();
        this.setupNet();
    }

    private build() {
        const root = makeUiNode('RoomFlow', this._parent);
        this._root = root;
        makeRect('Backdrop', root, this._width, this._height, uiColor(6, 18, 32, 255));

        const titleY = this._height / 2 - HEADBAR_TOP_SAFE_AREA - 30;
        makeLabel('RoomTitle', root, '联机房间', 40, uiColor(240, 250, 255)).setPosition(0, titleY, 0);
        const hint = makeLabel('RoomHint', root, '', 20, uiColor(180, 210, 232));
        hint.getComponent(UITransform)!.setContentSize(560, 28);
        hint.setPosition(0, titleY - 46, 0);
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
                    this.render();
                },
                onBroadcast: (msg) => this.handleBroadcast(msg),
                onGameStart: () => this.enterNetRace(),
            });
            const extInfo = encodeIdentity(self.avatarId, self.nickName);
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
                })
                .catch((error) => {
                    const reason = (error && (error.errMsg || error.message)) || String(error);
                    console.warn('[Room] net enter failed, local preview:', reason, error);
                    this._netReal = false;
                    this._statusHint = this._joinRoomId
                        ? `加入房间失败：${reason}`
                        : `建房失败：${reason}`;
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

    private membersFromInfo(info: NetRoomInfo): SlotMember[] {
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
        // Best-effort self highlight (no reliable openId match on-device yet): mark
        // the first member whose identity equals ours.
        const selfId = PlayerData.avatarId;
        const selfName = PlayerData.nickName;
        const mine = list.find((m) => m.avatarId === selfId && m.nickName === selfName);
        if (mine) {
            mine.self = true;
            // Trust the server's ready state + seat index for our own slot.
            this._localReady = mine.ready;
            if (mine.pos >= 0) {
                this._localPos = mine.pos;
            }
        } else if (list.length === 0) {
            list.push(this.selfMember());
        }
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
                    this.render();
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

    private render() {
        const content = this._content;
        if (!content?.isValid) {
            return;
        }
        content.removeAllChildren();
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
        return this._members.length >= 2 && this._members.every((m) => m.ready);
    }

    // Guest toggles their own ready state (shown on every client's avatar badge via
    // updateReadyStatus -> onRoomInfoChange).
    private toggleReady() {
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
        if (this._startRequested) {
            return;
        }
        this._startRequested = true;
        // Follow the WeChat lock-step demo: the host broadcasts a START signal carrying
        // the shared seed; EVERY member (including the host, which receives its own
        // broadcast) then calls startGame via handleBroadcast. With startPercent=0 the
        // game starts and onGameStart fires on ALL members — that is the ONLY signal
        // used to enter the race. (Entering earlier uploads frames before the frame
        // loop exists -> nativeInstance.uploadFrame error.)
        this._pendingSeed = SeededRandom.entropySeed();
        this.setHint('开始中…');
        netRoom().broadcast(JSON.stringify({ t: 'start', seed: this._pendingSeed }));
        // Do NOT call startGame directly here: the host must go through its own
        // broadcast (handleBroadcast -> requestStartGame) like the guest, otherwise it
        // becomes the lone initiator that the server does NOT deliver onGameStart to.
    }

    // Enter lock-step by calling startGame (once). Host calls this after broadcasting;
    // guests call it on receiving the broadcast. Race entry is driven by onGameStart.
    private requestStartGame() {
        if (this._gameStartCalled) {
            return;
        }
        this._gameStartCalled = true;
        this.setHint('开始中…');
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
        try {
            const data = JSON.parse(msg);
            if (data && data.t === 'start' && typeof data.seed === 'number') {
                this._pendingSeed = data.seed >>> 0;
                if (!this._isHost) {
                    this.requestStartGame();
                }
            }
        } catch (error) {
            console.warn('[Room] bad broadcast', error);
        }
    }

    // Lock-step has begun on every client: hand the agreed seed + roster to the race.
    private enterNetRace() {
        if (this._raceEntered) {
            return;
        }
        this._raceEntered = true;
        const members: NetRaceMember[] = this._members.map((m) => ({
            avatarId: m.avatarId,
            nickName: m.nickName,
            self: m.self,
            pos: typeof m.pos === 'number' ? m.pos : -1,
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

    dispose() {
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
