// Networked-race frame-sync controller.
//
// STEP 1 (current): transport verification only. It re-registers the lock-step
// callbacks in the race scene (they were cleared when the room UI was disposed),
// uploads one heartbeat frame every logical tick, and logs the onSyncFrame payloads
// it receives so we can confirm both devices exchange frames and learn the real
// actionList structure. It does NOT yet drive the simulation — the race still runs
// locally on each client. Deterministic fixed-step simulation comes in later steps.

import { Label, Node, UITransform } from 'cc';
import { INetRoom, NetSyncFrame } from './INetRoom';
import { netRoom } from './NetManager';
import { NetRaceSessionData } from './NetRaceSession';
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

    constructor(private readonly _session: NetRaceSessionData) {
        this._net = netRoom();
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
            // Step 1 heartbeat payload: "<posNum>|f<frameCounter>". Real per-frame
            // input capture replaces this next.
            this._net.uploadFrame(`${this._session.localPos}|f${this._sentFrames}`);
            sentThisTick = true;
        }
        if (sentThisTick) {
            this.refreshHud();
        }
    }

    private onSyncFrame(frame: NetSyncFrame): void {
        this._recvFrames++;
        this._lastFrameId = frame.frameId;
        this._lastItems = frame.items;
        for (const item of frame.items) {
            const bar = item.indexOf('|');
            if (bar <= 0) {
                continue;
            }
            const pos = parseInt(item.slice(0, bar), 10);
            const rest = item.slice(bar + 1);
            const fn = rest.charAt(0) === 'f' ? parseInt(rest.slice(1), 10) : NaN;
            if (Number.isFinite(pos) && Number.isFinite(fn)) {
                this._peerLatest[pos] = fn;
            }
        }
        // Verbose for the first frames (to inspect structure), then sample.
        if (this._recvFrames <= 12 || this._recvFrames % 30 === 0) {
            console.log(`[NetRace] onSyncFrame #${frame.frameId} items=${JSON.stringify(frame.items)}`);
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
            .map((k) => `p${k}=${this._peerLatest[Number(k)]}`)
            .join('  ');
        const items = this._lastItems.length ? JSON.stringify(this._lastItems) : '(无)';
        this._hudLabel.string =
            `联机同步(调试)\n` +
            `本端 pos=${this._session.localPos} 房主=${this._session.localIsHost ? '是' : '否'} seed=${this._session.seed}\n` +
            `成员=${this._session.members.length} 发送=${this._sentFrames} 接收=${this._recvFrames} 帧#=${this._lastFrameId}\n` +
            `各端最新帧: ${peers || '(无)'}\n` +
            `最近: ${items}`;
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        if (this._hudRoot?.isValid) {
            this._hudRoot.destroy();
        }
        this._hudRoot = null;
        this._hudLabel = null;
        this._net.setCallbacks({});
    }
}
