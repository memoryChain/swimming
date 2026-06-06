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
    { difficulty: 0.62, bpmOffset: -18, power: 0.82, maxSpeed: 0.88, divePower: 0.48, diveReaction: 0.32 },
    { difficulty: 0.74, bpmOffset: -10, power: 0.9, maxSpeed: 0.93, divePower: 0.6, diveReaction: 0.22 },
    { difficulty: 0.86, bpmOffset: 0, power: 0.98, maxSpeed: 0.98, divePower: 0.78, diveReaction: 0.1 },
    { difficulty: 0.7, bpmOffset: -14, power: 0.87, maxSpeed: 0.91, divePower: 0.55, diveReaction: 0.26 },
    { difficulty: 0.94, bpmOffset: 8, power: 1.03, maxSpeed: 1.02, divePower: 0.9, diveReaction: 0.05 },
    { difficulty: 0.54, bpmOffset: -24, power: 0.75, maxSpeed: 0.82, divePower: 0.42, diveReaction: 0.42 },
    { difficulty: 0.88, bpmOffset: 2, power: 1.0, maxSpeed: 1.0, divePower: 0.8, diveReaction: 0.09 },
    { difficulty: 0.96, bpmOffset: 10, power: 1.05, maxSpeed: 1.03, divePower: 0.94, diveReaction: 0.04 },
];

function color(r: number, g: number, b: number, a = 255): Color {
    return new Color(r, g, b, a);
}
