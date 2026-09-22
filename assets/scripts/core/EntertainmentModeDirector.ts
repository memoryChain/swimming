import { SeededRandom } from './SharedRNG';
import { WHIRLPOOL_SUPER_CHANCE } from './WhirlpoolBrawlRules';

export const enum EntertainmentEventId {
    STIMULANT = 0,
    TIMED_BOMB = 1,
    WHIRLPOOL = 2,
    MINEFIELD = 3,
    SHARK = 4,
    CANNON = 5,
    LITTER = 6,
}

/** 阶段 F～H 已完成；正式娱乐导演从七种候选中按赛程抽取三至六种。 */
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
};
const PERSISTENT_EVENTS_MASK = eventBit(EntertainmentEventId.STIMULANT)
    | eventBit(EntertainmentEventId.WHIRLPOOL)
    | eventBit(EntertainmentEventId.MINEFIELD)
    | eventBit(EntertainmentEventId.SHARK)
    | eventBit(EntertainmentEventId.CANNON)
    | eventBit(EntertainmentEventId.LITTER);

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
        case EntertainmentEventId.MINEFIELD: return '喷水浮标';
        case EntertainmentEventId.SHARK: return '玩具开咬';
        case EntertainmentEventId.CANNON: return '水球点名';
        case EntertainmentEventId.LITTER: return '杂物漂流';
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
        ["泳池广播：黄色气球替浮标举起了手，下方软边碰到就开喷","气球举手 · 绕开下方软边"],
        ["泳池广播：气球浮标准备排队，别替它们按下喷水开关","浮标列队 · 看准空隙绕行"],
        ["泳池广播：小气球今天负责提醒，底座负责送你一身清凉","清凉提醒 · 避开气球下方"],
        ["泳池广播：水面即将长出气球，根部有点怕碰","气球冒头 · 横向绕开底座"],
        ["泳池广播：感叹号已经举高，喷水按钮就在它脚下","标记升起 · 注意水面软边"],
        ["泳池广播：浮标绑好了气球，碰边就表演原地谢幕","浮标谢幕 · 绕开底座继续游"],
        ["泳池广播：气球组申请当路标，禁止用身体确认路线","气球指路 · 留出绕行空隙"],
        ["泳池广播：本轮喷泉带着黄色招牌，远远看清就好","招牌上浮 · 绕开下方圆盘"],
        ["泳池广播：气球不卖也不能领，下方浮标正在等碰触","气球就位 · 避开软边触碰"],
        ["泳池广播：小浮标怕大家看不见，专门系了一个感叹号","浮标亮相 · 看清底座位置"],
        ["泳池广播：黄色气球开始站岗，碰到岗位就会开喷","气球站岗 · 横移避开底座"],
        ["泳池广播：喷泉的帽子有点鼓，碰一下就啪地收工","鼓帽上浮 · 避开圆盘及水花"],
        ["泳池广播：气球浮标准备打招呼，这个招呼有点湿","清凉招呼 · 看准空隙通过"],
        ["泳池广播：水滴图案只是预告，碰到软边才是正片","喷水预告 · 绕开气球下方"],
        ["泳池广播：气球负责高举提醒，圆盘负责守住水面","上下就位 · 及时横向绕行"],
        ["泳池广播：这批浮标自带气球，但不提供顺路接送","浮标漂来 · 留出安全空隙"],
        ["泳池广播：感叹号想保持干燥，下面的喷口没有答应","喷口待命 · 避开下方软边"],
        ["泳池广播：黄色气球在练平衡，别用泳帽帮它纠正","平衡练习 · 绕开水面底座"],
        ["泳池广播：浮标的新气球刚系好，碰边会让节目提前结束","气球登场 · 注意圆盘位置"],
        ["泳池广播：本轮浮标的节目是气球爆开，然后清凉退场","清凉退场 · 绕开触碰与水花"],
    ],
    [EntertainmentEventId.SHARK]: [
        ["泳池广播：工作人员保证它是玩具，没保证它不咬人","玩具开咬 · 看准箭头及时变向"],
        ["泳池广播：充气玩具鲨来了，外壳软，咬人可不轻","小心挨咬 · 拉开距离绕行"],
        ["泳池广播：玩具鲨气已经打足，嘴也准备开工了","开工提醒 · 别让玩具鲨追上"],
        ["泳池广播：器材室的玩具鲨自己游出来了，注意它真的会咬","玩具追人 · 横向躲开锁定"],
        ["泳池广播：玩具鲨的使用说明最后一页写着，小心被咬","说明补充 · 看清箭头再通过"],
        ["泳池广播：这只玩具鲨笑得很得意，待会咬人也很认真","得意开咬 · 留出转弯空间"],
        ["泳池广播：玩具鲨尾巴热完身了，嘴巴说轮到我了","轮到嘴巴 · 及时变向避开"],
        ["泳池广播：玩具鲨正在检查大家的转弯作业，答错可能挨一口","转弯测验 · 别沿锁定方向直游"],
        ["泳池广播：充气玩具鲨申请参加比赛，报名项目是追着咬","玩具参赛 · 被锁定就变向"],
        ["泳池广播：玩具鲨说只轻轻咬一下，裁判建议不要亲自确认","保持距离 · 绕开玩具鲨的嘴"],
        ["泳池广播：玩具鲨的软壳通过检查，会咬人这件事也确认了","检查完毕 · 注意开咬方向"],
        ["泳池广播：本轮玩具鲨负责追人，浮圈负责接住躲慢的人","开咬预告 · 提前找好侧方空隙"],
        ["泳池广播：玩具鲨今天精神不错，尤其是嘴巴","精神满满 · 躲开这一口"],
        ["泳池广播：气阀拧好了，玩具鲨准备张嘴营业","张嘴营业 · 看见锁定及时绕开"],
        ["泳池广播：玩具鲨不是来合影的，它正在练习咬一口就松开","短咬提醒 · 拉开距离继续游"],
        ["泳池广播：充气玩具鲨即将入场，请看好自己的泳裤","泳裤保卫 · 变向甩开玩具鲨"],
        ["泳池广播：玩具鲨的外包装很可爱，小心开咬的功能","可爱开场 · 被追上也会挨咬"],
        ["泳池广播：工作人员正在找玩具鲨的停止追人按钮，大家先绕行","先绕再说 · 别让这一口追上"],
        ["泳池广播：玩具鲨说今天很乖，只追跑得不够弯的人","绕行练习 · 及时变线防咬"],
        ["泳池广播：玩具鲨准备开咬，浮圈已经在旁边待命","玩具开咬 · 看准空隙躲过去"],
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
    return event === EntertainmentEventId.WHIRLPOOL && special
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
        includeLitter = ENTERTAINMENT_LITTER_SELECTION_ENABLED,
    ) {
        this.seed = Number.isFinite(seed) ? seed >>> 0 : 0;
        this.raceDistance = Number.isFinite(raceDistance) ? Math.max(1, raceDistance) : 200;
        this.events = [...buildEntertainmentEventOrder(this.seed, this.raceDistance, includeLitter)];
        this.specialMask = buildEntertainmentSpecialMask(this.seed, this.events);
        this.publishRuntimeState();
    }

    reset(): void {
        this.revision = 0;
        this.phase = EntertainmentDirectorPhase.OPENING;
        this.eventIndex = 0;
        this.remainingSeconds = OPENING_SECONDS;
        this.activatedMask = 0;
        this.residentMask = 0;
        this.activationSerial = 0;
        this.lastActivatedEvent = null;
        this.encoreRound = 0;
        this.encoreEvent = null;
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

    isSpecialEvent(event: EntertainmentEventId): boolean {
        return (this.specialMask & eventBit(event)) !== 0;
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
    ): EntertainmentDirectorTransition {
        const transition = this.clearTransition();
        if (this.phase === EntertainmentDirectorPhase.COMPLETE) return transition;
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        const distance = Number.isFinite(leaderDistance) ? Math.max(0, leaderDistance) : 0;
        this.remainingSeconds = Math.max(0, this.remainingSeconds - step);
        if (this.remainingSeconds > 0) return transition;

        if (this.phase === EntertainmentDirectorPhase.OPENING || this.phase === EntertainmentDirectorPhase.GAP) {
            if (!this.readyForPreview(distance)) return transition;
            this.phase = EntertainmentDirectorPhase.PREVIEW;
            this.remainingSeconds = this.previewSeconds();
            this.revision++;
            transition.previewEvent = this.currentEvent();
        } else if (this.phase === EntertainmentDirectorPhase.PREVIEW) {
            const event = this.currentEvent();
            if (event === null) {
                this.complete();
                return transition;
            }
            this.phase = EntertainmentDirectorPhase.ACTIVE;
            this.remainingSeconds = EVENT_DURATION_SECONDS[event] * this.eventDurationScale();
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
                this.scheduleEncore(event);
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
        if (!validDirectorState(state) || !validEventOrder(authoritativeEvents)
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
        const candidates = ENCORE_EVENTS.filter(event => event !== previousEvent);
        this.encoreEvent = candidates[random.int(candidates.length)];
        this.phase = EntertainmentDirectorPhase.GAP;
        this.remainingSeconds = ENCORE_GAP_MIN_SECONDS + random.next() * ENCORE_GAP_VARIATION_SECONDS;
        this.revision++;
    }

    private publishRuntimeState(): void {
        runtimeResidentMask = this.residentMask;
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
        if (this.events.length >= 5) return LONG_RACE_PREVIEW_SECONDS;
        return this.events.length === 4 ? FOUR_EVENT_PREVIEW_SECONDS : THREE_EVENT_PREVIEW_SECONDS;
    }

    private eventDurationScale(): number {
        if (this.events.length >= 5) return LONG_RACE_DURATION_SCALE;
        return this.events.length === 4 ? FOUR_EVENT_DURATION_SCALE : 1;
    }

    private gapSeconds(): number {
        return this.events.length >= 5 ? LONG_RACE_GAP_SECONDS : SHORT_RACE_GAP_SECONDS;
    }

    private readyForPreview(distance: number): boolean {
        if (this.eventIndex >= this.events.length) return this.encoreEvent !== null;
        const progress = EVENT_PROGRESS_BY_COUNT[this.events.length]?.[this.eventIndex] ?? 0;
        return distance >= this.raceDistance * progress;
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
            EntertainmentEventId.MINEFIELD,
            EntertainmentEventId.LITTER,
        ];
        const contest = [EntertainmentEventId.STIMULANT, EntertainmentEventId.TIMED_BOMB];
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
        moveFieldEventAwayFromEnd(events, random);
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
        ];
        random.shuffle(events);
        events.length = random.int(2) === 0 ? 5 : 6;
        moveFieldEventAwayFromEnd(events, random);
        return events;
    }
    const field = random.int(2) === 0 ? EntertainmentEventId.WHIRLPOOL : EntertainmentEventId.MINEFIELD;
    const contest = random.int(2) === 0 ? EntertainmentEventId.STIMULANT : EntertainmentEventId.TIMED_BOMB;
    const assault = random.int(2) === 0 ? EntertainmentEventId.SHARK : EntertainmentEventId.CANNON;
    const events = [field, contest, assault];
    if (random.int(2) === 0) {
        const remaining = [
            field === EntertainmentEventId.WHIRLPOOL ? EntertainmentEventId.MINEFIELD : EntertainmentEventId.WHIRLPOOL,
            contest === EntertainmentEventId.STIMULANT ? EntertainmentEventId.TIMED_BOMB : EntertainmentEventId.STIMULANT,
            assault === EntertainmentEventId.SHARK ? EntertainmentEventId.CANNON : EntertainmentEventId.SHARK,
        ];
        events.push(remaining[random.int(remaining.length)]);
    }
    random.shuffle(events);
    moveFieldEventAwayFromEnd(events, random);
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
        packed |= (events[index] & 0x7) << (index * 3);
    }
    return packed >>> 0;
}

export function unpackEntertainmentEvents(packed: number, eventCount: number): readonly EntertainmentEventId[] {
    const count = Number.isSafeInteger(eventCount) && eventCount >= 3 && eventCount <= MAX_EVENT_COUNT
        ? eventCount
        : 0;
    return Array.from({ length: count }, (_, index) => (
        (packed >>> (index * 3)) & 0x7
    ) as EntertainmentEventId);
}

function eventBit(event: EntertainmentEventId): number { return 1 << event; }

function isActiveDirectorPhase(phase: EntertainmentDirectorPhase): boolean {
    return phase === EntertainmentDirectorPhase.ACTIVE
        || phase === EntertainmentDirectorPhase.CLOSING;
}

function validDirectorState(state: EntertainmentDirectorState): boolean {
    return !!state
        && Number.isSafeInteger(state.revision) && state.revision >= 0
        && Number.isSafeInteger(state.phase) && state.phase >= 0 && state.phase <= EntertainmentDirectorPhase.CLOSING
        && Number.isSafeInteger(state.eventCount) && state.eventCount >= 3 && state.eventCount <= MAX_EVENT_COUNT
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
                && state.lastActivatedEvent >= EntertainmentEventId.STIMULANT
                && state.lastActivatedEvent <= EntertainmentEventId.LITTER))
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
        || event < EntertainmentEventId.STIMULANT
        || event > EntertainmentEventId.LITTER)) return false;
    const fieldCount = events.filter(event => isFieldEvent(event)).length;
    const contestCount = events.filter(event => event === EntertainmentEventId.STIMULANT
        || event === EntertainmentEventId.TIMED_BOMB).length;
    const assaultCount = events.filter(event => event === EntertainmentEventId.SHARK
        || event === EntertainmentEventId.CANNON).length;
    return fieldCount >= 1 && contestCount >= 1 && assaultCount >= 1
        && !isFieldEvent(events[events.length - 1]);
}

function isFieldEvent(event: EntertainmentEventId): boolean {
    return event === EntertainmentEventId.WHIRLPOOL
        || event === EntertainmentEventId.MINEFIELD
        || event === EntertainmentEventId.LITTER;
}

function moveFieldEventAwayFromEnd(events: EntertainmentEventId[], random: SeededRandom): void {
    const lastIndex = events.length - 1;
    if (!isFieldEvent(events[lastIndex])) return;
    const nonFieldIndices = events
        .map((event, index) => isFieldEvent(event) ? -1 : index)
        .filter(index => index >= 0 && index < lastIndex);
    const swapIndex = nonFieldIndices[random.int(nonFieldIndices.length)];
    const last = events[lastIndex];
    events[lastIndex] = events[swapIndex];
    events[swapIndex] = last;
}
