import { _decorator, Color, Component, Graphics, Label, LabelOutline, Layers, Node, Sprite, SpriteFrame, Tween, tween, UIOpacity, UITransform, Vec3, view } from 'cc';
import { getRaceDistance } from '../core/GameBalance';
import { PlayerData } from '../backend/PlayerData';
import { Rating } from '../core/GameConstants';
import { SprintVignetteOverlay } from './SprintVignetteOverlay';
import { ULTIMATE_ENERGY_BALANCE } from '../core/UltimateEnergyBalance';

const { ccclass, property } = _decorator;
const HUD_BAR_WIDTH = 220;
const HUD_BAR_BACKGROUND = new Color(20, 24, 34, 180);
const HUD_READY_TICK = new Color(255, 255, 255, 200);
const HEART_RATE_LOW = new Color(120, 196, 255, 255);
const HEART_RATE_OPTIMAL = new Color(80, 242, 161, 255);
const HEART_RATE_HIGH = new Color(255, 184, 77, 255);
const HEART_RATE_OVERLOAD = new Color(255, 92, 92, 255);
const ENERGY_EMPTY = new Color(120, 120, 130, 255);
const ENERGY_LOW = new Color(255, 92, 92, 255);
const ENERGY_MID = new Color(255, 184, 77, 255);
const ENERGY_HIGH = new Color(120, 220, 255, 255);
const SPRINT_ENERGY_EMPTY = new Color(180, 80, 30, 255);
const SPRINT_ENERGY_LOW = new Color(255, 100, 30, 255);
const SPRINT_ENERGY_MID = new Color(255, 160, 40, 255);
const SPRINT_ENERGY_HIGH = new Color(255, 210, 70, 255);
const ULTIMATE_DENIED = new Color(255, 92, 92, 255);
const ULTIMATE_EMPTY = new Color(110, 100, 80, 255);
const ULTIMATE_READY = new Color(255, 215, 90, 255);
const ULTIMATE_CHARGING = new Color(210, 160, 60, 255);
const DIVE_CHARGE_HEIGHT = 216;
const DIVE_GFX_LOW = new Color(87, 196, 255, 255);
const DIVE_GFX_MID = new Color(80, 242, 161, 255);
const DIVE_GFX_HIGH = new Color(255, 224, 89, 255);
const DIVE_SPRITE_LOW = new Color(255, 82, 91, 255);
const DIVE_SPRITE_MID = new Color(76, 216, 235, 255);
const DIVE_SPRITE_HIGH = new Color(255, 214, 64, 255);

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
    public ultimateBarRoot: Node = null;
    public ultimateBarFill: Graphics = null;
    public ultimateLabel: Label = null;
    public sprintLabel: Label | null = null;
    public sprintVignette: SprintVignetteOverlay | null = null;
    private _sprintActive = false;
    private _energyTotal = 100;
    private _ultimateDeniedUntil = 0;
    // Hot HUD cache: Cocos Label.string rebuilds text meshes and Graphics.clear()
    // rebuilds geometry. Quantize fills to physical bar pixels and only touch labels
    // when their displayed integer actually changes.
    private _progressPercent = -1;
    private _progressDotPixel = -1;
    private _aiDistanceTenths = -1;
    private _heartRateText = -1;
    private _heartRateFillPixel = -1;
    private _heartRateColor: Color | null = null;
    private _energyText = -1;
    private _energyFillPixel = -1;
    private _energyColor: Color | null = null;
    private _ultimateText = -1;
    private _ultimateFillPixel = -1;
    private _ultimateColor: Color | null = null;
    private _diveChargeFillPixel = -1;
    private _diveChargeGfxColor: Color | null = null;
    private _diveChargeSpriteColor: Color | null = null;
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
        const percent = Math.round(ratio * 100);
        if (this.distanceLabel && percent !== this._progressPercent) {
            this._progressPercent = percent;
            this.distanceLabel.string = `${percent}%`;
        }
        const dotPixel = Math.round(this.progressTrackWidth * ratio);
        if (this.progressDot && dotPixel !== this._progressDotPixel) {
            this._progressDotPixel = dotPixel;
            this.progressDot.setPosition(-this.progressTrackWidth / 2 + dotPixel, 0, 0);
        }
        const aiTenths = Math.round(Math.min(raceDistance, aiDist) * 10);
        if (this.aiDistanceLabel && aiTenths !== this._aiDistanceTenths) {
            this._aiDistanceTenths = aiTenths;
            this.aiDistanceLabel.string = `AI ${(aiTenths / 10).toFixed(1)}m`;
        }
    }

    setProgressVisible(visible: boolean) {
        if (this.progressTrackRoot && this.progressTrackRoot.active !== visible) {
            this.progressTrackRoot.active = visible;
        }
        if (this.distanceLabel?.node && this.distanceLabel.node.active !== visible) {
            this.distanceLabel.node.active = visible;
        }
    }

    setRaceStatusVisible(visible: boolean) {
        this.setProgressVisible(visible);
        this.setHeartRateBarVisible(visible);
        this.setEnergyBarVisible(visible);
        this.setUltimateBarVisible(visible);
    }

    updateHeartRateBar(heartRate: number, zone: string) {
        const ratio = clamp01(heartRate / 200);
        const color = heartRateZoneColor(zone);
        const fillPixel = Math.round(ratio * HUD_BAR_WIDTH);
        const colorChanged = color !== this._heartRateColor;
        if (this.heartRateBarFill && (fillPixel !== this._heartRateFillPixel || colorChanged)) {
            drawHeartRateFill(this.heartRateBarFill, fillPixel / HUD_BAR_WIDTH, color);
        }
        this._heartRateFillPixel = fillPixel;
        this._heartRateColor = color;
        const textValue = Math.round(heartRate);
        if (this.heartRateLabel && textValue !== this._heartRateText) {
            this._heartRateText = textValue;
            this.heartRateLabel.string = `心率 ${textValue}`;
        }
        if (this.heartRateLabel && colorChanged) {
            this.heartRateLabel.color = color;
        }
    }

    setHeartRateBarVisible(visible: boolean) {
        if (this.heartRateBarRoot && this.heartRateBarRoot.active !== visible) {
            this.heartRateBarRoot.active = visible;
        }
    }

    updateEnergyBar(energy: number, depleted: boolean) {
        const ratio = clamp01(energy / this._energyTotal);
        const color = this._sprintActive
            ? sprintEnergyColor(ratio, depleted)
            : energyColor(ratio, depleted);
        const fillPixel = Math.round(ratio * HUD_BAR_WIDTH);
        const colorChanged = color !== this._energyColor;
        if (this.energyBarFill && (fillPixel !== this._energyFillPixel || colorChanged)) {
            drawEnergyFill(this.energyBarFill, fillPixel / HUD_BAR_WIDTH, color);
        }
        this._energyFillPixel = fillPixel;
        this._energyColor = color;
        const textValue = Math.round(energy);
        if (this.energyLabel && textValue !== this._energyText) {
            this._energyText = textValue;
            this.energyLabel.string = `体能 ${textValue}`;
        }
        if (this.energyLabel && colorChanged) {
            this.energyLabel.color = color;
        }
    }

    setSprintActive(active: boolean) {
        if (active === this._sprintActive) {
            return;
        }
        this._energyFillPixel = -1;
        this._energyColor = null;
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
        this._energyFillPixel = -1;
    }

    setEnergyBarVisible(visible: boolean) {
        if (this.energyBarRoot && this.energyBarRoot.active !== visible) {
            this.energyBarRoot.active = visible;
        }
    }

    // 蓄气（大招能量）条。enough = 当前能量已够放一次海豚跳，金色高亮；不足时偏暗。
    updateUltimateEnergyBar(energy: number, enough: boolean) {
        const ratio = clamp01(energy / ULTIMATE_ENERGY_BALANCE.maxEnergy);
        const denied = Date.now() < this._ultimateDeniedUntil;
        const color = ultimateEnergyColor(ratio, enough, denied);
        const fillPixel = Math.round(ratio * HUD_BAR_WIDTH);
        const colorChanged = color !== this._ultimateColor;
        if (this.ultimateBarFill && (fillPixel !== this._ultimateFillPixel || colorChanged)) {
            drawUltimateEnergyFill(
                this.ultimateBarFill,
                fillPixel / HUD_BAR_WIDTH,
                color,
                ULTIMATE_ENERGY_BALANCE.dolphinCost / ULTIMATE_ENERGY_BALANCE.maxEnergy,
            );
        }
        this._ultimateFillPixel = fillPixel;
        this._ultimateColor = color;
        const textValue = Math.round(energy);
        if (this.ultimateLabel && textValue !== this._ultimateText) {
            this._ultimateText = textValue;
            this.ultimateLabel.string = `蓄气 ${textValue}`;
        }
        if (this.ultimateLabel && colorChanged) {
            this.ultimateLabel.color = color;
        }
    }

    // 能量不足时触发一次短暂红闪（弱提示，不打断操作）。
    flashUltimateEnergyDenied() {
        this._ultimateDeniedUntil = Date.now() + 350;
        this._ultimateFillPixel = -1;
        this._ultimateColor = null;
    }

    setUltimateBarVisible(visible: boolean) {
        if (this.ultimateBarRoot && this.ultimateBarRoot.active !== visible) {
            this.ultimateBarRoot.active = visible;
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
        if (this.diveChargeTrack && this.diveChargeTrack.active !== visible) {
            this.diveChargeTrack.active = visible;
        }
        if (this.diveChargeFill && this.diveChargeFill.node.active !== visible) {
            this.diveChargeFill.node.active = visible;
        }
        if (this.diveChargeFillNode && this.diveChargeFillNode.active !== visible) {
            this.diveChargeFillNode.active = visible;
        }
        if (!visible) {
            return;
        }
        const ratio = clamp01(power);
        const fillPixel = Math.round(ratio * DIVE_CHARGE_HEIGHT);
        const gfxColor = diveChargeGraphicsColor(ratio);
        if (this.diveChargeFill
            && (fillPixel !== this._diveChargeFillPixel || gfxColor !== this._diveChargeGfxColor)) {
            drawChargeFill(this.diveChargeFill, fillPixel / DIVE_CHARGE_HEIGHT, gfxColor);
        }
        const spriteColor = diveChargeSpriteColor(ratio);
        if (this.diveChargeFillNode
            && (fillPixel !== this._diveChargeFillPixel || spriteColor !== this._diveChargeSpriteColor)) {
            setVerticalFill(this.diveChargeFillNode, fillPixel / DIVE_CHARGE_HEIGHT, spriteColor);
        }
        this._diveChargeFillPixel = fillPixel;
        this._diveChargeGfxColor = gfxColor;
        this._diveChargeSpriteColor = spriteColor;
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
    private _progressionTweenCounter: { value: number } | null = null;

    showProgressionResult(result: {
        coinsGained: number;
    } | null) {
        this.hideProgressionResult();
        if (!result || result.coinsGained <= 0) {
            return;
        }
        const parent = this.node.parent;
        if (!parent?.isValid) {
            return;
        }
        // Independent panel under the race HUD (not inside resultPanel) so the
        // awards layout's 0.52 scale does not shrink the progression feedback.
        const visibleSize = view.getVisibleSize();
        const panel = new Node('ProgressionResult');
        panel.layer = parent.layer;
        panel.setParent(parent);
        panel.addComponent(UITransform).setContentSize(360, 64);
        const panelOpacity = panel.addComponent(UIOpacity);
        panelOpacity.opacity = 0;
        const targetY = -visibleSize.height / 2 + 105;
        panel.setPosition(0, targetY - 24, 0);

        const coinLabel = new Node('CoinsGained').addComponent(Label);
        coinLabel.node.layer = panel.layer;
        coinLabel.node.setParent(panel);
        coinLabel.node.addComponent(UITransform).setContentSize(360, 36);
        coinLabel.fontSize = 28;
        coinLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        coinLabel.color = new Color(255, 209, 42, 255);
        coinLabel.string = '+0 金币';
        coinLabel.node.setPosition(0, 0, 0);

        this._progressionNode = panel;
        this._progressionTweenCounter = null;

        // Delay slightly so the result panel reads first, then slide up + fade in.
        tween(panelOpacity)
            .delay(0.4)
            .to(0.4, { opacity: 255 })
            .start();
        tween(panel)
            .delay(0.4)
            .to(0.4, { position: new Vec3(0, targetY, 0) }, { easing: 'sineOut' })
            .call(() => this.animateCoinGain(result, coinLabel))
            .start();
    }

    private animateCoinGain(result: { coinsGained: number }, coinLabel: Label) {
        const counter = { value: 0 };
        this._progressionTweenCounter = counter;
        const duration = Math.min(1.2, 0.5 + result.coinsGained / 600);
        tween(counter)
            .to(duration, { value: result.coinsGained }, {
                onUpdate: () => {
                    if (!coinLabel.node.isValid) {
                        return;
                    }
                    coinLabel.string = '+' + Math.round(counter.value) + ' 金币';
                },
            })
            .call(() => {
                if (!coinLabel.node.isValid) {
                    return;
                }
                coinLabel.string = '+' + result.coinsGained + ' 金币';
            })
            .start();
    }

    hideProgressionResult() {
        if (this._progressionTweenCounter) {
            Tween.stopAllByTarget(this._progressionTweenCounter);
            this._progressionTweenCounter = null;
        }
        if (this._progressionNode) {
            this._progressionNode.destroy();
            this._progressionNode = null;
        }
    }

    resetAll() {
        this.hideProgressionResult();
        this.invalidateRaceHudCache();
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

    private invalidateRaceHudCache() {
        this._progressPercent = -1;
        this._progressDotPixel = -1;
        this._aiDistanceTenths = -1;
        this._heartRateText = -1;
        this._heartRateFillPixel = -1;
        this._heartRateColor = null;
        this._energyText = -1;
        this._energyFillPixel = -1;
        this._energyColor = null;
        this._ultimateText = -1;
        this._ultimateFillPixel = -1;
        this._ultimateColor = null;
        this._diveChargeFillPixel = -1;
        this._diveChargeGfxColor = null;
        this._diveChargeSpriteColor = null;
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
        if (this.speedBarRoot && this.speedBarRoot.active !== visible) {
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
    const w = HUD_BAR_WIDTH;
    const h = 16;
    gfx.clear();
    gfx.fillColor = HUD_BAR_BACKGROUND;
    gfx.rect(-w / 2, -h / 2, w, h);
    gfx.fill();
    gfx.fillColor = color;
    gfx.rect(-w / 2, -h / 2, w * clamp01(ratio), h);
    gfx.fill();
}

function heartRateZoneColor(zone: string): Color {
    switch (zone) {
        case 'OPTIMAL':
            return HEART_RATE_OPTIMAL;
        case 'HIGH_PRESSURE':
            return HEART_RATE_HIGH;
        case 'OVERLOAD':
            return HEART_RATE_OVERLOAD;
        default:
            return HEART_RATE_LOW;
    }
}

function drawEnergyFill(gfx: Graphics, ratio: number, color: Color) {
    const w = HUD_BAR_WIDTH;
    const h = 16;
    gfx.clear();
    gfx.fillColor = HUD_BAR_BACKGROUND;
    gfx.rect(-w / 2, -h / 2, w, h);
    gfx.fill();
    gfx.fillColor = color;
    gfx.rect(-w / 2, -h / 2, w * clamp01(ratio), h);
    gfx.fill();
}

function energyColor(ratio: number, depleted: boolean): Color {
    if (depleted || ratio <= 0.0001) {
        return ENERGY_EMPTY;
    }
    if (ratio < 0.25) {
        return ENERGY_LOW;
    }
    if (ratio < 0.5) {
        return ENERGY_MID;
    }
    return ENERGY_HIGH;
}

// Fiery palette during sprint: warm oranges replace the normal blue/teal.
function sprintEnergyColor(ratio: number, depleted: boolean): Color {
    if (depleted || ratio <= 0.0001) {
        return SPRINT_ENERGY_EMPTY;
    }
    if (ratio < 0.25) {
        return SPRINT_ENERGY_LOW;
    }
    if (ratio < 0.5) {
        return SPRINT_ENERGY_MID;
    }
    return SPRINT_ENERGY_HIGH;
}

function ultimateEnergyColor(ratio: number, enough: boolean, denied: boolean): Color {
    if (denied) {
        return ULTIMATE_DENIED;
    }
    if (ratio <= 0.0001) {
        return ULTIMATE_EMPTY;
    }
    if (enough) {
        return ULTIMATE_READY;
    }
    return ULTIMATE_CHARGING;
}

function drawUltimateEnergyFill(gfx: Graphics, ratio: number, color: Color, readyRatio: number) {
    const w = HUD_BAR_WIDTH;
    const h = 16;
    gfx.clear();
    gfx.fillColor = HUD_BAR_BACKGROUND;
    gfx.rect(-w / 2, -h / 2, w, h);
    gfx.fill();
    gfx.fillColor = color;
    gfx.rect(-w / 2, -h / 2, w * clamp01(ratio), h);
    gfx.fill();
    // 海豚跳消耗刻度线（readyRatio 位置），提示“攒到这里就能放”。
    const tickX = -w / 2 + w * clamp01(readyRatio);
    gfx.strokeColor = HUD_READY_TICK;
    gfx.lineWidth = 2;
    gfx.moveTo(tickX, -h / 2);
    gfx.lineTo(tickX, h / 2);
    gfx.stroke();
}

function drawChargeFill(gfx: Graphics, ratio: number, color: Color) {
    const w = 12;
    const h = DIVE_CHARGE_HEIGHT;
    gfx.clear();
    gfx.fillColor = color;
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

function diveChargeGraphicsColor(power: number): Color {
    return power > 0.82 ? DIVE_GFX_HIGH : power > 0.45 ? DIVE_GFX_MID : DIVE_GFX_LOW;
}

function diveChargeSpriteColor(power: number): Color {
    return power > 0.82 ? DIVE_SPRITE_HIGH : power > 0.45 ? DIVE_SPRITE_MID : DIVE_SPRITE_LOW;
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
