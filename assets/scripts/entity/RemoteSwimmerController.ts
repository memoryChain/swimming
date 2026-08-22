// Remote-human swimmer driver for lock-step (帧同步) races.
//
// A remote human occupies a normal Swimmer body (built like an AI competitor) but is
// NOT driven by AISwimmerController. Instead this component applies the decoded input
// events that arrived over the network for that member's seat — the exact same
// Swimmer entry points the local player and the AI use (handleStroke / handleStrokeHeld
// / handleKickStroke + prepareDive / performDive). No decisions are made here; it is a
// pure input replayer.
//
// COMPATIBILITY: only ever added in a networked race (GameManager, net-gated). Single
// player never creates this component.

import { _decorator, Component } from 'cc';
import { StrokeType } from '../core/GameConstants';
import { resolveDiveResult } from '../core/DiveResolver';
import { Swimmer } from './Swimmer';
import { NetInputEvent, NetInputKind, NetInputSide } from '../net/NetRaceInput';

const { ccclass, property } = _decorator;

function strokeType(side: NetInputSide | undefined): StrokeType {
    return side === 1 ? StrokeType.RIGHT : StrokeType.LEFT;
}

@ccclass('RemoteSwimmerController')
export class RemoteSwimmerController extends Component {
    @property(Swimmer) public swimmer: Swimmer = null;
    // The room seat (posNum) whose input this controller replays.
    public pos = -1;
    // Guard so a single dive event can't be applied twice.
    private _dived = false;
    // When the dive was triggered (ms), to detect a dive that got stuck mid-tween.
    private _diveStartedAt = 0;

    // Apply one logical frame's worth of this member's decoded input events, in order.
    applyEvents(events: NetInputEvent[]): void {
        const swimmer = this.swimmer;
        if (!swimmer || !swimmer.node.active) {
            return;
        }
        for (const event of events) {
            this.applyEvent(swimmer, event);
        }
    }

    private applyEvent(swimmer: Swimmer, event: NetInputEvent): void {
        switch (event.kind) {
            case NetInputKind.Stroke:
                swimmer.handleStroke(strokeType(event.side));
                break;
            case NetInputKind.Kick:
                swimmer.handleKickStroke(strokeType(event.side));
                break;
            case NetInputKind.HeldOn:
                swimmer.handleStrokeHeld(strokeType(event.side), true, 0);
                break;
            case NetInputKind.HeldOff:
                swimmer.handleStrokeHeld(strokeType(event.side), false, 0);
                break;
            case NetInputKind.DiveCharge:
                // Charge start carries no motion; the release event drives the dive.
                break;
            case NetInputKind.DolphinJump:
                // The owner emits this event only after accepting the jump locally.
                swimmer.applyAcceptedNetDolphinJump();
                break;
            case NetInputKind.DiveRelease:
                this.performDive(swimmer, event.power ?? 0, event.launchSpeed);
                break;
            default:
                break;
        }
    }

    private performDive(swimmer: Swimmer, power: number, launchSpeed?: number): void {
        if (this._dived) {
            return;
        }
        this._dived = true;
        this._diveStartedAt = Date.now();
        const result = resolveDiveResult(Math.max(0, Math.min(1, power)));
        if (Number.isFinite(launchSpeed) && (launchSpeed ?? -1) >= 0) {
            result.launchSpeed = Math.max(0, launchSpeed ?? 0);
        }
        swimmer.performDive(result);
    }

    // Whether this swimmer's dive has been triggered (via a replayed DiveRelease or the
    // forced-dive redundancy). While false the body is still on the starting block.
    get hasDived(): boolean {
        return this._dived;
    }

    // Milliseconds since the dive was triggered (0 if never). Used to tell a normal
    // in-progress dive tween (recent) from one that got stuck (old, never reached racing).
    diveElapsed(): number {
        return this._dived ? Date.now() - this._diveStartedAt : 0;
    }

    // Redundancy for a lost/failed/stuck DiveRelease: if the owner's authoritative
    // position keeps advancing but this copy isn't racing, force it straight into the
    // race at the reported distance so it can't stay frozen. Marks it dived so a late
    // DiveRelease can't re-trigger the dive animation.
    forceEnterRace(distance: number): void {
        if (!this.swimmer || !this.swimmer.node.active) {
            return;
        }
        this._dived = true;
        this.swimmer.forceEnterRaceAt(distance);
    }

    // Reset per-race latch so the same body can be reused across restarts.
    resetRemote(): void {
        this._dived = false;
        this._diveStartedAt = 0;
    }
}
