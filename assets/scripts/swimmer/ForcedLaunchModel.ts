/** 一次受迫腾空的纯赛果轨迹；任何帧率都从固定起点和年龄求值。 */
export type ForcedLaunchStart = Readonly<{
    distance: number;
    lateral: number;
    y: number;
    surfaceY: number;
    speed: number;
    heading: number;
    duration: number;
    peakHeight: number;
    entryScale: number;
    exitScale: number;
}>;

export type ForcedLaunchSample = {
    distance: number;
    lateral: number;
    y: number;
    speed: number;
    done: boolean;
};

export function sampleForcedLaunch(start: ForcedLaunchStart, age: number,
    out: ForcedLaunchSample): ForcedLaunchSample {
    const duration = Math.max(0.01, start.duration);
    const elapsed = Math.max(0, Math.min(duration, Number.isFinite(age) ? age : 0));
    const ratio = elapsed / duration;
    const averageScale = start.entryScale + (start.exitScale - start.entryScale) * ratio * 0.5;
    const travel = Math.max(0, start.speed) * elapsed * averageScale;
    out.distance = start.distance + travel * Math.cos(start.heading);
    out.lateral = start.lateral + travel * Math.sin(start.heading);
    const rise = Math.min(1, ratio / 0.45);
    const fall = Math.max(0, Math.min(1, (ratio - 0.45) / 0.55));
    const peakY = Math.max(start.y, start.surfaceY + start.peakHeight);
    out.y = ratio <= 0.45
        ? start.y + (peakY - start.y) * (1 - (1 - rise) * (1 - rise))
        : start.surfaceY + (peakY - start.surfaceY) * (1 - fall * fall);
    out.speed = Math.max(0, start.speed) * (start.entryScale
        + (start.exitScale - start.entryScale) * ratio);
    out.done = elapsed >= duration;
    return out;
}
