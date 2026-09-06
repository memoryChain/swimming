import { Button, Color, Label, Node, Sprite, UITransform } from 'cc';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { RaceDifficulty, getRaceDistance } from '../core/GameBalance';
import { avatarTexturePath, loadAvatarUiSpriteFrame } from './AvatarUiAssets';
import { fitFullScreenBackgroundCover, makeLabel, makeRoundedRect, makeScreenEdgeGroup, makeTouchArea, makeUiNode, uiColor } from './RuntimeUiFactory';
import { PROJECT_UI_ENGLISH_BOLD_FAMILY, styleProjectUiLabel } from './ProjectUiFonts';

const ART = RESOURCE_PATHS.onlineRoomUi;
// 与 PSD 文字图层一致，不把辅助文字、等级、人数都套成主文字色。
const INK = uiColor(9, 30, 70);
const WHITE = uiColor(255, 255, 255);
const MUTED = uiColor(73, 100, 140);
const JOINED = uiColor(0, 179, 149);
const HEADER_INK = uiColor(23, 36, 58);
type TextFace = 'project' | 'regular' | 'dynamic' | 'latin';
export const ROOM_MODES: ReadonlyArray<{ id: RaceDifficulty; label: string }> = [
    { id: 'beginner', label: '入门泳道' },
    { id: 'competitive', label: '竞技泳道' },
    { id: 'championship', label: '超级世锦赛' },
];
export type OnlineMember = {
    clientId?: number;
    pos: number; self: boolean; owner: boolean; ready: boolean;
    avatarId: string; nickName: string; character: string; level: number;
};
export type OnlineRoomState = {
    members: OnlineMember[]; isHost: boolean; ready: boolean; busy: boolean;
    canStart: boolean; roomNumber: string; hint: string; mode: RaceDifficulty;
};
type Card = { background: Sprite; avatar: Sprite; ring: Sprite; nickname: Label; role: Label;
    badge: Label; badgeBg: Sprite; plus: Label; empty: Label; member?: OnlineMember; signature: string };

/** 固定层级，只在房间事件或操作时更新；不参与比赛逐帧更新。坐标来自 1280×720 PSD。 */
export class OnlineRoomView {
    readonly root: Node;
    private readonly content: Node;
    private readonly cards: Card[] = [];
    private readonly textureKeys = new Map<Sprite, string>();
    private readonly hostAvatar: Sprite;
    private readonly hostName: Label;
    private readonly hostCharacter: Label;
    private readonly hostLevel: Label;
    private readonly roomNumber: Label;
    private readonly roomNumberLocal: Label;
    private readonly count: Label;
    private readonly modeText: Label;
    private readonly modePermission: Label;
    private readonly modeArrow: Label;
    private readonly hint: Label;
    private readonly primaryArt: Sprite;
    private readonly primaryText: Label;
    private readonly primary: Node;
    private readonly drawer: Node;
    private readonly modeLabels: Label[] = [];
    private readonly modeDistances: Label[] = [];
    private readonly modeUnits: Label[] = [];
    private readonly modeChecks: Label[] = [];
    private readonly popup: Node;
    private readonly popupName: Label;
    private readonly popupCharacter: Label;
    private readonly kick: Node;
    private readonly kickText: Label;
    private state: OnlineRoomState | null = null;
    private popupPos = -1;
    private confirmingKick = false;

    constructor(parent: Node, private readonly actions: {
        exit(): void; primary(): void; invite(): void; mode(value: RaceDifficulty): void; kick(member: OnlineMember): void;
    }) {
        this.root = makeUiNode('OnlineRoom', parent);
        const bg = this.picture(this.root, 'Background', RESOURCE_PATHS.characterUi.background, 0, 0, 1280, 720);
        fitFullScreenBackgroundCover(bg.node);
        const header = makeScreenEdgeGroup('RoomHeader', this.root, 'left', 1280, 720, 0, false);
        this.picture(header, 'CharacterHeader', RESOURCE_PATHS.characterUi.headerBackground, 0, 0, 497, 111);
        const controls = makeScreenEdgeGroup('RoomHeaderControls', header, 'left', 1280, 720, 0);
        this.picture(controls, 'BackIcon', RESOURCE_PATHS.characterUi.backIcon, 27, 19, 61, 40);
        this.text(controls, 'Title', '联机', 104, 13, 140, 48, 36, false).color = HEADER_INK;
        this.touch(controls, 'Back', 16, 9, 90, 68, actions.exit);
        this.content = makeUiNode('Content', this.root);
        const p = this.content;
        this.picture(p, 'HostPanel', ART.hostPanel, 64, 84, 404, 522);
        this.picture(p, 'MembersPanel', ART.membersPanel, 468, 98, 760, 508);
        this.text(p, 'HostHeading', '房主', 112, 130, 130, 50, 34, false);
        this.hostAvatar = this.picture(p, 'HostAvatar', '', 116, 201, 112, 112);
        this.hostName = this.text(p, 'HostName', '', 253, 207, 174, 40, 31, false, 'dynamic');
        this.hostCharacter = this.text(p, 'HostCharacter', '', 253, 254, 119, 30, 21, false);
        this.hostCharacter.color = MUTED;
        this.hostLevel = this.text(p, 'HostLevel', '', 373, 256, 54, 30, 22, true, 'latin');
        this.hostLevel.horizontalAlign = Label.HorizontalAlign.RIGHT;
        this.hostLevel.color = uiColor(19, 66, 151);
        this.text(p, 'RoomNumberHeading', '房间号', 112, 361, 160, 30, 20, false).color = MUTED;
        this.roomNumber = this.text(p, 'RoomNumber', '', 111, 394, 193, 54, 42, false, 'latin');
        this.roomNumberLocal = this.text(p, 'RoomNumberLocal', '', 112, 394, 193, 54, 40, false);
        this.count = this.text(p, 'MemberCount', '', 342, 370, 82, 51, 42, false, 'latin');
        this.count.color = JOINED;
        this.text(p, 'Joined', '已加入', 342, 413, 88, 32, 24, false).color = JOINED;
        this.text(p, 'RulesHeading', '赛制', 112, 477, 90, 28, 18, false).color = MUTED;
        this.modePermission = this.text(p, 'RulesPermission', '', 272, 478, 151, 28, 17);
        this.modePermission.horizontalAlign = Label.HorizontalAlign.RIGHT;
        this.modePermission.color = MUTED;
        this.picture(p, 'ModeBackground', ART.modePanel, 102, 514, 328, 66);
        this.modeText = this.text(p, 'Mode', '', 166, 525, 123, 34, 22, false);
        this.text(p, 'Distance', String(getRaceDistance()), 310, 526, 50, 34, 23, false, 'latin');
        this.text(p, 'DistanceUnit', '米', 360, 526, 24, 34, 23, false);
        this.modeArrow = this.text(p, 'Expand', '▲', 394, 525, 26, 34, 14);
        this.touch(p, 'ModeHit', 105, 518, 320, 54, () => {
            if (this.state?.isHost && !this.state.busy) { this.closePopup(); visible(this.drawer, !this.drawer.active); }
        });
        this.text(p, 'MemberHeading', '房间成员', 506, 112, 240, 40, 27, false);
        const inviteHint = this.text(p, 'InviteHint', '点击空位邀请好友', 992, 119, 201, 28, 17);
        inviteHint.horizontalAlign = Label.HorizontalAlign.RIGHT;
        inviteHint.color = MUTED;
        for (let i = 0; i < 8; i++) this.cards.push(this.buildCard(p, i));
        this.primaryArt = this.picture(p, 'PrimaryBackground', RESOURCE_PATHS.lobbyUi.startButton, 922, 608, 332, 102);
        this.primaryText = this.text(p, 'PrimaryText', '', 951, 630, 272, 49, 38);
        this.primary = this.touch(p, 'PrimaryHit', 938, 615, 300, 82, actions.primary);
        this.hint = this.text(p, 'RoomHint', '', 938, 588, 300, 26, 14);
        this.hint.color = uiColor(37, 67, 99);

        // 抽屉和玩家弹窗只创建一次，放在内容最上层；点空白关闭。
        this.drawer = makeUiNode('ModeDrawer', p);
        this.touch(this.drawer, 'DismissDrawer', 0, 85, 1280, 635, () => visible(this.drawer, false));
        this.picture(this.drawer, 'DrawerPanel', ART.drawer, 90, 319, 351, 206);
        this.text(this.drawer, 'DrawerHeading', '选择赛制', 122, 333, 272, 28, 16, false).color = MUTED;
        ROOM_MODES.forEach((mode, i) => {
            const y = 357 + i * 48;
            this.modeLabels.push(this.text(this.drawer, `ModeOption${i}`, mode.label, 124, y, 150, 34, 21, false));
            this.modeDistances.push(this.text(this.drawer, `ModeDistance${i}`, String(getRaceDistance()), 316, y, 48, 34, 21, true, 'latin'));
            this.modeUnits.push(this.text(this.drawer, `ModeUnit${i}`, '米', 364, y, 23, 34, 21, false));
            this.modeChecks.push(this.text(this.drawer, `ModeCheck${i}`, '✓', 393, y, 22, 34, 21));
            this.touch(this.drawer, `ChooseMode${i}`, 109, y, 313, 42, () => {
                visible(this.drawer, false);
                if (this.state?.isHost && !this.state.busy) actions.mode(mode.id);
            });
        });
        this.drawer.active = false;
        this.popup = makeUiNode('PlayerPopup', p);
        this.touch(this.popup, 'DismissPlayer', -1280, -720, 3840, 2160, () => this.closePopup());
        this.picture(this.popup, 'PopupPanel', ART.popup, 0, 0, 208, 132);
        this.popupName = this.text(this.popup, 'PopupName', '', 26, 17, 140, 27, 19, false, 'dynamic');
        this.popupName.color = uiColor(247, 250, 255);
        this.popupCharacter = this.text(this.popup, 'PopupCharacter', '', 26, 40, 154, 25, 14, false);
        this.popupCharacter.color = uiColor(181, 201, 225);
        this.text(this.popup, 'CloseText', '×', 166, 11, 24, 27, 22, true, 'latin').color = uiColor(200, 216, 237);
        this.touch(this.popup, 'ClosePopup', 168, 6, 35, 38, () => this.closePopup());
        this.kick = makeUiNode('KickAction', this.popup);
        this.picture(this.kick, 'DangerBackground', ART.dangerButton, 20, 76, 168, 32);
        this.kickText = this.text(this.kick, 'KickText', '踢出房间', 20, 74, 168, 32, 19);
        this.kickText.color = uiColor(255, 158, 143);
        this.touch(this.kick, 'KickHit', 20, 73, 168, 40, () => {
            const m = this.state?.members.find(m => m.pos === this.popupPos);
            if (!m || m.self || m.owner || !this.state?.isHost || this.state.busy) return;
            if (!this.confirmingKick) {
                this.confirmingKick = true;
                assign(this.kickText, '确认踢出？');
            } else { this.closePopup(); actions.kick(m); }
        });
        this.popup.active = false;
    }

    update(state: OnlineRoomState): void {
        this.state = state;
        const host = state.members.find(m => m.owner);
        assign(this.hostName, host?.nickName ?? '等待房主');
        assign(this.hostCharacter, host?.character ?? '');
        assign(this.hostLevel, host?.level ? `LV.${host.level}` : '');
        visible(this.hostAvatar.node, !!host);
        if (host) this.texture(this.hostAvatar, avatarTexturePath(host.avatarId));
        const numericRoom = /^[\x20-\x7e]+$/.test(state.roomNumber);
        visible(this.roomNumber.node, numericRoom);
        visible(this.roomNumberLocal.node, !numericRoom);
        assign(numericRoom ? this.roomNumber : this.roomNumberLocal,
            state.roomNumber.replace(/^(\d{3})(\d{3})$/, '$1 $2'));
        assign(this.count, `${state.members.length}/8`);
        assign(this.modeText, ROOM_MODES.find(m => m.id === state.mode)!.label);
        assign(this.modePermission, state.isHost ? '仅房主可切换' : '房主设置');
        visible(this.modeArrow.node, state.isHost);
        if (!state.isHost || state.busy) visible(this.drawer, false);
        for (let i = 0; i < 3; i++) {
            const selected = state.mode === ROOM_MODES[i].id;
            const color = selected ? JOINED : INK;
            tint(this.modeLabels[i], color); tint(this.modeDistances[i], color); tint(this.modeUnits[i], color);
            tint(this.modeChecks[i], JOINED); visible(this.modeChecks[i].node, selected);
        }
        for (let i = 0; i < this.cards.length; i++) this.updateCard(this.cards[i], state.members.find(m => m.pos === i));
        assign(this.hint, state.hint);
        assign(this.primaryText, state.busy ? '请稍候…' : state.isHost ? '开始比赛' : state.ready ? '取消准备' : '准备');
        this.texture(this.primaryArt, !state.isHost && state.ready ? ART.cancelReady : RESOURCE_PATHS.lobbyUi.startButton);
        const enabled = !state.busy && (!state.isHost || state.canStart);
        const button = this.primary.getComponent(Button)!;
        if (button.interactable !== enabled) button.interactable = enabled;
        tint(this.primaryText, enabled ? INK : MUTED);
        if (this.popup.active) {
            const m = state.members.find(m => m.pos === this.popupPos);
            if (!m || state.busy) this.closePopup();
            else {
                assign(this.popupName, m.nickName);
                assign(this.popupCharacter, m.character);
                visible(this.kick, state.isHost && !m.self && !m.owner);
            }
        }
    }

    private buildCard(parent: Node, i: number): Card {
        const x = 493 + (i % 4) * 182, y = 158 + Math.floor(i / 4) * 217;
        const background = this.picture(parent, `SeatBackground${i}`, ART.memberIdle, x, y, 178, 216);
        this.text(parent, `SeatNumber${i}`, String(i + 1), x + 10, y + 7, 37, 36, 24, true, 'latin').color = WHITE;
        const ring = this.picture(parent, `AvatarRing${i}`, ART.avatarRing, x + 50, y + 32, 78, 78);
        const avatar = this.picture(parent, `Avatar${i}`, '', x + 53, y + 35, 72, 72);
        const nickname = this.text(parent, `Nickname${i}`, '', x + 15, y + 115, 148, 27, 19, true, 'dynamic');
        const role = this.text(parent, `Character${i}`, '', x + 15, y + 142, 148, 25, 14);
        role.color = MUTED;
        const badgeBg = this.picture(parent, `StatusBackground${i}`, RESOURCE_PATHS.characterUi.levelPill, x + 31, y + 175, 116, 25);
        const badge = this.text(parent, `Status${i}`, '', x + 31, y + 175, 116, 25, 16);
        const plus = this.text(parent, `Plus${i}`, '+', x + 51, y + 60, 76, 78, 54);
        const empty = this.text(parent, `Invite${i}`, '邀请好友', x + 16, y + 146, 146, 32, 19, true, 'regular');
        const card: Card = { background, avatar, ring, nickname, role, badge, badgeBg, plus, empty, signature: '' };
        this.touch(parent, `SeatHit${i}`, x + 6, y + 5, 166, 202, () => {
            if (!card.member) { this.closePopup(); this.actions.invite(); return; }
            if (this.state?.busy) return;
            visible(this.drawer, false);
            this.popupPos = card.member.pos;
            this.confirmingKick = false;
            assign(this.kickText, '踢出房间');
            // 弹窗局部坐标仍使用 PSD 坐标系，平移整体至头像下方。
            this.popup.setPosition(x - 8, -(y + 94), 0);
            visible(this.popup, true);
            if (this.state) this.update(this.state);
        });
        return card;
    }

    private updateCard(card: Card, member?: OnlineMember): void {
        const signature = member ? JSON.stringify(member) : 'empty';
        if (card.signature === signature) return;
        if (card.member && member && card.member.pos === this.popupPos &&
            (card.member.nickName !== member.nickName || card.member.clientId !== member.clientId)) this.closePopup();
        card.signature = signature; card.member = member;
        for (const n of [card.avatar.node, card.ring.node, card.nickname.node, card.role.node, card.badge.node, card.badgeBg.node]) visible(n, !!member);
        // 空位加号已经是独立于文案的图形，包含在空位底图中。
        visible(card.plus.node, false); visible(card.empty.node, !member);
        this.texture(card.background, !member ? ART.memberEmpty : member.owner ? ART.memberHost : member.ready ? ART.memberReady : ART.memberIdle);
        if (!member) return;
        this.texture(card.avatar, avatarTexturePath(member.avatarId));
        assign(card.nickname, member.self ? `${member.nickName}（我）` : member.nickName);
        assign(card.role, member.character);
        assign(card.badge, member.owner ? '房主' : member.ready ? '已准备' : '未准备');
        this.texture(card.badgeBg, member.owner ? ART.badgeHost : member.ready ? ART.badgeReady : ART.badgeIdle);
        tint(card.badge, member.ready && !member.owner ? WHITE : INK);
    }

    private closePopup(): void { visible(this.popup, false); this.popupPos = -1; this.confirmingKick = false; }
    showUnavailable(message: string): void {
        visible(this.content, false);
        const panel = makeRoundedRect('Unavailable', this.root, 590, 210, WHITE, 24);
        this.text(panel, 'Notice', message, 382, 290, 516, 70, 25);
        this.text(panel, 'BackText', '返回大厅', 500, 380, 280, 50, 24);
        this.touch(panel, 'BackHit', 500, 380, 280, 50, this.actions.exit);
    }
    private text(p: Node, name: string, value: string, x: number, y: number, w: number, h: number, size: number, center = true, face: TextFace = 'project'): Label {
        const n = makeLabel(name, p, value, size, INK);
        n.getComponent(UITransform)!.setContentSize(w, h); n.setPosition(x + w / 2 - 640, 360 - y - h / 2);
        const label = n.getComponent(Label)!;
        label.horizontalAlign = center ? Label.HorizontalAlign.CENTER : Label.HorizontalAlign.LEFT;
        label.overflow = Label.Overflow.SHRINK; label.enableWrapText = false;
        // 动态昵称也必须显式设置行高，否则默认 40 会把 27 高的昵称框再次缩小。
        label.lineHeight = size + 4;
        if (face === 'dynamic' || face === 'latin') { label.isBold = true; label.fontFamily = PROJECT_UI_ENGLISH_BOLD_FAMILY; }
        else styleProjectUiLabel(label, face === 'regular' ? 'regular' : 'semibold', size + 4);
        return label;
    }
    private picture(p: Node, name: string, path: string, x: number, y: number, w: number, h: number): Sprite {
        const n = makeUiNode(name, p); n.getComponent(UITransform)!.setContentSize(w, h);
        n.setPosition(x + w / 2 - 640, 360 - y - h / 2);
        const sprite = n.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        if (path) this.texture(sprite, path);
        return sprite;
    }
    private texture(sprite: Sprite, path: string): void {
        if (this.textureKeys.get(sprite) === path) return;
        this.textureKeys.set(sprite, path);
        loadAvatarUiSpriteFrame(path, frame => {
            if (sprite.isValid && frame && this.textureKeys.get(sprite) === path && sprite.spriteFrame !== frame) sprite.spriteFrame = frame;
        });
    }
    private touch(p: Node, name: string, x: number, y: number, w: number, h: number, fn: () => void): Node {
        const n = makeTouchArea(name, p, w, h); n.setPosition(x + w / 2 - 640, 360 - y - h / 2);
        n.on(Button.EventType.CLICK, fn); return n;
    }
}
function visible(node: Node, value: boolean): void { if (node.active !== value) node.active = value; }
function assign(label: Label, value: string): void { if (label.string !== value) label.string = value; }
function tint(label: Label, value: Color): void { if (!label.color.equals(value)) label.color = value; }
