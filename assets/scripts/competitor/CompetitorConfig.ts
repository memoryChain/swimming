export type AICompetitorProfile = {
    difficulty: number;
    bpmOffset: number;
    power: number;
    maxSpeed: number;
    divePower: number;
    diveReaction: number;
};

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
