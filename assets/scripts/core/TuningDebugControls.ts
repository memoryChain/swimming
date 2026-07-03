import { JsonAsset, native, resources, sys } from 'cc';
import { NATIVE } from 'cc/env';
import { FREESTYLE_POSE_TUNING } from '../character/CharacterMotionTuning';
import { DIVE_BALANCE, SWIMMER_BALANCE } from './GameBalance';
import { INPUT_TUNING, MOTION_TUNING, STABILITY_TUNING } from './InputTuning';

export type TuningControl = {
    id: string;
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

export type TuningSaveResult = {
    ok: boolean;
    storage: 'project' | 'native' | 'localStorage' | 'failed';
    path?: string;
    message: string;
};

const TUNING_STORAGE_KEY = 'SpeedSwimming.Tuning.v1';
const PROJECT_TUNING_RESOURCE = 'config/tuning';
const PROJECT_TUNING_ASSET_PATH = 'assets/resources/config/tuning.json';
const TUNING_FILE_DIR = 'SpeedSwimming';
const TUNING_FILE_NAME = 'tuning.json';
const TUNING_FILE_VERSION = 3;

type TuningFileData = {
    version: number;
    updatedAt?: string;
    values?: Record<string, number>;
    controls?: Record<string, {
        group: string;
        label: string;
        description: string;
        min: number;
        max: number;
        step: number;
        suffix?: string;
    }>;
};

export const TUNING_GROUPS: TuningGroup[] = [
    {
        name: '输入',
        controls: [
            control('input.padStrokeDedupeMs', '触摸防连点', '同一侧触摸或屏幕按钮重复触发的过滤时间。只影响触摸/按钮输入，不影响键盘 A/D。', () => INPUT_TUNING.padStrokeDedupeMs, (v) => INPUT_TUNING.padStrokeDedupeMs = v, 5, 0, 180, 0, 'ms'),
        ],
    },
    {
        name: '跳水',
        controls: [
            control('dive.minPower', '最低跳水', '没有蓄力或蓄力条很低时保留的最低跳水力度。数值越高，失误跳水也会更快。', () => DIVE_BALANCE.minPower, (v) => DIVE_BALANCE.minPower = v, 0.02, 0, 0.8, 2),
            control('dive.chargeCycleSeconds', '蓄力周期', '蓄力条从 0 到 1 再回到 0 的完整周期。值越小，顶点更难抓；值越大，蓄力节奏更宽松。', () => DIVE_BALANCE.chargeCycleSeconds, (v) => DIVE_BALANCE.chargeCycleSeconds = v, 0.05, 0.4, 4, 2, 's'),
        ],
    },
    {
        name: '速度',
        controls: [
            control('speed.baseSpeed', '基础速度', '进入游泳阶段时的初始速度。跳水入水速度仍由跳水参数决定。', () => SWIMMER_BALANCE.baseSpeed, (v) => SWIMMER_BALANCE.baseSpeed = v, 0.05, 0, 2, 2, 'm/s'),
            control('speed.maxSpeed', '最高速度', '玩家常规游泳速度上限，也用于计算当前速度比例。', () => SWIMMER_BALANCE.maxSpeed, (v) => SWIMMER_BALANCE.maxSpeed = v, 0.05, 1, 6, 2, 'm/s'),
            control('speed.strokeBaseAccel', '基础动作加速', '每轮动作真正开始播放时给的基础加速度。缓存输入要等开始播放时才给。', () => SWIMMER_BALANCE.strokeBaseAccel, (v) => SWIMMER_BALANCE.strokeBaseAccel = v, 0.05, 0, 5, 2),
            control('speed.strokeStabilityAccel', '稳定加速', '稳定性为 1 时额外附加的加速度，稳定性较低时按比例减少。', () => SWIMMER_BALANCE.strokeStabilityAccel, (v) => SWIMMER_BALANCE.strokeStabilityAccel = v, 0.05, 0, 8, 2),
            control('speed.strokeAccelDurationRatio', '加速持续', '一次动作加速度持续时间，占当前动作一轮时间的比例。', () => SWIMMER_BALANCE.strokeAccelDurationRatio, (v) => SWIMMER_BALANCE.strokeAccelDurationRatio = v, 0.02, 0.05, 1.5, 2),
            control('speed.alternationWindowSize', '交替样本轮数', '用于计算左右交替质量的最近动作轮数。窗口越大，越看长期左右均衡。', () => SWIMMER_BALANCE.alternationWindowSize, (v) => SWIMMER_BALANCE.alternationWindowSize = v, 1, 2, 12, 0),
            control('speed.alternationBaseMinScale', '单侧基础保底', '只按单侧时基础动作加速保留的比例。值越低，单侧输入越难提速。', () => SWIMMER_BALANCE.alternationBaseMinScale, (v) => SWIMMER_BALANCE.alternationBaseMinScale = v, 0.05, 0, 1, 2),
            control('speed.alternationStabilityMinScale', '单侧稳定保底', '只按单侧时稳定加速保留的比例。值越低，单侧稳定短按越难获得高收益。', () => SWIMMER_BALANCE.alternationStabilityMinScale, (v) => SWIMMER_BALANCE.alternationStabilityMinScale = v, 0.05, 0, 1, 2),
            control('speed.poolDeceleration', '泳池减速', '泳池或场景提供的固定减速度。未来不同泳池可以配置不同数值。', () => SWIMMER_BALANCE.poolDeceleration, (v) => SWIMMER_BALANCE.poolDeceleration = v, 0.02, 0, 2, 2),
            control('speed.baseDrag', '基础阻力', '速度越高越明显的线性阻力。', () => SWIMMER_BALANCE.baseDrag, (v) => SWIMMER_BALANCE.baseDrag = v, 0.02, 0, 2, 2),
            control('speed.highSpeedDrag', '高速阻力', '接近最高速度时增加的额外阻力，用来压住最高速附近的加速。', () => SWIMMER_BALANCE.highSpeedDrag, (v) => SWIMMER_BALANCE.highSpeedDrag = v, 0.02, 0, 2.5, 2),
            control('speed.aiCruiseAccel', 'AI巡航加速', 'AI 对手独立于玩家输入评分的持续推进加速度。值越高，AI 越容易保持速度；只影响 AI。', () => SWIMMER_BALANCE.aiCruiseAccel, (v) => SWIMMER_BALANCE.aiCruiseAccel = v, 0.05, 0, 6, 2),
            control('speed.perfectComboBoostInterval', 'P连击间隔', '每累计多少个 Perfect combo 触发一次超速奖励。设为 0 可以关闭这个奖励。', () => SWIMMER_BALANCE.perfectComboBoostInterval, (v) => SWIMMER_BALANCE.perfectComboBoostInterval = v, 1, 0, 50, 0),
            control('speed.perfectComboSpeedBonus', 'P奖励速度', 'Perfect combo 达到间隔时，直接加到当前速度上的奖励值。可以把速度推到最高速度以上。', () => SWIMMER_BALANCE.perfectComboSpeedBonus, (v) => SWIMMER_BALANCE.perfectComboSpeedBonus = v, 0.05, 0, 2, 2, 'm/s'),
            control('speed.perfectComboMaxOvercap', 'P超速上限', 'Perfect combo 奖励最多允许当前速度超出最高速度多少。值越高，连击爆发越明显。', () => SWIMMER_BALANCE.perfectComboMaxOvercap, (v) => SWIMMER_BALANCE.perfectComboMaxOvercap = v, 0.05, 0, 3, 2, 'm/s'),
            control('speed.perfectComboOvercapDecay', 'P超速衰减', 'Perfect combo 临时超速上限每秒下降的速度。值越高，超过最高速后的回落越快。', () => SWIMMER_BALANCE.perfectComboOvercapDecay, (v) => SWIMMER_BALANCE.perfectComboOvercapDecay = v, 0.05, 0, 3, 2, 'm/s/s'),
        ],
    },
    {
        name: '稳定性',
        controls: [
            control('stability.sampleWindowSize', '样本轮数', '稳定性计算使用最近多少轮动作的按住比例。窗口越大越看长期平稳，窗口越小反馈越敏感。', () => STABILITY_TUNING.sampleWindowSize, (v) => STABILITY_TUNING.sampleWindowSize = v, 1, 2, 8, 0),
            control('stability.perfectStdDev', '完美波动', '最近样本按住比例的标准差小于等于这个值时，波动评分为满分。', () => STABILITY_TUNING.perfectStdDev, (v) => STABILITY_TUNING.perfectStdDev = v, 0.005, 0, 0.2, 3),
            control('stability.badStdDev', '失稳波动', '最近样本按住比例的标准差达到这个值时，波动评分降到 0。', () => STABILITY_TUNING.badStdDev, (v) => STABILITY_TUNING.badStdDev = v, 0.005, 0.01, 0.5, 3),
            control('stability.minHoldSeconds', '最短长按', '本轮按住时间低于这个秒数时，稳定性直接算 0。用于防止极短快速连点也被算作有效稳定节奏。', () => STABILITY_TUNING.minHoldSeconds, (v) => STABILITY_TUNING.minHoldSeconds = v, 0.01, 0, 0.6, 2, 's'),
            control('stability.minUsefulRatio', '最低有效比例', '最近平均按住比例低于这个值时，认为虽然平稳但动作太短，不给稳定性奖励。', () => STABILITY_TUNING.minUsefulRatio, (v) => STABILITY_TUNING.minUsefulRatio = v, 0.02, 0, 0.8, 2),
            control('stability.maxUsefulRatio', '最高有效比例', '最近平均按住比例高于这个值时，认为动作几乎全程按住，不给完整稳定性奖励。', () => STABILITY_TUNING.maxUsefulRatio, (v) => STABILITY_TUNING.maxUsefulRatio = v, 0.02, 0.2, 1, 2),
            control('stability.usefulRatioEdgeWindow', '边缘过渡', '平均按住比例靠近有效区间边缘时的渐变宽度，避免奖励突然从 0 跳到 1。', () => STABILITY_TUNING.usefulRatioEdgeWindow, (v) => STABILITY_TUNING.usefulRatioEdgeWindow = v, 0.01, 0.01, 0.4, 2),
            control('stability.inputFreshnessGraceRatio', '提前宽容', '输入进入缓存后，等待时间占本轮动作时间低于这个比例时不惩罚。正常提前一点缓存仍可拿满收益。', () => STABILITY_TUNING.inputFreshnessGraceRatio, (v) => STABILITY_TUNING.inputFreshnessGraceRatio = v, 0.02, 0, 1, 2),
            control('stability.inputFreshnessPenaltyRatio', '提前惩罚', '超过提前宽容后，新鲜度从 1 平滑降到最低值所需的额外比例。值越小，狂按塞缓存越快被压收益。', () => STABILITY_TUNING.inputFreshnessPenaltyRatio, (v) => STABILITY_TUNING.inputFreshnessPenaltyRatio = v, 0.02, 0.05, 2, 2),
            control('stability.inputFreshnessMinScale', '最低新鲜度', '输入过早缓存时仍保留的最低收益比例。值越低，快速 AD 连打越难靠缓存刷到高速。', () => STABILITY_TUNING.inputFreshnessMinScale, (v) => STABILITY_TUNING.inputFreshnessMinScale = v, 0.05, 0, 1, 2),
        ],
    },
    {
        name: '动作',
        controls: [
            control('motion.heldMotionSpeedScale', '按住速度', '按住 A 或 D 时，对应手脚动作播放的速度倍率。', () => MOTION_TUNING.heldMotionSpeedScale, (v) => MOTION_TUNING.heldMotionSpeedScale = v, 0.05, 0.1, 3, 2),
            control('motion.releasedMotionSpeedScale', '松开速度', '松开 A 或 D 后，对应手脚把这一轮动作追完的速度倍率。', () => MOTION_TUNING.releasedMotionSpeedScale, (v) => MOTION_TUNING.releasedMotionSpeedScale = v, 0.05, 0.2, 6, 2),
            control('motion.armMinCyclesPerSecond', '手臂最低轮速', '低速时手臂动作每秒循环数。当前速度越高，会越接近动作轮速上限。', () => MOTION_TUNING.armMinCyclesPerSecond, (v) => MOTION_TUNING.armMinCyclesPerSecond = v, 0.05, 0.1, 3, 2),
            control('motion.kickMinCyclesPerSecond', '腿部最低轮速', '低速时腿部动作每秒循环数。当前速度越高，会越接近动作轮速上限。', () => MOTION_TUNING.kickMinCyclesPerSecond, (v) => MOTION_TUNING.kickMinCyclesPerSecond = v, 0.05, 0.1, 3, 2),
            control('motion.maxCyclesPerSecond', '动作轮速上限', '达到高速度时手脚动作每秒循环数的上限。数值越低，高速时一轮动作越长。', () => MOTION_TUNING.maxCyclesPerSecond, (v) => MOTION_TUNING.maxCyclesPerSecond = v, 0.1, 1, 5, 1),
            control('motion.animationSpeedScale', '动画倍率', '比赛和 debug model 共用的整体动作倍率，用来统一放慢或加快动作表现。', () => MOTION_TUNING.animationSpeedScale, (v) => MOTION_TUNING.animationSpeedScale = v, 0.05, 0.1, 1.5, 2),
            control('motion.swimBodyPitchDegrees', '游泳俯仰', '自由泳静止和游动时整个人的基础俯仰角，用来微调头肩与腿在水里的整体角度。', () => MOTION_TUNING.swimBodyPitchDegrees, (v) => MOTION_TUNING.swimBodyPitchDegrees = v, 0.5, -12, 12, 1, '°'),
            control('motion.swimBodyYOffset', '身体入水高度', '自由泳模型相对水面的整体高度补偿；负数会让身体更沉入水中，配合游泳俯仰一起调。', () => MOTION_TUNING.swimBodyYOffset, (v) => MOTION_TUNING.swimBodyYOffset = v, 0.02, -0.65, 0.16, 2),
            control('motion.handPalmTurnDegrees', '手臂旋前', '前伸入水时让掌心朝向池底的总旋前角度；旋转会分配到大臂、小臂和手腕，并在抱水和移臂阶段自动减弱。', () => MOTION_TUNING.handPalmTurnDegrees, (v) => MOTION_TUNING.handPalmTurnDegrees = v, 1, 0, 180, 0, '°'),
            control('motion.forwardArmSideClearance', '前伸手臂间距', '手臂前伸时上臂向身体外侧展开的幅度；小臂只继承少量外偏并继续主要朝前。', () => MOTION_TUNING.forwardArmSideClearance, (v) => MOTION_TUNING.forwardArmSideClearance = v, 0.01, 0.12, 0.7, 2),
            control('motion.rightBreathTurnDegrees', '右侧换气转角', '右手离水移臂时躯干、颈部和头部向右侧旋转的总角度。', () => MOTION_TUNING.rightBreathTurnDegrees, (v) => MOTION_TUNING.rightBreathTurnDegrees = v, 1, 0, 90, 0, '°'),
            control('motion.rightBreathBodyRollDegrees', '右侧换气身体滚转', '右手离水移臂时身体额外向右侧滚转的角度，与普通划水滚转叠加。', () => MOTION_TUNING.rightBreathBodyRollDegrees, (v) => MOTION_TUNING.rightBreathBodyRollDegrees = v, 1, 0, 45, 0, '°'),
            control('motion.freestyleAxisCenteringOffset', '轴线居中补偿', '自由泳身体左右滚转时给根骨的侧向补偿，主要用于俯视角下保持人物轴线贴近泳道中心。', () => FREESTYLE_POSE_TUNING.freestyleAxisCenteringOffset, (v) => FREESTYLE_POSE_TUNING.freestyleAxisCenteringOffset = v, 0.005, 0, 0.16, 3),
            control('motion.freestyleRightBreathAxisCenteringOffset', '右手轴线补偿', '右侧换气/右手移臂时额外叠加的侧向补偿；负值会把当前截图里偏左的身体往反方向拉回。', () => FREESTYLE_POSE_TUNING.freestyleRightBreathAxisCenteringOffset, (v) => FREESTYLE_POSE_TUNING.freestyleRightBreathAxisCenteringOffset = v, 0.005, -0.12, 0.12, 3),
            control('motion.freestyleRightBreathHeadTurnScale', '换气头颈强调', '右侧换气时只放大头颈扭动表现，不影响身体根骨轴线和泳道居中补偿。', () => FREESTYLE_POSE_TUNING.freestyleRightBreathHeadTurnScale, (v) => FREESTYLE_POSE_TUNING.freestyleRightBreathHeadTurnScale = v, 0.05, 0.5, 2.5, 2),
        ],
    },
];

export function resetTuningToDefaults() {
    applyTuningSnapshot(defaultTuningSnapshot());
}

export function saveCurrentTuning(): TuningSaveResult {
    const fileData = createTuningFileData();
    const projectPath = saveProjectTuningFile(fileData);
    const localStorageSaved = saveLocalStorageBackup(fileData);
    if (projectPath) {
        return {
            ok: true,
            storage: 'project',
            path: projectPath,
            message: `已保存到项目配置: ${projectPath}`,
        };
    }

    const nativePath = saveNativeTuningFile(fileData);
    if (nativePath) {
        return {
            ok: true,
            storage: 'native',
            path: nativePath,
            message: `已保存到运行目录: ${nativePath}`,
        };
    }

    if (localStorageSaved) {
        return {
            ok: true,
            storage: 'localStorage',
            message: '当前预览环境不能写项目文件，已临时保存到 localStorage',
        };
    }

    return {
        ok: false,
        storage: 'failed',
        message: '保存失败：当前环境不能写项目文件，也不能写 localStorage',
    };
}

export function loadSavedTuning(): boolean {
    try {
        defaultTuningSnapshot();
        const fileData = loadNativeTuningFile();
        if (fileData) {
            applyTuningSnapshot(getValuesFromTuningData(fileData));
            return true;
        }
        const raw = sys.localStorage.getItem(TUNING_STORAGE_KEY);
        if (!raw) {
            return false;
        }
        const data = JSON.parse(raw) as TuningFileData | Record<string, number>;
        applyTuningSnapshot(getValuesFromTuningData(data));
        return true;
    } catch (error) {
        console.warn('[SpeedSwimming] failed to load tuning settings', error);
        return false;
    }
}

export function loadSavedTuningAsync(onComplete: () => void) {
    defaultTuningSnapshot();
    resources.load(PROJECT_TUNING_RESOURCE, JsonAsset, (err, asset) => {
        if (!err && asset?.json) {
            applyTuningSnapshot(getValuesFromTuningData(asset.json as TuningFileData));
            console.log(`[SpeedSwimming] tuning loaded from project resource ${PROJECT_TUNING_ASSET_PATH}`);
            onComplete();
            return;
        }
        loadSavedTuning();
        onComplete();
    });
}

export function getProjectTuningAssetPath(): string {
    return PROJECT_TUNING_ASSET_PATH;
}

export function getNativeTuningFilePath(): string | null {
    if (!NATIVE) {
        return null;
    }
    const writablePath = native.fileUtils.getWritablePath();
    const dirPath = joinPath(writablePath, TUNING_FILE_DIR);
    return joinPath(dirPath, TUNING_FILE_NAME);
}

function control(
    id: string,
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
        id,
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
    forEachControl((control) => {
        snapshot[control.id] = control.get();
    });
    return snapshot;
}

function createTuningFileData(): TuningFileData {
    return {
        version: TUNING_FILE_VERSION,
        updatedAt: new Date().toISOString(),
        values: createTuningSnapshot(),
    };
}

function applyTuningSnapshot(snapshot: Record<string, number>) {
    forEachControl((control, group) => {
        const value = snapshot[control.id] ?? snapshot[`${group.name}.${control.label}`];
        if (typeof value === 'number' && Number.isFinite(value)) {
            control.set(value);
        }
    });
}

function getValuesFromTuningData(data: TuningFileData | Record<string, number>): Record<string, number> {
    const values = (data as TuningFileData).values;
    if (values && typeof values === 'object') {
        return values;
    }
    return data as Record<string, number>;
}

function saveProjectTuningFile(data: TuningFileData): string | null {
    const projectRoot = getEditorProjectPath();
    const fs = getNodeModule('fs');
    const path = getNodeModule('path');
    if (!projectRoot || !fs || !path) {
        return null;
    }
    try {
        const filePath = path.join(projectRoot, PROJECT_TUNING_ASSET_PATH);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        refreshEditorAsset(PROJECT_TUNING_ASSET_PATH);
        console.log(`[SpeedSwimming] tuning saved to project config ${filePath}`);
        return filePath;
    } catch (error) {
        console.warn('[SpeedSwimming] failed to save project tuning file', error);
        return null;
    }
}

function saveNativeTuningFile(data: TuningFileData): string | null {
    if (!NATIVE) {
        return null;
    }
    try {
        const filePath = getNativeTuningFilePath();
        if (!filePath) {
            return null;
        }
        const dirPath = joinPath(native.fileUtils.getWritablePath(), TUNING_FILE_DIR);
        native.fileUtils.createDirectory(dirPath);
        const saved = native.fileUtils.writeStringToFile(JSON.stringify(data, null, 2), filePath);
        if (saved) {
            console.log(`[SpeedSwimming] tuning saved to native writable path ${filePath}`);
            return filePath;
        }
    } catch (error) {
        console.warn('[SpeedSwimming] failed to save native tuning file', error);
    }
    return null;
}

function saveLocalStorageBackup(data: TuningFileData): boolean {
    try {
        sys.localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify(data));
        return true;
    } catch (error) {
        console.warn('[SpeedSwimming] failed to save tuning settings backup', error);
        return false;
    }
}

function loadNativeTuningFile(): TuningFileData | null {
    if (!NATIVE) {
        return null;
    }
    try {
        const filePath = getNativeTuningFilePath();
        if (!filePath || !native.fileUtils.isFileExist(filePath)) {
            return null;
        }
        const raw = native.fileUtils.getStringFromFile(filePath);
        if (!raw) {
            return null;
        }
        console.log(`[SpeedSwimming] tuning loaded from native writable path ${filePath}`);
        return JSON.parse(raw) as TuningFileData;
    } catch (error) {
        console.warn('[SpeedSwimming] failed to load native tuning file', error);
        return null;
    }
}

function getEditorProjectPath(): string | null {
    const globalAny = globalThis as Record<string, any>;
    const parentAny = globalAny.parent as Record<string, any> | undefined;
    return globalAny.Editor?.Project?.path
        ?? globalAny.Editor?.projectPath
        ?? globalAny.__projectPath
        ?? parentAny?.Editor?.Project?.path
        ?? parentAny?.Editor?.projectPath
        ?? null;
}

function getNodeModule(name: string): any | null {
    const globalAny = globalThis as Record<string, any>;
    const parentAny = globalAny.parent as Record<string, any> | undefined;
    const requireFn = globalAny.require ?? globalAny.window?.require ?? parentAny?.require ?? parentAny?.window?.require;
    if (!requireFn) {
        return null;
    }
    try {
        return requireFn(name);
    } catch {
        return null;
    }
}

function refreshEditorAsset(assetPath: string) {
    const globalAny = globalThis as Record<string, any>;
    const parentAny = globalAny.parent as Record<string, any> | undefined;
    const dbPath = `db://assets/${assetPath.replace(/^assets\//, '')}`;
    try {
        (globalAny.Editor ?? parentAny?.Editor)?.Message?.send?.('asset-db', 'refresh-asset', dbPath);
    } catch (error) {
        console.warn('[SpeedSwimming] failed to refresh tuning asset', error);
    }
}

function joinPath(left: string, right: string): string {
    if (!left) {
        return right;
    }
    const normalized = left.replace(/\\/g, '/');
    return `${normalized.endsWith('/') ? normalized.slice(0, -1) : normalized}/${right}`;
}

function forEachControl(callback: (control: TuningControl, group: TuningGroup) => void) {
    for (const group of TUNING_GROUPS) {
        for (const control of group.controls) {
            callback(control, group);
        }
    }
}
