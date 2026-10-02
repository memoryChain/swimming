/** 共用事件身份；独立于导演，避免计划／节奏配置之间形成运行时循环依赖。 */
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
