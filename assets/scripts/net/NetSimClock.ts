// Deterministic fixed-step clock for the networked race simulation.
//
// In a networked race the simulation must NOT advance on the engine's variable
// per-frame dt (that is what makes AI drift between clients despite the shared RNG
// seed — decisions depend on accumulated dt, which differs per device). Instead the
// sim advances in FIXED steps driven by the lock-step frame clock (one step per
// received frame), so every client steps the world identically → byte-identical AI,
// zero drift, no correction needed.
//
// While `driven` is true, the sim components (Swimmer / AISwimmerController /
// RaceManager) skip their engine update() and are stepped manually by the net driver
// via stepSimulation(NET_SIM_STEP). Single-player leaves `driven` false, so the engine
// drives everything on variable dt exactly as before (zero behaviour change).

// One logical step (must match game.json lockStepOptions.gameTick = 33ms).
export const NET_SIM_STEP = 33 / 1000;

let _driven = false;

export function setNetSimDriven(driven: boolean): void {
    _driven = driven;
}

export function isNetSimDriven(): boolean {
    return _driven;
}
