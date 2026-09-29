import { SeededRandom } from './SharedRNG';
import { geyserSpec } from './GeyserBrawlRules';
import { WHIRLPOOL_SUPER_CHANCE } from './WhirlpoolBrawlRules';
import type { EntertainmentRacePlan } from './EntertainmentRacePlan';

export const enum EntertainmentEventId {
    STIMULANT = 0,
    TIMED_BOMB = 1,
    WHIRLPOOL = 2,
    MINEFIELD = 3,
    OBSTACLE = 3,
    SHARK = 4,
    CANNON = 5,
    LITTER = 6,
    TURTLE_BUS = 7,
    GEYSER = 8,
    GIANT_WAVE = 9,
}

/** 正式娱乐导演从六种候选中按赛程抽取三至六种。 */
export const ENTERTAINMENT_LITTER_SELECTION_ENABLED = true;

export const enum EntertainmentDirectorPhase {
    OPENING = 0,
    PREVIEW = 1,
    ACTIVE = 2,
    GAP = 3,
    COMPLETE = 4,
    CLOSING = 5,
}

export type EntertainmentDirectorState = {
    revision: number;
    phase: EntertainmentDirectorPhase;
    eventIndex: number;
    eventCount: number;
    remainingSeconds: number;
    packedEvents: number;
    activatedMask: number;
    residentMask: number;
    specialMask: number;
    activationSerial: number;
    lastActivatedEvent: EntertainmentEventId | null;
    encoreRound: number;
    encoreEvent: EntertainmentEventId | null;
    anchorDistance: number;
    eventAnchorDistances: readonly number[];
};

export type EntertainmentDirectorTransition = {
    snapshotAccepted?: boolean;
    cancelledPreview: boolean;
    previewEvent: EntertainmentEventId | null;
    activatedEvent: EntertainmentEventId | null;
    recoveredEvent: EntertainmentEventId | null;
    finishedEvent: EntertainmentEventId | null;
};

const OPENING_SECONDS = 4;
const THREE_EVENT_PREVIEW_SECONDS = 6;
const FOUR_EVENT_PREVIEW_SECONDS = 5;
const LONG_RACE_PREVIEW_SECONDS = 6;
const SHORT_RACE_GAP_SECONDS = 5;
const LONG_RACE_GAP_SECONDS = 8;
const ENCORE_GAP_MIN_SECONDS = 10;
const ENCORE_GAP_VARIATION_SECONDS = 2;
const FOUR_EVENT_DURATION_SCALE = 0.75;
const LONG_RACE_DURATION_SCALE = 1.4;
const MAX_EVENT_COUNT = 6;
const ENTERTAINMENT_SPECIAL_RANDOM_SALT = 0x53504543;
const ENTERTAINMENT_ENCORE_RANDOM_SALT = 0x454e434f;
const ENTERTAINMENT_COPY_RANDOM_SALT = 0x42524353;
const ENTERTAINMENT_COPY_SPECIAL_SALT = 0x53555052;
const ENTERTAINMENT_COPY_VARIANT_STEPS = [1, 3, 7, 9, 11, 13, 17, 19] as const;
const EVENT_PROGRESS_BY_COUNT: Readonly<Record<number, readonly number[]>> = {
    3: [0.12, 0.48, 0.82],
    4: [0.10, 0.35, 0.60, 0.85],
    5: [0.08, 0.29, 0.50, 0.71, 0.90],
    6: [0.08, 0.24, 0.40, 0.56, 0.72, 0.90],
};
const ENCORE_EVENTS: readonly EntertainmentEventId[] = [
    EntertainmentEventId.CANNON,
    EntertainmentEventId.SHARK,
    EntertainmentEventId.TIMED_BOMB,
];
const EVENT_DURATION_SECONDS: Readonly<Record<EntertainmentEventId, number>> = {
    [EntertainmentEventId.STIMULANT]: 10,
    [EntertainmentEventId.TIMED_BOMB]: 10,
    [EntertainmentEventId.WHIRLPOOL]: 8,
    [EntertainmentEventId.MINEFIELD]: 8,
    [EntertainmentEventId.SHARK]: 13,
    [EntertainmentEventId.CANNON]: 7,
    [EntertainmentEventId.LITTER]: 8,
    [EntertainmentEventId.TURTLE_BUS]: 15,
    [EntertainmentEventId.GEYSER]: geyserSpec(2).actionSeconds,
    [EntertainmentEventId.GIANT_WAVE]: 20,
};
const PERSISTENT_EVENTS_MASK = eventBit(EntertainmentEventId.STIMULANT)
    | eventBit(EntertainmentEventId.WHIRLPOOL)
    | eventBit(EntertainmentEventId.MINEFIELD)
    | eventBit(EntertainmentEventId.SHARK)
    | eventBit(EntertainmentEventId.CANNON);
export const ENTERTAINMENT_SELECTABLE_EVENTS: readonly EntertainmentEventId[] = [
    EntertainmentEventId.STIMULANT, EntertainmentEventId.TIMED_BOMB,
    EntertainmentEventId.WHIRLPOOL, EntertainmentEventId.OBSTACLE,
    EntertainmentEventId.SHARK, EntertainmentEventId.CANNON,
    EntertainmentEventId.TURTLE_BUS, EntertainmentEventId.GEYSER,
    EntertainmentEventId.GIANT_WAVE,
];

let runtimeResidentMask = 0;
let runtimeActiveEvent: EntertainmentEventId | null = null;

/** 赛中热路径只读取两个整数；独立玩法不经过这里。 */
export function isEntertainmentEventResident(event: EntertainmentEventId): boolean {
    return (runtimeResidentMask & eventBit(event)) !== 0;
}

export function isEntertainmentEventBurstActive(event: EntertainmentEventId): boolean {
    return runtimeActiveEvent === event;
}

export function resetEntertainmentEventRuntime(): void {
    runtimeResidentMask = 0;
    runtimeActiveEvent = null;
}

export function entertainmentEventName(event: EntertainmentEventId): string {
    switch (event) {
        case EntertainmentEventId.STIMULANT: return '心跳苏打争夺';
        case EntertainmentEventId.TIMED_BOMB: return '定时水球传递';
        case EntertainmentEventId.WHIRLPOOL: return '漩涡冲浪';
        case EntertainmentEventId.MINEFIELD: return '水上障碍场';
        case EntertainmentEventId.SHARK: return '玩具冲撞';
        case EntertainmentEventId.CANNON: return '水球点名';
        case EntertainmentEventId.LITTER: return '杂物漂流';
        case EntertainmentEventId.TURTLE_BUS: return '海龟班车';
        case EntertainmentEventId.GEYSER: return '海底喷泉';
        case EntertainmentEventId.GIANT_WAVE: return '巨浪冲浪';
    }
}

type EntertainmentBroadcastCopy = readonly [preview: string, action: string];

export const ENTERTAINMENT_BROADCAST_VARIANT_COUNT = 20;
const ENTERTAINMENT_PREVIEW_PREFIX = '泳池广播：';

const ENTERTAINMENT_BROADCAST_COPIES: Readonly<Record<
    EntertainmentEventId,
    readonly EntertainmentBroadcastCopy[]
>> = {
    [EntertainmentEventId.STIMULANT]: [
        ['泳池广播：游戏补给准备登场，体力和心率要一起看', '补给入场 · 苏打补体力也升心率'],
        ['泳池广播：苏打道具正在排队，转向可别跟着排成弯线', '苏打到场 · 补体力后留意转向'],
        ['泳池广播：补给小队带了两种道具，先看图标再选路线', '看清补给 · 苏打与冰沙各有取舍'],
        ['泳池广播：绿色小瓶申请补位，游戏心率也会跟着上场', '苏打补位 · 心率升高更易转过头'],
        ['泳池广播：冰蓝小杯带来冷静时间，推进需要暂时让一点', '冰沙登场 · 稳定转向但暂减推进'],
        ['泳池广播：本轮道具没有自动驾驶，请保管好自己的方向', '争抢补给 · 拾取后继续控制方向'],
        ['泳池广播：体力条欢迎苏打，心率表也准备更新读数', '苏打补给 · 恢复体力并提高心率'],
        ['泳池广播：雪花图标准备亮相，冷静路线也有小小代价', '冰沙冷静 · 降心率但不补体力'],
        ['泳池广播：道具补给即将到位，满体力也别忘了看心率', '选择补给 · 苏打收益受体力上限限制'],
        ['泳池广播：苏打道具挥了挥瓶盖，提醒大家别转过头', '苏打争抢 · 心率越高越要稳住方向'],
        ['泳池广播：冰沙道具的节目是稳住转向，推进暂时打个折', '冰沙取舍 · 稳转向并暂减推进'],
        ['泳池广播：补给表演准备开始，数字变化都记在游戏面板里', '游戏道具 · 留意体力与心率读数'],
        ['泳池广播：苏打和冰沙轮流值班，看清这波是谁再靠近', '按需拾取 · 分清苏打与冰沙'],
        ['泳池广播：绿色补给忙着补体力，转弯作业还得自己完成', '苏打补给 · 补体力也增加转向负担'],
        ['泳池广播：游戏心率准备上调，苏打效果还会让它多停一会', '苏打效果 · 心率短时不自然回落'],
        ['泳池广播：冰沙道具带着雪花到场，准备给游戏心率减个数', '冰沙效果 · 降心率并解除回落锁定'],
        ['泳池广播：补给图标亮起来了，绕路争抢也要算好路线', '补给争抢 · 按当前状态选择路线'],
        ['泳池广播：两种道具轮换登场，后拾取的会接替短时效果', '补给轮换 · 苏打与冰沙状态互相覆盖'],
        ['泳池广播：苏打道具准备补充体力，冲刺还得靠各位划水', '体力补给 · 拾取后继续掌握划水节奏'],
        ['泳池广播：冰沙道具申请短暂值班，稳住方向后继续前进', '冷静时间 · 推进暂减，转向更稳'],
    ],
    [EntertainmentEventId.TIMED_BOMB]: [
        ['泳池广播：有位选手马上要收到一颗鼓鼓的水球', '水球已发放 · 贴近对手转交'],
        ['泳池广播：失物招领处送来一颗特别怕孤单的水球', '水球找朋友 · 靠近对手完成传递'],
        ['泳池广播：今日幸运选手将获得限时肩背小喷泉', '肩背惊喜 · 贴近对手把水球传走'],
        ['泳池广播：水球开始慢慢鼓起，秒数请看上方提示', '倒计时开始 · 贴近对手转交水球'],
        ['泳池广播：一份清凉快递正在随机寻找收件人', '清凉快递签收 · 靠近对手转交'],
        ['泳池广播：泳池里来了一个急着给大家降温的水球', '降温来客 · 贴近对手把它送走'],
        ['泳池广播：场务正在抽选本轮水球体验员', '水球体验开始 · 靠近对手完成传递'],
        ['泳池广播：有人给接力棒灌满了水，还扎了个小结', '水球接力开始 · 靠近对手完成交棒'],
        ['泳池广播：本轮奖品越等越鼓，请及时转赠', '圆滚奖品已发放 · 贴近对手转赠'],
        ['泳池广播：请注意，一件凉快礼物即将飞入赛场', '清凉礼物到手 · 贴近对手传走'],
        ['泳池广播：包裹上只写了四个字，请尽快转交', '及时转交 · 贴近对手传出水球'],
        ['泳池广播：水球正在催单，目前的收件人有点忙', '水球催单 · 靠近对手完成交接'],
        ['泳池广播：小水球正在努力长大，泳帽已经准备好接水', '水球鼓胀 · 贴近对手赶快传走'],
        ['泳池广播：本次快递支持当面转赠，请认准附近选手', '清凉签收 · 靠近对手转交水球'],
        ['泳池广播：接力组换了新器材，双手可以继续划水', '肩背接力 · 贴近对手完成交棒'],
        ['泳池广播：抽奖箱里只有一颗水球，中奖者请保持节奏', '清凉大奖 · 靠近对手及时转赠'],
        ['泳池广播：肩背小伙伴快鼓成圆球了，转交请趁早', '水球渐鼓 · 贴近对手完成转交'],
        ['泳池广播：毛巾还在路上，水球已经提前到场', '毛巾迟到 · 靠近对手转移水球'],
        ['泳池广播：这颗水球不喜欢独处，请帮它认识新朋友', '寻找朋友 · 贴近对手完成传递'],
        ['泳池广播：本轮社交活动很简单，带着水球靠近新朋友', '水球交友 · 靠近对手把它送走'],
    ],
    [EntertainmentEventId.WHIRLPOOL]: [
        ['泳池广播：前方水流准备转圈，直线路线请稍作调整', '漩涡出现 · 避核心，顺外圈借力'],
        ['泳池广播：浪花正在练转身，选手可以从外圈借个道', '浪花转身 · 看清旋向顺流绕行'],
        ['泳池广播：水面画了一个圆，中间的位置请留给水流', '水流画圆 · 绕开核心继续前进'],
        ['泳池广播：前方水域开设弯道课，顺流一侧有助力', '弯道课堂 · 选外圈顺流侧通过'],
        ['泳池广播：旋转水流即将到场，最短路线未必最快', '路线变化 · 避开核心减速区'],
        ['泳池广播：水流方向开始自由发挥，请先观察外圈箭头', '旋流登场 · 看箭头选择顺流侧'],
        ['泳池广播：前方水域申请原地转圈，路线请留一点余量', '转圈开始 · 贴外圈顺流借力'],
        ['泳池广播：浪花拐弯忘了打灯，好在水流箭头已经就位', '水流拐弯 · 看清旋向及时绕行'],
        ['泳池广播：本场新增绕圈练习，核心区不负责送捷径', '绕圈练习 · 避开核心再借水流'],
        ['泳池广播：水面开始拧花纹，请勿坚持走最短线', '水纹旋转 · 绕开核心顺流通过'],
        ['泳池广播：前方水流正在排队转弯，选手请从外侧加入', '外圈借道 · 顺流借力，逆流会慢'],
        ['泳池广播：水面正在加载旋转模式，请提前选好出口', '旋转模式 · 留意出口持续划水'],
        ['泳池广播：旋流占了中间位置，外侧还留着绕行路线', '核心让行 · 看清空隙绕外圈'],
        ['泳池广播：前方直线临时变弯，浪花负责带路', '弯线通过 · 顺着外圈水流前进'],
        ['泳池广播：水上转盘准备开场，出口要靠自己找', '寻找出口 · 持续划水并调整方向'],
        ['泳池广播：几股水流正在绕圈开会，请不要坐到中间', '旋流开会 · 远离核心顺流绕行'],
        ['泳池广播：外圈水流有两种脾气，一侧帮忙一侧添阻力', '分清顺逆 · 选择顺流侧借力'],
        ['泳池广播：中心水流转得起劲，进去了也别忘记划水', '核心回卷 · 持续划水转向外侧'],
        ['泳池广播：浪花正在排队转弯，选手可以顺路搭个便车', '浪花转弯 · 绕开核心顺流借力'],
        ['泳池广播：今天不只选手练转身，前方水面也要练', '水面转身 · 看旋向，找出口'],
    ],
    [EntertainmentEventId.MINEFIELD]: [
        ["泳池广播：警示气球替浮标举起了手，记得绕开下方软边","气球举手 · 绕开下方软边"],
        ["泳池广播：气球浮标准备排队，别用身体去碰下方底座","浮标列队 · 看准空隙绕行"],
        ["泳池广播：小气球今天负责提醒，底座负责送你一身清凉","清凉提醒 · 避开气球下方"],
        ["泳池广播：水面即将长出气球，根部有点怕碰","气球冒头 · 横向绕开底座"],
        ["泳池广播：感叹号已经举高，真正要绕的是它脚下的浮标","标记升起 · 注意水面软边"],
        ["泳池广播：浮标绑好了气球，碰边就表演原地谢幕","浮标谢幕 · 绕开底座继续游"],
        ["泳池广播：气球组申请当路标，禁止用身体确认路线","气球指路 · 留出绕行空隙"],
        ["泳池广播：本轮浮标挂着黄色气球，远远看清就好","招牌上浮 · 绕开下方圆盘"],
        ["泳池广播：气球不卖也不能领，下方浮标正在等碰触","气球就位 · 避开软边触碰"],
        ["泳池广播：小浮标怕大家看不见，专门系了一个感叹号","浮标亮相 · 看清底座位置"],
        ["泳池广播：黄色气球开始站岗，下方浮标可得绕开","气球站岗 · 横移避开底座"],
        ["泳池广播：浮标的气球有点鼓，碰到底座就啪地收工","鼓帽上浮 · 避开圆盘及水花"],
        ["泳池广播：气球浮标准备打招呼，这个招呼有点湿","清凉招呼 · 看准空隙通过"],
        ["泳池广播：气球上的感叹号只是提醒，碰到软边才是正片","气球提醒 · 绕开气球下方"],
        ["泳池广播：气球负责高举提醒，圆盘负责守住水面","上下就位 · 及时横向绕行"],
        ["泳池广播：这批浮标自带气球，但不提供顺路接送","浮标漂来 · 留出安全空隙"],
        ["泳池广播：感叹号高高挂起，下方浮标正在水面等你","浮标待命 · 避开下方软边"],
        ["泳池广播：黄色气球在练平衡，别用泳帽帮它纠正","平衡练习 · 绕开水面底座"],
        ["泳池广播：浮标的新气球刚系好，碰边会让节目提前结束","气球登场 · 注意圆盘位置"],
        ["泳池广播：本轮浮标的节目是气球爆开，然后清凉退场","清凉退场 · 绕开触碰与水花"],
    ],
    [EntertainmentEventId.SHARK]: [
        ["泳池广播：充气玩具鲨入场了，转弯技术还在练习","玩具冲撞 · 看准箭头及时变向"],
        ["泳池广播：玩具鲨的气打得很足，刹车却不太灵","刹车失灵 · 拉开距离绕行"],
        ["泳池广播：器材室的玩具鲨自己游出来了，大家先让路","玩具追人 · 横向躲开锁定"],
        ["泳池广播：玩具鲨很想追上大家，只是还没学会停下来","追逐开始 · 别沿直线等它"],
        ["泳池广播：使用说明写着软壳玩具，也写着小心冲撞","说明补充 · 看清箭头再通过"],
        ["泳池广播：这只玩具鲨笑得得意，转弯却有点慌","得意失控 · 留出转弯空间"],
        ["泳池广播：玩具鲨的尾巴越摆越快，前面的人注意绕行","尾巴加速 · 及时变向避开"],
        ["泳池广播：玩具鲨正在检查大家的转弯作业，别被撞个正着","转弯测验 · 别沿锁定方向直游"],
        ["泳池广播：充气玩具鲨报名追逐赛，刹车项目还没及格","玩具参赛 · 被锁定就变向"],
        ["泳池广播：玩具鲨说只撞一下，裁判建议不要亲自确认","保持距离 · 绕开冲来方向"],
        ["泳池广播：软壳检查通过，冲过头这件事还在修理","检查完毕 · 注意它的冲刺方向"],
        ["泳池广播：本轮玩具鲨负责追人，浮圈负责扶住翻倒的人","冲撞预告 · 提前找好侧方空隙"],
        ["泳池广播：玩具鲨今天精神不错，就是游得有点过猛","精神满满 · 躲开这一撞"],
        ["泳池广播：气阀拧好了，玩具鲨准备展示急转弯","急转弯中 · 看见锁定及时绕开"],
        ["泳池广播：玩具鲨不是来合影的，它好像冲过了站位","冲过头啦 · 拉开距离继续游"],
        ["泳池广播：充气玩具鲨即将入场，请看好自己的泳裤","泳裤保卫 · 变向甩开玩具鲨"],
        ["泳池广播：玩具鲨外包装很可爱，转弯说明要多看两遍","可爱开场 · 被追上也会撞翻"],
        ["泳池广播：工作人员正在找玩具鲨的停止按钮，大家先绕行","先绕再说 · 别让它冲上来"],
        ["泳池广播：玩具鲨说今天很乖，只追跑得不够弯的人","绕行练习 · 及时变线避撞"],
        ["泳池广播：玩具鲨冲劲十足，扶圈已经在旁边待命","玩具冲撞 · 看准空隙躲过去"],
    ],
    [EntertainmentEventId.CANNON]: [
        ['泳池广播：运动场水炮开始热身，小水球已经排好队', '水球点名 · 看清落点横移躲避'],
        ['泳池广播：水炮组练习投篮，篮筐画在了水面上', '水球投篮 · 及时离开标记区域'],
        ['泳池广播：蓝色小水球报名跳水，水花大小不计分', '水球跳水 · 看准落点绕开红区'],
        ['泳池广播：场务开启清凉快递，收件位置已标在水上', '清凉快递 · 横移避开落点'],
        ['泳池广播：水炮想替大家拍合照，快门是一颗小水球', '清凉合照 · 看清预警及时变线'],
        ['泳池广播：今天的局部天气是晴，偶尔路过小水球', '水球路过 · 离开水面标记'],
        ['泳池广播：水炮组开设弧线课，请在标记外旁听', '弧线课堂 · 观察落点横向避让'],
        ['泳池广播：泳帽清洗体验即将开始，绕开就能免排队', '清凉体验 · 横移躲开小水球'],
        ['泳池广播：蓝白水炮正在点名，名字写在红圈里', '水球点名 · 及时游出红圈'],
        ['泳池广播：小水球申请空中通道，落水位置已经画好', '水球飞来 · 看准标记及时避让'],
        ['泳池广播：水炮组今天很守时，水球按预警准点到达', '准点送水 · 横移避开落点'],
        ['泳池广播：一颗小水球想练漂亮入水，请让出表演区', '水球表演 · 离开标记区域'],
        ['泳池广播：运动场新增清凉项目，选手可以绕道参观', '清凉开场 · 观察落点继续前进'],
        ['泳池广播：水炮刚学会画弧线，现在想给全场看看', '弧线展示 · 看清预警横向闪避'],
        ['泳池广播：岸边水炮轻轻点头，一颗水球就出发了', '水球出发 · 及时游离落点'],
        ['泳池广播：蓝色圆球决定走空中捷径，终点是水面红圈', '空中捷径 · 横移绕开红圈'],
        ['泳池广播：水炮组准备给水面盖章，印章有点凉', '清凉盖章 · 避开标记及附近水花'],
        ['泳池广播：小水球正在倒数入水，选手请继续看路', '水球入水 · 留意落点及时变线'],
        ['泳池广播：场务安排水花节目，前排位置可以不坐', '水花节目 · 离开落点继续游'],
        ['泳池广播：水炮宣布下一位清凉嘉宾，请先看水面预警', '清凉点名 · 横向避开小水球'],
    ],
    [EntertainmentEventId.LITTER]: [
        ['泳池广播：看台方向飞来几件杂物，请留意落点', '杂物飞来 · 避硬瓶，餐盒可穿但慢'],
        ['泳池广播：瓶子和餐盒从看台飞来，先给自己留条路', '赛道异物 · 看准空隙及时绕行'],
        ['泳池广播：空中杂物正在靠近，留意落点及时绕行', '清理待命 · 绕开硬瓶继续前进'],
        ['泳池广播：几件杂物走了空中路线，落水后等待清理', '漂浮物入场 · 餐盒可穿但会拖慢'],
        ['泳池广播：瓶子在空中转了个圈，清理队已记下落点', '瓶子飞来 · 碰撞会弹开并减速'],
        ['泳池广播：水面多了几件杂物，路线选择现在要动动脑', '路线选择 · 优先走清楚的空隙'],
        ['泳池广播：杂物落水提醒已送达，回收工作随后安排', '杂物待清 · 看清软硬物再绕行'],
        ['泳池广播：一只瓶子和一只餐盒漂到一起，通路在旁边', '软硬有别 · 躲硬瓶，穿餐盒会慢'],
        ['泳池广播：泡沫餐盒正在空中翻身，留意接下来的落点', '餐盒落水 · 穿过会持续减速'],
        ['泳池广播：清理小队正在找路，选手也请先找条空路', '通路优先 · 绕开杂物继续游'],
        ['泳池广播：几只空瓶从看台飞来，请别和落点挤一条线', '空瓶路过 · 及时变线避免碰撞'],
        ['泳池广播：杂物的回收位置已登记，赛道空隙请看仔细', '等待清理 · 从空隙绕行通过'],
        ['泳池广播：餐盒暂时占了水面一角，它可不负责加速', '餐盒占道 · 划出范围解除拖慢'],
        ['泳池广播：硬瓶怕碰面，软餐盒会拖慢，请分别应对', '软硬区别 · 硬瓶弹开，餐盒拖慢'],
        ['泳池广播：看台方向又飞来几件杂物，清理队的小本本翻页了', '新杂物落水 · 观察通路及时绕行'],
        ['泳池广播：水面清理正在排队，选手先从空隙通过', '清理排队 · 分清软硬漂浮物'],
        ['泳池广播：泡沫餐盒路过泳道，回收之前请绕个小弯', '餐盒路过 · 横向寻找安全通路'],
        ['泳池广播：杂物飞向了比赛路线，绕行课临时加一题', '绕行练习 · 硬瓶要躲，餐盒会慢'],
        ['泳池广播：硬瓶和餐盒一起飞来，碰撞与阻力各有分工', '看清类型 · 硬瓶碰撞，餐盒减速'],
        ['泳池广播：几件杂物在水面碰头，清理队正在为它们散会', '漂流散会 · 看准空隙继续前进'],
    ],
    [EntertainmentEventId.TURTLE_BUS]: [
        ['泳池广播：海龟班车准备浮出水面，四个拖圈可搭乘', '海龟班车 · 靠近空圈双手抓稳'],
        ['泳池广播：水面出现一位慢性子司机，顺路可以搭车', '顺路搭乘 · 靠近空圈抓稳'],
        ['泳池广播：海龟牵着四个圈来了，先到先搭', '四圈开门 · 游近空位抓稳'],
        ['泳池广播：今日水上交通开线，车票是一双手', '双手抓圈 · 划水逐手松开'],
        ['泳池广播：大海龟浮起来了，拖圈马上经过赛道', '班车进站 · 看准空圈靠近'],
        ['泳池广播：海龟司机只走一程，到站会先放人', '单程顺风 · 到站自行续游'],
        ['泳池广播：水面顺风车靠近，座位先到先得', '顺风车来 · 双手抓圈搭乘'],
        ['泳池广播：四个游泳圈正跟着海龟排队入场', '拖圈入场 · 抢到空圈搭一段'],
        ['泳池广播：海龟班车准备发车，空圈不会等太久', '即将发车 · 靠近空圈'],
        ['泳池广播：海龟载客不收票，抓得稳才坐得久', '抓稳乘坐 · 碰撞可能掉车'],
        ['泳池广播：海龟司机游得稳，后面四圈有空位', '四圈可搭 · 游近自动抓稳'],
        ['泳池广播：顺路班车出水，想下车就正常划水', '顺风一程 · 左右起划下车'],
        ['泳池广播：海龟拖圈从后方赶来，别错过搭乘窗口', '搭乘窗口 · 靠近空圈'],
        ['泳池广播：游泳圈已经系好，海龟司机准备上岗', '海龟上岗 · 抓稳圈沿出发'],
        ['泳池广播：水上公交本次只跑一趟，想搭车请靠近', '仅此一程 · 先到先坐'],
        ['泳池广播：海龟班车给赛道加了一条顺风路线', '顺风路线 · 靠近拖圈搭乘'],
        ['泳池广播：四个圈正在水面等乘客，先到的先坐', '空圈争夺 · 双手抓稳'],
        ['泳池广播：海龟司机已经探头，车尾的圈也跟着来了', '探头入场 · 抢到空圈'],
        ['泳池广播：海龟班车要带大家兜一段，到站会潜走', '搭车一段 · 放手继续游'],
        ['泳池广播：今天的顺风车由海龟驾驶，四圈同时开放', '海龟发车 · 空圈先到先得'],
    ],
    [EntertainmentEventId.GIANT_WAVE]: [
        ['泳池广播：浪头正在排队，顺着借力，迎着绕开', '巨浪冲浪 · 顺浪借力，迎浪绕行'],
        ['泳池广播：水面准备起伏，两侧留有绕行空间', '浪头出发 · 看清方向再并入'],
        ['泳池广播：这趟水上快车随机选边，不包接送', '双向起浪 · 顺向助推，逆向受阻'],
        ['泳池广播：浪头不看排名，只看从哪边出发', '浪头到场 · 留意来浪方向'],
        ['泳池广播：水面准备抬头，泳姿请继续营业', '借浪前进 · 迎浪记得侧移'],
        ['泳池广播：浪头准备横穿泳池，两侧仍可通行', '巨浪过池 · 绕开迎面的浪心'],
        ['泳池广播：水上便车即将发出，请自行判断顺逆', '浪头启程 · 同向选手可以借力'],
        ['泳池广播：水面开始热身，稍后从池端起浪', '浪面推进 · 留出侧移空间'],
        ['泳池广播：迎面是阻力，同向是助力，别认错车头', '看准浪向 · 顺势借力或绕行'],
        ['泳池广播：浪头没有方向盘，但会一直开到对岸', '巨浪横穿 · 池边仍有空隙'],
        ['泳池广播：泳池准备起一波热闹，请看清路线', '浪头登场 · 避开迎浪中心'],
        ['泳池广播：借浪机会靠近，折返后记得重看方向', '双向水流 · 折返后留意顺逆'],
        ['泳池广播：浪头准备出门，终点是泳池另一头', '浪头前进 · 不追人，只过池'],
        ['泳池广播：水面即将抖一抖，想借力先看方向', '巨浪行进 · 顺着走更省力'],
        ['泳池广播：这波不负责转弯，侧边可以自行绕路', '迎浪绕开 · 顺浪并入'],
        ['泳池广播：池端正在攒浪，请给路线留点余地', '浪头开游 · 看准空隙侧移'],
        ['泳池广播：随机一端准备起浪，全场都能看见', '巨浪入场 · 顺逆效果各不同'],
        ['泳池广播：浪头准备送来助力，也会挡住迎面路线', '借力有方 · 迎浪中心会减速'],
        ['泳池广播：这波开到对岸就散，沿途请自行选线', '巨浪过境 · 两侧可以绕行'],
        ['泳池广播：水面即将换个节奏，请留意池端动静', '浪头出发 · 保持划水，选好方向'],
    ],
    [EntertainmentEventId.GEYSER]: [
        ['泳池广播：池底正在冒泡，水柱即将冲出', '喷泉来袭 · 看泡泡绕开喷口'],
        ['泳池广播：水下传来一阵咕噜声，请提前选路', '池底加压 · 抓住喷发间隙'],
        ['泳池广播：前方水面开始鼓起，留意脚下', '冒泡预警 · 侧移避开水柱'],
        ['泳池广播：喷口准备轮流开工，直线冲刺要看时机', '轮流喷发 · 看准空档通过'],
        ['泳池广播：池底泡泡越来越密，喷泉要醒了', '喷泉苏醒 · 别停在泡泡中心'],
        ['泳池广播：水面打起了嗝，下一口可能更大', '水柱将起 · 提前留出侧路'],
        ['泳池广播：泳池底部正在蓄压，请观察水纹', '蓄压完成 · 穿过喷口间隙'],
        ['泳池广播：几处水下喷口准备交替登场', '错峰喷发 · 选择空位前进'],
        ['泳池广播：小泡泡在水面排队，马上轮到大水柱', '大水柱来 · 绕过翻涌区域'],
        ['泳池广播：水底有股气流正在往上顶', '水流上冲 · 离开水面警戒圈'],
        ['泳池广播：池底突然热闹起来，别让水柱抢节奏', '节奏被顶 · 落水接着划'],
        ['泳池广播：前方泡泡串成线，喷口位置已露出来', '喷口现身 · 记住下一轮位置'],
        ['泳池广播：水面轻轻抖动，喷泉正在准备', '喷泉开场 · 利用短暂歇息'],
        ['泳池广播：池底水压正在上升，路线还能调整', '水压上升 · 从安全侧绕行'],
        ['泳池广播：几股水柱要轮流试试谁游得稳', '轮番上冲 · 避免落水连碰'],
        ['泳池广播：水下喷口已锁定，泡泡就是提示', '泡泡提示 · 不要硬冲中心'],
        ['泳池广播：水面鼓包出现，喷发马上开始', '鼓包破水 · 抓紧横移'],
        ['泳池广播：喷泉正在蓄势，刚好可以换条路线', '换线时机 · 避开水柱中心'],
        ['泳池广播：池底有几口喷泉准备接力', '喷泉接力 · 看准喷发节奏'],
        ['泳池广播：泡泡一冒头，就该注意前面的水柱了', '喷泉来袭 · 落水继续前进'],
    ],
};

const SUPER_WHIRLPOOL_BROADCAST_COPIES: readonly EntertainmentBroadcastCopy[] = [
    ['泳池广播：中心水流准备转大圈，超级漩涡即将到场', '超级漩涡 · 留足距离绕开大核心'],
    ['泳池广播：前方旋流换了大号舞台，请把路线也放宽', '大号旋流 · 从更远的外圈绕行'],
    ['泳池广播：超级漩涡正在热身，直穿核心可不是捷径', '核心回卷 · 避开中心减速区'],
    ['泳池广播：外圈水流准备加场，看清方向再借力', '超级旋流 · 选择顺流侧前进'],
    ['泳池广播：中心水纹越画越大，直线通过不再推荐', '旋流成形 · 绕开核心贴外圈'],
    ['泳池广播：大型转圈节目即将开始，核心位置不设座位', '大圈开场 · 远离核心顺流绕行'],
    ['泳池广播：水流把弯道加宽了，请提前留好转向空间', '弯道加宽 · 看清旋向再通过'],
    ['泳池广播：中心水域准备加快旋转，出口请提前看好', '旋转增强 · 持续划水寻找出口'],
    ['泳池广播：超级漩涡带来了大号箭头，顺逆两侧要分清', '分清顺逆 · 顺流借力，逆流会慢'],
    ['泳池广播：超级漩涡即将开张，外圈才是借道的位置', '外圈借道 · 避开核心顺流前进'],
    ['泳池广播：浪花把转圈练习升级了，选手请先观察路线', '旋流升级 · 留出更宽的绕行空间'],
    ['泳池广播：水面正在画大螺旋，圆心这次有点抢镜', '大螺旋到场 · 绕开中心回卷'],
    ['泳池广播：中心水流开了大场面，别让路线挤进中间', '中心旋转 · 从外圈顺流侧通过'],
    ['泳池广播：前方水流转弯更有劲，方向需要自己保管', '强旋流区 · 持续划水调整方向'],
    ['泳池广播：超级漩涡准备展示大范围转身，请提前让路', '大范围旋流 · 留足距离绕行'],
    ['泳池广播：超级漩涡申请扩大场地，外圈路线也变远了', '漩涡扩张 · 绕开更大的核心'],
    ['泳池广播：进入回卷区也别停下，出口藏在外圈方向', '寻找出口 · 持续划水转向外侧'],
    ['泳池广播：中心浪花转得热闹，顺流一侧才适合借力', '顺流借力 · 看清箭头避开核心'],
    ['泳池广播：泳池中央出现水上旋转门，通行路线在外侧', '旋转门开启 · 绕开核心顺流前进'],
    ['泳池广播：大号旋流即将登场，绕远一点也能稳稳通过', '超级漩涡 · 看旋向，找外圈出口'],
];

/** 同一障碍事件三种布局共用文案；不预报本轮可能不存在的物件。 */
const OBSTACLE_BROADCAST_COPIES: readonly EntertainmentBroadcastCopy[] = [
    ['泳池广播：前方水面有新障碍，请提前找空隙', '障碍入场 · 看清路线再通过'],
    ['泳池广播：赛道正在重新布置，留意水面变化', '路线变化 · 提前调整横向位置'],
    ['泳池广播：前方出现绕行练习，请看清通路', '绕行练习 · 沿着空隙继续游'],
    ['泳池广播：水面布置了新关卡，直线未必省时', '水面关卡 · 看准空隙再前进'],
    ['泳池广播：场务提醒，前方需要换条路线', '换线提醒 · 避开密集位置'],
    ['泳池广播：前方路面有点热闹，请提前选边', '提前选边 · 留出转向空间'],
    ['泳池广播：水面障碍即将就位，注意观察', '障碍就位 · 选择清楚的通路'],
    ['泳池广播：前面多了几道选择题，答案在空隙里', '寻找空隙 · 看准再穿过去'],
    ['泳池广播：请给转向留点距离，障碍准备上场', '转向准备 · 绕开拥挤水域'],
    ['泳池广播：水面路线要变了，先看再游更稳', '路线更新 · 提前避开障碍'],
    ['泳池广播：前方绕行区开放，请别只盯直线', '绕行区开启 · 及时改变路线'],
    ['泳池广播：这一段需要观察水面，空路就在旁边', '观察水面 · 从空路继续游'],
    ['泳池广播：障碍正慢慢到位，选手可以先找出口', '寻找出口 · 从宽处通过'],
    ['泳池广播：前面有新布置，请照顾好前进路线', '路线留心 · 避开重障碍'],
    ['泳池广播：水面空隙正在变化，转向要趁早', '空隙变化 · 提前横移通过'],
    ['泳池广播：场务把障碍摆上水面，请观察前方', '场务提醒 · 留意前方空隙'],
    ['泳池广播：前方不能闭眼直游，请先找到通道', '通道选择 · 稳住方向继续游'],
    ['泳池广播：水面多了点东西，路线需要重新打量', '重新选路 · 从可达空隙通过'],
    ['泳池广播：前方有一段绕行路，请提早决定方向', '绕行开始 · 提前决定方向'],
    ['泳池广播：新的水上障碍即将登场，请看清位置', '水上障碍 · 看准位置再绕行'],
];

/**
 * 广播属于表现层，但仍用比赛种子派生独立随机流，让联机各端显示一致。
 * 与 20 互质的步长保证同一事件连续取前二十次时不重复，也不消费玩法 RNG。
 */
export function entertainmentBroadcastVariantIndex(
    event: EntertainmentEventId,
    seed: number,
    activationSerial: number,
    special = false,
): number {
    const copies = entertainmentBroadcastCopies(event, special);
    const normalizedSeed = Number.isFinite(seed) ? seed >>> 0 : 0;
    const serial = Number.isSafeInteger(activationSerial) && activationSerial > 0
        ? activationSerial
        : 1;
    const random = new SeededRandom((normalizedSeed
        ^ ENTERTAINMENT_COPY_RANDOM_SALT
        ^ Math.imul(event + 1, 0x9e3779b1)
        ^ (special ? ENTERTAINMENT_COPY_SPECIAL_SALT : 0)) >>> 0);
    const first = random.int(copies.length);
    const step = ENTERTAINMENT_COPY_VARIANT_STEPS[random.int(ENTERTAINMENT_COPY_VARIANT_STEPS.length)];
    return (first + (serial - 1) * step) % copies.length;
}

export function entertainmentPreviewCopy(
    event: EntertainmentEventId,
    special = false,
    seed = 0,
    activationSerial = 1,
): string {
    const copies = entertainmentBroadcastCopies(event, special);
    const copy = copies[entertainmentBroadcastVariantIndex(event, seed, activationSerial, special)][0];
    return copy.startsWith(ENTERTAINMENT_PREVIEW_PREFIX)
        ? copy.slice(ENTERTAINMENT_PREVIEW_PREFIX.length)
        : copy;
}

export function entertainmentActionCopy(
    event: EntertainmentEventId,
    special = false,
    seed = 0,
    activationSerial = 1,
): string {
    const copies = entertainmentBroadcastCopies(event, special);
    return copies[entertainmentBroadcastVariantIndex(event, seed, activationSerial, special)][1];
}

function entertainmentBroadcastCopies(
    event: EntertainmentEventId,
    special: boolean,
): readonly EntertainmentBroadcastCopy[] {
    return event === EntertainmentEventId.OBSTACLE ? OBSTACLE_BROADCAST_COPIES
        : event === EntertainmentEventId.WHIRLPOOL && special
        ? SUPER_WHIRLPOOL_BROADCAST_COPIES
        : ENTERTAINMENT_BROADCAST_COPIES[event];
}

/**
 * 统一娱乐模式的房主权威事件导演。它只管理顺序和时间，不复制六个玩法的规则或表现。
 * 200 米抽取三至四个主事件，400 米抽取五至六个；主事件按赛程锚点分散，
 * 赛程仍未结束时仅返场可安全重置的事件，场地内容和一次性道具不重复生成。
 */
export class EntertainmentModeDirector {
    private revision = 0;
    private phase = EntertainmentDirectorPhase.OPENING;
    private eventIndex = 0;
    private remainingSeconds = OPENING_SECONDS;
    private activatedMask = 0;
    private residentMask = 0;
    private specialMask = 0;
    private activationSerial = 0;
    private lastActivatedEvent: EntertainmentEventId | null = null;
    private encoreRound = 0;
    private encoreEvent: EntertainmentEventId | null = null;
    private preparedTurtleSeconds = 0;
    private readonly skipReasons: (string | null)[] = new Array(6).fill(null);
    private anchorDistance = 0;
    private readonly eventAnchorDistances = [0, 0, 0, 0, 0, 0];
    private readonly events: EntertainmentEventId[];
    private readonly seed: number;
    private readonly raceDistance: number;
    private readonly transition: EntertainmentDirectorTransition = {
        cancelledPreview: false,
        previewEvent: null,
        activatedEvent: null,
        recoveredEvent: null,
        finishedEvent: null,
    };

    constructor(
        seed: number,
        raceDistance = 200,
        private readonly includeLitter = ENTERTAINMENT_LITTER_SELECTION_ENABLED,
        private readonly durationForEvent?: (event: EntertainmentEventId) => number,
        private readonly testEventOrder?: readonly EntertainmentEventId[],
        testWhirlpoolSuper?: boolean,
        private readonly gradedPlan?: EntertainmentRacePlan,
        private readonly prepareTurtle?: () => number,
    ) {
        this.seed = Number.isFinite(seed) ? seed >>> 0 : 0;
        this.raceDistance = Number.isFinite(raceDistance) ? Math.max(1, raceDistance) : 200;
        this.events = gradedPlan ? gradedPlan.stages.map(stage => stage.event) : testEventOrder?.length
            ? [...testEventOrder] : [...buildEntertainmentEventOrder(this.seed, this.raceDistance, this.includeLitter)];
        this.specialMask = gradedPlan ? 0 : testWhirlpoolSuper === undefined
            ? buildEntertainmentSpecialMask(this.seed, this.events)
            : testWhirlpoolSuper && this.events.indexOf(EntertainmentEventId.WHIRLPOOL) >= 0
                ? eventBit(EntertainmentEventId.WHIRLPOOL) : 0;
        if (gradedPlan && this.events.length === 0) {
            this.phase = EntertainmentDirectorPhase.COMPLETE;
            this.remainingSeconds = 0;
        }
        this.publishRuntimeState();
    }

    reset(): void {
        this.revision = 0;
        this.phase = EntertainmentDirectorPhase.OPENING;
        this.eventIndex = 0;
        this.remainingSeconds = OPENING_SECONDS;
        if (this.gradedPlan && this.events.length === 0) {
            this.phase = EntertainmentDirectorPhase.COMPLETE;
            this.remainingSeconds = 0;
        }
        this.activatedMask = 0;
        this.residentMask = 0;
        this.activationSerial = 0;
        this.lastActivatedEvent = null;
        this.encoreRound = 0;
        this.encoreEvent = null;
        this.preparedTurtleSeconds = 0;
        this.skipReasons.fill(null);
        if (this.gradedPlan) this.gradedPlan.stages.forEach((stage, index) => { this.events[index] = stage.event; });
        this.anchorDistance = 0;
        this.eventAnchorDistances.fill(0);
        this.publishRuntimeState();
    }

    currentEvent(): EntertainmentEventId | null {
        if (this.eventIndex >= 0 && this.eventIndex < this.events.length) {
            return this.events[this.eventIndex];
        }
        return this.eventIndex === this.events.length ? this.encoreEvent : null;
    }

    selectedEvents(): readonly EntertainmentEventId[] { return this.events; }
    phaseId(): EntertainmentDirectorPhase { return this.phase; }
    secondsRemaining(): number { return this.remainingSeconds; }

    canSpawnResidentObstacles(): boolean {
        if (this.phase === EntertainmentDirectorPhase.OPENING || this.phase === EntertainmentDirectorPhase.COMPLETE) return true;
        if (this.phase === EntertainmentDirectorPhase.GAP) return this.remainingSeconds <= 0;
        // 仅放行已有组合安全路径的漩涡／班车稳定段，喷泉、巨浪与强袭继续避让。
        const event = this.currentEvent();
        const stage = this.gradedPlan?.stages[this.eventIndex];
        return this.phase === EntertainmentDirectorPhase.ACTIVE && !!stage
            && (event === EntertainmentEventId.TURTLE_BUS || event === EntertainmentEventId.WHIRLPOOL)
            && stage.durationSeconds - this.remainingSeconds >= 3;
    }

    isSpecialEvent(event: EntertainmentEventId): boolean {
        return (this.specialMask & eventBit(event)) !== 0;
    }

    /** 班车 14 秒仍无两人可搭窗口时，沿用锚点换成未被选中的合法事件。 */
    replaceUnavailableTurtle(): EntertainmentDirectorTransition {
        const transition = this.clearTransition();
        if (this.phase !== EntertainmentDirectorPhase.ACTIVE
            || this.currentEvent() !== EntertainmentEventId.TURTLE_BUS
            || this.eventIndex >= this.events.length) return transition;
        // 分级模式里机会事件失败就跳过，不能把一档海龟升级成漩涡。
        if (this.gradedPlan) {
            this.remainingSeconds = 0;
            return this.update(0, this.anchorDistance, true);
        }
        let replacement = EntertainmentEventId.WHIRLPOOL;
        if (!this.gradedPlan) {
            const candidates = ENTERTAINMENT_SELECTABLE_EVENTS.filter(event =>
                event !== EntertainmentEventId.TURTLE_BUS && this.events.indexOf(event) < 0);
            const offset = (this.seed >>> 0) % candidates.length;
            const index = this.eventIndex;
            let found = false;
            for (let step = 0; step < candidates.length; step++) {
                const candidate = candidates[(offset + step) % candidates.length];
                this.events[index] = candidate;
                if (!validEventOrder(this.events)) continue;
                replacement = candidate;
                found = true;
                break;
            }
            if (!found) {
                this.events[index] = EntertainmentEventId.TURTLE_BUS;
                return transition;
            }
        } else this.events[this.eventIndex] = replacement;
        this.remainingSeconds = EVENT_DURATION_SECONDS[replacement];
        this.activatedMask |= eventBit(replacement);
        this.residentMask &= ~eventBit(EntertainmentEventId.TURTLE_BUS);
        this.residentMask |= eventBit(replacement);
        this.activationSerial++;
        this.lastActivatedEvent = replacement;
        this.revision++;
        transition.finishedEvent = EntertainmentEventId.TURTLE_BUS;
        transition.activatedEvent = replacement;
        this.publishRuntimeState();
        return transition;
    }

    previewDurationSeconds(): number { return this.previewSeconds(); }

    anchorDistanceForEvent(event: EntertainmentEventId): number {
        if (this.currentEvent() === event && this.anchorDistance > 0) return this.anchorDistance;
        const index = this.events.indexOf(event);
        return index >= 0 ? this.eventAnchorDistances[index] : 0;
    }

    /** 首位选手完赛后停止安排新事件；已经激活的事件保留到自身结算完成。 */
    lockAfterFirstFinish(): EntertainmentDirectorTransition {
        const transition = this.clearTransition();
        if (this.phase === EntertainmentDirectorPhase.COMPLETE
            || this.phase === EntertainmentDirectorPhase.CLOSING) return transition;
        if (this.phase === EntertainmentDirectorPhase.ACTIVE) {
            this.phase = EntertainmentDirectorPhase.CLOSING;
            this.revision++;
            this.publishRuntimeState();
            return transition;
        }
        if (this.phase === EntertainmentDirectorPhase.PREVIEW) {
            transition.cancelledPreview = true;
        }
        this.complete();
        return transition;
    }

    update(
        dt: number,
        leaderDistance: number,
        canFinishCurrent = true,
        referenceSpeed = 0,
    ): EntertainmentDirectorTransition {
        const transition = this.clearTransition();
        if (this.phase === EntertainmentDirectorPhase.COMPLETE) return transition;
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        const distance = Number.isFinite(leaderDistance) ? Math.max(0, leaderDistance) : 0;
        this.remainingSeconds = Math.max(0, this.remainingSeconds - step);
        if (this.remainingSeconds > 0) return transition;

        if (this.phase === EntertainmentDirectorPhase.OPENING || this.phase === EntertainmentDirectorPhase.GAP) {
            if (this.gradedPlan && referenceSpeed > 0) {
                if (!this.prepareBudgetedPreview(distance, referenceSpeed)) {
                    this.publishRuntimeState();
                    return transition;
                }
            }
            if (this.gradedPlan && this.eventIndex >= this.events.length
                && distance > this.raceDistance * 0.78) {
                this.complete();
                return transition;
            }
            if (!(this.gradedPlan && referenceSpeed > 0) && !this.readyForPreview(distance)) return transition;
            this.phase = EntertainmentDirectorPhase.PREVIEW;
            this.remainingSeconds = this.previewSeconds();
            this.revision++;
            transition.previewEvent = this.currentEvent();
            // 班车航段已经确认，内部自带三秒上浮预告；不再额外空等六秒使航段失效。
            if (this.gradedPlan && this.currentEvent() === EntertainmentEventId.TURTLE_BUS) {
                return this.update(0, distance, canFinishCurrent, referenceSpeed);
            }
        } else if (this.phase === EntertainmentDirectorPhase.PREVIEW) {
            const event = this.currentEvent();
            if (event === null) {
                this.complete();
                return transition;
            }
            this.phase = EntertainmentDirectorPhase.ACTIVE;
            // 五档调试传入的已是完整事件窗口；现行规格仍按赛程长度缩放。
            this.remainingSeconds = (this.gradedPlan && event === EntertainmentEventId.TURTLE_BUS
                ? this.preparedTurtleSeconds || this.gradedPlan.stages[this.eventIndex].durationSeconds
                : this.gradedPlan && this.events[this.eventIndex] !== this.gradedPlan.stages[this.eventIndex]?.event
                    && this.eventIndex < this.events.length ? 8 : undefined)
                ?? this.gradedPlan?.stages[this.eventIndex]?.durationSeconds
                ?? (this.gradedPlan && this.encoreEvent !== null
                    ? this.encoreEvent === EntertainmentEventId.SHARK ? 14
                        : this.encoreEvent === EntertainmentEventId.CANNON ? 9.9
                            : this.gradedPlan.grade === 3 ? 11.5 : this.gradedPlan.grade === 4 ? 10.5 : 10
                    : undefined)
                ?? this.durationForEvent?.(event)
                ?? (event === EntertainmentEventId.GEYSER || event === EntertainmentEventId.GIANT_WAVE
                    ? EVENT_DURATION_SECONDS[event] : EVENT_DURATION_SECONDS[event] * this.eventDurationScale());
            this.anchorDistance = distance;
            if (this.eventIndex < this.events.length) {
                this.eventAnchorDistances[this.eventIndex] = distance;
            }
            this.activatedMask |= eventBit(event);
            this.residentMask |= eventBit(event);
            this.activationSerial++;
            this.lastActivatedEvent = event;
            this.revision++;
            transition.activatedEvent = event;
        } else if (isActiveDirectorPhase(this.phase)) {
            const event = this.currentEvent();
            // 定时炸弹等必须先结算，导演才允许切下一段，避免悬挂状态跨事件。
            if (!canFinishCurrent) {
                this.remainingSeconds = 0.25;
                return transition;
            }
            if (event !== null) {
                transition.finishedEvent = event;
                if ((PERSISTENT_EVENTS_MASK & eventBit(event)) === 0) {
                    this.residentMask &= ~eventBit(event);
                }
            }
            if (this.phase === EntertainmentDirectorPhase.CLOSING) {
                this.complete();
                return transition;
            }
            if (this.eventIndex < this.events.length) this.eventIndex++;
            if (this.eventIndex >= this.events.length) {
                if (this.gradedPlan ? this.gradedPlan.grade < 3 || this.encoreRound >= this.gradedPlan.encoreLimit
                    : !!this.testEventOrder) this.complete();
                else this.scheduleEncore(event);
            } else {
                // 驻留内容继续工作；下一次强事件至少留出一段正常游泳时间，
                // 并等领先选手抵达对应赛程锚点后才开始完整预告。
                this.phase = EntertainmentDirectorPhase.GAP;
                this.remainingSeconds = this.gapSeconds();
                this.revision++;
            }
        }
        this.publishRuntimeState();
        return transition;
    }

    snapshot(): EntertainmentDirectorState {
        return {
            revision: this.revision,
            phase: this.phase,
            eventIndex: this.eventIndex,
            eventCount: this.events.length,
            remainingSeconds: this.remainingSeconds,
            packedEvents: packEntertainmentEvents(this.events),
            activatedMask: this.activatedMask >>> 0,
            residentMask: this.residentMask >>> 0,
            specialMask: this.specialMask >>> 0,
            activationSerial: this.activationSerial,
            lastActivatedEvent: this.lastActivatedEvent,
            encoreRound: this.encoreRound,
            encoreEvent: this.encoreEvent,
            anchorDistance: this.anchorDistance,
            eventAnchorDistances: [...this.eventAnchorDistances],
        };
    }

    applySnapshot(state: EntertainmentDirectorState): EntertainmentDirectorTransition {
        const transition = this.clearTransition();
        const authoritativeEvents = unpackEntertainmentEvents(
            state?.packedEvents ?? 0,
            state?.eventCount ?? 0,
        );
        if (!validDirectorState(state, !!this.gradedPlan)
            || !this.acceptsEventOrder(authoritativeEvents)
            || (state.specialMask !== 0 && authoritativeEvents.indexOf(EntertainmentEventId.WHIRLPOOL) < 0)
            || state.revision < this.revision) return transition;
        transition.snapshotAccepted = true;
        const previousPhase = this.phase;
        const previousIndex = this.eventIndex;
        const previousEvent = this.currentEvent();
        const previousActivationSerial = this.activationSerial;
        const previousEncoreRound = this.encoreRound;
        const sameCountdown = state.revision === this.revision
            && state.phase === previousPhase
            && state.eventIndex === previousIndex
            && state.encoreRound === previousEncoreRound;
        const previousRemainingSeconds = this.remainingSeconds;
        this.events.length = authoritativeEvents.length;
        for (let index = 0; index < authoritativeEvents.length; index++) {
            this.events[index] = authoritativeEvents[index];
        }
        this.revision = state.revision;
        this.phase = state.phase;
        this.eventIndex = state.eventIndex;
        this.remainingSeconds = sameCountdown
            ? Math.min(previousRemainingSeconds, state.remainingSeconds)
            : state.remainingSeconds;
        this.activatedMask = state.activatedMask;
        this.residentMask = state.residentMask;
        this.specialMask = state.specialMask;
        this.activationSerial = state.activationSerial;
        this.lastActivatedEvent = state.lastActivatedEvent;
        this.encoreRound = state.encoreRound;
        this.encoreEvent = state.encoreEvent;
        this.anchorDistance = state.anchorDistance;
        for (let index = 0; index < this.eventAnchorDistances.length; index++) {
            this.eventAnchorDistances[index] = state.eventAnchorDistances[index];
        }
        const event = this.currentEvent();
        if (event !== null && this.phase === EntertainmentDirectorPhase.PREVIEW
            && (previousPhase !== this.phase || previousIndex !== this.eventIndex
                || previousEncoreRound !== this.encoreRound || previousEvent !== event)) {
            transition.previewEvent = event;
        }
        if (event !== null && isActiveDirectorPhase(this.phase)
            && this.activationSerial > previousActivationSerial) transition.activatedEvent = event;
        if (this.activationSerial > previousActivationSerial
            && !isActiveDirectorPhase(this.phase)) {
            transition.recoveredEvent = this.lastActivatedEvent;
        }
        if (previousPhase === EntertainmentDirectorPhase.PREVIEW
            && this.phase === EntertainmentDirectorPhase.COMPLETE) {
            transition.cancelledPreview = true;
        }
        if (isActiveDirectorPhase(previousPhase)
            && (!isActiveDirectorPhase(this.phase) || previousIndex !== this.eventIndex
                || previousEncoreRound !== this.encoreRound || previousEvent !== event)) {
            transition.finishedEvent = previousEvent;
        }
        this.publishRuntimeState();
        return transition;
    }

    private acceptsEventOrder(events: readonly EntertainmentEventId[]): boolean {
        if (!this.gradedPlan && validEventOrder(events)) return true;
        const planned = this.gradedPlan
            ? this.gradedPlan.stages.map(stage => stage.event)
            : this.testEventOrder?.length ? this.testEventOrder
                : buildEntertainmentEventOrder(this.seed, this.raceDistance, this.includeLitter);
        if (events.length !== planned.length) return false;
        if (this.gradedPlan) return events.every((event, index) => event === planned[index]
            || (this.gradedPlan!.grade >= 2 && planned[index] === EntertainmentEventId.TURTLE_BUS
                && event === EntertainmentEventId.WHIRLPOOL));
        let replaced = 0;
        for (let index = 0; index < events.length; index++) {
            if (events[index] === planned[index]) continue;
            if (planned[index] !== EntertainmentEventId.TURTLE_BUS
                || events[index] !== EntertainmentEventId.WHIRLPOOL || ++replaced > 1) return false;
        }
        return this.gradedPlan ? true : replaced > 0;
    }

    private complete(): void {
        this.phase = EntertainmentDirectorPhase.COMPLETE;
        this.remainingSeconds = 0;
        this.eventIndex = this.events.length;
        this.revision++;
        this.publishRuntimeState();
    }

    private scheduleEncore(previousEvent: EntertainmentEventId | null): void {
        this.eventIndex = this.events.length;
        this.encoreRound++;
        const random = new SeededRandom((this.seed ^ ENTERTAINMENT_ENCORE_RANDOM_SALT
            ^ Math.imul(this.encoreRound, 0x9e3779b1)) >>> 0);
        const candidates = this.gradedPlan?.raceDistance === 200 && this.gradedPlan.grade === 5
            ? [EntertainmentEventId.CANNON] : this.gradedPlan
            ? (this.gradedPlan.grade === 3 ? [EntertainmentEventId.TIMED_BOMB]
                : this.gradedPlan.grade === 4
                    ? [EntertainmentEventId.TIMED_BOMB, EntertainmentEventId.CANNON]
                    : [EntertainmentEventId.TIMED_BOMB, EntertainmentEventId.CANNON, EntertainmentEventId.SHARK])
                .filter(event => this.gradedPlan?.grade === 3 || event !== previousEvent)
            : ENCORE_EVENTS.filter(event => event !== previousEvent);
        if (candidates.length === 0) { this.complete(); return; }
        this.encoreEvent = candidates[random.int(candidates.length)];
        this.phase = EntertainmentDirectorPhase.GAP;
        this.remainingSeconds = ENCORE_GAP_MIN_SECONDS + random.next() * ENCORE_GAP_VARIATION_SECONDS;
        this.revision++;
    }

    private publishRuntimeState(): void {
        runtimeResidentMask = this.residentMask | (this.gradedPlan
            ? eventBit(EntertainmentEventId.STIMULANT) | eventBit(EntertainmentEventId.OBSTACLE) : 0);
        runtimeActiveEvent = isActiveDirectorPhase(this.phase) ? this.currentEvent() : null;
    }

    private clearTransition(): EntertainmentDirectorTransition {
        this.transition.snapshotAccepted = false;
        this.transition.cancelledPreview = false;
        this.transition.previewEvent = null;
        this.transition.activatedEvent = null;
        this.transition.recoveredEvent = null;
        this.transition.finishedEvent = null;
        return this.transition;
    }

    private previewSeconds(): number {
        if (this.gradedPlan && this.currentEvent() === EntertainmentEventId.TURTLE_BUS) return 0;
        if (this.currentEvent() === EntertainmentEventId.GIANT_WAVE) return 6;
        if (this.gradedPlan) return 6;
        if (this.events.length >= 5) return LONG_RACE_PREVIEW_SECONDS;
        return this.events.length === 4 ? FOUR_EVENT_PREVIEW_SECONDS : THREE_EVENT_PREVIEW_SECONDS;
    }

    private eventDurationScale(): number {
        if (this.gradedPlan) return 1;
        if (this.events.length >= 5) return LONG_RACE_DURATION_SCALE;
        return this.events.length === 4 ? FOUR_EVENT_DURATION_SCALE : 1;
    }

    private gapSeconds(): number {
        if (this.gradedPlan) return this.gradedPlan.raceDistance === 400 ? 8 : 5;
        return this.events.length >= 5 ? LONG_RACE_GAP_SECONDS : SHORT_RACE_GAP_SECONDS;
    }

    private readyForPreview(distance: number): boolean {
        if (this.eventIndex >= this.events.length) return this.encoreEvent !== null;
        const progress = this.gradedPlan?.stages[this.eventIndex]?.previewProgress
            ?? EVENT_PROGRESS_BY_COUNT[this.events.length]?.[this.eventIndex] ?? 0;
        return distance >= this.raceDistance * progress;
    }

    /** 跳过的条目以单调 eventIndex 和未写入的锚点恢复，不新增广播或本地重排。 */
    skippedStageMask(): number {
        if (!this.gradedPlan) return 0;
        let mask = 0;
        for (let index = 0; index < Math.min(this.eventIndex, this.events.length); index++) {
            if (this.eventAnchorDistances[index] === 0) mask |= 1 << index;
        }
        return mask;
    }

    /** 本机诊断账本，不增加网络包或赛中日志；访客只拥有已接收的权威索引。 */
    stageSkipReason(index: number): string | null { return this.skipReasons[index] ?? null; }

    private earliestPreviewProgress(index: number): number {
        const stage = this.gradedPlan!.stages[index];
        let progress = Math.max(index === 0 ? 0.06 : 0.10, stage.previewProgress - 0.08);
        // 前置机会段因预算取消后，首个实际水炮使用首段窗口，不继承中段等待。
        if (stage.event === EntertainmentEventId.CANNON && this.activationSerial === 0
            && index === this.eventIndex) progress = Math.min(progress, 0.20);
        return progress;
    }

    private stageBudgetSeconds(index: number): number {
        const stage = this.gradedPlan!.stages[index];
        // 班车在公开前确认航段，不再预算额外的 18 秒无效等候。
        return this.events[index] !== stage.event ? 8 : stage.event === EntertainmentEventId.TURTLE_BUS
            ? this.preparedTurtleSeconds || stage.durationSeconds : stage.durationSeconds;
    }

    private remainingBudget(distance: number, speed: number, includeOptional: boolean): number {
        const stages = this.gradedPlan!.stages;
        let elapsed = 0;
        let count = 0;
        for (let index = this.eventIndex; index < stages.length; index++) {
            if (index !== this.eventIndex && !includeOptional && !stages[index].required) continue;
            if (count++ > 0) elapsed += this.gapSeconds();
            elapsed = Math.max(elapsed,
                (this.earliestPreviewProgress(index) * this.raceDistance - distance) / speed);
            elapsed += (this.events[index] === EntertainmentEventId.TURTLE_BUS ? 0 : 6) + this.stageBudgetSeconds(index);
        }
        return elapsed + 5;
    }

    private prepareBudgetedPreview(distance: number, referenceSpeed: number): boolean {
        const speed = Number.isFinite(referenceSpeed) ? Math.max(0.5, referenceSpeed) : 0.5;
        const available = Math.max(0, this.raceDistance - distance) / speed;
        if (distance > this.raceDistance * 0.78) {
            for (let index = this.eventIndex; index < this.events.length; index++) this.skipReasons[index] = 'late-race';
            this.complete(); return false;
        }
        if (this.eventIndex >= this.events.length) {
            const duration = this.encoreEvent === EntertainmentEventId.SHARK ? 14
                : this.encoreEvent === EntertainmentEventId.CANNON ? 9.9
                    : this.gradedPlan!.grade === 3 ? 11.5 : 10.5;
            if (this.encoreEvent === null || 6 + duration + 5 > available * 0.8) {
                this.complete(); return false;
            }
            return true;
        }
        while (this.eventIndex < this.events.length) {
            const stage = this.gradedPlan!.stages[this.eventIndex];
            const early = this.remainingBudget(distance, speed, true) > available * 0.8;
            const progress = early ? this.earliestPreviewProgress(this.eventIndex) : stage.previewProgress;
            // 未到启动窗口不作不可逆取消；后段容量只决定提前，不牺牲已选的当前主段。
            if (distance < progress * this.raceDistance) return false;
            if (this.currentEvent() === EntertainmentEventId.TURTLE_BUS && this.prepareTurtle) {
                this.preparedTurtleSeconds = this.prepareTurtle();
                if (this.preparedTurtleSeconds <= 0) {
                    // 静默找航段，但只使用本局可支配的余量；每秒最多规划四次。
                    // 后续 required 段的预算先留好，不能再固定空等十八秒。
                    if (this.remainingBudget(distance, speed, false) <= available) {
                        this.remainingSeconds = 0.25;
                        return false;
                    }
                    if (this.gradedPlan!.grade >= 2) {
                        this.events[this.eventIndex] = EntertainmentEventId.WHIRLPOOL;
                        this.revision++;
                    } else {
                        this.skipReasons[this.eventIndex] = 'no-boarding-window';
                        this.eventIndex++;
                        this.revision++;
                        continue;
                    }
                }
            }
            const duration = this.stageBudgetSeconds(this.eventIndex)
                + (this.currentEvent() === EntertainmentEventId.TURTLE_BUS ? 0 : 6);
            if ((stage.required ? duration : this.remainingBudget(distance, speed, false)) > available) {
                this.skipReasons[this.eventIndex] = 'time-budget';
                this.eventIndex++;
                this.revision++;
                continue;
            }
            return true;
        }
        this.complete();
        return false;
    }
}

export function buildEntertainmentEventOrder(
    seed: number,
    raceDistance = 200,
    includeLitter = ENTERTAINMENT_LITTER_SELECTION_ENABLED,
): readonly EntertainmentEventId[] {
    const random = new SeededRandom(((Number.isFinite(seed) ? seed : 0) ^ 0x656e7465) >>> 0);
    if (includeLitter) {
        const count = raceDistance >= 400 ? (random.int(2) === 0 ? 5 : 6) : (random.int(2) === 0 ? 3 : 4);
        const field = [
            EntertainmentEventId.WHIRLPOOL,
            EntertainmentEventId.OBSTACLE,
            EntertainmentEventId.GEYSER,
            EntertainmentEventId.GIANT_WAVE,
        ];
        const contest = [EntertainmentEventId.STIMULANT, EntertainmentEventId.TIMED_BOMB,
            EntertainmentEventId.TURTLE_BUS];
        const assault = [EntertainmentEventId.SHARK, EntertainmentEventId.CANNON];
        const events = [
            field[random.int(field.length)],
            contest[random.int(contest.length)],
            assault[random.int(assault.length)],
        ];
        const remaining = [...field, ...contest, ...assault].filter(event => events.indexOf(event) < 0);
        random.shuffle(remaining);
        while (events.length < count && remaining.length > 0) events.push(remaining.pop()!);
        random.shuffle(events);
        moveNonClosingEventAwayFromEnd(events, random);
        return events;
    }
    if (raceDistance >= 400) {
        const events = [
            EntertainmentEventId.STIMULANT,
            EntertainmentEventId.TIMED_BOMB,
            EntertainmentEventId.WHIRLPOOL,
            EntertainmentEventId.MINEFIELD,
            EntertainmentEventId.SHARK,
            EntertainmentEventId.CANNON,
            EntertainmentEventId.TURTLE_BUS,
            EntertainmentEventId.GEYSER,
            EntertainmentEventId.GIANT_WAVE,
        ];
        random.shuffle(events);
        events.length = random.int(2) === 0 ? 5 : 6;
        moveNonClosingEventAwayFromEnd(events, random);
        return events;
    }
    const fieldCandidates = [EntertainmentEventId.WHIRLPOOL, EntertainmentEventId.MINEFIELD,
        EntertainmentEventId.GEYSER, EntertainmentEventId.GIANT_WAVE];
    const field = fieldCandidates[random.int(fieldCandidates.length)];
    const contest = [EntertainmentEventId.STIMULANT, EntertainmentEventId.TIMED_BOMB,
        EntertainmentEventId.TURTLE_BUS][random.int(3)];
    const assault = random.int(2) === 0 ? EntertainmentEventId.SHARK : EntertainmentEventId.CANNON;
    const events = [field, contest, assault];
    if (random.int(2) === 0) {
        const remaining = [
            ...fieldCandidates.filter(event => event !== field),
            ...[EntertainmentEventId.STIMULANT, EntertainmentEventId.TIMED_BOMB,
                EntertainmentEventId.TURTLE_BUS].filter(event => event !== contest),
            assault === EntertainmentEventId.SHARK ? EntertainmentEventId.CANNON : EntertainmentEventId.SHARK,
        ];
        events.push(remaining[random.int(remaining.length)]);
    }
    random.shuffle(events);
    moveNonClosingEventAwayFromEnd(events, random);
    return events;
}

export function buildEntertainmentSpecialMask(
    seed: number,
    events: readonly EntertainmentEventId[],
): number {
    if (events.indexOf(EntertainmentEventId.WHIRLPOOL) < 0) return 0;
    const random = new SeededRandom(((Number.isFinite(seed) ? seed : 0) ^ ENTERTAINMENT_SPECIAL_RANDOM_SALT) >>> 0);
    return random.next() < WHIRLPOOL_SUPER_CHANCE
        ? eventBit(EntertainmentEventId.WHIRLPOOL)
        : 0;
}

export function packEntertainmentEvents(events: readonly EntertainmentEventId[]): number {
    let packed = 0;
    for (let index = 0; index < Math.min(MAX_EVENT_COUNT, events.length); index++) {
        packed |= (events[index] & 0xf) << (index * 4);
    }
    return packed >>> 0;
}

export function unpackEntertainmentEvents(packed: number, eventCount: number): readonly EntertainmentEventId[] {
    const count = Number.isSafeInteger(eventCount) && eventCount >= 0 && eventCount <= MAX_EVENT_COUNT
        ? eventCount
        : 0;
    return Array.from({ length: count }, (_, index) => (
        (packed >>> (index * 4)) & 0xf
    ) as EntertainmentEventId);
}

function eventBit(event: EntertainmentEventId): number { return 1 << event; }

function isActiveDirectorPhase(phase: EntertainmentDirectorPhase): boolean {
    return phase === EntertainmentDirectorPhase.ACTIVE
        || phase === EntertainmentDirectorPhase.CLOSING;
}

function validDirectorState(state: EntertainmentDirectorState, graded = false): boolean {
    return !!state
        && Number.isSafeInteger(state.revision) && state.revision >= 0
        && Number.isSafeInteger(state.phase) && state.phase >= 0 && state.phase <= EntertainmentDirectorPhase.CLOSING
        && Number.isSafeInteger(state.eventCount)
        && state.eventCount >= (graded ? 0 : 3) && state.eventCount <= MAX_EVENT_COUNT
        && Number.isSafeInteger(state.eventIndex) && state.eventIndex >= 0 && state.eventIndex <= state.eventCount
        && Number.isFinite(state.remainingSeconds) && state.remainingSeconds >= 0
        && Number.isSafeInteger(state.packedEvents) && state.packedEvents >= 0
        && Number.isSafeInteger(state.activatedMask) && state.activatedMask >= 0
        && Number.isSafeInteger(state.residentMask) && state.residentMask >= 0
        && Number.isSafeInteger(state.specialMask) && state.specialMask >= 0
        && (state.specialMask & ~eventBit(EntertainmentEventId.WHIRLPOOL)) === 0
        && Number.isSafeInteger(state.activationSerial) && state.activationSerial >= 0
        && (state.lastActivatedEvent === null
            || (Number.isSafeInteger(state.lastActivatedEvent)
                && ENTERTAINMENT_SELECTABLE_EVENTS.indexOf(state.lastActivatedEvent) >= 0))
        && (state.activationSerial === 0 || state.lastActivatedEvent !== null)
        && Number.isSafeInteger(state.encoreRound) && state.encoreRound >= 0
        && (state.encoreEvent === null || ENCORE_EVENTS.indexOf(state.encoreEvent) >= 0)
        && (state.eventIndex < state.eventCount || state.encoreEvent !== null
            || state.phase === EntertainmentDirectorPhase.COMPLETE)
        && Number.isFinite(state.anchorDistance) && state.anchorDistance >= 0
        && Array.isArray(state.eventAnchorDistances) && state.eventAnchorDistances.length === MAX_EVENT_COUNT
        && state.eventAnchorDistances.every(distance => Number.isFinite(distance) && distance >= 0);
}

function validEventOrder(events: readonly EntertainmentEventId[]): boolean {
    if (events.length < 3 || events.length > MAX_EVENT_COUNT || new Set(events).size !== events.length) return false;
    if (events.some(event => !Number.isSafeInteger(event)
        || ENTERTAINMENT_SELECTABLE_EVENTS.indexOf(event) < 0)) return false;
    const fieldCount = events.filter(event => isFieldEvent(event)).length;
    const contestCount = events.filter(event => event === EntertainmentEventId.STIMULANT
        || event === EntertainmentEventId.TIMED_BOMB
        || event === EntertainmentEventId.TURTLE_BUS).length;
    const assaultCount = events.filter(event => event === EntertainmentEventId.SHARK
        || event === EntertainmentEventId.CANNON).length;
    return fieldCount >= 1 && contestCount >= 1 && assaultCount >= 1
        && !isNonClosingEvent(events[events.length - 1]);
}

function isFieldEvent(event: EntertainmentEventId): boolean {
    return event === EntertainmentEventId.WHIRLPOOL
        || event === EntertainmentEventId.OBSTACLE
        || event === EntertainmentEventId.GEYSER || event === EntertainmentEventId.GIANT_WAVE;
}

function isNonClosingEvent(event: EntertainmentEventId): boolean {
    return isFieldEvent(event) || event === EntertainmentEventId.TURTLE_BUS;
}

function moveNonClosingEventAwayFromEnd(events: EntertainmentEventId[], random: SeededRandom): void {
    const lastIndex = events.length - 1;
    if (!isNonClosingEvent(events[lastIndex])) return;
    const nonFieldIndices = events
        .map((event, index) => isNonClosingEvent(event) ? -1 : index)
        .filter(index => index >= 0 && index < lastIndex);
    const swapIndex = nonFieldIndices[random.int(nonFieldIndices.length)];
    const last = events[lastIndex];
    events[lastIndex] = events[swapIndex];
    events[swapIndex] = last;
}
