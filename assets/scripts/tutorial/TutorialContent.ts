import type { LessonStep } from './TutorialLesson';

export const LESSON_COPY: Record<LessonStep, [string, string]> = {
    diveInfo: ['按住蓄力，松手起跳', '按住屏幕，右侧蓄力条会往上走。\n快满时松手，就能跳进泳池。'],
    dive: ['', '按住屏幕，蓄力条快满时松手'],
    flight: ["已经入水了", "先顺势滑行，浮出水面后再划水。"],
    leftInfo: ["划水：按住 → 看白点 → 松手", "从左半屏开始。白点走进亮色区域时松手。\n划完就换右边，两只手轮流来。"],
    left: ["轮到左边", "按住左半屏，白点进亮色区域就松手。"],
    rightInfo: ["现在换右边", "右半屏也一样：按住，等白点到了，再松手。\n接下来左、右轮流，共练三轮。"],
    right: ["轮到右边", "按住右半屏，白点进亮色区域就松手。"],
    alternateInfo: ["把左右连成节奏", "这次按正常速度，左右交替划六下。\n每次松手后换边，不用追求越快越好。"],
    alternate: ["左一下，右一下", "白点到了再松手，划完换另一边。"],
    kickInfo: ["轻点就能踢水", "轻点屏幕后马上松开，左右轮流试四下。\n踢水不用等白点，也不消耗体力。"],
    kick: ["轻点 → 马上松手", "左右轮流，不要按住。"],
    staminaEmptyInfo: ['划水变慢，是因为体力用光了', '闪电表示体力，划水和海豚跳会消耗它。\n还能继续游；轻点踢水能前进，但不会补回体力。'],
    staminaEmpty: ['', ''],
    heart: ['心率越高，亮区越窄', '爱心显示心率，心率越高，划水亮区越窄。\n接下来左右轮流划，白点进亮区时松手。'],
    heartLow: ['', '轻松：亮区宽'],
    heartWork: ['', '黄色：亮区变窄'],
    heartHigh: ['', '橙色：松手要更准'],
    heartMax: ['', '红色：亮区最窄'],
    rest: ['', '左右轻点踢水，让心率降下来'],
    heartRecovery: ['', '心率降了：亮区变宽'],
    turnInfo: ['游到对面去', '用刚学会的划水和踢水，游向前面的池壁。\n到池边会自动转身，不用另按按钮。'],
    turn: ['继续向前游', '碰到池壁后，我们掉头游回来。'],
    dolphinInfo: ['满气后，点击海豚跳起来', '划水攒气，圆环满了点海豚。\n落水后可以继续划水攒气。'],
    dolphinApproach: ['', ''],
    finalApproach: ['', ''],
    staminaRun: ['', ''],
    dolphinCharge: ['', '继续划水，把圆环攒满'],
    dolphin: ['', '圆环满了，点海豚！'],
    dolphinFlight: ['', ''],
    practice: ['', '落水后继续划水攒气'],
    finish: ['', ''],
    finishTouch: ['', ''],
    complete: ['200 米，完成！', '准备好正式开游了。'],
};

// 掉帧越过末段检查点时仍完成体力说明；没有实际耗尽就不声称已经变慢。
export const STAMINA_REMAINING_COPY: [string, string] = ['闪电显示你的体力',
    '划水和海豚跳会消耗体力，用光后划水会变慢。\n轻点踢水还能前进，但不会补回体力。'];

/** 五个学习目标；泳程负责安排空间，章节让玩家知道自己正在学什么。 */
export function lessonChapter(step: LessonStep): string {
    if (step === 'diveInfo' || step === 'dive' || step === 'flight') return '1 / 5  ·  起跳入水';
    if (step.startsWith('heart') || step.startsWith('rest') || step === 'dolphinApproach') return '3 / 5  ·  掌握心率';
    if (step.startsWith('dolphin') || step.startsWith('practice') || step === 'finalApproach') return '4 / 5  ·  学会海豚跳';
    if (step.startsWith('stamina') || step.startsWith('finish') || step === 'complete') return '5 / 5  ·  分配体力，游到终点';
    return '2 / 5  ·  左右划水与踢水';
}

/** 基础操作之后只在 HUD 旁提示，把泳道中央留给游泳动作。 */
export function lessonUsesHudHint(step: LessonStep): boolean {
    return step === 'diveInfo' || step === 'dive' || step.startsWith('heart') || step.startsWith('rest') || step.startsWith('dolphin')
        || step.startsWith('practice') || step.startsWith('stamina') || step.startsWith('finish') || step === 'finalApproach';
}

export function staminaExperienceHint(count: number, right: boolean): string {
    if (count >= 2) return '';
    return count === 1 ? right ? '换到右边，再感受一下' : '换到左边，再感受一下'
        : right ? '手臂变慢了，试着划右边' : '手臂变慢了，试着划左边';
}

/** 操作侧与体验进度分开表达，避免把左右轮流误读成每侧都要完成一组。 */
export function heartPracticeHint(step: LessonStep, count: number, targetCount: number, right: boolean): string {
    if (step === 'rest') {
        if (count >= targetCount) return '继续左右轻点踢水，等心率降下来';
        return `踢水降心率 · 已踢 ${count}/${targetCount} 次\n${right ? '轻点右半屏后松手' : '轻点左半屏后松手'}`;
    }
    const operation = count >= targetCount ? '这组体验完成'
        : right ? '按住右半屏，白点进亮区时松手' : '按住左半屏，白点进亮区时松手';
    return `${LESSON_COPY[step][1]} · 已体验 ${count}/${targetCount} 次\n${operation}`;
}
