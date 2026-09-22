// Event copy for the fixed shark level. The shark stays in the pool between
// scheduled hunts, so the calm lines describe roaming rather than leaving.
export type SharkBannerPhase = 'reveal' | 'attack' | 'retreat';

const LINES: Record<SharkBannerPhase, readonly string[]> = {
    reveal: [
        '充气玩具鲨准备巡场，请留出转弯空间',
        '提示：玩具鲨也来热身了，注意锁定箭头',
        '玩具鲨气鼓鼓地入场，请观察绕行方向',
    ],
    attack: [
        '玩具鲨开始追逐，变向绕开圆鼻头！',
        '充气玩具鲨追来了，留点转弯余地！',
        '追逐启动：拉开距离或变向绕行！',
    ],
    retreat: [
        '本轮追逐结束，玩具鲨恢复巡游',
        '锁定暂时解除，留意下一轮玩具巡场',
        '玩具鲨停止冲刺，绕开它继续游',
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
