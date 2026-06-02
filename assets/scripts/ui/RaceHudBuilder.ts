import { EventMouse, Graphics, Label, Node, UITransform } from 'cc';
import { StrokeType } from '../core/GameConstants';
import { UIController } from './UIController';
import { makeButton, makeLabel, makeLeftRect, makeRect, makeTouchArea, makeUiNode, uiColor } from './RuntimeUiFactory';

export type RaceHudCallbacks = {
    onStroke: (type: StrokeType) => void;
    onRestart: () => void;
    onMenu: () => void;
};

export type RaceHudRefs = {
    uiController: UIController;
    speedFill: Graphics;
};

export class RaceHudBuilder {
    constructor(private readonly _callbacks: RaceHudCallbacks) {}

    build(parent: Node, w: number, h: number): RaceHudRefs {
        const leftPad = makeTouchArea('LeftInput', parent, w / 2, h);
        leftPad.setPosition(-w / 4, 0, 0);
        leftPad.on(Node.EventType.TOUCH_START, () => this._callbacks.onStroke(StrokeType.LEG));
        leftPad.on(Node.EventType.MOUSE_DOWN, (event: EventMouse) => {
            if (event.getButton() === EventMouse.BUTTON_LEFT) {
                this._callbacks.onStroke(StrokeType.LEG);
            }
        });
        const rightPad = makeTouchArea('RightInput', parent, w / 2, h);
        rightPad.setPosition(w / 4, 0, 0);
        rightPad.on(Node.EventType.TOUCH_START, () => this._callbacks.onStroke(StrokeType.ARM));
        rightPad.on(Node.EventType.MOUSE_DOWN, (event: EventMouse) => {
            if (event.getButton() === EventMouse.BUTTON_LEFT || event.getButton() === EventMouse.BUTTON_RIGHT) {
                this._callbacks.onStroke(StrokeType.ARM);
            }
        });

        makeRect('TopBar', parent, w, 82, uiColor(6, 18, 30, 190)).setPosition(0, h / 2 - 41, 0);
        makeLabel('Title', parent, 'SPEED SWIMMING 3D', 24, uiColor(255, 255, 255)).setPosition(-w / 2 + 188, h / 2 - 38, 0);
        const timerLabel = makeLabel('Timer', parent, '0:00.00', 30, uiColor(255, 255, 255));
        timerLabel.setPosition(w / 2 - 118, h / 2 - 38, 0);
        const hintLabel = makeLabel('Hint', parent, 'Dive: hold A+D during countdown, release after GO', 18, uiColor(190, 236, 255));
        hintLabel.setPosition(0, h / 2 - 38, 0);

        makeLabel('SpeedText', parent, 'PACE', 16, uiColor(210, 240, 250)).setPosition(-168, h / 2 - 92, 0);
        makeRect('SpeedTrack', parent, 240, 12, uiColor(5, 18, 30, 210)).setPosition(0, h / 2 - 92, 0);
        const speedFillNode = makeLeftRect('SpeedFill', parent, 240, 10, uiColor(89, 234, 160));
        speedFillNode.setPosition(-120, h / 2 - 92, 0);
        const speedLabel = makeLabel('SpeedValue', parent, '0.00 m/s  0%', 16, uiColor(255, 255, 255));
        speedLabel.getComponent(UITransform).setContentSize(180, 26);
        speedLabel.setPosition(164, h / 2 - 92, 0);

        const ratingLabel = makeLabel('Rating', parent, '', 34, uiColor(255, 255, 255));
        ratingLabel.setPosition(0, h / 2 - 142, 0);
        const comboLabel = makeLabel('Combo', parent, '', 20, uiColor(255, 255, 255));
        comboLabel.setPosition(0, h / 2 - 176, 0);

        const countdownOverlay = makeUiNode('CountdownOverlay', parent);
        countdownOverlay.active = false;
        makeRect('CountdownShade', countdownOverlay, w, h, uiColor(0, 0, 0, 70));
        const countdownLabel = makeLabel('CountdownLabel', countdownOverlay, '3', 96, uiColor(255, 255, 255));
        countdownLabel.getComponent(UITransform).setContentSize(720, 220);
        countdownLabel.getComponent(Label).lineHeight = 140;

        const resultPanel = makeUiNode('ResultPanel', parent);
        resultPanel.active = false;
        makeRect('ResultBg', resultPanel, 500, 236, uiColor(8, 22, 34, 240));
        const resultTitle = makeLabel('ResultTitle', resultPanel, 'YOU WIN', 42, uiColor(255, 224, 89));
        resultTitle.setPosition(0, 64, 0);
        const resultTime = makeLabel('ResultTime', resultPanel, '', 20, uiColor(255, 255, 255));
        resultTime.setPosition(0, 12, 0);
        const restart = makeButton('RestartButton', resultPanel, 178, 44, uiColor(38, 116, 190), 'RACE AGAIN');
        restart.setPosition(-98, -70, 0);
        restart.on(Node.EventType.TOUCH_END, () => this._callbacks.onRestart());
        const menu = makeButton('MenuButton', resultPanel, 150, 44, uiColor(232, 68, 72), 'MENU');
        menu.setPosition(104, -70, 0);
        menu.on(Node.EventType.TOUCH_END, () => this._callbacks.onMenu());

        const ui = makeUiNode('UIController', parent).addComponent(UIController);
        ui.timerLabel = timerLabel.getComponent(Label);
        ui.speedLabel = speedLabel.getComponent(Label);
        ui.hintLabel = hintLabel.getComponent(Label);
        ui.countdownOverlay = countdownOverlay;
        ui.countdownLabel = countdownLabel.getComponent(Label);
        ui.resultPanel = resultPanel;
        ui.resultTitle = resultTitle.getComponent(Label);
        ui.resultTime = resultTime.getComponent(Label);
        ui.ratingLabel = ratingLabel.getComponent(Label);
        ui.comboLabel = comboLabel.getComponent(Label);

        return {
            uiController: ui,
            speedFill: speedFillNode.getComponent(Graphics),
        };
    }
}
