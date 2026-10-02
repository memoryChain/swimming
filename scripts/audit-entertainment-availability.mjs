// 排期发生率审计：真实计划和导演，合成领游进度；不修改运行时参数或启动 Creator。
// npx.cmd --yes --package tsx@4.20.5 tsx scripts/audit-entertainment-availability.mjs
import assert from 'node:assert/strict';
import Plan from '../assets/scripts/core/EntertainmentRacePlan.ts';
import Director from '../assets/scripts/core/EntertainmentModeDirector.ts';

const { buildEntertainmentRacePlan, entertainmentScheduleSpeed } = Plan;
const { EntertainmentModeDirector, EntertainmentEventId: E, entertainmentEventName } = Director;
const seedCount = 500;
const eventIds = [E.TURTLE_BUS, E.WHIRLPOOL, E.GEYSER, E.GIANT_WAVE, E.TIMED_BOMB, E.CANNON, E.SHARK];
function replay(seed, distance, grade, speed, spike = false) {
    const plan = buildEntertainmentRacePlan(seed, distance, grade);
    const director = new EntertainmentModeDirector(seed, distance, true, undefined, undefined, undefined, plan);
    const stages = plan.stages.map(stage => ({ ...stage, name: entertainmentEventName(stage.event),
        previewAt: null, activatedAt: null, finishedAt: null }));
    const skips = [], activations = [];
    let lastEnd = null, longestGap = 0;
    for (let frame = 1; frame / 30 * speed < distance; frame++) {
        const time = frame / 30;
        // 一秒提速带来的额外进度保留，局长估计复用正式代码；仍不是完整马达轨迹。
        const progress = time * speed + (spike ? Math.max(0, Math.min(1, time - 12)) * (5 - speed) : 0);
        if (progress >= distance) break;
        const reference = entertainmentScheduleSpeed(progress, time);
        const before = director.snapshot().eventIndex;
        const transition = director.update(1 / 30, progress, true, reference);
        const after = director.snapshot().eventIndex;
        if (transition.previewEvent !== null && stages[after]) stages[after].previewAt = time;
        if (transition.previewEvent !== null && lastEnd !== null) longestGap = Math.max(longestGap, time - lastEnd);
        if (transition.activatedEvent !== null) {
            if (transition.activatedEvent === E.TURTLE_BUS && lastEnd !== null) {
                longestGap = Math.max(longestGap, time - lastEnd);
            }
            activations.push({ event: transition.activatedEvent, index: after, time,
                required: stages[after]?.required ?? false });
            if (stages[after]) {
                stages[after].activatedAt = time;
                stages[after].event = transition.activatedEvent;
                stages[after].name = entertainmentEventName(transition.activatedEvent);
            }
        }
        if (transition.finishedEvent !== null && stages[before]) stages[before].finishedAt = time;
        if (transition.finishedEvent !== null) lastEnd = time;
        for (let index = before; index < Math.min(after, stages.length); index++) {
            if (stages[index].activatedAt === null) skips.push({ index, time, progress, reference,
                reason: director.stageSkipReason(index) });
        }
    }
    const cancelledPreview = director.lockAfterFirstFinish().cancelledPreview;
    return { seed, distance, grade, speed, spike, stages, skips, cancelledPreview, activations, longestGap };
}

const cases = [];
for (const distance of [200, 400]) for (const speed of [2, 2.5, 3.5]) for (let grade = 1; grade <= 5; grade++) {
    const counts = Object.fromEntries(eventIds.map(id => [id, { name: entertainmentEventName(id),
        selected: 0, activated: 0, completed: 0, skipped: 0, slots: {} }]));
    const roundCounts = [], gaps = [];
    let requiredMisses = 0;
    for (let seed = 1; seed <= seedCount; seed++) {
        const result = replay(seed, distance, grade, speed);
        roundCounts.push(result.activations.length);
        gaps.push(result.longestGap);
        requiredMisses += Number(result.stages.some(stage => stage.required && stage.finishedAt === null));
        for (const [index, stage] of result.stages.entries()) {
            const count = counts[stage.event];
            count.selected++;
            count.activated += Number(stage.activatedAt !== null);
            count.completed += Number(stage.finishedAt !== null);
            count.skipped += Number(result.skips.some(skip => skip.index === index));
            const slot = count.slots[index] ??= { selected: 0, activated: 0 };
            slot.selected++; slot.activated += Number(stage.activatedAt !== null);
            assert.ok(stage.finishedAt === null || stage.activatedAt !== null);
        }
    }
    for (const count of Object.values(counts)) assert.ok(count.completed <= count.activated && count.activated <= count.selected);
    roundCounts.sort((a, b) => a - b); gaps.sort((a, b) => a - b);
    const percentiles = values => ({ min: values[0], max: values[values.length - 1], p10: values[Math.floor(values.length * .1)],
        median: values[Math.floor(values.length * .5)], p90: values[Math.floor(values.length * .9)] });
    cases.push({ distance, speed, grade, seeds: seedCount, counts, requiredMisses,
        activatedRounds: percentiles(roundCounts), longestGapSeconds: percentiles(gaps) });
}
const spikeChanges = [];
for (let seed = 1; seed <= seedCount && spikeChanges.length < 3; seed++) {
    const normal = replay(seed, 200, 3, 2.5), spike = replay(seed, 200, 3, 2.5, true);
    if (normal.stages.some((s, i) => s.activatedAt !== null && spike.stages[i].activatedAt === null)) {
        spikeChanges.push({ normal, spike });
    }
}
const examples = [];
for (const event of [E.TURTLE_BUS, E.GEYSER, E.GIANT_WAVE, E.WHIRLPOOL]) {
    for (let seed = 1; seed <= seedCount; seed++) {
        const result = replay(seed, 200, 5, 2.5);
        if (result.stages.some(s => s.event === event && s.activatedAt === null)) { examples.push(result); break; }
    }
}
console.log(JSON.stringify({ assumptions: '每组种子1至500、30Hz、固定领游速度，控制器按名义窗口结束。轮数包含基础、途中追加及返场；类型统计按计划槽的实际激活身份记录，不含表外返场。未注入真实海龟预检或玩家马达，假设存在航段；结果不代表实际参与率或实机发生率。最长间隔为已完成事件至下一轮公开预告，收尾和无下一轮不计。',
    cases, spikeChanges, examples }, null, 2));
