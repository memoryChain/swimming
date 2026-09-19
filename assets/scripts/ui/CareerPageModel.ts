import { CareerState, cupDistance, cupRounds, LEAGUES, roundName, tierIndex } from '../progression/CareerRules';

export type CareerCupAction = 'start' | 'locate' | 'next' | 'locked';
export type CareerRoundStyle = 'pending' | 'current' | 'complete' | 'failed';

/** 仅在资料或选择改变时生成展示快照，判定和奖励仍由CareerRules负责。 */
export function careerPageModel(c: CareerState, characterId: string, selected: number, reviewTier?: number | null) {
    const tier = tierIndex(selected);
    const reviewing = reviewTier != null && reviewTier < c.league
        && c.cups[characterId]?.tier === reviewTier && c.cups[characterId]?.state === 'won';
    const cupTier = reviewing ? tierIndex(reviewTier!) : tier;
    const points = tier < c.league ? 100 : tier === c.league ? c.points : 0;
    const unlocked = tier <= c.league;
    const owned = c.cups[characterId];
    const cup = owned?.tier === cupTier ? owned : null;
    const active = cup?.state === 'active';
    const other = owned?.state === 'active' && owned.tier !== cupTier;
    const won = cup ? cup.state === 'won' : (c.wins[characterId]?.indexOf(cupTier) ?? -1) >= 0;
    const open = cupTier <= c.league && (cupTier < c.league || c.points >= 100 || active);
    let action: CareerCupAction = 'start';
    let button = active ? `继续${roundName(cupTier, cup.round)}` : won || cup?.state === 'lost' ? '再次挑战' : '开始杯赛';
    let note = cupTier === LEAGUES.length - 1 ? '已达最高级，可再次挑战大师杯。' : '夺冠晋级下一联赛。';
    if (active) note = '轮间可培养角色，杯赛进度自动保存。';
    else if (cup?.state === 'lost') note = '本届未晋级，重新挑战从预赛开始。';
    else if (won && cupTier < c.league) note = '本角色已夺冠，重赛不重复晋级。';
    if (!open) {
        action = 'locked';
        button = cupTier > c.league ? '尚未解锁' : `还差${100 - c.points}积分`;
    }
    if (other) { action = 'locate'; button = '继续未完成杯赛'; note = `${LEAGUES[owned.tier].name}有未完成杯赛，请先继续或放弃。`; }
    if (reviewing) { action = 'next'; button = '查看新联赛'; note = `夺冠成功，已晋级${LEAGUES[c.league].name}！`; }
    const rounds = Array.from({ length: cupRounds(cupTier) }, (_, i) => {
        const final = i === cupRounds(cupTier) - 1;
        let style: CareerRoundStyle = 'pending', status = '未开始';
        if (won || (cup && i < cup.round)) { style = 'complete'; status = won && final ? '已夺冠' : '已晋级'; }
        else if (cup?.state === 'lost' && i === cup.round) { style = 'failed'; status = '未晋级'; }
        else if ((active && i === cup.round) || (!cup && open && i === 0 && !other)) { style = 'current'; status = '当前轮次'; }
        return { title: roundName(cupTier, i), distance: cupDistance(cupTier, i),
            condition: final ? '第一名夺冠' : i === 0 ? '前四晋级' : '前三晋级', status, style };
    });
    let hint = !unlocked ? '晋级前一级后开放本联赛' : tier < c.league ? '回打可获得金币，不增加当前联赛积分'
        : points < 100 ? `再获${100 - points}积分，解锁${tier >= 3 ? '大师杯' : '晋级杯'}`
        : tier === 5 ? '已达最高级，联赛仍可挑战' : '积分已满，挑战角色专属杯赛';
    if (reviewing) hint = '新联赛已开启，积分从0开始';
    return { tier, cupTier, points, unlocked, hint, rounds, button, note, action,
        actionTier: other ? owned.tier : c.league, active, won,
        subtitle: active ? `第${cup.round + 1}/${rounds.length}轮` : won ? '本角色已夺冠' : cup?.state === 'lost' ? '本届已结束' : '',
        title: reviewing ? `${LEAGUES[cupTier].name}晋级杯` : cupTier === 5 ? '冠军大师杯' : cupTier >= 3 ? '大师杯' : '晋级杯' };
}
