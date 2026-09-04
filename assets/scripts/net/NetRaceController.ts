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
import { decodeInputFrame, encodeInputFrame, NetInputEvent, NetInputKind } from './NetRaceInput';
import { decodeRaceSnapshot, encodeRaceSnapshot, decodeSelfSnapshot, encodeSelfSnapshot, NetSnapshotEntry } from './NetRaceSnapshot';
import { decodeRaceResult, encodeRaceResult, NetResultEntry } from './NetRaceResult';
import {
    AiActionSequenceTracker,
    isTrustedCollisionRagdollAuthority,
    MonotonicSequenceTracker,
    ownerLaneMatches,
    shouldUseTransientPacketCondition,
} from './NetInputOrdering';
import type { DolphinJumpStartState } from '../core/DolphinJumpConfig';
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
// AI ultimates are rare, outcome-affecting edges. Repeat an accepted host event
// across ~0.2s of logical frames so broadcast fallback packet loss and the brief
// host-migration trust hand-off cannot erase the action. Replays are idempotent at
// the phase controller and still pass the normal per-packet sequence ordering.
const AI_DOLPHIN_REPEAT_FRAMES = 6;
const COLLISION_RAGDOLL_REPEAT_FRAMES = 6;

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
    private _ownerStateSeq = 0;
    private readonly _aiDolphinActionSeqByLane: Record<number, number> = {};
    private readonly _collisionRagdollActionSeqByLane: Record<number, number> = {};
    private readonly _pendingAiDolphinRepeats: Array<{
        event: NetInputEvent;
        remaining: number;
    }> = [];
    private readonly _pendingCollisionRagdollRepeats: Array<{
        event: NetInputEvent;
        createdFrame: number;
        remaining: number;
    }> = [];
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
    // This hybrid does not roll simulation back. Once a newer packet is applied,
    // delayed older inputs are discarded and owner snapshots correct the copy.
    private readonly _reliableFrameOrder = new MonotonicSequenceTracker();
    private readonly _inputOrder = new MonotonicSequenceTracker();
    private readonly _ownerStateOrder = new MonotonicSequenceTracker();
    private readonly _aiActionOrder = new AiActionSequenceTracker();
    private readonly _collisionRagdollActionOrder = new AiActionSequenceTracker();
    // Remote-human swimmers keyed by their seat (posNum). Decoded input for a pos is
    // replayed onto its controller. Registered by GameManager after the roster builds.
    private readonly _remoteByPos: Record<number, RemoteSwimmerController> = {};
    private readonly _remoteByLane: Record<number, RemoteSwimmerController> = {};
    private readonly _remoteLaneByPos: Record<number, number> = {};
    // Latest authoritative position snapshot from the host, keyed by lane. Clients ease
    // their swimmers toward these. Empty on the host (it IS the authority).
    private _snapshotTargets: NetSnapshotEntry[] = [];
    // Monotonic local receive revision. Consumers use this to apply non-interpolated
    // authoritative state (such as condition) once per S| packet rather than once per
    // render frame while the same snapshot remains cached.
    private _snapshotRevision = 0;
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
    // Reliable host-authoritative AI dolphin action. The listener receives the
    // stable assigned lane and the already-decided form; clients never re-evaluate
    // the host's pose threshold locally.
    private _aiDolphinListener: ((
        lane: number,
        dive: boolean,
        start: DolphinJumpStartState,
    ) => boolean) | null = null;
    private _collisionRagdollListener: ((
        lane: number,
        strength: number,
        rollSign: number,
        pitchSign: number,
        phase: number,
        ageSeconds: number,
    ) => boolean) | null = null;
    // Host migration state. `_isHost` starts from the session but can flip: a client
    // promotes itself if the host goes silent, and a self-promoted host steps back down
    // if a lower-pos (higher-priority) host appears. `_activeHostPos` is the seat of the
    // host we currently trust (MAX_SAFE_INTEGER until the first snapshot on a client).
    // `_lastSnapshotAt` is when we last heard from that host (0 = not yet started).
    private _isHost: boolean;
    private _activeHostPos: number;
    private _lastSnapshotAt = 0;
    // A migrated host must announce itself with S| before emitting accepted AI
    // edges, otherwise clients still trusting the departed seat would discard them.
    private _aiAuthorityAnnounced: boolean;
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
        this._aiAuthorityAnnounced = false;
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

    get canIssueAiDolphinActions(): boolean {
        return this._isHost && this._aiAuthorityAnnounced;
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
        this._aiAuthorityAnnounced = false;
        this._activeHostPos = this._session.localPos;
        this._lastSnapshotAt = Date.now();
        // The promoted host's current fixed-step simulation becomes authoritative.
        // Discard the departed host's cached targets immediately; otherwise
        // GameManager would keep easing AI bodies toward a stale S| packet even after
        // authority changed, corrupting both movement and distance-derived phases.
        this._snapshotTargets = [];
        this._prevSnapshot = [];
        this._snapshotTime = 0;
        this._prevSnapshotTime = 0;
        this._snapshotRevision++;
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
                this._aiAuthorityAnnounced = false;
            }
        } else if (hostPos === this._activeHostPos) {
            this._lastSnapshotAt = now;
        } else if (now - this._lastSnapshotAt > HOST_SILENCE_MS) {
            // Lower-priority sender, but our better host has gone silent — accept it.
            this._activeHostPos = hostPos;
            this._lastSnapshotAt = now;
            if (this._isHost && hostPos < this._session.localPos) {
                this._isHost = false;
                this._aiAuthorityAnnounced = false;
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
        // Host is gone. Every survivor immediately trusts the same lowest present seat,
        // so delayed actions from the departed host are rejected even before the new
        // host's first S| arrives. If the new lowest also drops, the next roster/silence
        // signal handles it.
        const departedHostPos = this._activeHostPos;
        let lowest = present[0];
        for (const p of present) {
            if (p < lowest) {
                lowest = p;
            }
        }
        if (this._session.localPos === lowest) {
            console.warn(`[NetRace] host seat=${departedHostPos} left room — pos=${lowest} taking over`);
            this.promoteToHost();
        } else {
            this._activeHostPos = lowest;
            this._lastSnapshotAt = Date.now();
        }
    }

    // Host: encode + broadcast the authoritative position snapshot.
    sendSnapshot(entries: NetSnapshotEntry[]): void {
        if (this._disposed || !this._net.isSupported()) {
            return;
        }
        this._snapSent++;
        this._net.broadcast(encodeRaceSnapshot(this._session.localPos, entries));
        this._aiAuthorityAnnounced = true;
    }

    // Client: the most recent authoritative snapshot (empty until one arrives).
    get snapshotTargets(): NetSnapshotEntry[] {
        return this._snapshotTargets;
    }

    get snapshotRevision(): number {
        return this._snapshotRevision;
    }

    // Broadcast THIS client's own player position so every other client can catch its
    // on-screen copy up to how its owner sees it (owner predicts locally = the truth).
    sendSelfSnapshot(entry: NetSnapshotEntry): void {
        if (this._disposed || !this._net.isSupported()) {
            return;
        }
        this._net.broadcast(encodeSelfSnapshot(entry, ++this._ownerStateSeq, this._session.localPos));
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

    setAiDolphinListener(listener: ((
        lane: number,
        dive: boolean,
        start: DolphinJumpStartState,
    ) => boolean) | null): void {
        this._aiDolphinListener = listener;
    }

    setCollisionRagdollListener(listener: ((
        lane: number,
        strength: number,
        rollSign: number,
        pitchSign: number,
        phase: number,
        ageSeconds: number,
    ) => boolean) | null): void {
        this._collisionRagdollListener = listener;
    }

    queueCollisionRagdollEvent(
        lane: number,
        strength: number,
        rollSign: number,
        pitchSign: number,
        phase: number,
    ): void {
        if (this._disposed || !Number.isFinite(lane) || lane < 0 || strength <= 0) {
            return;
        }
        const stableLane = Math.floor(lane);
        const actionSeq = (this._collisionRagdollActionSeqByLane[stableLane] ?? 0) + 1;
        this._collisionRagdollActionSeqByLane[stableLane] = actionSeq;
        this._pendingCollisionRagdollRepeats.push({
            event: {
                kind: NetInputKind.CollisionRagdoll,
                ragdollLane: stableLane,
                ragdollActionSeq: actionSeq,
                ragdollStrength: Math.max(0, Math.min(1, strength)),
                ragdollSignBits: (rollSign >= 0 ? 1 : 0) | (pitchSign >= 0 ? 2 : 0),
                ragdollPhase: Number.isFinite(phase) ? phase : 0,
                ragdollAgeTicks: 0,
            },
            // Collisions are resolved before tick() in GameManager, so the next logical
            // frame is the event's zero-age frame. Later redundant packets advance age.
            createdFrame: this._sentFrames + 1,
            remaining: COLLISION_RAGDOLL_REPEAT_FRAMES + 1,
        });
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
            // adoptHostFromSnapshot can reject a lower-priority stale/competing host.
            // Only the seat currently trusted as authority may replace movement and
            // condition targets; otherwise packet arrival order would make AI jump
            // between two authorities during migration.
            if (!this._isHost && snapshot.hostPos === this._activeHostPos) {
                this._prevSnapshot = this._snapshotTargets;
                this._prevSnapshotTime = this._snapshotTime;
                this._snapshotTargets = snapshot.entries;
                this._snapshotTime = Date.now();
                this._snapshotRevision++;
            }
            this.refreshHud();
            return;
        }
        const self = decodeSelfSnapshot(msg);
        if (self) {
            // Own-authoritative position from another human's client; keep the latest
            // per lane (ignore our own echo — we don't catch up our own player).
            this.recordRemoteSelf(self, self.ownerPos ?? -1);
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
            if (decoded.senderPos >= 0 && decoded.senderPos !== this._session.localPos) {
                this.processTrustedCollisionRagdollActions(decoded.senderPos, decoded.events);
                this.processTrustedAiActions(decoded.senderPos, decoded.events);
                this.processRemotePacket(decoded.senderPos, decoded.inputSeq, decoded.events, decoded.self);
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
            const capturedCount = events.length;
            // Append repeats registered by earlier logical frames first. A receiver
            // that already started the announced phase simply rejects the replay.
            for (let i = this._pendingAiDolphinRepeats.length - 1; i >= 0; i--) {
                const pending = this._pendingAiDolphinRepeats[i];
                events.push(pending.event);
                pending.remaining--;
                if (pending.remaining <= 0) {
                    this._pendingAiDolphinRepeats.splice(i, 1);
                }
            }
            // The freshly captured event is already present in this frame; retain a
            // compact copy for following frames only.
            for (let i = 0; i < capturedCount; i++) {
                const event = events[i];
                if (event.kind === NetInputKind.AiDolphinJump) {
                    const lane = Math.max(0, Math.floor(event.aiLane ?? 0));
                    const actionSeq = (this._aiDolphinActionSeqByLane[lane] ?? 0) + 1;
                    this._aiDolphinActionSeqByLane[lane] = actionSeq;
                    event.aiActionSeq = actionSeq;
                    this._pendingAiDolphinRepeats.push({
                        event: {
                            kind: NetInputKind.AiDolphinJump,
                            aiLane: lane,
                            dolphinDive: !!event.dolphinDive,
                            aiActionSeq: actionSeq,
                            aiStart: event.aiStart,
                        },
                        remaining: AI_DOLPHIN_REPEAT_FRAMES,
                    });
                }
            }
            // Collision ragdoll is a visual authority edge, repeated with the same
            // action identity. Age advances on each redundant frame so a receiver
            // that missed the first packet joins the reaction at the correct phase.
            for (let i = this._pendingCollisionRagdollRepeats.length - 1; i >= 0; i--) {
                const pending = this._pendingCollisionRagdollRepeats[i];
                pending.event.ragdollAgeTicks = Math.max(
                    0,
                    Math.min(24, this._sentFrames - pending.createdFrame),
                );
                events.push(pending.event);
                pending.remaining--;
                if (pending.remaining <= 0) {
                    this._pendingCollisionRagdollRepeats.splice(i, 1);
                }
            }
            if (!this.broadcastSyncRequired) {
                // Fully frame-synced room: input + self-position ride the reliable
                // lock-step frame channel (zero extra broadcast traffic).
                const ownerStateSeq = selfPos ? ++this._ownerStateSeq : -1;
                this._net.uploadFrame(encodeInputFrame(
                    this._session.localPos,
                    events,
                    selfPos,
                    ownerStateSeq,
                    this._sentFrames,
                ));
            } else if (events.length > 0) {
                // Mixed / broadcast-only: a peer can't use frame sync, so do NOT
                // participate in lock-step at all. Uploading frames into a session a peer
                // never feeds makes WeChat's frame-sync wait for the missing member every
                // tick and stall the whole frame loop — that is the "laggy, waiting for the
                // host" jank on the other client. Ride inputs over broadcast instead;
                // The periodic P| remains the idle-state fallback. Include self here
                // too so the receiver applies the exact pre-event owner condition
                // before replaying this event frame.
                const ownerStateSeq = selfPos ? ++this._ownerStateSeq : -1;
                this._net.broadcast(BROADCAST_INPUT_TAG + encodeInputFrame(
                    this._session.localPos,
                    events,
                    selfPos,
                    ownerStateSeq,
                    this._sentFrames,
                ));
            }
            sentThisTick = true;
        }
        if (sentThisTick) {
            this.refreshHud();
        }
    }

    // Register a remote-human swimmer so this member's decoded input is replayed onto
    // it. Called by GameManager once the networked roster is built.
    registerRemote(pos: number, lane: number, controller: RemoteSwimmerController): void {
        if (pos < 0 || lane < 0 || !controller) {
            return;
        }
        this._remoteByPos[pos] = controller;
        this._remoteByLane[lane] = controller;
        this._remoteLaneByPos[pos] = lane;
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
            // Stable host actions are independent edges. Process them before packet
            // ordering so a delayed first-seen action is not swallowed merely because
            // a newer empty frame arrived first.
            if (decoded.senderPos !== this._session.localPos) {
                this.processTrustedCollisionRagdollActions(decoded.senderPos, decoded.events);
                this.processTrustedAiActions(decoded.senderPos, decoded.events);
            }
            // We cannot roll a predicted swimmer backward. Drop duplicate or delayed
            // old service frames permanently instead of replaying an unseen old input
            // after a newer HeldOn/HeldOff pair.
            if (!this._reliableFrameOrder.accept(decoded.senderPos, frame.frameId)) {
                continue;
            }
            this._peerLatest[decoded.senderPos] = frame.frameId;
            if (decoded.senderPos !== this._session.localPos) {
                this.processRemotePacket(decoded.senderPos, decoded.inputSeq, decoded.events, decoded.self);
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

    private remoteForOwnedEntry(entry: NetSnapshotEntry, senderPos: number): RemoteSwimmerController | undefined {
        if (entry.lane === this._playerLaneForSelf) {
            return undefined;
        }
        if (senderPos >= 0) {
            const expectedLane = this._remoteLaneByPos[senderPos];
            if (!ownerLaneMatches(expectedLane, entry.lane)) {
                return undefined;
            }
            return this._remoteByPos[senderPos];
        }
        return this._remoteByLane[entry.lane];
    }

    private recordRemoteSelf(entry: NetSnapshotEntry, senderPos = -1): boolean {
        const remote = this.remoteForOwnedEntry(entry, senderPos);
        // Once registration is complete, an attributed packet must resolve to that
        // owner's controller. Unattributed legacy P| may still resolve by lane until
        // the lobby protocol gate has removed old clients.
        if (!remote && (senderPos >= 0 || this._remoteByLane[entry.lane] !== undefined)) {
            return false;
        }
        const ownerStateSeq = entry.ownerStateSeq ?? -1;
        if (!this._ownerStateOrder.accept(entry.lane, ownerStateSeq)) {
            return false;
        }
        const now = Date.now();
        const existing = this._selfSnapshots[entry.lane];
        if (existing) {
            existing.entry = entry;
            existing.time = now;
        } else {
            this._selfSnapshots[entry.lane] = { entry, time: now };
        }
        remote?.applyOwnerCondition(
            entry.conditionEnergyRatio,
            entry.conditionHeartRate,
            entry.sprintActive === true,
        );
        return true;
    }

    private processTrustedAiActions(senderPos: number, events: readonly NetInputEvent[]): void {
        if (senderPos !== this._activeHostPos || !this._aiDolphinListener) {
            return;
        }
        for (const event of events) {
            if (event.kind !== NetInputKind.AiDolphinJump
                || !Number.isFinite(event.aiLane)
                || !Number.isFinite(event.aiActionSeq)
                || !event.aiStart) {
                continue;
            }
            const lane = Math.max(0, Math.floor(event.aiLane ?? 0));
            const actionSeq = Math.floor(event.aiActionSeq ?? -1);
            if (actionSeq <= this._aiActionOrder.latest(senderPos, lane)) {
                continue;
            }
            // Commit the watermark only after the gameplay object accepted the edge.
            // If scene wiring is not ready yet, a later redundant packet may retry it.
            if (this._aiDolphinListener(lane, !!event.dolphinDive, event.aiStart)) {
                this._aiActionOrder.markApplied(senderPos, lane, actionSeq);
            }
        }
    }

    private processTrustedCollisionRagdollActions(
        senderPos: number,
        events: readonly NetInputEvent[],
    ): void {
        if (!this._collisionRagdollListener) {
            return;
        }
        for (const event of events) {
            if (event.kind !== NetInputKind.CollisionRagdoll
                || !Number.isFinite(event.ragdollLane)
                || !Number.isFinite(event.ragdollActionSeq)) {
                continue;
            }
            const lane = Math.max(0, Math.floor(event.ragdollLane ?? 0));
            if (!isTrustedCollisionRagdollAuthority(
                senderPos,
                lane,
                this._remoteLaneByPos[senderPos],
                this._activeHostPos,
                lane === this._playerLaneForSelf || this._remoteByLane[lane] !== undefined,
            )) {
                continue;
            }
            const actionSeq = Math.floor(event.ragdollActionSeq ?? -1);
            if (actionSeq <= this._collisionRagdollActionOrder.latest(senderPos, lane)) {
                continue;
            }
            const signBits = Math.max(0, Math.min(3, Math.floor(event.ragdollSignBits ?? 0)));
            const accepted = this._collisionRagdollListener(
                lane,
                Math.max(0, Math.min(1, event.ragdollStrength ?? 0)),
                (signBits & 1) !== 0 ? 1 : -1,
                (signBits & 2) !== 0 ? 1 : -1,
                Number.isFinite(event.ragdollPhase) ? event.ragdollPhase! : 0,
                Math.max(0, Math.floor(event.ragdollAgeTicks ?? 0)) * LOGICAL_FRAME_SECONDS,
            );
            if (accepted) {
                this._collisionRagdollActionOrder.markApplied(senderPos, lane, actionSeq);
            }
        }
    }

    private processRemotePacket(
        senderPos: number,
        inputSeq: number,
        events: NetInputEvent[],
        self?: NetSnapshotEntry,
    ): void {
        // Validate the sender/owned lane before accepting its sequence. Otherwise a
        // malformed high-sequence packet for another lane could advance this sender's
        // watermark and make its following legitimate inputs look stale.
        const remote = self
            ? this.remoteForOwnedEntry(self, senderPos)
            : this._remoteByPos[senderPos];
        if (!remote) {
            return;
        }
        // Advance the shared reliable/broadcast sequence even for empty reliable
        // frames. If a missing older frame arrives later, replaying it would reverse
        // input order; owner position/state correction is the recovery mechanism.
        const inputAccepted = this._inputOrder.accept(senderPos, inputSeq);
        let selfAccepted = false;
        if (self) {
            selfAccepted = this.recordRemoteSelf(self, senderPos);
        }
        if (events.length === 0 || !inputAccepted) {
            return;
        }
        const humanEvents = events.filter((event) => event.kind !== NetInputKind.AiDolphinJump
            && event.kind !== NetInputKind.CollisionRagdoll);
        if (humanEvents.length === 0) {
            return;
        }
        // A newer periodic P| can overtake an older IN|. Keep the newer persistent
        // owner state, but apply the packet's own pre-input condition just for its
        // events, then restore the latest owner condition afterward.
        const transientCondition = !!self && shouldUseTransientPacketCondition(
            inputAccepted,
            humanEvents.length,
            selfAccepted,
            self.conditionEnergyRatio,
            self.conditionHeartRate,
        );
        if (transientCondition) {
            remote.applyTransientOwnerCondition(
                self!.conditionEnergyRatio,
                self!.conditionHeartRate,
                self!.sprintActive === true,
            );
        }
        try {
            remote.applyEvents(humanEvents);
        } finally {
            if (transientCondition) {
                remote.restoreOwnerCondition();
            }
        }
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
        this._pendingAiDolphinRepeats.length = 0;
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
