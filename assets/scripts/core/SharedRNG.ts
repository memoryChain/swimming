// Deterministic, seedable pseudo-random generator shared by all gameplay systems
// whose outcome must be reproducible (AI behavior, opponent roster, lane draw).
//
// WHY THIS EXISTS (future online play):
//   Frame-sync / lockstep multiplayer requires that, given the same inputs, every
//   client computes the SAME world. Any raw Math.random() call in the simulation
//   path breaks that guarantee: two phones would roll different AI decisions and
//   diverge. This module funnels all outcome-affecting randomness through ONE
//   seedable stream. At race start the host broadcasts a single 32-bit seed, every
//   client calls reseedSharedRandom(seed), and from then on the AI, the roster
//   shuffle, and the lane draw are identical everywhere.
//
//   In single-player (today) the shared stream is seeded from wall-clock + entropy
//   on construction, so each launch still feels fresh exactly like before. Purely
//   cosmetic randomness (splash foam, confetti, broadcast camera pick) intentionally
//   keeps using Math.random(): it never affects who wins, so it does not need to be
//   synchronized and is free to differ per client.
//
// ALGORITHM: mulberry32. Tiny, fast, no allocation, fully integer-deterministic
//   across JS engines (uses Math.imul + uint32 wraparound only), which is ideal for
//   the WeChat Mini Game runtime.

export class SeededRandom {
    private _seed = 0;
    private _state = 0;

    constructor(seed?: number) {
        this.seed(seed ?? SeededRandom.entropySeed());
    }

    // Non-deterministic 32-bit seed for single-player launches (mixes wall clock
    // with a Math.random draw so two launches in the same millisecond still differ).
    static entropySeed(): number {
        return (Date.now() ^ (Math.random() * 0x100000000)) >>> 0;
    }

    // Reset the stream to a fixed seed. Call this with the host-provided seed at the
    // start of a networked race so every client shares one deterministic sequence.
    seed(seed: number): void {
        const normalized = (seed >>> 0) || 0x9e3779b9;
        this._seed = normalized;
        this._state = normalized;
    }

    // The seed that produced the current sequence (for logging / race replay).
    getSeed(): number {
        return this._seed >>> 0;
    }

    // Next float in [0, 1). mulberry32 core.
    next(): number {
        this._state = (this._state + 0x6d2b79f5) >>> 0;
        let t = this._state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    // Float in [min, max).
    range(min: number, max: number): number {
        return min + this.next() * (max - min);
    }

    // Integer in [0, maxExclusive).
    int(maxExclusive: number): number {
        return Math.floor(this.next() * maxExclusive);
    }

    // Standard normal sample (Box-Muller, mean 0 / std 1).
    gaussian(): number {
        let u = 0;
        let v = 0;
        while (u === 0) {
            u = this.next();
        }
        while (v === 0) {
            v = this.next();
        }
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    // Pick one element (undefined for an empty array).
    pick<T>(items: readonly T[]): T {
        return items[this.int(items.length)];
    }

    // In-place Fisher-Yates shuffle; returns the same array for chaining.
    shuffle<T>(items: T[]): T[] {
        for (let i = items.length - 1; i > 0; i--) {
            const j = this.int(i + 1);
            const temp = items[i];
            items[i] = items[j];
            items[j] = temp;
        }
        return items;
    }
}

// The single stream every outcome-affecting system draws from.
let _shared = new SeededRandom();

// Accessor for callers that want the instance (e.g. to draw several values).
export function sharedRandom(): SeededRandom {
    return _shared;
}

// Reseed the shared stream. Networked play calls this once per race with the
// host's seed; a deterministic replay/test can call it with a fixed value.
export function reseedSharedRandom(seed: number): void {
    _shared.seed(seed);
}

// Seed that produced the current shared sequence (log it to reproduce a race).
export function getSharedRandomSeed(): number {
    return _shared.getSeed();
}

// Drop-in helpers backed by the shared stream, mirroring the small utilities the
// gameplay code used to define locally around Math.random().
export function randomFloat(): number {
    return _shared.next();
}

export function randomRange(min: number, max: number): number {
    return _shared.range(min, max);
}

export function randomInt(maxExclusive: number): number {
    return _shared.int(maxExclusive);
}

export function randomGaussian(): number {
    return _shared.gaussian();
}

export function shuffleInPlace<T>(items: T[]): T[] {
    return _shared.shuffle(items);
}
