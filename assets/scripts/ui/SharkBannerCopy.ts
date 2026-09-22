// Event copy for the fixed shark level. The shark stays in the pool between
// scheduled hunts, so the calm lines describe roaming rather than leaving.
export type SharkBannerPhase = 'reveal' | 'attack' | 'retreat';

const LINES: Record<SharkBannerPhase, readonly string[]> = {
    reveal: [
        '充气玩具鲨来了！外壳软，咬人可不轻',
        '工作人员保证它是玩具，没保证它不咬人',
        '玩具鲨准备开咬，先看好绕行方向',
    ],
    attack: [
        '玩具鲨开咬，变向躲开！',
        '充气玩具鲨追来了，别让它咬到！',
        '玩具鲨盯上你了，拉开距离！',
    ],
    retreat: [
        '这轮先松口，玩具鲨恢复巡游',
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
