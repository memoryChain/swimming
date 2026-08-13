import { Node } from 'cc';
import { Rating } from '../core/GameConstants';
import { FlipTurnTimingRating, FlipTurnTimingState } from '../entity/SwimmerRacePhases';
import { RaceResultStats, UIController } from './UIController';

export type ProgressionResult = {
    characterId: string;
    coinsGained: number;
} | null;

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

    // `minimal` (used by the underwater-debug scene, which reuses this HUD but
    // where only the exit button is wired) hides every control except 退出.
    showModelDebugHud(minimal = false) {
        setActive(this._refs.raceHud, false);
        setActive(this._refs.modelDebugHud, true);
        const hud = this._refs.modelDebugHud;
        if (hud) {
            for (const child of hud.children) {
                child.active = minimal ? child.name === 'ModelDebugExit' : true;
            }
        }
    }

    hideModelDebugHud() {
        setActive(this._refs.modelDebugHud, false);
    }

    resetSpeedBar() {
        this._refs.drawSpeedBar(0);
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

    setSprintActive(active: boolean) {
        this._refs.uiController?.setSprintActive(active);
    }

    setEnergyBarVisible(visible: boolean) {
        this._refs.uiController?.setEnergyBarVisible(visible);
    }

    setEnergyTotal(total: number) {
        this._refs.uiController?.setEnergyTotal(total);
    }

    updateUltimateSkillButton(
        energy: number,
        remainingSeconds: number,
        canActivate: boolean,
        inputAllowed: boolean,
        durationSeconds = 0,
        charges = 0,
        pulsesTriggered = 0,
        pulseCount = 0,
    ) {
        this._refs.uiController?.updateUltimateSkillButton(
            energy, remainingSeconds, canActivate, inputAllowed,
            durationSeconds, charges, pulsesTriggered, pulseCount,
        );
    }

    flashUltimateEnergyDenied() {
        this._refs.uiController?.flashUltimateEnergyDenied();
    }

    showUltimateSkillActivated(skillName?: string) {
        this._refs.uiController?.showUltimateSkillActivated(skillName);
    }

    updateProgress(playerDistance: number, aiDistance: number) {
        this._refs.uiController?.updateProgress(playerDistance, aiDistance);
    }

    setRaceStatusVisible(visible: boolean) {
        this._refs.uiController?.setRaceStatusVisible(visible);
    }

    showRating(rating: Rating, combo: number) {
        this._refs.uiController?.showRating(rating, combo);
    }

    updateFlipTurnTiming(state: Readonly<FlipTurnTimingState> | null) {
        this._refs.uiController?.updateFlipTurnTiming(state);
    }

    showFlipTurnTimingResult(rating: FlipTurnTimingRating, launchSpeed: number) {
        this._refs.uiController?.showFlipTurnTimingResult(rating, launchSpeed);
    }

    showCountdown(value: number) {
        this._refs.uiController?.showCountdown(value);
    }

    hideCountdown() {
        this._refs.uiController?.hideCountdown();
    }

    showFinishCountdown(value: number) {
        this._refs.uiController?.showFinishCountdown(value);
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

    showProgressionResult(result: ProgressionResult, onClaimDouble?: () => Promise<boolean>) {
        this._refs.uiController?.showProgressionResult(result, onClaimDouble);
    }
}

function setActive(node: Node | null, active: boolean) {
    if (node && node.active !== active) {
        node.active = active;
    }
}
