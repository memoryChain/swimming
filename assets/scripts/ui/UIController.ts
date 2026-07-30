import { _decorator, Color, Component, Graphics, Label, LabelOutline, Layers, Node, Sprite, SpriteFrame, Tween, tween, UIOpacity, UITransform, Vec3, view } from 'cc';
import { getRaceDistance } from '../core/GameBalance';
import { PlayerData } from '../backend/PlayerData';
import { Rating } from '../core/GameConstants';
import { SprintVignetteOverlay } from './SprintVignetteOverlay';
import { PROGRESSION_BALANCE, xpForLevel } from '../progression/ProgressionBalance';

const { ccclass, property } = _decorator;

export type RaceResultStats = {
    averageSpeed: number;
    maxCombo: number;
    perfectCount: number;
    goodCount: number;
    missCount: number;
    placement?: number;
    racerCount?: number;
    leaderboard?: RaceLeaderboardRow[];
};

export type RaceLeaderboardRow = {
    name: string;
    placement: number;
    time: number;
    isPlayer: boolean;
    finished?: boolean;
};

@ccclass('UIController')
export class UIController extends Component {
    @property(Node) public btnArm: Node = null;
    @property(Node) public btnLeg: Node = null;
    @property(Label) public distanceLabel: Label = null;
    @property(Label) public aiDistanceLabel: Label = null;
    @property(Label) public hintLabel: Label = null;
    @property(Node) public progressDot: Node = null;
    public progressTrackRoot: Node = null;
    @property public progressTrackWidth = 240;
    @property(Node) public speedBarRoot: Node = null;
    @property(Node) public countdownOverlay: Node = null;
    @property(Node) public countdownShade: Node = null;
    @property(Label) public countdownLabel: Label = null;
    @property(Node) public diveChargeTrack: Node = null;
    @property(Graphics) public diveChargeFill: Graphics = null;
    @property(Node) public diveChargeFillNode: Node = null;
    public heartRateBarRoot: Node = null;
    public heartRateBarFill: Graphics = null;
    public heartRateLabel: Label = null;
    public energyBarRoot: Node = null;
    public energyBarFill: Graphics = null;
    public energyLabel: Label = null;
    public sprintLabel: Label | null = null;
    public sprintVignette: SprintVignetteOverlay | null = null;
    private _sprintActive = false;
    private _energyTotal = 100;
    // Full-screen swim-input pad. Disabled during awards so the podium free-look camera can
    // receive drag/zoom via the global input listeners instead of this pad swallowing them.
    // 全屏划水输入板。颁奖时禁用，让颁奖自由视角相机能通过全局输入监听收到拖拽/缩放，而非被此板吞掉。
    public strokeInput: Node = null;
    // Full-screen dive touch overlay. Also disabled during awards for the same reason.
    // 全屏跳水触摸层。同样原因，颁奖时一并禁用。
    public diveTouchArea: Node = null;
    @property(Node) public resultPanel: Node = null;
    @property(Label) public resultTitle: Label = null;
    @property(Label) public resultTime: Label = null;
    @property(Label) public resultPlacementStat: Label = null;
    @property(Label) public resultSpeedStat: Label = null;
    public resultRows: Label[] = [];
    public resultRankLabels: Label[] = [];
    public resultTimeLabels: Label[] = [];
    public resultSpeedLabels: Label[] = [];
    public resultRowBacks: Node[] = [];
    public resultAvatars: Sprite[] = [];
    public resultAvatarFrames: SpriteFrame[] = [];
    public resultRowNormalFrame: SpriteFrame = null;
    public resultRowPlayerFrame: SpriteFrame = null;
    @property(Label) public ratingLabel: Label = null;
    @property(Label) public comboLabel: Label = null;

    // Dedicated finish (straggler) countdown: a big centred number with no dark
    // plate, built lazily. Intensifies + recolours in the last few seconds.
    private _finishCountdownRoot: Node = null;
    private _finishCountdownLabel: Label = null;
    private _finishCountdownHint: Label = null;

    start() {
        this.setupButtonFeedback(this.btnArm);
        this.setupButtonFeedback(this.btnLeg);
        this.resetAll();
    }

    updateProgress(playerDist: number, aiDist: number) {
        const raceDistance = getRaceDistance();
        const ratio = clamp01(playerDist / raceDistance);
        if (this.distanceLabel) {
            this.distanceLabel.string = `${Math.round(ratio * 100)}%`;
        }
        if (this.progressDot) {
            this.progressDot.setPosition(-this.progressTrackWidth / 2 + this.progressTrackWidth * ratio, 0, 0);
        }
        if (this.aiDistanceLabel) {
            this.aiDistanceLabel.string = `AI ${Math.min(raceDistance, aiDist).toFixed(1)}m`;
        }
    }

    setProgressVisible(visible: boolean) {
        if (this.progressTrackRoot) {
            this.progressTrackRoot.active = visible;
        }
        if (this.distanceLabel?.node) {
            this.distanceLabel.node.active = visible;
        }
    }

    setRaceStatusVisible(visible: boolean) {
        this.setProgressVisible(visible);
        this.setHeartRateBarVisible(visible);
        this.setEnergyBarVisible(visible);
    }

    updateHeartRateBar(heartRate: number, zone: string) {
        const ratio = clamp01(heartRate / 200);
        if (this.heartRateBarFill) {
            drawHeartRateFill(this.heartRateBarFill, ratio, heartRateZoneColor(zone));
        }
        if (this.heartRateLabel) {
            this.heartRateLabel.string = `心率 ${Math.round(heartRate)}`;
            this.heartRateLabel.color = heartRateZoneColor(zone);
        }
    }

    setHeartRateBarVisible(visible: boolean) {
        if (this.heartRateBarRoot) {
            this.heartRateBarRoot.active = visible;
        }
    }

    updateEnergyBar(energy: number, depleted: boolean) {
        const ratio = clamp01(energy / this._energyTotal);
        const color = this._sprintActive
            ? sprintEnergyColor(ratio, depleted)
            : energyColor(ratio, depleted);
        if (this.energyBarFill) {
            drawEnergyFill(this.energyBarFill, ratio, color);
        }
        if (this.energyLabel) {
            this.energyLabel.string = `体能 ${Math.round(energy)}`;
            this.energyLabel.color = color;
        }
    }

    setSprintActive(active: boolean) {
        this._sprintActive = active;
        this.sprintVignette?.setActive(active);
        if (!this.sprintLabel) {
            return;
        }
        const node = this.sprintLabel.node;
        if (active) {
            node.active = true;
            node.setScale(0.3, 0.3, 1);
            let opacity = node.getComponent(UIOpacity);
            if (!opacity) {
                opacity = node.addComponent(UIOpacity);
            }
            opacity.opacity = 0;
            Tween.stopAllByTarget(node);
            Tween.stopAllByTarget(opacity);
            tween(node)
                .to(0.18, { scale: new Vec3(1.25, 1.25, 1) }, { easing: 'backOut' })
                .to(0.08, { scale: new Vec3(1, 1, 1) })
                .call(() => {
                    tween(node)
                        .to(0.8, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'sineInOut' })
                        .to(0.8, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
                        .repeatForever()
                        .start();
                })
                .start();
            tween(opacity)
                .to(0.15, { opacity: 255 })
                .start();
        } else {
            let opacity = node.getComponent(UIOpacity);
            if (!opacity) {
                opacity = node.addComponent(UIOpacity);
            }
            Tween.stopAllByTarget(node);
            Tween.stopAllByTarget(opacity);
            tween(opacity)
                .to(0.9, { opacity: 0 }, { easing: 'sineInOut' })
                .call(() => { node.active = false; })
                .start();
        }
    }

    setEnergyTotal(total: number) {
        this._energyTotal = Math.max(1, total);
    }

    setEnergyBarVisible(visible: boolean) {
        if (this.energyBarRoot) {
            this.energyBarRoot.active = visible;
        }
    }

    showRating(rating: Rating, combo: number) {
        if (this.ratingLabel) {
            this.ratingLabel.string = ratingText(rating);
            this.ratingLabel.color = rating === Rating.PERFECT
                ? new Color(255, 224, 89, 255)
                : rating === Rating.GOOD
                    ? new Color(80, 242, 161, 255)
                    : new Color(255, 92, 92, 255);
            this.pulse(this.ratingLabel.node, 1.18);
        }
        if (this.comboLabel) {
            this.comboLabel.string = combo > 0 ? `${combo} 连击` : '';
            this.comboLabel.fontSize = combo >= 10 ? 25 : 24;
        }
        this.fadeRatingReadout();
    }

    // Hold the rating/combo readout briefly, then fade it out so it does not
    // linger over the swimmer until the next stroke.
    private fadeRatingReadout() {
        for (const label of [this.ratingLabel, this.comboLabel]) {
            const node = label?.node;
            if (!node?.isValid) {
                continue;
            }
            const opacity = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
            Tween.stopAllByTarget(opacity);
            opacity.opacity = 255;
            tween(opacity)
                .delay(0.7)
                .to(0.35, { opacity: 0 })
                .start();
        }
    }

    showCountdown(value: number) {
        if (this.countdownOverlay) {
            this.countdownOverlay.active = true;
        }
        this.setSpeedBarVisible(false);
        this.resizeCountdownShade(190, 160);
        if (this.hintLabel) {
            this.hintLabel.string = '倒计时长按蓄力，听令出发';
        }
        if (this.countdownLabel) {
            this.countdownLabel.node.getComponent(UITransform)?.setContentSize(720, 220);
            this.countdownLabel.fontSize = 96;
            this.countdownLabel.lineHeight = 140;
            this.countdownLabel.string = value > 0 ? `${value}` : '冲';
            this.pulse(this.countdownLabel.node, 1.25);
        }
    }

    updateDiveCharge(power: number, visible: boolean) {
        this.setSpeedBarVisible(!visible && !this.countdownOverlay?.active);
        if (this.diveChargeTrack) {
            this.diveChargeTrack.active = visible;
        }
        if (this.diveChargeFill) {
            this.diveChargeFill.node.active = visible;
            drawChargeFill(this.diveChargeFill, clamp01(power));
        }
        if (this.diveChargeFillNode) {
            this.diveChargeFillNode.active = visible;
            setVerticalFill(this.diveChargeFillNode, clamp01(power), chargeColor(power));
        }
    }

    // Straggler countdown after the first racer finishes: swimmers still in the
    // water have this many seconds to touch the wall before being marked 未完成.
    // A bespoke big centred number (no dark plate); the last few seconds punch
    // harder and turn red for urgency.
    showFinishCountdown(value: number) {
        this.ensureFinishCountdown();
        if (this._finishCountdownRoot) {
            this._finishCountdownRoot.active = true;
        }
        this.setSpeedBarVisible(false);
        const label = this._finishCountdownLabel;
        if (label) {
            const urgent = value > 0 && value <= 3;
            label.string = value > 0 ? `${value}` : '到达';
            if (value <= 0) {
                label.color = new Color(120, 240, 170, 255); // settle green
                label.fontSize = 132;
            } else if (urgent) {
                label.color = new Color(255, 66, 66, 255); // final-seconds red
                label.fontSize = 220;
            } else {
                label.color = new Color(255, 214, 44, 255); // amber
                label.fontSize = 150;
            }
            label.lineHeight = Math.round(label.fontSize * 1.2);
            this.punchFinishNumber(label.node, urgent);
        }
        if (this._finishCountdownHint) {
            this._finishCountdownHint.string = value > 0 ? '等待其他选手到达终点' : '结算中…';
        }
        if (this.hintLabel) {
            this.hintLabel.string = value > 0 ? '等待其他选手到达终点' : '结算中…';
        }
    }

    hideFinishCountdown() {
        if (this._finishCountdownRoot?.isValid) {
            this._finishCountdownRoot.active = false;
        }
    }

    // Scale punch for the countdown number. Urgent (≤ 3s) overshoots harder and
    // snaps back faster so the final seconds feel tense.
    private punchFinishNumber(node: Node, urgent: boolean) {
        Tween.stopAllByTarget(node);
        const peak = urgent ? 1.65 : 1.22;
        node.setScale(peak, peak, 1);
        tween(node)
            .to(urgent ? 0.16 : 0.22, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
            .start();
    }

    private ensureFinishCountdown() {
        if (this._finishCountdownRoot?.isValid) {
            return;
        }
        const root = new Node('FinishCountdown');
        root.layer = Layers.Enum.UI_2D;
        root.setParent(this.node);
        root.addComponent(UITransform).setContentSize(640, 320);
        root.setPosition(0, 60, 0);

        const numberNode = new Node('Number');
        numberNode.layer = Layers.Enum.UI_2D;
        numberNode.setParent(root);
        numberNode.addComponent(UITransform).setContentSize(640, 260);
        numberNode.setPosition(0, 24, 0);
        const number = numberNode.addComponent(Label);
        number.fontSize = 150;
        number.lineHeight = 180;
        number.isBold = true;
        number.color = new Color(255, 214, 44, 255);
        number.horizontalAlign = Label.HorizontalAlign.CENTER;
        number.verticalAlign = Label.VerticalAlign.CENTER;
        const numberOutline = numberNode.addComponent(LabelOutline);
        numberOutline.color = new Color(6, 16, 30, 235);
        numberOutline.width = 7;

        const hintNode = new Node('Hint');
        hintNode.layer = Layers.Enum.UI_2D;
        hintNode.setParent(root);
        hintNode.addComponent(UITransform).setContentSize(640, 56);
        hintNode.setPosition(0, -118, 0);
        const hint = hintNode.addComponent(Label);
        hint.fontSize = 28;
        hint.lineHeight = 36;
        hint.isBold = true;
        hint.color = new Color(238, 246, 255, 255);
        hint.horizontalAlign = Label.HorizontalAlign.CENTER;
        hint.verticalAlign = Label.VerticalAlign.CENTER;
        const hintOutline = hintNode.addComponent(LabelOutline);
        hintOutline.color = new Color(6, 16, 30, 220);
        hintOutline.width = 4;

        this._finishCountdownRoot = root;
        this._finishCountdownLabel = number;
        this._finishCountdownHint = hint;
    }

    hideCountdown() {
        if (this.countdownOverlay) {
            this.countdownOverlay.active = false;
        }
        this.updateDiveCharge(0, false);
        if (this.hintLabel) {
            this.hintLabel.string = '全屏点击 / 长按蓄力';
        }
    }

    showDivePrompt() {
        if (this.countdownOverlay) {
            this.countdownOverlay.active = true;
        }
        this.resizeCountdownShade(500, 120);
        if (this.countdownLabel) {
            this.countdownLabel.node.getComponent(UITransform)?.setContentSize(820, 220);
            this.countdownLabel.fontSize = 58;
            this.countdownLabel.lineHeight = 72;
            this.countdownLabel.string = '长按蓄力';
            this.pulse(this.countdownLabel.node, 1.08);
        }
        if (this.hintLabel) {
            this.hintLabel.string = '倒计时按住屏幕，出发时释放';
        }
        this.updateDiveCharge(0, true);
    }

    showDiveCharging() {
        this.resizeCountdownShade(500, 120);
        if (this.countdownLabel) {
            this.countdownLabel.node.getComponent(UITransform)?.setContentSize(820, 220);
            this.countdownLabel.fontSize = 64;
            this.countdownLabel.lineHeight = 64;
            this.countdownLabel.string = '蓄力中';
            this.pulse(this.countdownLabel.node, 1.12);
        }
    }

    showDiveRelease(power: number) {
        this.resizeCountdownShade(500, 120);
        if (this.countdownLabel) {
            this.countdownLabel.node.getComponent(UITransform)?.setContentSize(820, 220);
            this.countdownLabel.fontSize = 64;
            this.countdownLabel.lineHeight = 64;
            this.countdownLabel.string = `出发 ${Math.round(power * 100)}%`;
            this.pulse(this.countdownLabel.node, 1.18);
        }
        this.updateDiveCharge(power, true);
    }

    showGliding() {
        if (this.countdownOverlay) {
            this.countdownOverlay.active = false;
        }
        this.setSpeedBarVisible(false);
        if (this.hintLabel) {
            this.hintLabel.string = '滑行中，准备划水';
        }
    }

    showResult(isWin: boolean, playerTime: number, aiTime: number, stats?: RaceResultStats) {
        const soloRace = (stats?.racerCount ?? 2) <= 1;
        this.layoutResultPanelForAwards();
        this.setSpeedBarVisible(false);
        this.setRaceStatusVisible(false);
        // Awards ceremony: disable the full-screen swim pad so its node-level touch handlers stop
        // swallowing pointer events, letting the global input listeners drive the free-look camera.
        // 颁奖仪式：禁用全屏划水板，使其节点级触摸不再吞掉指针事件，让全局输入监听驱动自由视角相机。
        if (this.strokeInput) {
            this.strokeInput.active = false;
        }
        if (this.diveTouchArea) {
            this.diveTouchArea.active = false;
        }
        if (this.resultPanel) {
            this.resultPanel.active = true;
        }
        if (this.resultTitle) {
            this.resultTitle.string = '比赛成绩';
            this.resultTitle.color = new Color(247, 250, 255, 255);
        }
        if (this.resultTime) {
            this.resultTime.string = playerTime > 0 ? `个人成绩  ${playerTime.toFixed(2)} 秒` : '个人成绩  --.-- 秒';
        }
        if (this.resultPlacementStat) {
            if (playerTime <= 0) {
                this.resultPlacementStat.string = '名次  未完成';
            } else {
                this.resultPlacementStat.string = stats?.placement
                    ? `名次  ${stats.placement}/${stats.racerCount ?? '--'}`
                    : '名次  --/--';
            }
        }
        if (this.resultSpeedStat) {
            this.resultSpeedStat.string = stats ? `平均速度  ${stats.averageSpeed.toFixed(2)} m/s` : '平均速度  -- m/s';
        }
        this.updateLeaderboard(stats?.leaderboard, playerTime);
        void aiTime;
        void soloRace;
        this.hideFinishCountdown();
        if (this.hintLabel) {
            this.hintLabel.string = '按空格或点击再赛一次';
        }
    }

    private _progressionNode: Node | null = null;

    showProgressionResult(result: {
        characterName: string;
        xpGained: number;
        previousLevel: number;
        newLevel: number;
        leveledUp: boolean;
        newXp: number;
        xpForNextLevel: number;
    } | null) {
        this.hideProgressionResult();
        if (!result || result.xpGained <= 0 || !this.resultPanel) {
            return;
        }

        const panel = this.resultPanel;
        const xpNode = new Node('ProgressionResult');
        xpNode.layer = panel.layer;
        xpNode.setParent(panel);
        xpNode.addComponent(UITransform).setContentSize(400, 120);
        xpNode.setPosition(0, -260, 0);

        const headerLabel = xpNode.addComponent(Label);
        headerLabel.string = result.characterName + '  Lv.' + result.newLevel;
        headerLabel.fontSize = 20;
        headerLabel.color = new Color(150, 200, 255, 255);
        headerLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        headerLabel.node.getComponent(UITransform)!.setContentSize(400, 28);
        headerLabel.node.setPosition(0, 44, 0);

        const xpLabelNode = new Node('XpGained');
        xpLabelNode.layer = panel.layer;
        xpLabelNode.setParent(xpNode);
        xpLabelNode.addComponent(UITransform).setContentSize(400, 32);
        const xpLabel = xpLabelNode.addComponent(Label);
        if (result.leveledUp) {
            xpLabel.string = '+' + result.xpGained + ' XP   Lv.' + result.previousLevel + ' -> Lv.' + result.newLevel;
            xpLabel.color = new Color(255, 209, 42, 255);
        } else {
            xpLabel.string = '+' + result.xpGained + ' XP';
            xpLabel.color = new Color(120, 220, 130, 255);
        }
        xpLabel.fontSize = 22;
        xpLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        xpLabelNode.setPosition(0, 10, 0);

        if (result.xpForNextLevel > 0) {
            const barWidth = 320;
            const barNode = new Node('XpBar');
            barNode.layer = panel.layer;
            barNode.setParent(xpNode);
            barNode.addComponent(UITransform).setContentSize(barWidth, 10);
            barNode.setPosition(0, -20, 0);
            const gfx = barNode.addComponent(Graphics);
            const ratio = Math.max(0, Math.min(1, result.newXp / result.xpForNextLevel));
            gfx.fillColor = new Color(28, 42, 60, 255);
            gfx.rect(-barWidth / 2, -5, barWidth, 10);
            gfx.fill();
            gfx.fillColor = new Color(120, 220, 130, 255);
            gfx.rect(-barWidth / 2, -5, barWidth * ratio, 10);
            gfx.fill();

            const barLabelNode = new Node('XpBarText');
            barLabelNode.layer = panel.layer;
            barLabelNode.setParent(xpNode);
            barLabelNode.addComponent(UITransform).setContentSize(400, 20);
            const barLabel = barLabelNode.addComponent(Label);
            barLabel.string = result.newXp + ' / ' + result.xpForNextLevel;
            barLabel.fontSize = 13;
            barLabel.color = new Color(140, 160, 180, 255);
            barLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
            barLabelNode.setPosition(0, -40, 0);
        }

        this._progressionNode = xpNode;

        if (result.leveledUp) {
            Tween.stopAllByTarget(xpLabelNode);
            xpLabelNode.setScale(1.3, 1.3, 1);
            tween(xpLabelNode)
                .to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
                .start();
        }
    }

    hideProgressionResult() {
        if (this._progressionNode) {
            this._progressionNode.destroy();
            this._progressionNode = null;
        }
    }

    resetAll() {
        this.hideProgressionResult();
        this.updateProgress(0, 0);
        this.setRaceStatusVisible(false);
        if (this.ratingLabel) {
            this.ratingLabel.string = '';
        }
        if (this.comboLabel) {
            this.comboLabel.string = '';
        }
        for (const label of [this.ratingLabel, this.comboLabel]) {
            const opacity = label?.node?.getComponent(UIOpacity);
            if (opacity) {
                Tween.stopAllByTarget(opacity);
                opacity.opacity = 255;
            }
        }
        if (this.countdownOverlay) {
            this.countdownOverlay.active = false;
        }
        this.hideFinishCountdown();
        this.updateDiveCharge(0, false);
        this.setSpeedBarVisible(false);
        this.setSprintActive(false);
        // Restore the swim pad for the next race (it is hidden during the awards ceremony).
        // 为下一场比赛恢复划水板（颁奖仪式期间被隐藏）。
        if (this.strokeInput) {
            this.strokeInput.active = true;
        }
        if (this.diveTouchArea) {
            this.diveTouchArea.active = true;
        }
        if (this.resultPanel) {
            this.resultPanel.active = false;
        }
        this.updateLeaderboard([], 0);
        if (this.hintLabel) {
            this.hintLabel.string = '准备开始';
        }
    }

    private updateLeaderboard(rows: RaceLeaderboardRow[] | undefined, playerTime: number) {
        const leaderboard = rows && rows.length > 0
            ? rows
            : playerTime > 0 ? [{ name: PlayerData.nickName, placement: 1, time: playerTime, isPlayer: true }] : [];
        for (let i = 0; i < this.resultRows.length; i++) {
            const nameLabel = this.resultRows[i];
            const rankLabel = this.resultRankLabels[i];
            const timeLabel = this.resultTimeLabels[i];
            const speedLabel = this.resultSpeedLabels[i];
            const back = this.resultRowBacks[i];
            const avatar = this.resultAvatars[i];
            const row = leaderboard[i];
            if (!row) {
                setLabelText(nameLabel, '');
                setLabelText(rankLabel, '');
                setLabelText(timeLabel, '');
                setLabelText(speedLabel, '');
                setRowBack(back, null);
                if (avatar) {
                    avatar.node.active = false;
                }
                continue;
            }
            const displayName = row.isPlayer ? fitName(row.name || PlayerData.nickName) : fitName(row.name);
            const finished = row.time > 0;
            const averageSpeed = finished ? getRaceDistance() / row.time : 0;
            const color = row.isPlayer ? new Color(255, 214, 44, 255) : new Color(218, 230, 246, 255);
            setResultLabel(nameLabel, displayName, color, row.isPlayer);
            setResultLabel(rankLabel, `${row.placement}`, color, row.isPlayer);
            setResultLabel(timeLabel, finished ? `${row.time.toFixed(2)} 秒` : '未完成', color, row.isPlayer);
            setResultLabel(speedLabel, finished ? `${averageSpeed.toFixed(2)} m/s` : '--', color, row.isPlayer);
            setRowBack(back, row.isPlayer ? this.resultRowPlayerFrame : this.resultRowNormalFrame);
            if (avatar) {
                avatar.node.active = true;
                avatar.spriteFrame = this.resultAvatarFrames[avatarFrameIndex(row)] ?? avatar.spriteFrame;
                avatar.color = Color.WHITE;
            }
        }
    }

    private setupButtonFeedback(btn: Node) {
        if (!btn) {
            return;
        }
        const base = btn.scale.clone();
        btn.on(Node.EventType.TOUCH_START, () => tween(btn).to(0.04, { scale: new Vec3(base.x * 0.94, base.y * 0.94, 1) }).start(), this);
        btn.on(Node.EventType.TOUCH_END, () => tween(btn).to(0.06, { scale: base }).start(), this);
        btn.on(Node.EventType.TOUCH_CANCEL, () => tween(btn).to(0.06, { scale: base }).start(), this);
    }

    private layoutResultPanelForAwards() {
        if (!this.resultPanel) {
            return;
        }
        const visibleSize = view.getVisibleSize();
        this.resultPanel.setScale(0.52, 0.52, 1);
        this.resultPanel.setPosition(visibleSize.width * 0.24, 0, this.resultPanel.position.z);
    }

    private pulse(node: Node, scale: number) {
        Tween.stopAllByTarget(node);
        node.setScale(1, 1, 1);
        tween(node)
            .to(0.06, { scale: new Vec3(scale, scale, 1) })
            .to(0.12, { scale: new Vec3(1, 1, 1) })
            .start();
    }

    private setSpeedBarVisible(visible: boolean) {
        if (this.speedBarRoot) {
            this.speedBarRoot.active = visible;
        }
    }

    private resizeCountdownShade(width: number, height: number) {
        this.countdownShade?.getComponent(UITransform)?.setContentSize(width, height);
        this.countdownShade?.setPosition(0, 44, 0);
    }
}

function ratingText(rating: Rating): string {
    if (rating === Rating.PERFECT) {
        return '完美';
    }
    if (rating === Rating.GOOD) {
        return '不错';
    }
    return '失误';
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function drawHeartRateFill(gfx: Graphics, ratio: number, color: Color) {
    const w = 220;
    const h = 16;
    gfx.clear();
    gfx.fillColor = new Color(20, 24, 34, 180);
    gfx.rect(-w / 2, -h / 2, w, h);
    gfx.fill();
    gfx.fillColor = color;
    gfx.rect(-w / 2, -h / 2, w * clamp01(ratio), h);
    gfx.fill();
}

function heartRateZoneColor(zone: string): Color {
    switch (zone) {
        case 'OPTIMAL':
            return new Color(80, 242, 161, 255);
        case 'HIGH_PRESSURE':
            return new Color(255, 184, 77, 255);
        case 'OVERLOAD':
            return new Color(255, 92, 92, 255);
        default:
            return new Color(120, 196, 255, 255);
    }
}

function drawEnergyFill(gfx: Graphics, ratio: number, color: Color) {
    const w = 220;
    const h = 16;
    gfx.clear();
    gfx.fillColor = new Color(20, 24, 34, 180);
    gfx.rect(-w / 2, -h / 2, w, h);
    gfx.fill();
    gfx.fillColor = color;
    gfx.rect(-w / 2, -h / 2, w * clamp01(ratio), h);
    gfx.fill();
}

function energyColor(ratio: number, depleted: boolean): Color {
    if (depleted || ratio <= 0.0001) {
        return new Color(120, 120, 130, 255);
    }
    if (ratio < 0.25) {
        return new Color(255, 92, 92, 255);
    }
    if (ratio < 0.5) {
        return new Color(255, 184, 77, 255);
    }
    return new Color(120, 220, 255, 255);
}

// Fiery palette during sprint: warm oranges replace the normal blue/teal.
function sprintEnergyColor(ratio: number, depleted: boolean): Color {
    if (depleted || ratio <= 0.0001) {
        return new Color(180, 80, 30, 255);
    }
    if (ratio < 0.25) {
        return new Color(255, 100, 30, 255);
    }
    if (ratio < 0.5) {
        return new Color(255, 160, 40, 255);
    }
    return new Color(255, 210, 70, 255);
}

function drawChargeFill(gfx: Graphics, ratio: number) {
    const w = 12;
    const h = 216;
    gfx.clear();
    gfx.fillColor = ratio > 0.82
        ? new Color(255, 224, 89, 255)
        : ratio > 0.45
            ? new Color(80, 242, 161, 255)
            : new Color(87, 196, 255, 255);
    gfx.rect(-w / 2, -h / 2, w, h * ratio);
    gfx.fill();
}

function setVerticalFill(node: Node, ratio: number, color: Color) {
    const transform = node.getComponent(UITransform);
    const sprite = node.getComponent(Sprite);
    if (sprite) {
        sprite.color = color;
    }
    if (!transform) {
        node.setScale(1, Math.max(0.001, ratio), 1);
        return;
    }
    const originalHeight = 212;
    const height = Math.max(1, originalHeight * ratio);
    transform.setContentSize(transform.contentSize.width, height);
    node.setPosition(node.position.x, -originalHeight / 2 + height / 2, node.position.z);
}

function chargeColor(power: number): Color {
    return power > 0.82
        ? new Color(255, 214, 64, 255)
        : power > 0.45
            ? new Color(76, 216, 235, 255)
            : new Color(255, 82, 91, 255);
}

function fitName(name: string): string {
    const value = name || 'AI';
    return value.length > 12 ? value.slice(0, 12) : value;
}

function setRowBack(node: Node | undefined, frame: SpriteFrame | null) {
    if (!node) {
        return;
    }
    const sprite = node.getComponent(Sprite);
    if (!sprite || !frame) {
        node.active = false;
        return;
    }
    node.active = true;
    sprite.spriteFrame = frame;
    sprite.color = Color.WHITE;
}

function setLabelText(label: Label | undefined, value: string) {
    if (label) {
        label.string = value;
    }
}

function setResultLabel(label: Label | undefined, value: string, color: Color, highlighted: boolean) {
    if (!label) {
        return;
    }
    label.string = value;
    label.color = color;
    label.fontSize = highlighted ? 17 : 16;
}

function avatarFrameIndex(row: RaceLeaderboardRow): number {
    if (row.isPlayer) {
        return 0;
    }
    let hash = 0;
    for (const char of row.name || 'AI') {
        hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
    }
    return 1 + (hash % 7);
}
