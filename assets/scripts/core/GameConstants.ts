export const RACE_DISTANCE = 100;
export const MAX_SPEED = 3.2;
export const BASE_SPEED = 0.8;
export const STROKE_SPEED = 2.65;
export const MISS_SPEED_MULTIPLIER = 0.5;
export const SPEED_DECAY = 0.62;
export const SPEED_LERP = 6;

export const TARGET_BPM = 156;
export const TARGET_INTERVAL = 60 / TARGET_BPM;
export const PERFECT_WINDOW = 0.08;
export const GOOD_WINDOW = 0.18;
export const RHYTHM_WINDOW = 0.52;

export const MAX_COMBO_BONUS = 1.55;
export const COMBO_PERFECT_BONUS = 0.045;
export const COMBO_GOOD_BONUS = 0.015;
export const COMBO_MISS_PENALTY = 3;

export const COUNTDOWN_SECONDS = 5;
export const AI_DIFFICULTY = 0.86;
export const AI_BPM_VARIANCE = 12;

export const PIXELS_PER_METER = 10.8;
export const PLAYER_LANE_Y = -96;
export const AI_LANE_Y = 96;

export enum Rating {
    PERFECT = 'perfect',
    GOOD = 'good',
    MISS = 'miss',
}

export enum GameState {
    READY = 'ready',
    COUNTDOWN = 'countdown',
    DIVING = 'diving',
    RACING = 'racing',
    FINISHED = 'finished',
}

export enum StrokeType {
    ARM = 'arm',
    LEG = 'leg',
}
