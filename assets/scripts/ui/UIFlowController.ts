import { Node } from 'cc';
import { Rating } from '../core/GameConstants';
import { RaceResultStats, UIController } from './UIController';

export type UIFlowRefs = {
    startScreen: Node | null;
    raceHud: Node | null;
    modelDebugHud: Node | null;
    uiController: UIController | null;
    drawSpeedBar: (ratio: number) => void;
};

export class UIFlowController {
    constructor(private readonly _refs: UIFlowRefs) {}

    showStartScreen() {
        setActive(this._refs.raceHud, false);
        setActive(this._refs.modelDebugHud, false);
        setActive(this._refs.startScreen, true);
    }

    showRaceHud() {
        setActive(this._refs.startScreen, false);
        setActive(this._refs.modelDebugHud, false);
        setActive(this._refs.raceHud, true);
        this._refs.uiController?.resetAll();
        this.resetSpeedBar();
    }

    showModelDebugHud() {
        setActive(this._refs.startScreen, false);
        setActive(this._refs.raceHud, false);
        setActive(this._refs.modelDebugHud, true);
    }

    hideModelDebugHud() {
        setActive(this._refs.modelDebugHud, false);
    }

    resetSpeedBar() {
        this._refs.drawSpeedBar(0);
    }

    updateSpeed(speed: number) {
        this._refs.uiController?.updateSpeed(speed);
    }

    updateSwimTelemetry(stability: number, acceleration: number, speed: number) {
        this._refs.uiController?.updateSwimTelemetry(stability, acceleration, speed);
    }

    updateTimer(time: number) {
        this._refs.uiController?.updateTimer(time);
    }

    updateProgress(playerDistance: number, aiDistance: number) {
        this._refs.uiController?.updateProgress(playerDistance, aiDistance);
    }

    showRating(rating: Rating, combo: number) {
        this._refs.uiController?.showRating(rating, combo);
    }

    showCountdown(value: number) {
        this._refs.uiController?.showCountdown(value);
    }

    hideCountdown() {
        this._refs.uiController?.hideCountdown();
    }

    showDivePrompt() {
        this._refs.uiController?.showDivePrompt();
    }

    showDiveCharging() {
        this._refs.uiController?.showDiveCharging();
    }

    showDiveRelease(power: number) {
        this._refs.uiController?.showDiveRelease(power);
    }

    updateDiveCharge(power: number, visible: boolean) {
        this._refs.uiController?.updateDiveCharge(power, visible);
    }

    showGliding() {
        this._refs.uiController?.showGliding();
    }

    showResult(isWin: boolean, playerTime: number, aiTime: number, stats?: RaceResultStats) {
        this._refs.uiController?.showResult(isWin, playerTime, aiTime, stats);
    }
}

function setActive(node: Node | null, active: boolean) {
    if (node) {
        node.active = active;
    }
}
