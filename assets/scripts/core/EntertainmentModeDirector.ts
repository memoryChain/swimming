import { SeededRandom } from './SharedRNG';
import { WHIRLPOOL_SUPER_CHANCE } from './WhirlpoolBrawlRules';

export const enum EntertainmentEventId {
    STIMULANT = 0,
    TIMED_BOMB = 1,
    WHIRLPOOL = 2,
    MINEFIELD = 3,
    SHARK = 4,
    CANNON = 5,
}

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
const ENTERTAINMENT_COPY_VARIANT_STEPS = [1, 3, 7, 9] as const;
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
};
const PERSISTENT_EVENTS_MASK = eventBit(EntertainmentEventId.STIMULANT)
    | eventBit(EntertainmentEventId.WHIRLPOOL)
    | eventBit(EntertainmentEventId.MINEFIELD)
    | eventBit(EntertainmentEventId.SHARK)
    | eventBit(EntertainmentEventId.CANNON);

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
    }
}

type EntertainmentBroadcastCopy = readonly [preview: string, action: string];

export const ENTERTAINMENT_BROADCAST_VARIANT_COUNT = 10;

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
];

/**
 * 广播属于表现层，但仍用比赛种子派生独立随机流，让联机各端显示一致。
 * 与 10 互质的步长保证同一事件连续取前十次时不重复，也不消费玩法 RNG。
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
    return copies[entertainmentBroadcastVariantIndex(event, seed, activationSerial, special)][0];
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

    constructor(seed: number, raceDistance = 200) {
        this.seed = Number.isFinite(seed) ? seed >>> 0 : 0;
        this.raceDistance = Number.isFinite(raceDistance) ? Math.max(1, raceDistance) : 200;
        this.events = [...buildEntertainmentEventOrder(this.seed, this.raceDistance)];
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

export function buildEntertainmentEventOrder(seed: number, raceDistance = 200): readonly EntertainmentEventId[] {
    const random = new SeededRandom(((Number.isFinite(seed) ? seed : 0) ^ 0x656e7465) >>> 0);
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
                && state.lastActivatedEvent <= EntertainmentEventId.CANNON))
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
    const fieldCount = events.filter(event => event === EntertainmentEventId.WHIRLPOOL
        || event === EntertainmentEventId.MINEFIELD).length;
    const contestCount = events.filter(event => event === EntertainmentEventId.STIMULANT
        || event === EntertainmentEventId.TIMED_BOMB).length;
    const assaultCount = events.filter(event => event === EntertainmentEventId.SHARK
        || event === EntertainmentEventId.CANNON).length;
    return fieldCount >= 1 && contestCount >= 1 && assaultCount >= 1
        && !isFieldEvent(events[events.length - 1]);
}

function isFieldEvent(event: EntertainmentEventId): boolean {
    return event === EntertainmentEventId.WHIRLPOOL || event === EntertainmentEventId.MINEFIELD;
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
