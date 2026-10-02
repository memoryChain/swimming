import { EntertainmentEventId as E } from './EntertainmentEventIds';
import { SeededRandom } from './SharedRNG';
import { geyserSpec } from './GeyserBrawlRules';
import { ENTERTAINMENT_GIANT_WAVE_SECONDS } from './GiantWaveRules';
import { TURTLE_BUS_CONFIG, turtleBusDoneAge } from './TurtleBusRules';
import type { EntertainmentMainStage } from './EntertainmentRacePlan';

/** 只在创建比赛计划时读取；联机固定默认配置，不消费本地调参。 */
export const ENTERTAINMENT_CADENCE_TUNING = {
    grade4Extras200: 2,
    grade4Extras400: 3,
    grade4GapSeconds: 5,
    optionalBudgetRatio: 0.8,
};
const NET_CADENCE = Object.freeze({ ...ENTERTAINMENT_CADENCE_TUNING });
export type EntertainmentCadence = Readonly<typeof ENTERTAINMENT_CADENCE_TUNING>;
export function entertainmentCadence(localTuning = false): EntertainmentCadence {
    const source = localTuning ? ENTERTAINMENT_CADENCE_TUNING : NET_CADENCE;
    return Object.freeze({
        grade4Extras200: Math.min(2, Math.max(0, Math.round(source.grade4Extras200))),
        grade4Extras400: Math.min(3, Math.max(0, Math.round(source.grade4Extras400))),
        grade4GapSeconds: Math.min(8, Math.max(5, source.grade4GapSeconds)),
        optionalBudgetRatio: Math.min(.95, Math.max(.65, source.optionalBudgetRatio)),
    });
}

export const ENTERTAINMENT_FIELD_EVENTS: readonly E[] = [E.WHIRLPOOL, E.GEYSER, E.GIANT_WAVE, E.TURTLE_BUS];
export function grade4AdditionalStage(event: E): EntertainmentMainStage {
    return { event, intensity: event === E.TURTLE_BUS ? 1 : 2, previewProgress: 0,
        actionCount: 1, required: false,
        durationSeconds: event === E.WHIRLPOOL ? 8 : event === E.GEYSER ? geyserSpec(2).actionSeconds
            : event === E.GIANT_WAVE ? ENTERTAINMENT_GIANT_WAVE_SECONDS
                : turtleBusDoneAge(TURTLE_BUS_CONFIG.entryWorldInset) };
}

/** 有界机会槽穿插在基础段之间；实际是否启动由导演逐槽核算剩余预算。 */
export function addGrade4Opportunities(seed: number, distance: number,
    baseline: readonly EntertainmentMainStage[], cadence: EntertainmentCadence): EntertainmentMainStage[] {
    const random = new SeededRandom((seed ^ 0x43414434) >>> 0);
    const unused = ENTERTAINMENT_FIELD_EVENTS.filter(event => !baseline.some(stage => stage.event === event));
    for (let index = unused.length - 1; index > 0; index--) {
        const swap = random.int(index + 1);
        [unused[index], unused[swap]] = [unused[swap], unused[index]];
    }
    const extras = distance >= 400 ? cadence.grade4Extras400 : cadence.grade4Extras200;
    const result: EntertainmentMainStage[] = [];
    for (let index = 0; index < baseline.length; index++) {
        result.push(baseline[index]);
        if (index < extras) result.push(grade4AdditionalStage(unused[index]));
    }
    return result;
}
