import type { LitterSnapshotSlot, LitterSnapshotState } from '../core/LitterBrawlController';

const TAG = 'L|';

export type DecodedLitterSnapshot = Readonly<{
    hostPos: number;
    state: LitterSnapshotState;
}>;

/**
 * 垃圾活动槽位比主赛况头大，单独使用可丢包的周期状态包，避免 S| 超过 1536 字节警戒线。
 * 可靠碰撞事件仍走输入帧／IN|；本包负责丢包自愈、晚加入和房主迁移。
 */
export function encodeLitterSnapshot(hostPos: number, state: LitterSnapshotState): string {
    const slots = state.slots.map(encodeSlot).join(':');
    return `${TAG}${Math.max(0, Math.floor(hostPos))},${Math.max(0, Math.floor(state.revision))},${Math.max(0, Math.round(state.elapsedSeconds * 1000))},${Math.max(0, Math.floor(state.nextWave))},${Math.max(0, Math.floor(state.spawnOrder))},${Math.max(0, Math.floor(state.randomState)).toString(16)},${Math.max(0, Math.round(state.spawnRetryRemaining * 1000))},${Math.max(0, Math.round(state.blockedWaveSeconds * 1000))},${Math.max(0, Math.floor(state.cancelledWaveCount))}#${slots}`;
}

export function decodeLitterSnapshot(payload: string): DecodedLitterSnapshot | null {
    if (typeof payload !== 'string' || payload.slice(0, TAG.length) !== TAG) return null;
    const hash = payload.indexOf('#', TAG.length);
    if (hash < 0) return null;
    const header = payload.slice(TAG.length, hash).split(',');
    if (header.length !== 9) return null;
    const hostPos = parseInt(header[0], 10);
    const revision = parseInt(header[1], 10);
    const elapsedMs = parseInt(header[2], 10);
    const nextWave = parseInt(header[3], 10);
    const spawnOrder = parseInt(header[4], 10);
    const randomState = parseInt(header[5], 16);
    const retryMs = parseInt(header[6], 10);
    const blockedMs = parseInt(header[7], 10);
    const cancelledWaveCount = parseInt(header[8], 10);
    if (![hostPos, revision, elapsedMs, nextWave, spawnOrder, randomState, retryMs, blockedMs, cancelledWaveCount]
        .every(value => Number.isSafeInteger(value) && value >= 0)) return null;
    const slots: LitterSnapshotSlot[] = [];
    const body = payload.slice(hash + 1);
    if (body) {
        for (const token of body.split(':')) {
            const slot = decodeSlot(token);
            if (!slot) return null;
            slots.push(slot);
        }
    }
    return {
        hostPos,
        state: {
            revision,
            elapsedSeconds: elapsedMs / 1000,
            nextWave,
            spawnOrder,
            randomState,
            spawnRetryRemaining: retryMs / 1000,
            blockedWaveSeconds: blockedMs / 1000,
            cancelledWaveCount,
            slots,
        },
    };
}

function encodeSlot(slot: LitterSnapshotSlot): string {
    return [
        Math.max(0, Math.floor(slot.id)),
        Math.max(0, Math.floor(slot.generation)),
        Math.max(0, Math.floor(slot.wave)),
        slot.kind === 'soft' ? 1 : 0,
        slot.phase === 'floating' ? 1 : slot.phase === 'retiring' ? 2 : 0,
        Math.max(0, Math.round(slot.age * 1000)),
        Math.round(slot.courseX * 100),
        Math.round(slot.lateral * 1000),
        Math.round(slot.anchorCourseX * 100),
        Math.round(slot.anchorLateral * 1000),
        Math.round(slot.safeCenter * 1000),
        slot.throwSide > 0 ? 1 : 0,
        Math.max(0, Math.floor(slot.visualVariant)),
        Math.max(0, Math.floor(slot.impactRevision)),
        Math.round(slot.driftPhase * 1000),
        Math.max(0, Math.floor(slot.spawnOrder)),
        Math.max(0, Math.floor(slot.insideMask)).toString(16),
        Math.round(slot.bounceAlongVelocity * 1000),
        Math.round(slot.bounceLateralVelocity * 1000),
        Math.round(slot.retireStartCourseX * 100),
        Math.round(slot.retireStartLateral * 1000),
    ].join('.');
}

function decodeSlot(token: string): LitterSnapshotSlot | null {
    const parts = token.split('.');
    if (parts.length !== 21) return null;
    const values = parts.map((value, index) => parseInt(value, index === 16 ? 16 : 10));
    if (!values.every(Number.isSafeInteger)) return null;
    const [id, generation, wave, kind, phase, ageMs, courseXCm, lateralMm,
        anchorCourseXCm, anchorLateralMm, safeCenterMm, throwSide, visualVariant,
        impactRevision, driftMrad, spawnOrder, insideMask, bounceAlongMm,
        bounceLateralMm, retireCourseXCm, retireLateralMm] = values;
    if (id < 0 || generation < 0 || wave < 0 || (kind !== 0 && kind !== 1)
        || phase < 0 || phase > 2 || ageMs < 0 || (throwSide !== 0 && throwSide !== 1)
        || visualVariant < 0 || visualVariant > 2 || impactRevision < 0
        || spawnOrder < 0 || insideMask < 0) return null;
    return {
        id,
        generation,
        wave,
        kind: kind === 1 ? 'soft' : 'rigid',
        phase: phase === 1 ? 'floating' : phase === 2 ? 'retiring' : 'falling',
        age: ageMs / 1000,
        courseX: courseXCm / 100,
        lateral: lateralMm / 1000,
        anchorCourseX: anchorCourseXCm / 100,
        anchorLateral: anchorLateralMm / 1000,
        safeCenter: safeCenterMm / 1000,
        throwSide: throwSide === 1 ? 1 : -1,
        visualVariant,
        impactRevision,
        driftPhase: driftMrad / 1000,
        spawnOrder,
        insideMask,
        bounceAlongVelocity: bounceAlongMm / 1000,
        bounceLateralVelocity: bounceLateralMm / 1000,
        retireStartCourseX: retireCourseXCm / 100,
        retireStartLateral: retireLateralMm / 1000,
    };
}
