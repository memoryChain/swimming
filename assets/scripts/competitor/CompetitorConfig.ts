import { Color } from 'cc';

export type AICompetitorProfile = {
    difficulty: number;
    bpmOffset: number;
    power: number;
    maxSpeed: number;
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
    { difficulty: 0.86, bpmOffset: 0, power: 1.02, maxSpeed: 1.0 },
    { difficulty: 0.93, bpmOffset: 10, power: 1.12, maxSpeed: 1.04 },
    { difficulty: 0.98, bpmOffset: 20, power: 1.24, maxSpeed: 1.08 },
    { difficulty: 0.92, bpmOffset: 8, power: 1.08, maxSpeed: 1.03 },
    { difficulty: 0.99, bpmOffset: 24, power: 1.28, maxSpeed: 1.1 },
    { difficulty: 0.82, bpmOffset: -2, power: 1.0, maxSpeed: 1.0 },
    { difficulty: 0.96, bpmOffset: 16, power: 1.18, maxSpeed: 1.06 },
    { difficulty: 1.0, bpmOffset: 28, power: 1.32, maxSpeed: 1.12 },
];

function color(r: number, g: number, b: number, a = 255): Color {
    return new Color(r, g, b, a);
}
