// Shark event banner copy. Each phase has a pool of candidate lines in the
// voice of a race broadcaster / safety system announcing increasingly absurd
// events deadpan. The shark is hidden until the first hunger beat (fake-safety
// intro), so the opening safe-waters lines are truthful and become ironic in
// hindsight once the shark drops in.
//
// Note on tense: hunger-beat lines only ever describe the CURRENT state (the
// shark is hungry NOW). They never anticipate "this is the last one" because
// nobody can know whether the shark will catch anyone this round. Only the
// satiated lines, fired once the shark is actually full, may declare the end.

import { Color } from 'cc';

// Banner colour by phase: green (safe) -> amber (reveal) -> orange (round 2)
// -> blood red (final) -> green (satiated).
export const SHARK_BANNER_COLORS = {
    safe: new Color(120, 220, 150, 255),
    reveal: new Color(255, 184, 77, 255),
    round2: new Color(255, 140, 70, 255),
    final: new Color(255, 66, 66, 255),
    satiated: new Color(120, 220, 150, 255),
};

const SAFE_LINES = [
    '安全水域，祝各位选手游出好成绩',
    '今日泳池已消毒，未检出异常生物',
    '赛事环境检测通过，可正常比赛',
    '本泳池具备完整安全防护，请放心游进',
    '今日天气良好，水温适宜，无异常',
];

const REVEAL_LINES = [
    '检测到异常生物，赛事暂停受理申诉',
    '异常生物入侵，请各位选手保持游进',
    '提示：泳池内出现未登记参赛者',
    '紧急通知：本泳池暂不具备驱鲨能力',
    '据现场观测，入侵者为鲨鱼，品种待定',
];

const ROUND2_LINES = [
    '鲨鱼进入第二次进食周期',
    '警告：鲨鱼饥饿值上升，建议加速',
    '第二次异常事件已记录，请继续游进',
    '鲨鱼行为分析：它又饿了',
    '赛事方提醒：这鲨鱼好像没吃饱',
];

// Third hunger beat. Describes only the present threat; deliberately does NOT
// say "last" or "final", since the shark may miss and come back, or eat fewer
// than the cap. The "it's over" framing lives in SATIATED_LINES instead.
const FINAL_LINES = [
    '鲨鱼第三次出动，各位请保命',
    '它又来了，而且更急了',
    '警告：鲨鱼饥饿值已达峰值',
    '赛事方紧急提醒：这鲨鱼还没吃饱',
    '第三次异常，建议各位选手分散逃命',
];

// Satiated: the shark is actually full now, so these may declare the end.
const SATIATED_LINES = [
    '鲨鱼已饱，本局威胁解除',
    '异常生物休眠，终局阶段开始',
    '鲨鱼进食结束，剩余选手继续完赛',
    '鲨鱼状态：已饱，泳池恢复安全等级',
    '赛事方通报：本次鲨鱼事件已结案',
];

// Picks a random line from a pool, avoiding the most recently used one so the
// same string does not repeat back-to-back across consecutive races/beats.
const _lastPicks = new Map<string, string>();
function pick(pool: string[], key: string): string {
    if (pool.length === 0) return '';
    if (pool.length === 1) return pool[0];
    const last = _lastPicks.get(key);
    let line = last;
    let guard = 0;
    while (line === last && guard++ < 8) {
        line = pool[Math.floor(Math.random() * pool.length)];
    }
    _lastPicks.set(key, line);
    return line;
}

export function pickSafeLine(): string { return pick(SAFE_LINES, 'safe'); }
export function pickRevealLine(): string { return pick(REVEAL_LINES, 'reveal'); }
export function pickRound2Line(): string { return pick(ROUND2_LINES, 'round2'); }
export function pickFinalLine(): string { return pick(FINAL_LINES, 'final'); }
export function pickSatiatedLine(): string { return pick(SATIATED_LINES, 'satiated'); }

// Round index -> line for a hunger beat (0 = reveal, 1 = round2, 2 = final).
export function pickHungerLine(huntIndex: number): string {
    if (huntIndex <= 0) return pickRevealLine();
    if (huntIndex === 1) return pickRound2Line();
    return pickFinalLine();
}

// huntIndex -> banner colour for the corresponding hunger beat.
export function hungerLineColor(huntIndex: number): Color {
    if (huntIndex <= 0) return SHARK_BANNER_COLORS.reveal;
    if (huntIndex === 1) return SHARK_BANNER_COLORS.round2;
    return SHARK_BANNER_COLORS.final;
}
