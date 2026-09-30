import { director, Node } from 'cc';
import { PlayerData } from '../backend/PlayerData';
import { PlayerConditionModel } from '../condition/PlayerConditionModel';
import { GameState, Rating, StrokeType } from '../core/GameConstants';
import { RhythmResult } from '../core/RhythmTypes';
import { RaceManager } from '../core/RaceManager';
import { setTimeScale } from '../core/TimeScale';
import { Swimmer } from '../entity/Swimmer';
import { TutorialLesson, LessonStep } from './TutorialLesson';
import { LESSON_COPY, lessonChapter, lessonUsesHudHint, staminaExperienceHint, heartPracticeHint } from './TutorialContent';
import { TutorialOverlay } from './TutorialOverlay';
import { TUTORIAL_RUNTIME, TUTORIAL_DISTANCE, TUTORIAL_EXHAUST_DISTANCE } from './TutorialSession';

const HEART_PRESETS: Partial<Record<LessonStep, number>> = {
    heart: 90, heartWork: 120, heartHigh: 150, heartMax: 170,
};
const CUES = {
    idle: '按住屏幕试试', hold: '继续按住……', release: '就是现在，松手！',
    late: '错过啦，松手再试', retry: '松早了，等白点进入亮色区域再松手',
    retryLate: '松晚了，下次白点一进亮色区域就松手',
    left: '轮到左边：按住左半屏', right: '轮到右边：按住右半屏',
    success: '划得不错！',
};
type GestureCue = keyof typeof CUES;

export class TutorialRaceController {
    readonly lesson = new TutorialLesson();
    private readonly view: TutorialOverlay;
    private shown: LessonStep | null = null;
    private shownCount = -1;
    private shownSuccess = false;
    private shownExhaustReady = false;
    private shownAwaitingStroke = false;
    private waitingForStaminaStroke = false;
    private shownCue = '';
    private scale = -1;
    private pressed: StrokeType | null = null;
    private lastStrokeSide: StrokeType | null = null;
    private crossedPerfect = false;
    private cue: GestureCue = 'idle';
    private saving = false;
    private disposed = false;
    private returnBlocked = false;
    private readonly continueLesson = () => {
        const jumpReady = this.lesson.step === 'dolphinInfo' && this.lesson.firstTurnCompleted
            && this.swimmer.ultimate.canAffordDolphin;
        this.lesson.advance();
        // 保留前半程攒下的气，满气时直接让玩家操作，省去重复讲解与空攒。
        if (jumpReady) this.lesson.step = 'dolphin';
        this.refresh();
    };
    constructor(private readonly canvas: Node, private readonly swimmer: Swimmer, private readonly race: RaceManager,
        private readonly resetInput: () => void, private readonly leave: () => void,
        private readonly condition?: PlayerConditionModel, private readonly refreshHud?: () => void) {
        this.view = new TutorialOverlay(canvas);
        try { this.refresh(); }
        catch (error) { this.view.dispose(); throw error; }
        // 教学统一基础能力，避免无限体力或禁用海豚跳的角色无法体验完整课程。
        this.swimmer.motor.setCharacterAbility('none');
        this.condition?.setInfiniteStamina(false);
        this.condition?.setTutorialEnergyCourse(TUTORIAL_EXHAUST_DISTANCE);
        this.swimmer.onObservedRhythmResult = (result: RhythmResult) => {
            this.lastStrokeSide = result.strokeSide;
            const accepted = this.lesson.stroke(result.strokeSide, result.rating);
            if (accepted && this.lesson.step === 'dolphinCharge') this.swimmer.ultimate.grantTutorialCharge();
            if (this.strokePractice) {
                if (this.slowStroke) this.cue = result.rating !== Rating.BAD ? 'success'
                    : this.crossedPerfect || result.badReason === 'timeout' || result.badReason?.startsWith('released_late')
                        ? 'retryLate' : 'retry';
                this.pressed = null;
                this.applyTimeScale(this.paused ? 0 : 1);
            }
        };
        this.race.tutorialMode = true;
    }
    // 只有最初跟练显示逐划口令；后续直接体验真实 HUD 和正常比赛速度。
    private get slowStroke(): boolean { return this.lesson.guidedStroke; }
    private get strokePractice(): boolean { return !this.lesson.paused && this.lesson.allowsArmStroke
        && (this.lesson.targetCount > 0 || this.lesson.freeSwim || this.lesson.step === 'dolphinCharge'); }
    get paused(): boolean { return this.returnBlocked || this.lesson.paused || this.waitingForStaminaStroke; }
    // 此类暂停只运行长按分类；真实手臂划水开始后才恢复整场模拟。
    get awaitingStrokeInput(): boolean { return this.waitingForStaminaStroke && !this.returnBlocked && !this.disposed; }
    armStrokeStarted(): void {
        if (!this.awaitingStrokeInput) return;
        this.waitingForStaminaStroke = false;
        TUTORIAL_RUNTIME.paused = this.paused;
        this.updateCueAndTime();
    }
    allowsStroke(side: StrokeType): boolean { return !this.returnBlocked && !this.saving && this.lesson.allowsStroke(side); }
    requestStroke(side: StrokeType): boolean {
        const allowed = this.allowsStroke(side);
        if (!allowed && (this.paused || this.lesson.showingSuccess || this.saving)) return false;
        const expected = this.lesson.expectedSide;
        if (expected !== null && side !== expected) {
            if (this.slowStroke) {
                this.cue = expected === StrokeType.LEFT ? 'left' : 'right';
                this.updateCueAndTime();
            }
            return false;
        }
        return allowed;
    }
    allowsArmStroke(side: StrokeType): boolean { return this.lesson.allowsArmStroke && this.allowsStroke(side); }
    get allowsDive(): boolean { return !this.returnBlocked && this.lesson.step === 'dive'; }
    get allowsDolphin(): boolean { return !this.returnBlocked && !this.saving && this.lesson.firstTurnCompleted && (this.lesson.step === 'dolphin' || this.lesson.step === 'finish'); }
    pressChanged(side: StrokeType, pressed: boolean): void {
        if (!this.strokePractice) {
            if (pressed && !this.lesson.allowsArmStroke) this.updateCueAndTime();
            return;
        }
        if (pressed && this.allowsStroke(side)) { this.pressed = side; this.crossedPerfect = false; this.cue = 'hold'; }
        else if (!pressed && this.pressed === side) { this.pressed = null; this.applyTimeScale(this.paused ? 0 : 1); }
    }
    kick(side: StrokeType): void {
        this.lesson.kick(side);
        if (this.strokePractice && this.lesson.targetCount > 0) this.cue = 'retry';
        this.refresh();
    }
    update(dt: number, state: GameState): void {
        if (this.returnBlocked || this.disposed) return;
        if (state === GameState.RACING) this.lesson.observeCourse(this.swimmer.distance, this.swimmer.courseLayout.courseLength,
            this.swimmer.isFlipTurning, this.swimmer.isUnderwater);
        if (!this.paused && this.lesson.step !== 'rest') this.condition?.advanceTutorialEnergyCourse(this.swimmer.distance);
        if (!this.waitingForStaminaStroke && this.lesson.step === 'staminaRun'
            && this.swimmer.distance >= TUTORIAL_EXHAUST_DISTANCE && this.condition && !this.condition.energyDepleted
            && this.pressed === null && !this.swimmer.motor.isArmStrokeActive
            && !this.swimmer.isFlipTurning && !this.swimmer.isUnderwater) {
            this.resetInput();
            this.waitingForStaminaStroke = true;
        }
        if (this.lesson.step === 'staminaRun' && this.swimmer.distance >= TUTORIAL_EXHAUST_DISTANCE
            && this.condition?.energyDepleted && this.pressed === null && !this.swimmer.motor.isArmStrokeActive
            && !this.swimmer.isFlipTurning && !this.swimmer.isUnderwater) {
            this.lesson.beginStaminaExperience(this.lastStrokeSide);
        }
        const strokeSettled = this.lesson.step !== 'staminaEmpty' || this.pressed === null
            && !this.swimmer.motor.isArmStrokeActive && !this.swimmer.isFlipTurning && !this.swimmer.isUnderwater;
        this.lesson.tick(dt, state, this.swimmer.isUnderwater, this.swimmer.heartRate, strokeSettled, this.swimmer.distance);
        if (this.lesson.step === 'dolphinCharge' || this.lesson.step === 'dolphin' || this.lesson.step === 'dolphinFlight') {
            this.lesson.observeDolphin(this.swimmer.ultimate.canAffordDolphin,
                this.swimmer.isDolphinJumpActive, this.swimmer.isUnderwater, this.swimmer.isFlipTurning);
        }
        if (this.lesson.step === 'finish' && this.swimmer.distance >= TUTORIAL_RUNTIME.finishDistance) {
            this.swimmer.playFinishTouch();
            this.lesson.touchFinish();
        }
        this.refresh();
        this.updateCueAndTime();
    }
    private applyTimeScale(value: number): void {
        if (this.scale === value) return;
        this.scale = value;
        setTimeScale(value);
        director.getScheduler().setTimeScale(value);
    }
    private updateCueAndTime(): void {
        let value = this.paused ? 0 : 1;
        let text = '';
        if (this.slowStroke && !this.paused) {
            if (this.pressed !== null) {
                const perfect = this.swimmer.motor.isActiveStrokeInPerfectZone(this.pressed);
                if (perfect) this.crossedPerfect = true;
                this.cue = perfect ? 'release' : this.crossedPerfect ? 'late' : 'hold';
                value = perfect ? 0.12 : 0.25;
            }
            text = CUES[this.cue];
            if (this.pressed === null && (this.cue === 'idle' || this.cue === 'success')) {
                text = CUES[this.lesson.expectedSide === StrokeType.RIGHT ? 'right' : 'left'];
            }
        }
        if (text !== this.shownCue) { this.shownCue = text; this.view.setCue(text); }
        this.applyTimeScale(value);
    }
    private enterStep(step: LessonStep): void {
        if (step !== 'staminaRun') this.waitingForStaminaStroke = false;
        this.resetInput();
        this.swimmer.motor.cancelTutorialStrokeInput();
        this.swimmer.cartoonRig?.setStrokeHeld(StrokeType.LEFT, false);
        this.swimmer.cartoonRig?.setStrokeHeld(StrokeType.RIGHT, false);
        this.pressed = null; this.crossedPerfect = false; this.cue = 'idle';
        const heart = HEART_PRESETS[step];
        if (heart !== undefined) this.swimmer.motor.setTutorialHeartRate(heart);
        TUTORIAL_RUNTIME.finishDistance = TUTORIAL_DISTANCE;
        TUTORIAL_RUNTIME.progressLimit = this.lesson.progressLimit;
        if (step === 'rest' || step === 'practice' || step === 'finish') this.swimmer.motor.setTutorialHeartRate(null);
        // 注入档位后先提交真实 HUD 和动作倍率，避免暂停后仍显示上一档。
        this.refreshHud?.();
    }
    private refresh(): void {
        const step = this.lesson.step;
        const exhaustReady = step === 'staminaRun' && this.swimmer.distance >= TUTORIAL_EXHAUST_DISTANCE && !this.condition?.energyDepleted;
        if (this.shown === step && this.shownCount === this.lesson.count && this.shownSuccess === this.lesson.showingSuccess
            && this.shownExhaustReady === exhaustReady && this.shownAwaitingStroke === this.waitingForStaminaStroke) return;
        const changedStep = this.shown !== step;
        if (changedStep) this.enterStep(step);
        const copy = LESSON_COPY[step];
        const hudHint = lessonUsesHudHint(step);
        this.view.setStage(hudHint ? '' : lessonChapter(step));
        const side = this.lesson.expectedSide;
        const heartPractice = this.lesson.heartExperience || step === 'rest';
        const progress = step === 'staminaEmpty' || heartPractice ? '' : hudHint ? this.lesson.targetCount > this.lesson.count
            ? ` · ${side === StrokeType.RIGHT ? '右' : '左'} ${this.lesson.count}/${this.lesson.targetCount}` : ''
            : this.lesson.showingSuccess ? '\n做到了！'
            : this.lesson.guidedStroke ? `\n已完成 ${this.lesson.guidedStrokeCount} / 6`
            : this.lesson.targetCount > 0 ? `\n已完成 ${this.lesson.count} / ${this.lesson.targetCount}` : '';
        let target: Node | null = null;
        if (step.startsWith('stamina')) target = findTutorialNode(director.getScene(), 'EnergyBase');
        else if (step.startsWith('heart') || step.startsWith('rest')) target = findTutorialNode(director.getScene(), 'HeartBase');
        else if ((step.startsWith('dolphin') && step !== 'dolphinApproach') || step === 'practice') target = findTutorialNode(director.getScene(), 'DolphinJumpButton');
        else if (step === 'diveInfo' || step === 'dive') target = findTutorialNode(director.getScene(), 'charge-track')
            ?? findTutorialNode(director.getScene(), 'DiveChargeTrack');
        else {
            const side = this.lesson.expectedSide;
            if (side !== null) target = findTutorialNode(findTutorialNode(director.getScene(),
                side === StrokeType.LEFT ? 'LeftStrokeUi' : 'RightStrokeUi'), 'Arc');
        }
        const body = heartPractice ? heartPracticeHint(step, this.lesson.count, this.lesson.targetCount, side === StrokeType.RIGHT)
            : step === 'staminaEmpty' ? staminaExperienceHint(this.lesson.count, side === StrokeType.RIGHT)
            : exhaustReady ? '试一次划水，看看闪电' : copy[1] + progress;
        this.view.show(copy[0], body, this.lesson.paused,
            step === 'complete' ? '回大厅，开游！' : step === 'diveInfo' ? '我来试试'
                : step === 'staminaEmptyInfo' ? '游到终点' : step === 'turnInfo' ? '出发' : this.lesson.paused ? '试试看' : '',
            step === 'complete' ? () => { void this.save(); } : this.continueLesson, target, false, hudHint);
        // 确认界面可见后才暂停，不让不可见面板冻结比赛。
        TUTORIAL_RUNTIME.paused = this.paused;
        this.shown = step; this.shownCount = this.lesson.count; this.shownSuccess = this.lesson.showingSuccess;
        this.shownExhaustReady = exhaustReady;
        this.shownAwaitingStroke = this.waitingForStaminaStroke;
        this.updateCueAndTime();
    }
    private async save(): Promise<void> {
        if (this.saving || this.disposed) return;
        this.saving = true;
        this.view.show('马上就好', '正在记下你的进度……', true, '', null);
        try {
            await PlayerData.completeTutorial();
            if (!this.disposed) this.leave();
        } catch (error) {
            if (!this.disposed) this.view.show('还差最后一步',
                '刚才没能保存进度，点一下再试试。', true,
                '重试保存', () => { void this.save(); });
        } finally { this.saving = false; }
    }
    returnFailed(): void {
        this.returnBlocked = true;
        this.scale = -1;
        TUTORIAL_RUNTIME.paused = true;
        this.applyTimeScale(0);
        this.view.show('暂时无法返回大厅', '点一下，再试试。', true, '重试返回', this.leave);
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.waitingForStaminaStroke = false;
        this.swimmer.onObservedRhythmResult = null;
        this.swimmer.motor.setTutorialHeartRate(null);
        this.view.dispose();
        this.condition?.setTutorialEnergyCourse(null);
        TUTORIAL_RUNTIME.progressLimit = TUTORIAL_DISTANCE;
        TUTORIAL_RUNTIME.paused = false;
        TUTORIAL_RUNTIME.active = false;
        TUTORIAL_RUNTIME.finishDistance = 0;
        this.applyTimeScale(1);
    }
}

export function findTutorialNode(root: Node | null, name: string, includeInactive = false): Node | null {
    if (!root || (!includeInactive && !root.activeInHierarchy)) return null;
    if (root.name === name) return root;
    for (const child of root.children) { const found = findTutorialNode(child, name, includeInactive); if (found) return found; }
    return null;
}
