import { sys } from 'cc';
import { RHYTHM_BALANCE, SWIMMER_BALANCE } from './GameBalance';
import { INPUT_TUNING, MOTION_TUNING } from './InputTuning';

export type TuningControl = {
    label: string;
    description: string;
    get: () => number;
    set: (value: number) => void;
    step: number;
    min: number;
    max: number;
    precision: number;
    suffix?: string;
};

export type TuningGroup = {
    name: string;
    controls: TuningControl[];
};

const TUNING_STORAGE_KEY = 'SpeedSwimming.Tuning.v1';

export const TUNING_GROUPS: TuningGroup[] = [
    {
        name: '输入',
        controls: [
            control('目标节奏', '每分钟划水节拍，越高要求输入越快', () => RHYTHM_BALANCE.targetBpm, (v) => RHYTHM_BALANCE.targetBpm = v, 2, 90, 220, 0),
            control('频率统计窗', '计算当前手脚输入频率的时间范围', () => INPUT_TUNING.inputRateWindowSeconds, (v) => INPUT_TUNING.inputRateWindowSeconds = v, 0.05, 0.4, 2.4, 2, 's'),
            control('触摸去重', '同侧触摸/鼠标重复触发的过滤时间', () => INPUT_TUNING.padStrokeDedupeMs, (v) => INPUT_TUNING.padStrokeDedupeMs = v, 5, 0, 180, 0, 'ms'),
            control('双键合并', 'A 和 D 间隔多短会合成一次双侧划水', () => INPUT_TUNING.chordMergeWindowMs, (v) => INPUT_TUNING.chordMergeWindowMs = v, 5, 0, 180, 0, 'ms'),
            control('双键松开', '双侧长按奖励允许的左右松开误差', () => INPUT_TUNING.chordReleaseWindowMs, (v) => INPUT_TUNING.chordReleaseWindowMs = v, 5, 0, 220, 0, 'ms'),
        ],
    },
    {
        name: '节奏',
        controls: [
            control('完美窗口', '交替输入偏离目标节奏多少秒内算 PERFECT', () => INPUT_TUNING.rhythmPerfectWindowSeconds, (v) => INPUT_TUNING.rhythmPerfectWindowSeconds = v, 0.005, 0.01, 0.2, 3, 's'),
            control('良好窗口', '交替输入偏离目标节奏多少秒内算 GOOD', () => INPUT_TUNING.rhythmGoodWindowSeconds, (v) => INPUT_TUNING.rhythmGoodWindowSeconds = v, 0.005, 0.03, 0.35, 3, 's'),
            control('过快宽容', '交替模式下过快输入仍可算 GOOD 的上限', () => INPUT_TUNING.rhythmLooseWindowSeconds, (v) => INPUT_TUNING.rhythmLooseWindowSeconds = v, 0.02, 0.08, 0.8, 2, 's'),
            control('双键完美', 'A+D 双侧模式的 PERFECT 节奏窗口', () => INPUT_TUNING.bothRhythmPerfectWindowSeconds, (v) => INPUT_TUNING.bothRhythmPerfectWindowSeconds = v, 0.005, 0.005, 0.18, 3, 's'),
            control('双键良好', 'A+D 双侧模式的 GOOD 节奏窗口', () => INPUT_TUNING.bothRhythmGoodWindowSeconds, (v) => INPUT_TUNING.bothRhythmGoodWindowSeconds = v, 0.005, 0.02, 0.3, 3, 's'),
            control('最高加成', 'combo 和长按奖励能达到的速度倍率上限', () => RHYTHM_BALANCE.maxComboBonus, (v) => RHYTHM_BALANCE.maxComboBonus = v, 0.05, 1, 2.5, 2),
            control('完美加成', '每个 PERFECT combo 增加的节奏收益', () => RHYTHM_BALANCE.comboPerfectBonus, (v) => RHYTHM_BALANCE.comboPerfectBonus = v, 0.005, 0, 0.12, 3),
            control('良好加成', 'GOOD 当次提供的节奏收益', () => RHYTHM_BALANCE.comboGoodBonus, (v) => RHYTHM_BALANCE.comboGoodBonus = v, 0.005, 0, 0.08, 3),
            control('失误惩罚', 'MISS 时扣掉的 combo 数', () => RHYTHM_BALANCE.comboMissPenalty, (v) => RHYTHM_BALANCE.comboMissPenalty = v, 1, 0, 10, 0),
        ],
    },
    {
        name: '长按',
        controls: [
            control('长按完美', '松开时长接近目标多少秒内算 PERFECT', () => INPUT_TUNING.holdPerfectWindowSeconds, (v) => INPUT_TUNING.holdPerfectWindowSeconds = v, 0.005, 0.005, 0.16, 3, 's'),
            control('长按良好', '松开时长接近目标多少秒内算 GOOD', () => INPUT_TUNING.holdGoodWindowSeconds, (v) => INPUT_TUNING.holdGoodWindowSeconds = v, 0.005, 0.02, 0.28, 3, 's'),
            control('长按宽容', '长按偏差超过此值才扣 combo', () => INPUT_TUNING.holdLooseWindowSeconds, (v) => INPUT_TUNING.holdLooseWindowSeconds = v, 0.01, 0.04, 0.5, 2, 's'),
            control('双键长按P', 'A+D 双侧长按 PERFECT 窗口', () => INPUT_TUNING.bothHoldPerfectWindowSeconds, (v) => INPUT_TUNING.bothHoldPerfectWindowSeconds = v, 0.005, 0.005, 0.14, 3, 's'),
            control('双键长按G', 'A+D 双侧长按 GOOD 窗口', () => INPUT_TUNING.bothHoldGoodWindowSeconds, (v) => INPUT_TUNING.bothHoldGoodWindowSeconds = v, 0.005, 0.015, 0.24, 3, 's'),
            control('长按P加成', '长按 PERFECT 额外提供的速度收益', () => RHYTHM_BALANCE.holdPerfectBonus, (v) => RHYTHM_BALANCE.holdPerfectBonus = v, 0.005, 0, 0.2, 3),
            control('长按G加成', '长按 GOOD 额外提供的速度收益', () => RHYTHM_BALANCE.holdGoodBonus, (v) => RHYTHM_BALANCE.holdGoodBonus = v, 0.005, 0, 0.14, 3),
            control('长按失误', '长按 MISS 时扣掉的 combo 数', () => RHYTHM_BALANCE.holdMissPenalty, (v) => RHYTHM_BALANCE.holdMissPenalty = v, 1, 0, 8, 0),
        ],
    },
    {
        name: '速度',
        controls: [
            control('基础速度', '开始游泳时的基础速度', () => SWIMMER_BALANCE.baseSpeed, (v) => SWIMMER_BALANCE.baseSpeed = v, 0.05, 0, 2, 2),
            control('最高速度', '没有节奏加成时的速度上限', () => SWIMMER_BALANCE.maxSpeed, (v) => SWIMMER_BALANCE.maxSpeed = v, 0.05, 1, 6, 2),
            control('划水加速', '手脚节奏稳定时的主要加速度', () => SWIMMER_BALANCE.maxSwimAccel, (v) => SWIMMER_BALANCE.maxSwimAccel = v, 0.05, 0, 5, 2),
            control('起步腿力', '低速和起步阶段打腿提供的加速', () => SWIMMER_BALANCE.kickStartAccel, (v) => SWIMMER_BALANCE.kickStartAccel = v, 0.05, 0, 6, 2),
            control('基础阻力', '任何速度下都会产生的减速阻力', () => SWIMMER_BALANCE.baseDrag, (v) => SWIMMER_BALANCE.baseDrag = v, 0.02, 0, 2, 2),
            control('高速阻力', '速度接近上限时额外增加的阻力', () => SWIMMER_BALANCE.highSpeedDrag, (v) => SWIMMER_BALANCE.highSpeedDrag = v, 0.02, 0, 2.5, 2),
            control('失衡阻力', '手脚不同步时高速阶段的额外惩罚', () => SWIMMER_BALANCE.highSpeedDesyncPenalty, (v) => SWIMMER_BALANCE.highSpeedDesyncPenalty = v, 0.05, 0, 3, 2),
            control('疲劳上限', '长距离游泳累计疲劳的最大影响', () => SWIMMER_BALANCE.fatigueLimit, (v) => SWIMMER_BALANCE.fatigueLimit = v, 0.01, 0, 0.6, 2),
            control('疲劳速度', '比赛中疲劳积累的速度', () => SWIMMER_BALANCE.fatigueRate, (v) => SWIMMER_BALANCE.fatigueRate = v, 0.001, 0, 0.04, 3),
            control('节奏提速', '节奏奖励对最高速度的提升比例', () => SWIMMER_BALANCE.playerRhythmMaxSpeedScale, (v) => SWIMMER_BALANCE.playerRhythmMaxSpeedScale = v, 0.01, 0, 0.6, 2),
            control('combo加速', '节奏奖励对加速度的提升比例', () => SWIMMER_BALANCE.comboAccelScale, (v) => SWIMMER_BALANCE.comboAccelScale = v, 0.05, 0, 2, 2),
        ],
    },
    {
        name: '起步',
        controls: [
            control('起步开始', '起步辅助开始衰减的距离', () => SWIMMER_BALANCE.kickLaunchDistanceStart, (v) => SWIMMER_BALANCE.kickLaunchDistanceStart = v, 0.5, 0, 40, 1, 'm'),
            control('起步结束', '起步辅助完全结束的距离', () => SWIMMER_BALANCE.kickLaunchDistanceEnd, (v) => SWIMMER_BALANCE.kickLaunchDistanceEnd = v, 0.5, 0, 45, 1, 'm'),
            control('早期同步', '起步阶段手脚不同步的惩罚比例', () => SWIMMER_BALANCE.earlySyncPenaltyDuringKickLaunch, (v) => SWIMMER_BALANCE.earlySyncPenaltyDuringKickLaunch = v, 0.02, 0, 1, 2),
        ],
    },
    {
        name: '动作',
        controls: [
            control('按住速度', '按键按住时动作播放速度倍率', () => MOTION_TUNING.heldMotionSpeedScale, (v) => MOTION_TUNING.heldMotionSpeedScale = v, 0.05, 0.1, 3, 2),
            control('松开速度', '松开按键后动作追完的速度倍率', () => MOTION_TUNING.releasedMotionSpeedScale, (v) => MOTION_TUNING.releasedMotionSpeedScale = v, 0.05, 0.2, 6, 2),
            control('手臂最低', '比赛中手臂动作最低每秒循环数', () => MOTION_TUNING.armMinCyclesPerSecond, (v) => MOTION_TUNING.armMinCyclesPerSecond = v, 0.05, 0.1, 3, 2),
            control('腿部最低', '比赛中打腿动作最低每秒循环数', () => MOTION_TUNING.kickMinCyclesPerSecond, (v) => MOTION_TUNING.kickMinCyclesPerSecond = v, 0.05, 0.1, 3, 2),
            control('动作上限', '比赛中手脚动作最高每秒循环数', () => MOTION_TUNING.maxCyclesPerSecond, (v) => MOTION_TUNING.maxCyclesPerSecond = v, 0.1, 1, 10, 1),
            control('调试手臂', 'debug model 手臂动作最低循环数', () => MOTION_TUNING.debugArmMinCyclesPerSecond, (v) => MOTION_TUNING.debugArmMinCyclesPerSecond = v, 0.05, 0.1, 3, 2),
            control('调试腿部', 'debug model 腿部动作最低循环数', () => MOTION_TUNING.debugKickMinCyclesPerSecond, (v) => MOTION_TUNING.debugKickMinCyclesPerSecond = v, 0.05, 0.1, 3, 2),
            control('调试上限', 'debug model 动作最高每秒循环数', () => MOTION_TUNING.debugMaxCyclesPerSecond, (v) => MOTION_TUNING.debugMaxCyclesPerSecond = v, 0.1, 1, 10, 1),
            control('动画倍率', '比赛和 debug model 共用的整体动画倍率', () => MOTION_TUNING.animationSpeedScale, (v) => MOTION_TUNING.animationSpeedScale = v, 0.05, 0.1, 1.5, 2),
        ],
    },
];

export function resetTuningToDefaults() {
    applyTuningSnapshot(defaultTuningSnapshot());
}

export function saveCurrentTuning(): boolean {
    try {
        sys.localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify(createTuningSnapshot()));
        return true;
    } catch (error) {
        console.warn('[SpeedSwimming] failed to save tuning settings', error);
        return false;
    }
}

export function loadSavedTuning(): boolean {
    try {
        defaultTuningSnapshot();
        const raw = sys.localStorage.getItem(TUNING_STORAGE_KEY);
        if (!raw) {
            return false;
        }
        const snapshot = JSON.parse(raw) as Record<string, number>;
        applyTuningSnapshot(snapshot);
        return true;
    } catch (error) {
        console.warn('[SpeedSwimming] failed to load tuning settings', error);
        return false;
    }
}

function control(
    label: string,
    description: string,
    get: () => number,
    set: (value: number) => void,
    step: number,
    min: number,
    max: number,
    precision: number,
    suffix = '',
): TuningControl {
    return {
        label,
        description,
        get,
        set: (value) => set(clamp(roundTo(value, precision), min, max)),
        step,
        min,
        max,
        precision,
        suffix,
    };
}

function roundTo(value: number, precision: number): number {
    const scale = Math.pow(10, precision);
    return Math.round(value * scale) / scale;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

let _defaultSnapshot: Record<string, number> | null = null;

function defaultTuningSnapshot(): Record<string, number> {
    if (!_defaultSnapshot) {
        _defaultSnapshot = createTuningSnapshot();
    }
    return { ..._defaultSnapshot };
}

function createTuningSnapshot(): Record<string, number> {
    const snapshot: Record<string, number> = {};
    forEachControl((control, key) => {
        snapshot[key] = control.get();
    });
    return snapshot;
}

function applyTuningSnapshot(snapshot: Record<string, number>) {
    forEachControl((control, key) => {
        const value = snapshot[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            control.set(value);
        }
    });
}

function forEachControl(callback: (control: TuningControl, key: string) => void) {
    for (let groupIndex = 0; groupIndex < TUNING_GROUPS.length; groupIndex++) {
        const controls = TUNING_GROUPS[groupIndex].controls;
        for (let controlIndex = 0; controlIndex < controls.length; controlIndex++) {
            callback(controls[controlIndex], `${groupIndex}.${controlIndex}`);
        }
    }
}
