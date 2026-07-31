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
import { INetRoom, NetSyncFrame } from './INetRoom';
import { netRoom } from './NetManager';
import { NetRaceSessionData } from './NetRaceSession';
import { drainNetInput, setNetInputCaptureActive } from './NetInputCapture';
import { decodeInputFrame, encodeInputFrame, NetInputEvent } from './NetRaceInput';
import { RemoteSwimmerController } from '../entity/RemoteSwimmerController';
import { makeLabel, makeRect, makeUiNode, uiColor } from '../ui/RuntimeUiFactory';

// Logical frame interval (must match game.json lockStepOptions.gameTick = 33ms).
const LOGICAL_FRAME_SECONDS = 33 / 1000;

export class NetRaceController {
    private readonly _net: INetRoom;
    private _accum = 0;
    private _sentFrames = 0;
    private _recvFrames = 0;
    private _disposed = false;
    // In-race debug HUD so sync state is visible without the console.
    private _hudRoot: Node | null = null;
    private _hudLabel: Label | null = null;
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

    constructor(private readonly _session: NetRaceSessionData) {
        this._net = netRoom();
        // Turn on local-player input capture for the duration of this networked race.
        setNetInputCaptureActive(true);
        this._net.setCallbacks({
            onSyncFrame: (frame) => this.onSyncFrame(frame),
            onDisconnect: () => console.warn('[NetRace] disconnected mid-game'),
            onGameEnd: () => console.log('[NetRace] game end'),
        });
        console.log(
            `[NetRace] start localPos=${_session.localPos} host=${_session.localIsHost} ` +
            `seed=${_session.seed} members=${_session.members.length}`,
        );
    }

    // Called once per rendered frame. Emits at most one logical frame per tick window
    // so upload rate tracks the 33ms lock-step cadence rather than the render rate.
    tick(dt: number): void {
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
            // every client must upload every frame to keep the lock-step cadence).
            const events: NetInputEvent[] = drainNetInput();
            this._net.uploadFrame(encodeInputFrame(this._session.localPos, events));
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
            if (decoded.events.length > 0) {
                this._peerInputCount[decoded.senderPos] = (this._peerInputCount[decoded.senderPos] ?? 0) + 1;
                this._peerLastInput[decoded.senderPos] = decoded.events
                    .map((e) => (e.kind === 'r' ? `r${Math.round((e.power ?? 0) * 100)}` : `${e.kind}${e.side ?? ''}`))
                    .join(',');
                // Log real inputs as they arrive so we can verify both directions.
                console.log(
                    `[NetRace] frame#${frame.frameId} pos${decoded.senderPos} input=${this._peerLastInput[decoded.senderPos]}`,
                );
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

    private refreshHud(): void {
        if (!this._hudLabel?.isValid) {
            return;
        }
        const peers = Object.keys(this._peerLatest)
            .map((k) => {
                const pos = Number(k);
                const last = this._peerLastInput[pos] ? ` [${this._peerLastInput[pos]}]` : '';
                return `p${k}#${this._peerLatest[pos]}×${this._peerInputCount[pos] ?? 0}${last}`;
            })
            .join('  ');
        this._hudLabel.string =
            `联机同步(调试·输入)\n` +
            `本端 pos=${this._session.localPos} 房主=${this._session.localIsHost ? '是' : '否'} seed=${this._session.seed}\n` +
            `成员=${this._session.members.length} 发送=${this._sentFrames} 接收=${this._recvFrames} 帧#=${this._lastFrameId}\n` +
            `各端: ${peers || '(无)'}`;
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
