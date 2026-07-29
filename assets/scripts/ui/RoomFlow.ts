// Online room screen: an 8-slot lobby where the player and invited friends gather
// before a networked race. The local player takes one slot; empty slots show a "+"
// that invites a friend (WeChat share). The host can start once there are ≥2 humans;
// remaining slots are filled with AI at race time.
//
// Backed by the net layer (netRoom()). In the editor/web build the game service is
// unavailable, so it falls back to a LOCAL preview room (just you) that is still
// fully viewable/clickable. The actual networked race (frame sync + AI fill +
// return-to-room after finishing) is phase 2B and needs on-device testing.

import { Graphics, Label, Node, UITransform } from 'cc';
import { makeButton, makeLabel, makeRect, makeUiNode, uiColor } from './RuntimeUiFactory';
import { HEADBAR_TOP_SAFE_AREA } from './ResourceHeadBar';
import { avatarColorOf } from '../backend/IdentityConfig';
import { PlayerData } from '../backend/PlayerData';
import { netRoom } from '../net/NetManager';
import { NetRoomInfo } from '../net/INetRoom';
import { platform } from '../platform/PlatformManager';

export type RoomFlowCallbacks = {
    onExit: () => void;
    // Launch the race with the given number of human players (AI fills the rest).
    onStartRace: (humanCount: number) => void;
};

const MAX_SLOTS = 8;
const IDENTITY_SEP = '|';

type SlotMember = {
    self: boolean;
    avatarId: string;
    nickName: string;
};

export class RoomFlow {
    private _root: Node | null = null;
    private _content: Node | null = null;
    private _hintLabel: Label | null = null;
    private _startButton: Node | null = null;
    private _members: SlotMember[] = [];
    private _netReal = false;
    private _accessInfo = '';

    constructor(
        private readonly _parent: Node,
        private readonly _width: number,
        private readonly _height: number,
        private readonly _callbacks: RoomFlowCallbacks,
    ) {
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

        const exit = makeButton('ExitRoom', root, 220, 60, uiColor(90, 96, 104, 235), '退出房间');
        exit.setPosition(-150, -this._height / 2 + 70, 0);
        exit.on(Node.EventType.TOUCH_END, () => this.exit());
        const start = makeButton('StartRoomRace', root, 260, 60, uiColor(38, 150, 96, 245), '开始比赛');
        start.setPosition(160, -this._height / 2 + 70, 0);
        start.on(Node.EventType.TOUCH_END, () => this.startRace());
        this._startButton = start;
    }

    private setupNet() {
        const self = this.selfMember();
        const net = netRoom();
        this._netReal = net.isSupported();
        net.setCallbacks({
            onRoomInfoChange: (info) => {
                this._members = this.membersFromInfo(info);
                this.render();
            },
        });
        if (this._netReal) {
            net.login()
                .then(() => net.createRoom({
                    maxMembers: MAX_SLOTS,
                    memberExtInfo: encodeIdentity(self.avatarId, self.nickName),
                }))
                .then((info) => {
                    this._accessInfo = info.accessInfo;
                    this._members = this.membersFromInfo(info);
                    this.render();
                })
                .catch((error) => {
                    console.warn('[Room] game service unavailable, local preview', error);
                    this._netReal = false;
                    this._members = [self];
                    this.render();
                });
        } else {
            // Editor / web: local preview room with just the player.
            this._members = [self];
        }
        this.render();
    }

    private selfMember(): SlotMember {
        return { self: true, avatarId: PlayerData.avatarId, nickName: PlayerData.nickName };
    }

    private membersFromInfo(info: NetRoomInfo): SlotMember[] {
        const list = info.members.map((m) => {
            const parsed = parseIdentity(m.extInfo);
            return { self: false, avatarId: parsed.avatarId, nickName: parsed.nickName };
        });
        // Best-effort self highlight (no reliable openId match on-device yet): mark
        // the first member whose identity equals ours.
        const selfId = PlayerData.avatarId;
        const selfName = PlayerData.nickName;
        const mine = list.find((m) => m.avatarId === selfId && m.nickName === selfName);
        if (mine) {
            mine.self = true;
        } else if (list.length === 0) {
            list.push(this.selfMember());
        }
        return list;
    }

    private render() {
        const content = this._content;
        if (!content?.isValid) {
            return;
        }
        content.removeAllChildren();
        const cols = 4;
        const gapX = 168;
        const rowY = [40, -150];
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
        if (this._hintLabel?.isValid) {
            this._hintLabel.string = this._netReal
                ? `已加入 ${humanCount}/${MAX_SLOTS} 人 · 至少 2 名真人可开始，空位由 AI 补齐`
                : '本地预览房间（真机联机才能邀请好友） · 空位由 AI 补齐';
        }
        // Host gating: real net needs ≥2 humans; local preview allows a solo demo.
        const canStart = !this._netReal || humanCount >= 2;
        if (this._startButton?.isValid) {
            const label = this._startButton.getChildByName('Label')?.getComponent(Label);
            if (label) {
                label.color = canStart ? uiColor(255, 255, 255, 235) : uiColor(160, 176, 190, 200);
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
            platform().share({ title: '一起来游泳对战！', query: `room=${this._accessInfo}` });
        } else {
            console.log('[Room] invite friend (real device only)');
            if (this._hintLabel?.isValid) {
                this._hintLabel.string = '邀请好友需真机联机（分享房间给好友加入）';
            }
        }
    }

    private startRace() {
        const humanCount = this._members.length;
        if (this._netReal && humanCount < 2) {
            if (this._hintLabel?.isValid) {
                this._hintLabel.string = '至少需要 2 名真人玩家才能开始';
            }
            return;
        }
        this._callbacks.onStartRace(humanCount);
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
