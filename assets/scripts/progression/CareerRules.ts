import { CUP_REWARDS } from './CupRewardConfig';
import type { PlayerProfile } from '../backend/PlayerProfile';
import type { AiEventConfig, AiIntelligenceId } from '../competitor/AiRaceConfig';
import { SeededRandom } from '../core/SharedRNG';
import { CAREER_AI_EVENTS, CAREER_SCHEDULE } from './CareerAiConfig';
import { copyAiEvent } from '../competitor/AiEventValidation';
import { calculateRaceCoins } from './ProgressionBalance';

export type SoloSource = 'quick' | 'league' | 'cup';
export type RaceRule = 'standard' | 'wild';
export const CAREER_RACE_RULE: RaceRule = 'wild';
export const CAREER_VERSION = 1;
export const LEAGUE_TARGET = 100;
export const LEAGUES = [
    { name: '泳馆新秀', factor: 1 },
    { name: '俱乐部选手', factor: 1.15 },
    { name: '城市精英', factor: 1.3 },
    { name: '区域强者', factor: 1.5 },
    { name: '全国大师', factor: 1.7 },
    { name: '冠军级', factor: 2 },
] as const;
const SKILLS: readonly AiIntelligenceId[] = ['rookie', 'normal', 'skilled', 'expert'];

export interface CupProgress {
    id: string; tier: number; round: number; seed: number;
    state: 'active' | 'won' | 'passed' | 'lost'; coins: number;
}
export interface CareerRaceTerms {
    eventId: string; eventName: string; factor: number; finishGraceSeconds: number;
    winPoints: number; finishPoints: number; qualifyPlace: number;
    championCoins: number; firstClearCoins: number;
}
export interface RaceTicket {
    id: string; source: SoloSource; characterId: string; level: number;
    distance: 200 | 400; rule: RaceRule; tier: number; round: number;
    seed: number; ai: AiEventConfig; cupId?: string; championCoins?: number; terms?: CareerRaceTerms;
}
export interface CareerReceipt {
    id: string; characterId: string; coinsGained: number; regular: number;
    podium: number; first: number; points: number; message: string;
}
export interface CareerState {
    version: number; league: number; points: number; freeSigningUsed: boolean;
    cups: Record<string, CupProgress>; wins: Record<string, number[]>;
    // 新字段可缺省，以兼容已有云档；道具首奖仍使用独立的firstPrizes。
    clears?: Record<string, number[]>; firstClearPrizes?: number[]; leagueStarts?: number[];
    firstPrizes: number[]; serial: number; pending: RaceTicket | null;
    receipts: CareerReceipt[];
    quick: { distance: 200 | 400; rule: RaceRule };
}
export type CareerCommand =
    | { type: 'begin'; characterId: string; source: SoloSource; tier: number; distance: 200 | 400; rule: RaceRule; seed: number }
    | { type: 'abandon'; characterId: string }
    | { type: 'settle'; ticketId: string; finished: boolean; placement: number; racerCount: number;
        perfectCount: number; goodCount: number; missCount: number; maxCombo: number; time: number };
export interface CareerResult { profile: PlayerProfile; ok: boolean; message: string; ticket?: RaceTicket; receipt?: CareerReceipt }

export function createCareer(): CareerState {
    return { version: CAREER_VERSION, league: 0, points: 0, freeSigningUsed: false,
        cups: {}, wins: {}, clears: {}, firstClearPrizes: [], leagueStarts: [0, 0, 0, 0, 0, 0], firstPrizes: [], serial: 0, pending: null, receipts: [],
        quick: { distance: 200, rule: 'wild' } };
}
export function tierIndex(n: number): number { return Math.max(0, Math.min(5, Math.floor(n) || 0)); }
export function cupRounds(tier: number): number { return tier >= 3 ? 3 : 2; }
export function cupDistance(tier: number, round: number): 200 | 400 {
    return cupRounds(tier) === 3 && round === 2 ? 400 : 200;
}
export function cupName(tier: number): string { return `${LEAGUES[tierIndex(tier)].name}${tier >= 3 ? '大师杯' : '晋级杯'}`; }
export function roundName(tier: number, round: number): string {
    return round === cupRounds(tier) - 1 ? '决赛' : round === 0 ? '预赛' : '半决赛';
}
export function eventFor(tier: number, round?: number, variant = 0): AiEventConfig {
    const config = CAREER_AI_EVENTS[tierIndex(tier)];
    const event = round === undefined ? (variant % 2 ? config.leagueAlternate : config.league) : config.cup[round];
    if (!event) throw new Error('杯赛AI轮次配置缺失');
    if (event.intelligence.length < 1 || event.intelligence.length > 7
        || event.opponentCount !== event.intelligence.length) throw new Error('生涯比赛需要配置1到7名AI的难度');
    return copyAiEvent(event);
}
/** 页面预告和开赛共用，不在比赛逐帧读取配置。 */
export function nextLeagueEvent(c: CareerState, tier: number) {
    const index = tierIndex(tier), schedule = CAREER_SCHEDULE[index];
    const variant = (c.leagueStarts?.[index] ?? 0) % 2;
    return { id: `career-${index}-league-${variant}`, name: schedule.leagueNames[variant],
        distance: schedule.leagueDistances[variant], rule: schedule.leagueRules[variant],
        ai: eventFor(index, undefined, variant) };
}
export function cupQualifyPlace(tier: number, round: number): number {
    return CAREER_SCHEDULE[tierIndex(tier)].qualifyPlaces[round] ?? 1;
}
export function leaguePointsFor(placement: number, racerCount: number, terms: CareerRaceTerms): number {
    const ratio = racerCount > 1 ? (racerCount - placement) / (racerCount - 1) : 1;
    return terms.finishPoints + Math.floor((terms.winPoints - terms.finishPoints) * Math.max(0, Math.min(1, ratio)));
}

export function quickEvent(profile: PlayerProfile, id: string, distance: 200 | 400, rule: RaceRule): AiEventConfig {
    const level = profile.characters[id]?.level ?? 1;
    const cup = profile.career.cups[id];
    const best = Math.max(-1, ...(profile.career.wins[id] ?? []));
    const experience = Math.max(profile.career.league, best + 1,
        cup ? cup.tier + cup.round / cupRounds(cup.tier) : 0);
    // 等级决定属性区间，赛事经历决定操作档；新角色不会继承主力属性。
    const center = Math.max(1, Math.min(30, Math.round(level * .75 + experience * .65)));
    const skill = Math.min(3, Math.floor(experience * .5 + (distance === 400 ? .25 : 0)));
    return { minLevel: Math.max(1, center - 2), maxLevel: Math.min(30, center + 2),
        intelligence: [SKILLS[Math.max(0, skill - 1)], SKILLS[skill], SKILLS[skill], SKILLS[Math.min(3, skill + (rule === 'wild' ? 0 : 1))]] };
}

/** 本地后台的规则引擎；正式云端应执行相同配置并核验赛事结果与广告凭证。 */
export function executeCareer(profile: PlayerProfile, command: CareerCommand): CareerResult {
    const c = profile.career;
    const fail = (message: string): CareerResult => ({ profile, ok: false, message });
    // 拒绝旧客户端的签约/染色命令；当前所有角色可直接金币培养。
    if (['begin', 'abandon', 'settle'].indexOf(command.type) < 0) return fail('该功能暂未开放');
    if (command.type === 'abandon') {
        const cup = c.cups[command.characterId];
        if (cup?.state === 'active') cup.state = 'lost';
        if (c.pending?.characterId === command.characterId && c.pending.source === 'cup') c.pending = null;
        return { profile, ok: true, message: '已放弃本届，已获得金币保留' };
    }
    if (command.type === 'begin') {
        if (['quick', 'league', 'cup'].indexOf(command.source) < 0
            || (command.distance !== 200 && command.distance !== 400)
            || (command.rule !== 'standard' && command.rule !== 'wild')) return fail('比赛来源或规则无效');
        const p = profile.characters[command.characterId];
        if (!p) return fail('角色不存在');
        const tier = tierIndex(command.tier);
        if (command.source !== 'quick' && tier > c.league) return fail('赛事尚未开放');
        let leagueEvent: ReturnType<typeof nextLeagueEvent> | null = null;
        let configuredAi: AiEventConfig;
        try {
            if (command.source === 'league') leagueEvent = nextLeagueEvent(c, tier);
            const existing = c.cups[command.characterId];
            configuredAi = command.source === 'quick' ? quickEvent(profile, command.characterId, command.distance, command.rule)
                : leagueEvent?.ai ?? eventFor(tier, command.source === 'cup' ? (existing?.state === 'active' && existing.tier === tier ? existing.round : 0) : undefined);
        } catch (error) { return fail(`赛事AI配置错误：${error instanceof Error ? error.message : String(error)}`); }
        let cup: CupProgress | undefined;
        if (command.source === 'cup') {
            cup = c.cups[command.characterId];
            if (cup?.state === 'active' && cup.tier !== tier) return fail('该角色已有进行中的杯赛，请先继续或放弃');
            if (!cup || cup.state !== 'active') {
                if (tier === c.league && c.points < LEAGUE_TARGET) return fail('联赛积分满100后开放');
                cup = { id: `cup-${++c.serial}`, tier, round: 0, seed: command.seed >>> 0,
                    state: 'active', coins: 0 };
                c.cups[command.characterId] = cup;
            }
        }
        const distance = command.source === 'quick' ? command.distance : cup ? cupDistance(tier, cup.round) : leagueEvent!.distance;
        const schedule = CAREER_SCHEDULE[tier];
        const rule = command.source === 'quick' ? command.rule : cup ? schedule.cupRules[cup.round] : leagueEvent!.rule;
        const terms: CareerRaceTerms | undefined = command.source === 'quick' ? undefined : {
            eventId: leagueEvent?.id ?? `career-${tier}-cup-${cup!.round}`,
            eventName: leagueEvent?.name ?? `${cupName(tier)} · ${roundName(tier, cup!.round)}`,
            factor: schedule.factor, finishGraceSeconds: Math.round(schedule.finishGrace * (distance === 400 ? 1.5 : 1)),
            winPoints: schedule.winPoints, finishPoints: schedule.finishPoints,
            qualifyPlace: cup ? cupQualifyPlace(tier, cup.round) : 0,
            championCoins: CUP_REWARDS[tier].championCoins, firstClearCoins: CUP_REWARDS[tier].firstClearCoins,
        };
        const ticket: RaceTicket = { id: `race-${++c.serial}`, source: command.source,
            characterId: command.characterId, level: p.level, distance, rule, tier,
            round: cup?.round ?? 0, cupId: cup?.id,
            seed: cup ? new SeededRandom(cup.seed + cup.round).int(0x7fffffff) : command.seed >>> 0,
            ai: configuredAi, ...(terms ? { terms } : {}), ...(command.source === 'cup' ? {championCoins: CUP_REWARDS[tier].championCoins} : {}) };
        c.pending = ticket;
        if (command.source === 'quick') c.quick = { distance, rule };
        return { profile, ok: true, message: '比赛已准备', ticket };
    }
    const previous = c.receipts.find(r => r.id === command.ticketId);
    if (previous) return { profile, ok: true, message: previous.message, receipt: previous };
    const t = c.pending;
    if (!t || t.id !== command.ticketId || ['quick', 'league', 'cup'].indexOf(t.source) < 0) return fail('比赛记录已失效');
    const numbers = [command.placement, command.racerCount, command.perfectCount, command.goodCount, command.missCount, command.maxCombo, command.time];
    if (numbers.some(n => !Number.isFinite(n) || n < 0) || command.racerCount < 1 || command.racerCount > 8
        || !Number.isInteger(command.racerCount)
        || (t.ai.opponentCount !== undefined && command.racerCount !== t.ai.opponentCount + 1)
        || command.placement < 1 || command.placement > command.racerCount || !Number.isInteger(command.placement)) return fail('比赛结果无效');
    const finished = command.finished && command.time > 0;
    const factor = t.source === 'quick' ? 1 : t.terms?.factor ?? LEAGUES[t.tier].factor;
    // 未带新条款的在途旧票据继续采用旧结算；新杯赛每轮都有完赛收益。
    const regular = t.source === 'cup' && !t.terms ? 0 : calculateRaceCoins({ ...command, finished, factor, distance: t.distance });
    const receipt: CareerReceipt = { id: t.id, characterId: t.characterId, coinsGained: regular,
        regular, podium: 0, first: 0, points: 0, message: finished ? '比赛完成' : '未完赛，本场无奖励' };
    if (t.source === 'league') {
        const starts = c.leagueStarts ?? (c.leagueStarts = [0, 0, 0, 0, 0, 0]);
        starts[t.tier] = (starts[t.tier] ?? 0) + 1;
        if (finished && t.tier === c.league) {
            const points = t.terms ? leaguePointsFor(command.placement, command.racerCount, t.terms)
                : [20, 14, 10, 6, 0, 0, 0, 0][command.placement - 1];
            receipt.points = Math.max(0, Math.min(LEAGUE_TARGET - c.points, points));
            c.points += receipt.points;
        }
        if (finished) receipt.message = t.tier < c.league ? '比赛完成，金币已获得'
            : c.points >= LEAGUE_TARGET ? '晋级杯已开放' : `联赛积分 +${receipt.points} · ${c.points}/${LEAGUE_TARGET}`;
    } else if (t.source === 'cup') {
        const cup = c.cups[t.characterId];
        if (!cup || cup.id !== t.cupId || cup.round !== t.round || cup.state !== 'active') return fail('杯赛轮次已失效');
        const final = t.round === cupRounds(t.tier) - 1;
        const qualifyPlace = t.terms?.qualifyPlace ?? (final ? 1 : t.round === 0 ? 4 : 3);
        const passed = finished && command.placement <= qualifyPlace;
        if (final) {
            cup.state = !passed ? 'lost' : command.placement === 1 ? 'won' : 'passed';
            receipt.message = passed ? (cup.state === 'won' ? '杯赛夺冠' : '杯赛达标')
                : finished ? '杯赛结束，完赛奖励保留，可重新挑战' : '未完赛，可重新挑战杯赛';
            if (passed) {
                const hadWin = Object.keys(c.wins).some(id => c.wins[id].indexOf(t.tier) >= 0);
                if (cup.state === 'won') {
                    const wins = c.wins[t.characterId] ?? (c.wins[t.characterId] = []);
                    if (wins.indexOf(t.tier) < 0) wins.push(t.tier);
                }
                if (t.terms) {
                    // 首通账号共享；既有晋级/冠军记录视为已通关，不追溯补发。
                    const historical = t.tier < c.league || hadWin;
                    const prizes = c.firstClearPrizes ?? (c.firstClearPrizes = []);
                    const clears = c.clears ?? (c.clears = {});
                    const previousClear = Object.keys(clears).some(id => clears[id].indexOf(t.tier) >= 0);
                    if (!historical && !previousClear && prizes.indexOf(t.tier) < 0) {
                        receipt.first = t.terms.firstClearCoins; prizes.push(t.tier);
                    }
                    const cleared = clears[t.characterId] ?? (clears[t.characterId] = []);
                    if (cleared.indexOf(t.tier) < 0) cleared.push(t.tier);
                    if (cup.state === 'won') receipt.podium = t.terms.championCoins;
                } else {
                    receipt.regular = t.championCoins ?? [60, 70, 80, 90, 100, 120][t.tier];
                    receipt.coinsGained = receipt.regular;
                }
                if (t.tier === c.league && c.points >= LEAGUE_TARGET && c.league < 5) {
                    c.league++; c.points = 0; receipt.message = `晋级成功 · ${LEAGUES[c.league].name}`;
                }
            }
        } else if (passed) {
            cup.round++; receipt.message = `已晋级${roundName(t.tier, cup.round)}，可稍后继续`;
        } else { cup.state = 'lost'; receipt.message = finished ? '未晋级，完赛奖励保留' : '未完赛，可重新挑战杯赛'; }
        cup.coins += receipt.coinsGained + receipt.podium + receipt.first;
    }
    receipt.coinsGained += receipt.podium + receipt.first;
    profile.coins += receipt.coinsGained;
    c.pending = null; c.receipts.push(receipt);
    if (c.receipts.length > 32) c.receipts.shift();
    return { profile, ok: true, message: receipt.message, receipt };
}
