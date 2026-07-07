import { JsonAsset, native, resources, sys } from 'cc';
import { NATIVE } from 'cc/env';
import { FREESTYLE_POSE_TUNING, SWIMMER_ACTION_TUNING } from '../character/CharacterMotionTuning';
import { AI_STROKE_TUNING } from '../competitor/CompetitorConfig';
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
            control('dive.underwaterHoldSeconds', '水下保持时间', '跳水入水后保持水下深度、只允许踢腿推进的时间。', () => SWIMMER_ACTION_TUNING.diveUnderwaterHoldSeconds, (v) => SWIMMER_ACTION_TUNING.diveUnderwaterHoldSeconds = v, 0.05, 0, 5, 2, 's'),
            control('dive.underwaterRiseSeconds', '水下上浮时间', '水下阶段从深度回升到水面的时间。上浮结束后才恢复手臂划水。', () => SWIMMER_ACTION_TUNING.diveUnderwaterRiseSeconds, (v) => SWIMMER_ACTION_TUNING.diveUnderwaterRiseSeconds = v, 0.05, 0.1, 5, 2, 's'),
            control('dive.straightenRatio', '斜下拉平占比', '水下保持阶段里，把入水斜下姿态拉回水平所用时间占比。越小越早变水平。', () => SWIMMER_ACTION_TUNING.diveStraightenRatio, (v) => SWIMMER_ACTION_TUNING.diveStraightenRatio = v, 0.05, 0.05, 1, 2),
            control('dive.underwaterRiseTilt', '上浮抬头角度', '上浮阶段身体斜上抬头的最大角度，到达水面时回到水平。', () => SWIMMER_ACTION_TUNING.diveUnderwaterRiseTiltDegrees, (v) => SWIMMER_ACTION_TUNING.diveUnderwaterRiseTiltDegrees = v, 0.5, 0, 30, 1, '°'),
        ],
    },
    {
        name: '速度',
        controls: [
            control('speed.baseSpeed', '基础速度', '进入游泳阶段时的初始速度。跳水入水速度仍由跳水参数决定。', () => SWIMMER_BALANCE.baseSpeed, (v) => SWIMMER_BALANCE.baseSpeed = v, 0.05, 0, 2, 2, 'm/s'),
            control('speed.maxSpeed', '最高速度', '玩家常规游泳速度上限，也用于计算当前速度比例。', () => SWIMMER_BALANCE.maxSpeed, (v) => SWIMMER_BALANCE.maxSpeed = v, 0.05, 1, 6, 2, 'm/s'),
            control('speed.strokeBaseAccel', '基础动作加速', '每次划水动作开始播放时给的基础推进加速度（与松手时机无关的保底部分）。', () => SWIMMER_BALANCE.strokeBaseAccel, (v) => SWIMMER_BALANCE.strokeBaseAccel = v, 0.05, 0, 5, 2),
            control('speed.strokeStabilityAccel', '划水质量加速', '松手时机质量为满分（落在甜区中心）时附加的推进加速度；质量越低按比例减少。这是划水的主要推进来源。', () => SWIMMER_BALANCE.strokeStabilityAccel, (v) => SWIMMER_BALANCE.strokeStabilityAccel = v, 0.05, 0, 8, 2),
            control('speed.strokeAccelDurationRatio', '加速持续', '一次动作加速度持续时间，占当前动作一轮时间的比例。越短越像“窜一下”，越长越像“持续推”。', () => SWIMMER_BALANCE.strokeAccelDurationRatio, (v) => SWIMMER_BALANCE.strokeAccelDurationRatio = v, 0.02, 0.05, 1.5, 2),
            control('speed.strokeImpulseSharpness', '冲刺锐度', '0=加速平均分布（顺滑）；越高=划水瞬间加速越猛、随后迅速回落，形成“窜出去再被水拖慢”的冲刺感。不改变整体速度，只改手感。', () => SWIMMER_BALANCE.strokeImpulseSharpness, (v) => SWIMMER_BALANCE.strokeImpulseSharpness = v, 0.05, 0, 1, 2),
            control('speed.diveUnderwaterKickAccel', '水下踢腿加速', '跳水入水后的潜水阶段，每次输入只触发腿部踢水时给的推进加速度。', () => SWIMMER_BALANCE.diveUnderwaterKickAccel, (v) => SWIMMER_BALANCE.diveUnderwaterKickAccel = v, 0.02, 0, 3, 2),
            control('speed.kickAccelPerHz', '踢腿每频加速', '踢腿推进：每 1Hz 踢腿频率产生的加速度。点得越快频率越高、加速越快；点得慢加速慢。', () => SWIMMER_BALANCE.kickAccelPerHz, (v) => SWIMMER_BALANCE.kickAccelPerHz = v, 0.02, 0, 2, 2),
            control('speed.kickMaxSpeed', '踢腿速度上限', '单靠踢腿能达到的最高速度上限。应低于手臂 maxSpeed，让手臂才是主发动机。', () => SWIMMER_BALANCE.kickMaxSpeed, (v) => SWIMMER_BALANCE.kickMaxSpeed = v, 0.1, 0, 4, 1),
            control('speed.kickCeilingBand', '踢腿封顶缓冲', '接近踢腿速度上限前多大速度区间内加速度渐渐衰减到 0，让踢腿平滑贴近上限而不是硬顶。', () => SWIMMER_BALANCE.kickCeilingBand, (v) => SWIMMER_BALANCE.kickCeilingBand = v, 0.05, 0.05, 2, 2),
            control('speed.kickCadenceMaxHz', '踢腿推进频率上限', '踢腿【推进】的频率上限（次/秒）：超过这个频率不再加更多速度，防止爆点连击把速度拉爆。只限制推进，不影响腿动画速度。', () => SWIMMER_BALANCE.kickCadenceMaxHz, (v) => SWIMMER_BALANCE.kickCadenceMaxHz = v, 0.5, 1, 16, 1),
            control('speed.kickCadenceMeasureMaxHz', '踢腿测量安全阀', '频率测量的安全上限（次/秒），设很高只为防止两次点击间隔极小时数值爆掉。腿动画用这个值，正常手速几乎碰不到，相当于不限。', () => SWIMMER_BALANCE.kickCadenceMeasureMaxHz, (v) => SWIMMER_BALANCE.kickCadenceMeasureMaxHz = v, 1, 8, 40, 0),
            control('speed.poolDeceleration', '泳池减速', '泳池或场景提供的固定减速度。未来不同泳池可以配置不同数值。', () => SWIMMER_BALANCE.poolDeceleration, (v) => SWIMMER_BALANCE.poolDeceleration = v, 0.02, 0, 2, 2),
            control('speed.baseDrag', '基础阻力', '与速度成正比的线性阻力（∝ v）。', () => SWIMMER_BALANCE.baseDrag, (v) => SWIMMER_BALANCE.baseDrag = v, 0.02, 0, 2, 2),
            control('speed.highSpeedDrag', '高速阻力', '与速度平方成正比的二次阻力（∝ v²）。值越高，速度越快阻力增长越剧烈，低速时几乎没有影响。', () => SWIMMER_BALANCE.highSpeedDrag, (v) => SWIMMER_BALANCE.highSpeedDrag = v, 0.01, 0, 2.5, 2),
        ],
    },
    {
        name: '划水',
        controls: [
            control('stability.minHoldSeconds', '划水起手门槛', '触摸/按键按住多久才从踢腿点击升级为手臂划水；短于这个秒数会保持为一次踢腿点击，不算划水、不判失误。', () => STABILITY_TUNING.minHoldSeconds, (v) => STABILITY_TUNING.minHoldSeconds = v, 0.01, 0, 0.6, 2, 's'),
            control('stability.goodStart', 'GOOD起点', 'GOOD 区间起点，范围 0..1。和 PERFECT 重叠的部分按 PERFECT 计算。', () => STABILITY_TUNING.goodStart, (v) => STABILITY_TUNING.goodStart = v, 0.01, 0, 1, 2),
            control('stability.goodEnd', 'GOOD终点', 'GOOD 区间终点，范围 0..1。终点必须大于起点。', () => STABILITY_TUNING.goodEnd, (v) => STABILITY_TUNING.goodEnd = v, 0.01, 0, 1, 2),
            control('stability.perfectStart', 'PERFECT起点', 'PERFECT 区间起点，范围 0..1。PERFECT 优先级高于 GOOD。', () => STABILITY_TUNING.perfectStart, (v) => STABILITY_TUNING.perfectStart = v, 0.01, 0, 1, 2),
            control('stability.perfectEnd', 'PERFECT终点', 'PERFECT 区间终点，范围 0..1。终点必须大于起点。', () => STABILITY_TUNING.perfectEnd, (v) => STABILITY_TUNING.perfectEnd = v, 0.01, 0, 1, 2),
            control('gesture.armStrokeTimeoutProgress', '超时圈数', '一直长按不松手时，手臂划水推进到整圈的这个比例后自动结束（手已出水），判为超时失误。0.5=半圈。', () => STABILITY_TUNING.armStrokeTimeoutProgress, (v) => STABILITY_TUNING.armStrokeTimeoutProgress = v, 0.05, 0.2, 1, 2),
            control('gesture.armStrokeTimeoutAccel', '超时失误加速', '划水超时失误时只给的很小推进加速度。用于惩罚一直按住不松手。', () => STABILITY_TUNING.armStrokeTimeoutAccel, (v) => STABILITY_TUNING.armStrokeTimeoutAccel = v, 0.01, 0, 1, 2),
            control('stability.armCycleLowSpeedPerSecond', '低速划水轮速', '速度为 0 时手臂划水每秒的圈数。越低=低速时一圈越慢，甜区的实际时间窗口越宽（越好打）。', () => STABILITY_TUNING.armCycleLowSpeedPerSecond, (v) => STABILITY_TUNING.armCycleLowSpeedPerSecond = v, 0.02, 0.05, 3, 2),
            control('stability.armCycleHighSpeedPerSecond', '高速划水轮速', '达到最高速时手臂划水每秒的圈数。越高=高速时一圈越快，甜区的实际时间窗口越短（越难打），速度起来后对操作要求更高。', () => STABILITY_TUNING.armCycleHighSpeedPerSecond, (v) => STABILITY_TUNING.armCycleHighSpeedPerSecond = v, 0.05, 1, 6, 2),
            control('stability.armCycleSpeedCurve', '轮速曲线', '低速轮速到高速轮速的过渡曲线。1=线性；>1 让窗口在中低速保持宽松、临近最高速才快速收紧。', () => STABILITY_TUNING.armCycleSpeedCurve, (v) => STABILITY_TUNING.armCycleSpeedCurve = v, 0.1, 0.2, 4, 1),
        ],
    },
    {
        name: '动作',
        controls: [
            control('motion.heldMotionSpeedScale', '按住速度', '按住 A 或 D 时，对应手脚动作播放的速度倍率。', () => MOTION_TUNING.heldMotionSpeedScale, (v) => MOTION_TUNING.heldMotionSpeedScale = v, 0.05, 0.1, 3, 2),
            control('motion.releasedMotionSpeedScale', '松开速度', '松开 A 或 D 后，对应手脚把这一轮动作追完的速度倍率。', () => MOTION_TUNING.releasedMotionSpeedScale, (v) => MOTION_TUNING.releasedMotionSpeedScale = v, 0.05, 0.2, 6, 2),
            control('motion.kickFlutterMaxCyclesPerSecond', 'AI打腿最高频率', '仅 AI：连续打腿在最高速时每秒的圈数。AI 腿频率随其速度缩放。（玩家腿已改为点击脉冲驱动，不受此影响）', () => MOTION_TUNING.kickFlutterMaxCyclesPerSecond, (v) => MOTION_TUNING.kickFlutterMaxCyclesPerSecond = v, 0.1, 0.5, 6, 1),
            control('motion.kickFlutterIdleFraction', 'AI打腿最低频率', '仅 AI：接近停止时保留的最低打腿频率（占最高频率的比例）。（玩家腿不受此影响）', () => MOTION_TUNING.kickFlutterIdleFraction, (v) => MOTION_TUNING.kickFlutterIdleFraction = v, 0.02, 0, 0.5, 2),
            control('motion.kickPulseMinCyclesPerSecond', '踢腿最低脉冲频率', '玩家踢腿的最低扫描频率（圈/秒）。腿会跟随你实际的点击频率抖动（点得越快越快，上限见 speed.踢腿频率上限），但不低于这个下限，保证单点/慢点也有明显快踢。', () => MOTION_TUNING.kickPulseMinCyclesPerSecond, (v) => MOTION_TUNING.kickPulseMinCyclesPerSecond = v, 0.1, 1, 12, 1),
            control('motion.kickPulseMaxCycles', '踢腿缓冲上限', '每条腿最多缓冲的踢腿次数。快速连点超过后会被丢弃，越小=停点后腿停得越干脆，越大=能囤更多下连续踢。', () => MOTION_TUNING.kickPulseMaxCycles, (v) => MOTION_TUNING.kickPulseMaxCycles = v, 1, 1, 5, 0),
            control('motion.kickSettleCyclesPerSecond', '踢腿收腿速度', '无输入、无划水时，腿把当前这半下补完回到直腿滑行姿势的速度（圈/秒）。越高=收腿越快回到滑行。', () => MOTION_TUNING.kickSettleCyclesPerSecond, (v) => MOTION_TUNING.kickSettleCyclesPerSecond = v, 0.1, 0.2, 4, 1),
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
    {
        name: 'AI对手',
        controls: [
            control('ai.timingSigmaLow', '低难度手感抖动', '难度=0 时 AI 松手时机的随机抖动幅度（甜区比例）。越大越容易划歪、失误越多；难度越高抖动越小。', () => AI_STROKE_TUNING.timingSigmaLow, (v) => AI_STROKE_TUNING.timingSigmaLow = v, 0.005, 0, 0.3, 3),
            control('ai.timingSigmaHigh', '高难度手感抖动', '难度=1 时 AI 松手时机的随机抖动幅度。接近 0 表示最强 AI 几乎每次都命中甜区中心（稳定满分）。', () => AI_STROKE_TUNING.timingSigmaHigh, (v) => AI_STROKE_TUNING.timingSigmaHigh = v, 0.001, 0, 0.1, 3),
            control('ai.maxReleaseProgress', 'AI最迟松手', 'AI 模拟松手的进度上限（占一圈的比例）。必须小于划水超时圈数，保证 AI 总在超时前松手。', () => AI_STROKE_TUNING.maxReleaseProgress, (v) => AI_STROKE_TUNING.maxReleaseProgress = v, 0.01, 0.2, 0.49, 2),
            control('ai.gapSecondsSlow', '低难度划水间隔', '难度=0 时，AI 松开一只手到按下另一只手之间的间隔秒数。越大划频越慢、越慢。', () => AI_STROKE_TUNING.gapSecondsSlow, (v) => AI_STROKE_TUNING.gapSecondsSlow = v, 0.01, 0, 0.6, 2, 's'),
            control('ai.gapSecondsFast', '高难度划水间隔', '难度=1 时的划水间隔秒数。越小划频越高、越快。最强 AI 用这个间隔。', () => AI_STROKE_TUNING.gapSecondsFast, (v) => AI_STROKE_TUNING.gapSecondsFast = v, 0.005, 0, 0.4, 3, 's'),
            control('ai.gapJitter', '划水间隔抖动', 'AI 每次划水间隔上下浮动的随机比例，让节奏不那么机械。', () => AI_STROKE_TUNING.gapJitter, (v) => AI_STROKE_TUNING.gapJitter = v, 0.02, 0, 0.8, 2),
            control('ai.startDelayMin', '起步延迟下限', 'AI 进入游泳阶段后，第一次划水前随机延迟的最小秒数。', () => AI_STROKE_TUNING.startDelayMin, (v) => AI_STROKE_TUNING.startDelayMin = v, 0.01, 0, 0.6, 2, 's'),
            control('ai.startDelayMax', '起步延迟上限', 'AI 进入游泳阶段后，第一次划水前随机延迟的最大秒数。', () => AI_STROKE_TUNING.startDelayMax, (v) => AI_STROKE_TUNING.startDelayMax = v, 0.01, 0, 0.8, 2, 's'),
            control('ai.maxHoldSeconds', 'AI保底松手时间', '兜底：AI 按住超过这个秒数还没等到目标进度就强制松手，防止卡住。', () => AI_STROKE_TUNING.maxHoldSeconds, (v) => AI_STROKE_TUNING.maxHoldSeconds = v, 0.05, 0.2, 1.5, 2, 's'),
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
    snapshot = migrateTuningSnapshot(snapshot);
    forEachControl((control, group) => {
        const value = snapshot[control.id] ?? snapshot[`${group.name}.${control.label}`];
        if (typeof value === 'number' && Number.isFinite(value)) {
            control.set(value);
        }
    });
    validateTuningRelations();
}

function migrateTuningSnapshot(snapshot: Record<string, number>): Record<string, number> {
    const migrated = { ...snapshot };
    const center = snapshot['stability.armReleaseSweetCenter'];
    const perfectHalf = snapshot['stability.armReleasePerfectHalfWidth'];
    const goodHalf = snapshot['stability.armReleaseGoodHalfWidth'];
    if (typeof center === 'number' && Number.isFinite(center)) {
        if (typeof goodHalf === 'number' && Number.isFinite(goodHalf)) {
            migrated['stability.goodStart'] ??= center - goodHalf;
            migrated['stability.goodEnd'] ??= center + goodHalf;
        }
        if (typeof perfectHalf === 'number' && Number.isFinite(perfectHalf)) {
            migrated['stability.perfectStart'] ??= center - perfectHalf;
            migrated['stability.perfectEnd'] ??= center + perfectHalf;
        }
    }
    return migrated;
}

function validateTuningRelations() {
    const timeoutProgress = clamp(STABILITY_TUNING.armStrokeTimeoutProgress, 0.05, 1);
    const good = normalizeRange(STABILITY_TUNING.goodStart, STABILITY_TUNING.goodEnd, timeoutProgress, 'stability.good');
    STABILITY_TUNING.goodStart = good.start;
    STABILITY_TUNING.goodEnd = good.end;
    const perfect = normalizeRange(STABILITY_TUNING.perfectStart, STABILITY_TUNING.perfectEnd, timeoutProgress, 'stability.perfect');
    STABILITY_TUNING.perfectStart = perfect.start;
    STABILITY_TUNING.perfectEnd = perfect.end;

    if (STABILITY_TUNING.armCycleHighSpeedPerSecond < STABILITY_TUNING.armCycleLowSpeedPerSecond) {
        console.warn(
            `[SpeedSwimming] tuning adjusted: stability.armCycleHighSpeedPerSecond ` +
            `${STABILITY_TUNING.armCycleHighSpeedPerSecond.toFixed(3)} was below low-speed cycle ` +
            `${STABILITY_TUNING.armCycleLowSpeedPerSecond.toFixed(3)}`,
        );
        STABILITY_TUNING.armCycleHighSpeedPerSecond = STABILITY_TUNING.armCycleLowSpeedPerSecond;
    }
}

function normalizeRange(startValue: number, endValue: number, maxEnd: number, label: string): { start: number; end: number } {
    let start = clamp(Math.min(startValue, endValue), 0, maxEnd);
    let end = clamp(Math.max(startValue, endValue), 0, maxEnd);
    if (end - start < 0.001) {
        end = clamp(start + 0.001, 0, maxEnd);
        start = Math.min(start, Math.max(0, end - 0.001));
    }
    if (Math.abs(start - startValue) > 0.0001 || Math.abs(end - endValue) > 0.0001) {
        console.warn(`[SpeedSwimming] tuning adjusted: ${label} range -> ${start.toFixed(3)}..${end.toFixed(3)}`);
    }
    return { start, end };
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
