import { _decorator, Color, Component, Label, Node, Tween, tween, UITransform, Vec3 } from 'cc';
import { MAX_SPEED, RACE_DISTANCE, Rating } from '../core/GameConstants';

const { ccclass, property } = _decorator;

@ccclass('UIController')
export class UIController extends Component {
    @property(Node) public btnArm: Node = null;
    @property(Node) public btnLeg: Node = null;
    @property(Label) public distanceLabel: Label = null;
    @property(Label) public aiDistanceLabel: Label = null;
    @property(Label) public timerLabel: Label = null;
    @property(Label) public speedLabel: Label = null;
    @property(Label) public hintLabel: Label = null;
    @property(Node) public countdownOverlay: Node = null;
    @property(Label) public countdownLabel: Label = null;
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
            this.speedLabel.string = `${speed.toFixed(2)} m/s  ${Math.round((speed / MAX_SPEED) * 100)}%`;
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
        if (this.countdownLabel) {
            this.countdownLabel.node.getComponent(UITransform)?.setContentSize(720, 220);
            this.countdownLabel.lineHeight = 140;
            this.countdownLabel.string = value > 0 ? `${value}` : 'GO';
            this.pulse(this.countdownLabel.node, 1.25);
        }
    }

    hideCountdown() {
        if (this.countdownOverlay) {
            this.countdownOverlay.active = false;
        }
        if (this.hintLabel) {
            this.hintLabel.string = 'Left click kicks, right click pulls';
        }
    }

    showResult(isWin: boolean, playerTime: number, aiTime: number) {
        if (this.resultPanel) {
            this.resultPanel.active = true;
        }
        if (this.resultTitle) {
            this.resultTitle.string = isWin ? 'YOU WIN' : 'AI WINS';
            this.resultTitle.color = isWin ? new Color(255, 224, 89, 255) : new Color(255, 112, 112, 255);
        }
        if (this.resultTime) {
            this.resultTime.string = `Your time ${playerTime.toFixed(2)}s  |  AI ${aiTime.toFixed(2)}s`;
        }
        if (this.hintLabel) {
            this.hintLabel.string = 'Press Space or tap Restart';
        }
    }

    resetAll() {
        this.updateTimer(0);
        this.updateProgress(0, 0);
        this.updateSpeed(0);
        if (this.ratingLabel) {
            this.ratingLabel.string = '';
        }
        if (this.comboLabel) {
            this.comboLabel.string = '';
        }
        if (this.countdownOverlay) {
            this.countdownOverlay.active = false;
        }
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
