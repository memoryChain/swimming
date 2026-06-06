import { _decorator, Color, Component, Graphics, Label, Node, Tween, tween, UITransform, Vec3 } from 'cc';
import { RACE_DISTANCE, SWIMMER_BALANCE } from '../core/GameBalance';
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
};

@ccclass('UIController')
export class UIController extends Component {
    @property(Node) public btnArm: Node = null;
    @property(Node) public btnLeg: Node = null;
    @property(Label) public distanceLabel: Label = null;
    @property(Label) public aiDistanceLabel: Label = null;
    @property(Label) public timerLabel: Label = null;
    @property(Label) public speedLabel: Label = null;
    @property(Label) public telemetryLabel: Label = null;
    @property(Label) public hintLabel: Label = null;
    @property(Node) public countdownOverlay: Node = null;
    @property(Label) public countdownLabel: Label = null;
    @property(Node) public diveChargeTrack: Node = null;
    @property(Graphics) public diveChargeFill: Graphics = null;
    @property(Node) public resultPanel: Node = null;
    @property(Label) public resultTitle: Label = null;
    @property(Label) public resultTime: Label = null;
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
        if (this.distanceLabel) {
            this.distanceLabel.string = `YOU ${Math.min(RACE_DISTANCE, playerDist).toFixed(1)}m`;
        }
        if (this.aiDistanceLabel) {
            this.aiDistanceLabel.string = `AI ${Math.min(RACE_DISTANCE, aiDist).toFixed(1)}m`;
        }
    }

    updateSpeed(speed: number) {
        if (this.speedLabel) {
            this.speedLabel.string = `${speed.toFixed(2)} m/s  ${Math.round((speed / SWIMMER_BALANCE.maxSpeed) * 100)}%`;
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
        }
    }

    showCountdown(value: number) {
        if (this.countdownOverlay) {
            this.countdownOverlay.active = true;
        }
        if (this.hintLabel) {
            this.hintLabel.string = 'Hold A+D during countdown, release after GO to dive';
        }
        if (this.countdownLabel) {
            this.countdownLabel.node.getComponent(UITransform)?.setContentSize(720, 220);
            this.countdownLabel.lineHeight = 140;
            this.countdownLabel.string = value > 0 ? `${value}` : 'GO';
            this.pulse(this.countdownLabel.node, 1.25);
        }
    }

    updateDiveCharge(power: number, visible: boolean) {
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
            this.countdownLabel.lineHeight = 64;
            this.countdownLabel.string = 'HOLD A + D';
            this.pulse(this.countdownLabel.node, 1.08);
        }
        if (this.hintLabel) {
            this.hintLabel.string = 'Hold both sides to load the dive, release to enter the water';
        }
        this.updateDiveCharge(0, true);
    }

    showDiveCharging() {
        if (this.countdownLabel) {
            this.countdownLabel.node.getComponent(UITransform)?.setContentSize(820, 220);
            this.countdownLabel.lineHeight = 64;
            this.countdownLabel.string = 'CHARGING';
            this.pulse(this.countdownLabel.node, 1.12);
        }
    }

    showDiveRelease(power: number) {
        if (this.countdownLabel) {
            this.countdownLabel.node.getComponent(UITransform)?.setContentSize(820, 220);
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
        if (this.hintLabel) {
            this.hintLabel.string = 'Streamline glide... get ready to stroke';
        }
    }

    showResult(isWin: boolean, playerTime: number, aiTime: number, stats?: RaceResultStats) {
        const soloRace = (stats?.racerCount ?? 2) <= 1;
        if (this.resultPanel) {
            this.resultPanel.active = true;
        }
        if (this.resultTitle) {
            this.resultTitle.string = soloRace ? 'FINISHED' : isWin ? 'YOU WIN' : 'AI WINS';
            this.resultTitle.color = (soloRace || isWin) ? new Color(255, 224, 89, 255) : new Color(255, 112, 112, 255);
        }
        if (this.resultTime) {
            const aiTimeText = aiTime > 0 ? `${aiTime.toFixed(2)}s` : '--';
            const base = soloRace
                ? `Your time ${playerTime.toFixed(2)}s`
                : `Your time ${playerTime.toFixed(2)}s  |  Best AI ${aiTimeText}`;
            const placement = !soloRace && stats?.placement && stats?.racerCount
                ? `\nPLACE #${stats.placement}/${stats.racerCount}`
                : '';
            const details = stats
                ? `${placement}\nAVG ${stats.averageSpeed.toFixed(2)} m/s  MAX ${stats.maxCombo} combo\nP/G/B ${stats.perfectCount}/${stats.goodCount}/${stats.missCount}`
                : '';
            this.resultTime.string = `${base}${details}`;
            this.resultTime.lineHeight = 28;
        }
        if (this.hintLabel) {
            this.hintLabel.string = 'Press Space or tap Restart';
        }
    }

    resetAll() {
        this.updateTimer(0);
        this.updateProgress(0, 0);
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
        if (this.resultPanel) {
            this.resultPanel.active = false;
        }
        if (this.hintLabel) {
            this.hintLabel.string = 'Get ready';
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
}

function signed(value: number): string {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function drawChargeFill(gfx: Graphics, ratio: number) {
    const w = 28;
    const h = 172;
    gfx.clear();
    gfx.fillColor = ratio > 0.82
        ? new Color(255, 224, 89, 255)
        : ratio > 0.45
            ? new Color(80, 242, 161, 255)
            : new Color(87, 196, 255, 255);
    gfx.rect(-w / 2, -h / 2, w, h * ratio);
    gfx.fill();
}
