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
        case EntertainmentEventId.SHARK: return '玩具巡场';
        case EntertainmentEventId.CANNON: return '水球点名';
        case EntertainmentEventId.LITTER: return '垃圾漂流';
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
        ['泳池广播：饮料车已翻，心跳苏打正在自行下水', '苏打入场 · 靠近瓶子抢先喝下'],
        ['泳池广播：赞助商只说送饮料，没说整箱漂进来', '补给开漂 · 抢到瓶子就能提速'],
        ['泳池广播：救生员捞瓶失败，现改为全员争抢', '捞瓶失败 · 靠近苏打直接拾取'],
        ['泳池广播：几瓶能量饮料坚持要参加游泳比赛', '饮料参赛 · 抢先靠近瓶子补能量'],
        ['泳池广播：自动售货机拒绝为水面上的瓶子负责', '售货机失联 · 靠近漂瓶争夺补给'],
        ['泳池广播：水质报告显示，接下来心跳可能超标', '心率预警 · 抢苏打提速也会更难转向'],
        ['泳池广播：补给船刹车失灵，饮料即将散落赛道', '补给散落 · 靠近瓶子抢先喝下'],
        ['泳池广播：有几瓶苏打认为自己比选手更会游', '苏打抢道 · 靠近瓶子把它喝掉'],
        ['泳池广播：广播室收到一箱过度热情的能量饮料', '能量来袭 · 抢瓶补体力并获得加速'],
        ['泳池广播：今日特供即将下水，请让心脏做好准备', '特供开抢 · 靠近瓶子获得强力加速'],
        ['泳池广播：饮料箱拒绝靠岸，决定沿泳道自行配送', '能量漂流 · 靠近瓶子抢先补给'],
        ['泳池广播：营养师还没赶到，补给已经先游起来了', '补给先行 · 抢到苏打恢复体力'],
        ['泳池广播：自动售货机开启移动服务，就是移动得有点远', '移动售货 · 靠近漂瓶直接拾取'],
        ['泳池广播：几瓶苏打已获得临时泳道，请选手自行处理', '苏打占道 · 抢瓶补能并获得加速'],
        ['泳池广播：医务组正在调查是谁点了双倍心跳套餐', '心跳套餐 · 抢苏打提速，注意转向'],
        ['泳池广播：瓶盖宣布自己会游，瓶身表示并不知情', '漂瓶失控 · 靠近苏打抢先喝下'],
        ['泳池广播：今日补给不走陆路，改走水路直达赛场', '水路补给 · 抢到瓶子恢复体力'],
        ['泳池广播：裁判说水里的饮料不能喝，赞助商说可以', '规则争议 · 靠近苏打获得强化'],
        ['泳池广播：补给员只是手滑了一下，现在全场都得抢', '全场开抢 · 靠近瓶子直接拾取'],
        ['泳池广播：心脏热身已经结束，真正的加速饮料来了', '加速补给 · 抢苏打获得强力提速'],
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
        ['泳池广播：排水系统情绪不稳，前方水流即将拧巴', '漩涡出现 · 贴外圈顺流借力'],
        ['泳池广播：维修队拧错了阀门，泳池开始打转', '水流打转 · 远离核心并贴外圈冲浪'],
        ['泳池广播：泳池突然想搅拌一下今天的参赛选手', '搅拌开始 · 避开核心，顺着外圈游'],
        ['泳池广播：前方水面正在练习一个不太标准的转身', '水面转身 · 贴外圈借流加速'],
        ['泳池广播：排水口已进入加班状态，请抓紧扶稳', '排水加班 · 远离核心并顺流前进'],
        ['泳池广播：水流方向开始自由发挥，直线暂时取消', '直线取消 · 贴外圈跟随旋流'],
        ['泳池广播：前方水域申请原地转圈，现已批准', '转圈获批 · 避开核心，借外圈提速'],
        ['泳池广播：泳池底部传来咕噜声，路线即将变弯', '路线变弯 · 贴外圈顺流通过'],
        ['泳池广播：本场新增旋转项目，所有选手自动报名', '旋转项目开始 · 远核心、贴外圈'],
        ['泳池广播：水面开始拧麻花，请勿坚持走最短线', '水流拧巴 · 绕开核心顺流冲浪'],
        ['泳池广播：有人想喝咖啡，顺手把整座泳池搅了一遍', '水流搅动 · 避开核心贴外圈'],
        ['泳池广播：水面正在加载旋转模式，直线功能暂时离线', '旋转模式 · 顺着外圈水流前进'],
        ['泳池广播：排水口今天格外抢镜，准备在赛道中央表演', '排水表演 · 远离核心借流通过'],
        ['泳池广播：前方直线正在维修，请各位绕着水流走', '直线维修 · 贴外圈顺流加速'],
        ['泳池广播：泳池临时安装了转盘，而且没有停止按钮', '水上转盘 · 避开核心顺流绕行'],
        ['泳池广播：几股水流正在绕圈开会，请不要坐到中间', '旋流开会 · 远核心贴外圈通过'],
        ['泳池广播：维修工只拧了半圈阀门，水面却转了十几圈', '阀门失控 · 顺着外圈水流前进'],
        ['泳池广播：中心水域好像晕了，现在正努力让大家一起晕', '中心旋转 · 绕开核心保持方向'],
        ['泳池广播：浪花正在排队转弯，选手可以顺路搭个便车', '浪花转弯 · 贴外圈借流提速'],
        ['泳池广播：今天不只选手练转身，整片水面也要练', '全池转身 · 避核心顺外圈冲浪'],
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
        ['泳池广播：充气玩具鲨准备巡场，它连表情都热身好了', '玩具巡场 · 留意锁定并及时变向'],
        ['泳池广播：蓝色圆鼻头申请借道，转弯灯已经亮了', '圆鼻借道 · 观察箭头横向绕开'],
        ['泳池广播：器材室的玩具鲨自己来参加热身了', '玩具热身 · 拉开距离继续游'],
        ['泳池广播：玩具鲨打足了气，也攒足了得意', '得意巡游 · 被锁定后变向绕行'],
        ['泳池广播：本场新增圆鼻教练，专教临时转弯', '转弯练习 · 留出侧方空隙'],
        ['泳池广播：充气玩具鲨正在签到，签名是一串水花', '水花签到 · 留意锁定方向'],
        ['泳池广播：玩具鲨把直线当热身，把转弯当加赛', '玩具加赛 · 及时变线甩开锁定'],
        ['泳池广播：那只气鼓鼓的嘉宾准备下场串门了', '嘉宾串门 · 绕开圆鼻头'],
        ['泳池广播：玩具鲨的笑容很稳，行进路线不一定', '路线变化 · 观察目标及时绕行'],
        ['泳池广播：水上玩具申请巡场，裁判提醒它看路', '巡场开始 · 看清箭头拉开距离'],
        ['泳池广播：圆鼻头即将上线，请提前想好转弯方向', '圆鼻上线 · 被锁定后及时变向'],
        ['泳池广播：玩具鲨今天很有精神，已经绕着器材箱转了三圈', '精神满满 · 留出绕行空间'],
        ['泳池广播：充气嘉宾准备巡游，得意表情无需充电', '嘉宾巡游 · 变向避开正前方'],
        ['泳池广播：玩具鲨正在练习轻轻顶一下，方向感请保管好', '圆鼻顶推 · 提前变线绕开'],
        ['泳池广播：蓝青色玩具鲨来查转弯作业了', '转弯检查 · 看准空隙再通过'],
        ['泳池广播：玩具鲨说自己只巡一圈，尾巴已经开始加班', '尾巴加班 · 留意锁定并绕行'],
        ['泳池广播：气阀检查完毕，圆鼻头准备出发', '玩具出发 · 拉开距离继续冲刺'],
        ['泳池广播：本场最鼓的参赛嘉宾即将登场', '鼓鼓登场 · 观察箭头及时变向'],
        ['泳池广播：玩具鲨准备来个碰面礼，请给它留条路', '碰面预告 · 横向绕开圆鼻头'],
        ['泳池广播：水花小队带来了玩具鲨，转圈项目即将加映', '转圈加映 · 变向绕开玩具鲨'],
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
        ['泳池广播：看台饮料喝完了，空瓶决定下水参赛', '垃圾入场 · 看清瓶子餐盒及时绕行'],
        ['泳池广播：清洁车走错方向，一路开到了泳池边', '赛道变脏 · 绕开硬瓶或划出餐盒'],
        ['泳池广播：观众席开展投掷比赛，泳池不幸当靶场', '杂物落水 · 观察安全空隙及时变线'],
        ['泳池广播：几件垃圾拒绝进桶，坚持体验水上项目', '漂浮物入场 · 硬瓶要躲、餐盒可穿'],
        ['泳池广播：保洁员刚转身，餐盒和瓶子集体出逃', '垃圾出逃 · 找准通路避开减速'],
        ['泳池广播：水面卫生评分下降，路线选择难度上升', '赛道异物 · 绕开硬物并挣脱餐盒'],
        ['泳池广播：失物招领处表示，这批东西不用还了', '失物开漂 · 看准空隙横向绕行'],
        ['泳池广播：一只瓶子和一只餐盒决定组队拦路', '软硬夹击 · 避开瓶子或穿过餐盒'],
        ['泳池广播：看台补给吃得很快，餐盒来得更快', '餐盒落水 · 选择安全通道继续冲刺'],
        ['泳池广播：泳池临时增加环保课，考试方式是绕行', '环保考试 · 分清硬瓶餐盒及时避让'],
        ['泳池广播：运动饮料瓶学会冲浪，餐盒决定一起报名', '垃圾参赛 · 分清软硬及时绕行'],
        ['泳池广播：回收物拒绝接受分类，现在全都漂进了赛道', '分类失败 · 绕开硬瓶并划出餐盒'],
        ['泳池广播：午餐已经走了，餐盒却选择留下比赛', '餐盒留场 · 看准安全空隙变线'],
        ['泳池广播：瓶子负责拦路，餐盒负责把人留下', '垃圾配合 · 避开硬物并持续划出餐盒'],
        ['泳池广播：垃圾桶盖只开了一秒，赛道付出了全部代价', '垃圾出逃 · 找准通路及时绕行'],
        ['泳池广播：水面卫生进入紧急状态，保洁员还在赶来的路上', '卫生预警 · 分清软硬漂浮物'],
        ['泳池广播：泡沫餐盒接管了部分泳道，但没有许可证', '餐盒占道 · 横向寻找安全通路'],
        ['泳池广播：环保小组安排了一场实践课，选手都是考生', '实践考试 · 绕开硬瓶或穿过餐盒'],
        ['泳池广播：硬瓶负责碰撞，餐盒负责拖慢，分工明确', '软硬分工 · 看清类型及时避让'],
        ['泳池广播：几件垃圾正在水面开会，正好把路堵了', '漂流会议 · 选择空隙继续冲刺'],
    ],
};

const SUPER_WHIRLPOOL_BROADCAST_COPIES: readonly EntertainmentBroadcastCopy[] = [
    ['泳池广播：主排水口全开，泳池中心即将出现超级漩涡', '超级漩涡出现 · 远离核心或贴外圈冲浪'],
    ['泳池广播：维修队弄丢了总阀门，中心水域开始暴走', '中心水域暴走 · 远核心、贴外圈'],
    ['泳池广播：泳池开启强力搅拌，所有选手都是配料', '强力搅拌开始 · 避开核心顺流前进'],
    ['泳池广播：主排水系统全速运转，说明书已经飞走', '主排水口全开 · 贴外圈借流冲刺'],
    ['泳池广播：中心水面正在折叠，直线通过不再推荐', '超级旋流成形 · 绕开核心贴外圈'],
    ['泳池广播：检测到特大咕噜声，中心区域请勿围观', '特大漩涡出现 · 远离核心顺流绕行'],
    ['泳池广播：排水口突然认真工作，后果非常不认真', '强力排水启动 · 贴外圈借力通过'],
    ['泳池广播：中心水域申请高速旋转，裁判已经批准', '高速旋转开始 · 远核心、顺外圈'],
    ['泳池广播：本场进入洗衣机档位，请抓稳自己的泳道', '洗衣机档启动 · 避核心贴外圈冲浪'],
    ['泳池广播：超级漩涡即将开张，中心位置不设座位', '超级漩涡开张 · 绕开核心借流提速'],
    ['泳池广播：主排水口宣布全员免费旋转，谢绝退票', '免费旋转 · 远离核心贴外圈冲浪'],
    ['泳池广播：水面正在把整个泳池拧成一杯特大饮料', '全池搅拌 · 避开核心顺流绕行'],
    ['泳池广播：维修队建议关闭总阀门，但没人知道它在哪', '总阀失踪 · 远核心贴外圈通过'],
    ['泳池广播：中心水域开启最高档，附近不再保证直线', '最高档旋流 · 顺外圈借力前进'],
    ['泳池广播：排水系统今天超额完成任务，请勿靠近验收', '排水超额 · 避开核心顺流冲刺'],
    ['泳池广播：超级漩涡申请扩大营业面积，现已批准', '漩涡扩张 · 远离核心贴外圈'],
    ['泳池广播：水流已进入洗衣机脱水环节，请抓稳方向', '脱水环节 · 避核心顺外圈冲浪'],
    ['泳池广播：中心咕噜声突破安全音量，水面即将暴走', '中心暴走 · 贴外圈借流通过'],
    ['泳池广播：泳池中央出现水上旋转门，而且转得很快', '旋转门开启 · 绕开核心顺流前进'],
    ['泳池广播：主排水口决定证明自己不是装饰', '主排水发力 · 远核心贴外圈提速'],
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
