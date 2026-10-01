import { TUTORIAL_DISTANCE, TUTORIAL_STAMINA_NOTICE_DISTANCE } from './TutorialSession';
import { GameState, Rating, StrokeType } from '../core/GameConstants';

export type LessonStep = 'diveInfo' | 'dive' | 'flight'
    | 'leftInfo' | 'left' | 'rightInfo' | 'right' | 'alternateInfo' | 'alternate' | 'kickInfo' | 'kick'
    | 'staminaEmptyInfo' | 'staminaEmpty'
    | 'heart' | 'heartLow' | 'heartWork' | 'heartHigh'
    | 'heartMax' | 'rest' | 'heartRecovery' | 'turnInfo' | 'turn' | 'dolphinInfo' | 'dolphinCharge'
    | 'dolphinApproach' | 'finalApproach' | 'staminaRun' | 'dolphin' | 'dolphinFlight' | 'practice' | 'finish' | 'finishTouch' | 'complete';
const NEXT: Partial<Record<LessonStep, LessonStep>> = {
    diveInfo: 'dive', leftInfo: 'left', rightInfo: 'right', alternateInfo: 'alternate',
    kickInfo: 'kick', staminaEmptyInfo: 'finish',
    heart: 'heartLow', turnInfo: 'turn', dolphinInfo: 'dolphinCharge',
};
const MODALS: LessonStep[] = ['diveInfo', 'leftInfo', 'rightInfo', 'alternateInfo', 'kickInfo',
    'staminaEmptyInfo', 'heart', 'turnInfo', 'dolphinInfo', 'complete'];
const EXERCISES: Partial<Record<LessonStep, [number, LessonStep]>> = {
    left: [1, 'rightInfo'], right: [1, 'alternateInfo'], alternate: [6, 'kickInfo'], kick: [4, 'turnInfo'],
    staminaEmpty: [2, 'staminaEmptyInfo'],
    heartLow: [4, 'heartWork'], heartWork: [4, 'heartHigh'],
    heartHigh: [4, 'heartMax'], heartMax: [4, 'rest'], heartRecovery: [4, 'dolphinApproach'], practice: [6, 'finalApproach'],
};

/** 课程只接受真实操作结果；反馈保留片刻，下一次 tick 才切页并清理触摸。 */
export class TutorialLesson {
    step: LessonStep = 'diveInfo';
    count = 0;
    guidedStrokeCount = 0;
    private pending = false;
    private feedbackSeconds = 0;
    private lastSide: StrokeType | null = null;
    private restSeconds = 0;
    private finishSeconds = 0;
    private sawFirstTurn = false;
    firstTurnCompleted = false;
    turning = false;
    submerged = false;
    // 前半程为各课保留泳程；体力课必须真实前进，讲解由控制器暂停整场。
    get progressLimit(): number {
        if (this.step === 'finish' || this.step === 'finishTouch' || this.step === 'complete'
            || this.step.startsWith('stamina') || this.step === 'finalApproach') return TUTORIAL_DISTANCE;
        if (this.step === 'dolphinApproach' || this.step.startsWith('dolphin') || this.step.startsWith('practice')) return 145;
        if (this.step === 'turn' || this.step === 'turnInfo' || this.step.startsWith('heart') || this.step.startsWith('rest')) return 95;
        return 45;
    }
    get freeSwim(): boolean {
        return this.step === 'turn' || this.step === 'dolphinApproach' || this.step === 'finalApproach'
            || this.step === 'staminaRun' || this.step === 'finish' || this.step === 'dolphin';
    }
    get guidedStroke(): boolean { return this.step === 'left' || this.step === 'right'; }
    get targetCount(): number { return this.step === 'rest' ? 4 : EXERCISES[this.step]?.[0] ?? 0; }
    get expectedSide(): StrokeType | null {
        if (this.pending) return null;
        if (this.step === 'left') return StrokeType.LEFT;
        if (this.step === 'right') return StrokeType.RIGHT;
        if (this.targetCount > this.count) return this.lastSide === StrokeType.LEFT ? StrokeType.RIGHT : StrokeType.LEFT;
        return null;
    }
    get allowsArmStroke(): boolean { return this.step !== 'rest' && this.step !== 'kick'; }
    get heartExperience(): boolean { return this.step === 'heartLow' || this.step === 'heartWork'
        || this.step === 'heartHigh' || this.step === 'heartMax' || this.step === 'heartRecovery'; }
    get paused(): boolean { return MODALS.indexOf(this.step) >= 0; }
    get showingSuccess(): boolean { return this.pending; }
    private begin(step: LessonStep): void {
        this.step = step; this.count = 0; this.lastSide = null;
    }
    beginStaminaExperience(lastStrokeSide: StrokeType | null): void {
        if (this.step !== 'staminaRun') return;
        this.begin('staminaEmpty');
        // 延续玩家刚才的左右节奏，耗尽后不用重新从左边开始。
        this.lastSide = lastStrokeSide;
    }
    explainStamina(): void {
        if (this.step !== 'finalApproach' && this.step !== 'staminaRun' && this.step !== 'staminaEmpty') return;
        this.pending = false; this.feedbackSeconds = 0;
        this.begin('staminaEmptyInfo');
    }
    advance(): void {
        const next = NEXT[this.step];
        if (next) this.begin(next);
    }
    allowsStroke(side: StrokeType): boolean {
        if (this.pending) return false;
        return this.step === 'left' ? side === StrokeType.LEFT
            : this.step === 'right' ? side === StrokeType.RIGHT
            : !!EXERCISES[this.step] || this.step === 'dolphinCharge' || this.step === 'rest' || this.freeSwim;
    }
    stroke(side: StrokeType, rating: Rating): boolean {
        if ((!this.heartExperience && this.step !== 'staminaEmpty' && rating === Rating.BAD)
            || !this.allowsStroke(side) || this.step === 'kick') return false;
        if (this.freeSwim || !this.allowsArmStroke) return false;
        // 每次成功后提示换侧；失误保留当前侧重试，不代替玩家自动划水。
        if (this.lastSide === side) return false;
        this.lastSide = side;
        this.count++;
        if (this.guidedStroke) this.guidedStrokeCount++;
        if (this.targetCount > 0 && this.count >= this.targetCount) this.pending = true;
        return true;
    }
    kick(side: StrokeType): void {
        if ((this.step !== 'kick' && this.step !== 'rest') || this.pending || this.lastSide === side) return;
        if (this.step === 'rest' && this.count >= 4) return;
        this.lastSide = side;
        if (++this.count >= 4 && this.step === 'kick') this.pending = true;
    }
    touchFinish(): void { if (this.step === 'finish') this.step = 'finishTouch'; }
    observeCourse(distance: number, length: number, turning: boolean, submerged: boolean): void {
        this.turning = turning; this.submerged = submerged;
        if (!this.firstTurnCompleted) {
            if (turning && distance < length * 2) this.sawFirstTurn = true;
            if (this.sawFirstTurn && !turning && distance >= length) this.firstTurnCompleted = true;
        }
        // 不能在贴壁、转身动作中或水下滑行时用海豚教学打断玩家。
        if (turning || submerged) return;
        if (this.step === 'turn' && this.firstTurnCompleted) this.step = 'heart';
        if (this.step === 'dolphinApproach' && this.firstTurnCompleted && distance >= 100) this.step = 'dolphinInfo';
        if (this.step === 'finalApproach' && distance >= 150) this.step = 'staminaRun';
    }
    observeDolphin(ready: boolean, jumping: boolean, submerged: boolean, turning: boolean): void {
        if (this.firstTurnCompleted && this.step === 'dolphinCharge' && ready && !submerged && !turning) this.begin('dolphin');
        if (this.step === 'dolphin' && jumping) this.begin('dolphinFlight');
        else if (this.step === 'dolphinFlight' && !jumping && !submerged && !turning) this.begin('practice');
    }
    tick(dt: number, state: GameState, underwater: boolean, heartRate = 80, strokeSettled = true, distance = 0): void {
        // 常规等待两划收手；接近终点时用整场暂停兜底，不锁住位移继续播放动作。
        if (this.step === 'staminaEmpty' && distance >= TUTORIAL_STAMINA_NOTICE_DISTANCE) this.explainStamina();
        if (this.step === 'finishTouch') {
            this.finishSeconds += Math.max(0, dt);
            if (this.finishSeconds >= 1.2) this.step = 'complete';
        }
        if (this.pending) {
            this.feedbackSeconds += Math.max(0, dt);
            // 左右跟练的中间划迅速交接；整课完成仍留足成功反馈。
            const wait = this.guidedStroke && this.guidedStrokeCount > 1 && this.guidedStrokeCount < 6 ? 0.25 : 0.8;
            // 耗尽体验要让最后一划完整做完，再解释变慢的原因。
            if (this.feedbackSeconds >= wait && (this.step !== 'staminaEmpty' || strokeSettled)) {
                this.pending = false; this.feedbackSeconds = 0;
                if (this.step === 'left') this.step = this.guidedStrokeCount === 1 ? 'rightInfo' : 'right';
                else if (this.step === 'right') this.step = this.guidedStrokeCount >= 6 ? 'alternateInfo' : 'left';
                else this.step = EXERCISES[this.step]![1];
                if (this.step === 'turnInfo' && this.firstTurnCompleted && !this.turning && !underwater) this.step = 'heart';
                this.lastSide = null;
                this.count = 0;
            }
        }
        if (this.step === 'dive' && (state === GameState.GLIDING || state === GameState.RACING)) this.step = 'flight';
        if (this.step === 'flight' && state === GameState.RACING && !underwater) this.step = 'leftInfo';
        if (this.step === 'rest') {
            this.restSeconds += Math.max(0, dt);
            if (this.restSeconds >= 4 && this.count >= 4 && heartRate <= 100) {
                this.begin('heartRecovery');
            }
        }
    }
}
