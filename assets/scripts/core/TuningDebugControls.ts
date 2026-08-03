import { JsonAsset, native, resources, sys } from 'cc';
import { NATIVE } from 'cc/env';
import { CHARACTER_POSE_TUNING, FREESTYLE_POSE_TUNING, SWIMMER_ACTION_TUNING } from '../character/CharacterMotionTuning';
import { AI_STROKE_TUNING, AI_STRATEGY_TUNING } from '../competitor/CompetitorConfig';
import { RACE_CAMERA_TUNING } from '../camera/RaceCameraDirector';
import { CAMERA_SPEED_LINE_TUNING } from '../ui/CameraSpeedLineOverlay';
import { CONDITION_BALANCE, RACE_PHASE_BALANCE } from './ConditionBalance';
import { DIVE_BALANCE, getRaceDifficultyConfig, SWIMMER_BALANCE } from './GameBalance';
import { DOLPHIN_JUMP } from './DolphinJumpConfig';
import { ULTIMATE_ENERGY_BALANCE } from './UltimateEnergyBalance';
import { HeartRateZone } from '../condition/ConditionTypes';
import { INPUT_TUNING, MOTION_TUNING, RACE_DIFFICULTY_TUNING, STROKE_QUALITY_TUNING } from './InputTuning';
import { MAX_STEERING_HEADING_DEGREES, STEERING_TUNING } from './SteeringTuning';
import { applyWaterColorTuning, WATER_COLOR_TUNING } from '../venue/WaterColorTuning';
import { SWIMMER_COLLISION } from '../entity/SwimmerCollisionResolver';

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
const TUNING_FILE_VERSION = 20;

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
        name: '碰撞',
        controls: [
            control('collision.knockbackDepthFactor', '撞飞深度系数', '每米重叠产生的撞飞冲量（m/s）。嵌得越深撞得越狠。', () => SWIMMER_COLLISION.knockbackDepthFactor, (v) => SWIMMER_COLLISION.knockbackDepthFactor = v, 0.1, 0, 10, 2),
            control('collision.knockbackSpeedFactor', '撞飞速度系数', '每 m/s 相对靠近速度产生的撞飞冲量。迎面靠近快、撞得更狠。', () => SWIMMER_COLLISION.knockbackSpeedFactor, (v) => SWIMMER_COLLISION.knockbackSpeedFactor = v, 0.05, 0, 2, 2),
            control('collision.knockbackMaxImpulse', '撞飞最大冲量', '单个泳者撞飞速度上限（m/s），也限制累积缓冲，防止堆叠爆炸。', () => SWIMMER_COLLISION.knockbackMaxImpulse, (v) => SWIMMER_COLLISION.knockbackMaxImpulse = v, 0.1, 0, 6, 2, 'm/s'),
            control('collision.knockbackDecaySeconds', '撞飞衰减时间', '撞飞冲量指数衰减的时间常数（秒）。越大滑行越久。', () => SWIMMER_COLLISION.knockbackDecaySeconds, (v) => SWIMMER_COLLISION.knockbackDecaySeconds = v, 0.05, 0.05, 1.5, 2, 's'),
        ],
    },
    {
        name: '大招能量',
        controls: [
            control('ultimate.maxEnergy', '能量上限', '蓄气槽上限（点）。', () => ULTIMATE_ENERGY_BALANCE.maxEnergy, (v) => ULTIMATE_ENERGY_BALANCE.maxEnergy = v, 5, 50, 200, 0),
            control('ultimate.passivePerSecond', '被动增长/秒', '所有角色每秒被动获得的能量（低保）。', () => ULTIMATE_ENERGY_BALANCE.passivePerSecond, (v) => ULTIMATE_ENERGY_BALANCE.passivePerSecond = v, 0.1, 0, 5, 2, '/s'),
            control('ultimate.perfectGain', 'PERFECT 积攒', '每次 PERFECT 划水获得的能量。', () => ULTIMATE_ENERGY_BALANCE.perfectGain, (v) => ULTIMATE_ENERGY_BALANCE.perfectGain = v, 0.1, 0, 10, 1),
            control('ultimate.goodGain', 'GOOD 积攒', '每次 GOOD 划水获得的能量。', () => ULTIMATE_ENERGY_BALANCE.goodGain, (v) => ULTIMATE_ENERGY_BALANCE.goodGain = v, 0.1, 0, 5, 1),
            control('ultimate.comboEvery', '连击间隔', '每连续 PERFECT 这么多次给一次额外奖励。', () => ULTIMATE_ENERGY_BALANCE.comboEvery, (v) => ULTIMATE_ENERGY_BALANCE.comboEvery = v, 1, 2, 20, 0),
            control('ultimate.comboBonus', '连击奖励', '达成连击间隔时额外获得的能量。', () => ULTIMATE_ENERGY_BALANCE.comboBonus, (v) => ULTIMATE_ENERGY_BALANCE.comboBonus = v, 0.5, 0, 10, 1),
            control('ultimate.collisionBonus', '被撞补偿', '被撞飞时补偿的能量。', () => ULTIMATE_ENERGY_BALANCE.collisionBonus, (v) => ULTIMATE_ENERGY_BALANCE.collisionBonus = v, 0.5, 0, 20, 1),
            control('ultimate.collisionMinImpulse', '碰撞判定冲量', '收到的击退冲量超过该值才视为被撞飞。', () => ULTIMATE_ENERGY_BALANCE.collisionMinImpulse, (v) => ULTIMATE_ENERGY_BALANCE.collisionMinImpulse = v, 0.1, 0, 6, 1, 'm/s'),
            control('ultimate.collisionCooldownMs', '碰撞冷却', '同一角色两次碰撞补偿的最小间隔。', () => ULTIMATE_ENERGY_BALANCE.collisionCooldownMs, (v) => ULTIMATE_ENERGY_BALANCE.collisionCooldownMs = v, 50, 0, 2000, 0, 'ms'),
            control('ultimate.dolphinCost', '海豚跳消耗', '释放一次海豚跳消耗的能量；不足无法触发。', () => ULTIMATE_ENERGY_BALANCE.dolphinCost, (v) => ULTIMATE_ENERGY_BALANCE.dolphinCost = v, 1, 5, 100, 0),
        ],
    },
    {
        name: 'Flip Turn',
        controls: [
            control('motion.flipTurnToKeyframe1Seconds', 'To Keyframe 1', 'Seconds from the swim pose to flip-turn keyframe 1.', () => CHARACTER_POSE_TUNING.flipTurnToKeyframe1Seconds, (v) => CHARACTER_POSE_TUNING.flipTurnToKeyframe1Seconds = v, 0.05, 0.05, 2, 2, 's'),
            control('motion.flipTurnToKeyframe2Seconds', 'To Keyframe 2', 'Seconds from keyframe 1 to keyframe 2. The 180-degree rotation ends here.', () => CHARACTER_POSE_TUNING.flipTurnToKeyframe2Seconds, (v) => CHARACTER_POSE_TUNING.flipTurnToKeyframe2Seconds = v, 0.05, 0.05, 2, 2, 's'),
            control('motion.flipTurnReturnToSwimSeconds', 'Return To Swim', 'Seconds from keyframe 2 back to the normal swim pose.', () => CHARACTER_POSE_TUNING.flipTurnReturnToSwimSeconds, (v) => CHARACTER_POSE_TUNING.flipTurnReturnToSwimSeconds = v, 0.05, 0.05, 2, 2, 's'),
            control('motion.flipTurnArmReturnSeconds', 'Arm Return', 'Seconds for shoulders and arms to reach the swim pose during the final transition.', () => CHARACTER_POSE_TUNING.flipTurnArmReturnSeconds, (v) => CHARACTER_POSE_TUNING.flipTurnArmReturnSeconds = v, 0.05, 0.05, 1, 2, 's'),
            control('motion.flipTurnUnderwaterDepth', 'Underwater Depth', 'Depth reached at keyframe 1 and carried through the pose return into the post-turn underwater glide.', () => CHARACTER_POSE_TUNING.flipTurnUnderwaterDepth, (v) => CHARACTER_POSE_TUNING.flipTurnUnderwaterDepth = v, 0.05, 0, 1.5, 2, 'm'),
            control('motion.flipTurnUnderwaterGlideDepth', 'Glide Depth', 'Target depth reached by continuing downward after the wall push.', () => CHARACTER_POSE_TUNING.flipTurnUnderwaterGlideDepth, (v) => CHARACTER_POSE_TUNING.flipTurnUnderwaterGlideDepth = v, 0.05, 0, 2.5, 2, 'm'),
            control('motion.flipTurnUnderwaterDiveSeconds', 'Push Dive Time', 'Seconds spent moving downward from the turn pose into the deeper underwater glide.', () => CHARACTER_POSE_TUNING.flipTurnUnderwaterDiveSeconds, (v) => CHARACTER_POSE_TUNING.flipTurnUnderwaterDiveSeconds = v, 0.05, 0, 2, 2, 's'),
            control('motion.flipTurnUnderwaterDiveTiltDegrees', 'Push Dive Tilt', 'Maximum head-down body tilt while continuing downward after the wall push.', () => CHARACTER_POSE_TUNING.flipTurnUnderwaterDiveTiltDegrees, (v) => CHARACTER_POSE_TUNING.flipTurnUnderwaterDiveTiltDegrees = v, 0.5, 0, 30, 1, '°'),
            control('motion.flipTurnUnderwaterHoldSeconds', 'Underwater Hold', 'Seconds to remain at the deeper glide depth before rising. Only kicks are accepted.', () => CHARACTER_POSE_TUNING.flipTurnUnderwaterHoldSeconds, (v) => CHARACTER_POSE_TUNING.flipTurnUnderwaterHoldSeconds = v, 0.05, 0, 5, 2, 's'),
            control('motion.flipTurnUnderwaterRiseSeconds', 'Underwater Rise', 'Seconds used to rise from the deeper glide depth to surface freestyle after the hold.', () => CHARACTER_POSE_TUNING.flipTurnUnderwaterRiseSeconds, (v) => CHARACTER_POSE_TUNING.flipTurnUnderwaterRiseSeconds = v, 0.05, 0.1, 5, 2, 's'),
            control('motion.flipTurnUnderwaterRiseTiltDegrees', 'Rise Tilt', 'Maximum head-up body tilt during the post-turn ascent.', () => CHARACTER_POSE_TUNING.flipTurnUnderwaterRiseTiltDegrees, (v) => CHARACTER_POSE_TUNING.flipTurnUnderwaterRiseTiltDegrees = v, 0.5, 0, 30, 1, '°'),
            control('motion.flipTurnWallContactPadding', 'Wall Contact', 'Clearance from sampled foot/toe bone centers to the visible sole surface. Higher values keep both feet farther inside the pool.', () => CHARACTER_POSE_TUNING.flipTurnWallContactPadding, (v) => CHARACTER_POSE_TUNING.flipTurnWallContactPadding = v, 0.01, 0, 1, 2, 'm'),
            control('speed.flipTurnPushLaunchSpeed', 'Push Launch Speed', 'Initial speed reached by the wall push before underwater drag settles toward the restored cruise speed.', () => SWIMMER_BALANCE.flipTurnPushLaunchSpeed, (v) => SWIMMER_BALANCE.flipTurnPushLaunchSpeed = v, 0.1, 0, 10, 1, 'm/s'),
            control('speed.flipTurnUnderwaterGlideDrag', 'Push Glide Drag', 'Extra speed-proportional drag during the post-turn underwater glide. Normal water drag still applies.', () => SWIMMER_BALANCE.flipTurnUnderwaterGlideDrag, (v) => SWIMMER_BALANCE.flipTurnUnderwaterGlideDrag = v, 0.01, 0, 1, 2),
            control('speed.flipTurnDecelerationExponent', 'Deceleration Curve', 'Approach curve power (clamped 1-2). 1 spreads the slowdown evenly; 2 starts the turn later and sheds speed harder near the wall. Lane speed always reaches 0 exactly when the feet plant.', () => SWIMMER_BALANCE.flipTurnDecelerationExponent, (v) => SWIMMER_BALANCE.flipTurnDecelerationExponent = v, 0.1, 1, 2, 1),
            control('speed.flipTurnAccelerationExponent', 'Acceleration Curve', 'Wall-push curve power (clamped 1-2). 1 accelerates evenly off the wall; 2 builds speed later for a punchier launch into the underwater glide.', () => SWIMMER_BALANCE.flipTurnAccelerationExponent, (v) => SWIMMER_BALANCE.flipTurnAccelerationExponent = v, 0.1, 1, 2, 1),
            control('camera.flipTurnBackDistance', 'Camera Back', 'Underwater flip-turn camera distance behind the incoming swimmer.', () => RACE_CAMERA_TUNING.flipTurnBackDistance, (v) => RACE_CAMERA_TUNING.flipTurnBackDistance = v, 0.1, 0.5, 8, 1, 'm'),
            control('camera.flipTurnSideDistance', 'Camera Side', 'Side offset of the underwater flip-turn camera, clamped inside the pool.', () => RACE_CAMERA_TUNING.flipTurnSideDistance, (v) => RACE_CAMERA_TUNING.flipTurnSideDistance = v, 0.1, 0.5, 8, 1, 'm'),
            control('camera.flipTurnBelowDistance', 'Camera Below', 'Vertical distance below the swimmer target for the underwater flip-turn camera.', () => RACE_CAMERA_TUNING.flipTurnBelowDistance, (v) => RACE_CAMERA_TUNING.flipTurnBelowDistance = v, 0.05, 0.1, 1, 2, 'm'),
            control('camera.flipTurnFov', 'Camera FOV', 'Vertical field of view used while observing the complete flip turn underwater.', () => RACE_CAMERA_TUNING.flipTurnFov, (v) => RACE_CAMERA_TUNING.flipTurnFov = v, 1, 25, 80, 0, '°'),
        ],
    },
    {
        name: '输入',
        controls: [
            control('input.padStrokeDedupeMs', '触摸防连点', '同一侧触摸或屏幕按钮重复触发的过滤时间。只影响触摸/按钮输入，不影响键盘 A/D。', () => INPUT_TUNING.padStrokeDedupeMs, (v) => INPUT_TUNING.padStrokeDedupeMs = v, 5, 0, 180, 0, 'ms'),
        ],
    },
    {
        name: '海豚跃',
        controls: [
            control('dolphin.triggerHoldSeconds', '双手长按触发', '双手（左右屏幕各一指）同时长按多久触发海豚跃。太短会和普通双手划水冲突。', () => DOLPHIN_JUMP.triggerHoldSeconds, (v) => DOLPHIN_JUMP.triggerHoldSeconds = v, 0.05, 0.2, 1.2, 2, 's'),
            control('dolphin.minAvailableDistance', '最小可用距离', '距离前方池壁或终点不足这么多米时不允许起跳（临界处理）。', () => DOLPHIN_JUMP.minAvailableDistance, (v) => DOLPHIN_JUMP.minAvailableDistance = v, 0.5, 0.5, 15, 1, 'm'),
            control('dolphin.launchSpeed', '起跳速度', '离水弹射速度，越大飞得越远、越夸张。靠近池壁时会自动收窄以免飞出。', () => DOLPHIN_JUMP.launchSpeed, (v) => DOLPHIN_JUMP.launchSpeed = v, 0.5, 3, 16, 1, 'm/s'),
            control('dolphin.launchAngleDegrees', '起跳角度', '离水抛物线角度。越大越高越短，越小越平越远。', () => DOLPHIN_JUMP.launchAngleDegrees, (v) => DOLPHIN_JUMP.launchAngleDegrees = v, 1, 15, 70, 0, '°'),
            control('dolphin.gravity', '空中重力', '空中抛物线重力。越小滞空越久、飞得越夸张。', () => DOLPHIN_JUMP.gravity, (v) => DOLPHIN_JUMP.gravity = v, 0.5, 4, 30, 1),
            control('dolphin.dipDepth', '入水下潜深度', '起跳前短暂潜入水面的深度。', () => DOLPHIN_JUMP.dipDepth, (v) => DOLPHIN_JUMP.dipDepth = v, 0.05, 0, 1.5, 2, 'm'),
            control('dolphin.rollPerStrokeDegrees', '每次划水转体', '空中每次划水输入产生的轴向转体角度（左右反向）。', () => DOLPHIN_JUMP.rollPerStrokeDegrees, (v) => DOLPHIN_JUMP.rollPerStrokeDegrees = v, 30, 90, 720, 0, '°'),
            control('dolphin.rollEaseRate', '转体跟随速度', '轴向转体角度向输入目标追赶的速度。越大转得越快、越跟手。', () => DOLPHIN_JUMP.rollEaseRate, (v) => DOLPHIN_JUMP.rollEaseRate = v, 0.5, 2, 20, 1),
            control('dolphin.landingDepth', '落水下潜深度', '落水后潜入水下的深度，随后上浮恢复正常游泳。', () => DOLPHIN_JUMP.landingDepth, (v) => DOLPHIN_JUMP.landingDepth = v, 0.05, 0, 2, 2, 'm'),
            control('dolphin.landingExitSpeed', '落水出速', '落水下潜带出的速度，之后由水下阻力衰减回巡航速度。', () => DOLPHIN_JUMP.landingExitSpeed, (v) => DOLPHIN_JUMP.landingExitSpeed = v, 0.1, 0, 8, 1, 'm/s'),
            control('dolphin.landingRollUnwindSeconds', '转体回正时间', '落水后把残余轴向转体拉回正常游泳姿态所用的时间。', () => DOLPHIN_JUMP.landingRollUnwindSeconds, (v) => DOLPHIN_JUMP.landingRollUnwindSeconds = v, 0.05, 0.1, 2, 2, 's'),
            control('camera.dolphinBackDistance', '相机后距', '海豚跃跟随相机沿飞行切线在身后的基础距离。', () => RACE_CAMERA_TUNING.dolphinBackDistance, (v) => RACE_CAMERA_TUNING.dolphinBackDistance = v, 0.1, 0.5, 8, 1, 'm'),
            control('camera.dolphinApexPullback', '顶点拉远', '腾空到最高点时在基础后距上额外往后拉的距离，用来把整个跃起框进画面。', () => RACE_CAMERA_TUNING.dolphinApexPullback, (v) => RACE_CAMERA_TUNING.dolphinApexPullback = v, 0.1, 0, 5, 1, 'm'),
            control('camera.dolphinHeight', '相机抬高', '在切线跟拍基础上额外的世界向上抬高量（取景用，别调太大否则会削弱抛物线跟拍感）。', () => RACE_CAMERA_TUNING.dolphinHeight, (v) => RACE_CAMERA_TUNING.dolphinHeight = v, 0.05, -0.5, 2, 2, 'm'),
            control('camera.dolphinPitchFollow', '抛物线跟拍强度', '0=纯水平跟在身后；1=完全沿飞行切线跟拍。太高会显得死板，配合下面的“切线高度偏移”更灵动。', () => RACE_CAMERA_TUNING.dolphinPitchFollow, (v) => RACE_CAMERA_TUNING.dolphinPitchFollow = v, 0.05, 0, 1, 2),
            control('camera.dolphinTangentBias', '切线高度偏移', '相机相对飞行切线的渐变高度偏移(最陡俯仰时的米数)：出水上升时在切线下面(仰拍)、入水下降时在切线上面(俯冲)，顶点归零平滑过渡。0=完全贴切线。', () => RACE_CAMERA_TUNING.dolphinTangentBias, (v) => RACE_CAMERA_TUNING.dolphinTangentBias = v, 0.05, 0, 3, 2, 'm'),
            control('camera.dolphinMaxSubmerge', '相机最大入水深度', '相机在上升摆到身后下方时最多沉到水面以下多少米，防止扎太深。', () => RACE_CAMERA_TUNING.dolphinMaxSubmerge, (v) => RACE_CAMERA_TUNING.dolphinMaxSubmerge = v, 0.05, 0, 2, 2, 'm'),
            control('camera.dolphinFov', '相机 FOV', '海豚跃跟随相机的垂直视场角。', () => RACE_CAMERA_TUNING.dolphinFov, (v) => RACE_CAMERA_TUNING.dolphinFov = v, 1, 30, 80, 0, '°'),
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
        name: '冲刺与终点相机',
        controls: [
            control('race.sprintDistanceFromFinish', '冲刺触发距离', '距离终点还剩多少米时进入冲刺阶段。冲刺期间体力耗尽仍会显示，但不再施加质量和效率减益。', () => RACE_PHASE_BALANCE.sprintDistanceFromFinish, (v) => RACE_PHASE_BALANCE.sprintDistanceFromFinish = v, 1, 0, 100, 0, 'm'),
            control('camera.finishTopViewDistance', '终点俯视距离', '主角距终点还剩多少米时切到终点俯视镜头。设很小(≈0)=只有主角真正到达终点才切俯视，冲刺全程保持跟随。', () => RACE_CAMERA_TUNING.finishTopViewDistance, (v) => RACE_CAMERA_TUNING.finishTopViewDistance = v, 0.05, 0, 50, 2, 'm'),
            control('camera.sprintBackDistance', '冲刺镜头后距', '冲刺镜头位于主角上半身后方的距离。越小越接近第一人称，越大看到的人物越完整。', () => RACE_CAMERA_TUNING.sprintBackDistance, (v) => RACE_CAMERA_TUNING.sprintBackDistance = v, 0.1, 0.5, 8, 1, 'm'),
            control('camera.sprintKickPullbackDistance', '连续踢腿后拉', '冲刺镜头中连续踢腿时，在当前镜头后距上额外往后拉的距离。开始划水后会恢复原有后距。', () => RACE_CAMERA_TUNING.sprintKickPullbackDistance, (v) => RACE_CAMERA_TUNING.sprintKickPullbackDistance = v, 0.1, 0, 4, 1, 'm'),
            control('camera.sprintKickPullbackMinCadenceHz', '连续踢腿频率', '短点按形成的踢腿频率达到该值后，冲刺镜头才开始后拉。越高越需要快速连点。', () => RACE_CAMERA_TUNING.sprintKickPullbackMinCadenceHz, (v) => RACE_CAMERA_TUNING.sprintKickPullbackMinCadenceHz = v, 0.25, 0.5, 10, 2, 'Hz'),
            control('camera.sprintHeight', '冲刺镜头高度', '冲刺镜头相对主角上半身的向上高度。', () => RACE_CAMERA_TUNING.sprintHeight, (v) => RACE_CAMERA_TUNING.sprintHeight = v, 0.05, 0.2, 5, 2, 'm'),
            control('camera.sprintLookAhead', '冲刺镜头前看', '以主角上半身骨骼为基准，镜头目标向终点方向前移的距离。越小越聚焦上半身。', () => RACE_CAMERA_TUNING.sprintLookAhead, (v) => RACE_CAMERA_TUNING.sprintLookAhead = v, 0.1, 0, 6, 1, 'm'),
            control('camera.sprintFov', '冲刺镜头视野', '冲刺跟随镜头的垂直视野角度。越大画面越广，越小主角越大。', () => RACE_CAMERA_TUNING.sprintFov, (v) => RACE_CAMERA_TUNING.sprintFov = v, 1, 25, 80, 0, '°'),
            control('camera.sprintFollowSpeed', '冲刺前向跟随', '冲刺镜头前进/高度方向的跟随速度（每秒）。越高越紧跟，越低越拖影。', () => RACE_CAMERA_TUNING.sprintFollowSpeed, (v) => RACE_CAMERA_TUNING.sprintFollowSpeed = v, 0.5, 2, 30, 1, '/s'),
            control('camera.sprintLateralFollowSpeed', '冲刺横向跟随', '冲刺镜头左右(横向)跟随速度（每秒）。故意调慢，让人物蛇形偏移时先在画面里滑出去、相机再缓缓追上，玩家才感受得到偏移。越低偏移越明显、越拖。', () => RACE_CAMERA_TUNING.sprintLateralFollowSpeed, (v) => RACE_CAMERA_TUNING.sprintLateralFollowSpeed = v, 0.2, 0.5, 15, 1, '/s'),
            control('camera.speedLineThreshold', '速度线触发速度', '冲刺跟随镜头中，主角速度达到此值后开始出现漫画风格的屏幕速度线。', () => CAMERA_SPEED_LINE_TUNING.speedLineThreshold, (v) => CAMERA_SPEED_LINE_TUNING.speedLineThreshold = v, 0.1, 0, 8, 1, 'm/s'),
        ],
    },
    {
        name: '速度',
        controls: [
            control('speed.baseSpeed', '基础速度', '进入游泳阶段时的初始速度。跳水入水速度仍由跳水参数决定。', () => SWIMMER_BALANCE.baseSpeed, (v) => SWIMMER_BALANCE.baseSpeed = v, 0.05, 0, 2, 2, 'm/s'),
            control('speed.maxSpeed', '最高速度', '玩家常规游泳速度上限，也用于计算当前速度比例。', () => SWIMMER_BALANCE.maxSpeed, (v) => SWIMMER_BALANCE.maxSpeed = v, 0.05, 1, 6, 2, 'm/s'),
            control('speed.strokeBaseAccel', '基础动作加速', '每次划水动作开始播放时给的基础推进加速度（与松手时机无关的保底部分）。', () => SWIMMER_BALANCE.strokeBaseAccel, (v) => SWIMMER_BALANCE.strokeBaseAccel = v, 0.05, 0, 5, 2),
            control('speed.strokeQualityAccel', '划水质量加速', '松手时机质量为满分（落在甜区中心）时附加的推进加速度；质量越低按比例减少。这是划水的主要推进来源。', () => SWIMMER_BALANCE.strokeQualityAccel, (v) => SWIMMER_BALANCE.strokeQualityAccel = v, 0.05, 0, 8, 2),
            control('speed.strokeAccelDurationRatio', '加速持续', '一次动作加速度持续时间，占当前动作一轮时间的比例。越短越像“窜一下”，越长越像“持续推”。', () => SWIMMER_BALANCE.strokeAccelDurationRatio, (v) => SWIMMER_BALANCE.strokeAccelDurationRatio = v, 0.02, 0.05, 1.5, 2),
            control('speed.strokeImpulseSharpness', '冲刺锐度', '0=加速平均分布（顺滑）；越高=划水瞬间加速越猛、随后迅速回落，形成“窜出去再被水拖慢”的冲刺感。不改变整体速度，只改手感。', () => SWIMMER_BALANCE.strokeImpulseSharpness, (v) => SWIMMER_BALANCE.strokeImpulseSharpness = v, 0.05, 0, 1, 2),
            control('speed.kickAccelPerHz', '踢腿每频加速', '踢腿推进：每 1Hz 踢腿频率产生的加速度。点得越快频率越高、加速越快；点得慢加速慢。', () => SWIMMER_BALANCE.kickAccelPerHz, (v) => SWIMMER_BALANCE.kickAccelPerHz = v, 0.02, 0, 2, 2),
            control('speed.kickMaxSpeed', '踢腿速度上限', '单靠踢腿能达到的最高速度上限。应低于手臂 maxSpeed，让手臂才是主发动机。', () => SWIMMER_BALANCE.kickMaxSpeed, (v) => SWIMMER_BALANCE.kickMaxSpeed = v, 0.1, 0, 4, 1),
            control('speed.kickCeilingBand', '踢腿封顶缓冲', '接近踢腿速度上限前多大速度区间内加速度渐渐衰减到 0，让踢腿平滑贴近上限而不是硬顶。', () => SWIMMER_BALANCE.kickCeilingBand, (v) => SWIMMER_BALANCE.kickCeilingBand = v, 0.05, 0.05, 2, 2),
            control('speed.kickCadenceMaxHz', '踢腿推进频率上限', '踢腿【推进】的频率上限（次/秒）：超过这个频率不再加更多速度，防止爆点连击把速度拉爆。只限制推进，不影响腿动画速度。', () => SWIMMER_BALANCE.kickCadenceMaxHz, (v) => SWIMMER_BALANCE.kickCadenceMaxHz = v, 0.5, 1, 16, 1),
            control('speed.kickCadenceMeasureMaxHz', '踢腿测量安全阀', '频率测量的安全上限（次/秒），设很高只为防止两次点击间隔极小时数值爆掉。腿动画用这个值，正常手速几乎碰不到，相当于不限。', () => SWIMMER_BALANCE.kickCadenceMeasureMaxHz, (v) => SWIMMER_BALANCE.kickCadenceMeasureMaxHz = v, 1, 8, 40, 0),
            control('speed.poolDeceleration', '泳池减速', '泳池或场景提供的固定减速度。未来不同泳池可以配置不同数值。', () => SWIMMER_BALANCE.poolDeceleration, (v) => SWIMMER_BALANCE.poolDeceleration = v, 0.02, 0, 2, 2),
            control('speed.baseDrag', '基础阻力', '与速度成正比的线性阻力（∝ v）。', () => SWIMMER_BALANCE.baseDrag, (v) => SWIMMER_BALANCE.baseDrag = v, 0.02, 0, 2, 2),
            control('speed.highSpeedDrag', '高速阻力', '与速度平方成正比的二次阻力（∝ v²）。值越高，速度越快阻力增长越剧烈，低速时几乎没有影响。', () => SWIMMER_BALANCE.highSpeedDrag, (v) => SWIMMER_BALANCE.highSpeedDrag = v, 0.01, 0, 2.5, 2),
            control('speed.glideDrag', '潜水滑行阻力', '仅在跳水入水后的潜水滑行阶段叠加的额外阻力（∝ v）。越大越迫使玩家靠抖腿踢水维持速度，不踢就很快掉速；设 0 关闭。', () => SWIMMER_BALANCE.glideDrag, (v) => SWIMMER_BALANCE.glideDrag = v, 0.02, 0, 3, 2),
            control('speed.perfectComboMaxOvercap', '超速幅度上限', '跳水能把速度顶过最高速度上限多少。值越大,跳水入水速度优势越明显;值越小,跳水收益越低。设 0 则跳水不能超速。', () => SWIMMER_BALANCE.perfectComboMaxOvercap, (v) => SWIMMER_BALANCE.perfectComboMaxOvercap = v, 0.05, 0, 3, 2),
            control('speed.perfectComboOvercapDecay', '超速回落速率', '超出最高速度的那部分速度每秒回落多少。值越大掉得越快、跳水优势持续越短;值越小超速持续越久。', () => SWIMMER_BALANCE.perfectComboOvercapDecay, (v) => SWIMMER_BALANCE.perfectComboOvercapDecay = v, 0.05, 0, 3, 2),
        ],
    },
    {
        name: '划水',
        controls: [
            control('strokeQuality.minHoldSeconds', '划水起手门槛', '触摸/按键按住多久才从踢腿点击升级为手臂划水；短于这个秒数会保持为一次踢腿点击，不算划水、不判失误。', () => STROKE_QUALITY_TUNING.minHoldSeconds, (v) => STROKE_QUALITY_TUNING.minHoldSeconds = v, 0.01, 0, 0.6, 2, 's'),
            control('strokeQuality.goodStart', 'GOOD起点', 'GOOD 区间起点，范围 0..1。和 PERFECT 重叠的部分按 PERFECT 计算。', () => STROKE_QUALITY_TUNING.goodStart, (v) => STROKE_QUALITY_TUNING.goodStart = v, 0.01, 0, 1, 2),
            control('strokeQuality.goodEnd', 'GOOD终点', 'GOOD 区间终点，范围 0..1。终点必须大于起点。', () => STROKE_QUALITY_TUNING.goodEnd, (v) => STROKE_QUALITY_TUNING.goodEnd = v, 0.01, 0, 1, 2),
            control('strokeQuality.perfectStart', 'PERFECT起点', 'PERFECT 区间起点，范围 0..1。PERFECT 优先级高于 GOOD。', () => STROKE_QUALITY_TUNING.perfectStart, (v) => STROKE_QUALITY_TUNING.perfectStart = v, 0.01, 0, 1, 2),
            control('strokeQuality.perfectEnd', 'PERFECT终点', 'PERFECT 区间终点，范围 0..1。终点必须大于起点。', () => STROKE_QUALITY_TUNING.perfectEnd, (v) => STROKE_QUALITY_TUNING.perfectEnd = v, 0.01, 0, 1, 2),
            control('strokeQuality.qualityZoneScaleStrength', '质量甜区强度', '心率质量修正影响 PERFECT 甜区宽度的强度。0=关闭（PERFECT 宽度固定）；1=完全生效（最佳区放大约25%、低区收窄约30%）。默认0.5，明显但不抢戏。', () => STROKE_QUALITY_TUNING.qualityZoneScaleStrength, (v) => STROKE_QUALITY_TUNING.qualityZoneScaleStrength = v, 0.05, 0, 1, 2),
            control('strokeQuality.perfectVisualReleaseGraceSeconds', '黄色松手宽容', '角色确实显示过黄色后，补偿画面显示、玩家松手和触摸事件进入游戏的延迟；不会扩大提前松手的 PERFECT 区。', () => STROKE_QUALITY_TUNING.perfectVisualReleaseGraceSeconds, (v) => STROKE_QUALITY_TUNING.perfectVisualReleaseGraceSeconds = v, 0.01, 0, 0.2, 2, 's'),
            control('gesture.armStrokeTimeoutProgress', '超时圈数', '一直长按不松手时，手臂划水推进到整圈的这个比例后自动结束（手已出水），判为超时失误。0.5=半圈。', () => STROKE_QUALITY_TUNING.armStrokeTimeoutProgress, (v) => STROKE_QUALITY_TUNING.armStrokeTimeoutProgress = v, 0.05, 0.2, 1, 2),
            control('gesture.armStrokeTimeoutAccel', '超时失误加速', '划水超时失误时只给的很小推进加速度。用于惩罚一直按住不松手。', () => STROKE_QUALITY_TUNING.armStrokeTimeoutAccel, (v) => STROKE_QUALITY_TUNING.armStrokeTimeoutAccel = v, 0.01, 0, 1, 2),
            control('strokeQuality.armCycleLowSpeedPerSecond', '低速划水轮速', '速度低于“起爬速度”时手臂划水每秒的圈数（下限）。越低=低速时一圈越慢，甜区的实际时间窗口越宽（越好打）。', () => STROKE_QUALITY_TUNING.armCycleLowSpeedPerSecond, (v) => STROKE_QUALITY_TUNING.armCycleLowSpeedPerSecond = v, 0.02, 0.05, 3, 2),
            control('strokeQuality.armCycleHighSpeedPerSecond', '高速划水轮速', '速度达到“顶速速度”后手臂划水每秒的圈数（上限）。越高=高速时一圈越快，甜区的实际时间窗口越短（越难打）。', () => STROKE_QUALITY_TUNING.armCycleHighSpeedPerSecond, (v) => STROKE_QUALITY_TUNING.armCycleHighSpeedPerSecond = v, 0.05, 1, 6, 2),
            control('strokeQuality.armCycleSpeedStart', '起爬速度', '低于这个速度时轮速恒为下限；到达后才开始随速度加快。单位 m/s。', () => STROKE_QUALITY_TUNING.armCycleSpeedStart, (v) => STROKE_QUALITY_TUNING.armCycleSpeedStart = v, 0.1, 0, 6, 2, 'm/s'),
            control('strokeQuality.armCycleSpeedFull', '顶速速度', '到达这个速度时轮速升到上限；再快也不变。应大于“起爬速度”。单位 m/s。', () => STROKE_QUALITY_TUNING.armCycleSpeedFull, (v) => STROKE_QUALITY_TUNING.armCycleSpeedFull = v, 0.1, 0.1, 8, 2, 'm/s'),
            control('condition.efficiencyFloor', '效率地板', '体力耗尽时的效率下限。0=没力气完全游不动；0.5=还能以一半效率游。配合效率曲线指数使用。', () => CONDITION_BALANCE.efficiency.energyFloor, (v) => CONDITION_BALANCE.efficiency.energyFloor = v, 0.05, 0, 0.9, 2),
            control('condition.curveExponent', '效率曲线指数', '效率随体力衰减的曲线形状。1=线性；<1=缓启动（高体力几乎不掉，最后10%急跌）。0.3=陡峭缓启动。', () => CONDITION_BALANCE.efficiency.curveExponent, (v) => CONDITION_BALANCE.efficiency.curveExponent = v, 0.05, 0.1, 2, 2),
            control('condition.regenLow', '低区回血', '心率在低区时每秒回复的体力。越高回血越快。', () => CONDITION_BALANCE.energy.regenPerZone[HeartRateZone.LOW], (v) => CONDITION_BALANCE.energy.regenPerZone[HeartRateZone.LOW] = v, 0.05, 0, 5, 2),
            control('condition.regenOptimal', '最佳区回血', '心率在最佳区时每秒回复的体力。', () => CONDITION_BALANCE.energy.regenPerZone[HeartRateZone.OPTIMAL], (v) => CONDITION_BALANCE.energy.regenPerZone[HeartRateZone.OPTIMAL] = v, 0.05, 0, 5, 2),
            control('condition.regenHighPressure', '高压区回血', '心率在高压区时每秒回复的体力。', () => CONDITION_BALANCE.energy.regenPerZone[HeartRateZone.HIGH_PRESSURE], (v) => CONDITION_BALANCE.energy.regenPerZone[HeartRateZone.HIGH_PRESSURE] = v, 0.05, 0, 5, 2),
            control('condition.regenOverload', '过载区回血', '心率在过载区时每秒回复的体力。', () => CONDITION_BALANCE.energy.regenPerZone[HeartRateZone.OVERLOAD], (v) => CONDITION_BALANCE.energy.regenPerZone[HeartRateZone.OVERLOAD] = v, 0.05, 0, 3, 2),
            control('condition.regenSprintBoost', '冲刺回血加成', '冲刺阶段在所有心率区回血基础上额外增加的每秒回血。让终点段体力回升、形成情绪峰值。', () => CONDITION_BALANCE.energy.regenSprintBoost, (v) => CONDITION_BALANCE.energy.regenSprintBoost = v, 0.1, 0, 5, 2),
            control('difficulty.beginner.armCycleSpeedScale', '入门轮速倍率', '入门难度对低速和高速划水轮速的统一倍率。越低则单圈越慢、甜区实际时间窗口越宽。', () => RACE_DIFFICULTY_TUNING.beginner.armCycleSpeedScale, (v) => RACE_DIFFICULTY_TUNING.beginner.armCycleSpeedScale = v, 0.02, 0.2, 1.5, 2),
            control('difficulty.competitive.armCycleSpeedScale', '竞技轮速倍率', '竞技难度对低速和高速划水轮速的统一倍率。', () => RACE_DIFFICULTY_TUNING.competitive.armCycleSpeedScale, (v) => RACE_DIFFICULTY_TUNING.competitive.armCycleSpeedScale = v, 0.02, 0.2, 1.5, 2),
            control('difficulty.championship.armCycleSpeedScale', '世锦赛轮速倍率', '世锦赛难度对低速和高速划水轮速的统一倍率。1 表示完全使用基础轮速。', () => RACE_DIFFICULTY_TUNING.championship.armCycleSpeedScale, (v) => RACE_DIFFICULTY_TUNING.championship.armCycleSpeedScale = v, 0.02, 0.2, 1.5, 2),
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
            control('aiStrategy.effortEaseRate', '策略反应速度', 'AI 策略发力向目标靠拢的速率（每秒）。越低橡皮筋/追赶越隐形、越平滑；越高反应越快越明显。', () => AI_STRATEGY_TUNING.effortEaseRate, (v) => AI_STRATEGY_TUNING.effortEaseRate = v, 0.05, 0.1, 4, 2, '/s'),
            control('aiStrategy.rubberBandStrength', '橡皮筋强度', '落后玩家时 AI 额外发力的最大幅度（叠加到难度上）。越大追赶越猛、越容易被你甩不掉；0=完全不追赶。会按对手性格的竞争性缩放。', () => AI_STRATEGY_TUNING.rubberBandStrength, (v) => AI_STRATEGY_TUNING.rubberBandStrength = v, 0.01, 0, 0.4, 2),
            control('aiStrategy.rubberBandRange', '橡皮筋范围', '橡皮筋饱和所需的领先/落后米数。领先或落后玩家超过这个距离后追赶/收力达到最大。越大追赶越"温柔"。', () => AI_STRATEGY_TUNING.rubberBandRange, (v) => AI_STRATEGY_TUNING.rubberBandRange = v, 0.5, 2, 40, 1, 'm'),
            control('aiStrategy.duelBoost', '贴身缠斗强度', '玩家就在身边（缠斗范围内）时 AI 额外发力的最大幅度，制造你追我赶。越大贴身时越拼。', () => AI_STRATEGY_TUNING.duelBoost, (v) => AI_STRATEGY_TUNING.duelBoost = v, 0.01, 0, 0.3, 2),
            control('aiStrategy.duelRange', '缠斗触发距离', '与玩家的距离小于这个米数时进入贴身缠斗、额外发力。越大越早开始"较劲"。', () => AI_STRATEGY_TUNING.duelRange, (v) => AI_STRATEGY_TUNING.duelRange = v, 0.5, 0.5, 15, 1, 'm'),
            control('aiStrategy.maxModifier', '策略发力上限', '所有策略（配速+橡皮筋+缠斗）叠加后对难度的最大偏移。越小越"隐形"、越接近纯难度；越大策略影响越强。', () => AI_STRATEGY_TUNING.maxModifier, (v) => AI_STRATEGY_TUNING.maxModifier = v, 0.02, 0, 0.5, 2),
            control('aiStrategy.startFadeProgress', '起步发力衰减点', '性格里的"起步发力"在赛程进行到这个比例时衰减为 0。越大起步优势维持越久。', () => AI_STRATEGY_TUNING.startFadeProgress, (v) => AI_STRATEGY_TUNING.startFadeProgress = v, 0.02, 0.05, 0.6, 2),
            control('aiStrategy.finishRampStartProgress', '冲刺发力起点', '性格里的"后程冲刺"从赛程这个比例开始逐渐加满。越小冲刺发力开始得越早。', () => AI_STRATEGY_TUNING.finishRampStartProgress, (v) => AI_STRATEGY_TUNING.finishRampStartProgress = v, 0.02, 0.4, 0.95, 2),
            control('difficulty.beginner.aiDifficultyScale', '入门AI倍率', '入门比赛对每条泳道原始 AI 难度的倍率。越低，AI 松手更不稳定且划水间隔更长。', () => getRaceDifficultyConfig('beginner').aiDifficultyScale, (v) => getRaceDifficultyConfig('beginner').aiDifficultyScale = v, 0.02, 0.1, 1.5, 2),
            control('difficulty.competitive.aiDifficultyScale', '竞技AI倍率', '竞技比赛对每条泳道原始 AI 难度的倍率。', () => getRaceDifficultyConfig('competitive').aiDifficultyScale, (v) => getRaceDifficultyConfig('competitive').aiDifficultyScale = v, 0.02, 0.1, 1.5, 2),
            control('difficulty.championship.aiDifficultyScale', '世锦赛AI倍率', '世锦赛对每条泳道原始 AI 难度的倍率。1 表示完全使用原始 AI 阵容难度。', () => getRaceDifficultyConfig('championship').aiDifficultyScale, (v) => getRaceDifficultyConfig('championship').aiDifficultyScale = v, 0.02, 0.1, 1.5, 2),
            control('difficulty.beginner.rubberBandScale', '入门追赶倍率', '入门比赛对橡皮筋追赶强度的倍率。越低 AI 越不咬人、你越容易甩开。', () => getRaceDifficultyConfig('beginner').rubberBandScale, (v) => getRaceDifficultyConfig('beginner').rubberBandScale = v, 0.05, 0, 2, 2),
            control('difficulty.beginner.duelScale', '入门缠斗倍率', '入门比赛对贴身缠斗发力的倍率。越低 AI 贴身时越不较劲。', () => getRaceDifficultyConfig('beginner').duelScale, (v) => getRaceDifficultyConfig('beginner').duelScale = v, 0.05, 0, 2, 2),
            control('difficulty.beginner.weaveScale', '入门蛇形倍率', '入门比赛对 AI 蛇形/犯错倾向的倍率。越高对手越爱划歪、越好赢。', () => getRaceDifficultyConfig('beginner').weaveScale, (v) => getRaceDifficultyConfig('beginner').weaveScale = v, 0.05, 0, 3, 2),
            control('difficulty.competitive.rubberBandScale', '竞技追赶倍率', '竞技比赛对橡皮筋追赶强度的倍率。', () => getRaceDifficultyConfig('competitive').rubberBandScale, (v) => getRaceDifficultyConfig('competitive').rubberBandScale = v, 0.05, 0, 2, 2),
            control('difficulty.competitive.duelScale', '竞技缠斗倍率', '竞技比赛对贴身缠斗发力的倍率。', () => getRaceDifficultyConfig('competitive').duelScale, (v) => getRaceDifficultyConfig('competitive').duelScale = v, 0.05, 0, 2, 2),
            control('difficulty.competitive.weaveScale', '竞技蛇形倍率', '竞技比赛对 AI 蛇形/犯错倾向的倍率。', () => getRaceDifficultyConfig('competitive').weaveScale, (v) => getRaceDifficultyConfig('competitive').weaveScale = v, 0.05, 0, 3, 2),
            control('difficulty.championship.rubberBandScale', '世锦赛追赶倍率', '世锦赛对橡皮筋追赶强度的倍率。越高越甩不掉、领先也被反复追平。', () => getRaceDifficultyConfig('championship').rubberBandScale, (v) => getRaceDifficultyConfig('championship').rubberBandScale = v, 0.05, 0, 2.5, 2),
            control('difficulty.championship.duelScale', '世锦赛缠斗倍率', '世锦赛对贴身缠斗发力的倍率。越高贴身时越死拼。', () => getRaceDifficultyConfig('championship').duelScale, (v) => getRaceDifficultyConfig('championship').duelScale = v, 0.05, 0, 2.5, 2),
            control('difficulty.championship.weaveScale', '世锦赛蛇形倍率', '世锦赛对 AI 蛇形/犯错倾向的倍率。越低对手路线越干净专业。', () => getRaceDifficultyConfig('championship').weaveScale, (v) => getRaceDifficultyConfig('championship').weaveScale = v, 0.05, 0, 3, 2),
        ],
    },
    {
        name: '转向',
        controls: [
            control('steer.turnPerStroke', '单手转向', '每次单手划水把身体偏转的角度。右手→往左偏，左手→往右偏；左右交替或双手同划会抵消保持直线。越大越容易蛇形。', () => STEERING_TUNING.turnPerStroke, (v) => STEERING_TUNING.turnPerStroke = v, 1, 0, 40, 0, '°'),
            control('steer.maxHeading', '最大偏航', '身体相对泳道前进方向的最大偏转角。越大能歪得越狠；65°时前进速度约剩四成。运动模型有85°硬上限，连续单侧划水也不能掉头。', () => STEERING_TUNING.maxHeading, (v) => STEERING_TUNING.maxHeading = v, 1, 10, MAX_STEERING_HEADING_DEGREES, 0, '°'),

            control('steer.turnEaseRate', '转向平滑', '实际朝向向目标靠拢的速率（每秒）。划水在"松手"时改变转向目标，身体随后逐渐转过去而非瞬间硬转。越低转得越慢越懒，越高越干脆。', () => STEERING_TUNING.turnEaseRate, (v) => STEERING_TUNING.turnEaseRate = v, 0.1, 0.5, 12, 1, '/s'),
            control('steer.kickStraightenMinCadenceHz', '踢腿回正频率', '短点按形成的踢腿频率达到该值后，角色会逐渐转回泳道正前方。设为 0 时每次踢腿都会触发回正。', () => STEERING_TUNING.kickStraightenMinCadenceHz, (v) => STEERING_TUNING.kickStraightenMinCadenceHz = v, 0.25, 0, 10, 2, 'Hz'),
            control('steer.kickStraightenRate', '踢腿回正速度', '连续踢腿时将偏航目标拉回泳道方向的速度。角色仍按“转向平滑”逐渐跟随，不会瞬间掰正。设为 0 可关闭。', () => STEERING_TUNING.kickStraightenRate, (v) => STEERING_TUNING.kickStraightenRate = v, 0.1, 0, 8, 1, '/s'),
            control('steer.turnPowerMinFactor', '最弱转向倍率', '转向角与划水发力挂钩：按得越久、拉水行程越长偏得越多。这是最短划水的转向倍率（拉满=1.0）。1=不按力度缩放，每次都满角；越小轻点与重划的转向差别越大。', () => STEERING_TUNING.turnPowerMinFactor, (v) => STEERING_TUNING.turnPowerMinFactor = v, 0.05, 0, 1, 2),
            control('steer.aiCorrectHeadingRatio', 'AI纠偏阈值', 'AI 偏离多少（占“最大偏航”的比例）后开始主动往回划纠偏。越小 AI 越早纠偏、游得越直；越大越放任、蛇形越大。AI 与玩家共用同一套划水转向，只是自己决定划哪一侧。', () => STEERING_TUNING.aiCorrectHeadingRatio, (v) => STEERING_TUNING.aiCorrectHeadingRatio = v, 0.05, 0, 1, 2),
            control('steer.aiWanderChance', 'AI乱划概率', 'AI 接近直行时，打破整齐左右交替、重复同一侧（从而开始蛇形）的基础概率，实际按 (1-难度) 缩放：强对手几乎不乱划走直线，弱对手常乱划乱窜。', () => STEERING_TUNING.aiWanderChance, (v) => STEERING_TUNING.aiWanderChance = v, 0.05, 0, 1, 2),
            control('steer.poolWallClearance', '撞墙余量', '人物确定性包围体与泳池侧墙之间保留的最小距离（米），横向漂移到此就贴墙滑行。', () => STEERING_TUNING.poolWallClearance, (v) => STEERING_TUNING.poolWallClearance = v, 0.05, 0, 1.5, 2, 'm'),
            control('steer.poolBoundaryBodyHalfLength', '边界体半长', '用于撞墙和封道判定的人物确定性包围体半长。偏航越大，半长投影到横向越多；它不依赖当前骨骼动作。', () => STEERING_TUNING.poolBoundaryBodyHalfLength, (v) => STEERING_TUNING.poolBoundaryBodyHalfLength = v, 0.05, 0.5, 2.5, 2, 'm'),
            control('steer.poolBoundaryBodyHalfWidth', '边界体半宽', '用于撞墙和封道判定的人物确定性包围体半宽。直游时主要由该值决定贴墙距离；它不依赖角色模型或当前骨骼动作。', () => STEERING_TUNING.poolBoundaryBodyHalfWidth, (v) => STEERING_TUNING.poolBoundaryBodyHalfWidth = v, 0.05, 0.4, 1.5, 2, 'm'),
        ],
    },
    {
        name: '水色',
        controls: [
            waterControl('water.deepR', '深水色 R', '泳池水面基础色（深）的红通道，0-255。', () => WATER_COLOR_TUNING.deepR, (v) => WATER_COLOR_TUNING.deepR = v),
            waterControl('water.deepG', '深水色 G', '泳池水面基础色（深）的绿通道，0-255。绿偏高更偏青，偏低更偏蓝/紫。', () => WATER_COLOR_TUNING.deepG, (v) => WATER_COLOR_TUNING.deepG = v),
            waterControl('water.deepB', '深水色 B', '泳池水面基础色（深）的蓝通道，0-255。', () => WATER_COLOR_TUNING.deepB, (v) => WATER_COLOR_TUNING.deepB = v),
            waterControl('water.shallowR', '浅水色 R', '泳池水面高光色（浅）的红通道，0-255。', () => WATER_COLOR_TUNING.shallowR, (v) => WATER_COLOR_TUNING.shallowR = v),
            waterControl('water.shallowG', '浅水色 G', '泳池水面高光色（浅）的绿通道，0-255。', () => WATER_COLOR_TUNING.shallowG, (v) => WATER_COLOR_TUNING.shallowG = v),
            waterControl('water.shallowB', '浅水色 B', '泳池水面高光色（浅）的蓝通道，0-255。', () => WATER_COLOR_TUNING.shallowB, (v) => WATER_COLOR_TUNING.shallowB = v),
            control('water.tintStrength', '水色浓度', '水色盖在折射池底上的浓度：0=清透见底，1=纯水色几乎盖住池底。', () => WATER_COLOR_TUNING.tintStrength, (v) => { WATER_COLOR_TUNING.tintStrength = v; applyWaterColorTuning(); }, 0.02, 0, 1, 2),
            waterControl('water.surfaceR', '水面色 R', '直接指定的水面颜色红通道，0-255。配合“水面色浓度”明确设定水面看起来的颜色。', () => WATER_COLOR_TUNING.surfaceR, (v) => WATER_COLOR_TUNING.surfaceR = v),
            waterControl('water.surfaceG', '水面色 G', '直接指定的水面颜色绿通道，0-255。', () => WATER_COLOR_TUNING.surfaceG, (v) => WATER_COLOR_TUNING.surfaceG = v),
            waterControl('water.surfaceB', '水面色 B', '直接指定的水面颜色蓝通道，0-255。', () => WATER_COLOR_TUNING.surfaceB, (v) => WATER_COLOR_TUNING.surfaceB = v),
            control('water.surfaceStrength', '水面色浓度', '水面色盖过折射/焦散/浪花细节的强度：0=完全看折射，1=水面就是这个纯色。想“明确设水色”就把它调高。', () => WATER_COLOR_TUNING.surfaceStrength, (v) => { WATER_COLOR_TUNING.surfaceStrength = v; applyWaterColorTuning(); }, 0.02, 0, 1, 2),
            waterControl('water.bodyR', '入水身体蓝 R', '泳者水面以下身体染色的红通道，0-255。', () => WATER_COLOR_TUNING.bodyR, (v) => WATER_COLOR_TUNING.bodyR = v),
            waterControl('water.bodyG', '入水身体蓝 G', '泳者水面以下身体染色的绿通道，0-255。', () => WATER_COLOR_TUNING.bodyG, (v) => WATER_COLOR_TUNING.bodyG = v),
            waterControl('water.bodyB', '入水身体蓝 B', '泳者水面以下身体染色的蓝通道，0-255。', () => WATER_COLOR_TUNING.bodyB, (v) => WATER_COLOR_TUNING.bodyB = v),
            control('water.bodyStrength', '入水身体蓝浓度', '泳者水面以下身体染蓝的强度：0=不染，1=完全变成水下蓝色。', () => WATER_COLOR_TUNING.bodyStrength, (v) => { WATER_COLOR_TUNING.bodyStrength = v; applyWaterColorTuning(); }, 0.02, 0, 1, 2),
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

// A 0-255 colour-channel slider that pushes the change to the live water/
// swimmer materials after every edit.
function waterControl(
    id: string,
    label: string,
    description: string,
    get: () => number,
    set: (value: number) => void,
): TuningControl {
    return control(id, label, description, get, (value) => {
        set(value);
        applyWaterColorTuning();
    }, 1, 0, 255, 0);
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
    // Keep legacy ids only at this compatibility boundary so existing saved
    // tuning files load after the strokeQuality terminology migration.
    const renameLegacyKey = (legacyId: string, currentId: string) => {
        const value = snapshot[legacyId];
        if (migrated[currentId] === undefined && typeof value === 'number' && Number.isFinite(value)) {
            migrated[currentId] = value;
        }
    };
    renameLegacyKey('speed.strokeStabilityAccel', 'speed.strokeQualityAccel');
    for (const suffix of [
        'minHoldSeconds',
        'goodStart',
        'goodEnd',
        'perfectStart',
        'perfectEnd',
        'armCycleLowSpeedPerSecond',
        'armCycleHighSpeedPerSecond',
        'armCycleSpeedStart',
        'armCycleSpeedFull',
    ]) {
        renameLegacyKey(`stability.${suffix}`, `strokeQuality.${suffix}`);
    }
    const center = snapshot['stability.armReleaseSweetCenter'];
    const perfectHalf = snapshot['stability.armReleasePerfectHalfWidth'];
    const goodHalf = snapshot['stability.armReleaseGoodHalfWidth'];
    if (typeof center === 'number' && Number.isFinite(center)) {
        if (typeof goodHalf === 'number' && Number.isFinite(goodHalf)) {
            migrated['strokeQuality.goodStart'] ??= center - goodHalf;
            migrated['strokeQuality.goodEnd'] ??= center + goodHalf;
        }
        if (typeof perfectHalf === 'number' && Number.isFinite(perfectHalf)) {
            migrated['strokeQuality.perfectStart'] ??= center - perfectHalf;
            migrated['strokeQuality.perfectEnd'] ??= center + perfectHalf;
        }
    }
    return migrated;
}

function validateTuningRelations() {
    const safeMaxHeading = clamp(STEERING_TUNING.maxHeading, 0, MAX_STEERING_HEADING_DEGREES);
    if (safeMaxHeading !== STEERING_TUNING.maxHeading) {
        console.warn(
            `[SpeedSwimming] tuning adjusted: steer.maxHeading ` +
            `${STEERING_TUNING.maxHeading.toFixed(1)}° exceeded the safe forward-only range; ` +
            `set to ${safeMaxHeading.toFixed(1)}°`,
        );
        STEERING_TUNING.maxHeading = safeMaxHeading;
    }
    const timeoutProgress = clamp(STROKE_QUALITY_TUNING.armStrokeTimeoutProgress, 0.05, 1);
    const good = normalizeRange(STROKE_QUALITY_TUNING.goodStart, STROKE_QUALITY_TUNING.goodEnd, timeoutProgress, 'strokeQuality.good');
    STROKE_QUALITY_TUNING.goodStart = good.start;
    STROKE_QUALITY_TUNING.goodEnd = good.end;
    const perfect = normalizeRange(STROKE_QUALITY_TUNING.perfectStart, STROKE_QUALITY_TUNING.perfectEnd, timeoutProgress, 'strokeQuality.perfect');
    STROKE_QUALITY_TUNING.perfectStart = perfect.start;
    STROKE_QUALITY_TUNING.perfectEnd = perfect.end;
    STROKE_QUALITY_TUNING.perfectVisualReleaseGraceSeconds = clamp(
        STROKE_QUALITY_TUNING.perfectVisualReleaseGraceSeconds,
        0,
        0.2,
    );

    if (STROKE_QUALITY_TUNING.armCycleHighSpeedPerSecond < STROKE_QUALITY_TUNING.armCycleLowSpeedPerSecond) {
        console.warn(
            `[SpeedSwimming] tuning adjusted: strokeQuality.armCycleHighSpeedPerSecond ` +
            `${STROKE_QUALITY_TUNING.armCycleHighSpeedPerSecond.toFixed(3)} was below low-speed cycle ` +
            `${STROKE_QUALITY_TUNING.armCycleLowSpeedPerSecond.toFixed(3)}`,
        );
        STROKE_QUALITY_TUNING.armCycleHighSpeedPerSecond = STROKE_QUALITY_TUNING.armCycleLowSpeedPerSecond;
    }

    if (STROKE_QUALITY_TUNING.armCycleSpeedFull <= STROKE_QUALITY_TUNING.armCycleSpeedStart) {
        const fixed = STROKE_QUALITY_TUNING.armCycleSpeedStart + 0.1;
        console.warn(
            `[SpeedSwimming] tuning adjusted: strokeQuality.armCycleSpeedFull ` +
            `${STROKE_QUALITY_TUNING.armCycleSpeedFull.toFixed(3)} must be above strokeQuality.armCycleSpeedStart ` +
            `${STROKE_QUALITY_TUNING.armCycleSpeedStart.toFixed(3)}; set to ${fixed.toFixed(3)}`,
        );
        STROKE_QUALITY_TUNING.armCycleSpeedFull = fixed;
    }

    if (RACE_PHASE_BALANCE.sprintDistanceFromFinish < RACE_CAMERA_TUNING.finishTopViewDistance) {
        console.warn(
            `[SpeedSwimming] tuning adjusted: race.sprintDistanceFromFinish ` +
            `${RACE_PHASE_BALANCE.sprintDistanceFromFinish.toFixed(1)}m was below camera.finishTopViewDistance ` +
            `${RACE_CAMERA_TUNING.finishTopViewDistance.toFixed(1)}m`,
        );
        RACE_PHASE_BALANCE.sprintDistanceFromFinish = RACE_CAMERA_TUNING.finishTopViewDistance;
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
