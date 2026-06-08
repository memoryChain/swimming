import { _decorator, Color, Component, Graphics, Label, Node, Tween, tween, UITransform, Vec3 } from 'cc';
import { getRaceDistance } from '../core/GameBalance';
import { Rating } from '../core/GameConstants';

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
};

@ccclass('UIController')
export class UIController extends Component {
    @property(Node) public btnArm: Node = null;
    @property(Node) public btnLeg: Node = null;
    @property(Label) public distanceLabel: Label = null;
    @property(Label) public aiDistanceLabel: Label = null;
    @property(Label) public timerLabel: Label = null;
    @property(Label) public placementLabel: Label = null;
    @property(Label) public speedLabel: Label = null;
    @property(Label) public telemetryLabel: Label = null;
    @property(Label) public hintLabel: Label = null;
    @property(Node) public progressDot: Node = null;
    @property public progressTrackWidth = 240;
    @property(Node) public speedBarRoot: Node = null;
    @property(Node) public countdownOverlay: Node = null;
    @property(Label) public countdownLabel: Label = null;
    @property(Node) public diveChargeTrack: Node = null;
    @property(Graphics) public diveChargeFill: Graphics = null;
    @property(Node) public resultPanel: Node = null;
    @property(Label) public resultTitle: Label = null;
    @property(Label) public resultTime: Label = null;
    public resultRows: Label[] = [];
    public resultRowBacks: Node[] = [];
    @property(Label) public ratingLabel: Label = null;
    @property(Label) public comboLabel: Label = null;

    start() {
        this.setupButtonFeedback(this.btnArm);
        this.setupButtonFeedback(this.btnLeg);
        this.resetAll();
    }

    updateTimer(time: number) {
        if (!this.timerLabel) {
            return;
        }
        const mins = Math.floor(time / 60);
        let secs = (time % 60).toFixed(2);
        while (secs.length < 5) {
            secs = `0${secs}`;
        }
        this.timerLabel.string = `${mins}:${secs}`;
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

    updatePlacement(placement: number, racerCount: number) {
        if (!this.placementLabel) {
            return;
        }
        if (placement <= 0 || racerCount <= 0) {
            this.placementLabel.string = 'POS --/--';
            return;
        }
        this.placementLabel.string = `POS ${placement}/${racerCount}`;
    }

    updateSpeed(speed: number) {
        if (this.speedLabel) {
            this.speedLabel.string = `${speed.toFixed(2)}\nm/s`;
        }
    }

    updateSwimTelemetry(stability: number, acceleration: number, speed: number) {
        if (this.telemetryLabel) {
            this.telemetryLabel.string = `STB ${Math.round(clamp01(stability) * 100)}%   ACC ${signed(acceleration)}   SPD ${speed.toFixed(2)} m/s`;
        }
    }

    showRating(rating: Rating, combo: number) {
        if (this.ratingLabel) {
            this.ratingLabel.string = rating.toUpperCase();
            this.ratingLabel.color = rating === Rating.PERFECT
                ? new Color(255, 224, 89, 255)
                : rating === Rating.GOOD
                    ? new Color(80, 242, 161, 255)
                    : new Color(255, 92, 92, 255);
            this.pulse(this.ratingLabel.node, 1.18);
        }
        if (this.comboLabel) {
            this.comboLabel.string = combo > 0 ? `${combo} COMBO` : '';
            this.comboLabel.fontSize = combo >= 10 ? 25 : 24;
        }
    }

    showCountdown(value: number) {
        if (this.countdownOverlay) {
            this.countdownOverlay.active = true;
        }
        this.setSpeedBarVisible(false);
        if (this.hintLabel) {
            this.hintLabel.string = 'Hold A+D during countdown, auto dive on GO';
        }
        if (this.countdownLabel) {
            this.countdownLabel.node.getComponent(UITransform)?.setContentSize(720, 220);
            this.countdownLabel.fontSize = 96;
            this.countdownLabel.lineHeight = 140;
            this.countdownLabel.string = value > 0 ? `${value}` : 'GO';
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
    }

    hideCountdown() {
        if (this.countdownOverlay) {
            this.countdownOverlay.active = false;
        }
        this.updateDiveCharge(0, false);
        if (this.hintLabel) {
            this.hintLabel.string = 'A: left hand + right foot   D: right hand + left foot';
        }
    }

    showDivePrompt() {
        if (this.countdownOverlay) {
            this.countdownOverlay.active = true;
        }
        if (this.countdownLabel) {
            this.countdownLabel.node.getComponent(UITransform)?.setContentSize(820, 220);
            this.countdownLabel.fontSize = 58;
            this.countdownLabel.lineHeight = 72;
            this.countdownLabel.string = '双指按住屏幕蓄力';
            this.pulse(this.countdownLabel.node, 1.08);
        }
        if (this.hintLabel) {
            this.hintLabel.string = '双指按住屏幕蓄力，倒计时结束自动起跳';
        }
        this.updateDiveCharge(0, true);
    }

    showDiveCharging() {
        if (this.countdownLabel) {
            this.countdownLabel.node.getComponent(UITransform)?.setContentSize(820, 220);
            this.countdownLabel.fontSize = 64;
            this.countdownLabel.lineHeight = 64;
            this.countdownLabel.string = 'CHARGING';
            this.pulse(this.countdownLabel.node, 1.12);
        }
    }

    showDiveRelease(power: number) {
        if (this.countdownLabel) {
            this.countdownLabel.node.getComponent(UITransform)?.setContentSize(820, 220);
            this.countdownLabel.fontSize = 64;
            this.countdownLabel.lineHeight = 64;
            this.countdownLabel.string = `DIVE ${Math.round(power * 100)}%`;
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
            this.hintLabel.string = 'Streamline glide... get ready to stroke';
        }
    }

    showResult(isWin: boolean, playerTime: number, aiTime: number, stats?: RaceResultStats) {
        const soloRace = (stats?.racerCount ?? 2) <= 1;
        this.setSpeedBarVisible(false);
        if (this.resultPanel) {
            this.resultPanel.active = true;
        }
        if (this.resultTitle) {
            this.resultTitle.string = 'RESULTS';
            this.resultTitle.color = (soloRace || isWin) ? new Color(255, 224, 89, 255) : new Color(255, 112, 112, 255);
        }
        if (this.resultTime) {
            const placement = stats?.placement && stats?.racerCount ? `PLACE #${stats.placement}/${stats.racerCount}` : '';
            const details = stats ? `AVG ${stats.averageSpeed.toFixed(2)} m/s   MAX ${stats.maxCombo} combo` : '';
            this.resultTime.string = [placement, details].filter(Boolean).join('   ');
            this.resultTime.lineHeight = 22;
        }
        this.updateLeaderboard(stats?.leaderboard, playerTime);
        void aiTime;
        void soloRace;
        if (this.hintLabel) {
            this.hintLabel.string = 'Press Space or tap Restart';
        }
    }

    resetAll() {
        this.updateTimer(0);
        this.updateProgress(0, 0);
        this.updatePlacement(0, 0);
        this.updateSpeed(0);
        this.updateSwimTelemetry(0, 0, 0);
        if (this.ratingLabel) {
            this.ratingLabel.string = '';
        }
        if (this.comboLabel) {
            this.comboLabel.string = '';
        }
        if (this.countdownOverlay) {
            this.countdownOverlay.active = false;
        }
        this.updateDiveCharge(0, false);
        this.setSpeedBarVisible(false);
        if (this.resultPanel) {
            this.resultPanel.active = false;
        }
        this.updateLeaderboard([], 0);
        if (this.hintLabel) {
            this.hintLabel.string = 'Get ready';
        }
    }

    private updateLeaderboard(rows: RaceLeaderboardRow[] | undefined, playerTime: number) {
        const leaderboard = rows && rows.length > 0
            ? rows
            : playerTime > 0 ? [{ name: 'YOU', placement: 1, time: playerTime, isPlayer: true }] : [];
        for (let i = 0; i < this.resultRows.length; i++) {
            const label = this.resultRows[i];
            const back = this.resultRowBacks[i];
            const row = leaderboard[i];
            if (!row) {
                if (label) {
                    label.string = '';
                }
                setRowBack(back, new Color(255, 255, 255, 0));
                continue;
            }
            if (label) {
                label.string = `${padLeft(`${row.placement}.`, 3)}  ${padRight(fitName(row.name), 12)}  ${padLeft(`${row.time.toFixed(2)}s`, 7)}`;
                label.color = row.isPlayer ? new Color(255, 244, 142, 255) : new Color(236, 246, 252, 255);
                label.fontSize = row.isPlayer ? 20 : 18;
            }
            setRowBack(back, row.isPlayer ? new Color(255, 224, 89, 44) : new Color(255, 255, 255, 12));
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
}

function signed(value: number): string {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
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

function fitName(name: string): string {
    const value = name || 'AI';
    return value.length > 12 ? value.slice(0, 12) : value;
}

function padRight(value: string, length: number): string {
    return value.length >= length ? value : `${value}${' '.repeat(length - value.length)}`;
}

function padLeft(value: string, length: number): string {
    return value.length >= length ? value : `${' '.repeat(length - value.length)}${value}`;
}

function setRowBack(node: Node | undefined, color: Color) {
    const gfx = node?.getComponent(Graphics);
    if (!gfx) {
        return;
    }
    gfx.clear();
    if (color.a <= 0) {
        return;
    }
    gfx.fillColor = color;
    gfx.rect(-236, -17, 472, 34);
    gfx.fill();
}
