import { CHARACTER_ABILITY_TUNING } from './CharacterAbilityConfig';
import { JsonAsset, native, resources, sys } from 'cc';
import { NATIVE } from 'cc/env';
import { CHARACTER_POSE_TUNING, FREESTYLE_POSE_TUNING, SWIMMER_ACTION_TUNING } from '../character/CharacterMotionTuning';
import { AI_STROKE_TUNING } from '../competitor/CompetitorConfig';
import { AI_PLANNER_TUNING } from '../competitor/AiRaceConfig';
import { RACE_CAMERA_TUNING } from '../camera/RaceCameraDirector';
import { CAMERA_SPEED_LINE_TUNING } from '../ui/CameraSpeedLineOverlay';
import { CONDITION_BALANCE, HEART_RATE_TUNING, RACE_PHASE_BALANCE } from './ConditionBalance';
import { TECHNIQUE_BALANCE, BURST_BALANCE, DIVE_BALANCE, SWIMMER_BALANCE } from './GameBalance';
import { DOLPHIN_JUMP } from './DolphinJumpConfig';
import { ULTIMATE_ENERGY_BALANCE } from './UltimateEnergyBalance';
import { INPUT_TUNING, MOTION_TUNING, STROKE_QUALITY_TUNING } from './InputTuning';
import { MAX_STEERING_HEADING_DEGREES, STEERING_TUNING } from './SteeringTuning';
import { applyWaterColorTuning, WATER_COLOR_TUNING } from '../venue/WaterColorTuning';
import { SWIMMER_COLLISION } from '../entity/SwimmerCollisionResolver';
import { AXIAL_ROLL_TUNING } from './AxialRollTuning';
import { COLLISION_PITCH_TUNING } from './CollisionPitchTuning';
import { COLLISION_SOFTNESS_TUNING } from './CollisionSoftnessTuning';

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
const TUNING_FILE_VERSION = 48;

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

type TuningLoadData = TuningFileData | Record<string, unknown>;

type TuningLoadSource = 'project' | 'native' | 'localStorage';

type TuningLoadCandidate = {
    source: TuningLoadSource;
    data: TuningLoadData;
    updatedAtMs: number | null;
    path?: string;
};

export const TUNING_GROUPS: TuningGroup[] = [
    {
        name: '角色能力',
        controls: [
            control('ability.frogPerfectWidth', '蛙妹完美区倍率', '角色固有能力参数，不随等级成长；修改后用于单机调试，联机各端需使用一致配置。', () => CHARACTER_ABILITY_TUNING.frogPerfectWidth, v => CHARACTER_ABILITY_TUNING.frogPerfectWidth = v, 0.1, 0.2, 2.5, 3),
            control('ability.frogPerfectReward', '蛙妹完美奖励倍率', '角色固有能力参数，不随等级成长；修改后用于单机调试，联机各端需使用一致配置。', () => CHARACTER_ABILITY_TUNING.frogPerfectReward, v => CHARACTER_ABILITY_TUNING.frogPerfectReward = v, 0.05, 0, 2, 3),
            control('ability.frogEnergyGain', '蛙少蓄气倍率', '角色固有能力参数，不随等级成长；修改后用于单机调试，联机各端需使用一致配置。', () => CHARACTER_ABILITY_TUNING.frogEnergyGain, v => CHARACTER_ABILITY_TUNING.frogEnergyGain = v, 0.1, 0.1, 3, 3),
            control('ability.frogDolphinSpeed', '蛙少海豚初速倍率', '角色固有能力参数，不随等级成长；修改后用于单机调试，联机各端需使用一致配置。', () => CHARACTER_ABILITY_TUNING.frogDolphinSpeed, v => CHARACTER_ABILITY_TUNING.frogDolphinSpeed = v, 0.05, 0.2, 2, 3),
            control('ability.frogDolphinCost', '蛙少海豚体力倍率', '角色固有能力参数，不随等级成长；修改后用于单机调试，联机各端需使用一致配置。', () => CHARACTER_ABILITY_TUNING.frogDolphinCost, v => CHARACTER_ABILITY_TUNING.frogDolphinCost = v, 0.1, 0, 2, 3),
            control('ability.legKickAcceleration', '超级腿踢腿推进倍率', '角色固有能力参数，不随等级成长；修改后用于单机调试，联机各端需使用一致配置。', () => CHARACTER_ABILITY_TUNING.legKickAcceleration, v => CHARACTER_ABILITY_TUNING.legKickAcceleration = v, 0.1, 0.1, 3, 3),
            control('ability.legKickSpeed', '超级腿踢腿上限倍率', '角色固有能力参数，不随等级成长；修改后用于单机调试，联机各端需使用一致配置。', () => CHARACTER_ABILITY_TUNING.legKickSpeed, v => CHARACTER_ABILITY_TUNING.legKickSpeed = v, 0.05, 0.1, 2, 3),
            control('ability.legStrokePower', '超级腿手划倍率', '角色固有能力参数，不随等级成长；修改后用于单机调试，联机各端需使用一致配置。', () => CHARACTER_ABILITY_TUNING.legStrokePower, v => CHARACTER_ABILITY_TUNING.legStrokePower = v, 0.05, 0.1, 2, 3),
            control('ability.catRecovery', '猫姐姿态恢复倍率', '角色固有能力参数，不随等级成长；修改后用于单机调试，联机各端需使用一致配置。', () => CHARACTER_ABILITY_TUNING.catRecovery, v => CHARACTER_ABILITY_TUNING.catRecovery = v, 0.1, 1, 3, 3),
            control('ability.ninjaPerfectWidth', '忍者哥完美区倍率', '角色固有能力参数，不随等级成长；修改后用于单机调试，联机各端需使用一致配置。', () => CHARACTER_ABILITY_TUNING.ninjaPerfectWidth, v => CHARACTER_ABILITY_TUNING.ninjaPerfectWidth = v, 0.05, 0.2, 2, 3),
            control('ability.ninjaPerfectReward', '忍者哥完美奖励倍率', '角色固有能力参数，不随等级成长；修改后用于单机调试，联机各端需使用一致配置。', () => CHARACTER_ABILITY_TUNING.ninjaPerfectReward, v => CHARACTER_ABILITY_TUNING.ninjaPerfectReward = v, 0.05, 0, 3, 3),
            control('ability.ninjaOtherReward', '忍者哥普通奖励倍率', '角色固有能力参数，不随等级成长；修改后用于单机调试，联机各端需使用一致配置。', () => CHARACTER_ABILITY_TUNING.ninjaOtherReward, v => CHARACTER_ABILITY_TUNING.ninjaOtherReward = v, 0.05, 0, 2, 3),
            control('ability.coachMaxStrokeHz', '教练适中划频上限', '角色固有能力参数，不随等级成长；修改后用于单机调试，联机各端需使用一致配置。', () => CHARACTER_ABILITY_TUNING.coachMaxStrokeHz, v => CHARACTER_ABILITY_TUNING.coachMaxStrokeHz = v, 0.1, 0.5, 4, 3),
            control('ability.coachHeartLoad', '教练适中划频心率负担', '角色固有能力参数，不随等级成长；修改后用于单机调试，联机各端需使用一致配置。', () => CHARACTER_ABILITY_TUNING.coachHeartLoad, v => CHARACTER_ABILITY_TUNING.coachHeartLoad = v, 0.05, 0.1, 1, 3),
            control('ability.wallLaunch', '飞毛腿蹬墙初速倍率', '角色固有能力参数，不随等级成长；修改后用于单机调试，联机各端需使用一致配置。', () => CHARACTER_ABILITY_TUNING.wallLaunch, v => CHARACTER_ABILITY_TUNING.wallLaunch = v, 0.05, 0.1, 3, 3),
            control('ability.wallStrokePower', '飞毛腿手划倍率', '角色固有能力参数，不随等级成长；修改后用于单机调试，联机各端需使用一致配置。', () => CHARACTER_ABILITY_TUNING.wallStrokePower, v => CHARACTER_ABILITY_TUNING.wallStrokePower = v, 0.05, 0.1, 2, 3),
            control('ability.diverDepth', '潜水哥最大下潜深度', '角色固有能力参数，不随等级成长；修改后用于单机调试，联机各端需使用一致配置。', () => CHARACTER_ABILITY_TUNING.diverDepth, v => CHARACTER_ABILITY_TUNING.diverDepth = v, 0.05, 0.5, 2, 3),
            control('ability.diverCollisionDepth', '潜水哥免碰撞深度', '角色固有能力参数，不随等级成长；修改后用于单机调试，联机各端需使用一致配置。', () => CHARACTER_ABILITY_TUNING.diverCollisionDepth, v => CHARACTER_ABILITY_TUNING.diverCollisionDepth = v, 0.05, 0.1, 2, 3),
            control('ability.diverDescentSpeed', '潜水哥下潜速度', '角色固有能力参数，不随等级成长；修改后用于单机调试，联机各端需使用一致配置。', () => CHARACTER_ABILITY_TUNING.diverDescentSpeed, v => CHARACTER_ABILITY_TUNING.diverDescentSpeed = v, 0.1, 0.1, 4, 3),
            control('ability.diverAscentSpeed', '潜水哥上浮速度', '角色固有能力参数，不随等级成长；修改后用于单机调试，联机各端需使用一致配置。', () => CHARACTER_ABILITY_TUNING.diverAscentSpeed, v => CHARACTER_ABILITY_TUNING.diverAscentSpeed = v, 0.1, 0.1, 4, 3),
            control('ability.diverKickHoldSeconds', '潜水哥踢腿保持秒数', '角色固有能力参数，不随等级成长；修改后用于单机调试，联机各端需使用一致配置。', () => CHARACTER_ABILITY_TUNING.diverKickHoldSeconds, v => CHARACTER_ABILITY_TUNING.diverKickHoldSeconds = v, 0.05, 0.05, 2, 3),
            control('ability.chainMaxStacks', '风火轮最大层数', '角色固有能力参数，不随等级成长。风火轮增幅是标准划水游速的校准目标，不放大跳跃与蹬墙。', () => CHARACTER_ABILITY_TUNING.chainMaxStacks, v => CHARACTER_ABILITY_TUNING.chainMaxStacks = v, 1, 1, 10, 0),
            control('ability.chainSpeedPerStack', '风火轮每层目标游速增幅', '角色固有能力参数，不随等级成长。风火轮增幅是标准划水游速的校准目标，不放大跳跃与蹬墙。', () => CHARACTER_ABILITY_TUNING.chainSpeedPerStack, v => CHARACTER_ABILITY_TUNING.chainSpeedPerStack = v, 0.005, 0, 0.05, 3),
            control('ability.chainIdleCycles', '风火轮停划宽限周期', '角色固有能力参数，不随等级成长。风火轮增幅是标准划水游速的校准目标，不放大跳跃与蹬墙。', () => CHARACTER_ABILITY_TUNING.chainIdleCycles, v => CHARACTER_ABILITY_TUNING.chainIdleCycles = v, 0.25, 1, 5, 3),
        ],
    },
    {
        name: '技巧',
        controls: [
            control('technique.speedGainPerPoint', '每点游速成长目标', '相对84点技巧，标准连续PERFECT每点约增加的基准游速比例。0.003表示每10点约3%；实际通过完整手臂推进实现，改变其他推进参数后需重新测算。0关闭技巧差异。', () => TECHNIQUE_BALANCE.speedGainPerPoint, (v) => TECHNIQUE_BALANCE.speedGainPerPoint = v, 0.0005, 0, 0.006, 4),
        ],
    },
    {
        name: '爆发力',
        controls: [
            control('burst.speedGainPerPoint', '跳水海豚每点增幅', '相对 50 点爆发力，每点增加的基准初速比例。0.006 表示每点 0.6%；仅跳水和海豚跳共用。', () => BURST_BALANCE.speedGainPerPoint, (v) => BURST_BALANCE.speedGainPerPoint = v, 0.001, 0, 0.012, 3),
            control('burst.wallSpeedGainPerPoint', '蹬墙每点增幅', '相对 50 点爆发力，每点增加的蹬墙基准初速比例。0.018 表示每点 1.8%；不改变翻滚时长、跳水或海豚跳。', () => BURST_BALANCE.wallSpeedGainPerPoint, (v) => BURST_BALANCE.wallSpeedGainPerPoint = v, 0.001, 0, 0.02, 3),
        ],
    },
    {
        name: '碰撞',
        controls: [
            control('collision.weightContrastExponent', '体重差异强度', '体重差异在碰撞分离、击退和转体中的放大强度。1 为原线性分配；6 时肌肉男撞蛙妹，肌肉男仅承担约 7% 的基础冲量。同体重仍各承担一半。', () => SWIMMER_COLLISION.weightContrastExponent, (v) => SWIMMER_COLLISION.weightContrastExponent = v, 0.5, 1, 8, 1),
            control('collision.knockbackDepthFactor', '撞飞深度系数', '每米重叠产生的撞飞冲量（m/s）。嵌得越深撞得越狠。', () => SWIMMER_COLLISION.knockbackDepthFactor, (v) => SWIMMER_COLLISION.knockbackDepthFactor = v, 0.1, 0, 10, 2),
            control('collision.knockbackSpeedFactor', '撞飞速度系数', '每 m/s 相对靠近速度产生的撞飞冲量。迎面靠近快、撞得更狠。', () => SWIMMER_COLLISION.knockbackSpeedFactor, (v) => SWIMMER_COLLISION.knockbackSpeedFactor = v, 0.05, 0, 2, 2),
            control('collision.knockbackMaxImpulse', '撞飞最大冲量', '单个泳者撞飞速度上限（m/s），也限制累积缓冲，防止堆叠爆炸。', () => SWIMMER_COLLISION.knockbackMaxImpulse, (v) => SWIMMER_COLLISION.knockbackMaxImpulse = v, 0.1, 0, 6, 2, 'm/s'),
            control('collision.knockbackDecaySeconds', '撞飞衰减时间', '撞飞冲量指数衰减的时间常数（秒）。越大滑行越久。', () => SWIMMER_COLLISION.knockbackDecaySeconds, (v) => SWIMMER_COLLISION.knockbackDecaySeconds = v, 0.05, 0.05, 1.5, 2, 's'),
            control('collision.headOnEscapeLateralFactor', '正撞横向脱困倍率', '迎面碰撞横向分量过小时，按各自加权碰撞冲量补足的横向倍率。0=关闭补足；越大越容易一次撞开后从两侧错身。', () => SWIMMER_COLLISION.headOnEscapeLateralFactor, (v) => SWIMMER_COLLISION.headOnEscapeLateralFactor = v, 0.05, 0, 1.5, 2),
            control('collision.headOnEscapeMaxImpulse', '正撞横向脱困上限', '迎面碰撞额外补足的单人横向速度上限。只限制人工补足，真实侧撞产生的横向分量不受此项削弱。', () => SWIMMER_COLLISION.headOnEscapeMaxImpulse, (v) => SWIMMER_COLLISION.headOnEscapeMaxImpulse = v, 0.1, 0, 4, 2, 'm/s'),
            control('collision.axialRollEnabled', '启用碰撞转体', '1=侧撞会给双方施加轴向角冲量；0=碰撞只产生位移和撞飞。', () => SWIMMER_COLLISION.axialRollEnabled, (v) => SWIMMER_COLLISION.axialRollEnabled = v, 1, 0, 1, 0),
            control('collision.axialRollDegreesPerImpulse', '碰撞转体强度', '每 1m/s 加权碰撞冲量转化出的轴向角速度。默认值允许普通碰撞翻半圈、强碰撞一圈或多圈；体重越轻越容易被转飞。', () => SWIMMER_COLLISION.axialRollDegreesPerImpulse, (v) => SWIMMER_COLLISION.axialRollDegreesPerImpulse = v, 10, 0, 720, 0, '°/s·m/s'),
            control('collision.axialRollMinimumLever', '碰撞最小转体力臂', '接近正面中心相撞时仍保留的最小转体比例。0=正撞只后退不翻；越大越容易让任何碰撞都产生明显翻滚。', () => SWIMMER_COLLISION.axialRollMinimumLever, (v) => SWIMMER_COLLISION.axialRollMinimumLever = v, 0.05, 0, 1, 2),
            control('collision.softEnabled', '启用碰撞松软', '仅改变骨骼表现。调试自由泳中 J/I/O 分别测试左侧、正面、右侧碰撞。', () => COLLISION_SOFTNESS_TUNING.enabled, (v) => COLLISION_SOFTNESS_TUNING.enabled = v, 1, 0, 1, 0),
            control('collision.softImpulseScale', '碰撞松软强度', '碰撞冲量带来的四肢松动程度，不影响推进和碰撞范围。', () => COLLISION_SOFTNESS_TUNING.impulseScale, (v) => COLLISION_SOFTNESS_TUNING.impulseScale = v, 1, 0, 20, 1),
            control('collision.softMinimumImpact', '松软最小冲量', '浅碰与侧擦的最低视觉反馈，按双方体重分配。只改变松软表现，不增加实际击退。0=关闭下限。', () => COLLISION_SOFTNESS_TUNING.minimumImpact, (v) => COLLISION_SOFTNESS_TUNING.minimumImpact = v, 0.1, 0, 2, 2),
            control('collision.softRelaxation', '碰撞松弛比例', '碰撞时松弛姿态替代划水姿态的最大比例。接近 1 时四肢明显失力，输入与推进继续计算。', () => COLLISION_SOFTNESS_TUNING.relaxation, (v) => COLLISION_SOFTNESS_TUNING.relaxation = v, 0.05, 0, 1, 2),
            control('collision.softRecoverySeconds', '松弛恢复时间', '松弛姿态恢复划水的缓和时间，越大越像四肢暂时失去力量。', () => COLLISION_SOFTNESS_TUNING.recoverySeconds, (v) => COLLISION_SOFTNESS_TUNING.recoverySeconds = v, 0.05, 0.15, 1.5, 2, 's'),
            control('collision.softFollowSpeed', '四肢跟随速度', '控制关节弹性回复速度。越小甩动越迟缓，肘膝和手脚由父关节运动带动。', () => COLLISION_SOFTNESS_TUNING.followSpeed, (v) => COLLISION_SOFTNESS_TUNING.followSpeed = v, 0.1, 0.3, 2, 2),
            control('collision.softFrequency', '松软回摆频率', '碰撞驱动信号的回摆频率，影响松弛持续过程。', () => COLLISION_SOFTNESS_TUNING.frequency, (v) => COLLISION_SOFTNESS_TUNING.frequency = v, 1, 6, 20, 1),
            control('collision.softDamping', '松软回摆阻尼', '数值越大，松动越快消退。实际值不超过回摆频率的 95%。', () => COLLISION_SOFTNESS_TUNING.damping, (v) => COLLISION_SOFTNESS_TUNING.damping = v, 0.5, 2, 12, 1),
            control('collision.softArmDegrees', '松软手臂幅度', '手臂接收碰撞冲量的幅度，越大甩臂和屈肘越明显；仍受关节限制。', () => COLLISION_SOFTNESS_TUNING.armDegrees, (v) => COLLISION_SOFTNESS_TUNING.armDegrees = v, 1, 0, 40, 0),
            control('collision.softLegDegrees', '松软腿部幅度', '腿部接收碰撞冲量的幅度，越大甩腿和屈膝越明显；仍受关节限制。', () => COLLISION_SOFTNESS_TUNING.legDegrees, (v) => COLLISION_SOFTNESS_TUNING.legDegrees = v, 1, 0, 30, 0),
            control('collision.pitchEnabled', '启用碰撞前后翻', '1=纵向碰撞会触发头脚方向的低维布娃娃俯仰；0=保持原有碰撞。普通划水不会驱动该状态。', () => COLLISION_PITCH_TUNING.enabled, (v) => COLLISION_PITCH_TUNING.enabled = v, 1, 0, 1, 0),
            control('collision.pitchDegreesPerImpulse', '碰撞前后翻强度', '每 1m/s 纵向加权冲量转化出的俯仰角速度。追尾者减速时头端下扎，被追尾者加速时反向后仰。', () => COLLISION_PITCH_TUNING.degreesPerLongitudinalImpulse, (v) => COLLISION_PITCH_TUNING.degreesPerLongitudinalImpulse = v, 10, 0, 540, 0, '°/s·m/s'),
            control('collision.pitchRightingTorque', '前后翻回正力', '水面对碰撞俯仰的复原力矩。越大越快拉回正常头朝前的水平姿态；强撞仍可越过竖直位置完成前翻。', () => COLLISION_PITCH_TUNING.rightingTorque, (v) => COLLISION_PITCH_TUNING.rightingTorque = v, 5, 0, 360, 0, '°/s²'),
            control('collision.pitchAngularDrag', '前后翻阻尼', '前后翻角速度的水阻。越大越像沉重浮筒、较快停下；越小越接近松软布娃娃并可能继续翻圈。', () => COLLISION_PITCH_TUNING.angularDrag, (v) => COLLISION_PITCH_TUNING.angularDrag = v, 0.1, 0, 8, 2, '/s'),
            control('collision.pitchMaxAngularSpeed', '前后翻最大角速度', '碰撞俯仰角速度硬上限，限制多体堆撞时的极端旋转。', () => COLLISION_PITCH_TUNING.maxAngularSpeed, (v) => COLLISION_PITCH_TUNING.maxAngularSpeed = v, 20, 90, 1080, 0, '°/s'),
            control('collision.pitchTreadTolerance', '前后翻踩水容差', '俯仰偏离水平超过该角度时禁止切入普通竖直踩水，直到碰撞姿态基本恢复。', () => COLLISION_PITCH_TUNING.treadWaterToleranceDegrees, (v) => COLLISION_PITCH_TUNING.treadWaterToleranceDegrees = v, 1, 1, 45, 0, '°'),
            control('collision.pitchPenaltyStart', '前后翻掉速起始速度', '俯仰角速度达到多少后开始额外损失推进；人物接近竖直时也会按角度自然损失推进。', () => COLLISION_PITCH_TUNING.tumblePenaltyStartAngularSpeed, (v) => COLLISION_PITCH_TUNING.tumblePenaltyStartAngularSpeed = v, 5, 0, 240, 0, '°/s'),
            control('collision.pitchPenaltyFull', '前后翻掉速拉满速度', '俯仰角速度达到多少时降至最低推进倍率。', () => COLLISION_PITCH_TUNING.tumblePenaltyFullAngularSpeed, (v) => COLLISION_PITCH_TUNING.tumblePenaltyFullAngularSpeed = v, 5, 20, 540, 0, '°/s'),
            control('collision.pitchMinForwardScale', '前后翻最低推进', '快速前后翻或接近竖直时至少保留的推进效率。', () => COLLISION_PITCH_TUNING.minForwardScale, (v) => COLLISION_PITCH_TUNING.minForwardScale = v, 0.02, 0, 1, 2),
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
            control('ultimate.dolphinCost', '海豚跳大招消耗', '释放海豚跳大招所需的蓄气；始终与能量上限一致，保证蓄满后释放并清空。', () => ULTIMATE_ENERGY_BALANCE.dolphinCost, (v) => ULTIMATE_ENERGY_BALANCE.dolphinCost = v, 1, 50, 200, 0),
        ],
    },
    {
        name: '翻滚转身',
        controls: [
            control('motion.flipTurnToKeyframe1Seconds', '进入关键姿势1', '从常规游泳姿势过渡到翻滚转身关键姿势1所需的时间。', () => CHARACTER_POSE_TUNING.flipTurnToKeyframe1Seconds, (v) => CHARACTER_POSE_TUNING.flipTurnToKeyframe1Seconds = v, 0.05, 0.05, 2, 2, 's'),
            control('motion.flipTurnToKeyframe2Seconds', '进入关键姿势2', '从关键姿势1过渡到关键姿势2所需的时间；180度翻转在这里完成。', () => CHARACTER_POSE_TUNING.flipTurnToKeyframe2Seconds, (v) => CHARACTER_POSE_TUNING.flipTurnToKeyframe2Seconds = v, 0.05, 0.05, 2, 2, 's'),
            control('motion.flipTurnReturnToSwimSeconds', '恢复游泳姿势', '从关键姿势2恢复到常规游泳姿势所需的时间。', () => CHARACTER_POSE_TUNING.flipTurnReturnToSwimSeconds, (v) => CHARACTER_POSE_TUNING.flipTurnReturnToSwimSeconds = v, 0.05, 0.05, 2, 2, 's'),
            control('motion.flipTurnArmReturnSeconds', '手臂回位时间', '最后一段过渡中，肩膀和手臂恢复到游泳姿势所需的时间。', () => CHARACTER_POSE_TUNING.flipTurnArmReturnSeconds, (v) => CHARACTER_POSE_TUNING.flipTurnArmReturnSeconds = v, 0.05, 0.05, 1, 2, 's'),
            control('motion.flipTurnUnderwaterDepth', '转身水下深度', '到达关键姿势1时的水下深度；恢复姿势期间会保持该深度，然后进入蹬墙后的水下滑行。', () => CHARACTER_POSE_TUNING.flipTurnUnderwaterDepth, (v) => CHARACTER_POSE_TUNING.flipTurnUnderwaterDepth = v, 0.05, 0, 1.5, 2, 'm'),
            control('motion.flipTurnUnderwaterGlideDepth', '滑行目标深度', '蹬墙后继续向下移动所要达到的水下滑行目标深度，不得浅于转身水下深度。', () => CHARACTER_POSE_TUNING.flipTurnUnderwaterGlideDepth, (v) => CHARACTER_POSE_TUNING.flipTurnUnderwaterGlideDepth = v, 0.05, 0, 2.5, 2, 'm'),
            control('motion.flipTurnUnderwaterDiveSeconds', '蹬墙下潜时间', '从转身姿势向下移动到更深滑行位置所需的时间。', () => CHARACTER_POSE_TUNING.flipTurnUnderwaterDiveSeconds, (v) => CHARACTER_POSE_TUNING.flipTurnUnderwaterDiveSeconds = v, 0.05, 0, 2, 2, 's'),
            control('motion.flipTurnUnderwaterDiveTiltDegrees', '蹬墙下潜俯角', '蹬墙后继续下潜时，身体头部向下倾斜的最大角度。', () => CHARACTER_POSE_TUNING.flipTurnUnderwaterDiveTiltDegrees, (v) => CHARACTER_POSE_TUNING.flipTurnUnderwaterDiveTiltDegrees = v, 0.5, 0, 30, 1, '°'),
            control('motion.flipTurnUnderwaterHoldSeconds', '水下停留时间', '到达较深滑行位置后、开始上浮前的保持时间；这一阶段只接受打腿输入。', () => CHARACTER_POSE_TUNING.flipTurnUnderwaterHoldSeconds, (v) => CHARACTER_POSE_TUNING.flipTurnUnderwaterHoldSeconds = v, 0.05, 0, 5, 2, 's'),
            control('motion.flipTurnUnderwaterRiseSeconds', '水下上浮时间', '停留结束后，从较深滑行位置上浮并恢复水面自由泳所需的时间。', () => CHARACTER_POSE_TUNING.flipTurnUnderwaterRiseSeconds, (v) => CHARACTER_POSE_TUNING.flipTurnUnderwaterRiseSeconds = v, 0.05, 0.1, 5, 2, 's'),
            control('motion.flipTurnUnderwaterRiseTiltDegrees', '上浮仰角', '转身后上浮过程中，身体头部向上倾斜的最大角度。', () => CHARACTER_POSE_TUNING.flipTurnUnderwaterRiseTiltDegrees, (v) => CHARACTER_POSE_TUNING.flipTurnUnderwaterRiseTiltDegrees = v, 0.5, 0, 30, 1, '°'),
            control('motion.flipTurnWallContactPadding', '脚掌贴墙余量', '脚部骨骼采样点到可见脚底表面的补偿距离；数值越大，两只脚会更深入池壁。', () => CHARACTER_POSE_TUNING.flipTurnWallContactPadding, (v) => CHARACTER_POSE_TUNING.flipTurnWallContactPadding = v, 0.01, 0, 1, 2, 'm'),
            control('speed.flipTurnPushLaunchSpeed', '蹬墙初速度', '蹬墙后立即获得的初始速度；随后水下阻力会让速度逐渐回落到正常巡航速度。', () => SWIMMER_BALANCE.flipTurnPushLaunchSpeed, (v) => SWIMMER_BALANCE.flipTurnPushLaunchSpeed = v, 0.1, 0, 10, 1, 'm/s'),
            control('speed.flipTurnUnderwaterGlideDrag', '水下滑行额外阻力', '转身后水下滑行阶段额外增加的速度比例阻力；常规水阻仍然生效。', () => SWIMMER_BALANCE.flipTurnUnderwaterGlideDrag, (v) => SWIMMER_BALANCE.flipTurnUnderwaterGlideDrag = v, 0.01, 0, 1, 2),
            control('speed.flipTurnDecelerationExponent', '接近池壁减速曲线', '接近池壁时的减速曲线指数，范围1到2。1表示均匀减速；2表示前段保持速度更久、临近池壁时减速更急。双脚贴墙时前进速度一定降到0。', () => SWIMMER_BALANCE.flipTurnDecelerationExponent, (v) => SWIMMER_BALANCE.flipTurnDecelerationExponent = v, 0.1, 1, 2, 1),
            control('speed.flipTurnAccelerationExponent', '蹬墙加速曲线', '蹬墙时的加速曲线指数，范围1到2。1表示均匀加速；2表示后段加速更强，蹬墙进入水下滑行时更有爆发感。', () => SWIMMER_BALANCE.flipTurnAccelerationExponent, (v) => SWIMMER_BALANCE.flipTurnAccelerationExponent = v, 0.1, 1, 2, 1),
            control('camera.flipTurnBackDistance', '镜头后方距离', '水下观察翻滚转身时，镜头位于迎面游来的角色后方多远。', () => RACE_CAMERA_TUNING.flipTurnBackDistance, (v) => RACE_CAMERA_TUNING.flipTurnBackDistance = v, 0.1, 0.5, 8, 1, 'm'),
            control('camera.flipTurnSideDistance', '镜头侧向距离', '水下翻滚转身镜头相对角色的侧向偏移；最终位置会限制在泳池内部。', () => RACE_CAMERA_TUNING.flipTurnSideDistance, (v) => RACE_CAMERA_TUNING.flipTurnSideDistance = v, 0.1, 0.5, 8, 1, 'm'),
            control('camera.flipTurnBelowDistance', '镜头下方距离', '水下翻滚转身镜头位于角色观察目标下方的垂直距离。', () => RACE_CAMERA_TUNING.flipTurnBelowDistance, (v) => RACE_CAMERA_TUNING.flipTurnBelowDistance = v, 0.05, 0.1, 1, 2, 'm'),
            control('camera.flipTurnFov', '镜头视野角', '水下观察完整翻滚转身过程时使用的垂直视野角。', () => RACE_CAMERA_TUNING.flipTurnFov, (v) => RACE_CAMERA_TUNING.flipTurnFov = v, 1, 25, 80, 0, '°'),
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
            control('dolphin.staminaCost', '海豚跳体力消耗', '成功释放时额外扣除的体力点数；不足扣至零，仍可释放，失败不扣费。不受每划成本或角色等级倍率影响。', () => DOLPHIN_JUMP.staminaCost, (v) => DOLPHIN_JUMP.staminaCost = v, 1, 0, 100, 0),
            control('dolphin.strainHr', '海豚跳心率负担', '成功释放时一次性增加心率，封顶 180；失败不增加，起跳至落水冻结心率，落水后恢复；体力成本另行配置。', () => DOLPHIN_JUMP.strainHr, (v) => DOLPHIN_JUMP.strainHr = v, 5, 0, 100, 0),
            control('dolphin.minAvailableDistance', '最小可用距离', '距离前方池壁或终点不足这么多米时不允许起跳（临界处理）。', () => DOLPHIN_JUMP.minAvailableDistance, (v) => DOLPHIN_JUMP.minAvailableDistance = v, 0.5, 0.5, 15, 1, 'm'),
            control('dolphin.launchSpeed', '起跳速度', '海豚跳初速基准，角色再乘爆发倍率。靠近池壁时自动压缩轨迹。', () => DOLPHIN_JUMP.launchSpeed, (v) => DOLPHIN_JUMP.launchSpeed = v, 0.5, 3, 16, 1, 'm/s'),
            control('dolphin.launchAngleDegrees', '起跳角度', '离水抛物线角度。越大越高越短，越小越平越远。', () => DOLPHIN_JUMP.launchAngleDegrees, (v) => DOLPHIN_JUMP.launchAngleDegrees = v, 1, 15, 70, 0, '°'),
            control('dolphin.gravity', '空中重力', '空中抛物线重力。越小滞空越久、飞得越夸张。', () => DOLPHIN_JUMP.gravity, (v) => DOLPHIN_JUMP.gravity = v, 0.5, 4, 30, 1),
            control('dolphin.dipDepth', '入水下潜深度', '起跳前短暂潜入水面的深度。', () => DOLPHIN_JUMP.dipDepth, (v) => DOLPHIN_JUMP.dipDepth = v, 0.05, 0, 1.5, 2, 'm'),
            control('dolphin.rollPerStrokeDegrees', '每次划水转体', '空中每次划水输入产生的轴向转体角度（左右反向）。', () => DOLPHIN_JUMP.rollPerStrokeDegrees, (v) => DOLPHIN_JUMP.rollPerStrokeDegrees = v, 30, 90, 720, 0, '°'),
            control('dolphin.rollEaseRate', '转体跟随速度', '轴向转体角度向输入目标追赶的速度。越大转得越快、越跟手。', () => DOLPHIN_JUMP.rollEaseRate, (v) => DOLPHIN_JUMP.rollEaseRate = v, 0.5, 2, 20, 1),
            control('dolphin.landingDepth', '落水下潜深度', '落水后潜入水下的深度，随后上浮恢复正常游泳。', () => DOLPHIN_JUMP.landingDepth, (v) => DOLPHIN_JUMP.landingDepth = v, 0.05, 0, 2, 2, 'm'),
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
            control('dive.takeoffAnticipationSeconds', '统一起跳准备', '提交跳水到离台的固定时长。玩家与 AI 共用，不随蓄力百分比、爆发力或飞行距离改变。', () => DIVE_BALANCE.takeoffAnticipationSeconds, (v) => DIVE_BALANCE.takeoffAnticipationSeconds = v, 0.01, 0, 1, 2, 's'),
            control('dive.minPower', '最低跳水', '没有蓄力或蓄力条很低时保留的最低跳水力度。数值越高，失误跳水也会更快。', () => DIVE_BALANCE.minPower, (v) => DIVE_BALANCE.minPower = v, 0.02, 0, 0.8, 2),
            control('dive.chargeCycleSeconds', '蓄力周期', '蓄力条从 0 到 1 再回到 0 的完整周期。值越小，顶点更难抓；值越大，蓄力节奏更宽松。', () => DIVE_BALANCE.chargeCycleSeconds, (v) => DIVE_BALANCE.chargeCycleSeconds = v, 0.05, 0.4, 4, 2, 's'),
            control('dive.underwaterHoldSeconds', '水下保持时间', '跳水入水后保持水下深度、只允许踢腿推进的时间。', () => SWIMMER_ACTION_TUNING.diveUnderwaterHoldSeconds, (v) => SWIMMER_ACTION_TUNING.diveUnderwaterHoldSeconds = v, 0.05, 0, 5, 2, 's'),
            control('dive.underwaterRiseSeconds', '水下上浮时间', '水下阶段从深度回升到水面的时间。上浮结束后才恢复手臂划水。', () => SWIMMER_ACTION_TUNING.diveUnderwaterRiseSeconds, (v) => SWIMMER_ACTION_TUNING.diveUnderwaterRiseSeconds = v, 0.05, 0.1, 5, 2, 's'),
            control('dive.straightenRatio', '斜下拉平占比', '水下保持阶段里，把入水斜下姿态拉回水平所用时间占比。越小越早变水平。', () => SWIMMER_ACTION_TUNING.diveStraightenRatio, (v) => SWIMMER_ACTION_TUNING.diveStraightenRatio = v, 0.05, 0.05, 1, 2),
            control('dive.underwaterRiseTilt', '上浮抬头角度', '上浮阶段身体斜上抬头的最大角度，到达水面时回到水平。', () => SWIMMER_ACTION_TUNING.diveUnderwaterRiseTiltDegrees, (v) => SWIMMER_ACTION_TUNING.diveUnderwaterRiseTiltDegrees = v, 0.5, 0, 30, 1, '°'),
        ],
    },
    {
        name: '踢腿潜水相机',
        controls: [
            control('camera.kickDiveBackDistance', '潜水镜头后距', '踢腿潜入水下时，相机跟在角色身后的距离。', () => RACE_CAMERA_TUNING.kickDiveBackDistance, (v) => RACE_CAMERA_TUNING.kickDiveBackDistance = v, 0.1, 1, 6, 1, 'm'),
            control('camera.kickDiveBelowDistance', '潜水镜头下移', '相机低于角色上半身的距离，越大越能仰看水面。', () => RACE_CAMERA_TUNING.kickDiveBelowDistance, (v) => RACE_CAMERA_TUNING.kickDiveBelowDistance = v, 0.05, 0, 0.8, 2, 'm'),
            control('camera.kickDiveFov', '潜水镜头视野', '踢腿潜航镜头的垂直视野角度。', () => RACE_CAMERA_TUNING.kickDiveFov, (v) => RACE_CAMERA_TUNING.kickDiveFov = v, 1, 35, 80, 0, '°'),
            control('camera.kickDiveFollowSpeed', '潜水镜头跟随', '下潜与水下跟随的速度，越大越快贴近角色。', () => RACE_CAMERA_TUNING.kickDiveFollowSpeed, (v) => RACE_CAMERA_TUNING.kickDiveFollowSpeed = v, 0.5, 2, 20, 1, '/s'),
            control('camera.kickDiveVerticalSpeed', '潜水过水面速度', '实际镜头靠近水面时的升降速度上限，限制进出水面和快速切换动作时的位置跳变。', () => RACE_CAMERA_TUNING.kickDiveVerticalSpeed, (v) => RACE_CAMERA_TUNING.kickDiveVerticalSpeed = v, 0.1, 1, 6, 1, 'm/s'),
        ],
    },
    {
        name: '冲刺与终点相机',
        controls: [
            control('race.sprintDistanceFromFinish', '冲刺触发距离', '距离终点还剩多少米时进入冲刺阶段。冲刺沿用相同体力消耗和耗尽推进规则。', () => RACE_PHASE_BALANCE.sprintDistanceFromFinish, (v) => RACE_PHASE_BALANCE.sprintDistanceFromFinish = v, 1, 0, 100, 0, 'm'),
            control('camera.finishTopViewDistance', '终点俯视距离', '主角距终点还剩多少米时切到终点俯视镜头。设很小(≈0)=只有主角真正到达终点才切俯视，冲刺全程保持跟随。', () => RACE_CAMERA_TUNING.finishTopViewDistance, (v) => RACE_CAMERA_TUNING.finishTopViewDistance = v, 0.05, 0, 50, 2, 'm'),
            control('camera.finishTopViewPoolInset', '终点俯视内移', '完赛俯视镜头中心从终点向泳池内侧移动的距离。越大则终点越靠画面边缘、能看到的泳池范围越多。', () => RACE_CAMERA_TUNING.finishTopViewPoolInset, (v) => RACE_CAMERA_TUNING.finishTopViewPoolInset = v, 0.5, 0, 25, 1, 'm'),
            control('camera.sprintBackDistance', '冲刺镜头后距', '冲刺镜头位于主角上半身后方的距离。越小越接近第一人称，越大看到的人物越完整。', () => RACE_CAMERA_TUNING.sprintBackDistance, (v) => RACE_CAMERA_TUNING.sprintBackDistance = v, 0.1, 0.5, 8, 1, 'm'),
            control('camera.strokeFeedbackBackDistance', '划水反馈后距', '完美划水结算时镜头短暂后拉的最大距离，普通划水为其45%。设为0关闭后拉。仅影响画面。', () => RACE_CAMERA_TUNING.strokeFeedbackBackDistance, (v) => RACE_CAMERA_TUNING.strokeFeedbackBackDistance = v, 0.02, 0, 0.4, 2, 'm'),
            control('camera.strokeFeedbackFov', '划水反馈视野', '完美划水时临时增加的视野角度，普通划水为其45%。设为0关闭视野变化。', () => RACE_CAMERA_TUNING.strokeFeedbackFov, (v) => RACE_CAMERA_TUNING.strokeFeedbackFov = v, 0.2, 0, 3, 1, '°'),
            control('camera.strokeFeedbackSeconds', '划水反馈时长', '划水结算后镜头后拉再追上的时长，不影响推进或判定。', () => RACE_CAMERA_TUNING.strokeFeedbackSeconds, (v) => RACE_CAMERA_TUNING.strokeFeedbackSeconds = v, 0.02, 0.12, 0.6, 2, 's'),
            control('camera.sprintKickPullbackDistance', '连续踢腿后拉', '冲刺镜头中连续踢腿时，在当前镜头后距上额外往后拉的距离。开始划水后会恢复原有后距。', () => RACE_CAMERA_TUNING.sprintKickPullbackDistance, (v) => RACE_CAMERA_TUNING.sprintKickPullbackDistance = v, 0.1, 0, 4, 1, 'm'),
            control('camera.sprintKickPullbackMinCadenceHz', '连续踢腿频率', '短点按形成的踢腿频率达到该值后，冲刺镜头才开始后拉。越高越需要快速连点。', () => RACE_CAMERA_TUNING.sprintKickPullbackMinCadenceHz, (v) => RACE_CAMERA_TUNING.sprintKickPullbackMinCadenceHz = v, 0.25, 0.5, 10, 2, 'Hz'),
            control('camera.sprintHeight', '冲刺镜头高度', '冲刺镜头相对主角上半身的向上高度。', () => RACE_CAMERA_TUNING.sprintHeight, (v) => RACE_CAMERA_TUNING.sprintHeight = v, 0.05, 0.2, 5, 2, 'm'),
            control('camera.sprintLookAhead', '冲刺镜头前看', '以主角上半身骨骼为基准，镜头目标向终点方向前移的距离。越小越聚焦上半身。', () => RACE_CAMERA_TUNING.sprintLookAhead, (v) => RACE_CAMERA_TUNING.sprintLookAhead = v, 0.1, 0, 6, 1, 'm'),
            control('camera.sprintAscentAnchorAboveWater', '上浮镜头水面锚点', '上浮阶段提前切入冲刺视角时，镜头构图锚点保持在水面以上的最低高度。调高可把横切画面的水面线继续向下压。', () => RACE_CAMERA_TUNING.sprintAscentAnchorAboveWater, (v) => RACE_CAMERA_TUNING.sprintAscentAnchorAboveWater = v, 0.05, 0, 1.5, 2, 'm'),
            control('camera.waterlineAboveClearance', '水上相机离水线', '所有水上比赛机位最终写入相机节点前，与水面保持的最小垂直距离。用于禁止镜头停在水线上形成上下各半的画面。', () => RACE_CAMERA_TUNING.waterlineAboveClearance, (v) => RACE_CAMERA_TUNING.waterlineAboveClearance = v, 0.05, 0.1, 1, 2, 'm'),
            control('camera.waterlineBelowClearance', '水下相机离水线', '所有水下比赛机位最终写入相机节点前，与水面保持的最小垂直距离。用于禁止镜头停在水线上形成上下各半的画面。', () => RACE_CAMERA_TUNING.waterlineBelowClearance, (v) => RACE_CAMERA_TUNING.waterlineBelowClearance = v, 0.05, 0.1, 1, 2, 'm'),
            control('camera.sprintFov', '水面跟随视野', '水面背后跟随镜头的垂直视野角度。越大画面越广，越小主角越大。', () => RACE_CAMERA_TUNING.sprintFov, (v) => RACE_CAMERA_TUNING.sprintFov = v, 1, 25, 80, 0, '°'),
            control('camera.sprintFollowSpeed', '冲刺前向跟随', '冲刺镜头前进/高度方向的跟随速度（每秒）。越高越紧跟，越低越拖影。', () => RACE_CAMERA_TUNING.sprintFollowSpeed, (v) => RACE_CAMERA_TUNING.sprintFollowSpeed = v, 0.5, 2, 30, 1, '/s'),
            control('camera.sprintLateralFollowSpeed', '冲刺横向跟随', '冲刺镜头左右(横向)跟随速度（每秒）。故意调慢，让人物蛇形偏移时先在画面里滑出去、相机再缓缓追上，玩家才感受得到偏移。越低偏移越明显、越拖。', () => RACE_CAMERA_TUNING.sprintLateralFollowSpeed, (v) => RACE_CAMERA_TUNING.sprintLateralFollowSpeed = v, 0.2, 0.5, 15, 1, '/s'),
            control('camera.surfaceRaceCameraRiseProgress', '上浮切冲刺进度', '开局入水与翻滚蹬壁后的上浮进度达到该比例时，提前切回正常冲刺跟随镜头。0 表示上浮开始的第一帧。', () => RACE_CAMERA_TUNING.surfaceRaceCameraRiseProgress, (v) => RACE_CAMERA_TUNING.surfaceRaceCameraRiseProgress = v, 0.05, 0, 1, 2),
            control('camera.speedLineThreshold', '速度线触发速度', '冲刺跟随镜头中，主角速度达到此值后开始出现漫画风格的屏幕速度线。', () => CAMERA_SPEED_LINE_TUNING.speedLineThreshold, (v) => CAMERA_SPEED_LINE_TUNING.speedLineThreshold = v, 0.1, 0, 8, 1, 'm/s'),
        ],
    },
    {
        name: '速度',
        controls: [
            control('speed.baseSpeed', '基础速度', '进入游泳阶段时的初始速度。跳水入水速度仍由跳水参数决定。', () => SWIMMER_BALANCE.baseSpeed, (v) => SWIMMER_BALANCE.baseSpeed = v, 0.05, 0, 2, 2, 'm/s'),
            control('speed.maxSpeed', '最高速度', '所有角色共用的常规游速上限，也用于推进衰减；爆发力不改变此值。', () => SWIMMER_BALANCE.maxSpeed, (v) => SWIMMER_BALANCE.maxSpeed = v, 0.05, 1, 6, 2, 'm/s'),
            control('speed.strokeBaseAccel', '基础动作加速', '每次划水的基础推进加速度：按住时提前支付一部分，松手时补足剩余部分。', () => SWIMMER_BALANCE.strokeBaseAccel, (v) => SWIMMER_BALANCE.strokeBaseAccel = v, 0.05, 0, 5, 2),
            control('speed.strokeHeldBaseRatio', '按住推进占比', '按住期间最多提前支付的基础推进比例，在超时进度前均匀推进；松手扣除已支付部分，再叠加质量奖励。下一划生效。', () => SWIMMER_BALANCE.strokeHeldBaseRatio, (v) => SWIMMER_BALANCE.strokeHeldBaseRatio = v, 0.05, 0, 1, 2),
            control('speed.strokeQualityAccel', '划水质量加速', '在 PERFECT 区间内松手的质量推进基准，按划水周期补偿；GOOD 另乘其推进倍率。这是划水的主要推进来源。', () => SWIMMER_BALANCE.strokeQualityAccel, (v) => SWIMMER_BALANCE.strokeQualityAccel = v, 0.05, 0, 8, 2),
            control('speed.strokeGoodPropulsionScale', 'GOOD推进倍率', '只缩放 GOOD 的质量推进，越低则 PERFECT 优势越明显；不改变判定、蓄气和按住基础推进。下一划生效。', () => SWIMMER_BALANCE.strokeGoodPropulsionScale, (v) => SWIMMER_BALANCE.strokeGoodPropulsionScale = v, 0.05, 0, 1, 2),
            control('speed.strokeTimeCompensation', '划水耗时补偿', '0 为原动画耗时补偿，1 为按有效划水进度计算的标准输入周期补偿，抬平 PERFECT 中后段收益；空等和超过完美终点不额外奖励。下一划生效。', () => SWIMMER_BALANCE.strokeTimeCompensation, (v) => SWIMMER_BALANCE.strokeTimeCompensation = v, 0.05, 0, 1, 2),
            control('speed.strokeAccelDurationRatio', '加速持续', '一次动作加速度持续时间，占当前动作一轮时间的比例。越短越像“窜一下”，越长越像“持续推”。', () => SWIMMER_BALANCE.strokeAccelDurationRatio, (v) => SWIMMER_BALANCE.strokeAccelDurationRatio = v, 0.02, 0.05, 1.5, 2),
            control('speed.strokeImpulseSharpness', '冲刺锐度', '0=加速平均分布（顺滑）；越高=划水瞬间加速越猛、随后迅速回落，形成“窜出去再被水拖慢”的冲刺感。不改变整体速度，只改手感。', () => SWIMMER_BALANCE.strokeImpulseSharpness, (v) => SWIMMER_BALANCE.strokeImpulseSharpness = v, 0.05, 0, 1, 2),
            control('speed.kickAccelPerHz', '踢腿每频加速', '踢腿推进：每 1Hz 踢腿频率产生的加速度。点得越快频率越高、加速越快；点得慢加速慢。', () => SWIMMER_BALANCE.kickAccelPerHz, (v) => SWIMMER_BALANCE.kickAccelPerHz = v, 0.02, 0, 2, 2),
            control('speed.kickMaxSpeed', '踢腿速度上限', '单靠踢腿能达到的最高速度上限。应低于手臂 maxSpeed，让手臂才是主发动机。', () => SWIMMER_BALANCE.kickMaxSpeed, (v) => SWIMMER_BALANCE.kickMaxSpeed = v, 0.1, 0, 4, 1),
            control('speed.kickCeilingBand', '踢腿封顶缓冲', '接近踢腿速度上限前多大速度区间内加速度渐渐衰减到 0，让踢腿平滑贴近上限而不是硬顶。', () => SWIMMER_BALANCE.kickCeilingBand, (v) => SWIMMER_BALANCE.kickCeilingBand = v, 0.05, 0.05, 2, 2),
            control('speed.kickCadenceMaxHz', '踢腿推进频率上限', '踢腿【推进】的频率上限（次/秒）：超过这个频率不再加更多速度，防止爆点连击把速度拉爆。只限制推进，不影响腿动画速度。', () => SWIMMER_BALANCE.kickCadenceMaxHz, (v) => SWIMMER_BALANCE.kickCadenceMaxHz = v, 0.1, 1, 16, 1),
            control('speed.kickCadenceMeasureMaxHz', '踢腿测量安全阀', '频率测量的安全上限（次/秒），设很高只为防止两次点击间隔极小时数值爆掉。腿动画用这个值，正常手速几乎碰不到，相当于不限。', () => SWIMMER_BALANCE.kickCadenceMeasureMaxHz, (v) => SWIMMER_BALANCE.kickCadenceMeasureMaxHz = v, 1, 8, 40, 0),
            control('speed.poolDeceleration', '泳池减速', '泳池或场景提供的固定减速度。未来不同泳池可以配置不同数值。', () => SWIMMER_BALANCE.poolDeceleration, (v) => SWIMMER_BALANCE.poolDeceleration = v, 0.02, 0, 2, 2),
            control('speed.baseDrag', '基础阻力', '与速度成正比的线性阻力（∝ v）。', () => SWIMMER_BALANCE.baseDrag, (v) => SWIMMER_BALANCE.baseDrag = v, 0.02, 0, 2, 2),
            control('speed.highSpeedDrag', '高速阻力', '与速度平方成正比的二次阻力（∝ v²）。值越高，速度越快阻力增长越剧烈，低速时几乎没有影响。', () => SWIMMER_BALANCE.highSpeedDrag, (v) => SWIMMER_BALANCE.highSpeedDrag = v, 0.01, 0, 2.5, 2),
            control('speed.glideDrag', '潜水滑行阻力', '仅在跳水入水后的潜水滑行阶段叠加的额外阻力（∝ v）。越大越迫使玩家靠抖腿踢水维持速度，不踢就很快掉速；设 0 关闭。', () => SWIMMER_BALANCE.glideDrag, (v) => SWIMMER_BALANCE.glideDrag = v, 0.02, 0, 3, 2),
            control('speed.perfectComboMaxOvercap', '超速幅度上限', '已有超速状态回落时保留的额外上限余量；保护当前已有速度，不限制起跳初速。全角色共用，与技巧、PERFECT连击无关。', () => SWIMMER_BALANCE.perfectComboMaxOvercap, (v) => SWIMMER_BALANCE.perfectComboMaxOvercap = v, 0.05, 0, 3, 2),
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
            control('gesture.armStrokeTimeoutProgress', '超时圈数', '一直长按不松手时，手臂划水推进到整圈的这个比例后自动结束（手已出水），判为超时失误。0.5=半圈。', () => STROKE_QUALITY_TUNING.armStrokeTimeoutProgress, (v) => STROKE_QUALITY_TUNING.armStrokeTimeoutProgress = v, 0.05, 0.2, 1, 2),
            control('gesture.armStrokeTimeoutAccel', '超时失误加速', '划水超时失误时只给的很小推进加速度。用于惩罚一直按住不松手。', () => STROKE_QUALITY_TUNING.armStrokeTimeoutAccel, (v) => STROKE_QUALITY_TUNING.armStrokeTimeoutAccel = v, 0.01, 0, 1, 2),
            control('strokeQuality.armCycleLowSpeedPerSecond', '低速划水轮速', '速度低于“起爬速度”时手臂划水每秒的圈数（下限）。越低=低速时一圈越慢，甜区的实际时间窗口越宽（越好打）。', () => STROKE_QUALITY_TUNING.armCycleLowSpeedPerSecond, (v) => STROKE_QUALITY_TUNING.armCycleLowSpeedPerSecond = v, 0.02, 0.05, 3, 2),
            control('strokeQuality.armCycleHighSpeedPerSecond', '高速划水轮速', '速度达到“顶速速度”后手臂划水每秒的圈数（上限）。越高=高速时一圈越快，甜区的实际时间窗口越短（越难打）。', () => STROKE_QUALITY_TUNING.armCycleHighSpeedPerSecond, (v) => STROKE_QUALITY_TUNING.armCycleHighSpeedPerSecond = v, 0.05, 1, 6, 2),
            control('strokeQuality.armCycleSpeedStart', '起爬速度', '低于这个速度时轮速恒为下限；到达后才开始随速度加快。单位 m/s。', () => STROKE_QUALITY_TUNING.armCycleSpeedStart, (v) => STROKE_QUALITY_TUNING.armCycleSpeedStart = v, 0.1, 0, 6, 2, 'm/s'),
            control('strokeQuality.armCycleSpeedFull', '顶速速度', '到达这个速度时轮速升到上限；再快也不变。应大于“起爬速度”。单位 m/s。', () => STROKE_QUALITY_TUNING.armCycleSpeedFull, (v) => STROKE_QUALITY_TUNING.armCycleSpeedFull = v, 0.1, 0.1, 8, 2, 'm/s'),
        ],
    },
    {
        name: '体力',
        controls: [
            control('condition.energyTotal', 'AI默认体力上限', 'AI 和缺少角色档案时使用的体力上限。正常玩家直接使用角色面板体力，不受此值换算；比赛中不自动恢复。', () => CONDITION_BALANCE.energy.total, (v) => CONDITION_BALANCE.energy.total = v, 5, 1, 1000, 0),
            control('condition.strokeDrain', '每划体力消耗', '左右手各算一次，划水结算时固定扣除。GOOD、PERFECT、失误和超时同价；踢腿不扣体力。', () => CONDITION_BALANCE.energy.drainPerStroke, (v) => CONDITION_BALANCE.energy.drainPerStroke = v, 0.1, 0.1, 10, 2),
            control('condition.exhaustedPropulsionScale', '耗尽后推进倍率', '体力归零后，新开始的手臂划水使用此固定倍率，包含按住推进和松手奖励。0.15 表示保留 15% 推进；实际游速受水阻和踢腿影响，动作速度另由耗尽轮速控制。', () => CONDITION_BALANCE.energy.exhaustedPropulsionScale, (v) => CONDITION_BALANCE.energy.exhaustedPropulsionScale = v, 0.05, 0, 1, 2),
            control('condition.exhaustedCadenceScale', '耗尽后动作速度', '体力归零后手臂划水和回收的速度倍率，0.6 表示正常轮速的 60%。保留当前动作进度，不改变完美区进度宽度，不影响独立踢腿及特殊起跳。', () => CONDITION_BALANCE.energy.exhaustedCadenceScale, (v) => CONDITION_BALANCE.energy.exhaustedCadenceScale = v, 0.05, 0.1, 1, 2),
        ],
    },
    {
        name: '心率与完美区',
        controls: [
            control('heartRate.sampleSeconds', '频率采样秒数', '统计最近几秒实际开始的手臂动作；停止划水后，旧动作逐个退出采样。', () => HEART_RATE_TUNING.sampleSeconds, (v) => HEART_RATE_TUNING.sampleSeconds = v, 0.25, 0.5, 4, 2, ' s'),
            control('heartRate.bpmPerStrokeHz', '每赫兹目标心率', '目标心率为 80 加上划水次数每秒乘此值，封顶 180。', () => HEART_RATE_TUNING.bpmPerStrokeHz, (v) => HEART_RATE_TUNING.bpmPerStrokeHz = v, 5, 10, 80, 0, ''),
            control('heartRate.riseSeconds', '均衡：升温时间常数', '越大升温越慢；8 秒时快速划水约 8～12 秒明显收窄。', () => HEART_RATE_TUNING.riseSeconds, (v) => HEART_RATE_TUNING.riseSeconds = v, 0.5, 1, 30, 1, ' s'),
            control('heartRate.recoverySeconds', '均衡：恢复时间常数', '越小恢复越快；踢腿和停止操作按同样速度恢复，不回体力。', () => HEART_RATE_TUNING.recoverySeconds, (v) => HEART_RATE_TUNING.recoverySeconds = v, 0.25, 0.5, 15, 2, ' s'),
            control('heartRate.quickRiseSeconds', '快升快降：升温', '角色固有心率特性的升温时间常数，越大变化越慢；不随等级增长。', () => HEART_RATE_TUNING.quickRiseSeconds, (v) => HEART_RATE_TUNING.quickRiseSeconds = v, 0.5, 0.5, 30, 1, ' s'),
            control('heartRate.quickRecoverySeconds', '快升快降：恢复', '角色固有心率特性的恢复时间常数，越大变化越慢；不随等级增长。', () => HEART_RATE_TUNING.quickRecoverySeconds, (v) => HEART_RATE_TUNING.quickRecoverySeconds = v, 0.25, 0.5, 15, 2, ' s'),
            control('heartRate.steadyRiseSeconds', '慢升慢降：升温', '角色固有心率特性的升温时间常数，越大变化越慢；不随等级增长。', () => HEART_RATE_TUNING.steadyRiseSeconds, (v) => HEART_RATE_TUNING.steadyRiseSeconds = v, 0.5, 0.5, 30, 1, ' s'),
            control('heartRate.steadyRecoverySeconds', '慢升慢降：恢复', '角色固有心率特性的恢复时间常数，越大变化越慢；不随等级增长。', () => HEART_RATE_TUNING.steadyRecoverySeconds, (v) => HEART_RATE_TUNING.steadyRecoverySeconds = v, 0.25, 0.5, 15, 2, ' s'),
            control('heartRate.slowRiseSeconds', '极慢升降：升温', '角色固有心率特性的升温时间常数，越大变化越慢；不随等级增长。', () => HEART_RATE_TUNING.slowRiseSeconds, (v) => HEART_RATE_TUNING.slowRiseSeconds = v, 0.5, 0.5, 30, 1, ' s'),
            control('heartRate.slowRecoverySeconds', '极慢升降：恢复', '角色固有心率特性的恢复时间常数，越大变化越慢；不随等级增长。', () => HEART_RATE_TUNING.slowRecoverySeconds, (v) => HEART_RATE_TUNING.slowRecoverySeconds = v, 0.25, 0.5, 15, 2, ' s'),
            control('heartRate.widthAt120', '120心率剩余宽度', '相对于原 PERFECT 宽度；节点之间连续变化，开始时锁定本划。', () => HEART_RATE_TUNING.widthAt120, (v) => HEART_RATE_TUNING.widthAt120 = v, 0.05, 0.3, 1, 2, ''),
            control('heartRate.widthAt140', '140心率剩余宽度', '与前后节点连续插值，不能大于前一节点。', () => HEART_RATE_TUNING.widthAt140, (v) => HEART_RATE_TUNING.widthAt140 = v, 0.05, 0.3, 1, 2, ''),
            control('heartRate.widthAt160', '160心率剩余宽度', '极限档入口的剩余宽度，与 180 心率下限连续衔接。', () => HEART_RATE_TUNING.widthAt160, (v) => HEART_RATE_TUNING.widthAt160 = v, 0.05, 0.3, 1, 2, ''),
            control('heartRate.minimumWidth', '极限剩余宽度', '180 心率的最小宽度；0.3 表示保留原完美区的 30%。', () => HEART_RATE_TUNING.minimumWidth, (v) => HEART_RATE_TUNING.minimumWidth = v, 0.05, 0.1, 1, 2, ''),
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
            control('motion.proneChestRollDegrees', '俯泳胸肩侧转', '胸肩相对髋部的侧转角度，在高肘回臂时达到最大；仰泳保持原动作。', () => MOTION_TUNING.proneChestRollDegrees, (v) => MOTION_TUNING.proneChestRollDegrees = v, 1, 0, 45, 0, '°'),
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
            control('ai.timingSigmaLow', 'AI松手误差基准', '各正式智力档的松手误差按此基准等比调整；变态档始终无随机误差。', () => AI_STROKE_TUNING.timingSigmaLow, (v) => AI_STROKE_TUNING.timingSigmaLow = v, 0.005, 0, 0.3, 3),
            control('ai.maxReleaseProgress', 'AI最迟松手', 'AI 模拟松手的进度上限（占一圈的比例）。必须小于划水超时圈数，保证 AI 总在超时前松手。', () => AI_STROKE_TUNING.maxReleaseProgress, (v) => AI_STROKE_TUNING.maxReleaseProgress = v, 0.01, 0.2, 0.49, 2),
            control('ai.gapSecondsSlow', 'AI划间停顿基准', '各智力档按此基准调整松手后的停顿，长按分类等待仍须完整经过。', () => AI_STROKE_TUNING.gapSecondsSlow, (v) => AI_STROKE_TUNING.gapSecondsSlow = v, 0.01, 0, 0.6, 2, 's'),
            control('ai.gapJitter', '划水间隔抖动', 'AI 每次划水间隔上下浮动的随机比例，让节奏不那么机械。', () => AI_STROKE_TUNING.gapJitter, (v) => AI_STROKE_TUNING.gapJitter = v, 0.02, 0, 0.8, 2),
            control('ai.startDelayMin', '起步延迟下限', 'AI 进入游泳阶段后，第一次划水前随机延迟的最小秒数。', () => AI_STROKE_TUNING.startDelayMin, (v) => AI_STROKE_TUNING.startDelayMin = v, 0.01, 0, 0.6, 2, 's'),
            control('ai.startDelayMax', '起步延迟上限', 'AI 进入游泳阶段后，第一次划水前随机延迟的最大秒数。', () => AI_STROKE_TUNING.startDelayMax, (v) => AI_STROKE_TUNING.startDelayMax = v, 0.01, 0, 0.8, 2, 's'),
            control('ai.maxHoldSeconds', 'AI保底松手时间', '兜底：AI 按住超过这个秒数还没等到目标进度就强制松手，防止卡住。', () => AI_STROKE_TUNING.maxHoldSeconds, (v) => AI_STROKE_TUNING.maxHoldSeconds = v, 0.05, 0.2, 1.5, 2, 's'),
            control('aiPlan.budgetScale', 'AI体力预留倍率', '提高会更早省力，降低会更积极消耗体力。智力不修改体力上限。', () => AI_PLANNER_TUNING.budgetScale, v => AI_PLANNER_TUNING.budgetScale = v, 0.02, 0.5, 1.5, 2),
            control('aiPlan.heartTargetOffset', 'AI目标心率偏移', '在角色策略目标上偏移；高目标减少休息，但真实完美区间会收窄。', () => AI_PLANNER_TUNING.heartTargetOffset, v => AI_PLANNER_TUNING.heartTargetOffset = v, 2, -30, 30, 0),
            control('aiPlan.sprintDistanceScale', 'AI冲刺距离倍率', '调整各角色200米和400米末段冲刺距离，仍要求剩余体力够用。', () => AI_PLANNER_TUNING.sprintDistanceScale, v => AI_PLANNER_TUNING.sprintDistanceScale = v, 0.05, 0.5, 2, 2),
            control('aiPlan.kickBlockScale', 'AI踢腿段时长倍率', '连续省力或降心率的最短保持时间，避免反复打断划水节奏。', () => AI_PLANNER_TUNING.kickBlockScale, v => AI_PLANNER_TUNING.kickBlockScale = v, 0.05, 0.3, 2, 2),
            control('aiPlan.jumpSpaceMargin', 'AI跳跃空间余量', '完整海豚跳估计距离之外再预留的空间，实际释放仍经过玩家共享检查。', () => AI_PLANNER_TUNING.jumpSpaceMargin, v => AI_PLANNER_TUNING.jumpSpaceMargin = v, 0.2, 0, 6, 1, 'm'),
        ],
    },
    {
        name: '转体失衡',
        controls: [
            control('axialRoll.enabled', '启用转体失衡', '1=启用由划水驱动的轴心转体；0=关闭并让角色快速回到平趴。', () => AXIAL_ROLL_TUNING.enabled, (v) => AXIAL_ROLL_TUNING.enabled = v, 1, 0, 1, 0),
            control('axialRoll.armCatchTorque', '水下拉水扭矩', '手臂处于有效拉水段时持续施加的转体扭矩。越大，单侧持续划水越容易滚起来。', () => AXIAL_ROLL_TUNING.armCatchTorque, (v) => AXIAL_ROLL_TUNING.armCatchTorque = v, 5, 0, 700, 0, '°/s²'),
            control('axialRoll.catchTorqueResponseRate', '拉水力矩响应', '力矩跟随水下拉水窗口的速度。越高越贴手，越低越柔和但会显得划完才开始倒。默认值已对齐当前手臂动作。', () => AXIAL_ROLL_TUNING.catchTorqueResponseRate, (v) => AXIAL_ROLL_TUNING.catchTorqueResponseRate = v, 1, 2, 40, 0, '/s'),
            control('axialRoll.hullRightingTorque', '船体复原力矩', '俯泳 0° 与仰泳 180° 共用的对称船体支撑。越大，中低速倾斜时越明显被船舷弹回。', () => AXIAL_ROLL_TUNING.hullRightingTorque, (v) => AXIAL_ROLL_TUNING.hullRightingTorque = v, 5, 0, 300, 0, '°/s²'),
            control('axialRoll.hullRightingCurvePower', '船舷支撑曲线', '控制复原力如何随倾角长出来。小于 1 会让轻微倾斜更快出现支撑和摇摆；1 是标准 sin(2×角度) 船体曲线。', () => AXIAL_ROLL_TUNING.hullRightingCurvePower, (v) => AXIAL_ROLL_TUNING.hullRightingCurvePower = v, 0.05, 0.2, 2, 2),
            control('axialRoll.hullFadeStartAngularSpeed', '高速退让起始速度', '转得超过该速度后，船体复原力开始退让，让碰撞或强划水能越过 90° 船舷继续翻。它不改变转体阻尼。', () => AXIAL_ROLL_TUNING.hullFadeStartAngularSpeed, (v) => AXIAL_ROLL_TUNING.hullFadeStartAngularSpeed = v, 5, 0, 360, 0, '°/s'),
            control('axialRoll.hullFadeFullAngularSpeed', '高速完全退让速度', '达到该角速度后暂时不施加船体复原力，只保留原有水阻与转动惯性；速度降下来后支撑自然恢复。', () => AXIAL_ROLL_TUNING.hullFadeFullAngularSpeed, (v) => AXIAL_ROLL_TUNING.hullFadeFullAngularSpeed = v, 5, 10, 720, 0, '°/s'),
            control('axialRoll.treadWaterProneToleranceDegrees', '踩水俯泳容差', '距离俯泳 0° 小于该角度时，停下后允许进入正常踩水姿态；仰泳稳定态不会错误切成倒置踩水。', () => AXIAL_ROLL_TUNING.treadWaterProneToleranceDegrees, (v) => AXIAL_ROLL_TUNING.treadWaterProneToleranceDegrees = v, 1, 1, 45, 0, '°'),
            control('axialRoll.angularDrag', '水中转体阻尼', '持续消耗转体角速度。默认值偏低以保留翻转惯性；越大越稳、停得快，越小越有随时倾覆的感觉。', () => AXIAL_ROLL_TUNING.angularDrag, (v) => AXIAL_ROLL_TUNING.angularDrag = v, 0.05, 0, 6, 2, '/s'),
            control('axialRoll.kickAngularDragPerHz', '踢腿稳定强度', '每 1Hz 踢腿频率增加的转体阻尼。当前只提供轻微稳定，避免正常踢腿把翻转惯性完全吃掉。', () => AXIAL_ROLL_TUNING.kickAngularDragPerHz, (v) => AXIAL_ROLL_TUNING.kickAngularDragPerHz = v, 0.01, 0, 0.8, 2, '/Hz'),
            control('axialRoll.maxAngularSpeed', '最大转体角速度', '轴心转体的角速度硬上限。默认允许强碰撞触发多圈翻滚；正常划水力矩远低于该上限。', () => AXIAL_ROLL_TUNING.maxAngularSpeed, (v) => AXIAL_ROLL_TUNING.maxAngularSpeed = v, 20, 90, 1200, 0, '°/s'),
            control('axialRoll.shoulderHalfWidth', '虚拟肩宽', '用于估算左右肩露出或没入水面的半宽。它只影响手臂在当前滚转角下还能产生多少水下扭矩。', () => AXIAL_ROLL_TUNING.shoulderHalfWidth, (v) => AXIAL_ROLL_TUNING.shoulderHalfWidth = v, 0.02, 0.1, 0.7, 2, 'm'),
            control('axialRoll.shoulderWaterBand', '肩部水线过渡', '肩部跨过水线时，手臂抓水能力从弱到强的过渡宽度。越小越像突然出水，越大越柔和。', () => AXIAL_ROLL_TUNING.shoulderWaterBand, (v) => AXIAL_ROLL_TUNING.shoulderWaterBand = v, 0.02, 0.04, 0.6, 2, 'm'),
            control('axialRoll.minimumExposedArmCatch', '出水手最低抓水', '肩膀抬出水面后，该侧手臂仍保留的最低扭矩比例，防止完全失去输入。', () => AXIAL_ROLL_TUNING.minimumExposedArmCatch, (v) => AXIAL_ROLL_TUNING.minimumExposedArmCatch = v, 0.02, 0, 1, 2),
            control('axialRoll.proceduralRollDegrees', '动作内置侧滚', '自由泳动作自身保留的小幅肩胯扭转。整个人的大角度滚转由物理模型负责，建议保持较小。', () => AXIAL_ROLL_TUNING.proceduralRollDegrees, (v) => AXIAL_ROLL_TUNING.proceduralRollDegrees = v, 0.5, 0, 20, 1, '°'),
            control('axialRoll.tumblePenaltyStartAngularSpeed', '翻滚掉速起始速度', '轴向角速度达到多少后开始损失推进。它只看正在翻得多快，不看人物当前是 0°、90° 还是 180°。', () => AXIAL_ROLL_TUNING.tumblePenaltyStartAngularSpeed, (v) => AXIAL_ROLL_TUNING.tumblePenaltyStartAngularSpeed = v, 5, 0, 240, 0, '°/s'),
            control('axialRoll.tumblePenaltyFullAngularSpeed', '翻滚掉速拉满速度', '轴向角速度达到多少时降至最低推进倍率。越大越允许快速翻滚而不明显掉速。', () => AXIAL_ROLL_TUNING.tumblePenaltyFullAngularSpeed, (v) => AXIAL_ROLL_TUNING.tumblePenaltyFullAngularSpeed = v, 5, 20, 480, 0, '°/s'),
            control('axialRoll.minForwardScale', '高速翻滚最低推进', '快速轴向翻滚时至少保留多少推进效率。停止翻滚后，无论俯泳、仰泳或侧身都会恢复完整效率。', () => AXIAL_ROLL_TUNING.minForwardScale, (v) => AXIAL_ROLL_TUNING.minForwardScale = v, 0.02, 0, 1, 2),
        ],
    },
    {
        name: '转向',
        controls: [
            control('steer.turnAngularImpulse', '单划偏航冲量', '每次单手划水给偏航角速度增加多少。松手后角速度继续存在，所以轨迹会持续画弧而不是沿固定斜方向走直线。', () => STEERING_TUNING.turnAngularImpulse, (v) => STEERING_TUNING.turnAngularImpulse = v, 2, 0, 120, 0, '°/s'),
            control('steer.maxHeading', '最大偏航', '身体相对泳道前进方向的最大偏转角。越大能歪得越狠；65°时前进速度约剩四成。运动模型有85°硬上限，连续单侧划水也不能掉头。', () => STEERING_TUNING.maxHeading, (v) => STEERING_TUNING.maxHeading = v, 1, 10, MAX_STEERING_HEADING_DEGREES, 0, '°'),
            control('steer.turnAngularDrag', '偏航角速度阻尼', '松手后偏航角速度的水阻。越低弯道持续越久；0=除非反侧划水或撞墙，否则会一直继续转弯。', () => STEERING_TUNING.turnAngularDrag, (v) => STEERING_TUNING.turnAngularDrag = v, 0.05, 0, 4, 2, '/s'),
            control('steer.maxTurnRate', '最大偏航角速度', '连续同侧划水能累积到的偏航角速度上限，防止人物瞬间急转。', () => STEERING_TUNING.maxTurnRate, (v) => STEERING_TUNING.maxTurnRate = v, 5, 20, 240, 0, '°/s'),
            control('steer.poolWallHeadingCorrectionRate', '撞墙转回强度', '人物碰到泳池侧墙后，朝离墙目标角平滑回正的速度。越高越快离墙，但实际转速仍受“撞墙最大转速”限制。', () => STEERING_TUNING.poolWallHeadingCorrectionRate, (v) => STEERING_TUNING.poolWallHeadingCorrectionRate = v, 0.1, 0, 8, 1, '/s'),
            control('steer.poolWallMaxTurnRate', '撞墙最大转速', '侧墙回正过程允许的最大偏航角速度。只限制撞墙脱离，不影响正常划水的最大偏航角速度。', () => STEERING_TUNING.poolWallMaxTurnRate, (v) => STEERING_TUNING.poolWallMaxTurnRate = v, 2, 5, 120, 0, '°/s'),
            control('steer.poolWallEscapeHeadingDegrees', '最小离墙角', '侧墙回正最终停住的向内偏航角。达到后立即刹住墙体回正角速度并交还玩家控制。', () => STEERING_TUNING.poolWallEscapeHeadingDegrees, (v) => STEERING_TUNING.poolWallEscapeHeadingDegrees = v, 1, 0, 45, 0, '°'),
            control('steer.kickStraightenMinCadenceHz', '踢腿回正频率', '短点按形成的踢腿频率达到该值后，角色会逐渐转回泳道正前方。设为 0 时每次踢腿都会触发回正。', () => STEERING_TUNING.kickStraightenMinCadenceHz, (v) => STEERING_TUNING.kickStraightenMinCadenceHz = v, 0.25, 0, 10, 2, 'Hz'),
            control('steer.kickStraightenRate', '踢腿回正速度', '连续踢腿时将偏航目标拉回泳道方向的速度。角色仍按“转向平滑”逐渐跟随，不会瞬间掰正。设为 0 可关闭。', () => STEERING_TUNING.kickStraightenRate, (v) => STEERING_TUNING.kickStraightenRate = v, 0.1, 0, 8, 1, '/s'),
            control('steer.turnPowerMinFactor', '最弱转向倍率', '转向角与划水发力挂钩：按得越久、拉水行程越长偏得越多。这是最短划水的转向倍率（拉满=1.0）。1=不按力度缩放，每次都满角；越小轻点与重划的转向差别越大。', () => STEERING_TUNING.turnPowerMinFactor, (v) => STEERING_TUNING.turnPowerMinFactor = v, 0.05, 0, 1, 2),
            control('steer.aiCorrectHeadingRatio', 'AI纠偏阈值', 'AI 偏离多少（占“最大偏航”的比例）后开始主动往回划纠偏。越小 AI 越早纠偏、游得越直；越大越放任、蛇形越大。AI 与玩家共用同一套划水转向，只是自己决定划哪一侧。', () => STEERING_TUNING.aiCorrectHeadingRatio, (v) => STEERING_TUNING.aiCorrectHeadingRatio = v, 0.05, 0, 1, 2),
            control('steer.aiWanderChance', 'AI乱划概率', 'AI 接近直行时，打破整齐左右交替、重复同一侧（从而开始蛇形）的基础概率，实际按 (1-难度) 缩放：强对手几乎不乱划走直线，弱对手常乱划乱窜。', () => STEERING_TUNING.aiWanderChance, (v) => STEERING_TUNING.aiWanderChance = v, 0.05, 0, 1, 2),
            control('steer.poolWallClearance', '撞墙余量', '人物确定性包围体与泳池侧墙之间保留的最小距离（米），横向漂移到此就贴墙滑行。', () => STEERING_TUNING.poolWallClearance, (v) => STEERING_TUNING.poolWallClearance = v, 0.05, 0, 1.5, 2, 'm'),
            control('steer.poolBoundaryBodyHalfLength', '边界体半长', '用于撞墙和封道判定的人物确定性包围体半长。偏航越大，半长投影到横向越多；它不依赖当前骨骼动作。', () => STEERING_TUNING.poolBoundaryBodyHalfLength, (v) => STEERING_TUNING.poolBoundaryBodyHalfLength = v, 0.05, 0.5, 2.5, 2, 'm'),
            control('steer.poolBoundaryBodyHalfWidth', '边界体半宽', '用于撞墙和封道判定的人物确定性包围体半宽。直游时主要由该值决定贴墙距离；它不依赖角色模型或当前骨骼动作。', () => STEERING_TUNING.poolBoundaryBodyHalfWidth, (v) => STEERING_TUNING.poolBoundaryBodyHalfWidth = v, 0.05, 0.2, 1.5, 2, 'm'),
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
            waterControl('water.bodyR', '水上看身体 R', '相机在水面上方时，水下角色颜色过滤的红通道，0-255。它是相对透光颜色，不会把黑泳衣直接染蓝。', () => WATER_COLOR_TUNING.bodyR, (v) => WATER_COLOR_TUNING.bodyR = v),
            waterControl('water.bodyG', '水上看身体 G', '相机在水面上方时，水下角色颜色过滤的绿通道，0-255。', () => WATER_COLOR_TUNING.bodyG, (v) => WATER_COLOR_TUNING.bodyG = v),
            waterControl('water.bodyB', '水上看身体 B', '相机在水面上方时，水下角色颜色过滤的蓝通道，0-255。', () => WATER_COLOR_TUNING.bodyB, (v) => WATER_COLOR_TUNING.bodyB = v),
            control('water.bodyStrength', '水上看过滤强度', '水上相机隔着水面看水下角色时的颜色衰减强度：0=保留原色，1=完全按透光比例过滤。', () => WATER_COLOR_TUNING.bodyStrength, (v) => { WATER_COLOR_TUNING.bodyStrength = v; applyWaterColorTuning(); }, 0.02, 0, 1, 2),
            waterControl('water.underBodyR', '水下看身体 R', '相机在水下时，近处角色颜色过滤的红通道，0-255。', () => WATER_COLOR_TUNING.underBodyR, (v) => WATER_COLOR_TUNING.underBodyR = v),
            waterControl('water.underBodyG', '水下看身体 G', '相机在水下时，近处角色颜色过滤的绿通道，0-255。', () => WATER_COLOR_TUNING.underBodyG, (v) => WATER_COLOR_TUNING.underBodyG = v),
            waterControl('water.underBodyB', '水下看身体 B', '相机在水下时，近处角色颜色过滤的蓝通道，0-255。', () => WATER_COLOR_TUNING.underBodyB, (v) => WATER_COLOR_TUNING.underBodyB = v),
            control('water.underBodyStrength', '水下看过滤强度', '水下相机看近处角色时的颜色衰减强度；应低于水上视角，以保留现实水下摄影中的暖肤色。', () => WATER_COLOR_TUNING.underBodyStrength, (v) => { WATER_COLOR_TUNING.underBodyStrength = v; applyWaterColorTuning(); }, 0.02, 0, 1, 2),
            control('water.underLightMin', '水下非顶光亮度', '水下相机看到的角色侧面和朝下表面亮度倍率；越低，除顶光外的身体越暗。', () => WATER_COLOR_TUNING.underLightMin, (v) => { WATER_COLOR_TUNING.underLightMin = v; applyWaterColorTuning(); }, 0.02, 0.1, 1.2, 2),
            control('water.underLightMax', '水下朝光面亮度', '水下相机看到的角色朝向水面的亮度倍率；保持接近 1 可避免灰白过曝。', () => WATER_COLOR_TUNING.underLightMax, (v) => { WATER_COLOR_TUNING.underLightMax = v; applyWaterColorTuning(); }, 0.02, 0.5, 1.4, 2),
            control('water.surfaceLightMin', '水上看非顶光亮度', '水上相机看到浸水角色时，侧面和朝下表面的亮度倍率。', () => WATER_COLOR_TUNING.surfaceLightMin, (v) => { WATER_COLOR_TUNING.surfaceLightMin = v; applyWaterColorTuning(); }, 0.02, 0.1, 1.2, 2),
            control('water.surfaceLightMax', '水上朝光面亮度', '水上相机看到水下角色时，朝向水面的亮度倍率。', () => WATER_COLOR_TUNING.surfaceLightMax, (v) => { WATER_COLOR_TUNING.surfaceLightMax = v; applyWaterColorTuning(); }, 0.02, 0.5, 1.4, 2),
            control('water.underShadowBlue', '水下暗部偏蓝', '水下相机看到的角色暗部混入水色的强度；只改变色相并尽量保持原亮度。', () => WATER_COLOR_TUNING.underShadowBlue, (v) => { WATER_COLOR_TUNING.underShadowBlue = v; applyWaterColorTuning(); }, 0.02, 0, 0.5, 2),
            control('water.surfaceShadowBlue', '水上看暗部偏蓝', '水上相机看到的浸水角色暗部混入水色的强度；当前截图主要由这个参数控制。', () => WATER_COLOR_TUNING.surfaceShadowBlue, (v) => { WATER_COLOR_TUNING.surfaceShadowBlue = v; applyWaterColorTuning(); }, 0.02, 0, 0.5, 2),
            waterControl('water.aboveR', '出水部分色 R', '水下相机看到的、露出水面那部分身体渐隐到的颜色红通道，0-255。仅相机在水下时生效。', () => WATER_COLOR_TUNING.aboveR, (v) => WATER_COLOR_TUNING.aboveR = v),
            waterControl('water.aboveG', '出水部分色 G', '露出水面那部分身体渐隐到的颜色绿通道，0-255。', () => WATER_COLOR_TUNING.aboveG, (v) => WATER_COLOR_TUNING.aboveG = v),
            waterControl('water.aboveB', '出水部分色 B', '露出水面那部分身体渐隐到的颜色蓝通道，0-255。', () => WATER_COLOR_TUNING.aboveB, (v) => WATER_COLOR_TUNING.aboveB = v),
            control('water.aboveStrength', '出水部分浓度', '水下相机时，身体露出水面部分的雾化强度：0=不处理（看着像穿帮），1=完全变成上面那个色（像透过水面看）。', () => WATER_COLOR_TUNING.aboveStrength, (v) => { WATER_COLOR_TUNING.aboveStrength = v; applyWaterColorTuning(); }, 0.02, 0, 1, 2),
            waterControl('water.floorR', '池底近色 R', '水下相机附近池底/池壁颜色的红通道；适当提高可消除过强的绿色感。', () => WATER_COLOR_TUNING.floorR, (v) => WATER_COLOR_TUNING.floorR = v),
            waterControl('water.floorG', '池底近色 G', '水下相机附近池底/池壁颜色的绿通道，0-255。', () => WATER_COLOR_TUNING.floorG, (v) => WATER_COLOR_TUNING.floorG = v),
            waterControl('water.floorB', '池底近色 B', '水下相机附近池底/池壁颜色的蓝通道，0-255。', () => WATER_COLOR_TUNING.floorB, (v) => WATER_COLOR_TUNING.floorB = v),
            waterControl('water.floorFarR', '池底远色 R', '远处池底最终吸收到的深蓝色红通道，0-255。', () => WATER_COLOR_TUNING.floorFarR, (v) => WATER_COLOR_TUNING.floorFarR = v),
            waterControl('water.floorFarG', '池底远色 G', '远处池底最终吸收到的深蓝色绿通道，0-255。', () => WATER_COLOR_TUNING.floorFarG, (v) => WATER_COLOR_TUNING.floorFarG = v),
            waterControl('water.floorFarB', '池底远色 B', '远处池底最终吸收到的深蓝色蓝通道，0-255。', () => WATER_COLOR_TUNING.floorFarB, (v) => WATER_COLOR_TUNING.floorFarB = v),
            control('water.reflectionBlue', '反光蓝浓度', '水下时水面镜面反射偏蓝的强度：0=原始反射（偏白），1=完全偏深水蓝。', () => WATER_COLOR_TUNING.reflectionBlue, (v) => { WATER_COLOR_TUNING.reflectionBlue = v; applyWaterColorTuning(); }, 0.02, 0, 1, 2),
            control('water.floorFarStrength', '水下远色浓度', '远处瓷砖吸收到独立深蓝色的强度：0=不渐变，1=远处完全成为设定的远色。', () => WATER_COLOR_TUNING.floorFarStrength, (v) => { WATER_COLOR_TUNING.floorFarStrength = v; applyWaterColorTuning(); }, 0.02, 0, 1, 2),
            control('water.floorFarStart', '水下渐变起点', '瓷砖离相机多远开始转向深蓝。默认 0 表示从镜头附近就以很低斜率连续变化，避免形成近色平台边界。', () => WATER_COLOR_TUNING.floorFarStart, (v) => { WATER_COLOR_TUNING.floorFarStart = v; applyWaterColorTuning(); }, 0.5, 0, 30, 1, 'm'),
            control('water.floorFarEnd', '水下渐变尺度', '控制远色吸收的距离尺度；到该距离时约完成 80% 转色，之后仍会继续自然接近远色，不产生硬终点。', () => WATER_COLOR_TUNING.floorFarEnd, (v) => { WATER_COLOR_TUNING.floorFarEnd = v; applyWaterColorTuning(); }, 0.5, 1, 60, 1, 'm'),
        ],
    },
];

export function resetTuningToDefaults() {
    applyTuningSnapshot(defaultTuningSnapshot());
}

export function saveCurrentTuning(): TuningSaveResult {
    validateTuningRelations();
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
    defaultTuningSnapshot();
    const candidate = loadRuntimeTuningCandidate();
    if (!candidate) {
        return false;
    }
    applyTuningCandidate(candidate);
    return true;
}

export function loadSavedTuningAsync(onComplete: () => void) {
    defaultTuningSnapshot();
    resources.load(PROJECT_TUNING_RESOURCE, JsonAsset, (err, asset) => {
        const projectCandidate = !err && asset?.json
            ? createTuningLoadCandidate(
                'project',
                asset.json as TuningFileData,
                PROJECT_TUNING_ASSET_PATH,
            )
            : null;
        const selected = selectNewerTuningCandidate(
            projectCandidate,
            loadRuntimeTuningCandidate(),
        );
        if (selected) {
            applyTuningCandidate(selected);
        }
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
        set: (value) => {
            set(clamp(roundTo(value, precision), min, max));
            if (!_suspendRelationValidation) {
                validateTuningRelations(id);
            }
        },
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
let _suspendRelationValidation = false;

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

function applyTuningSnapshot(snapshot: Record<string, unknown>) {
    warnUnknownTuningKeys(snapshot);
    const invalidValues = collectInvalidLegacyTuningValues(snapshot);
    snapshot = migrateTuningSnapshot(snapshot);
    const clampedValues: string[] = [];
    _suspendRelationValidation = true;
    try {
        forEachControl((control, group) => {
            const legacyLabelKey = `${group.name}.${control.label}`;
            const key = Object.prototype.hasOwnProperty.call(snapshot, control.id)
                ? control.id
                : Object.prototype.hasOwnProperty.call(snapshot, legacyLabelKey)
                    ? legacyLabelKey
                    : null;
            if (!key) {
                return;
            }
            const value = snapshot[key];
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                invalidValues.push(`${key}=${formatTuningValue(value)}`);
                return;
            }
            if (value < control.min || value > control.max) {
                const adopted = clamp(roundTo(value, control.precision), control.min, control.max);
                clampedValues.push(`${key}=${value} -> ${adopted}`);
            }
            control.set(value);
        });
    } finally {
        _suspendRelationValidation = false;
    }
    if (invalidValues.length > 0) {
        console.warn(`[SpeedSwimming] tuning ignored invalid known values: ${invalidValues.join(', ')}`);
    }
    if (clampedValues.length > 0) {
        console.warn(`[SpeedSwimming] tuning clamped out-of-range values: ${clampedValues.join(', ')}`);
    }
    const savedDolphinCost = snapshot['ultimate.dolphinCost'];
    const savedMaxEnergy = snapshot['ultimate.maxEnergy'];
    const relationSourceId = typeof savedDolphinCost === 'number'
        && Number.isFinite(savedDolphinCost)
        && (typeof savedMaxEnergy !== 'number' || !Number.isFinite(savedMaxEnergy))
        ? 'ultimate.dolphinCost'
        : undefined;
    validateTuningRelations(relationSourceId);
}

function warnUnknownTuningKeys(snapshot: Record<string, unknown>) {
    const knownKeys = new Set<string>();
    forEachControl((control, group) => {
        knownKeys.add(control.id);
        knownKeys.add(`${group.name}.${control.label}`);
    });
    const unknownKeys = Object.keys(snapshot)
        .filter((key) => !knownKeys.has(key) && !isKnownLegacyTuningKey(key))
        .sort();
    if (unknownKeys.length > 0) {
        console.warn(`[SpeedSwimming] tuning ignored unknown keys: ${unknownKeys.join(', ')}`);
    }
}

function formatTuningValue(value: unknown): string {
    if (typeof value === 'string') {
        return JSON.stringify(value);
    }
    if (value === undefined) {
        return 'undefined';
    }
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}

function collectInvalidLegacyTuningValues(snapshot: Record<string, unknown>): string[] {
    return Object.keys(snapshot)
        .filter((key) => isKnownLegacyTuningKey(key))
        .filter((key) => typeof snapshot[key] !== 'number' || !Number.isFinite(snapshot[key]))
        .map((key) => `${key}=${formatTuningValue(snapshot[key])}`);
}

const RETIRED_CONDITION_TUNING_KEYS = new Set([
    'condition.effortDecay', 'condition.easeUp', 'condition.easeDown',
    '心率显示.努力采样衰减', '心率显示.心率上升速率', '心率显示.心率下降速率',
    '海豚跃.起跳心率增长',
    'strokeQuality.perfectVisualReleaseGraceSeconds',
    '划水.黄色松手宽容',
    'difficulty.beginner.armCycleSpeedScale',
    'difficulty.competitive.armCycleSpeedScale',
    'difficulty.championship.armCycleSpeedScale',
    '划水.调试玩家轮速',
    '划水.竞技玩家轮速',
    '划水.世锦赛及AI轮速',
    'strokeQuality.qualityZoneScaleStrength',
    '划水.质量甜区强度',
    'condition.strokeDrainLow',
    '划水.低区每划体力',
    'condition.strokeDrainOptimal',
    '划水.最佳区每划体力',
    'condition.strokeDrainHighPressure',
    '划水.高压区每划体力',
    'condition.strokeDrainOverload',
    '划水.过载区每划体力',
    'condition.depletionCooldown',
    '划水.体力耗尽冷却',
    'condition.efficiencyFloor',
    '划水.效率地板',
    'condition.curveExponent',
    '划水.效率曲线指数',
    'condition.cadenceWarningRatio',
    '划水.降频预警体力',
    'condition.cadenceExhaustedRatio',
    '划水.降频力竭体力',
    'condition.cadenceWarningScale',
    '划水.力竭入口划频',
    'condition.cadenceExhaustedScale',
    '划水.空体力划频',
    'condition.regenLow',
    '划水.低区回血',
    'condition.regenOptimal',
    '划水.最佳区回血',
    'condition.regenHighPressure',
    '划水.高压区回血',
    'condition.regenOverload',
    '划水.过载区回血',
    'condition.regenSprintBoost',
    '划水.冲刺回血加成',
]);

const RETIRED_AI_TUNING_KEYS = new Set(["ai.gapSecondsFast", "ai.timingSigmaHigh", "aiStrategy.duelBoost", "aiStrategy.duelRange", "aiStrategy.effortEaseRate", "aiStrategy.finishRampStartProgress", "aiStrategy.maxModifier", "aiStrategy.rubberBandRange", "aiStrategy.rubberBandStrength", "aiStrategy.startFadeProgress", "difficulty.championship.aiDifficultyScale", "difficulty.championship.duelScale", "difficulty.championship.rubberBandScale", "difficulty.championship.weaveScale"]);

function isKnownLegacyTuningKey(key: string): boolean {
    if (RETIRED_CONDITION_TUNING_KEYS.has(key) || RETIRED_AI_TUNING_KEYS.has(key)) return true;
    if (key === 'dolphin.triggerHoldSeconds'
        || key === '海豚跃.双手长按触发'
        || key === 'speed.strokeStabilityAccel'
        || key === 'axialRoll.waterRightingTorque'
        || key === 'axialRoll.tippingStartDegrees'
        || key === 'stability.armReleaseSweetCenter'
        || key === 'stability.armReleasePerfectHalfWidth'
        || key === 'stability.armReleaseGoodHalfWidth') {
        return true;
    }
    if (!key.startsWith('stability.')) {
        return false;
    }
    return [
        'minHoldSeconds',
        'goodStart',
        'goodEnd',
        'perfectStart',
        'perfectEnd',
        'armCycleLowSpeedPerSecond',
        'armCycleHighSpeedPerSecond',
        'armCycleSpeedStart',
        'armCycleSpeedFull',
    ].indexOf(key.slice('stability.'.length)) >= 0;
}

function migrateTuningSnapshot(snapshot: Record<string, unknown>): Record<string, unknown> {
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
    renameLegacyKey('axialRoll.waterRightingTorque', 'axialRoll.hullRightingTorque');
    renameLegacyKey('axialRoll.tippingStartDegrees', 'axialRoll.treadWaterProneToleranceDegrees');
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

function validateTuningRelations(changedId?: string) {
    if (ULTIMATE_ENERGY_BALANCE.dolphinCost !== ULTIMATE_ENERGY_BALANCE.maxEnergy) {
        if (changedId === 'ultimate.dolphinCost') {
            const fixed = ULTIMATE_ENERGY_BALANCE.dolphinCost;
            console.warn(
                `[SpeedSwimming] tuning adjusted: ultimate.maxEnergy must equal dolphin cost; ` +
                `set to ${fixed.toFixed(0)}`,
            );
            ULTIMATE_ENERGY_BALANCE.maxEnergy = fixed;
        } else {
            const fixed = ULTIMATE_ENERGY_BALANCE.maxEnergy;
            console.warn(
                `[SpeedSwimming] tuning adjusted: ultimate.dolphinCost must equal max energy; ` +
                `set to ${fixed.toFixed(0)}`,
            );
            ULTIMATE_ENERGY_BALANCE.dolphinCost = fixed;
        }
    }

    if (SWIMMER_BALANCE.kickMaxSpeed > SWIMMER_BALANCE.maxSpeed) {
        console.warn(
            `[SpeedSwimming] tuning adjusted: speed.kickMaxSpeed ${SWIMMER_BALANCE.kickMaxSpeed.toFixed(2)} ` +
            `exceeded speed.maxSpeed ${SWIMMER_BALANCE.maxSpeed.toFixed(2)}`,
        );
        SWIMMER_BALANCE.kickMaxSpeed = SWIMMER_BALANCE.maxSpeed;
    }
    if (SWIMMER_BALANCE.kickCadenceMeasureMaxHz < SWIMMER_BALANCE.kickCadenceMaxHz) {
        console.warn(
            `[SpeedSwimming] tuning adjusted: speed.kickCadenceMeasureMaxHz ` +
            `${SWIMMER_BALANCE.kickCadenceMeasureMaxHz.toFixed(1)} was below propulsion cap ` +
            `${SWIMMER_BALANCE.kickCadenceMaxHz.toFixed(1)}`,
        );
        SWIMMER_BALANCE.kickCadenceMeasureMaxHz = SWIMMER_BALANCE.kickCadenceMaxHz;
    }

    if (CHARACTER_POSE_TUNING.flipTurnUnderwaterGlideDepth < CHARACTER_POSE_TUNING.flipTurnUnderwaterDepth) {
        console.warn(
            `[SpeedSwimming] tuning adjusted: motion.flipTurnUnderwaterGlideDepth must not be shallower ` +
            `than motion.flipTurnUnderwaterDepth; set to ${CHARACTER_POSE_TUNING.flipTurnUnderwaterDepth.toFixed(2)}`,
        );
        CHARACTER_POSE_TUNING.flipTurnUnderwaterGlideDepth = CHARACTER_POSE_TUNING.flipTurnUnderwaterDepth;
    }

    const safeMaxHeading = clamp(STEERING_TUNING.maxHeading, 0, MAX_STEERING_HEADING_DEGREES);
    if (safeMaxHeading !== STEERING_TUNING.maxHeading) {
        console.warn(
            `[SpeedSwimming] tuning adjusted: steer.maxHeading ` +
            `${STEERING_TUNING.maxHeading.toFixed(1)}° exceeded the safe forward-only range; ` +
            `set to ${safeMaxHeading.toFixed(1)}°`,
        );
        STEERING_TUNING.maxHeading = safeMaxHeading;
    }
    if (AXIAL_ROLL_TUNING.hullFadeFullAngularSpeed <= AXIAL_ROLL_TUNING.hullFadeStartAngularSpeed) {
        const fixed = AXIAL_ROLL_TUNING.hullFadeStartAngularSpeed + 1;
        console.warn(
            `[SpeedSwimming] tuning adjusted: axialRoll.hullFadeFullAngularSpeed ` +
            `${AXIAL_ROLL_TUNING.hullFadeFullAngularSpeed.toFixed(1)} must be above fade start; ` +
            `set to ${fixed.toFixed(1)}`,
        );
        AXIAL_ROLL_TUNING.hullFadeFullAngularSpeed = fixed;
    }
    if (COLLISION_PITCH_TUNING.tumblePenaltyFullAngularSpeed <= COLLISION_PITCH_TUNING.tumblePenaltyStartAngularSpeed) {
        const fixed = COLLISION_PITCH_TUNING.tumblePenaltyStartAngularSpeed + 1;
        console.warn(
            `[SpeedSwimming] tuning adjusted: collision.pitchPenaltyFull must be above pitchPenaltyStart; ` +
            `set to ${fixed.toFixed(1)}`,
        );
        COLLISION_PITCH_TUNING.tumblePenaltyFullAngularSpeed = fixed;
    }
    if (AXIAL_ROLL_TUNING.tumblePenaltyFullAngularSpeed <= AXIAL_ROLL_TUNING.tumblePenaltyStartAngularSpeed) {
        const fixed = AXIAL_ROLL_TUNING.tumblePenaltyStartAngularSpeed + 1;
        console.warn(
            `[SpeedSwimming] tuning adjusted: axialRoll.tumblePenaltyFullAngularSpeed must be above start; ` +
            `set to ${fixed.toFixed(1)}`,
        );
        AXIAL_ROLL_TUNING.tumblePenaltyFullAngularSpeed = fixed;
    }
    if (AI_STROKE_TUNING.maxReleaseProgress >= STROKE_QUALITY_TUNING.armStrokeTimeoutProgress) {
        const fixed = Math.min(1, AI_STROKE_TUNING.maxReleaseProgress + 0.01);
        console.warn(
            `[SpeedSwimming] tuning adjusted: gesture.armStrokeTimeoutProgress must be above ` +
            `ai.maxReleaseProgress; set to ${fixed.toFixed(2)}`,
        );
        STROKE_QUALITY_TUNING.armStrokeTimeoutProgress = fixed;
    }
    const timeoutProgress = clamp(STROKE_QUALITY_TUNING.armStrokeTimeoutProgress, 0.05, 1);
    const good = normalizeRange(STROKE_QUALITY_TUNING.goodStart, STROKE_QUALITY_TUNING.goodEnd, timeoutProgress, 'strokeQuality.good');
    STROKE_QUALITY_TUNING.goodStart = good.start;
    STROKE_QUALITY_TUNING.goodEnd = good.end;
    const perfect = normalizeRangeWithin(
        STROKE_QUALITY_TUNING.perfectStart,
        STROKE_QUALITY_TUNING.perfectEnd,
        good.start,
        good.end,
        'strokeQuality.perfect',
    );
    STROKE_QUALITY_TUNING.perfectStart = perfect.start;
    STROKE_QUALITY_TUNING.perfectEnd = perfect.end;

    if (AI_STROKE_TUNING.startDelayMax < AI_STROKE_TUNING.startDelayMin) {
        console.warn('[SpeedSwimming] tuning adjusted: ai.startDelayMax must not be below startDelayMin');
        AI_STROKE_TUNING.startDelayMax = AI_STROKE_TUNING.startDelayMin;
    }

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

function normalizeRangeWithin(
    startValue: number,
    endValue: number,
    minStart: number,
    maxEnd: number,
    label: string,
): { start: number; end: number } {
    let start = clamp(Math.min(startValue, endValue), minStart, maxEnd);
    let end = clamp(Math.max(startValue, endValue), minStart, maxEnd);
    if (end - start < 0.001) {
        end = Math.min(maxEnd, start + 0.001);
        start = Math.max(minStart, end - 0.001);
    }
    if (Math.abs(start - startValue) > 0.0001 || Math.abs(end - endValue) > 0.0001) {
        console.warn(`[SpeedSwimming] tuning adjusted: ${label} range -> ${start.toFixed(3)}..${end.toFixed(3)}`);
    }
    return { start, end };
}

function applyTuningCandidate(candidate: TuningLoadCandidate) {
    warnTuningFileVersion(candidate);
    applyTuningSnapshot(getValuesFromTuningData(candidate.data));
    logLoadedTuning(candidate);
}

function warnTuningFileVersion(candidate: TuningLoadCandidate) {
    const hasValuesWrapper = Object.prototype.hasOwnProperty.call(candidate.data, 'values');
    if (!hasValuesWrapper) {
        return;
    }
    const version = candidate.data.version;
    if (typeof version !== 'number' || !Number.isFinite(version) || !Number.isInteger(version)) {
        console.warn(
            `[SpeedSwimming] tuning ${candidate.source} file has an invalid or missing version; ` +
            `expected ${TUNING_FILE_VERSION}, loading compatible values only`,
        );
        return;
    }
    if (version !== TUNING_FILE_VERSION) {
        console.warn(
            `[SpeedSwimming] tuning ${candidate.source} file version ${version} differs from ` +
            `current version ${TUNING_FILE_VERSION}; loading with compatibility migration`,
        );
    }
}

function getValuesFromTuningData(data: TuningLoadData): Record<string, unknown> {
    const values = extractTuningValues(data);
    if (values) {
        return values;
    }
    console.warn('[SpeedSwimming] tuning data must be an object with an object-valued values field');
    return {};
}

function extractTuningValues(data: unknown): Record<string, unknown> | null {
    if (!isRecord(data)) {
        return null;
    }
    if (!Object.prototype.hasOwnProperty.call(data, 'values')) {
        return data;
    }
    return isRecord(data.values) ? data.values : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasUsableKnownTuningValue(data: TuningLoadData): boolean {
    const values = extractTuningValues(data);
    if (!values) {
        return false;
    }
    const migrated = migrateTuningSnapshot(values);
    let usable = false;
    forEachControl((control, group) => {
        if (usable) {
            return;
        }
        const legacyLabelKey = `${group.name}.${control.label}`;
        const key = Object.prototype.hasOwnProperty.call(migrated, control.id)
            ? control.id
            : Object.prototype.hasOwnProperty.call(migrated, legacyLabelKey)
                ? legacyLabelKey
                : null;
        const value = key ? migrated[key] : undefined;
        usable = typeof value === 'number' && Number.isFinite(value);
    });
    return usable;
}

function warnUnusableTuningCandidate(source: TuningLoadSource, data: TuningLoadData) {
    const values = extractTuningValues(data);
    if (!values) {
        console.warn(`[SpeedSwimming] ignored ${source} tuning candidate: invalid file/value structure`);
        return;
    }
    warnUnknownTuningKeys(values);
    const invalidValues = collectInvalidLegacyTuningValues(values);
    forEachControl((control, group) => {
        const legacyLabelKey = `${group.name}.${control.label}`;
        const key = Object.prototype.hasOwnProperty.call(values, control.id)
            ? control.id
            : Object.prototype.hasOwnProperty.call(values, legacyLabelKey)
                ? legacyLabelKey
                : null;
        if (!key) {
            return;
        }
        const value = values[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            invalidValues.push(`${key}=${formatTuningValue(value)}`);
        }
    });
    if (invalidValues.length > 0) {
        console.warn(`[SpeedSwimming] tuning ignored invalid known values: ${invalidValues.join(', ')}`);
    }
    console.warn(`[SpeedSwimming] ignored ${source} tuning candidate: no usable known tuning values`);
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

function loadNativeTuningFile(): TuningLoadData | null {
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
        return JSON.parse(raw) as TuningLoadData;
    } catch (error) {
        console.warn('[SpeedSwimming] failed to load native tuning file', error);
        return null;
    }
}

function loadLocalStorageTuningFile(): TuningLoadData | null {
    try {
        const raw = sys.localStorage.getItem(TUNING_STORAGE_KEY);
        return raw ? JSON.parse(raw) as TuningLoadData : null;
    } catch (error) {
        console.warn('[SpeedSwimming] failed to load tuning settings backup', error);
        return null;
    }
}

function loadRuntimeTuningCandidate(): TuningLoadCandidate | null {
    const nativeData = loadNativeTuningFile();
    const nativeCandidate = nativeData
        ? createTuningLoadCandidate('native', nativeData, getNativeTuningFilePath() ?? undefined)
        : null;
    const localStorageData = loadLocalStorageTuningFile();
    const localStorageCandidate = localStorageData
        ? createTuningLoadCandidate('localStorage', localStorageData)
        : null;
    return selectNewerTuningCandidate(nativeCandidate, localStorageCandidate);
}

function createTuningLoadCandidate(
    source: TuningLoadSource,
    data: TuningLoadData,
    path?: string,
): TuningLoadCandidate | null {
    if (!hasUsableKnownTuningValue(data)) {
        warnUnusableTuningCandidate(source, data);
        return null;
    }
    const updatedAt = (data as TuningFileData).updatedAt;
    const parsedUpdatedAt = typeof updatedAt === 'string' ? Date.parse(updatedAt) : Number.NaN;
    return {
        source,
        data,
        updatedAtMs: Number.isFinite(parsedUpdatedAt) ? parsedUpdatedAt : null,
        path,
    };
}

function selectNewerTuningCandidate(
    baseline: TuningLoadCandidate | null,
    override: TuningLoadCandidate | null,
): TuningLoadCandidate | null {
    if (!baseline) {
        return override;
    }
    if (!override) {
        return baseline;
    }
    if (override.updatedAtMs !== null
        && (baseline.updatedAtMs === null || override.updatedAtMs > baseline.updatedAtMs)) {
        return override;
    }
    return baseline;
}

function logLoadedTuning(candidate: TuningLoadCandidate) {
    if (candidate.source === 'project') {
        console.log(`[SpeedSwimming] tuning loaded from project resource ${PROJECT_TUNING_ASSET_PATH}`);
    } else if (candidate.source === 'native') {
        console.log(`[SpeedSwimming] tuning loaded from native writable path ${candidate.path ?? ''}`);
    } else {
        console.log('[SpeedSwimming] tuning loaded from localStorage backup');
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
