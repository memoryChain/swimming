import { EventMouse, Graphics, Label, Node, UITransform, view } from 'cc';
import { UIController } from './UIController';
import { makeBottomRect, makeButton, makeLabel, makeRect, makeTouchArea, makeUiNode, uiColor } from './RuntimeUiFactory';

export type RaceHudCallbacks = {
    onStroke: () => void;
    onStrokeEnd: () => void;
    onDiveHoldStart: () => void;
    onDiveHoldEnd: (holdSeconds: number) => void;
    onRestart: () => void;
    onMenu: () => void;
};

export type RaceHudRefs = {
    uiController: UIController;
    timingGuideFill: Graphics;
    timingGuideMarker: Node;
};

export class RaceHudBuilder {
    private _diveHoldStartedAt = 0;

    constructor(private readonly _callbacks: RaceHudCallbacks) {}

    build(parent: Node, w: number, h: number): RaceHudRefs {
        const safeW = visibleUiWidth(w, h);
        const safeH = visibleUiHeight(w, h);
        const leftX = -safeW / 2;
        const rightX = safeW / 2;
        const topY = safeH / 2;
        const portrait = safeH > safeW;
        const sidePad = portrait ? 18 : 24;
        const topPad = portrait ? 34 : 28;

        const strokePad = makeTouchArea('StrokeInput', parent, w, h);
        strokePad.on(Node.EventType.TOUCH_START, () => this.beginStrokeHold());
        strokePad.on(Node.EventType.TOUCH_END, () => this.endStrokeHold());
        strokePad.on(Node.EventType.TOUCH_CANCEL, () => this.endStrokeHold());
        strokePad.on(Node.EventType.MOUSE_UP, () => this.endStrokeHold());
        strokePad.on(Node.EventType.MOUSE_DOWN, (event: EventMouse) => {
            if (event.getButton() === EventMouse.BUTTON_LEFT || event.getButton() === EventMouse.BUTTON_RIGHT) {
                this.beginStrokeHold();
            }
        });

        const timerLabel = makeLabel('Timer', parent, '0:00.00', 30, uiColor(255, 255, 255));
        timerLabel.setPosition(rightX - 92, topY - topPad, 0);
        const placementLabel = makeLabel('Placement', parent, 'POS --/--', 20, uiColor(255, 244, 142));
        placementLabel.getComponent(UITransform).setContentSize(150, 30);
        placementLabel.setPosition(leftX + 86, topY - topPad, 0);

        const progressTrackWidth = Math.min(240, Math.max(172, safeW - 300));
        const progressY = topY - (portrait ? 88 : 92);
        makeLabel('ProgressText', parent, 'RACE', 16, uiColor(210, 240, 250)).setPosition(-(progressTrackWidth / 2 + 48), progressY, 0);
        const progressTrack = makeRect('ProgressTrack', parent, progressTrackWidth, 12, uiColor(190, 230, 235, 190));
        progressTrack.setPosition(0, progressY, 0);
        const progressDot = makeRect('ProgressDot', progressTrack, 14, 14, uiColor(255, 54, 70));
        progressDot.setPosition(-progressTrackWidth / 2, 0, 0);
        const progressLabel = makeLabel('ProgressValue', parent, '0%', 16, uiColor(255, 255, 255));
        progressLabel.getComponent(UITransform).setContentSize(90, 26);
        progressLabel.setPosition(progressTrackWidth / 2 + 42, progressY, 0);

        const speedTrackX = rightX - sidePad - 16;
        const speedBarRoot = makeUiNode('SpeedBarRoot', parent);
        makeLabel('SpeedText', speedBarRoot, 'HOLD', 15, uiColor(210, 240, 250)).setPosition(speedTrackX, 124, 0);
        makeRect('SpeedTrack', speedBarRoot, 16, 220, uiColor(5, 18, 30, 210)).setPosition(speedTrackX, 0, 0);
        const speedFillNode = makeBottomRect('SpeedFill', speedBarRoot, 12, 216, uiColor(89, 234, 160));
        speedFillNode.setPosition(speedTrackX, 0, 0);
        const timingMarker = makeRect('TimingMarker', speedBarRoot, 24, 4, uiColor(255, 255, 255, 245));
        timingMarker.setPosition(speedTrackX, -108, 0);
        timingMarker.active = false;
        const speedLabel = makeLabel('SpeedValue', speedBarRoot, '0.00\nm/s', 14, uiColor(255, 255, 255));
        speedLabel.getComponent(UITransform).setContentSize(72, 42);
        speedLabel.getComponent(Label).lineHeight = 18;
        speedLabel.setPosition(speedTrackX - 46, 92, 0);
        const telemetryLabel = makeLabel('SwimTelemetry', parent, 'STB 0%   ACC +0.00   SPD 0.00 m/s', 15, uiColor(150, 235, 255));
        telemetryLabel.getComponent(UITransform).setContentSize(Math.min(430, safeW - 72), 24);
        telemetryLabel.setPosition(0, progressY - 26, 0);

        const ratingLabel = makeLabel('Rating', parent, '', 46, uiColor(255, 255, 255));
        ratingLabel.getComponent(UITransform).setContentSize(Math.min(380, safeW - 48), 60);
        ratingLabel.getComponent(Label).lineHeight = 54;
        ratingLabel.setPosition(0, progressY - 72, 0);
        const comboLabel = makeLabel('Combo', parent, '', 24, uiColor(255, 255, 255));
        comboLabel.getComponent(UITransform).setContentSize(Math.min(300, safeW - 80), 34);
        comboLabel.getComponent(Label).lineHeight = 30;
        comboLabel.setPosition(0, progressY - 112, 0);

        const countdownOverlay = makeUiNode('CountdownOverlay', parent);
        countdownOverlay.getComponent(UITransform).setContentSize(w, h);
        countdownOverlay.active = false;
        countdownOverlay.on(Node.EventType.TOUCH_START, () => this.beginDiveHold());
        countdownOverlay.on(Node.EventType.TOUCH_END, () => this.endDiveHold());
        countdownOverlay.on(Node.EventType.TOUCH_CANCEL, () => this.endDiveHold());
        countdownOverlay.on(Node.EventType.MOUSE_DOWN, (event: EventMouse) => {
            if (event.getButton() === EventMouse.BUTTON_LEFT) {
                this.beginDiveHold();
            }
        });
        countdownOverlay.on(Node.EventType.MOUSE_UP, () => this.endDiveHold());
        const countdownLabel = makeLabel('CountdownLabel', countdownOverlay, '3', 96, uiColor(255, 255, 255));
        countdownLabel.getComponent(UITransform).setContentSize(720, 220);
        countdownLabel.getComponent(Label).lineHeight = 140;
        const diveChargeTrack = makeRect('DiveChargeTrack', countdownOverlay, 16, 220, uiColor(28, 18, 6, 225));
        diveChargeTrack.setPosition(speedTrackX, 0, 0);
        const diveChargeFill = makeUiNode('DiveChargeFill', countdownOverlay);
        diveChargeFill.getComponent(UITransform).setContentSize(12, 216);
        diveChargeFill.addComponent(Graphics);
        diveChargeFill.setPosition(speedTrackX, 0, 0);
        diveChargeTrack.active = false;
        diveChargeFill.active = false;
        const diveTouchArea = makeTouchArea('DiveTouchArea', countdownOverlay, w, h);
        diveTouchArea.on(Node.EventType.TOUCH_START, () => this.beginDiveHold());
        diveTouchArea.on(Node.EventType.TOUCH_END, () => this.endDiveHold());
        diveTouchArea.on(Node.EventType.TOUCH_CANCEL, () => this.endDiveHold());
        diveTouchArea.on(Node.EventType.MOUSE_DOWN, (event: EventMouse) => {
            if (event.getButton() === EventMouse.BUTTON_LEFT) {
                this.beginDiveHold();
            }
        });
        diveTouchArea.on(Node.EventType.MOUSE_UP, () => this.endDiveHold());

        const resultPanel = makeUiNode('ResultPanel', parent);
        resultPanel.active = false;
        makeRect('ResultBg', resultPanel, 540, 500, uiColor(8, 22, 34, 242));
        const resultTitle = makeLabel('ResultTitle', resultPanel, 'RESULTS', 38, uiColor(255, 224, 89));
        resultTitle.setPosition(0, 206, 0);
        const resultTime = makeLabel('ResultTime', resultPanel, '', 17, uiColor(215, 235, 245));
        resultTime.getComponent(UITransform).setContentSize(500, 36);
        resultTime.setPosition(0, 168, 0);
        const resultRows: Label[] = [];
        const resultRowBacks: Node[] = [];
        for (let i = 0; i < 8; i++) {
            const rowBack = makeRect(`ResultRowBack${i}`, resultPanel, 472, 34, uiColor(255, 255, 255, 0));
            rowBack.setPosition(0, 128 - i * 39, 0);
            const row = makeLabel(`ResultRow${i}`, resultPanel, '', 18, uiColor(236, 246, 252));
            row.getComponent(UITransform).setContentSize(454, 34);
            row.getComponent(Label).lineHeight = 26;
            row.setPosition(0, 128 - i * 39, 0);
            resultRowBacks.push(rowBack);
            resultRows.push(row.getComponent(Label));
        }
        const restart = makeButton('RestartButton', resultPanel, 178, 44, uiColor(38, 116, 190), 'RACE AGAIN');
        restart.setPosition(-98, -216, 0);
        restart.on(Node.EventType.TOUCH_END, () => this._callbacks.onRestart());
        const menu = makeButton('MenuButton', resultPanel, 150, 44, uiColor(232, 68, 72), 'MENU');
        menu.setPosition(104, -216, 0);
        menu.on(Node.EventType.TOUCH_END, () => this._callbacks.onMenu());

        const ui = makeUiNode('UIController', parent).addComponent(UIController);
        ui.timerLabel = timerLabel.getComponent(Label);
        ui.placementLabel = placementLabel.getComponent(Label);
        ui.distanceLabel = progressLabel.getComponent(Label);
        ui.progressDot = progressDot;
        ui.progressTrackWidth = progressTrackWidth;
        ui.speedBarRoot = speedBarRoot;
        ui.speedLabel = speedLabel.getComponent(Label);
        ui.telemetryLabel = telemetryLabel.getComponent(Label);
        ui.countdownOverlay = countdownOverlay;
        ui.countdownLabel = countdownLabel.getComponent(Label);
        ui.diveChargeTrack = diveChargeTrack;
        ui.diveChargeFill = diveChargeFill.getComponent(Graphics);
        ui.resultPanel = resultPanel;
        ui.resultTitle = resultTitle.getComponent(Label);
        ui.resultTime = resultTime.getComponent(Label);
        ui.resultRows = resultRows;
        ui.resultRowBacks = resultRowBacks;
        ui.ratingLabel = ratingLabel.getComponent(Label);
        ui.comboLabel = comboLabel.getComponent(Label);

        return {
            uiController: ui,
            timingGuideFill: speedFillNode.getComponent(Graphics),
            timingGuideMarker: timingMarker,
        };
    }

    private beginDiveHold() {
        if (this._diveHoldStartedAt > 0) {
            return;
        }
        this._diveHoldStartedAt = Date.now() / 1000;
        this._callbacks.onDiveHoldStart();
    }

    private endDiveHold() {
        if (this._diveHoldStartedAt <= 0) {
            return;
        }
        const holdSeconds = Math.max(0, Date.now() / 1000 - this._diveHoldStartedAt);
        this._diveHoldStartedAt = 0;
        this._callbacks.onDiveHoldEnd(holdSeconds);
    }

    private beginStrokeHold() {
        this.beginDiveHold();
        this._callbacks.onStroke();
    }

    private endStrokeHold() {
        this._callbacks.onStrokeEnd();
        this.endDiveHold();
    }
}

function visibleUiWidth(designW: number, designH: number): number {
    const frame = view.getFrameSize();
    const frameAspect = frame.height > 0 ? frame.width / frame.height : designW / Math.max(1, designH);
    const widthFromHeight = designH * frameAspect;
    return Math.max(320, Math.min(designW, widthFromHeight || designW));
}

function visibleUiHeight(designW: number, designH: number): number {
    const frame = view.getFrameSize();
    const frameAspect = frame.height > 0 ? frame.width / frame.height : designW / Math.max(1, designH);
    const heightFromWidth = frameAspect > 0 ? designW / frameAspect : designH;
    return Math.max(480, Math.min(designH, heightFromWidth || designH));
}
