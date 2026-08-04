// Networked-race frame-sync controller.
//
// STEP 2 · slice 1 (current): real per-frame INPUT capture + verification. Each
// logical tick it drains the local player's discrete input events (arm stroke / kick /
// held / dive) captured this frame, encodes them, and uploads them via uploadFrame.
// onSyncFrame decodes every member's payload and shows it on the debug HUD so we can
// confirm both devices exchange REAL inputs (not just heartbeats). It still does NOT
// drive any swimmer — the race runs locally on each client. Applying decoded remote
// inputs to swimmers + fixed-step deterministic advance come in later slices.
//
// COMPATIBILITY: only ever constructed for a networked race (GameManager gates on
// _netSession). Single-player never creates this and never activates input capture.

import { Label, Node, UITransform } from 'cc';
import { INetRoom, NetSyncFrame, NetRoomInfo } from './INetRoom';
import { netRoom } from './NetManager';
import { NetRaceSessionData } from './NetRaceSession';
import { drainNetInput, setNetInputCaptureActive } from './NetInputCapture';
import { decodeInputFrame, encodeInputFrame, NetInputEvent } from './NetRaceInput';
import { decodeRaceSnapshot, encodeRaceSnapshot, decodeSelfSnapshot, encodeSelfSnapshot, NetSnapshotEntry } from './NetRaceSnapshot';
import { decodeRaceResult, encodeRaceResult, NetResultEntry } from './NetRaceResult';
import { RemoteSwimmerController } from '../entity/RemoteSwimmerController';
import { makeLabel, makeRect, makeUiNode, uiColor } from '../ui/RuntimeUiFactory';

// Logical frame interval (must match game.json lockStepOptions.gameTick = 33ms).
const LOGICAL_FRAME_SECONDS = 33 / 1000;

// Host migration: the host broadcasts a snapshot every ~150ms. If a client sees NO
// snapshot from the current host for this long, it treats the host as gone.
const HOST_SILENCE_MS = 2500;
// To avoid every survivor promoting at once, each client waits an extra delay
// proportional to its own seat (posNum) before taking over. The LOWEST surviving
// posNum reaches its threshold first and starts broadcasting again; everyone else
// then receives its snapshots and stands down. Deterministic outcome, no negotiation.
const HOST_TAKEOVER_STAGGER_MS = 800;

// A self-position report (P|) older than this is treated as missing (dropped by the
// broadcast rate limit), so its swimmer falls back to the host snapshot rather than
// freezing at a stale position.
const SELF_SNAPSHOT_FRESH_MS = 800;

// Broadcast message tags for mixed / broadcast-only sync (used when the reliable
// lock-step frame channel can't reach a peer, e.g. an iOS high-performance+ player
// whose frame sync is disabled while the other player is on Android).
//   NB| = "need broadcast": I can't use the frame channel, please broadcast your state.
//   IN| = an input-event frame ridden over broadcast so remote copies still animate.
const NEED_BROADCAST_TAG = 'NB|';
const BROADCAST_INPUT_TAG = 'IN|';

// Per-frame input logging. OFF by default: it fires for every non-empty input frame
// (dozens/sec during racing) and each console.log is very expensive with vConsole open
// (it appends a DOM node + reflows), which showed up as heavy in-race lag. Flip to true
// only when debugging the frame channel.
const NET_FRAME_LOG = false;

// The debug HUD is repainted from both onSyncFrame (~30/s) and tick (~30/s). Setting
// Label.string rebuilds the text mesh, so cap repaints to this interval (~6/s) — plenty
// for a status readout, and it keeps the hot network path cheap.
const HUD_REPAINT_INTERVAL_MS = 160;

export class NetRaceController {
    private readonly _net: INetRoom;
    private _accum = 0;
    private _sentFrames = 0;
    private _recvFrames = 0;
    private _disposed = false;
    // In-race debug HUD so sync state is visible without the console.
    private _hudRoot: Node | null = null;
    private _hudLabel: Label | null = null;
    private _hudLastPaintAt = 0;
    private _lastFrameId = 0;
    private _lastItems: string[] = [];
    private readonly _peerLatest: Record<number, number> = {};
    // Most recent decoded input tokens per member pos (for the HUD / verification).
    private readonly _peerLastInput: Record<number, string> = {};
    // Count of non-empty input frames received per member pos.
    private readonly _peerInputCount: Record<number, number> = {};
    // Remote-human swimmers keyed by their seat (posNum). Decoded input for a pos is
    // replayed onto its controller. Registered by GameManager after the roster builds.
    private readonly _remoteByPos: Record<number, RemoteSwimmerController> = {};
    // Latest authoritative position snapshot from the host, keyed by lane. Clients ease
    // their swimmers toward these. Empty on the host (it IS the authority).
    private _snapshotTargets: NetSnapshotEntry[] = [];
    // Latest OWN-authoritative self-position report per lane (from that human's own
    // client), with arrival time so a stale one (P| dropped) is ignored and we fall back
    // to the host snapshot. Used to catch remote human copies up to their owner's view.
    private readonly _selfSnapshots: Record<number, { entry: NetSnapshotEntry; time: number }> = {};
    // This client's own player lane, so we ignore the echo of our own self-position.
    private _playerLaneForSelf = -1;
    // Previous snapshot + arrival times (ms), used to estimate each lane's velocity so
    // the client can EXTRAPOLATE the host position forward and cancel broadcast latency
    // (otherwise every remote/AI swimmer renders ~1 RTT behind, diverging from the
    // locally-predicted player).
    private _prevSnapshot: NetSnapshotEntry[] = [];
    private _snapshotTime = 0;
    private _prevSnapshotTime = 0;
    // Authoritative final placement from the host (null until the race ends).
    private _authResult: NetResultEntry[] | null = null;
    // Diagnostics: how many snapshots / results this client has sent + received, plus a
    // per-lane local-vs-host distance line fed by GameManager, shown on the debug HUD.
    private _snapSent = 0;
    private _snapRecv = 0;
    private _resultSent = 0;
    private _resultRecv = 0;
    private _diagText = '';
    // Notified once when the authoritative final result arrives (clients).
    private _authResultListener: ((result: NetResultEntry[]) => void) | null = null;
    // Synchronized countdown start: members that have reported their pre-race showcase
    // ready (host tracks all; clients just broadcast). GO fires once everyone is ready.
    private readonly _readyPoses = new Set<number>();
    private _raceReadyReported = false;
    private _countdownStarted = false;
    private _countdownStartListener: (() => void) | null = null;
    private _goTimeoutHandle: any = null;
    // Notified when a member quits mid-race (Q| broadcast) so its swimmer is retired.
    private _playerQuitListener: ((pos: number) => void) | null = null;
    // Host migration state. `_isHost` starts from the session but can flip: a client
    // promotes itself if the host goes silent, and a self-promoted host steps back down
    // if a lower-pos (higher-priority) host appears. `_activeHostPos` is the seat of the
    // host we currently trust (MAX_SAFE_INTEGER until the first snapshot on a client).
    // `_lastSnapshotAt` is when we last heard from that host (0 = not yet started).
    private _isHost: boolean;
    private _activeHostPos: number;
    private _lastSnapshotAt = 0;
    // Mixed-environment sync flags. `_localFrameSyncDown` latches once our own frame
    // channel is observed dead; `_peerNeedsBroadcast` latches when a peer announces (NB|)
    // that theirs is. Either forces broadcast-based position/input sync.
    private _localFrameSyncDown = false;
    private _peerNeedsBroadcast = false;
    private _lastNeedBroadcastAt = 0;
    private _needBroadcastCount = 0;

    constructor(private readonly _session: NetRaceSessionData) {
        this._net = netRoom();
        this._isHost = _session.localIsHost;
        // The host trusts itself; a client trusts nobody until a snapshot arrives.
        this._activeHostPos = _session.localIsHost ? _session.localPos : Number.MAX_SAFE_INTEGER;
        // Turn on local-player input capture for the duration of this networked race.
        setNetInputCaptureActive(true);
        this._net.setCallbacks({
            onSyncFrame: (frame) => this.onSyncFrame(frame),
            onBroadcast: (msg) => this.onBroadcast(msg),
            onRoomInfoChange: (info) => this.onRoomInfoChange(info),
            onDisconnect: () => console.warn('[NetRace] disconnected mid-game'),
            onGameEnd: () => console.log('[NetRace] game end'),
        });
        console.log(
            `[NetRace] start localPos=${_session.localPos} host=${_session.localIsHost} ` +
            `seed=${_session.seed} members=${_session.members.length}`,
        );
    }

    get isHost(): boolean {
        return this._isHost;
    }

    // Whether the reliable lock-step frame channel works. When false (e.g. iOS
    // high-performance+ disables GameServerManager frame sync), the game must sync via
    // broadcast() only: human self-positions go out as P| instead of riding uploadFrame.
    get frameSyncAvailable(): boolean {
        return this._net.isFrameSyncAvailable();
    }

    // True when race state must be synced over broadcast rather than the lock-step frame
    // channel: EITHER our own frame sync is down (we can't receive frames) OR a peer
    // announced theirs is (they can't receive our frames). In a mixed room (one iOS
    // high-perf+ + one Android) the two ends otherwise talk on different channels and
    // never hear each other. Drives P| self-position + IN| input broadcasts.
    get broadcastSyncRequired(): boolean {
        return this._localFrameSyncDown || this._peerNeedsBroadcast;
    }

    // If our own frame channel is unavailable, periodically tell the room (NB|) so peers
    // WITH a working frame channel (e.g. Android, no high-perf mode) also start
    // broadcasting their position/inputs — otherwise their frame-only data never reaches
    // us. Cheap + rate-limited; a no-op when our frame sync works. Called every frame by
    // GameManager (before the racing gate) so the switch happens as early as possible.
    maybeAnnounceBroadcastNeed(): void {
        if (this._disposed || !this._net.isSupported()) {
            return;
        }
        if (this._net.isFrameSyncAvailable()) {
            return;
        }
        this._localFrameSyncDown = true;
        const now = Date.now();
        // Announce the first several times quickly so peers switch to broadcast ASAP and
        // stop stalling in lock-step waiting for our frames that will never come (that
        // wait is the pre-countdown jank on the other client). Then settle to a slow
        // keep-alive rate. First call fires immediately (_lastNeedBroadcastAt = 0).
        const interval = this._needBroadcastCount < 6 ? 300 : 1500;
        if (now - this._lastNeedBroadcastAt >= interval) {
            this._lastNeedBroadcastAt = now;
            this._needBroadcastCount++;
            this._net.broadcast(`${NEED_BROADCAST_TAG}${this._session.localPos}`);
        }
    }

    // The seat (posNum) of the host this client currently defers to. For diagnostics.
    get activeHostPos(): number {
        return this._activeHostPos;
    }

    // Called every frame by GameManager while the race is live. If the current host has
    // gone silent past this client's staggered threshold, promote this client to host so
    // the race keeps a single authority (position/heading correction + final result)
    // even if the original host drops. No-op for the current host or once the race ends.
    checkHostMigration(raceActive: boolean): void {
        if (this._disposed || this._isHost || !raceActive) {
            return;
        }
        const now = Date.now();
        if (this._lastSnapshotAt === 0) {
            // Haven't heard from the host yet; start the clock so we don't promote
            // instantly before the first snapshot has had time to arrive.
            this._lastSnapshotAt = now;
            return;
        }
        const threshold = HOST_SILENCE_MS + this._session.localPos * HOST_TAKEOVER_STAGGER_MS;
        if (now - this._lastSnapshotAt > threshold) {
            this.promoteToHost();
        }
    }

    // This client becomes the authoritative host (the previous one went silent). Its
    // local simulation is already a full, valid race view, so it can start broadcasting
    // snapshots + own the final result immediately (both gate on isHost).
    private promoteToHost(): void {
        this._isHost = true;
        this._activeHostPos = this._session.localPos;
        this._lastSnapshotAt = Date.now();
        console.warn(`[NetRace] host silent — pos=${this._session.localPos} taking over as host`);
    }

    // Reconcile who the authoritative host is from an incoming snapshot's hostPos.
    // Rule (deterministic): the LOWEST posNum wins. Defer to any lower-pos host; adopt a
    // higher-pos host only if our current one has gone silent (it dropped). A
    // self-promoted host steps back down if a lower-pos host is (still) alive.
    private adoptHostFromSnapshot(hostPos: number): void {
        const now = Date.now();
        if (hostPos < this._activeHostPos) {
            this._activeHostPos = hostPos;
            this._lastSnapshotAt = now;
            if (this._isHost && hostPos < this._session.localPos) {
                this._isHost = false;
            }
        } else if (hostPos === this._activeHostPos) {
            this._lastSnapshotAt = now;
        } else if (now - this._lastSnapshotAt > HOST_SILENCE_MS) {
            // Lower-priority sender, but our better host has gone silent — accept it.
            this._activeHostPos = hostPos;
            this._lastSnapshotAt = now;
            if (this._isHost && hostPos < this._session.localPos) {
                this._isHost = false;
            }
        }
    }

    // SECOND host-drop signal (belt-and-braces alongside snapshot-silence). The room
    // service reports membership changes; if the seat we currently trust as host is no
    // longer in the member list, the host has left. Because every client sees the same
    // roster, the LOWEST present seat can promote itself IMMEDIATELY and deterministically
    // (exactly one promoter, no stagger wait). Snapshot-silence remains the fallback for
    // when this event doesn't fire (e.g. mid frame-sync the roster isn't pushed).
    private onRoomInfoChange(info: NetRoomInfo): void {
        if (this._disposed || this._isHost) {
            return;
        }
        // Only trust a roster that actually lists valid seats AND includes us — a partial
        // or empty push (common mid-game) must not trigger a bogus takeover.
        const present: number[] = [];
        for (const m of info.members || []) {
            if (typeof m.pos === 'number' && m.pos >= 0) {
                present.push(m.pos);
            }
        }
        if (present.length === 0 || present.indexOf(this._session.localPos) < 0) {
            return;
        }
        // Haven't locked onto a host yet (no snapshot received) — nothing to migrate from.
        if (this._activeHostPos === Number.MAX_SAFE_INTEGER) {
            return;
        }
        // Host still present? Then nothing to do.
        if (present.indexOf(this._activeHostPos) >= 0) {
            return;
        }
        // Host is gone. The lowest present seat takes over now; higher seats defer (and
        // stand down as soon as the new host's snapshots arrive). If the new lowest also
        // drops, the next onRoomInfoChange / snapshot-silence handles it.
        let lowest = present[0];
        for (const p of present) {
            if (p < lowest) {
                lowest = p;
            }
        }
        if (this._session.localPos === lowest) {
            console.warn(`[NetRace] host seat=${this._activeHostPos} left room — pos=${lowest} taking over`);
            this.promoteToHost();
        }
    }

    // Host: encode + broadcast the authoritative position snapshot.
    sendSnapshot(entries: NetSnapshotEntry[]): void {
        if (this._disposed || !this._net.isSupported()) {
            return;
        }        this._snapSent++;        this._net.broadcast(encodeRaceSnapshot(this._session.localPos, entries));
    }

    // Client: the most recent authoritative snapshot (empty until one arrives).
    get snapshotTargets(): NetSnapshotEntry[] {
        return this._snapshotTargets;
    }

    // Broadcast THIS client's own player position so every other client can catch its
    // on-screen copy up to how its owner sees it (owner predicts locally = the truth).
    sendSelfSnapshot(entry: NetSnapshotEntry): void {
        if (this._disposed || !this._net.isSupported()) {
            return;
        }
        this._net.broadcast(encodeSelfSnapshot(entry));
    }

    // The latest own-authoritative self-position for a lane (from that human's client),
    // or null if none received recently. Stale reports (P| dropped by the broadcast rate
    // limit) are ignored so the caller falls back to the host snapshot instead of
    // freezing that swimmer at an old position.
    selfSnapshot(lane: number): NetSnapshotEntry | null {
        const rec = this._selfSnapshots[lane];
        if (!rec || Date.now() - rec.time > SELF_SNAPSHOT_FRESH_MS) {
            return null;
        }
        return rec.entry;
    }

    // Tell the controller our own player's lane so it drops the echo of our own
    // self-position broadcast (we never catch up our own predicted player).
    setLocalPlayerLane(lane: number): void {
        this._playerLaneForSelf = lane;
    }

    // Client: the host's position for a lane, EXTRAPOLATED to "now" using the velocity
    // estimated from the last two snapshots (cancels broadcast latency + the gap
    // between snapshots). Returns null if the lane has no snapshot yet.
    sampleTarget(lane: number): { distance: number; lateral: number } | null {
        const cur = this._snapshotTargets.find((e) => e.lane === lane);
        if (!cur) {
            return null;
        }
        const prev = this._prevSnapshot.find((e) => e.lane === lane);
        const dtSnap = (this._snapshotTime - this._prevSnapshotTime) / 1000;
        let vel = 0;
        let velLat = 0;
        if (prev && dtSnap > 0.01 && dtSnap < 1) {
            vel = (cur.distance - prev.distance) / dtSnap;
            velLat = (cur.lateral - prev.lateral) / dtSnap;
        }
        // Clamp velocity + how far we extrapolate so noisy snapshots can't overshoot.
        vel = Math.max(-6, Math.min(6, vel));
        velLat = Math.max(-3, Math.min(3, velLat));
        // Age since the snapshot + a small fixed allowance for one-way broadcast latency.
        const age = Math.min(0.4, (Date.now() - this._snapshotTime) / 1000 + 0.08);
        return {
            distance: cur.distance + vel * age,
            lateral: cur.lateral + velLat * age,
        };
    }

    // Host: broadcast the authoritative final placement (once, at race end).
    sendResult(entries: NetResultEntry[]): void {
        if (this._disposed || !this._net.isSupported()) {
            return;
        }
        this._resultSent++;
        this._net.broadcast(encodeRaceResult(entries));
    }

    // Announce that THIS client is leaving the race mid-way, so the others retire our
    // swimmer immediately instead of waiting for the straggler countdown to DNF a body
    // that has simply frozen. Best-effort (broadcast can drop) + we're leaving right
    // after, so fire a few times; the straggler countdown is the ultimate fallback.
    broadcastQuit(): void {
        if (this._disposed || !this._net.isSupported()) {
            return;
        }
        const msg = `Q|${this._session.localPos}`;
        this._net.broadcast(msg);
        this._net.broadcast(msg);
        this._net.broadcast(msg);
    }

    // Be notified when a member quits mid-race (its seat pos). Set once by GameManager.
    setPlayerQuitListener(listener: ((pos: number) => void) | null): void {
        this._playerQuitListener = listener;
    }

    // Client: the authoritative final placement, or null if not received yet.
    get authResult(): NetResultEntry[] | null {
        return this._authResult;
    }

    // Client: be notified once when the authoritative final result arrives. If it has
    // already arrived, fires immediately.
    setAuthResultListener(listener: ((result: NetResultEntry[]) => void) | null): void {
        this._authResultListener = listener;
        if (listener && this._authResult) {
            listener(this._authResult);
        }
    }

    private onBroadcast(msg: string): void {
        const snapshot = decodeRaceSnapshot(msg);
        if (snapshot) {
            this._snapRecv++;
            // Reconcile authority first (may demote a self-promoted host); then, only if
            // we are NOT the host, adopt the position targets. Ignoring our own echo this
            // way keeps a live host from correcting itself toward a stale broadcast.
            this.adoptHostFromSnapshot(snapshot.hostPos);
            if (!this._isHost) {
                this._prevSnapshot = this._snapshotTargets;
                this._prevSnapshotTime = this._snapshotTime;
                this._snapshotTargets = snapshot.entries;
                this._snapshotTime = Date.now();
            }
            this.refreshHud();
            return;
        }
        const self = decodeSelfSnapshot(msg);
        if (self) {
            // Own-authoritative position from another human's client; keep the latest
            // per lane (ignore our own echo — we don't catch up our own player).
            if (self.lane !== this._playerLaneForSelf) {
                this._selfSnapshots[self.lane] = { entry: self, time: Date.now() };
            }
            return;
        }
        // A peer can't use the lock-step frame channel (e.g. iOS high-performance+). Even
        // if OUR frame sync works, switch to broadcasting our position/inputs so that peer
        // can see us (its frame-only path can't reach us either, but broadcast can).
        if (msg.slice(0, NEED_BROADCAST_TAG.length) === NEED_BROADCAST_TAG) {
            this._peerNeedsBroadcast = true;
            return;
        }
        // Input events ridden over broadcast for mixed / broadcast-only sync: replay onto
        // the remote human for this seat so it animates (same as onSyncFrame does).
        if (msg.slice(0, BROADCAST_INPUT_TAG.length) === BROADCAST_INPUT_TAG) {
            const decoded = decodeInputFrame(msg.slice(BROADCAST_INPUT_TAG.length));
            if (decoded.senderPos >= 0
                && decoded.senderPos !== this._session.localPos
                && decoded.events.length > 0) {
                this._remoteByPos[decoded.senderPos]?.applyEvents(decoded.events);
            }
            return;
        }
        const result = decodeRaceResult(msg);
        if (result) {
            this._resultRecv++;
            this._authResult = result;
            this._authResultListener?.(result);
            this.refreshHud();
            return;
        }
        // Synchronized countdown start.
        if (msg === 'GO|') {
            this.triggerCountdownFromGo();
            return;
        }
        // A member quit mid-race: retire its swimmer on this client.
        if (msg.slice(0, 2) === 'Q|') {
            const pos = parseInt(msg.slice(2), 10);
            if (Number.isFinite(pos) && pos !== this._session.localPos) {
                this._playerQuitListener?.(pos);
            }
            return;
        }
        if (msg.slice(0, 3) === 'CR|' && this.isHost) {
            const pos = parseInt(msg.slice(3), 10);
            if (Number.isFinite(pos)) {
                this._readyPoses.add(pos);
                this.maybeStartCountdown();
            }
        }
    }

    // Set once by GameManager: starts the local countdown when GO fires.
    setCountdownStartListener(listener: (() => void) | null): void {
        this._countdownStartListener = listener;
    }

    // Called when this client's pre-race showcase is ready. The host tracks all-ready
    // and issues GO; a client just reports itself ready and waits for GO. Idempotent.
    reportRaceReady(): void {
        if (this._raceReadyReported) {
            return;
        }
        this._raceReadyReported = true;
        if (this.isHost) {
            this._readyPoses.add(this._session.localPos);
            // Fallback: don't wait forever for a stuck member — GO after a few seconds.
            if (!this._goTimeoutHandle) {
                this._goTimeoutHandle = setTimeout(() => this.broadcastGo(), 5000);
            }
            this.maybeStartCountdown();
        } else {
            this._net.broadcast(`CR|${this._session.localPos}`);
            // Fallback: GO is only issued by the host. If the host drops (or its GO /
            // our CR is dropped) before GO arrives, a client would otherwise wait
            // forever and hang at the pre-race screen. Start the countdown locally
            // after a grace period (longer than the host's own 5s GO fallback) so a
            // dropped host can never lock the client out of the race.
            if (!this._goTimeoutHandle) {
                this._goTimeoutHandle = setTimeout(() => this.triggerCountdownFromGo(), 7000);
            }
        }
    }

    private maybeStartCountdown(): void {
        // Host only: have all room members reported ready?
        const allReady = this._session.members.every((m) => m.pos < 0 || this._readyPoses.has(m.pos));
        if (allReady) {
            this.broadcastGo();
        }
    }

    private broadcastGo(): void {
        if (this._countdownStarted) {
            return;
        }
        this._countdownStarted = true;
        if (this._goTimeoutHandle) {
            clearTimeout(this._goTimeoutHandle);
            this._goTimeoutHandle = null;
        }
        this._net.broadcast('GO|');
        this._countdownStartListener?.();
    }

    private triggerCountdownFromGo(): void {
        if (this._countdownStarted) {
            return;
        }
        this._countdownStarted = true;
        if (this._goTimeoutHandle) {
            clearTimeout(this._goTimeoutHandle);
            this._goTimeoutHandle = null;
        }
        this._countdownStartListener?.();
    }

    // Called once per rendered frame. Emits at most one logical frame per tick window
    // so upload rate tracks the 33ms lock-step cadence rather than the render rate.
    // `selfPos` (if given) is this client's own authoritative position, ridden along on
    // the reliable frame channel so remote copies catch up without best-effort broadcasts.
    tick(dt: number, selfPos: NetSnapshotEntry | null = null): void {
        if (this._disposed || !this._net.isSupported()) {
            return;
        }
        let sentThisTick = false;
        this._accum += dt;
        // Guard against huge dt after a stall so we don't burst-upload hundreds.
        if (this._accum > LOGICAL_FRAME_SECONDS * 6) {
            this._accum = LOGICAL_FRAME_SECONDS;
        }
        while (this._accum >= LOGICAL_FRAME_SECONDS) {
            this._accum -= LOGICAL_FRAME_SECONDS;
            this._sentFrames++;
            // Real per-frame payload: this member's captured input events for the
            // frame (empty payload "<pos>|" when the player did nothing this frame —
            // every client must upload every frame to keep the lock-step cadence) plus
            // its own position so peers can reliably catch up to it.
            const events: NetInputEvent[] = drainNetInput();
            if (!this.broadcastSyncRequired) {
                // Fully frame-synced room: input + self-position ride the reliable
                // lock-step frame channel (zero extra broadcast traffic).
                this._net.uploadFrame(encodeInputFrame(this._session.localPos, events, selfPos));
            } else if (events.length > 0) {
                // Mixed / broadcast-only: a peer can't use frame sync, so do NOT
                // participate in lock-step at all. Uploading frames into a session a peer
                // never feeds makes WeChat's frame-sync wait for the missing member every
                // tick and stall the whole frame loop — that is the "laggy, waiting for the
                // host" jank on the other client. Ride inputs over broadcast instead;
                // self-position goes out as P| from updateNetRaceSync.
                this._net.broadcast(BROADCAST_INPUT_TAG + encodeInputFrame(this._session.localPos, events));
            }
            sentThisTick = true;
        }
        if (sentThisTick) {
            this.refreshHud();
        }
    }

    // Register a remote-human swimmer so this member's decoded input is replayed onto
    // it. Called by GameManager once the networked roster is built.
    registerRemote(pos: number, controller: RemoteSwimmerController): void {
        if (pos < 0 || !controller) {
            return;
        }
        this._remoteByPos[pos] = controller;
    }

    private onSyncFrame(frame: NetSyncFrame): void {
        this._recvFrames++;
        this._lastFrameId = frame.frameId;
        this._lastItems = frame.items;
        for (const item of frame.items) {
            const decoded = decodeInputFrame(item);
            if (decoded.senderPos < 0) {
                continue;
            }
            this._peerLatest[decoded.senderPos] = frame.frameId;
            // Drive the remote human for this seat (never the local player's own seat).
            if (decoded.senderPos !== this._session.localPos && decoded.events.length > 0) {
                this._remoteByPos[decoded.senderPos]?.applyEvents(decoded.events);
            }
            // Own-authoritative position ridden along on the reliable frame channel:
            // record the latest per lane (skip our own echo) so remote copies catch up.
            if (decoded.self && decoded.self.lane !== this._playerLaneForSelf) {
                this._selfSnapshots[decoded.self.lane] = { entry: decoded.self, time: Date.now() };
            }
            if (decoded.events.length > 0) {
                this._peerInputCount[decoded.senderPos] = (this._peerInputCount[decoded.senderPos] ?? 0) + 1;
                if (NET_FRAME_LOG) {
                    this._peerLastInput[decoded.senderPos] = decoded.events
                        .map((e) => (e.kind === 'r' ? `r${Math.round((e.power ?? 0) * 100)}` : `${e.kind}${e.side ?? ''}`))
                        .join(',');
                    // Log real inputs as they arrive so we can verify both directions.
                    console.log(
                        `[NetRace] frame#${frame.frameId} pos${decoded.senderPos} input=${this._peerLastInput[decoded.senderPos]}`,
                    );
                }
            }
        }
        this.refreshHud();
    }


    // Build the on-screen sync HUD (top-left). Call once the race canvas exists.
    attachHud(parent: Node, width: number, height: number): void {
        if (this._disposed || !parent?.isValid) {
            return;
        }
        parent.getChildByName('NetSyncHud')?.destroy();
        const root = makeUiNode('NetSyncHud', parent);
        this._hudRoot = root;
        root.setPosition(-width / 2, height / 2, 0);
        const panelW = 560;
        const panelH = 200;
        const cx = 16 + panelW / 2;
        const cy = -(12 + panelH / 2);
        const bg = makeRect('BG', root, panelW, panelH, uiColor(6, 18, 32, 190));
        bg.setPosition(cx, cy, 0);
        const label = makeLabel('Text', root, '', 18, uiColor(150, 255, 190));
        label.setPosition(cx, cy, 0);
        label.getComponent(UITransform)!.setContentSize(panelW - 24, panelH - 16);
        const lbl = label.getComponent(Label)!;
        lbl.horizontalAlign = Label.HorizontalAlign.LEFT;
        lbl.verticalAlign = Label.VerticalAlign.TOP;
        lbl.overflow = Label.Overflow.CLAMP;
        lbl.lineHeight = 24;
        this._hudLabel = lbl;
        this.refreshHud();
    }

    // GameManager feeds a per-lane local-vs-host distance diagnostic line for the HUD.
    setDiag(text: string): void {
        this._diagText = text;
        this.refreshHud();
    }

    private refreshHud(): void {
        if (!this._hudLabel?.isValid) {
            return;
        }
        // Throttle: called from both the frame-receive and upload paths (~60/s), but
        // updating the Label rebuilds its text mesh. ~6/s is plenty for a status readout.
        const now = Date.now();
        if (now - this._hudLastPaintAt < HUD_REPAINT_INTERVAL_MS) {
            return;
        }
        this._hudLastPaintAt = now;
        this._hudLabel.string =
            `联机同步(调试)  ${this._isHost ? '房主' : '客户'} pos=${this._session.localPos}  当前房主seat=${this._activeHostPos === Number.MAX_SAFE_INTEGER ? '?' : this._activeHostPos}${this._isHost && !this._session.localIsHost ? ' (已接管)' : ''}\n` +
            `帧 发=${this._sentFrames} 收=${this._recvFrames}  |  快照 发=${this._snapSent} 收=${this._snapRecv}  |  名次 发=${this._resultSent} 收=${this._resultRecv}\n` +
            (this._diagText || '(等待位置数据)');
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        // Stop capturing local input once the networked race ends.
        setNetInputCaptureActive(false);
        if (this._hudRoot?.isValid) {
            this._hudRoot.destroy();
        }
        this._hudRoot = null;
        this._hudLabel = null;
        this._net.setCallbacks({});
    }
}
