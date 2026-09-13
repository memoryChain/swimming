import type { RaceTicket } from './CareerRules';

// 场景间只传本次单人入场凭据；联机入场必须清除此上下文。
let ticket: RaceTicket | null = null;
let returning = false;
export function setSoloRaceTicket(value: RaceTicket | null): void { ticket = value; }
export function getSoloRaceTicket(): RaceTicket | null { return ticket; }
export function markSoloReturn(): void { returning = true; }
export function consumeSoloReturn(): RaceTicket | null {
    const result = returning ? ticket : null; returning = false; return result;
}
