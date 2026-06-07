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

export const PLAYER_COMPETITOR_VISUALS: CompetitorVisualProfile[] = [
    { suitColor: color(255, 75, 94), capColor: color(35, 235, 255) },
    { suitColor: color(34, 158, 255), capColor: color(255, 239, 65) },
    { suitColor: color(47, 213, 125), capColor: color(255, 96, 209) },
    { suitColor: color(255, 128, 42), capColor: color(79, 119, 255) },
    { suitColor: color(164, 90, 255), capColor: color(102, 255, 151) },
    { suitColor: color(20, 214, 230), capColor: color(255, 255, 255) },
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

export const AI_COMPETITOR_NAMES = [
    'Liam',
    'Noah',
    'Oliver',
    'James',
    'Lucas',
    'Mason',
    'Ethan',
    'Logan',
    'Henry',
    'Jack',
    'Owen',
    'Leo',
    'Miles',
    'Caleb',
    'Dylan',
    'Finn',
];

export function randomPlayerVisualProfile(): CompetitorVisualProfile {
    const visual = PLAYER_COMPETITOR_VISUALS[Math.floor(Math.random() * PLAYER_COMPETITOR_VISUALS.length)];
    return {
        suitColor: visual.suitColor.clone(),
        capColor: visual.capColor.clone(),
    };
}

export function shuffledAiCompetitorNames(): string[] {
    const names = AI_COMPETITOR_NAMES.slice();
    for (let i = names.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = names[i];
        names[i] = names[j];
        names[j] = temp;
    }
    return names;
}

export function shuffledAiVisualProfiles(): CompetitorVisualProfile[] {
    const visuals = DEFAULT_COMPETITOR_VISUALS.map((visual) => ({
        suitColor: visual.suitColor.clone(),
        capColor: visual.capColor.clone(),
    }));
    for (let i = visuals.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = visuals[i];
        visuals[i] = visuals[j];
        visuals[j] = temp;
    }
    return visuals;
}

function color(r: number, g: number, b: number, a = 255): Color {
    return new Color(r, g, b, a);
}
