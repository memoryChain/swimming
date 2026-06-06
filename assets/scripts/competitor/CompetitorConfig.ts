import { Color } from 'cc';

export type AICompetitorProfile = {
    difficulty: number;
    bpmOffset: number;
    power: number;
    maxSpeed: number;
    divePower: number;
    diveReaction: number;
};

export type CompetitorVisualProfile = {
    suitColor: Color;
    capColor: Color;
};

export const DEFAULT_COMPETITOR_VISUALS: CompetitorVisualProfile[] = [
    { suitColor: color(255, 75, 94), capColor: color(35, 235, 255) },
    { suitColor: color(26, 152, 255), capColor: color(255, 246, 64) },
    { suitColor: color(255, 205, 38), capColor: color(255, 90, 220) },
    { suitColor: color(255, 40, 58), capColor: color(255, 242, 52) },
    { suitColor: color(36, 214, 116), capColor: color(250, 250, 255) },
    { suitColor: color(168, 82, 255), capColor: color(94, 255, 130) },
    { suitColor: color(255, 126, 42), capColor: color(70, 110, 255) },
    { suitColor: color(20, 220, 230), capColor: color(255, 255, 255) },
];

export const DEFAULT_AI_PROFILES: AICompetitorProfile[] = [
    { difficulty: 0.76, bpmOffset: -8, power: 0.94, maxSpeed: 0.96, divePower: 0.62, diveReaction: 0.18 },
    { difficulty: 0.84, bpmOffset: -2, power: 0.98, maxSpeed: 0.98, divePower: 0.72, diveReaction: 0.12 },
    { difficulty: 0.9, bpmOffset: 4, power: 1.0, maxSpeed: 1.0, divePower: 0.84, diveReaction: 0.07 },
    { difficulty: 0.82, bpmOffset: -4, power: 0.97, maxSpeed: 0.98, divePower: 0.7, diveReaction: 0.14 },
    { difficulty: 0.94, bpmOffset: 8, power: 1.03, maxSpeed: 1.02, divePower: 0.9, diveReaction: 0.05 },
    { difficulty: 0.72, bpmOffset: -10, power: 0.92, maxSpeed: 0.95, divePower: 0.58, diveReaction: 0.22 },
    { difficulty: 0.88, bpmOffset: 2, power: 1.0, maxSpeed: 1.0, divePower: 0.8, diveReaction: 0.09 },
    { difficulty: 0.96, bpmOffset: 10, power: 1.05, maxSpeed: 1.03, divePower: 0.94, diveReaction: 0.04 },
];

function color(r: number, g: number, b: number, a = 255): Color {
    return new Color(r, g, b, a);
}
