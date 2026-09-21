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
        case EntertainmentEventId.TIMED_BOMB: return '定时炸弹传递';
        case EntertainmentEventId.WHIRLPOOL: return '漩涡冲浪';
        case EntertainmentEventId.MINEFIELD: return '漂流水雷';
        case EntertainmentEventId.SHARK: return '鲨鱼巡场';
        case EntertainmentEventId.CANNON: return '炮火点名';
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
        ['泳池广播：有位选手马上要收到会滴滴响的礼物', '炸弹已发放 · 贴近对手把它传出'],
        ['泳池广播：失物招领处送来一件没人敢认的包裹', '危险包裹到手 · 靠近对手完成传递'],
        ['泳池广播：今日幸运观众将获得限时闪烁背包', '闪烁背包已装上 · 贴近对手传走'],
        ['泳池广播：计时器已经启动，但说明书被水泡了', '倒计时开始 · 贴近对手甩掉炸弹'],
        ['泳池广播：一份特别快递正在随机寻找收件人', '特别快递签收 · 靠近对手转交'],
        ['泳池广播：泳池里混进了一个非常急躁的闹钟', '闹钟上身 · 贴近对手把它送走'],
        ['泳池广播：安检发现异常包裹，决定随机抽查一人', '随机抽查开始 · 贴近对手传出炸弹'],
        ['泳池广播：有人把倒计时装置误当成了接力棒', '爆炸接力开始 · 靠近对手完成交棒'],
        ['泳池广播：本轮奖品会响会闪，就是不保证安全', '危险奖品已发放 · 贴近对手转赠'],
        ['泳池广播：请注意，一件烫手礼物即将空降赛场', '烫手礼物到手 · 贴近对手传走'],
        ['泳池广播：包裹上只写了四个字，请尽快转交', '紧急转交 · 贴近对手传出炸弹'],
        ['泳池广播：计时器正在催单，目前的收件人压力很大', '倒计时催单 · 靠近对手完成交接'],
        ['泳池广播：烫手山芋完成升级，现在还会发光和响铃', '山芋升级 · 贴近对手赶快传走'],
        ['泳池广播：本次快递不支持拒收，只支持当面转赠', '强制签收 · 靠近对手转交炸弹'],
        ['泳池广播：接力组拿错了器材，这根接力棒正在倒数', '危险接力 · 贴近对手完成交棒'],
        ['泳池广播：抽奖箱里只有一张奖券，中奖者请保持冷静', '唯一大奖 · 靠近对手及时转赠'],
        ['泳池广播：有个背包开启了震动模式，而且关不掉', '背包震动 · 贴近对手甩掉炸弹'],
        ['泳池广播：拆弹专家还在路上，建议先交给下一位', '专家迟到 · 靠近对手转移炸弹'],
        ['泳池广播：倒计时装置不喜欢独处，请帮它认识新朋友', '寻找朋友 · 贴近对手完成传递'],
        ['泳池广播：本轮社交活动很简单，带着炸弹主动贴近别人', '危险社交 · 靠近对手把它送走'],
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
        ['泳池广播：清洁队请假了，几颗水雷正在自由活动', '水雷入场 · 横向避让，碰到就会爆炸'],
        ['泳池广播：水面发现带刺漂浮物，失主拒绝认领', '危险漂浮物出现 · 绕开水雷继续游'],
        ['泳池广播：保洁网漏捞了几颗脾气很差的铁球', '铁球开漂 · 注意横移避开触碰'],
        ['泳池广播：本池新增障碍，但说明牌已经沉底', '障碍生效 · 观察水面并避开水雷'],
        ['泳池广播：几颗水雷正在散步，请不要上前打招呼', '水雷散步 · 拉开距离，触碰会爆炸'],
        ['泳池广播：漂浮物检测异常，建议不要用身体确认', '异常漂浮物出现 · 横向绕开水雷'],
        ['泳池广播：器材室少了几颗水雷，现在知道去哪了', '失踪水雷入场 · 看准位置及时避让'],
        ['泳池广播：泳池开放盲盒项目，碰到可能当场开奖', '危险盲盒开漂 · 不要碰到水雷'],
        ['泳池广播：前方有刺球随波逐流，脾气比水流还大', '刺球漂来 · 横向变线绕开爆炸范围'],
        ['泳池广播：安全员表示一切可控，然后迅速离场', '安全员离场 · 观察水雷并及时绕行'],
        ['泳池广播：几颗铁球报名漂流项目，但忘了拆掉引信', '铁球漂流 · 横向避开水雷'],
        ['泳池广播：水雷表示自己只是路过，碰一下就不一定了', '危险路过 · 拉开距离避免触碰'],
        ['泳池广播：安全手册被风吹走了，目前只剩下不要碰', '安全提示 · 看准位置及时绕行'],
        ['泳池广播：水面突然长出几颗刺，泳池方拒绝解释', '水面长刺 · 横向变线避开爆炸'],
        ['泳池广播：器材管理员数了三遍，还是少了几颗水雷', '器材失踪 · 观察漂移方向及时躲避'],
        ['泳池广播：前方障碍看起来很圆，脾气却一点也不圆', '脾气铁球 · 绕开水雷继续前进'],
        ['泳池广播：请不要亲自测试水雷的碰撞系统是否正常', '禁止测试 · 拉开距离横向绕行'],
        ['泳池广播：泳池推出漂流抽奖，中奖方式是碰到水雷', '危险抽奖 · 避开水雷爆炸范围'],
        ['泳池广播：那些尖刺不是装饰，重复一次，不是装饰', '尖刺警告 · 看准水雷及时变线'],
        ['泳池广播：本泳道新增标点符号，名字叫爆点', '爆点开漂 · 横向避让继续冲刺'],
    ],
    [EntertainmentEventId.SHARK]: [
        ['泳池广播：请勿投喂，它已经自己来找饭了', '鲨鱼巡场 · 观察锁定并及时变向'],
        ['泳池广播：赛场出现未报名选手，而且牙齿很多', '未报名选手入场 · 被锁定后立刻变向'],
        ['泳池广播：救生员确认那不是一条很大的金鱼', '确认是鲨鱼 · 留意锁定并拉开距离'],
        ['泳池广播：水下嘉宾提前到场，它不接受采访', '水下嘉宾巡场 · 观察目标及时躲避'],
        ['泳池广播：有人点了外卖，但配送员好像理解反了', '鲨鱼开饭 · 被锁定后迅速改变方向'],
        ['泳池广播：泳池出现背鳍，广播室决定先装没看见', '背鳍逼近 · 留意锁定并及时变向'],
        ['泳池广播：今日安保由鲨鱼负责，请各位不要停下', '鲨鱼执勤 · 保持移动并甩开锁定'],
        ['泳池广播：水下传来磨牙声，可能不是设备故障', '磨牙声靠近 · 观察鲨鱼及时变向'],
        ['泳池广播：请保持冷静，尤其不要游得像一份午餐', '午餐时间到 · 被锁定后立刻变向'],
        ['泳池广播：大型鱼类申请加入比赛，裁判没敢拒绝', '鲨鱼参赛 · 留意锁定并拉开距离'],
        ['泳池广播：水下食堂提前营业，但菜单看起来很眼熟', '食堂开门 · 留意锁定及时变向'],
        ['泳池广播：一片背鳍前来签到，工作人员选择远程确认', '背鳍签到 · 观察目标迅速躲避'],
        ['泳池广播：鲨鱼表示只游一圈，至于咬不咬另说', '鲨鱼试游 · 被锁定后立即改变方向'],
        ['泳池广播：水下检查员已经到场，检查工具是一排牙齿', '水下检查 · 保持移动甩开锁定'],
        ['泳池广播：救生员吹了三次哨，鲨鱼一次都没回头', '警告无效 · 留意锁定及时变向'],
        ['泳池广播：本场特邀嘉宾很上镜，就是看起来有点饿', '嘉宾巡场 · 拉开距离避免被咬'],
        ['泳池广播：鲨鱼拿到了今日菜单，选手名单正好在上面', '菜单更新 · 被锁定后立刻转向'],
        ['泳池广播：水下传来热身声，准确地说，是牙齿热身', '牙齿热身 · 观察鲨鱼及时躲避'],
        ['泳池广播：一位没有邀请函的贵宾正在快速接近赛道', '贵宾入场 · 保持移动甩开锁定'],
        ['泳池广播：请不要争当最快的午餐，尤其被盯上以后', '午餐竞速 · 迅速变向摆脱鲨鱼'],
    ],
    [EntertainmentEventId.CANNON]: [
        ['泳池广播：看台礼炮瞄反了，建议各位先游快一点', '炮火点名 · 观察落点并横移躲避'],
        ['泳池广播：庆典礼炮提前开工，而且方向不太喜庆', '礼炮开火 · 看清落点及时横移'],
        ['泳池广播：炮台正在校准，遗憾的是拿选手当标尺', '炮台校准 · 避开标记区域继续前进'],
        ['泳池广播：看台有人按错按钮，天空即将掉下惊喜', '惊喜落水 · 观察红区横向躲避'],
        ['泳池广播：本场新增空投环节，奖品重量略微超标', '重型空投来袭 · 看落点及时变线'],
        ['泳池广播：岸边炮手表示手很稳，广播室表示不信', '炮手开工 · 观察预警并横移闪避'],
        ['泳池广播：天气预报更新，局部地区将有炮弹', '局部炮雨 · 离开落点标记区域'],
        ['泳池广播：上方发现不明重物，正在快速变得更明', '重物坠落 · 看准落点横向躲开'],
        ['泳池广播：礼炮组把庆祝和瞄准的顺序弄反了', '礼炮点名 · 观察红区并及时横移'],
        ['泳池广播：请抬头看路，不对，请看水面的落点', '炮弹来袭 · 盯住落点横移避开'],
        ['泳池广播：礼炮组申请增加气氛，结果把气氛砸进了泳池', '气氛来袭 · 观察红区及时躲避'],
        ['泳池广播：炮台正在寻找志愿者，可惜没有人举手', '随机点名 · 看清落点横向变线'],
        ['泳池广播：庆典彩排进入实弹阶段，导演本人已经撤离', '实弹彩排 · 离开标记区域'],
        ['泳池广播：空中快递即将送达，本次配送没有降落伞', '空投到达 · 观察落点及时横移'],
        ['泳池广播：水面的红圈不是领奖台，请不要主动站进去', '红圈警告 · 迅速离开落点区域'],
        ['泳池广播：炮手正在测试重力，选手负责提供测试地点', '重力测试 · 看准预警横向躲避'],
        ['泳池广播：观众想看更大的水花，礼炮组认真听取了意见', '大水花预警 · 避开炮弹落点'],
        ['泳池广播：天空出现一个感叹号，马上还会出现一个坑', '高空警告 · 观察红区及时变线'],
        ['泳池广播：几枚炮弹正在练习跳水，入水动作不计分', '炮弹跳水 · 横向避开标记区域'],
        ['泳池广播：炮台表示只是随便瞄瞄，请各位不要相信', '炮台瞄准 · 盯住落点迅速闪避'],
    ],
    [EntertainmentEventId.LITTER]: [
        ['泳池广播：看台零食吃完了，包装决定下水参赛', '垃圾入场 · 看清软硬漂浮物及时绕行'],
        ['泳池广播：清洁车走错方向，一路开到了泳池边', '赛道变脏 · 绕开硬瓶或持续划出软袋'],
        ['泳池广播：观众席开展投掷比赛，泳池不幸当靶场', '杂物落水 · 观察安全空隙及时变线'],
        ['泳池广播：几件垃圾拒绝进桶，坚持体验水上项目', '漂浮物入场 · 硬瓶要躲、软袋可穿'],
        ['泳池广播：保洁员刚转身，零食袋和瓶子集体出逃', '垃圾出逃 · 找准通路避开减速'],
        ['泳池广播：水面卫生评分下降，路线选择难度上升', '赛道异物 · 绕开硬物并挣脱软袋'],
        ['泳池广播：失物招领处表示，这批东西不用还了', '失物开漂 · 看准空隙横向绕行'],
        ['泳池广播：一只瓶子和一只袋子决定组队拦路', '软硬夹击 · 避开瓶子或强行穿袋'],
        ['泳池广播：看台补给吃得很快，包装来得更快', '包装落水 · 选择安全通道继续冲刺'],
        ['泳池广播：泳池临时增加环保课，考试方式是绕行', '环保考试 · 分清硬瓶软袋及时避让'],
        ['泳池广播：薯片袋学会了冲浪，空瓶决定一起报名', '包装参赛 · 分清软硬及时绕行'],
        ['泳池广播：回收物拒绝接受分类，现在全都漂进了赛道', '分类失败 · 绕开硬瓶并划出软袋'],
        ['泳池广播：零食已经走了，包装却选择留下继续比赛', '包装留场 · 看准安全空隙变线'],
        ['泳池广播：瓶子负责拦路，塑料袋负责把人留下', '垃圾配合 · 避开硬物并持续划出软袋'],
        ['泳池广播：垃圾桶盖只开了一秒，赛道付出了全部代价', '垃圾出逃 · 找准通路及时绕行'],
        ['泳池广播：水面卫生进入紧急状态，保洁员还在赶来的路上', '卫生预警 · 分清软硬漂浮物'],
        ['泳池广播：包装袋接管了部分泳道，但没有出示许可证', '包装占道 · 横向寻找安全通路'],
        ['泳池广播：环保小组安排了一场实践课，选手都是考生', '实践考试 · 绕开硬瓶或穿过软袋'],
        ['泳池广播：硬瓶负责碰撞，软袋负责拖慢，分工非常明确', '软硬分工 · 看清类型及时避让'],
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
