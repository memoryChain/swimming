import { Button, Color, Label, Node, Sprite, UITransform, view } from 'cc';
import { getRaceDifficulty, getRaceDistance } from '../core/GameBalance';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { PlayerData } from '../backend/PlayerData';
import { AVATARS } from '../backend/IdentityConfig';
import { avatarTexturePath, loadAvatarUiSpriteFrame } from './AvatarUiAssets';
import { PROJECT_UI_ENGLISH_BOLD_FAMILY, styleProjectUiLabel } from './ProjectUiFonts';
import type { RaceLeaderboardRow, RaceResultStats } from './UIController';

const WIDTH = 1672;
const HEIGHT = 941;
const NAVY = new Color(9, 31, 75, 255);
const WHITE = new Color(249, 252, 255, 255);
const GOLD = new Color(255, 212, 0, 255);
const SELF_GREEN = new Color(0, 182, 0, 255);
const WATERMARK = new Color(21, 61, 88, 18);
const ART = RESOURCE_PATHS.settlementUi;
const MODES = { beginner: '入门泳道', competitive: '竞技泳道', championship: '超级世锦赛' };

export type SettlementCallbacks = {
    onRestart: () => void;
    onMenu: () => void;
    resolveResultAvatar?: (row: RaceLeaderboardRow) => string | undefined;
};

/** 已完成才授予奖牌色；未完成、淘汰、退出不显示虚假的前三名荣誉。 */
export function settlementTier(placement: number, finished: boolean): number {
    return finished && placement >= 1 && placement <= 3 ? placement - 1 : 3;
}

export function settlementTime(row: RaceLeaderboardRow): string {
    if (row.quit) return '已退出';
    if (row.eliminated) return '已淘汰';
    return row.finished !== false && Number.isFinite(row.time) && row.time > 0
        ? row.time.toFixed(2) : '未完成';
}

type ResultRow = {
    root: Node; back: Sprite; medal: Sprite; rank: Label;
    avatar: Sprite; name: Label; time: Label; status: Label; self: Sprite; watermark: Label;
};

/** 纯事件驱动的结算层：只挂载一次，不参与比赛帧更新，也不覆盖真实领奖台背景。 */
export class SettlementView {
    readonly root: Node;
    private readonly rows: ResultRow[] = [];
    private readonly paths = new WeakMap<Sprite, string>();
    private readonly shade: Sprite;
    private readonly honor: Sprite;
    private readonly medal: Sprite;
    private readonly medalNumber: Label;
    private readonly title: Label;
    private readonly normalTitle: Node;
    private readonly normalTitleRank: Label;
    private readonly time: Label;
    private readonly speed: Label;
    private readonly mode: Label;
    private readonly modeDistance: Label;
    private readonly modeUnit: Label;
    private readonly reward: Label;
    private readonly primary: Node;
    private readonly primaryText: Label;
    private readonly secondary: Node;
    private roomMode = false;
    private actionPending = false;

    constructor(parent: Node, private readonly callbacks: SettlementCallbacks) {
        this.root = this.node(parent, 'Settlement', 0, 0, WIDTH, HEIGHT);
        this.root.active = false;
        // 只有一张静态渐变贴图，位于全部 UI 下方，不拦截触摸，不逐帧绘制。
        this.shade = this.art(this.root, 'RightShade', 760, 0, 912, HEIGHT, ART.shade);
        this.honor = this.art(this.root, 'Honor', 104, 47, 638, 130);
        this.medal = this.art(this.root, 'HonorMedal', 42, 8, 128, 192);
        this.medalNumber = this.text(this.root, 'HonorNumber', '', 68, 98, 76, 68, NAVY, true, false, false, true);
        this.title = this.text(this.root, 'HonorTitle', '', 188, 112, 208, 77);
        this.normalTitle = this.node(this.root, 'NormalHonorTitle', 0, 0, WIDTH, HEIGHT);
        this.text(this.normalTitle, 'Prefix', '第', 188, 112, 75, 67);
        this.normalTitleRank = this.text(this.normalTitle, 'Rank', '', 257, 112, 70, 77, NAVY, true, false, false, true);
        this.text(this.normalTitle, 'Suffix', '名', 326, 112, 75, 67);
        this.text(this.root, 'MyResult', '我的成绩', 418, 87, 220, 26);
        this.time = this.text(this.root, 'MyTime', '', 418, 135, 185, 46, NAVY, false, false, false, true);
        this.text(this.root, 'Seconds', '秒', 609, 137, 42, 25);
        this.art(this.root, 'SpeedWave', 54, 203, 28, 23, ART.wave);
        this.text(this.root, 'SpeedTitle', '平均速度', 96, 215, 110, 23, WHITE);
        this.speed = this.text(this.root, 'SpeedValue', '', 215, 215, 158, 25, WHITE, false, false, false, true);
        this.art(this.root, 'ModeWave', 391, 203, 28, 23, ART.wave);
        this.mode = this.text(this.root, 'Mode', '', 435, 215, 164, 23, WHITE);
        this.modeDistance = this.text(this.root, 'ModeDistance', '', 606, 215, 65, 25, WHITE, false, false, false, true);
        this.modeUnit = this.text(this.root, 'ModeUnit', '米', 673, 215, 30, 23, WHITE);

        this.art(this.root, 'TableHeader', 1000, 78, 615, 44, ART.header);
        this.text(this.root, 'RankHeader', '名次', 1013, 100, 72, 23, WHITE);
        this.text(this.root, 'PlayerHeader', '选手', 1106, 100, 170, 23, WHITE);
        this.text(this.root, 'TimeHeader', '用时 / 秒', 1443, 100, 140, 23, WHITE, false, false, true);
        for (let i = 0; i < 8; i++) {
            const y = 134 + i * 70;
            const root = this.node(this.root, `ResultEntry${i}`, 0, 0, WIDTH, HEIGHT);
            // 保持 PSD 层级：外描边在行底板下方，避免其内侧阴影压在浅色底板上。
            // 切图含外扩柔光；在统一行画布上定位，不按不透明边界缩放。
            const self = this.art(root, 'SelfHighlight', 975, y - 25, 666, 117, ART.self);
            const back = this.art(root, 'RowBackground', 1000, y, 615, 68);
            const watermark = this.text(root, 'TopWatermark', '', 1332, y + 33, 135, 38, WATERMARK, false, false, false, true);
            const medal = this.art(root, 'RankMedal', 1020, y - 2, 46, 69);
            const rank = this.text(root, 'RankNumber', '', 1014, y + 33, 58, 29, NAVY, true, false, false, true);
            this.art(root, 'AvatarBase', 1088, y + 5, 56, 56, RESOURCE_PATHS.avatarPickerUi.avatarBase);
            const avatar = this.art(root, 'Avatar', 1088, y + 5, 48, 48);
            // 昵称是无界动态文本，不能交给静态子集字库；独立保留系统全覆盖字体。
            const name = this.text(root, 'PlayerName', '', 1162, y + 33, 280, 26, NAVY, false, true);
            const time = this.text(root, 'FinishTime', '', 1455, y + 33, 125, 27, NAVY, false, false, true, true);
            const status = this.text(root, 'FinishStatus', '', 1455, y + 33, 125, 25, NAVY, false, false, true);
            this.rows.push({ root, back, medal, rank, avatar, name, time, status, self, watermark });
        }
        this.art(this.root, 'RewardCoin', 1133, 731, 56, 56, RESOURCE_PATHS.characterUi.upgradeCurrency);
        this.text(this.root, 'RewardTitle', '本局奖励', 1205, 760, 140, 27, WHITE);
        this.reward = this.text(this.root, 'RewardValue', '+0', 1344, 758, 260, 49, GOLD, false, false, false, true);
        this.secondary = this.button('ReturnToLobby', 1000, 808, 247, 90,
            RESOURCE_PATHS.onlineRoomUi.exitButton, () => callbacks.onMenu());
        this.text(this.secondary, 'Label', '返回大厅', 0, 45, 247, 35, NAVY, true);
        this.primary = this.button('PlayAgain', 1280, 808, 330, 90,
            RESOURCE_PATHS.lobbyUi.startButton, () => this.roomMode ? callbacks.onMenu() : callbacks.onRestart());
        this.primaryText = this.text(this.primary, 'Label', '再来一局', 0, 45, 330, 38, NAVY, true);
    }

    setRoomMode(roomMode: boolean): void {
        this.roomMode = roomMode;
        active(this.secondary, !roomMode);
        setText(this.primaryText, roomMode ? '返回房间' : '再来一局');
    }

    /** 键盘确认与主按钮共用权限和防重复保护。 */
    activatePrimary(): void {
        this.activate(() => this.roomMode ? this.callbacks.onMenu() : this.callbacks.onRestart());
    }

    show(playerTime: number, stats?: RaceResultStats): void {
        const size = view.getVisibleSize();
        const scale = Math.min(size.width / WIDTH, size.height / HEIGHT);
        if (this.root.scale.x !== scale) this.root.setScale(scale, scale, 1);
        const right = WIDTH / 2 + size.width / (2 * scale);
        const shadeWidth = right - 760;
        const shadeHeight = size.height / scale;
        const transform = this.shade.node.getComponent(UITransform)!;
        if (transform.contentSize.width !== shadeWidth || transform.contentSize.height !== shadeHeight) {
            transform.setContentSize(shadeWidth, shadeHeight);
            this.shade.node.setPosition((760 + right) / 2 - WIDTH / 2, 0, 0);
        }
        active(this.root, true);
        this.actionPending = false;
        // 权威名单顺序原样呈现，不能按本机时间重新排名。
        const list = stats?.leaderboard?.length ? stats.leaderboard : [{
            name: PlayerData.nickName, placement: stats?.placement ?? 1,
            time: playerTime, isPlayer: true, finished: playerTime > 0,
        }];
        const me = list.find(row => row.isPlayer);
        const finished = !!me && me.finished !== false && !me.quit && !me.eliminated && Number.isFinite(me.time) && me.time > 0;
        const placement = me?.placement ?? stats?.placement ?? 0;
        const tier = settlementTier(placement, finished);
        this.setArt(this.honor, ART.honors[tier]);
        this.setArt(this.medal, ART.medals[tier]);
        active(this.medalNumber.node, tier === 3);
        setText(this.medalNumber, finished ? String(placement) : '—');
        setText(this.title, !finished ? '未完成' : ['冠军', '亚军', '季军'][tier] ?? `第${placement}名`);
        active(this.title.node, !finished || tier < 3);
        active(this.normalTitle, finished && tier === 3);
        setText(this.normalTitleRank, String(placement));
        setText(this.time, finished ? me!.time.toFixed(2) : '--.--');
        // 与权威最终用时保持同一口径，避免联机本地计时偏差。
        setText(this.speed, finished ? `${(getRaceDistance() / me!.time).toFixed(2)} m/s` : '-- m/s');
        const modeTitle = MODES[getRaceDifficulty()];
        setText(this.mode, `${modeTitle} ·`);
        setText(this.modeDistance, String(getRaceDistance()));
        const distanceX = modeTitle.length === 5 ? 589 : 566;
        const numberCenter = distanceX + 32.5 - WIDTH / 2;
        const unitCenter = distanceX + 67 + 15 - WIDTH / 2;
        if (this.modeDistance.node.position.x !== numberCenter) this.modeDistance.node.setPosition(numberCenter, HEIGHT / 2 - 215, 0);
        if (this.modeUnit.node.position.x !== unitCenter) this.modeUnit.node.setPosition(unitCenter, HEIGHT / 2 - 215, 0);
        this.setReward(0);
        for (let i = 0; i < this.rows.length; i++) {
            const controls = this.rows[i];
            const row = list[i];
            active(controls.root, !!row);
            if (!row) continue;
            const complete = row.finished !== false && !row.quit && !row.eliminated && Number.isFinite(row.time) && row.time > 0;
            const rowTier = settlementTier(row.placement, complete);
            this.setArt(controls.back, ART.rows[rowTier]);
            active(controls.medal.node, rowTier < 3);
            if (rowTier < 3) this.setArt(controls.medal, ART.medals[rowTier]);
            active(controls.rank.node, rowTier === 3);
            setText(controls.rank, String(row.placement));
            active(controls.self.node, row.isPlayer);
            setText(controls.watermark, rowTier < 3 ? `TOP ${row.placement}` : '');
            setText(controls.name, `${row.name}${row.isPlayer ? '（我）' : ''}`);
            setText(controls.time, settlementTime(row));
            active(controls.time.node, complete);
            active(controls.status.node, !complete);
            setText(controls.status, complete ? '' : settlementTime(row));
            const color = row.isPlayer ? SELF_GREEN : NAVY;
            if (!controls.name.color.equals(color)) controls.name.color = color;
            if (!controls.time.color.equals(color)) controls.time.color = color;
            if (!controls.status.color.equals(color)) controls.status.color = color;
            const id = this.callbacks.resolveResultAvatar?.(row)
                ?? (row.isPlayer ? PlayerData.avatarId : fallbackAvatar(row.name));
            this.setArt(controls.avatar, avatarTexturePath(id));
        }
    }

    setReward(coins: number): void {
        setText(this.reward, `+${Number.isFinite(coins) ? Math.max(0, Math.floor(coins)) : 0}`);
    }

    private node(parent: Node, name: string, x: number, y: number, w: number, h: number): Node {
        const node = new Node(name);
        node.layer = parent.layer;
        node.setParent(parent);
        const parentSize = parent === this.root || !this.root ? { width: WIDTH, height: HEIGHT }
            : parent.getComponent(UITransform)!.contentSize;
        node.addComponent(UITransform).setContentSize(w, h);
        node.setPosition(x + w / 2 - parentSize.width / 2, parentSize.height / 2 - y - h / 2, 0);
        return node;
    }

    private art(parent: Node, name: string, x: number, y: number, w: number, h: number, path?: string): Sprite {
        const sprite = this.node(parent, name, x, y, w, h).addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.trim = false;
        if (path) this.setArt(sprite, path);
        return sprite;
    }

    private setArt(sprite: Sprite, path: string): void {
        if (this.paths.get(sprite) === path) return;
        this.paths.set(sprite, path);
        // 换玩家/名次时清掉旧图；旧请求回调不得覆盖新状态。
        if (sprite.spriteFrame) sprite.spriteFrame = null;
        loadAvatarUiSpriteFrame(path, frame => {
            if (sprite.isValid && sprite.node.isValid && this.paths.get(sprite) === path && frame
                && sprite.spriteFrame !== frame) sprite.spriteFrame = frame;
            if (!frame && this.paths.get(sprite) === path) this.paths.delete(sprite);
        });
    }

    private text(parent: Node, name: string, value: string, x: number, cy: number, w: number,
        size: number, color = NAVY, center = false, dynamic = false, right = false, latin = false): Label {
        const height = size + 10;
        const label = this.node(parent, name, x, cy - height / 2, w, height).addComponent(Label);
        label.fontSize = size;
        label.lineHeight = size + 4;
        label.color = color;
        label.horizontalAlign = center ? Label.HorizontalAlign.CENTER : right ? Label.HorizontalAlign.RIGHT : Label.HorizontalAlign.LEFT;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.SHRINK;
        label.enableWrapText = false;
        if (dynamic || latin) { label.fontFamily = PROJECT_UI_ENGLISH_BOLD_FAMILY; label.isBold = true; }
        else styleProjectUiLabel(label, 'semibold', size + 4);
        setText(label, value);
        return label;
    }

    private button(name: string, x: number, y: number, w: number, h: number, path: string, action: () => void): Node {
        const root = this.node(this.root, name, x, y, w, h);
        // 复用贴图含透明外边距：补偿完整画布，使可见按钮而非 PNG 边界对齐 PSD。
        const sourceWidth = path === RESOURCE_PATHS.lobbyUi.startButton ? 332 : 210;
        const sourceHeight = 102;
        const artWidth = w * sourceWidth / (sourceWidth - 16);
        const artHeight = h * sourceHeight / 87;
        this.art(root, 'Background', -8 * artWidth / sourceWidth, -7 * artHeight / sourceHeight,
            artWidth, artHeight, path);
        const button = root.addComponent(Button);
        button.target = root;
        button.transition = Button.Transition.SCALE;
        button.zoomScale = 0.97;
        root.on(Button.EventType.CLICK, () => this.activate(action));
        return root;
    }

    private activate(action: () => void): void {
        if (!this.root.active || this.actionPending) return;
        this.actionPending = true;
        action();
    }
}

function active(node: Node, value: boolean): void { if (node.active !== value) node.active = value; }
function setText(label: Label, value: string): void { if (label.string !== value) label.string = value; }
function fallbackAvatar(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return AVATARS[hash % AVATARS.length].id;
}
