import type { AiEventConfig } from '../competitor/AiRaceConfig';

let requested = false;
export const TUTORIAL_DISTANCE = 200;
export const TUTORIAL_EXHAUST_DISTANCE = 185;
export const TUTORIAL_RUNTIME = { active: false, paused: false, finishDistance: 0, progressLimit: TUTORIAL_DISTANCE };
export const TUTORIAL_AI: AiEventConfig = {
    opponentCount: 0, minLevel: 1, maxLevel: 1, intelligence: [],
};
export function requestTutorial(): void { requested = true; }
export function consumeTutorialRequest(): boolean { const result = requested; requested = false; return result; }
