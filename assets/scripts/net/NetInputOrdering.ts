// Allocation-free monotonic sequence tracking for network hot paths.
//
// The race is an owner-predicted hybrid, not a rollback simulation. Once a newer
// packet has been applied we cannot safely replay an older unseen input afterward
// (HeldOn/HeldOff would be the most visible failure). The deliberate policy is
// therefore: accept strictly increasing sequenced packets and let owner position /
// condition snapshots correct any late packet we have to drop.

export class MonotonicSequenceTracker {
    private readonly _latest: Record<number, number> = {};
    private readonly _sequenced: Record<number, boolean> = {};

    accept(key: number, sequence: number): boolean {
        if (!Number.isFinite(key) || key < 0) {
            return false;
        }
        if (!Number.isFinite(sequence) || sequence < 0) {
            // Legacy packets are accepted only until this key has entered the new
            // sequenced protocol. This prevents a delayed old-format state from
            // rolling a modern lane back after an ordered packet was seen.
            return this._sequenced[key] !== true;
        }
        const normalized = Math.floor(sequence);
        const latest = this._latest[key];
        if (this._sequenced[key] === true && normalized <= latest) {
            return false;
        }
        this._latest[key] = normalized;
        this._sequenced[key] = true;
        return true;
    }

    latest(key: number): number {
        return this._sequenced[key] === true ? this._latest[key] : -1;
    }

    hasSequenced(key: number): boolean {
        return this._sequenced[key] === true;
    }

    clear(): void {
        for (const key of Object.keys(this._latest)) {
            delete this._latest[Number(key)];
        }
        for (const key of Object.keys(this._sequenced)) {
            delete this._sequenced[Number(key)];
        }
    }
}

export function shouldUseTransientPacketCondition(
    inputAccepted: boolean,
    eventCount: number,
    ownerStateAccepted: boolean,
    energyRatio: number,
    heartRate: number,
): boolean {
    return inputAccepted
        && eventCount > 0
        && !ownerStateAccepted
        && Number.isFinite(energyRatio)
        && energyRatio >= 0
        && Number.isFinite(heartRate)
        && heartRate >= 0;
}

export function ownerLaneMatches(expectedLane: number | undefined, packetLane: number): boolean {
    return expectedLane === undefined || expectedLane === packetLane;
}
