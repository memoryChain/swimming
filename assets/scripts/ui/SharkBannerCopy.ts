// Event copy for the fixed shark level. The shark stays in the pool between
// scheduled hunts, so the calm lines describe roaming rather than leaving.
export type SharkBannerPhase = 'reveal' | 'attack' | 'retreat';

const LINES: Record<SharkBannerPhase, readonly string[]> = {
    reveal: [
        '充气玩具鲨来了！转弯好像不太稳',
        '工作人员提醒：玩具鲨冲得快，记得绕行',
        '玩具鲨开始追逐，先看好绕行方向',
    ],
    attack: [
        '玩具鲨冲过来了，变向躲开！',
        '充气玩具鲨刹不住了，别被撞翻！',
        '玩具鲨盯上你了，拉开距离！',
    ],
    retreat: [
        '这轮冲过头了，玩具鲨恢复巡游',
        '锁定暂时解除，玩具鲨还在附近',
        '玩具鲨暂停追人，大家检查一下泳裤',
    ],
};

const nextIndex: Record<SharkBannerPhase, number> = {
    reveal: 0,
    attack: 0,
    retreat: 0,
};

// Rotate rather than use gameplay RNG: copy variation stays deterministic and
// cannot influence synchronized race outcomes.
export function pickSharkBannerLine(phase: SharkBannerPhase): string {
    const lines = LINES[phase];
    const index = nextIndex[phase];
    nextIndex[phase] = (index + 1) % lines.length;
    return lines[index];
}
