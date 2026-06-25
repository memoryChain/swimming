import { Node } from 'cc';
import { Rating } from '../core/GameConstants';
import { RaceResultStats, UIController } from './UIController';

export type UIFlowRefs = {
    raceHud: Node | null;
    modelDebugHud: Node | null;
    uiController: UIController | null;
    drawSpeedBar: (ratio: number) => void;
};

export class UIFlowController {
    constructor(private readonly _refs: UIFlowRefs) {}

    showRaceHud() {
        setActive(this._refs.modelDebugHud, false);
        setActive(this._refs.raceHud, true);
        this._refs.uiController?.resetAll();
        this.resetSpeedBar();
    }

    showModelDebugHud() {
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

    updateConditionReadout(heartRate: number, zone: string, energy: number) {
        this._refs.uiController?.updateConditionReadout(heartRate, zone, energy);
    }

    updateHeartRateBar(heartRate: number, zone: string) {
        this._refs.uiController?.updateHeartRateBar(heartRate, zone);
    }

    setHeartRateBarVisible(visible: boolean) {
        this._refs.uiController?.setHeartRateBarVisible(visible);
    }

    updateEnergyBar(energy: number, depleted: boolean) {
        this._refs.uiController?.updateEnergyBar(energy, depleted);
    }

    setEnergyBarVisible(visible: boolean) {
        this._refs.uiController?.setEnergyBarVisible(visible);
    }

    updateTimer(time: number) {
        this._refs.uiController?.updateTimer(time);
    }

    updateProgress(playerDistance: number, aiDistance: number) {
        this._refs.uiController?.updateProgress(playerDistance, aiDistance);
    }

    updatePlacement(placement: number, racerCount: number) {
        this._refs.uiController?.updatePlacement(placement, racerCount);
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
