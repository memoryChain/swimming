/** 有符号推进槽及顺／逆浪姿态打包成一个整数；0 表示已清除。 */
export function giantWaveCode(speed: number, riding: boolean, opposed: boolean): number {
    const value = Math.round(Math.max(-4, Math.min(4, Number.isFinite(speed) ? speed : 0)) * 1000);
    if (value === 0 && !riding && !opposed) return 0;
    return (value + 4000) * 4 + (riding ? 1 : opposed ? 2 : 0) + 1;
}
export function giantWaveSpeedFromCode(code: number): number {
    return code > 0 ? (Math.floor((code - 1) / 4) - 4000) / 1000 : 0;
}
export function giantWaveFlagsFromCode(code: number): number { return code > 0 ? (code - 1) % 4 : 0; }
export function encodeGiantWaveSuffix(code = 0): string {
    return Number.isInteger(code) && code > 0 && code <= 32003 ? ',' + code.toString(36) : '';
}
export function decodeGiantWaveCode(text: string | undefined): number {
    if (!text || !/^[0-9a-z]{1,3}$/.test(text)) return 0;
    const code = parseInt(text, 36);
    return code <= 32003 && giantWaveFlagsFromCode(code) !== 3 ? code : 0;
}
