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

// Host-authoritative AI actions are repeated in several packets. Their identity
// must therefore be ordered independently from packet/frame sequence numbers.
// The authority seat is part of the key so a migrated host can start its own
// per-lane counter at 1 without colliding with the departed host.
export class AiActionSequenceTracker {
    private readonly _latest: Record<string, number> = {};

    latest(authorityPos: number, lane: number): number {
        const key = this.key(authorityPos, lane);
        return key ? (this._latest[key] ?? -1) : -1;
    }

    markApplied(authorityPos: number, lane: number, sequence: number): boolean {
        const key = this.key(authorityPos, lane);
        if (!key || !Number.isFinite(sequence) || sequence < 0) {
            return false;
        }
        const normalized = Math.floor(sequence);
        if (normalized <= (this._latest[key] ?? -1)) {
            return false;
        }
        this._latest[key] = normalized;
        return true;
    }

    private key(authorityPos: number, lane: number): string {
        if (!Number.isFinite(authorityPos) || authorityPos < 0
            || !Number.isFinite(lane) || lane < 0) {
            return '';
        }
        return `${Math.floor(authorityPos)}:${Math.floor(lane)}`;
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

// A loose-limb collision edge is accepted from exactly one authority:
// the human owner of that lane, or the active host for a genuine-AI lane.
export function isTrustedCollisionRagdollAuthority(
    senderPos: number,
    lane: number,
    ownedHumanLane: number | undefined,
    activeHostPos: number,
    laneIsHuman: boolean,
): boolean {
    if (!Number.isFinite(senderPos) || senderPos < 0
        || !Number.isFinite(lane) || lane < 0) {
        return false;
    }
    if (ownedHumanLane === lane) {
        return true;
    }
    return senderPos === activeHostPos && !laneIsHuman;
}
