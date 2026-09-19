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

export function entertainmentPreviewCopy(event: EntertainmentEventId, special = false): string {
    switch (event) {
        case EntertainmentEventId.STIMULANT: return '泳池广播：饮料车已翻！心跳苏打即将漂入赛道';
        case EntertainmentEventId.TIMED_BOMB: return '泳池广播：有位选手马上要收到会滴滴响的特别礼物';
        case EntertainmentEventId.WHIRLPOOL: return special
            ? '泳池广播：主排水口全开！泳池中心即将出现超级漩涡'
            : '泳池广播：排水系统情绪不稳，前方水流即将拧巴';
        case EntertainmentEventId.MINEFIELD: return '泳池广播：清洁队请假了，几颗水雷正在自由活动';
        case EntertainmentEventId.SHARK: return '泳池广播：请勿投喂——它已经自己来找饭了';
        case EntertainmentEventId.CANNON: return '泳池广播：看台礼炮瞄反了，建议各位先游快一点';
    }
}

export function entertainmentActionCopy(event: EntertainmentEventId, special = false): string {
    switch (event) {
        case EntertainmentEventId.STIMULANT: return '心跳苏打争夺开始 · 靠近瓶子抢先喝下';
        case EntertainmentEventId.TIMED_BOMB: return '定时炸弹已发放 · 贴近对手传出';
        case EntertainmentEventId.WHIRLPOOL: return special
            ? '超级漩涡出现 · 远离核心或贴外圈冲浪'
            : '漩涡冲浪开始 · 贴外圈顺流借力';
        case EntertainmentEventId.MINEFIELD: return '漂流水雷入场 · 注意横向避让';
        case EntertainmentEventId.SHARK: return '鲨鱼巡场开始 · 观察锁定及时变向';
        case EntertainmentEventId.CANNON: return '炮火点名开始 · 注意落点并横移';
    }
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
        } else if (this.phase === EntertainmentDirectorPhase.ACTIVE) {
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
        this.events.length = authoritativeEvents.length;
        for (let index = 0; index < authoritativeEvents.length; index++) {
            this.events[index] = authoritativeEvents[index];
        }
        this.revision = state.revision;
        this.phase = state.phase;
        this.eventIndex = state.eventIndex;
        this.remainingSeconds = state.remainingSeconds;
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
        if (event !== null && this.phase === EntertainmentDirectorPhase.ACTIVE
            && this.activationSerial > previousActivationSerial) transition.activatedEvent = event;
        if (this.activationSerial > previousActivationSerial
            && this.phase !== EntertainmentDirectorPhase.ACTIVE) {
            transition.recoveredEvent = this.lastActivatedEvent;
        }
        if (previousPhase === EntertainmentDirectorPhase.ACTIVE
            && (this.phase !== previousPhase || previousIndex !== this.eventIndex
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
        runtimeActiveEvent = this.phase === EntertainmentDirectorPhase.ACTIVE ? this.currentEvent() : null;
    }

    private clearTransition(): EntertainmentDirectorTransition {
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

function validDirectorState(state: EntertainmentDirectorState): boolean {
    return !!state
        && Number.isSafeInteger(state.revision) && state.revision >= 0
        && Number.isSafeInteger(state.phase) && state.phase >= 0 && state.phase <= EntertainmentDirectorPhase.COMPLETE
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
