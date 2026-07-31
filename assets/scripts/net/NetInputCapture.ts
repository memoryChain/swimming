// Local-player input capture for lock-step (帧同步) races.
//
// COMPATIBILITY: this is a passive sink that is DISABLED by default. In single-player
// (no NetRaceController) it is never activated, so captureNetInput() is a cheap
// early-return no-op and no buffering happens. Only a networked race turns it on (via
// NetRaceController) so the game's input funnels can stay identical for both modes —
// they always call captureNetInput(), it just does nothing off-net.
//
// The game's local-player input funnel (GameFlowController) reports each discrete
// input event here as it happens; NetRaceController drains the buffer once per logical
// frame, encodes it, and uploads it. Nothing else consumes this.

import { NetInputEvent } from './NetRaceInput';

let _active = false;
let _buffer: NetInputEvent[] = [];

// Enable/disable capture. Called by NetRaceController on construction/dispose so it is
// only ever on during a networked race. Toggling clears any stale buffered events.
export function setNetInputCaptureActive(active: boolean): void {
    _active = active;
    _buffer = [];
}

export function isNetInputCaptureActive(): boolean {
    return _active;
}

// Report one local-player input event. No-op (single cheap boolean check) unless a
// networked race has activated capture, so single-player pays effectively nothing.
export function captureNetInput(event: NetInputEvent): void {
    if (!_active) {
        return;
    }
    _buffer.push(event);
}

// Take and clear the events accumulated since the last drain (one logical frame's
// worth). Returns an empty array when nothing happened.
export function drainNetInput(): NetInputEvent[] {
    if (_buffer.length === 0) {
        return [];
    }
    const events = _buffer;
    _buffer = [];
    return events;
}
