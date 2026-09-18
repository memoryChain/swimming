// Event copy for the fixed shark level. The shark stays in the pool between
// scheduled hunts, so the calm lines describe roaming rather than leaving.
export type SharkBannerPhase = 'reveal' | 'attack' | 'retreat';

const LINES: Record<SharkBannerPhase, readonly string[]> = {
    reveal: [
        '检测到异常生物，赛事暂停受理申诉',
        '提示：泳池内出现未登记参赛者',
        '紧急通知：本泳池暂不具备驱鲨能力',
    ],
    attack: [
        '锁定结束，鲨鱼开始攻击！',
        '危险等级上升：鲨鱼进入追击状态！',
        '追击启动：加速或变向甩开它！',
    ],
    retreat: [
        '本轮追击结束，鲨鱼恢复巡游',
        '锁定暂时解除，小心下一轮追猎',
        '鲨鱼停止冲刺，仍在赛场内游荡',
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
