export type AICompetitorProfile = {
    difficulty: number;
    bpmOffset: number;
    power: number;
    maxSpeed: number;
    divePower: number;
    diveReaction: number;
};

export const DEFAULT_AI_PROFILES: AICompetitorProfile[] = [
    { difficulty: 0.56, bpmOffset: -22, power: 0.78, maxSpeed: 0.84, divePower: 0.44, diveReaction: 0.36 },
    { difficulty: 0.68, bpmOffset: -14, power: 0.85, maxSpeed: 0.89, divePower: 0.56, diveReaction: 0.26 },
    { difficulty: 0.8, bpmOffset: -4, power: 0.92, maxSpeed: 0.94, divePower: 0.72, diveReaction: 0.14 },
    { difficulty: 0.64, bpmOffset: -18, power: 0.82, maxSpeed: 0.87, divePower: 0.5, diveReaction: 0.3 },
    { difficulty: 0.88, bpmOffset: 4, power: 0.97, maxSpeed: 0.97, divePower: 0.84, diveReaction: 0.08 },
    { difficulty: 0.5, bpmOffset: -28, power: 0.72, maxSpeed: 0.78, divePower: 0.38, diveReaction: 0.46 },
    { difficulty: 0.82, bpmOffset: -2, power: 0.94, maxSpeed: 0.95, divePower: 0.74, diveReaction: 0.13 },
    { difficulty: 0.9, bpmOffset: 6, power: 0.99, maxSpeed: 0.98, divePower: 0.88, diveReaction: 0.07 },
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
